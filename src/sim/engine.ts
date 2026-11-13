import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { CConnector, CompiledCity } from '../network';
import {
  createRouteProvider,
  movementPenaltyS,
  reachableLanes,
  roadAccessFilter,
  type LinkCosts,
  type RouteProvider,
  type RouteRequest,
  type RouteResult,
} from '../routing';
import { vehicleClasses, vehiclePurposes, type SimParams, type TripRequest } from '../schema';
import { createConnectors } from './connectors';
import { stateHash } from './hash';
import { idmAcceleration } from './idm';
import { createIntersections, type IntersectionObserver } from './intersection';
import { createLaneChanges } from './lane-change';
import { createLinkCosts } from './link-costs';
import { createMerges } from './merge';
import { createAccounting } from './metrics';
import { createParking } from './parking';
import { DEFAULT_SIM_PARAMS } from './params';
import { createProjector, patchChanges, remapRoute } from './patch';
import { patchSignals } from './signals';
import { createRerouter, vehicleRouteRequest } from './reroute';
import { createWalkers } from './walkers';
import { createRailCrossings } from './rail-crossings';
import { createPersons, hasPerson } from './persons';
import type { createWalkRouter } from '../routing/walk';
import type {
  PatchResult,
  TrafficEngine,
  VehicleDetail,
  VehicleSnapshot,
  VehicleState,
} from './types';
import {
  createVehicles,
  createVehicleProfiles,
  DRIVING,
  QUEUED_ORIGIN,
  QUEUED_DESTINATION,
  PENDING,
  IN_LOT,
  OFF_LANE,
} from './vehicle';

type LoadInput = Parameters<TrafficEngine['load']>[0] & {
  routeProvider?: RouteProvider;
  linkCosts?: LinkCosts;
  intersectionObserver?: IntersectionObserver;
  headDetourObserver?: (id: number, lane: number, movement: number) => void;
  walkRouter?: ReturnType<typeof createWalkRouter>;
  debugParkingClaims?: boolean;
};
const detailStates: (VehicleState | null)[] = [
  null,
  'driving',
  'queued_destination',
  'queued_origin',
  'completed',
  'failed',
  'in_lot',
];

function createRun({
  compiled,
  trips,
  scenario,
  params: overrides,
  routeProvider,
  linkCosts,
  intersectionObserver,
  headDetourObserver,
  population,
  walkRouter,
  debugParkingClaims = false,
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
  const { dtS, idm, spawnMinGapM } = params;
  const parkingCheckSteps = Math.max(1, Math.round(1 / dtS));
  const vehicles = createVehicles(trips.length, compiled.lanes.length, compiled.movements.length);
  const profiles = createVehicleProfiles(params);
  const maxVehicleLength = Math.max(...profiles.map((p) => p.lengthM));
  const profile = (id: number) => profiles[vehicles.vclass[id]!]!;
  for (const [id, trip] of trips.entries()) {
    vehicles.vclass[id] = vehicleClasses.indexOf(trip.vehicleClass ?? 'car');
    vehicles.purpose[id] = vehiclePurposes.indexOf(
      trip.purpose ?? (trip.id.startsWith('through:') ? 'through' : 'private'),
    );
  }
  const reservationAcceleration = new Float64Array(trips.length);
  let tick = 0;
  const time = () => scenario.startS + tick * dtS;
  const parking = createParking(compiled, trips, scenario, params, vehicles);
  const accounting = createAccounting(compiled, vehicles, parking, time);
  const walkers = createWalkers(
    compiled,
    scenario,
    params,
    vehicles,
    trips.some((trip) => hasPerson(trip) || trip.mode === 'walk'),
  );
  const persons = createPersons(
    compiled,
    trips,
    scenario,
    params,
    vehicles,
    parking,
    accounting,
    walkers,
    population,
    walkRouter,
  );
  const connectors = createConnectors(
    compiled,
    trips,
    scenario,
    params,
    vehicles,
    accounting,
    parking,
    persons,
  );
  let merges = createMerges(compiled, vehicles, params);
  let intersections = createIntersections(compiled, vehicles, params, merges.canEnter, {
    onDecision: intersectionObserver,
    acceleration: (id) => reservationAcceleration[id]!,
  });
  let railCrossings = createRailCrossings(compiled, vehicles, params, scenario.startS, (m) =>
    intersections.red(m),
  );
  const hasGrant = (id: number) => intersections.grants[id] !== -1;
  let laneChanges = createLaneChanges(compiled, vehicles, params, hasGrant);
  let allowedLanes = vehicleClasses.map((name) =>
    compiled.lanes.map((lane) => lane.allowed.includes(name)),
  );
  const signalEpochs = new Map<string, number>();
  const provider =
    routeProvider ?? createRouteProvider({ laneChangeDistanceM: params.laneChangeDistanceM });
  const observedCosts = createLinkCosts(compiled, params, scenario.startS);
  const costs = linkCosts ?? observedCosts.costs;
  const headRoutes = new Map<
    number,
    { request: RouteRequest; results: Map<number, RouteResult> }
  >();
  let headRouteVersion = costs.version;
  const rerouter = createRerouter(compiled, vehicles, params, provider, costs);
  const roadEnteredS = new Float64Array(trips.length);
  const roadEnteredM = new Float64Array(trips.length);
  const routeReasons: VehicleDetail['routeReason'][] = Array(trips.length).fill('initial');
  const fallback = new Uint8Array(trips.length);
  const waitingForLane = new Uint8Array(trips.length);
  const arrival = new Int32Array(trips.length).fill(-1);
  const parkingEdit = new Uint8Array(trips.length);
  const order = new Uint32Array(trips.length);
  const acceleration = new Float64Array(trips.length);
  const limit = new Float64Array(trips.length);
  const respawning: number[] = [];
  let orderCount = 0;

  function routeFrom(id: number, lane: number, positionM: number) {
    return provider.route(
      compiled,
      costs,
      vehicleRouteRequest(vehicles, params, id, lane, positionM),
    );
  }

  function headRouteFrom(id: number, lane: number) {
    const request = vehicleRouteRequest(vehicles, params, id, lane, 0);
    let cached = headRoutes.get(id);
    if (
      !cached ||
      cached.request.toConnector !== request.toConnector ||
      cached.request.vehicleClass !== request.vehicleClass ||
      cached.request.purpose !== request.purpose ||
      cached.request.desiredSpeedFactor !== request.desiredSpeedFactor ||
      cached.request.noise !== request.noise ||
      cached.request.seed !== request.seed
    ) {
      cached = { request, results: new Map() };
      headRoutes.set(id, cached);
    }
    const previous = cached.results.get(lane);
    if (previous) return previous;
    const result = provider.route(compiled, costs, request);
    cached.results.set(lane, result);
    return result;
  }

  function chooseParkingFrom(
    id: number,
    lane: number,
    positionM: number,
    timeS: number,
    atDeparture = false,
  ) {
    const routes = new Map<number, RouteResult>();
    if (
      !parking.choose(
        id,
        timeS,
        (into) => {
          vehicles.destination[id] = into;
          const result = routeFrom(id, lane, positionM);
          if (!result.ok) return false;
          routes.set(into, result);
          return result.route.costS;
        },
        atDeparture,
      )
    )
      return undefined;
    return routes.get(vehicles.destination[id]!)!;
  }

  function chooseParkingRoute(
    id: number,
    lane: number,
    positionM: number,
    timeS: number,
    keepCurrent = false,
  ) {
    const previousDestination = vehicles.destination[id]!;
    const result = chooseParkingFrom(id, lane, positionM, timeS);
    if (!result?.ok) return false;
    if (keepCurrent && vehicles.destination[id] === previousDestination) return true;
    vehicles.route[id] = result.route;
    vehicles.routeStep[id] = 0;
    routeReasons[id] = 'parking';
    parkingEdit[id] = 0;
    return true;
  }

  function resumeParkingRoute(id: number, connector: CConnector, timeS: number) {
    const destination = compiled.connectors[vehicles.destination[id]!];
    if (
      parkingEdit[id] ||
      !destination ||
      (parking.required(id) && destination.parking === undefined)
    )
      return chooseParkingRoute(id, connector.lane, connector.positionM, timeS);
    const result = routeFrom(id, connector.lane, connector.positionM);
    if (!result.ok)
      return (
        parking.required(id) && chooseParkingRoute(id, connector.lane, connector.positionM, timeS)
      );
    vehicles.route[id] = result.route;
    vehicles.routeStep[id] = 0;
    return true;
  }

  function leaveRoad(id: number, timeS: number, positionM: number) {
    observedCosts.record(
      compiled.lanes[vehicles.lane[id]!]!.road,
      timeS - roadEnteredS[id]!,
      positionM - roadEnteredM[id]!,
    );
  }

  function planLane(id: number, lane: number, positionM: number) {
    headRoutes.delete(id);
    vehicles.headDetourS[id] = 0;
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
    } else if (planned?.fromLane === lane && allowedLanes[vehicles.vclass[id]!]![planned.toLane]) {
      vehicles.movement[id] = planned.idx;
    } else {
      const permits = roadAccessFilter(
        compiled,
        vehicleRouteRequest(vehicles, params, id, lane, positionM),
      );
      let penalty = Infinity;
      let routePenalty = Infinity;
      let alternate = -1;
      for (const idx of compiled.lanes[lane]!.out) {
        const movement = compiled.movements[idx]!;
        if (
          movement.neverGreen ||
          !allowedLanes[vehicles.vclass[id]!]![movement.toLane] ||
          !permits(compiled.lanes[movement.toLane]!.road)
        )
          continue;
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
        // Lead (TASK-131 merge): an inner road of a junction group can be shorter than 10 m; a
        // negative cutoff found no lane at all and sent a car already in its target lane to the
        // fallback, which stranded it when the new route looped back (Munich r:663 > r:275).
        const cutoff = finalRoad
          ? destination.positionM
          : Math.max(0, compiled.roads[next.road]!.lengthM - 10);
        for (const candidate of reachableLanes(
          compiled,
          allowedLanes[vehicles.vclass[id]!]!,
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
      // TASK-076: a car that gave its held change up takes the fallback and reroutes.
      if (alternate !== -1 && !laneChanges.gaveUp[id]) vehicles.movement[id] = alternate;
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

  function hasSpawnGap(connector: CConnector, vehicle: number) {
    const { lane, positionM } = connector;
    if (railCrossings && !railCrossings.canSpawn(lane, positionM, profile(vehicle).lengthM))
      return false;
    const gap = Math.max(spawnMinGapM, idm.minGapM);
    const spacing = profile(vehicle).lengthM + gap;
    const maxSpacing = maxVehicleLength + gap;
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
      id !== -1 && vehicles.position[id]! <= positionM + maxSpacing;
      id = vehicles.previous[id]!
    ) {
      const required = vehicles.position[id]! >= positionM ? profile(id).lengthM + gap : spacing;
      if (Math.abs(vehicles.position[id]! - positionM) < required) return false;
    }
    const source = compiled.lanes[lane]!;
    if (parking.leavingSpace(vehicle)) {
      if (!parking.departureRoom(vehicle)) return false;
      for (let id = vehicles.last(lane); id !== -1; id = vehicles.previous[id]!) {
        if (vehicles.position[id]! >= positionM) break;
        const gapM = positionM - profile(vehicle).lengthM - vehicles.position[id]!;
        const follower = profile(id);
        const insertion = idmAcceleration(
          follower.idm,
          vehicles.speed[id]!,
          Math.min(source.speedLimitMps * vehicles.speedFactor[id]!, follower.maxSpeedMps),
          0,
          gapM - vehicles.speed[id]! * dtS,
        );
        if (insertion < -params.mobil.safeDecelMps2) return false;
      }
    }
    if (source.lengthM - positionM < maxSpacing) {
      for (const idx of source.out) {
        const id = vehicles.last(-idx - 1);
        if (
          id !== -1 &&
          source.lengthM - positionM + vehicles.position[id]! < profile(id).lengthM + gap
        )
          return false;
      }
    }
    return true;
  }

  function releaseTrip(id: number, connector: CConnector, timeS: number) {
    const { lane, positionM } = connector;
    const result = parking.required(id)
      ? chooseParkingFrom(id, lane, positionM, timeS, true)
      : routeFrom(id, lane, positionM);
    if (!result?.ok) return false;
    vehicles.route[id] = result.route;
    vehicles.routeStep[id] = 0;
    if (vehicles.respawns[id]) {
      // A respawned trip keeps its first departure, free-flow time and reroute schedule.
      routeReasons[id] = 'respawn';
    } else {
      vehicles.freeFlow[id] = freeFlow(id, connector);
      vehicles.departed[id] = timeS;
      rerouter.start(id, timeS);
    }
    roadEnteredS[id] = timeS;
    roadEnteredM[id] = positionM;
    planLane(id, lane, positionM);
    if (parking.startsInLot(id)) {
      vehicles.lane[id] = OFF_LANE;
      vehicles.position[id] = 0;
      vehicles.speed[id] = 0;
      accounting.transition(id, IN_LOT);
    } else {
      vehicles.insert(id, lane, positionM);
      accounting.transition(id, DRIVING);
    }
    persons.departed(id, timeS);
    return true;
  }

  function proposeLaneChanges() {
    const { occupied } = vehicles;
    laneChanges.startProposals();
    for (let i = 0; i < occupied.length && occupied[i]! < compiled.lanes.length; i++) {
      const lane = compiled.lanes[occupied[i]!]!;
      if (lane.left === -1 && lane.right === -1) continue;
      for (let id = vehicles.first(lane.idx); id !== -1; id = vehicles.next[id]!) {
        if (vehicles.state[id] !== DRIVING || parking.motion(id)) continue;
        const discretionary =
          intersections.grants[id] === -1 &&
          lane.stopM - vehicles.position[id]! > params.intersection.decisionDistanceM;
        if (!laneChanges.propose(id, lane, tick, discretionary)) continue;
        // Gave the change up: take the TASK-048 fallback from this lane, if there is one.
        planLane(id, lane.idx, vehicles.position[id]!);
        if (!fallback[id]) laneChanges.gaveUp[id] = 0;
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
        if (ahead !== -1 || !lane) vehicles.headDetourS[id] = 0;
        if (parking.motion(id)) {
          ahead = id;
          continue;
        }
        if (vehicles.state[id] === QUEUED_DESTINATION) {
          ahead = id;
          continue;
        }
        const position = vehicles.position[id]!;
        // A safe parking target can fill while the car is en route. Reconsider from here
        // once a second, before a one-way approach commits it to cruising past the target.
        if (
          lane &&
          (tick + id) % parkingCheckSteps === 0 &&
          intersections.grants[id] === -1 &&
          parking.needsChoice(id)
        ) {
          const previousDestination = vehicles.destination[id]!;
          if (chooseParkingRoute(id, lane.idx, position, timeS, true)) {
            if (vehicles.destination[id] !== previousDestination) planLane(id, lane.idx, position);
          } else vehicles.destination[id] = previousDestination;
        }
        if (lane) parking.approach(id, lane.idx, position, timeS);
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
              (leader === -1 ||
                vehicles.position[occupant]! - profile(occupant).lengthM <
                  vehicles.position[leader]! - profile(leader).lengthM)
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
          leader === -1 ? Infinity : offset + vehicles.position[leader]! - profile(leader).lengthM;
        limit[id] = Math.max(position, rear - idm.minGapM);
        let obstacle = rear;
        let leaderSpeed = leader === -1 ? 0 : vehicles.speed[leader]!;
        let stopAt = Infinity;
        if (
          lane &&
          destination &&
          (parking.needsManoeuvre(destination.idx) || !connectors.canArrive(destination, timeS, id))
        ) {
          // Put the virtual bumper beyond the portal so standstill occurs at the portal.
          stopAt = destination.positionM + idm.minGapM;
        } else if (
          lane &&
          ((movement && !granted) || laneChanges.holding[id] || waitingForLane[id])
        ) {
          stopAt = lane.stopM;
        }
        if (path) stopAt = intersections.zoneStop(path, position) + idm.minGapM;
        // A driver turning into this same mouth leaves the committed departure its
        // insertion gap. Ordinary through traffic keeps its normal priority.
        const parkingStop = parking.arrivalStop(id);
        if (parkingStop) {
          const at =
            lane?.idx === parkingStop.lane
              ? parkingStop.positionM
              : path?.toLane === parkingStop.lane
                ? path.lengthM + parkingStop.positionM
                : movement?.toLane === parkingStop.lane && lane
                  ? lane.lengthM + movement.lengthM + parkingStop.positionM
                  : Infinity;
          stopAt = Math.min(stopAt, at + idm.minGapM);
        }
        if (stopAt < obstacle) {
          obstacle = stopAt;
          leaderSpeed = 0;
        }
        // TASK-111: a held crossing's near edge is a standing obstacle, clamped like a stop line.
        const walkerStop = walkers?.blocking ? walkers.hold(id, lane, path) : Infinity;
        if (walkerStop < Infinity) {
          if (walkerStop < obstacle) {
            obstacle = walkerStop;
            leaderSpeed = 0;
          }
          limit[id] = Math.min(limit[id]!, Math.max(position, walkerStop - idm.minGapM));
        }
        const railStop = railCrossings?.hold(id) ?? Infinity;
        railCrossings?.binding(id, railStop + idm.minGapM <= obstacle + 1e-6);
        if (railStop < Infinity) {
          if (railStop + idm.minGapM < obstacle) {
            obstacle = railStop + idm.minGapM;
            leaderSpeed = 0;
          }
          limit[id] = Math.min(limit[id]!, Math.max(position, railStop));
        }
        const driving = profile(id);
        const desiredSpeed = Math.min(speedLimit * vehicles.speedFactor[id]!, driving.maxSpeedMps);
        walkers?.account(
          id,
          walkerStop < Infinity && walkerStop <= obstacle,
          vehicles.speed[id]!,
          desiredSpeed,
          walkerStop - position,
        );
        const followingAcceleration = idmAcceleration(
          driving.idm,
          vehicles.speed[id]!,
          desiredSpeed,
          leaderSpeed,
          obstacle - position,
        );
        acceleration[id] = followingAcceleration;
        const requester = lane ? laneChanges.yieldingTo[id]! : -1;
        if (requester !== -1) {
          // TASK-076: the requester's projected rear is a standing leader, braked for at no
          // more than bMps2 (the yielder was picked only if that suffices).
          const virtualRear = vehicles.position[requester]! - profile(requester).lengthM;
          limit[id] = Math.min(limit[id]!, Math.max(position, virtualRear - idm.minGapM));
          acceleration[id] = Math.min(
            acceleration[id]!,
            Math.max(
              -driving.idm.bMps2,
              idmAcceleration(
                driving.idm,
                vehicles.speed[id]!,
                desiredSpeed,
                0,
                virtualRear - position,
              ),
            ),
          );
        }
        // A grant removes the virtual stop line on the next step. Predict its motion
        // from physical following, including for grants awarded later in this resolve.
        // Evaluate at the capped speed: free-flow braking toward a lower limit is not a stop.
        const reservationLeader =
            lane && !granted ? (leader === -1 ? 0 : vehicles.speed[leader]!) : leaderSpeed,
          reservationRear = lane && !granted ? rear : obstacle;
        reservationAcceleration[id] =
          vehicles.speed[id]! <= desiredSpeed &&
          reservationLeader === leaderSpeed &&
          reservationRear === obstacle
            ? followingAcceleration
            : idmAcceleration(
                driving.idm,
                Math.min(vehicles.speed[id]!, desiredSpeed),
                desiredSpeed,
                reservationLeader,
                reservationRear - position,
              );
        if (movement?.turn === 'merge' && lane && !granted && stopAt < rear) {
          acceleration[id] = Math.min(
            merges.stopAcceleration(id, movement),
            idmAcceleration(
              driving.idm,
              vehicles.speed[id]!,
              desiredSpeed,
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
          (speed * speed) / (2 * driving.idm.bMps2) + idm.minGapM,
        );
        if (
          lane &&
          movement &&
          !laneChanges.holding[id] &&
          requester === -1 &&
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

  function detourHeads() {
    // Retain only this cost epoch's suffixes; physical eligibility below is never cached.
    if (headRouteVersion !== costs.version) {
      headRoutes.clear();
      headRouteVersion = costs.version;
    }
    for (const segment of vehicles.occupied) {
      const lane = compiled.lanes[segment];
      if (!lane) break;
      const id = vehicles.first(segment);
      const planned = compiled.movements[vehicles.movement[id]!];
      if (
        vehicles.state[id] !== DRIVING ||
        !planned ||
        vehicles.speed[id]! >= 0.1 ||
        lane.stopM - vehicles.position[id]! > params.intersection.decisionDistanceM ||
        laneChanges.holding[id] ||
        !intersections.blockedExit(id, planned)
      ) {
        vehicles.headDetourS[id] = 0;
        continue;
      }
      if (intersections.red(planned.idx)) continue;
      vehicles.headDetourS[id] = vehicles.headDetourS[id]! + dtS;
      if (vehicles.headDetourS[id]! + 1e-9 < params.headDetourS) continue;
      if (lane.out.length < 2) continue;
      const permits = roadAccessFilter(
        compiled,
        vehicleRouteRequest(vehicles, params, id, lane.idx, vehicles.position[id]!),
      );
      let best = -1;
      let cost = Infinity;
      for (const idx of lane.out) {
        const movement = compiled.movements[idx]!;
        const tail = vehicles.last(movement.toLane);
        if (
          idx === planned.idx ||
          movement.neverGreen ||
          vehicles.attemptedFallbacks[id]?.has(idx) ||
          !allowedLanes[vehicles.vclass[id]!]![movement.toLane] ||
          !permits(compiled.lanes[movement.toLane]!.road) ||
          (tail !== -1 && vehicles.position[tail]! < profile(id).lengthM + idm.minGapM) ||
          intersections.blockedExit(id, movement)
        )
          continue;
        const result = headRouteFrom(id, movement.toLane);
        if (
          result.ok &&
          (result.route.costS < cost || (result.route.costS === cost && idx < best))
        ) {
          best = idx;
          cost = result.route.costS;
        }
      }
      if (best === -1) continue;
      if (hasGrant(id)) intersections.release(id);
      vehicles.movement[id] = best;
      fallback[id] = 2;
      vehicles.headDetourS[id] = 0;
    }
  }

  function reachDestination(id: number, connector: CConnector, timeS: number) {
    vehicles.position[id] = connector.positionM;
    vehicles.speed[id] = 0;
    if (
      connector.parking !== undefined &&
      (parking.full(connector.idx, id) || !parking.admits(id, connector.idx))
    ) {
      parking.reject(id, timeS);
      const lane = vehicles.lane[id]!;
      const result = chooseParkingFrom(id, lane, connector.positionM, timeS);
      if (!result?.ok) {
        leaveRoad(id, timeS, connector.positionM);
        vehicles.remove(id);
        accounting.fail(id, 'no_parking');
        return;
      }
      vehicles.route[id] = result.route;
      vehicles.routeStep[id] = 0;
      routeReasons[id] = 'parking';
      if (vehicles.state[id] === QUEUED_DESTINATION) accounting.transition(id, DRIVING);
      planLane(id, lane, connector.positionM);
      return;
    }
    if (parking.needsManoeuvre(connector.idx)) {
      if (
        connectors.canArrive(connector, timeS, id) &&
        parking.startArrival(id, connector.idx, timeS)
      ) {
        if (!connectors.arrive(connector, timeS, id))
          throw new Error('Parking entry admission changed within a step');
        if (parking.lotArrival(connector.idx)) {
          leaveRoad(id, timeS, connector.positionM);
          vehicles.remove(id);
          intersections.release(id);
          laneChanges.leaveLane(id);
          vehicles.lane[id] = OFF_LANE;
          vehicles.position[id] = 0;
          accounting.transition(id, IN_LOT);
        } else accounting.transition(id, QUEUED_DESTINATION);
      } else {
        if (vehicles.state[id] !== QUEUED_DESTINATION)
          accounting.transition(id, QUEUED_DESTINATION);
        vehicles.waiting[id] = vehicles.waiting[id]! + dtS;
      }
      return;
    }
    if (connectors.arrive(connector, timeS, id)) {
      parking.arrive(id, connector.idx, timeS);
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
    if (parkingEdit[id]) {
      if (!chooseParkingRoute(id, lane, 0, timeS)) {
        vehicles.lane[id] = lane;
        vehicles.position[id] = 0;
        accounting.fail(id, 'no_parking');
        return;
      }
    } else if (fallback[id]) {
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
      if (parking.motion(id)) continue;
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
              path.lengthM + vehicles.position[exitTail]! - profile(exitTail).lengthM - idm.minGapM,
            ),
          );
        // Earlier commits may have entered a zone that was empty during proposals.
        const zoneStart = intersections.zoneStop(path, previousPosition);
        if (position > zoneStart) {
          position = Math.max(previousPosition, zoneStart);
          accounting.zoneStop();
        }
        vehicles.speed[id] = (position - previousPosition) / dtS;
        if (position >= path.lengthM && !railCrossings?.blocksExit(id, path.lengthM))
          enterLane(id, path.toLane, position - path.lengthM, timeS);
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
                profile(exitTail).lengthM -
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
      } else if (position >= lane.lengthM && !railCrossings?.blocksExit(id, lane.lengthM)) {
        if (granted !== -1) {
          if (fallback[id]) {
            if (fallback[id] === 2) headDetourObserver?.(id, lane.idx, granted);
            vehicles.missedTurn[id] = 1;
            routeReasons[id] = 'missed_turn';
            (vehicles.attemptedFallbacks[id] ??= new Set()).add(granted);
          }
          const zoneStart = intersections.zoneStop(compiled.movements[granted]!, 0);
          // The overflow into the movement, computed once (B40): re-deriving it from
          // `lane.lengthM + zoneStart` can round past `zoneStart`, and a car held a hair past
          // a zone's start is no longer held by it on the next step.
          let entry = position - lane.lengthM;
          if (entry > zoneStart) {
            entry = Math.max(0, zoneStart);
            position = lane.lengthM + entry;
            vehicles.speed[id] = (position - previousPosition) / dtS;
            accounting.zoneStop();
          }
          leaveRoad(id, timeS, lane.lengthM);
          vehicles.remove(id);
          laneChanges.leaveLane(id);
          vehicles.insert(id, -granted - 1, Math.min(entry, compiled.movements[granted]!.lengthM));
          // A through node's movement has no length (TASK-061): carry the overflow into the
          // next lane in the same step, so a split road drives like one road.
          if (compiled.movements[granted]!.lengthM === 0)
            enterLane(id, compiled.movements[granted]!.toLane, entry, timeS);
        } else if (movement === -1) {
          vehicles.remove(id);
          vehicles.position[id] = lane.lengthM;
          vehicles.speed[id] = 0;
          accounting.fail(id, 'stranded');
        }
      }
    }
  }

  /**
   * TASK-077: jam heads (on a movement, or first on their lane) standing still for `respawnS`
   * leave the road in id order; the trip starts again. A red for the car's own movement neither
   * starts nor stops the timer: a car arriving at red waits without one, a head that stood
   * through green with its exit full keeps counting through the red after it.
   */
  function recoverGridlock(timeS: number) {
    const { respawnS, maxRespawns } = params.gridlock;
    respawning.length = 0;
    for (let i = 0; i < orderCount; i++) {
      const id = order[i]!;
      if (vehicles.state[id] !== DRIVING) continue;
      const field = vehicles.lane[id]!;
      if (railCrossings?.held(id)) {
        vehicles.jamS[id] = 0;
        continue;
      }
      if ((field >= 0 && vehicles.first(field) !== id) || vehicles.speed[id]! >= 0.1) {
        vehicles.jamS[id] = 0;
        continue;
      }
      if (field >= 0 && vehicles.jamS[id] === 0 && intersections.red(vehicles.movement[id]!))
        continue;
      vehicles.jamS[id] = vehicles.jamS[id]! + dtS;
      if (vehicles.jamS[id]! >= respawnS - 1e-9) respawning.push(id);
    }
    respawning.sort((a, b) => a - b);
    for (const id of respawning) {
      if (intersections.grants[id] !== -1) intersections.release(id);
      intersections.exitedFrom[id] = -1;
      if (vehicles.lane[id]! >= 0) leaveRoad(id, timeS, vehicles.position[id]!);
      vehicles.remove(id);
      laneChanges.leaveLane(id);
      laneChanges.holding[id] = 0;
      vehicles.speed[id] = 0;
      vehicles.jamS[id] = 0;
      vehicles.headDetourS[id] = 0;
      vehicles.stopped[id] = 0;
      vehicles.junctionWaiting[id] = 0;
      if (vehicles.respawns[id]! >= maxRespawns) {
        accounting.fail(id, 'gridlocked');
        continue;
      }
      vehicles.lane[id] = -1;
      vehicles.position[id] = 0;
      vehicles.route[id] = null;
      vehicles.attemptedFallbacks[id] = undefined;
      accounting.respawn(id);
      connectors.requeue(id, timeS);
    }
  }

  function snapshot(): VehicleSnapshot {
    const { respawnS, fadeS } = params.gridlock;
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
      vclass: new Uint8Array(count),
      parkingOccupancy: parking.snapshot(),
      parkingClaims: parking.claimSnapshot(),
      parkedCars: parking.stockSnapshot(),
      fade: new Float32Array(count),
      poseLane: new Int32Array(count).fill(-1),
      ...(walkers && { walkers: walkers.snapshot() }),
      ...(railCrossings && { rail: railCrossings.snapshot() }),
    };
    let i = 0;
    for (let id = 0; id < vehicles.count; id++) {
      const state = vehicles.state[id]!;
      if (state !== DRIVING && state !== QUEUED_DESTINATION && state !== IN_LOT) continue;
      const field = vehicles.lane[id]!;
      const motion = parking.motion(id);
      const segment = motion
        ? null
        : field < 0
          ? compiled.movements[-field - 1]!
          : compiled.lanes[field]!;
      const position = vehicles.position[id]!;
      const point =
        motion?.pose ?? pointAtDistance(segment!.polyline, segment!.cumulative, position);
      snapshot.id[i] = id + 1;
      snapshot.x[i] = point.x;
      snapshot.y[i] = point.y;
      snapshot.heading[i] =
        motion?.pose.heading ?? headingAtDistance(segment!.polyline, segment!.cumulative, position);
      snapshot.speed[i] = motion?.speed ?? vehicles.speed[id]!;
      snapshot.lateralM[i] = motion ? 0 : laneChanges.lateralM(id, tick);
      snapshot.poseLane![i] = motion?.lane ?? -1;
      snapshot.lane[i] = field;
      snapshot.state[i] = state;
      snapshot.vclass[i] = vehicles.vclass[id]!;
      snapshot.fade[i] = fadeS > 0 ? Math.min(1, (respawnS - vehicles.jamS[id]!) / fadeS) : 1;
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
      ...parking.detail(id, time()),
      id: vehicleId,
      tripId: trip.id,
      personId: persons.occupant(id),
      vehicleClass: vehicleClasses[vehicles.vclass[id]!]!,
      purpose: vehiclePurposes[vehicles.purpose[id]!]!,
      originPlace: trip.originPlaceId,
      destinationPlace: trip.destinationPlaceId,
      state: detailStates[state]!,
      lane: vehicles.lane[id]!,
      positionM: vehicles.position[id]!,
      speedMps: parking.motion(id)?.speed ?? vehicles.speed[id]!,
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
      respawns: vehicles.respawns[id]!,
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
    headRoutes.clear();
    parking.patch(next);
    vehicles.headDetourS.fill(0);
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
    const signalled = patchSignals(before, next, time(), signalEpochs);
    persons.patch(signalled);
    walkers?.patch(signalled, time());
    intersections = createIntersections(signalled, vehicles, params, merges.canEnter, {
      onDecision: intersectionObserver,
      acceleration: (id) => reservationAcceleration[id]!,
    });
    laneChanges = createLaneChanges(next, vehicles, params, hasGrant);
    allowedLanes = vehicleClasses.map((name) =>
      next.lanes.map((lane) => lane.allowed.includes(name)),
    );

    for (let id = 0; id < vehicles.count; id++) {
      intersections.exitedFrom[id] = changes.movements[oldExits[id]!] ?? -1;
      const oldDestination = before.connectors[vehicles.destination[id]!];
      const mappedDestination = oldDestination ? changes.connectors[oldDestination.idx] : undefined;
      const lostParking =
        parking.required(id) &&
        (parkingEdit[id] !== 0 ||
          (oldDestination?.parking !== undefined &&
            (mappedDestination === undefined || mappedDestination === -1)));
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
      const motion = parking.motion(id);
      if (motion) {
        if (lostParking) {
          parkingEdit[id] = 1;
          parking.beginSearch(id, time());
        }
        if (motion.laneHeld) vehicles.insert(id, motion.lane, vehicles.position[id]!);
        else vehicles.lane[id] = OFF_LANE;
        continue;
      }
      if (vehicles.state[id] !== DRIVING && vehicles.state[id] !== QUEUED_DESTINATION) continue;
      const field = vehicles.lane[id]!;
      const source = field >= 0 ? before.lanes[field]! : before.movements[-field - 1]!;
      const mapped = field >= 0 ? changes.lanes[field]! : changes.movements[-field - 1]!;
      const segment = field >= 0 ? next.lanes[mapped] : next.movements[mapped];
      let relocated = false;
      let newField = field >= 0 ? mapped : -mapped - 1;
      let position = vehicles.position[id]!;
      if (!segment || position > segment.lengthM + 1e-9) {
        const projection = project(source, position, vehicleClasses[vehicles.vclass[id]!]!);
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
      if (lostParking) {
        parking.beginSearch(id, time());
        if (newField < 0) parkingEdit[id] = 1;
        else if (!chooseParkingRoute(id, newField, position, time())) {
          vehicles.remove(id);
          vehicles.speed[id] = 0;
          accounting.fail(id, 'no_parking');
          continue;
        }
      }
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
      const permitted = allowedLanes[vehicles.vclass[id]!]!;
      const forbiddenMovement = (idx: number) =>
        idx !== -1 && !permitted[next.movements[idx]!.toLane];
      const accessChanged = route!.roads.slice(step).some((i) => changes.accessChangedRoads.has(i));
      const invalid =
        relocated ||
        accessChanged ||
        mappedRoute.roads.slice(step).includes(-1) ||
        mappedRoute.movements
          .slice(step)
          .some((i) => i === -1 || next.movements[i]!.neverGreen || forbiddenMovement(i)) ||
        mappedRoute.targetLanes.slice(step).some((lanes) => lanes.every((i) => !permitted[i])) ||
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
          accessChanged ||
          relocated ||
          mappedRoute.roads[step] === -1 ||
          mappedRoute.movements[step] === -1 ||
          next.movements[mappedRoute.movements[step] ?? -1]?.neverGreen ||
          forbiddenMovement(mappedRoute.movements[step] ?? -1) ||
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
    railCrossings = createRailCrossings(
      compiled,
      vehicles,
      params,
      time(),
      (m) => intersections.red(m),
      railCrossings?.clocks(),
      railCrossings?.roadState(changes),
    );
    return result;
  }

  return {
    patch,
    time,
    snapshot,
    inspect,
    metrics: () => {
      // Assign rather than spread: `tripOutcomes` stays a lazy getter.
      const metrics = accounting.metrics(time());
      if (walkers) metrics.walkers = walkers.metrics();
      if (persons.enabled) metrics.persons = persons.metrics();
      return metrics;
    },
    inspectWalker: (id: number) => walkers?.inspect(id) ?? null,
    inspectPerson: (id: string) => persons.inspect(id),
    stateHash: () =>
      stateHash(
        time(),
        vehicles,
        accounting.trips,
        parking.stateHash(),
        walkers ?? undefined,
        persons,
      ),
    step(n: number) {
      for (let i = 0; i < n; i++) {
        const timeS = time();
        intersections.signals(timeS);
        railCrossings?.step(timeS);
        persons.step(timeS);
        walkers?.step(timeS);
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
        detourHeads();
        tick++;
        commit(time());
        parking.advance(time(), {
          clearLane(id) {
            if (vehicles.lane[id] !== OFF_LANE) {
              leaveRoad(id, time(), vehicles.position[id]!);
              vehicles.remove(id);
              intersections.release(id);
              laneChanges.leaveLane(id);
              vehicles.lane[id] = OFF_LANE;
            }
          },
          park(id, connector) {
            const c = compiled.connectors[connector]!;
            vehicles.lane[id] = c.lane;
            vehicles.position[id] = c.positionM;
            vehicles.speed[id] = 0;
            accounting.complete(id, time());
          },
          exit(id, connector, joinM) {
            // TASK-150: granted from the hold, with the gap checked where the merge joins the
            // lane. The car stands there at speed 0, a lane occupant, while its body merges. Its
            // route starts at the connector, and a destination between the two (its own lot,
            // entered again) is where it joins instead: it has no way back from past it.
            const c = compiled.connectors[connector]!;
            if (!hasSpawnGap({ ...c, positionM: joinM }, id) || !connectors.releaseLot(c, time()))
              return false;
            if (!resumeParkingRoute(id, c, time())) {
              vehicles.lane[id] = c.lane;
              vehicles.position[id] = c.positionM;
              accounting.fail(id, 'no_parking');
              return true;
            }
            const destination = compiled.connectors[vehicles.destination[id]!];
            const positionM =
              destination?.lane === c.lane &&
              destination.positionM >= c.positionM &&
              destination.positionM < joinM
                ? destination.positionM
                : joinM;
            vehicles.insert(id, c.lane, positionM);
            vehicles.speed[id] = 0;
            vehicles.jamS[id] = 0;
            accounting.transition(id, DRIVING);
            roadEnteredS[id] = time();
            roadEnteredM[id] = positionM;
            planLane(id, c.lane, positionM);
            return true;
          },
          resume(id, connector) {
            const c = compiled.connectors[connector]!;
            if (resumeParkingRoute(id, c, time())) planLane(id, c.lane, c.positionM);
            else {
              vehicles.remove(id);
              vehicles.speed[id] = 0;
              accounting.fail(id, 'no_parking');
            }
          },
        });
        recoverGridlock(time());
        if (debugParkingClaims) parking.assertClaims();
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
    inspectWalker: (id) => loaded().inspectWalker(id),
    inspectPerson: (id) => loaded().inspectPerson(id),
    stateHash: () => loaded().stateHash(),
  } satisfies TrafficEngine;
}
