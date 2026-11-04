import type { CLane, CompiledCity } from '../network';
import type { SimParams } from '../schema';
import { idmAcceleration } from './idm';
import { laneSurvives } from './merge';
import { DRIVING, type Vehicles } from './vehicle';

interface Proposal {
  id: number;
  lane: number;
  positionM: number;
}

export function createLaneChanges(compiled: CompiledCity, vehicles: Vehicles, params: SimParams) {
  const { idm, mobil, laneChangeDistanceM, mandatoryUrgencyM, vehicleLengthM } = params;
  const proposals: Proposal[] = [];
  const creeping = new Uint8Array(vehicles.count);
  const holding = new Uint8Array(vehicles.count);
  const offsetM = new Float64Array(vehicles.count);
  const startTick = new Float64Array(vehicles.count);
  const clearance = vehicleLengthM + idm.minGapM;
  const carLane = compiled.lanes.map((lane) => lane.allowed.includes('car'));
  // Next roads before which each lane is dropped; survival is static per compiled city.
  const dropsBefore = compiled.lanes.map((lane) => {
    const dropped: number[] = [];
    for (const idx of lane.out) {
      const road = compiled.lanes[compiled.movements[idx]!.toLane]!.road;
      if (!dropped.includes(road) && !laneSurvives(compiled, lane, road)) dropped.push(road);
    }
    return dropped;
  });
  const survives = (lane: number, nextRoad: number) => !dropsBefore[lane]!.includes(nextRoad);
  // Neighbors on a target lane around a position, set by findNeighbors.
  let nearLeader = -1;
  let nearFollower = -1;

  function lateralM(id: number, tick: number) {
    if (offsetM[id] === 0 || params.laneChangeDurationS === 0) return 0;
    const progress = ((tick - startTick[id]!) * params.dtS) / params.laneChangeDurationS;
    return offsetM[id]! * Math.max(0, 1 - progress);
  }

  function findNeighbors(lane: number, positionM: number) {
    nearFollower = -1;
    nearLeader = vehicles.last(lane);
    while (nearLeader !== -1 && vehicles.position[nearLeader]! < positionM) {
      nearFollower = nearLeader;
      nearLeader = vehicles.previous[nearLeader]!;
    }
  }

  /** Lane changes from a lane ordinal to the nearest surviving target lane of the route step. */
  function changesToTargets(id: number, ordinal: number, step: number, finalRoad: boolean) {
    if (finalRoad) {
      const destination = compiled.connectors[vehicles.destination[id]!]!;
      return Math.abs(compiled.lanes[destination.lane]!.lane - ordinal);
    }
    const route = vehicles.route[id]!;
    const nextRoad = route.roads[step + 1]!;
    let distance = Infinity;
    for (const target of route.targetLanes[step]!) {
      if (!survives(target, nextRoad)) continue;
      distance = Math.min(distance, Math.abs(compiled.lanes[target]!.lane - ordinal));
    }
    if (distance !== Infinity) return distance;
    // The routing lane model keeps the compiler's clamped movement from a dropped lane, so a
    // lane-level fallback route can name only dropped lanes. Leave by the nearest surviving
    // lane that still enters the next road; planLane then takes its movement and reroutes.
    for (const idx of compiled.roads[route.roads[step]!]!.lanes) {
      if (!carLane[idx] || !survives(idx, nextRoad)) continue;
      const lane = compiled.lanes[idx]!;
      const enters = lane.out.some((movement) => {
        const { toLane, neverGreen } = compiled.movements[movement]!;
        return !neverGreen && compiled.lanes[toLane]!.road === nextRoad;
      });
      if (enters) distance = Math.min(distance, Math.abs(lane.lane - ordinal));
    }
    return distance;
  }

  function acceleration(id: number, lane: CLane, leader: number) {
    return idmAcceleration(
      idm,
      vehicles.speed[id]!,
      lane.speedLimitMps * vehicles.speedFactor[id]!,
      leader === -1 ? 0 : vehicles.speed[leader]!,
      leader === -1
        ? Infinity
        : vehicles.position[leader]! - vehicles.position[id]! - vehicleLengthM,
    );
  }

  function safeGap(id: number, lane: CLane, positionM: number, leader: number, follower: number) {
    if (leader !== -1 && vehicles.position[leader]! - positionM < clearance) return false;
    if (follower !== -1) {
      const spareGap = positionM - vehicles.position[follower]! - clearance;
      if (spareGap < 0) return false;
      if (
        vehicles.state[follower] === DRIVING &&
        (acceleration(follower, lane, id) < -mobil.safeDecelMps2 ||
          // Commit also clamps travel against the leader's start-of-step position.
          vehicles.speed[follower]! - spareGap / params.dtS > mobil.safeDecelMps2 * params.dtS)
      )
        return false;
    }
    // A front or rear bumper can still span a lane boundary during a movement traversal.
    if (positionM < clearance && follower === -1) {
      for (const idx of lane.in) {
        const entering = vehicles.first(-idx - 1);
        if (
          entering !== -1 &&
          positionM + compiled.movements[idx]!.lengthM - vehicles.position[entering]! < clearance
        )
          return false;
      }
    }
    if (lane.lengthM - positionM < clearance && leader === -1) {
      for (const idx of lane.out) {
        const leaving = vehicles.last(-idx - 1);
        if (leaving !== -1 && lane.lengthM - positionM + vehicles.position[leaving]! < clearance)
          return false;
      }
    }
    return true;
  }

  function propose(id: number, source: CLane, tick: number, discretionary: boolean) {
    creeping[id] = 0;
    holding[id] = 0;
    if (source.left === -1 && source.right === -1) return;
    const step = vehicles.routeStep[id]!;
    const route = vehicles.route[id]!;
    const destination = compiled.connectors[vehicles.destination[id]!]!;
    const finalRoad = step === route.roads.length - 1;
    holding[id] = Number(!finalRoad && !survives(source.idx, route.roads[step + 1]!));
    const positionM = vehicles.position[id]!;
    if (positionM < vehicleLengthM) return;
    const cutoff = finalRoad ? Math.min(source.lengthM, destination.positionM) : source.lengthM;
    const remaining = cutoff - positionM;
    if (remaining < 0) return;
    const changesNeeded = changesToTargets(id, source.lane, step, finalRoad);
    const mandatory =
      changesNeeded > 0 && remaining < changesNeeded * laneChangeDistanceM + mandatoryUrgencyM;
    if (mandatory && compiled.movements[route.movements[step] ?? -1]?.turn === 'diverge')
      holding[id] = 1;
    const animating = lateralM(id, tick) !== 0;
    if (animating) {
      if (mandatory) creeping[id] = 1;
      return;
    }
    // Discretionary changes are off near the stop line, while holding a grant, and on the
    // destination lane of the final road: a queue at the connector must hold the lane (T08).
    if (!mandatory && (!discretionary || (finalRoad && changesNeeded === 0))) return;

    const oldLeader = vehicles.previous[id]!;
    const oldFollower = vehicles.next[id]!;
    let bestLane = -1;
    let bestIncentive = mobil.thresholdMps2;
    for (let side = 0; side < 2; side++) {
      const target = side === 0 ? source.left : source.right;
      const lane = compiled.lanes[target];
      if (!lane || !carLane[target] || lane.lengthM - positionM < idm.minGapM - 1e-8) continue;
      const changesAfter = changesToTargets(id, lane.lane, step, finalRoad);
      if (
        mandatory
          ? changesAfter >= changesNeeded
          : remaining < changesAfter * laneChangeDistanceM + mandatoryUrgencyM
      )
        continue;
      findNeighbors(target, positionM);
      const leader = nearLeader;
      const follower = nearFollower;
      if (!safeGap(id, lane, positionM, leader, follower)) {
        // Yield to a close leader or faster follower. An adjacent driver who can
        // pull ahead keeps moving, so both do not settle at creep speed.
        if (
          mandatory &&
          ((leader !== -1 && vehicles.position[leader]! - positionM < clearance) ||
            (follower !== -1 && vehicles.speed[follower]! > vehicles.speed[id]!))
        ) {
          creeping[id] = 1;
        }
        continue;
      }
      if (mandatory) {
        creeping[id] = 1;
        bestLane = target;
        break;
      }
      const oldFollowerGain =
        oldFollower === -1 || vehicles.state[oldFollower] !== DRIVING
          ? 0
          : acceleration(oldFollower, source, oldLeader) - acceleration(oldFollower, source, id);
      const newFollowerGain =
        follower === -1 || vehicles.state[follower] !== DRIVING
          ? 0
          : acceleration(follower, lane, id) - acceleration(follower, lane, leader);
      const incentive =
        acceleration(id, lane, leader) -
        acceleration(id, source, oldLeader) +
        mobil.politeness * (oldFollowerGain + newFollowerGain);
      if (incentive > bestIncentive) {
        bestIncentive = incentive;
        bestLane = target;
      }
    }
    if (bestLane !== -1) proposals.push({ id, lane: bestLane, positionM });
  }

  function resolve(tick: number, apply: (id: number, lane: number, positionM: number) => void) {
    for (const { id, lane, positionM } of proposals) {
      const target = compiled.lanes[lane]!;
      findNeighbors(lane, positionM);
      if (!safeGap(id, target, positionM, nearLeader, nearFollower)) continue;
      const source = compiled.lanes[vehicles.lane[id]!]!;
      offsetM[id] = (Math.sign(source.lane - target.lane) * (source.widthM + target.widthM)) / 2;
      startTick[id] = tick;
      creeping[id] = 0;
      holding[id] = 0;
      apply(id, lane, positionM);
    }
    proposals.length = 0;
  }

  return {
    propose,
    resolve,
    lateralM,
    creeping,
    holding,
    clearAnimation: (id: number) => {
      offsetM[id] = 0;
      creeping[id] = 0;
    },
  };
}
