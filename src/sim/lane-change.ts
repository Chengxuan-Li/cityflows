import type { CLane, CompiledCity } from '../network';
import { vehicleClasses, type SimParams } from '../schema';
import { idmAcceleration } from './idm';
import { isDroppedLane } from '../network/lane-drop';
import { reachableLanes, type Route } from '../routing';
import { createGraphCache } from '../routing/graph';
import { createVehicleProfiles, DRIVING, type Vehicles } from './vehicle';

interface Proposal {
  id: number;
  lane: number;
  positionM: number;
}

export function createLaneChanges(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  hasGrant: (id: number) => boolean = () => false,
) {
  const { idm, mobil, laneChangeDistanceM, mandatoryUrgencyM } = params;
  const proposals: Proposal[] = [];
  const creeping = new Uint8Array(vehicles.count);
  const holding = new Uint8Array(vehicles.count);
  // TASK-076: time held for a mandatory change (creeping or standing), the change given up
  // on the current lane, and the cooperative pairs (yielder -> requester, requester -> yielder).
  const heldS = new Float64Array(vehicles.count);
  const gaveUp = new Uint8Array(vehicles.count);
  const yieldingTo = new Int32Array(vehicles.count).fill(-1);
  const yielderOf = new Int32Array(vehicles.count).fill(-1);
  const yielders: number[] = [];
  const offsetM = new Float64Array(vehicles.count);
  const startTick = new Float64Array(vehicles.count);
  const profiles = createVehicleProfiles(params);
  const profile = (id: number) => profiles[vehicles.vclass[id]!]!;
  const allowedLanes = vehicleClasses.map((name) =>
    compiled.lanes.map((lane) => lane.allowed.includes(name)),
  );
  const graphFor = createGraphCache();
  const corridors = new WeakMap<Route, { times: Float64Array; costs: Map<number, number[]> }>();
  // Next roads before which each lane is dropped; survival is static per compiled city.
  const dropsBefore = compiled.lanes.map((lane) => {
    const dropped: number[] = [];
    for (const idx of lane.out) {
      const road = compiled.lanes[compiled.movements[idx]!.toLane]!.road;
      if (!dropped.includes(road) && isDroppedLane(compiled, lane, road)) dropped.push(road);
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
      if (!allowedLanes[vehicles.vclass[id]!]![idx] || !survives(idx, nextRoad)) continue;
      const lane = compiled.lanes[idx]!;
      const enters = lane.out.some((movement) => {
        const { toLane, neverGreen } = compiled.movements[movement]!;
        return !neverGreen && compiled.lanes[toLane]!.road === nextRoad;
      });
      if (enters) distance = Math.min(distance, Math.abs(lane.lane - ordinal));
    }
    return distance;
  }

  function futureChanges(id: number, from: number, positionM: number) {
    const route = vehicles.route[id]!,
      step = vehicles.routeStep[id]!;
    let cached = corridors.get(route);
    if (!cached) {
      const times = new Float64Array(route.roads.length + 1);
      for (let i = 0; i < route.roads.length; i++) {
        const road = compiled.roads[route.roads[i]!]!;
        times[i + 1] = times[i]! + road.lengthM / road.speedLimitMps;
      }
      cached = { times, costs: new Map() };
      corridors.set(route, cached);
    }
    const current = compiled.lanes[vehicles.lane[id]!]!;
    // One normal mandatory-change window of posted-speed travel bounds positioning.
    const deadline =
      cached.times[step + 1]! -
      Math.max(0, current.lengthM - positionM) / compiled.roads[current.road]!.speedLimitMps +
      params.missedTurnAfterS;
    let low = step,
      high = route.roads.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cached.times[middle + 1]! <= deadline) low = middle + 1;
      else high = middle;
    }
    const end = low - 1;
    if (end <= step)
      return changesToTargets(
        id,
        compiled.lanes[from]!.lane,
        step,
        step === route.roads.length - 1,
      );
    const kind = vehicles.vclass[id]!;
    const graph = graphFor(compiled, vehicleClasses[kind]!);
    const key =
      ((kind * route.roads.length + step) * route.roads.length + end) * compiled.connectors.length +
      vehicles.destination[id]!;
    let future = cached.costs.get(key);
    if (!future) {
      let next: number[] = [];
      for (let i = end; i > step; i--) {
        const road = compiled.roads[route.roads[i]!]!;
        const final = i === route.roads.length - 1;
        const cutoff = final
          ? compiled.connectors[vehicles.destination[id]!]!.positionM
          : Math.max(0, road.lengthM - 10);
        const values: number[] = [];
        for (const entry of road.lanes) {
          let minimum = Infinity;
          for (const reach of reachableLanes(
            compiled,
            graph.allowed,
            entry,
            cutoff,
            laneChangeDistanceM,
          )) {
            if (i === end) {
              if (
                route.targetLanes[i]!.includes(reach.lane) &&
                (final || survives(reach.lane, route.roads[i + 1]!))
              )
                minimum = Math.min(minimum, reach.changes);
            } else
              for (const m of graph.outgoing[reach.lane]!) {
                const target = compiled.lanes[compiled.movements[m]!.toLane]!;
                if (target.road === route.roads[i + 1])
                  minimum = Math.min(minimum, reach.changes + next[target.lane]!);
              }
          }
          values.push(minimum);
        }
        next = values;
      }
      future = next;
      cached.costs.set(key, future);
    }
    let minimum = Infinity;
    for (const reach of reachableLanes(
      compiled,
      graph.allowed,
      from,
      compiled.lanes[from]!.lengthM,
      laneChangeDistanceM,
      positionM,
    ))
      for (const m of graph.outgoing[reach.lane]!) {
        const target = compiled.lanes[compiled.movements[m]!.toLane]!;
        if (target.road === route.roads[step + 1])
          minimum = Math.min(minimum, reach.changes + future[target.lane]!);
      }
    return minimum;
  }

  function acceleration(id: number, lane: CLane, leader: number) {
    return idmAcceleration(
      profile(id).idm,
      vehicles.speed[id]!,
      Math.min(lane.speedLimitMps * vehicles.speedFactor[id]!, profile(id).maxSpeedMps),
      leader === -1 ? 0 : vehicles.speed[leader]!,
      leader === -1
        ? Infinity
        : vehicles.position[leader]! - vehicles.position[id]! - profile(leader).lengthM,
    );
  }

  function safeGap(id: number, lane: CLane, positionM: number, leader: number, follower: number) {
    const clearance = profile(id).lengthM + idm.minGapM;
    if (
      leader !== -1 &&
      vehicles.position[leader]! - positionM < profile(leader).lengthM + idm.minGapM
    )
      return false;
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
    if (leader === -1) {
      for (const idx of lane.out) {
        const leaving = vehicles.last(-idx - 1);
        if (
          leaving !== -1 &&
          lane.lengthM - positionM + vehicles.position[leaving]! <
            profile(leaving).lengthM + idm.minGapM
        )
          return false;
      }
    }
    return true;
  }

  /** The nearest vehicle behind on the target lane that can stop behind the requester's rear. */
  function pickYielder(id: number, positionM: number) {
    const stopM = positionM - profile(id).lengthM - idm.minGapM;
    for (
      let candidate = nearFollower;
      candidate !== -1 && vehicles.position[candidate]! >= positionM - laneChangeDistanceM;
      candidate = vehicles.next[candidate]!
    ) {
      const distance = stopM - vehicles.position[candidate]!;
      const speed = vehicles.speed[candidate]!;
      if (
        vehicles.state[candidate] !== DRIVING ||
        hasGrant(candidate) ||
        heldS[candidate]! >= params.cooperativeYieldS ||
        yieldingTo[candidate] !== -1 ||
        distance < 0 ||
        speed * speed > 2 * profile(candidate).idm.bMps2 * distance
      )
        continue;
      yieldingTo[candidate] = id;
      yielderOf[id] = candidate;
      yielders.push(candidate);
      return;
    }
  }

  /** Clears last step's cooperative pairs; every requester picks again in proposal order. */
  function startProposals() {
    for (const id of yielders) {
      yielderOf[yieldingTo[id]!] = -1;
      yieldingTo[id] = -1;
    }
    yielders.length = 0;
  }

  /** Returns true when the vehicle gives its mandatory change up in this step. */
  function propose(
    id: number,
    source: CLane,
    tick: number,
    discretionary: boolean,
    requiredLane?: number,
  ) {
    const crept = creeping[id]!;
    creeping[id] = 0;
    holding[id] = 0;
    if (gaveUp[id] || (source.left === -1 && source.right === -1)) return false;
    const step = vehicles.routeStep[id]!;
    const route = vehicles.route[id]!;
    const destination = compiled.connectors[vehicles.destination[id]!]!;
    const finalRoad = step === route.roads.length - 1;
    holding[id] = Number(!finalRoad && !survives(source.idx, route.roads[step + 1]!));
    const positionM = vehicles.position[id]!;
    const cutoff = finalRoad ? Math.min(source.lengthM, destination.positionM) : source.lengthM;
    const remaining = cutoff - positionM;
    const changesNeeded =
      requiredLane === undefined
        ? changesToTargets(id, source.lane, step, finalRoad)
        : Math.abs(compiled.lanes[requiredLane]!.lane - source.lane);
    const mandatory =
      remaining >= 0 &&
      changesNeeded > 0 &&
      remaining < changesNeeded * laneChangeDistanceM + mandatoryUrgencyM;
    // Held: creeping for the change, or standing at the stop position (where `stopped` counts).
    heldS[id] = mandatory && (crept || vehicles.stopped[id]! > 0) ? heldS[id]! + params.dtS : 0;
    if (!finalRoad && heldS[id]! >= params.missedTurnAfterS) {
      gaveUp[id] = 1;
      heldS[id] = 0;
      return true;
    }
    if (positionM < profile(id).lengthM || remaining < 0) return false;
    if (mandatory && compiled.movements[route.movements[step] ?? -1]?.turn === 'diverge')
      holding[id] = 1;
    const animating = lateralM(id, tick) !== 0;
    if (animating) {
      if (mandatory) creeping[id] = 1;
      return false;
    }
    // Discretionary changes are off near the stop line, while holding a grant, and on the
    // destination lane of the final road: a queue at the connector must hold the lane (T08).
    if (!mandatory && (!discretionary || (finalRoad && changesNeeded === 0))) return false;

    const oldLeader = vehicles.previous[id]!;
    const oldFollower = vehicles.next[id]!;
    let bestLane = -1;
    let bestIncentive = mobil.thresholdMps2;
    let sourceFuture = -1;
    for (let side = 0; side < 2; side++) {
      const target = side === 0 ? source.left : source.right;
      const lane = compiled.lanes[target];
      // A car standing at its own stop position for a mandatory change may be past the end of
      // a shorter neighbor's setback; it may still land up to that neighbor's stop position.
      const standing = mandatory && vehicles.speed[id]! < 0.1;
      if (
        !lane ||
        !allowedLanes[vehicles.vclass[id]!]![target] ||
        (standing ? positionM > lane.stopM + 1e-8 : lane.lengthM - positionM < idm.minGapM - 1e-8)
      )
        continue;
      const changesAfter =
        requiredLane === undefined
          ? changesToTargets(id, lane.lane, step, finalRoad)
          : Math.abs(compiled.lanes[requiredLane]!.lane - lane.lane);
      // A discretionary change never adds a needed change, on any road (TASK-076).
      if (
        mandatory
          ? changesAfter >= changesNeeded
          : changesAfter > changesNeeded ||
            remaining < changesAfter * laneChangeDistanceM + mandatoryUrgencyM
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
          ((leader !== -1 &&
            vehicles.position[leader]! - positionM < profile(leader).lengthM + idm.minGapM) ||
            (follower !== -1 && vehicles.speed[follower]! > vehicles.speed[id]!))
        ) {
          creeping[id] = 1;
        }
        if (mandatory && heldS[id]! >= params.cooperativeYieldS && yielderOf[id] === -1)
          pickYielder(id, positionM);
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
        if (sourceFuture === -1) sourceFuture = futureChanges(id, source.idx, positionM);
        if (futureChanges(id, target, positionM) > sourceFuture) continue;
        bestIncentive = incentive;
        bestLane = target;
      }
    }
    if (bestLane !== -1) proposals.push({ id, lane: bestLane, positionM });
    return false;
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
      heldS[id] = 0;
      apply(id, lane, positionM);
    }
    proposals.length = 0;
  }

  return {
    startProposals,
    propose,
    resolve,
    lateralM,
    futureChanges,
    creeping,
    holding,
    gaveUp,
    yieldingTo,
    /** The vehicle leaves its lane for a movement. */
    leaveLane: (id: number) => {
      offsetM[id] = 0;
      creeping[id] = 0;
      heldS[id] = 0;
      gaveUp[id] = 0;
    },
  };
}
