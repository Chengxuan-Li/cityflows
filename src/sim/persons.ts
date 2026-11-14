import Flatbush from 'flatbush';
import { distance, nearestOnPolyline, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import {
  chooseTour,
  modeTours,
  transitTrip,
  transitWeights,
  walkTrip,
  type ModeInputs,
} from '../demand/mode-choice';
import { riderDoor, riderDraw, riderOf } from '../demand/stations';
import type { CompiledCity } from '../network';
import { stationArrivals, trainTimetable } from '../network/trains';
import type { LinkCosts, RouteProvider } from '../routing';
import { transitNetwork, type TransitNetwork, type TransitPlan } from '../routing/transit';
import { createWalkRouter, type WalkPosition, type WalkResult } from '../routing/walk';
import type { Person, PlaceId, Scenario, SimParams, TripRequest } from '../schema';
import type { createAccounting } from './metrics';
import type { createParking } from './parking';
import type { Transit } from './transit';
import type { FailReason } from './types';
import { COMPLETED, FAILED, type Vehicles } from './vehicle';
import type { Walkers } from './walkers';

type State = 'pending' | 'active' | 'completed' | 'failed';
export interface PersonLegDetail {
  /** TASK-174: a transit trip walks, waits at a stop and rides, once per vehicle taken. */
  kind: 'access' | 'drive' | 'egress' | 'walk' | 'wait' | 'ride';
  state: State;
  startedS: number | null;
  arrivedS: number | null;
  distanceM: number;
  walkerId: number | null;
  /** TASK-174: where a wait or ride starts and a ride ends, the line, and the vehicle's id. */
  stop?: string;
  toStop?: string;
  line?: string;
  vehicle?: string;
}
export interface PersonTripDetail {
  tripId: string;
  originPlaceId: PlaceId;
  destinationPlaceId: PlaceId;
  departS: number;
  state: State;
  failReason: FailReason | null;
  legs: PersonLegDetail[];
}
export interface PersonDetail {
  id: string;
  homePlaceId: PlaceId;
  workPlaceId: PlaceId | null;
  agenda: Person['agenda'];
  state: State;
  currentLeg: PersonLegDetail | null;
  car: { facility: string | null; space: number | null };
  /** TASK-129: null for persons outside the population (riders, visitors). */
  household: { id: string; members: string[] } | null;
  /** The household car the person drives today, and its owner when borrowed. */
  carId: string | null;
  carOwner: string | null;
  trips: PersonTripDetail[];
}
export interface PersonMetrics {
  started: number;
  completed: number;
  failed: number;
  walkTripsCompleted: number;
  walkTripsFailed: number;
  access: { count: number; meanTimeS: number; meanDistanceM: number };
  egress: { count: number; meanTimeS: number; meanDistanceM: number };
  walkFallbacks: number;
  /** TASK-129: trips that waited for a household car another member had not brought back. */
  carWaits: { count: number; medianS: number; maxS: number };
  /** TASK-113: person trips by mode when they started, in total and by hour of departure, and
   * those completed (station riders excluded). A completed car trip is `drive` when the car parked at its destination's
   * own facility (or the destination is a gateway), `driveWalk` when it parked elsewhere. */
  modes: {
    started: { walk: number; car: number; transit: number };
    byHour: { walk: number[]; car: number[]; transit: number[] };
    completed: { walk: number; drive: number; driveWalk: number; transit: number };
  };
  fallbacks: {
    leg: 'access' | 'egress';
    placeId: PlaceId;
    facilityId: string | null;
    reason: string;
    count: number;
  }[];
}

export const hasPerson = (trip: TripRequest) =>
  trip.personId !== null &&
  (trip.purpose ?? 'private') === 'private' &&
  (trip.vehicleClass ?? 'car') === 'car';

/** Straight line to walk graph for the parking walks the mode choice estimates. */
const PARKING_WALK_DETOUR = 1.3;
/** Expected search for a space when the destination has no parking of its own with room. */
const PUBLIC_PARKING_SEARCH_S = 120;
/** TASK-173: the expected search when every facility the estimate considers is full at departure:
 * an assumption, twice the public search, for cruising until a space frees. */
const FULL_PARKING_SEARCH_S = 2 * PUBLIC_PARKING_SEARCH_S;
/** A drive with no route: straight line times this detour at this speed. */
const DRIVE_DETOUR = 1.3;
const DRIVE_FALLBACK_MPS = 30 / 3.6;

/** Person journeys own walk legs; parking still owns the car and all parking decisions. */
export function createPersons(
  initial: CompiledCity,
  trips: TripRequest[],
  scenario: Scenario,
  params: SimParams,
  vehicles: Vehicles,
  parking: ReturnType<typeof createParking>,
  accounting: ReturnType<typeof createAccounting>,
  walkers: Walkers | null,
  population: Person[] = [],
  injectedRouter?: ReturnType<typeof createWalkRouter>,
  /** TASK-173: the drive of the mode choice at each tour's departure, on the run's link costs. */
  drive?: { provider: RouteProvider; costs: LinkCosts },
  /** TASK-174: riders on platforms and in vehicles; null without a timetabled stop. */
  transit: Transit | null = null,
) {
  let city = initial;
  const localWalk = (trip: TripRequest) =>
    trip.mode === 'walk' &&
    [trip.originPlaceId, trip.destinationPlaceId].every(
      (id) => city.places[city.index.place.get(id)!]?.kind !== 'gateway',
    );
  const managed = trips.map((trip) => localWalk(trip) || (trip.mode === 'car' && hasPerson(trip)));
  const records: (PersonTripDetail | null)[] = trips.map((trip, id) =>
    managed[id]
      ? {
          tripId: trip.id,
          originPlaceId: trip.originPlaceId,
          destinationPlaceId: trip.destinationPlaceId,
          departS: trip.departS,
          state: 'pending',
          failReason: null,
          legs: [],
        }
      : null,
  );
  const ids = records
    .flatMap((record, id) => (record ? [id] : []))
    .sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
  const byPerson = new Map<string, number[]>();
  const previous = new Int32Array(trips.length).fill(-1);
  for (const id of ids) {
    const key = trips[id]!.personId ?? trips[id]!.id;
    const chain = byPerson.get(key) ?? [];
    const before = chain.at(-1);
    if (before !== undefined && trips[before]!.destinationPlaceId === trips[id]!.originPlaceId)
      previous[id] = before;
    chain.push(id);
    byPerson.set(key, chain);
    if (trips[id]!.mode === 'walk') accounting.excludeWalk(id);
  }
  const populationById = new Map(population.map((person) => [person.id, person]));
  const households = new Map<string, Person[]>();
  for (const person of population) {
    const members = households.get(person.householdId);
    if (members) members.push(person);
    else households.set(person.householdId, [person]);
  }
  // Person index order, as demand numbers the household's cars (src/demand/households.ts).
  const index = (person: Person) => Number(person.id.slice(person.id.lastIndexOf(':') + 1));
  for (const members of households.values())
    members.sort((a, b) => index(a) - index(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ready = new Uint8Array(trips.length);
  const waiting = new Map<number, number[]>();
  /** TASK-129: trips waiting for their household car, keyed by the car's previous trip (another
   * member's), and when each began to wait. */
  const carWaiting = new Map<number, number[]>();
  const carWaitSince = new Map<number, number>();
  const carWaits: number[] = [];
  const modes: PersonMetrics['modes'] = {
    started: { walk: 0, car: 0, transit: 0 },
    byHour: {
      walk: Array<number>(24).fill(0),
      car: Array<number>(24).fill(0),
      transit: Array<number>(24).fill(0),
    },
    completed: { walk: 0, drive: 0, driveWalk: 0, transit: 0 },
  };
  const parkedAway = new Uint8Array(trips.length);
  /** TASK-128's station riders came by train and walk on: outside the mode shares. */
  const rider = (id: number) => trips[id]!.personId?.startsWith('rider:') ?? false;
  const activeDrives = new Set<number>();
  const fallbackWalks = new Map<
    number,
    { endS: number; leg: PersonLegDetail; done: (timeS: number) => void }
  >();
  const fallbackCounts = new Map<string, PersonMetrics['fallbacks'][number]>();
  const sums = {
    access: { count: 0, timeS: 0, distanceM: 0 },
    egress: { count: 0, timeS: 0, distanceM: 0 },
  };
  let started = 0,
    completed = 0,
    failed = 0,
    walkTripsCompleted = 0,
    walkTripsFailed = 0,
    walkFallbacks = 0;
  let next = 0;
  let nowS = scenario.startS;
  let router = injectedRouter ?? createWalkRouter(city.walk);
  let routeCache = new Map<string, WalkResult>();
  let accessCache = new Map<string, WalkPosition[]>();
  const buildSpatial = () => {
    const tree = new Flatbush(Math.max(1, city.walk.links.length));
    for (const link of city.walk.links) {
      const xs = link.line.map((p) => p.x),
        ys = link.line.map((p) => p.y);
      tree.add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    if (!city.walk.links.length) tree.add(0, 0, 0, 0);
    tree.finish();
    return tree;
  };
  let spatial = buildSpatial();
  const place = (id: PlaceId) => city.places[city.index.place.get(id)!]!;
  const gateway = (id: PlaceId) => place(id).kind === 'gateway';
  /** TASK-113: the tours in the mode choice, by their first trip. TASK-173: each chooses when its
   * first trip starts, from that moment's link costs, parking room and car. */
  const tours = new Map<number, number[]>();
  // TASK-174: with transit on offer the tours of persons walking all day choose too (walk or
  // transit); TASK-128's riders stay outside.
  let network: TransitNetwork | null = transit
    ? transitNetwork(city, params.walkSpeedMps, params.walkStepsFactor)
    : null;
  for (const tour of modeTours(
    trips,
    scenario,
    (trip) =>
      hasPerson(trip) &&
      !trip.personId!.startsWith('rider:') &&
      !gateway(trip.originPlaceId) &&
      !gateway(trip.destinationPlaceId),
    !!network,
  ))
    tours.set(tour[0]!, tour);
  /** TASK-174: the plan a transit tour's first trip chose with, used as it leaves. */
  const plans = new Map<number, TransitPlan>();
  // TASK-128's riders come in on the S-Bahn that brings them, get off where their walk out was
  // timed from and walk to the entrance that walk starts at.
  const riderTrips = transit
    ? trips.filter((t) => t.id.endsWith(':out') && t.personId && riderOf(t.personId))
    : [];
  if (riderTrips.length) {
    const bodies = new Map(
      stationArrivals(city.rail!, trainTimetable(city.rail!), 0, 86400).map((a) => [
        `${a.platform}@${Math.round(a.arrivalS)}`,
        a.body,
      ]),
    );
    for (const trip of riderTrips) {
      const { platform, arrivalS } = riderOf(trip.personId!)!;
      const door = riderDoor(
        bodies.get(`${platform}@${arrivalS}`)!,
        riderDraw(scenario.seed, trip.personId!),
      );
      transit!.expect(trip.personId!, platform, arrivalS, trip.departS, door, () => {
        const result = walkRoute(
          [{ placeId: trip.originPlaceId }],
          [{ placeId: trip.destinationPlaceId }],
          `walk:${trip.originPlaceId}:${trip.destinationPlaceId}`,
        );
        if (!result.ok) return null;
        const { link, fromM } = result.route.legs[0]!;
        const line = city.walk.links[link]!;
        return pointAtDistance(line.line, line.cumulative, fromM);
      });
    }
  }
  let parkingNear = new Map<
    number,
    { own: CompiledCity['parking']; near: CompiledCity['parking'] }
  >();
  /** The destination's expected parking now: the nearest facility of the place itself with room,
   * else the nearest public one within the search radius with room (a search), else the nearest of
   * those, full (a longer search), else none. */
  function destinationParking(idx: number) {
    const at = city.places[idx]!.centroid;
    const away = (f: CompiledCity['parking'][number]) => distance(f.centroid, at);
    let candidates = parkingNear.get(idx);
    if (!candidates) {
      const nearest = (list: CompiledCity['parking']) =>
        list.sort((a, b) => away(a) - away(b) || a.idx - b.idx);
      candidates = {
        own: nearest(city.parking.filter((f) => f.place === idx && f.connectorsOut.length)),
        near: nearest(
          city.parking.filter(
            (f) => f.access === 'public' && away(f) <= params.parkingSearchRadiusM,
          ),
        ),
      };
      parkingNear.set(idx, candidates);
    }
    const room = (f: CompiledCity['parking'][number]) => parking.hasRoom(f.idx);
    const own = candidates.own.find(room),
      near = own ? undefined : candidates.near.find(room);
    const facility = own ?? near ?? candidates.own[0] ?? candidates.near[0];
    return {
      facility,
      walkS: facility ? (away(facility) * PARKING_WALK_DETOUR) / params.walkSpeedMps : 0,
      searchS: own || !facility ? 0 : near ? PUBLIC_PARKING_SEARCH_S : FULL_PARKING_SEARCH_S,
    };
  }
  let drives = new Map<string, { driveS: number; distanceM: number }>();
  let drivesVersion = -1;
  function carInputs(id: number): NonNullable<ModeInputs['car']> {
    const trip = trips[id]!,
      origin = place(trip.originPlaceId),
      destination = place(trip.destinationPlaceId);
    const at = parking.location(id, true);
    const facility = city.parking[at.facility];
    const carAt = city.parkingSpaces?.[at.space]?.position ?? facility?.centroid ?? origin.centroid;
    const end = destinationParking(destination.idx);
    const out = facility?.connectorsOut[0] ?? origin.connectorsOut[0];
    const into = end.facility?.connectorsIn[0] ?? destination.connectorsIn[0];
    if (drivesVersion !== drive!.costs.version) {
      drives = new Map();
      drivesVersion = drive!.costs.version;
    }
    const key = `${out}>${into}`;
    let cached = drives.get(key);
    if (!cached) {
      const connector = out === undefined ? undefined : city.connectors[out];
      const result =
        connector && into !== undefined
          ? drive!.provider.route(city, drive!.costs, {
              fromLane: connector.lane,
              fromPosM: connector.positionM,
              toConnector: into,
              vehicleClass: 'car',
              purpose: 'private',
              desiredSpeedFactor: 1,
              noise: 0,
              seed: 1,
            })
          : null;
      if (result?.ok)
        cached = {
          driveS: result.route.costS,
          distanceM: result.route.roads.reduce((sum, road) => sum + city.roads[road]!.lengthM, 0),
        };
      else {
        const distanceM = distance(origin.centroid, destination.centroid) * DRIVE_DETOUR;
        cached = { driveS: distanceM / DRIVE_FALLBACK_MPS, distanceM };
      }
      drives.set(key, cached);
    }
    return {
      accessS: (distance(origin.centroid, carAt) * PARKING_WALK_DETOUR) / params.walkSpeedMps,
      ...cached,
      searchS: end.searchS,
      egressS: end.walkS,
    };
  }
  /** The tour's mode, chosen as its first trip starts. The car is on offer only if it is there:
   * no trip of the tour failed, nor the car's previous trip, and the stock placed it. A tour that
   * walks turns its trips into walks; its car stays where it is. */
  function chooseMode(tour: number[], timeS: number) {
    const first = trips[tour[0]!]!;
    const carTour = first.mode === 'car';
    const walk = walkRoute(
      [{ placeId: first.originPlaceId }],
      [{ placeId: first.destinationPlaceId }],
      `walk:${first.originPlaceId}:${first.destinationPlaceId}`,
    );
    const carBefore = carTour ? parking.carBefore(tour[0]!) : -1;
    const car =
      carTour &&
      !parking.noOriginCar(tour[0]!) &&
      (carBefore === -1 || vehicles.state[carBefore] !== FAILED) &&
      tour.every((id) => vehicles.state[id] !== FAILED);
    // TASK-174: transit is on offer when its plan walks less than walking the whole way.
    const plan = transitPlan(first, timeS);
    const planWalkS = plan
      ? plan.accessS + plan.egressS + plan.transferWalksS.reduce((a, b) => a + b, 0)
      : Infinity;
    const offered = plan !== null && planWalkS < (walk.ok ? walk.route.costS : Infinity);
    const inputs: ModeInputs = {
      ...(walk.ok ? { walkS: walk.route.costS } : {}),
      ...(car ? { car: carInputs(tour[0]!) } : {}),
      ...(offered
        ? {
            transit: {
              walkS: planWalkS,
              waitS: plan.waitS,
              rideS: plan.rideS,
              transfers: plan.rides.length - 1,
            },
          }
        : {}),
    };
    const { mode } = chooseTour(scenario, first, inputs);
    if (mode === 'car' || (mode === 'walk' && !carTour)) return;
    for (const id of tour) {
      trips[id] = mode === 'walk' ? walkTrip(trips[id]!) : transitTrip(trips[id]!);
      if (carTour) accounting.excludeWalk(id);
    }
    if (carTour) parking.walked(tour);
    if (mode === 'transit') plans.set(tour[0]!, plan!);
  }
  function transitPlan(trip: TripRequest, timeS: number) {
    if (!network) return null;
    return network.route(
      {
        departS: timeS,
        accessS: network.placeAccess(trip.originPlaceId).walkS,
        egressS: network.placeAccess(trip.destinationPlaceId).walkS,
      },
      transitWeights,
    );
  }
  /** A walk leg between walk positions; arriving calls `done`, no route fails the trip. */
  function walkBetween(
    id: number,
    from: WalkPosition[],
    to: WalkPosition[],
    key: string,
    timeS: number,
    done: (at: number) => void,
  ) {
    const trip = trips[id]!,
      item = leg(id, 'walk', timeS);
    const result = walkRoute(from, to, key);
    if (!result.ok) {
      finish(id, timeS, 'no_walk_route');
      return;
    }
    item.distanceM = result.route.lengthM;
    item.walkerId = walkers!.spawn(
      {
        route: result.route,
        timeS,
        fromPlaceId: trip.originPlaceId,
        toPlaceId: trip.destinationPlaceId,
        personId: trip.personId ?? trip.id,
        tripId: trip.id,
        tripLeg: 'walk',
      },
      (at, dropped) => {
        if (records[id]!.state !== 'active') return;
        if (dropped) return finish(id, at, 'no_walk_route');
        item.state = 'completed';
        item.arrivedS = at;
        done(at);
      },
    );
  }
  const nearest = <T extends { point: Vec2 }>(list: readonly T[], to: Vec2) =>
    list.reduce((a, b) => (distance(a.point, to) <= distance(b.point, to) ? a : b));
  /** TASK-174: a transit trip: walk to the first stop, then per vehicle wait, ride and alight, walk
   * or wait for the next one, and walk on from the last stop. */
  function ride(id: number, plan: TransitPlan, timeS: number) {
    const net = network!;
    const trip = trips[id]!;
    const stops = net.stops;
    const first =
      stops[plan.accessStop]!.access[net.placeAccess(trip.originPlaceId).via[plan.accessStop]!]!;
    const last =
      stops[plan.egressStop]!.access[
        net.placeAccess(trip.destinationPlaceId).via[plan.egressStop]!
      ]!;
    const walkOn = (from: WalkPosition, stop: number, t: number) =>
      walkBetween(
        id,
        [from],
        [{ placeId: trip.destinationPlaceId }],
        `egress:${stops[stop]!.id}:${trip.destinationPlaceId}`,
        t,
        (at) => finish(id, at),
      );
    const board = (k: number, from: Vec2, at: number) => {
      const step = plan.rides[k]!,
        next = plan.rides[k + 1];
      const waitLeg = leg(id, 'wait', at);
      waitLeg.stop = stops[step.fromStop]!.id;
      // Off the platform toward the next stop, or out by the access the plan walks on from.
      const exit = next ? nearest(stops[step.toStop]!.access, stops[next.fromStop]!.centre) : last;
      let rideLeg: PersonLegDetail | null = null;
      const routes = net.lines
        .filter((line) => {
          const i = line.visits.findIndex((v) => v.stop === step.fromStop);
          return i !== -1 && line.visits.slice(i + 1).some((v) => v.stop === step.toStop);
        })
        .map((line) => line.route);
      transit!.wait({
        personId: trip.personId ?? trip.id,
        tripId: trip.id,
        from,
        stop: step.fromStop,
        routes,
        toStop: step.toStop,
        exit: exit.point,
        timeS: at,
        onBoard(t, vehicle) {
          if (records[id]!.state !== 'active') return;
          waitLeg.state = 'completed';
          waitLeg.arrivedS = t;
          rideLeg = leg(id, 'ride', t);
          rideLeg.stop = waitLeg.stop;
          rideLeg.toStop = stops[step.toStop]!.id;
          rideLeg.vehicle = vehicle;
          rideLeg.line = net.lines.find((l) =>
            vehicle.startsWith(`${net.table.routes[l.route]!.id}/`),
          )?.name;
        },
        onAlight(t) {
          if (records[id]!.state !== 'active') return;
          rideLeg!.state = 'completed';
          rideLeg!.arrivedS = t;
          if (!next) return walkOn(exit.position, step.toStop, t);
          if (next.fromStop === step.toStop) return board(k + 1, exit.point, t);
          const into = nearest(stops[next.fromStop]!.access, exit.point);
          walkBetween(
            id,
            [exit.position],
            [into.position],
            `transfer:${stops[step.toStop]!.id}:${stops[next.fromStop]!.id}`,
            t,
            (a) => board(k + 1, into.point, a),
          );
        },
        onGiveUp(t) {
          if (records[id]!.state !== 'active') return;
          waitLeg.state = 'completed';
          waitLeg.arrivedS = t;
          walkOn(nearest(stops[step.fromStop]!.access, from).position, step.fromStop, t);
        },
      });
    };
    walkBetween(
      id,
      [{ placeId: trip.originPlaceId }],
      [first.position],
      `access:${trip.originPlaceId}:${stops[plan.accessStop]!.id}`,
      timeS,
      (at) => board(0, first.point, at),
    );
  }
  const connectorPoint = (idx: number) => {
    const c = city.connectors[idx]!,
      lane = city.lanes[c.lane]!;
    return pointAtDistance(lane.polyline, lane.cumulative, c.positionM);
  };
  function carAccess(id: number, origin: boolean) {
    const location = parking.location(id, origin);
    const facility = city.parking[location.facility];
    const space = city.parkingSpaces?.[location.space];
    const connector = facility
      ? origin
        ? facility.connectorsOut[0]
        : vehicles.destination[id]
      : origin
        ? place(trips[id]!.originPlaceId).connectorsOut[0]
        : vehicles.destination[id];
    const point =
      space?.position ??
      (connector !== undefined && connector !== -1
        ? connectorPoint(connector)
        : (facility?.centroid ??
          place(origin ? trips[id]!.originPlaceId : trips[id]!.destinationPlaceId).centroid));
    const key = space ? `s:${space.idx}` : `c:${connector ?? -1}`;
    let positions = accessCache.get(key);
    if (!positions) {
      positions = [];
      if (space && facility?.kind !== 'garage') {
        const road = city.roads[city.lanes[space.lane]!.road]!;
        const anchor = city.walk.connectors.get(city.connectors[space.connector]!.id);
        const grade =
          city.walk.nodes[anchor ?? city.walk.sourceNodes.get(city.nodes[road.from]!.id) ?? -1]
            ?.layer;
        let best = 30,
          bestLink = -1,
          along = 0;
        for (const index of spatial
          .search(point.x - 30, point.y - 30, point.x + 30, point.y + 30)
          .sort((a, b) => a - b)) {
          const link = city.walk.links[index];
          if (!link || (grade !== undefined && link.layer !== grade)) continue;
          const near = nearestOnPolyline(link.line, point);
          if (near.away < best) {
            best = near.away;
            bestLink = index;
            along = near.along;
          }
        }
        if (bestLink !== -1) positions.push({ link: bestLink, positionM: along });
        else positions = (city.walk.parking.get(facility!.id) ?? []).map((node) => ({ node }));
      } else if (connector !== undefined && connector !== -1) {
        const node = city.walk.connectors.get(city.connectors[connector]!.id);
        if (node !== undefined) positions.push({ node });
      }
      accessCache.set(key, positions);
    }
    return { positions, point, facilityId: facility?.id ?? null, key };
  }
  function walkRoute(from: WalkPosition[], to: WalkPosition[], key: string): WalkResult {
    const cached = routeCache.get(key);
    if (cached) return cached;
    let best: WalkResult = {
      ok: false,
      reason: from.length && to.length ? 'no_path' : 'position_unreachable',
    };
    for (const a of from)
      for (const b of to) {
        const result = router.route({
          from: a,
          to: b,
          speedMps: params.walkSpeedMps,
          stepsFactor: params.walkStepsFactor,
        });
        if (result.ok && (!best.ok || result.route.costS < best.route.costS)) best = result;
      }
    routeCache.set(key, best);
    return best;
  }
  function leg(id: number, kind: PersonLegDetail['kind'], timeS: number) {
    const result: PersonLegDetail = {
      kind,
      state: 'active',
      startedS: timeS,
      arrivedS: null,
      distanceM: 0,
      walkerId: null,
    };
    records[id]!.legs.push(result);
    return result;
  }
  function finish(id: number, timeS: number, reason: FailReason | null = null) {
    const record = records[id]!;
    if (record.state === 'completed' || record.state === 'failed') return;
    record.state = reason ? 'failed' : 'completed';
    record.failReason = reason;
    if (reason) failed++;
    else {
      completed++;
      const mode = trips[id]!.mode;
      if (!rider(id))
        modes.completed[
          mode === 'walk'
            ? 'walk'
            : mode === 'rail'
              ? 'transit'
              : parkedAway[id]
                ? 'driveWalk'
                : 'drive'
        ]++;
      // TASK-128's rider back at the station boards the next S-Bahn there.
      if (rider(id) && transit && trips[id]!.id.endsWith(':back')) leaveByTrain(id, timeS);
    }
    for (const item of record.legs)
      if (item.state === 'active') {
        item.state = reason ? 'failed' : 'completed';
        item.arrivedS = timeS;
      }
    activeDrives.delete(id);
    fallbackWalks.delete(id);
    if (trips[id]!.mode !== 'car') {
      if (trips[id]!.mode === 'walk') {
        if (reason) walkTripsFailed++;
        else walkTripsCompleted++;
      }
      accounting.finishWalk(id, record.legs[0]?.startedS ?? timeS, reason ? null : timeS, reason);
    }
    const dependents = waiting.get(id);
    waiting.delete(id);
    for (const dependent of dependents ?? []) start(dependent, timeS);
  }
  function walk(
    id: number,
    kind: 'access' | 'egress' | 'walk',
    timeS: number,
    done: (at: number) => void,
  ) {
    const trip = trips[id]!,
      item = leg(id, kind, timeS);
    const atOrigin = kind === 'access';
    const car = kind === 'walk' ? null : carAccess(id, atOrigin);
    const placeId = atOrigin || kind === 'walk' ? trip.originPlaceId : trip.destinationPlaceId;
    const from = atOrigin || kind === 'walk' ? [{ placeId }] : car!.positions;
    const to =
      kind === 'walk'
        ? [{ placeId: trip.destinationPlaceId }]
        : atOrigin
          ? car!.positions
          : [{ placeId }];
    const result = walkRoute(from, to, `${kind}:${placeId}:${car?.key ?? trip.destinationPlaceId}`);
    const arrived = (at: number) => {
      if (records[id]!.state !== 'active') return;
      item.state = 'completed';
      item.arrivedS = at;
      if (kind !== 'walk') {
        const sum = sums[kind];
        sum.count++;
        sum.timeS += at - timeS;
        sum.distanceM += item.distanceM;
      }
      done(at);
    };
    if (result.ok) {
      item.distanceM = result.route.lengthM;
      item.walkerId = walkers!.spawn(
        {
          route: result.route,
          timeS,
          fromPlaceId: trip.originPlaceId,
          toPlaceId: trip.destinationPlaceId,
          personId: trip.personId ?? trip.id,
          tripId: trip.id,
          tripLeg: kind,
        },
        (at, dropped) => {
          if (!dropped) arrived(at);
          else if (kind === 'walk') finish(id, at, 'no_walk_route');
          else fallback(id, kind, at, item, car!, placeId, 'live_edit', arrived);
        },
      );
    } else if (kind === 'walk') finish(id, timeS, 'no_walk_route');
    else
      fallback(
        id,
        kind,
        timeS,
        item,
        car!,
        placeId,
        !city.walk.places.get(placeId)?.length
          ? 'no_place_anchor'
          : !car!.positions.length
            ? 'no_parking_anchor'
            : result.reason,
        arrived,
      );
  }
  function fallback(
    id: number,
    kind: 'access' | 'egress',
    timeS: number,
    item: PersonLegDetail,
    car: { point: Vec2; facilityId: string | null },
    placeId: PlaceId,
    reason: string,
    done: (at: number) => void,
  ) {
    item.walkerId = null;
    item.distanceM = distance(place(placeId).centroid, car.point);
    walkFallbacks++;
    const key = `${kind}:${placeId}:${car.facilityId}:${reason}`;
    const count = fallbackCounts.get(key);
    if (count) count.count++;
    else
      fallbackCounts.set(key, { leg: kind, placeId, facilityId: car.facilityId, reason, count: 1 });
    fallbackWalks.set(id, { endS: timeS + item.distanceM / params.walkSpeedMps, leg: item, done });
  }
  /** The car's previous trip when another member drove it; a person's own chain covers theirs. */
  function sharedCarBefore(id: number) {
    const car = trips[id]!.mode === 'car' ? parking.carBefore(id) : -1;
    return car !== -1 && trips[car]!.personId !== trips[id]!.personId ? car : -1;
  }
  function start(id: number, timeS: number) {
    const record = records[id]!;
    if (record.state !== 'pending') return;
    const before = records[previous[id]!];
    if (before && before.state !== 'completed' && before.state !== 'failed') {
      const list = waiting.get(previous[id]!) ?? [];
      list.push(id);
      waiting.set(previous[id]!, list);
      return;
    }
    const car = sharedCarBefore(id);
    if (car !== -1 && vehicles.state[car] !== COMPLETED && vehicles.state[car] !== FAILED) {
      if (!carWaitSince.has(id)) {
        carWaitSince.set(id, timeS);
        carWaiting.set(car, [...(carWaiting.get(car) ?? []), id]);
      }
      return;
    }
    if (carWaitSince.has(id)) {
      carWaits.push(timeS - carWaitSince.get(id)!);
      carWaitSince.delete(id);
    }
    const tour = tours.get(id);
    if (tour && before?.state !== 'failed' && vehicles.state[id] !== FAILED)
      chooseMode(tour, timeS);
    // TASK-174: a transit trip plans as it leaves (its tour's first trip uses the chosen plan);
    // with no plan it walks.
    let plan: TransitPlan | null = null;
    if (trips[id]!.mode === 'rail') {
      plan = plans.get(id) ?? transitPlan(trips[id]!, timeS);
      plans.delete(id);
      if (!plan) trips[id] = walkTrip(trips[id]!);
    }
    record.state = 'active';
    started++;
    const mode =
      trips[id]!.mode === 'walk' ? 'walk' : trips[id]!.mode === 'rail' ? 'transit' : 'car';
    if (!rider(id)) {
      modes.started[mode]++;
      modes.byHour[mode][Math.floor(trips[id]!.departS / 3600) % 24]!++;
    }
    if (
      car !== -1 &&
      trips[id]!.mode === 'car' &&
      vehicles.state[car] === FAILED &&
      vehicles.state[id] !== FAILED
    )
      accounting.fail(id, 'stranded');
    if (before?.state === 'failed' || vehicles.state[id] === FAILED) {
      if (trips[id]!.mode === 'car' && vehicles.state[id] !== FAILED)
        accounting.fail(id, 'stranded');
      finish(id, timeS, vehicles.failReason[id] ?? 'stranded');
      return;
    }
    if (plan) ride(id, plan, timeS);
    else if (trips[id]!.mode === 'walk') walk(id, 'walk', timeS, (at) => finish(id, at));
    else if (!gateway(trips[id]!.originPlaceId))
      walk(id, 'access', timeS, () => {
        ready[id] = 1;
      });
    else ready[id] = 1;
  }
  /** TASK-128: a rider back at the station walks in by the entrance nearest where they came from
   * and boards from the other platform, the way back, if the station has one. */
  function leaveByTrain(id: number, timeS: number) {
    const station = riderOf(trips[id]!.personId!)!;
    const net = network!;
    const platforms = net.stops.flatMap((s, i) =>
      s.station === station.stationId && s.access.length ? [i] : [],
    );
    const stop = platforms.find((i) => net.stops[i]!.id !== station.platform) ?? platforms[0];
    if (stop === undefined) return;
    const entrance = nearest(net.stops[stop]!.access, place(trips[id]!.originPlaceId).centroid);
    transit!.leave(trips[id]!.personId!, stop, entrance.point, timeS);
  }
  /** The household car is back: the next member's trip may start. */
  function carBack(id: number, timeS: number) {
    const dependents = carWaiting.get(id);
    carWaiting.delete(id);
    for (const dependent of dependents ?? []) start(dependent, timeS);
  }
  function driveCompleted(id: number, timeS: number) {
    carBack(id, timeS);
    const record = records[id];
    if (!record || record.state !== 'active') return;
    const drive = record.legs.find((l) => l.kind === 'drive')!;
    drive.state = 'completed';
    drive.arrivedS = timeS;
    activeDrives.delete(id);
    const destination = city.index.place.get(trips[id]!.destinationPlaceId)!;
    const facility = city.parking[parking.location(id).facility];
    parkedAway[id] = Number(
      !!facility && facility.place !== destination && !gateway(trips[id]!.destinationPlaceId),
    );
    if (!gateway(trips[id]!.destinationPlaceId)) walk(id, 'egress', timeS, (at) => finish(id, at));
    else finish(id, timeS);
  }
  accounting.observe(driveCompleted, (id, reason) => {
    if (records[id]?.state === 'active') finish(id, nowS, reason);
    carBack(id, nowS);
  });
  return {
    enabled: ids.length > 0,
    handlesWalk: (id: number) => trips[id]!.mode === 'walk' && !!managed[id],
    occupant: (id: number) => (hasPerson(trips[id]!) ? trips[id]!.personId : null),
    ready: (id: number) => !managed[id] || !!ready[id],
    step(timeS: number) {
      nowS = timeS;
      while (next < ids.length && trips[ids[next]!]!.departS <= timeS + 1e-9)
        start(ids[next++]!, timeS);
      for (const [id, fallback] of fallbackWalks)
        if (timeS + 1e-9 >= fallback.endS) {
          fallbackWalks.delete(id);
          fallback.done(timeS);
        }
      transit?.step(timeS);
    },
    departed(id: number, timeS: number) {
      if (!records[id] || activeDrives.has(id)) return;
      const drive = leg(id, 'drive', timeS);
      drive.startedS = timeS;
      activeDrives.add(id);
    },
    metrics(): PersonMetrics {
      const mean = (kind: 'access' | 'egress') => {
        const sum = sums[kind];
        return {
          count: sum.count,
          meanTimeS: sum.count ? sum.timeS / sum.count : 0,
          meanDistanceM: sum.count ? sum.distanceM / sum.count : 0,
        };
      };
      return {
        started,
        completed,
        failed,
        walkTripsCompleted,
        walkTripsFailed,
        access: mean('access'),
        egress: mean('egress'),
        walkFallbacks,
        carWaits: (() => {
          const waits = carWaits.slice().sort((a, b) => a - b);
          return {
            count: waits.length,
            medianS: waits.length ? waits[Math.ceil(waits.length / 2) - 1]! : 0,
            maxS: waits.at(-1) ?? 0,
          };
        })(),
        modes: {
          started: { ...modes.started },
          byHour: {
            walk: modes.byHour.walk.slice(),
            car: modes.byHour.car.slice(),
            transit: modes.byHour.transit.slice(),
          },
          completed: { ...modes.completed },
        },
        fallbacks: [...fallbackCounts.values()].map((entry) => ({ ...entry })),
      };
    },
    inspect(personId: string): PersonDetail | null {
      const chain = byPerson.get(personId);
      if (!chain) return null;
      const owner = populationById.get(personId),
        first = trips[chain[0]!]!;
      const current =
        chain.find((id) => records[id]!.state === 'active') ??
        chain.findLast((id) => records[id]!.state !== 'pending') ??
        chain[0]!;
      const record = records[current]!;
      const atOrigin =
        !record.legs.some((l) => l.kind === 'drive') || record.legs.at(-1)?.kind === 'access';
      const car = trips[current]!.mode === 'car' ? parking.location(current, atOrigin) : null;
      const members = owner ? households.get(owner.householdId)! : [];
      const carId = chain.map((id) => trips[id]!.carId).find((id) => id !== undefined) ?? null;
      // Car `car:<householdId>:<k>` belongs to the household's k-th member with a car.
      const carOwner = carId
        ? (members.filter((m) => m.hasCar)[Number(carId.slice(carId.lastIndexOf(':') + 1))]?.id ??
          null)
        : null;
      return {
        id: personId,
        homePlaceId: owner?.homePlaceId ?? first.originPlaceId,
        workPlaceId: owner?.workPlaceId ?? first.destinationPlaceId,
        agenda:
          owner?.agenda.map((a) => ({ ...a })) ??
          chain.map((id) => ({
            kind: 'other',
            placeId: trips[id]!.originPlaceId,
            startS: trips[id]!.departS,
            durationS: 0,
          })),
        state: record.state,
        currentLeg: record.legs.find((l) => l.state === 'active') ?? record.legs.at(-1) ?? null,
        car: {
          facility: car ? (city.parking[car.facility]?.id ?? null) : null,
          space: car && car.space !== -1 ? car.space : null,
        },
        household: owner ? { id: owner.householdId, members: members.map((m) => m.id) } : null,
        carId,
        carOwner,
        trips: chain.map((id) => ({
          ...records[id]!,
          legs: records[id]!.legs.map((l) => ({ ...l })),
        })),
      };
    },
    hash(word: (hash: number, value: number) => number, hash: number) {
      if (!started) return hash;
      for (const id of ids)
        if (records[id]!.state !== 'pending') {
          const record = records[id]!;
          hash = word(hash, id + 1);
          hash = word(hash, ['pending', 'active', 'completed', 'failed'].indexOf(record.state));
          for (const item of record.legs) {
            hash = word(
              hash,
              ['access', 'drive', 'egress', 'walk', 'wait', 'ride'].indexOf(item.kind),
            );
            hash = word(hash, Math.round((item.startedS ?? -1) * 10));
            hash = word(hash, Math.round((item.arrivedS ?? -1) * 10));
          }
        }
      return transit ? transit.hash(word, hash) : hash;
    },
    patch(nextCity: CompiledCity) {
      city = nextCity;
      router = createWalkRouter(city.walk);
      routeCache = new Map();
      accessCache = new Map();
      parkingNear = new Map();
      drives = new Map();
      spatial = buildSpatial();
      if (network) network = transitNetwork(city, params.walkSpeedMps, params.walkStepsFactor);
    },
  };
}
