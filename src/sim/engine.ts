import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { CConnector, CompiledCity } from '../network';
import {
  createRouteProvider,
  movementPenaltyS,
  reachableLanes,
  type LinkCosts,
  type RouteProvider,
} from '../routing';
import type { SimParams, TripRequest } from '../schema';
import { createConnectors } from './connectors';
import { stateHash } from './hash';
import { idmAcceleration } from './idm';
import { createIntersections, type IntersectionObserver } from './intersection';
import { createLaneChanges } from './lane-change';
import { createLinkCosts } from './link-costs';
import { createMerges } from './merge';
import { createAccounting } from './metrics';
import { DEFAULT_SIM_PARAMS } from './params';
import { createProjector, patchChanges, remapRoute } from './patch';
import { patchSignals } from './signals';
import { createRerouter, vehicleRouteRequest } from './reroute';
import type {
  PatchResult,
  TrafficEngine,
  VehicleDetail,
  VehicleSnapshot,
  VehicleState,
} from './types';
import { createVehicles, DRIVING, QUEUED_ORIGIN, QUEUED_DESTINATION, PENDING } from './vehicle';

type LoadInput = Parameters<TrafficEngine['load']>[0] & {
  routeProvider?: RouteProvider;
  linkCosts?: LinkCosts;
  intersectionObserver?: IntersectionObserver;
};
const detailStates: (VehicleState | null)[] = [
  null,
  'driving',
  'queued_destination',
  'queued_origin',
  'completed',
  'failed',
];

function createRun({
  compiled,
  trips,
  scenario,
  params: overrides,
  routeProvider,
  linkCosts,
  intersectionObserver,
}: LoadInput) {
  const params: SimParams = {
    ...DEFAULT_SIM_PARAMS,
    ...scenario.simParams,
    ...overrides,
    intersection: {
      ...DEFAULT_SIM_PARAMS.intersection,
      ...scenario.simParams.intersection,
      ...overrides?.intersection,
    },
  };
  const { dtS, vehicleLengthM, idm, spawnMinGapM } = params;
  const vehicles = createVehicles(trips.length, compiled.lanes.length, compiled.movements.length);
  const reservationAcceleration = new Float64Array(trips.length);
  const accounting = createAccounting(compiled, vehicles);
  const connectors = createConnectors(compiled, trips, scenario, params, vehicles, accounting);
  let merges = createMerges(compiled, vehicles, params);
  let intersections = createIntersections(compiled, vehicles, params, merges.canEnter, {
    onDecision: intersectionObserver,
    acceleration: (id) => reservationAcceleration[id]!,
  });
  let laneChanges = createLaneChanges(compiled, vehicles, params);
  let carLanes = compiled.lanes.map((lane) => lane.allowed.includes('car'));
  const signalEpochs = new Map<string, number>();
  const provider =
    routeProvider ?? createRouteProvider({ laneChangeDistanceM: params.laneChangeDistanceM });
  const observedCosts = createLinkCosts(compiled, params, scenario.startS);
  const costs = linkCosts ?? observedCosts.costs;
  const rerouter = createRerouter(compiled, vehicles, params, provider, costs);
  const roadEnteredS = new Float64Array(trips.length);
  const roadEnteredM = new Float64Array(trips.length);
  const routeReasons: VehicleDetail['routeReason'][] = Array(trips.length).fill('initial');
  const fallback = new Uint8Array(trips.length);
  const waitingForLane = new Uint8Array(trips.length);
  const arrival = new Int32Array(trips.length).fill(-1);
  const order = new Uint32Array(trips.length);
  const acceleration = new Float64Array(trips.length);
  const limit = new Float64Array(trips.length);
  let orderCount = 0;
  let tick = 0;
  const time = () => scenario.startS + tick * dtS;

  function routeFrom(id: number, lane: number, positionM: number) {
    return provider.route(
      compiled,
      costs,
      vehicleRouteRequest(vehicles, params, id, lane, positionM),
    );
  }

  function leaveRoad(id: number, timeS: number, positionM: number) {
    observedCosts.record(
      compiled.lanes[vehicles.lane[id]!]!.road,
      timeS - roadEnteredS[id]!,
      positionM - roadEnteredM[id]!,
    );
  }

  function planLane(id: number, lane: number, positionM: number) {
    const destination = compiled.connectors[vehicles.destination[id]!]!;
    const route = vehicles.route[id]!;
    const step = vehicles.routeStep[id]!;
    const planned = compiled.movements[route.movements[step] ?? -1];
    arrival[id] = -1;
    vehicles.movement[id] = -1;
    fallback[id] = 0;
    waitingForLane[id] = 0;
    if (destination.lane === lane && destination.positionM >= positionM) {
      arrival[id] = destination.idx;
    } else if (planned?.fromLane === lane) {
      vehicles.movement[id] = planned.idx;
    } else {
      let penalty = Infinity;
      let routePenalty = Infinity;
      let alternate = -1;
      for (const idx of compiled.lanes[lane]!.out) {
        const movement = compiled.movements[idx]!;
        if (movement.neverGreen || !carLanes[movement.toLane]) continue;
        const cost = movementPenaltyS(compiled, movement);
        if (
          !vehicles.attemptedFallbacks[id]?.has(idx) &&
          (cost < penalty || (cost === penalty && idx < vehicles.movement[id]!)) &&
          routeFrom(id, movement.toLane, 0).ok
        ) {
          penalty = cost;
          vehicles.movement[id] = idx;
        }
        const next = compiled.lanes[movement.toLane]!;
        if (
          next.road !== route.roads[step + 1] ||
          !route.targetLanes[step]?.includes(lane) ||
          cost > routePenalty ||
          (cost === routePenalty && idx > alternate)
        )
          continue;
        const finalRoad = step + 1 === route.roads.length - 1;
        const targets = finalRoad ? [destination.lane] : route.targetLanes[step + 1]!;
        const cutoff = finalRoad ? destination.positionM : compiled.roads[next.road]!.lengthM - 10;
        for (const candidate of reachableLanes(
          compiled,
          carLanes,
          next.idx,
          cutoff,
          params.laneChangeDistanceM,
        )) {
          if (!targets.includes(candidate.lane)) continue;
          routePenalty = cost;
          alternate = idx;
          break;
        }
      }
      if (alternate !== -1) vehicles.movement[id] = alternate;
      else if (vehicles.movement[id] !== -1) fallback[id] = 1;
      else waitingForLane[id] = Number(!route.targetLanes[step]?.includes(lane));
    }
  }

  function freeFlow(id: number, origin: CConnector) {
    const destination = compiled.connectors[vehicles.destination[id]!]!;
    let position = origin.positionM;
    let travel = 0;
    for (const idx of vehicles.route[id]!.movements) {
      const movement = compiled.movements[idx]!;
      const lane = compiled.lanes[movement.fromLane]!;
      const next = compiled.lanes[movement.toLane]!;
      travel += Math.max(0, lane.lengthM - position) / lane.speedLimitMps;
      travel += movement.lengthM / Math.min(lane.speedLimitMps, next.speedLimitMps);
      position = 0;
    }
    return (
      travel + (destination.positionM - position) / compiled.lanes[destination.lane]!.speedLimitMps
    );
  }

  function hasSpawnGap(connector: CConnector) {
    const { lane, positionM } = connector;
    const spacing = vehicleLengthM + Math.max(spawnMinGapM, idm.minGapM);
    if (positionM < spacing) {
      for (const idx of compiled.lanes[lane]!.in) {
        if (intersections.occupancy[idx]! > 0) return false;
        if (!intersections.continuations[idx]) continue;
        // Continuations have no reservations; protect the spawn gap across their boundary.
        const movement = compiled.movements[idx]!;
        const occupant = vehicles.first(-idx - 1);
        if (
          occupant !== -1 &&
          positionM + movement.lengthM - vehicles.position[occupant]! < spacing
        )
          return false;
        const approach = vehicles.first(movement.fromLane);
        if (
          approach !== -1 &&
          positionM +
            movement.lengthM +
            compiled.lanes[movement.fromLane]!.lengthM -
            vehicles.position[approach]! <
            spacing
        )
          return false;
      }
    }
    for (
      let id = vehicles.last(lane);
      id !== -1 && vehicles.position[id]! <= positionM + spacing;
      id = vehicles.previous[id]!
    ) {
      if (Math.abs(vehicles.position[id]! - positionM) < spacing) return false;
    }
    const source = compiled.lanes[lane]!;
    if (source.lengthM - positionM < spacing) {
      for (const idx of source.out) {
        const id = vehicles.last(-idx - 1);
        if (id !== -1 && source.lengthM - positionM + vehicles.position[id]! < spacing)
          return false;
      }
    }
    return true;
  }

  function releaseTrip(id: number, connector: CConnector, timeS: number) {
    const { lane, positionM } = connector;
    const result = routeFrom(id, lane, positionM);
    if (!result.ok) {
      accounting.fail(id, 'no_route');
      return false;
    }
    vehicles.route[id] = result.route;
    vehicles.freeFlow[id] = freeFlow(id, connector);
    vehicles.departed[id] = timeS;
    roadEnteredS[id] = timeS;
    roadEnteredM[id] = positionM;
    rerouter.start(id, timeS);
    planLane(id, lane, positionM);
    vehicles.insert(id, lane, positionM);
    accounting.transition(id, DRIVING);
    return true;
  }

  function proposeLaneChanges() {
    const { occupied } = vehicles;
    for (let i = 0; i < occupied.length && occupied[i]! < compiled.lanes.length; i++) {
      const lane = compiled.lanes[occupied[i]!]!;
      if (lane.left === -1 && lane.right === -1) continue;
      for (let id = vehicles.first(lane.idx); id !== -1; id = vehicles.next[id]!) {
        if (vehicles.state[id] !== DRIVING) continue;
        const discretionary =
          intersections.grants[id] === -1 &&
          lane.stopM - vehicles.position[id]! > params.intersection.decisionDistanceM;
        laneChanges.propose(id, lane, tick, discretionary);
      }
    }
  }

  function prepareTravel(timeS: number) {
    orderCount = 0;
    const { occupied } = vehicles;
    for (let i = 0; i < occupied.length; i++) {
      const segment = occupied[i]!;
      const head = vehicles.head[segment]!;
      const lane = compiled.lanes[segment];
      const path = lane ? null : compiled.movements[segment - compiled.lanes.length]!;
      const length = lane?.lengthM ?? path!.lengthM;
      const speedLimit =
        lane?.speedLimitMps ??
        Math.min(
          compiled.lanes[path!.fromLane]!.speedLimitMps,
          compiled.lanes[path!.toLane]!.speedLimitMps,
        );
      let ahead = -1;
      for (let id = head; id !== -1; id = vehicles.next[id]!) {
        order[orderCount++] = id;
        if (vehicles.state[id] === QUEUED_DESTINATION) {
          ahead = id;
          continue;
        }
        const position = vehicles.position[id]!;
        const destination = compiled.connectors[arrival[id]!];
        const movement = compiled.movements[vehicles.movement[id]!];
        if (laneChanges.holding[id] && intersections.grants[id] !== -1) intersections.release(id);
        const granted =
          intersections.grants[id] !== -1 ||
          (movement !== undefined && intersections.continuations[movement.idx]);
        let leader = ahead;
        let offset = 0;
        if (leader === -1 && path) {
          leader = vehicles.last(path.toLane);
          offset = length;
        } else if (leader === -1 && lane && !destination) {
          // A car's rear can still be on this approach after its front enters a turn.
          offset = length;
          for (const idx of lane.out) {
            const occupant = vehicles.last(-idx - 1);
            if (
              occupant !== -1 &&
              (leader === -1 || vehicles.position[occupant]! < vehicles.position[leader]!)
            ) {
              leader = occupant;
            }
          }
          if (leader === -1 && movement) {
            leader = vehicles.last(movement.toLane);
            offset += movement.lengthM;
          }
        }
        const rear =
          leader === -1 ? Infinity : offset + vehicles.position[leader]! - vehicleLengthM;
        limit[id] = Math.max(position, rear - idm.minGapM);
        let obstacle = rear;
        let leaderSpeed = leader === -1 ? 0 : vehicles.speed[leader]!;
        let stopAt = Infinity;
        if (lane && destination && !connectors.canArrive(destination, timeS)) {
          // Put the virtual bumper beyond the portal so standstill occurs at the portal.
          stopAt = destination.positionM + idm.minGapM;
        } else if (
          lane &&
          ((movement && !granted) || laneChanges.holding[id] || waitingForLane[id])
        ) {
          stopAt = lane.stopM;
        }
        if (path) stopAt = intersections.zoneStop(path, position) + idm.minGapM;
        if (stopAt < obstacle) {
          obstacle = stopAt;
          leaderSpeed = 0;
        }
        acceleration[id] = idmAcceleration(
          idm,
          vehicles.speed[id]!,
          speedLimit * vehicles.speedFactor[id]!,
          leaderSpeed,
          obstacle - position,
        );
        // A grant removes the virtual stop line on the next step. Predict its motion
        // from physical following, including for grants awarded later in this resolve.
        // Evaluate at the capped speed: free-flow braking toward a lower limit is not a stop.
        reservationAcceleration[id] = idmAcceleration(
          idm,
          Math.min(vehicles.speed[id]!, speedLimit * vehicles.speedFactor[id]!),
          speedLimit * vehicles.speedFactor[id]!,
          lane && !granted ? (leader === -1 ? 0 : vehicles.speed[leader]!) : leaderSpeed,
          (lane && !granted ? rear : obstacle) - position,
        );
        if (movement?.turn === 'merge' && lane && !granted && stopAt < rear) {
          acceleration[id] = Math.min(
            merges.stopAcceleration(id, movement),
            idmAcceleration(
              idm,
              vehicles.speed[id]!,
              speedLimit * vehicles.speedFactor[id]!,
              leader === -1 ? 0 : vehicles.speed[leader]!,
              rear - position,
            ),
          );
        }

        // Ask for entry before the ungranted stop line would force braking, and as soon as the
        // car ahead on this lane may enter, so a platoon flows through a green or continuation.
        const speed = vehicles.speed[id]!;
        const requestDistance = Math.max(
          params.intersection.decisionDistanceM,
          (speed * speed) / (2 * idm.bMps2) + idm.minGapM,
        );
        if (
          lane &&
          movement &&
          !laneChanges.holding[id] &&
          !granted &&
          (ahead === -1 ||
            intersections.grants[ahead] !== -1 ||
            (intersections.continuations[vehicles.movement[ahead]!] &&
              !laneChanges.holding[ahead])) &&
          lane.stopM - position <= requestDistance
        ) {
          intersections.request(id, movement);
        }
        ahead = id;
      }
    }
  }

  function resolve(timeS: number) {
    laneChanges.resolve(tick, (id, lane, positionM) => {
      if (intersections.grants[id] !== -1) intersections.release(id);
      vehicles.remove(id);
      vehicles.insert(id, lane, positionM);
      planLane(id, lane, positionM);
      vehicles.stopped[id] = 0;
      vehicles.junctionWaiting[id] = 0;
    });
    // Use the resolved lanes for following distances and entry requests while positions
    // and speeds are still from the start of the step.
    prepareTravel(timeS);
    intersections.resolve();
  }

  function reachDestination(id: number, connector: CConnector, timeS: number) {
    vehicles.position[id] = connector.positionM;
    vehicles.speed[id] = 0;
    if (connectors.arrive(connector, timeS)) {
      leaveRoad(id, timeS, connector.positionM);
      vehicles.remove(id);
      accounting.complete(id, timeS);
    } else {
      if (vehicles.state[id] !== QUEUED_DESTINATION) accounting.transition(id, QUEUED_DESTINATION);
      else vehicles.waiting[id] = vehicles.waiting[id]! + dtS;
    }
  }

  function enterLane(id: number, lane: number, position: number, timeS: number) {
    roadEnteredS[id] = timeS;
    roadEnteredM[id] = 0;
    if (intersections.grants[id] !== -1) intersections.release(id);
    vehicles.remove(id);
    if (fallback[id]) {
      const result = routeFrom(id, lane, 0);
      if (!result.ok) {
        vehicles.lane[id] = lane;
        vehicles.position[id] = 0;
        vehicles.speed[id] = 0;
        vehicles.route[id] = null;
        accounting.fail(id, 'stranded');
        return;
      }
      vehicles.route[id] = result.route;
      vehicles.routeStep[id] = 0;
    } else {
      vehicles.routeStep[id] = vehicles.routeStep[id]! + 1;
    }
    planLane(id, lane, 0);
    const destination = compiled.connectors[arrival[id]!];
    vehicles.insert(
      id,
      lane,
      Math.min(position, compiled.lanes[lane]!.lengthM, destination?.positionM ?? Infinity),
    );
    vehicles.stopped[id] = 0;
    vehicles.junctionWaiting[id] = 0;
    if (destination && position >= destination.positionM) reachDestination(id, destination, timeS);
  }

  function commit(timeS: number) {
    for (let i = 0; i < orderCount; i++) {
      const id = order[i]!;
      const destination = compiled.connectors[arrival[id]!];
      if (vehicles.state[id] === QUEUED_DESTINATION) {
        reachDestination(id, destination!, timeS);
        continue;
      }
      const field = vehicles.lane[id]!;
      const previousPosition = vehicles.position[id]!;
      const previousSpeed = vehicles.speed[id]!;
      let speed = Math.max(0, previousSpeed + acceleration[id]! * dtS);
      if (field >= 0 && laneChanges.creeping[id]) {
        speed = Math.min(speed, params.intersection.creepSpeedMps);
      }
      let position = Math.min(previousPosition + speed * dtS, limit[id]!);
      if (field < 0) {
        const path = compiled.movements[-field - 1]!;
        // A competing movement may have entered this lane earlier in the same commit.
        const exitTail = vehicles.last(path.toLane);
        if (exitTail !== -1)
          position = Math.max(
            previousPosition,
            Math.min(
              position,
              path.lengthM + vehicles.position[exitTail]! - vehicleLengthM - idm.minGapM,
            ),
          );
        // Earlier commits may have entered a zone that was empty during proposals.
        const zoneStart = intersections.zoneStop(path, previousPosition);
        if (position > zoneStart) {
          position = Math.max(previousPosition, zoneStart);
          accounting.zoneStop();
        }
        vehicles.speed[id] = (position - previousPosition) / dtS;
        if (position >= path.lengthM) enterLane(id, path.toLane, position - path.lengthM, timeS);
        else vehicles.position[id] = position;
        continue;
      }
      const lane = compiled.lanes[field]!;
      const remaining = lane.stopM - previousPosition;
      const movement = vehicles.movement[id]!;
      const granted = intersections.continuations[movement] ? movement : intersections.grants[id]!;
      if ((movement !== -1 && granted === -1) || laneChanges.holding[id] || waitingForLane[id]) {
        position = Math.min(position, Math.max(previousPosition, lane.stopM - idm.minGapM));
        if (remaining <= params.intersection.decisionDistanceM) {
          vehicles.junctionWaiting[id] = vehicles.junctionWaiting[id]! + dtS;
        }
        // IDM approaches a standstill asymptotically. Settle before accumulating time at the stop line.
        if (remaining <= idm.minGapM + 0.1 && speed <= 0.1) position = previousPosition;
      }
      if (granted !== -1 && position >= lane.lengthM) {
        const path = compiled.movements[granted]!;
        const exitTail = vehicles.last(path.toLane);
        if (exitTail !== -1)
          position = Math.max(
            previousPosition,
            Math.min(
              position,
              lane.lengthM +
                path.lengthM +
                vehicles.position[exitTail]! -
                vehicleLengthM -
                idm.minGapM,
            ),
          );
      }
      speed = (position - previousPosition) / dtS;
      vehicles.position[id] = position;
      vehicles.speed[id] = speed;
      vehicles.stopped[id] =
        previousSpeed === 0 && speed === 0 && remaining <= idm.minGapM + 0.1
          ? vehicles.stopped[id]! + dtS
          : 0;
      if (speed === 0) vehicles.waiting[id] = vehicles.waiting[id]! + dtS;

      if (
        destination &&
        (position >= destination.positionM ||
          (speed <= 0.1 &&
            position >= destination.positionM - 0.01 &&
            limit[id]! >= destination.positionM))
      ) {
        reachDestination(id, destination, timeS);
      } else if (position >= lane.lengthM) {
        if (granted !== -1) {
          if (fallback[id]) {
            vehicles.missedTurn[id] = 1;
            routeReasons[id] = 'missed_turn';
            (vehicles.attemptedFallbacks[id] ??= new Set()).add(granted);
          }
          const zoneStart = intersections.zoneStop(compiled.movements[granted]!, 0);
          if (position - lane.lengthM > zoneStart) {
            position = lane.lengthM + Math.max(0, zoneStart);
            vehicles.speed[id] = (position - previousPosition) / dtS;
            accounting.zoneStop();
          }
          leaveRoad(id, timeS, lane.lengthM);
          vehicles.remove(id);
          laneChanges.clearAnimation(id);
          vehicles.insert(
            id,
            -granted - 1,
            Math.min(position - lane.lengthM, compiled.movements[granted]!.lengthM),
          );
          // A through node's movement has no length (TASK-061): carry the overflow into the
          // next lane in the same step, so a split road drives like one road.
          if (compiled.movements[granted]!.lengthM === 0)
            enterLane(id, compiled.movements[granted]!.toLane, position - lane.lengthM, timeS);
        } else if (movement === -1) {
          vehicles.remove(id);
          vehicles.position[id] = lane.lengthM;
          vehicles.speed[id] = 0;
          accounting.fail(id, 'stranded');
        }
      }
    }
  }

  function snapshot(): VehicleSnapshot {
    const count = accounting.trips.driving + accounting.trips.queuedDestination;
    const snapshot: VehicleSnapshot = {
      timeS: time(),
      count,
      id: new Uint32Array(count),
      x: new Float32Array(count),
      y: new Float32Array(count),
      heading: new Float32Array(count),
      speed: new Float32Array(count),
      lateralM: new Float32Array(count),
      lane: new Int32Array(count),
      state: new Uint8Array(count),
    };
    let i = 0;
    for (let id = 0; id < vehicles.count; id++) {
      const state = vehicles.state[id]!;
      if (state !== DRIVING && state !== QUEUED_DESTINATION) continue;
      const field = vehicles.lane[id]!;
      const segment = field < 0 ? compiled.movements[-field - 1]! : compiled.lanes[field]!;
      const position = vehicles.position[id]!;
      const point = pointAtDistance(segment.polyline, segment.cumulative, position);
      snapshot.id[i] = id + 1;
      snapshot.x[i] = point.x;
      snapshot.y[i] = point.y;
      snapshot.heading[i] = headingAtDistance(segment.polyline, segment.cumulative, position);
      snapshot.speed[i] = vehicles.speed[id]!;
      snapshot.lateralM[i] = laneChanges.lateralM(id, tick);
      snapshot.lane[i] = field;
      snapshot.state[i] = state;
      i++;
    }
    return snapshot;
  }

  function inspect(vehicleId: number): VehicleDetail | null {
    const id = vehicleId - 1;
    const trip: TripRequest | undefined = trips[id];
    const state = vehicles.state[id];
    if (!trip || state === undefined || state === PENDING) return null;
    const route = vehicles.route[id];
    return {
      id: vehicleId,
      tripId: trip.id,
      personId: trip.personId,
      originPlace: trip.originPlaceId,
      destinationPlace: trip.destinationPlaceId,
      state: detailStates[state]!,
      lane: vehicles.lane[id]!,
      positionM: vehicles.position[id]!,
      speedMps: vehicles.speed[id]!,
      // A deferred edit check can retain a broken internal plan until it is due. Do not
      // publish its removed indices as a drawable route.
      route:
        route && !route.roads.includes(-1) && !route.movements.includes(-1)
          ? {
              ...route,
              roads: route.roads.slice(),
              movements: route.movements.slice(),
              targetLanes: route.targetLanes.map((lanes) => lanes.slice()),
            }
          : null,
      routeReason: routeReasons[id]!,
      waitingS:
        state === QUEUED_ORIGIN
          ? Math.max(0, time() - connectors.queuedSince(id))
          : vehicles.waiting[id]!,
      departedS: Number.isNaN(vehicles.departed[id]) ? null : vehicles.departed[id]!,
      arrivedS: Number.isNaN(vehicles.arrived[id]) ? null : vehicles.arrived[id]!,
      failReason: vehicles.failReason[id]!,
    };
  }

  function editChecked(id: number, failed: boolean) {
    if (intersections.grants[id] !== -1) intersections.release(id);
    routeReasons[id] = 'edit';
    if (failed) {
      vehicles.remove(id);
      vehicles.speed[id] = 0;
      vehicles.route[id] = null;
      accounting.fail(id, 'destination_unreachable');
      return;
    }
    planLane(id, vehicles.lane[id]!, vehicles.position[id]!);
    vehicles.stopped[id] = 0;
    vehicles.junctionWaiting[id] = 0;
  }

  function patch(next: CompiledCity): PatchResult {
    if (
      next.places.length !== compiled.places.length ||
      compiled.places.some((place) => !next.index.place.has(place.id))
    )
      throw new Error('Place additions and removals require a restart');
    const before = compiled;
    const changes = patchChanges(before, next);
    const project = createProjector(next);
    const oldGrants = intersections.grants.slice();
    const oldRedGrants = intersections.redGrants.slice();
    const oldExits = intersections.exitedFrom.slice();
    const result = { version: next.version, relocated: 0, stranded: 0, rerouted: 0 };
    observedCosts.patch(next);
    if (costs !== observedCosts.costs) {
      const times = observedCosts.costs.roadTravelTimeS.slice();
      for (const road of before.roads) {
        const mapped = changes.roads[road.idx]!;
        if (mapped !== -1) times[mapped] = costs.roadTravelTimeS[road.idx]!;
      }
      costs.roadTravelTimeS = times;
      costs.version++;
    }
    connectors.patch(next);
    accounting.patch(next);
    compiled = next;
    rerouter.patch(next);
    vehicles.resetSegments(next.lanes.length, next.movements.length);
    merges = createMerges(next, vehicles, params);
    intersections = createIntersections(
      patchSignals(before, next, time(), signalEpochs),
      vehicles,
      params,
      merges.canEnter,
      { onDecision: intersectionObserver, acceleration: (id) => reservationAcceleration[id]! },
    );
    laneChanges = createLaneChanges(next, vehicles, params);
    carLanes = next.lanes.map((lane) => lane.allowed.includes('car'));

    for (let id = 0; id < vehicles.count; id++) {
      intersections.exitedFrom[id] = changes.movements[oldExits[id]!] ?? -1;
      const oldDestination = before.connectors[vehicles.destination[id]!];
      const mappedDestination = oldDestination ? changes.connectors[oldDestination.idx] : undefined;
      if (
        mappedDestination !== undefined &&
        mappedDestination !== -1 &&
        next.connectors[mappedDestination]!.direction !== 'out'
      ) {
        vehicles.destination[id] = mappedDestination;
      } else {
        const destinationPlace = next.places[next.index.place.get(trips[id]!.destinationPlaceId)!]!;
        vehicles.destination[id] =
          destinationPlace.connectorsIn[id % destinationPlace.connectorsIn.length] ?? -1;
      }
      const route = vehicles.route[id];
      const step = vehicles.routeStep[id]!;
      if (route) vehicles.route[id] = remapRoute(route, changes);
      vehicles.movement[id] = changes.movements[vehicles.movement[id]!] ?? -1;
      vehicles.attemptedFallbacks[id] =
        vehicles.attemptedFallbacks[id] &&
        new Set(
          [...vehicles.attemptedFallbacks[id]!]
            .map((i) => changes.movements[i]!)
            .filter((i) => i !== -1),
        );
      if (vehicles.state[id] !== DRIVING && vehicles.state[id] !== QUEUED_DESTINATION) continue;
      const field = vehicles.lane[id]!;
      const source = field >= 0 ? before.lanes[field]! : before.movements[-field - 1]!;
      const mapped = field >= 0 ? changes.lanes[field]! : changes.movements[-field - 1]!;
      const segment = field >= 0 ? next.lanes[mapped] : next.movements[mapped];
      let relocated = false;
      let newField = field >= 0 ? mapped : -mapped - 1;
      let position = vehicles.position[id]!;
      if (!segment || position > segment.lengthM + 1e-9) {
        const projection = project(source, position);
        if (projection) {
          newField = projection.field;
          position = projection.positionM;
          relocated = true;
          result.relocated++;
        } else if (!segment) {
          vehicles.speed[id] = 0;
          vehicles.lane[id] = -1;
          vehicles.route[id] = null;
          accounting.fail(id, 'stranded');
          result.stranded++;
          continue;
        } else position = segment.lengthM;
      }
      vehicles.insert(id, newField, position);
      if (vehicles.destination[id] === -1) {
        vehicles.remove(id);
        vehicles.speed[id] = 0;
        vehicles.route[id] = null;
        accounting.fail(id, 'destination_unreachable');
        continue;
      }
      if (relocated) {
        intersections.exitedFrom[id] = -1;
        roadEnteredS[id] = time();
        roadEnteredM[id] = newField >= 0 ? position : 0;
        vehicles.stopped[id] = 0;
        vehicles.junctionWaiting[id] = 0;
        if (vehicles.state[id] === QUEUED_DESTINATION) accounting.transition(id, DRIVING);
      }
      const mappedRoute = vehicles.route[id]!;
      const invalid =
        relocated ||
        mappedRoute.roads.slice(step).includes(-1) ||
        mappedRoute.movements.slice(step).some((i) => i === -1 || next.movements[i]!.neverGreen) ||
        route!.targetLanes.slice(step).some((lanes) => lanes.some((i) => changes.lanes[i] === -1));
      const destination = next.connectors[vehicles.destination[id]!]!;
      const destinationChanged =
        !oldDestination ||
        mappedDestination !== destination.idx ||
        changes.lanes[oldDestination.lane] !== destination.lane ||
        oldDestination.positionM !== destination.positionM;
      const affected =
        invalid ||
        destinationChanged ||
        route!.roads.slice(step).some((i) => changes.changedRoads.has(i));
      if (destinationChanged && vehicles.state[id] === QUEUED_DESTINATION)
        accounting.transition(id, DRIVING);
      if (affected) {
        const immediate =
          relocated ||
          mappedRoute.roads[step] === -1 ||
          mappedRoute.movements[step] === -1 ||
          next.movements[mappedRoute.movements[step] ?? -1]?.neverGreen ||
          mappedRoute.targetLanes[step]?.length === 0 ||
          destinationChanged;
        rerouter.scheduleEdit(id, time(), invalid || destinationChanged, immediate);
        result.rerouted++;
      }
      arrival[id] = changes.connectors[arrival[id]!] ?? -1;
      if (newField >= 0) {
        if (relocated || destinationChanged || (vehicles.movement[id] === -1 && arrival[id] === -1))
          planLane(id, newField, position);
        if (vehicles.state[id] === QUEUED_DESTINATION && arrival[id] === -1)
          accounting.transition(id, DRIVING);
      } else {
        vehicles.movement[id] = -newField - 1;
        if (relocated) fallback[id] = 1;
      }
      const grant = newField < 0 ? -newField - 1 : (changes.movements[oldGrants[id]!] ?? -1);
      if (
        grant !== -1 &&
        (newField < 0 || (!relocated && !changes.changedNodes.has(next.movements[grant]!.node)))
      ) {
        intersections.grants[id] = grant;
        intersections.redGrants[id] = oldRedGrants[id]!;
        intersections.occupancy[grant] = intersections.occupancy[grant]! + 1;
      }
    }
    rerouter.updateEdits(time(), editChecked);
    intersections.signals(time());
    return result;
  }

  return {
    patch,
    time,
    snapshot,
    inspect,
    metrics: () => accounting.metrics(time()),
    stateHash: () => stateHash(time(), vehicles, accounting.trips),
    step(n: number) {
      for (let i = 0; i < n; i++) {
        const timeS = time();
        intersections.signals(timeS);
        connectors.spawn(timeS, hasSpawnGap, releaseTrip);
        rerouter.updateEdits(timeS, editChecked);
        rerouter.update(timeS, (id) => {
          if (intersections.grants[id] !== -1) intersections.release(id);
          routeReasons[id] = 'congestion';
          planLane(id, vehicles.lane[id]!, vehicles.position[id]!);
          vehicles.stopped[id] = 0;
          vehicles.junctionWaiting[id] = 0;
        });
        proposeLaneChanges();
        resolve(timeS);
        tick++;
        commit(time());
        observedCosts.update(time());
      }
    },
  };
}

export function createEngine() {
  let run: ReturnType<typeof createRun> | undefined;
  function loaded() {
    if (!run) throw new Error('Load a scenario before using the traffic engine');
    return run;
  }
  return {
    load(input: LoadInput) {
      run = createRun(input);
    },
    patch: (compiled) => loaded().patch(compiled),
    get timeS() {
      return loaded().time();
    },
    step(n = 1) {
      loaded().step(n);
    },
    snapshot: () => loaded().snapshot(),
    metrics: () => loaded().metrics(),
    inspect: (id) => loaded().inspect(id),
    stateHash: () => loaded().stateHash(),
  } satisfies TrafficEngine;
}
