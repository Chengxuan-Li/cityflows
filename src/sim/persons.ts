import Flatbush from 'flatbush';
import { distance, nearestOnPolyline, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { createWalkRouter, type WalkPosition, type WalkResult } from '../routing/walk';
import type { Person, PlaceId, Scenario, SimParams, TripRequest } from '../schema';
import type { createAccounting } from './metrics';
import type { createParking } from './parking';
import type { FailReason } from './types';
import { COMPLETED, FAILED, type Vehicles } from './vehicle';
import type { Walkers } from './walkers';

type State = 'pending' | 'active' | 'completed' | 'failed';
export interface PersonLegDetail {
  kind: 'access' | 'drive' | 'egress' | 'walk';
  state: State;
  startedS: number | null;
  arrivedS: number | null;
  distanceM: number;
  walkerId: number | null;
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
    else completed++;
    for (const item of record.legs)
      if (item.state === 'active') {
        item.state = reason ? 'failed' : 'completed';
        item.arrivedS = timeS;
      }
    activeDrives.delete(id);
    fallbackWalks.delete(id);
    if (trips[id]!.mode === 'walk') {
      if (reason) walkTripsFailed++;
      else walkTripsCompleted++;
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
    record.state = 'active';
    started++;
    if (car !== -1 && vehicles.state[car] === FAILED && vehicles.state[id] !== FAILED)
      accounting.fail(id, 'stranded');
    if (before?.state === 'failed' || vehicles.state[id] === FAILED) {
      if (trips[id]!.mode === 'car' && vehicles.state[id] !== FAILED)
        accounting.fail(id, 'stranded');
      finish(id, timeS, vehicles.failReason[id] ?? 'stranded');
      return;
    }
    if (trips[id]!.mode === 'walk') walk(id, 'walk', timeS, (at) => finish(id, at));
    else if (!gateway(trips[id]!.originPlaceId))
      walk(id, 'access', timeS, () => {
        ready[id] = 1;
      });
    else ready[id] = 1;
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
            hash = word(hash, ['access', 'drive', 'egress', 'walk'].indexOf(item.kind));
            hash = word(hash, Math.round((item.startedS ?? -1) * 10));
            hash = word(hash, Math.round((item.arrivedS ?? -1) * 10));
          }
        }
      return hash;
    },
    patch(nextCity: CompiledCity) {
      city = nextCity;
      router = createWalkRouter(city.walk);
      routeCache = new Map();
      accessCache = new Map();
      spatial = buildSpatial();
    },
  };
}
