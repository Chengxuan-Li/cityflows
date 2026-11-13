import {
  distance as pointDistance,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
} from '../geo/polyline';
import { createRandom } from '../geo/random';
import type { CParkingSpace, CompiledCity } from '../network';
import { lotPath } from '../network/lot-paths';
import { departureMisses, parkingConnectorPermitted } from '../network/parking';
import { vehicleClasses, type Scenario, type SimParams, type TripRequest } from '../schema';
import { parkingEgress } from './parking-egress';
import type { Metrics, ParkedCarsSnapshot, ParkingClaimsSnapshot } from './types';
import { COMPLETED, FAILED, type Vehicles } from './vehicle';
import { parkingHash } from './hash';
import {
  bodyClearLane,
  bodyClearOf,
  holdProgress,
  joinStation,
  laneCrossings,
  lotHold,
  manoeuvreLaneBounds,
  manoeuvrePath,
  manoeuvreLaneReach,
  motionPath,
  parkedPose,
  pathPose,
  type LaneBand,
  type LaneCrossing,
  type MotionPath,
  type ParkingPose,
} from './manoeuvre';

interface ParkingMotion {
  phase: 'drive_in' | 'park' | 'leave' | 'drive_out' | 'exit' | 'merge';
  lot: boolean;
  slot: number;
  connector: number;
  lane: number;
  path: MotionPath;
  progressM: number;
  /** Drive-out progress of the hold pose, clear of the exit lane (TASK-150). */
  holdM: number;
  /** Lane station where the car joins from its hold (TASK-150). */
  joinM: number;
  /** Lanes its merge crosses before it joins (TASK-157). */
  crossings: LaneCrossing[];
  startedS: number;
  entryS: number;
  driveS: number;
  laneHeld: boolean;
  pose: ParkingPose;
  speed: number;
}

/** How far an ownerless lot's car park reaches: the buildings beside it. */
const LOT_SERVES_M = 200;

export function createParking(
  compiled: CompiledCity,
  trips: TripRequest[],
  scenario: Scenario,
  params: SimParams,
  vehicles: Vehicles,
) {
  /** An inferred garage with an inferred capacity stands in for parking OSM does not map. Its
   * nameplate covers its place's residents and jobs (compile), and it never turns a car away:
   * not every owner parks there, and mode choice will thin car demand later (owner, 2026-11-08).
   * Mapped and user-set capacities are hard limits. */
  const soft = (f: CompiledCity['parking'][number]) =>
    (f.source.provenance.inferred?.includes('implicitGarage') &&
      f.source.provenance.inferred.includes('capacity')) ??
    false;
  const hasRoom = (f: CompiledCity['parking'][number]) => soft(f) || occupied[f.idx]! < f.capacity;
  // TASK-129: a car's trips chain by its `carId` (by person for trips without one), so a second
  // driver leaves from where the first parked, waits for the car, and never takes another.
  const previous = new Int32Array(trips.length).fill(-1);
  const nextTrip = new Int32Array(trips.length).fill(-1);
  const chronology = trips
    .map((_, id) => id)
    .sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
  const lastOfCar = new Map<string, number>();
  for (const id of chronology) {
    const trip = trips[id]!,
      key = trip.carId ?? trip.personId;
    if (trip.mode !== 'car' || key === null) continue;
    const before = lastOfCar.get(key);
    if (before !== undefined && trips[before]!.destinationPlaceId === trip.originPlaceId) {
      previous[id] = before;
      nextTrip[before] = id;
    }
    lastOfCar.set(key, id);
  }
  /** Trip lists scheduled from a population carry household cars; hand-built ones keep the stock
   * of `ceil(round(residents x personsPerResident) x carShare)` cars per home. */
  const households = trips.some((trip) => trip.carId !== undefined);
  /** The first trip of each household car's day, by the home the car leaves from. */
  const homeCars = new Map<string, number[]>();
  /** A car trip that ends at its household's home, where the car's day began. */
  const goingHome = new Uint8Array(trips.length);
  const carHome: (string | undefined)[] = [];
  for (const id of chronology) {
    const trip = trips[id]!;
    if (trip.mode !== 'car' || trip.carId === undefined) continue;
    carHome[id] = previous[id] === -1 ? trip.originPlaceId : carHome[previous[id]!];
    goingHome[id] = Number(carHome[id] === trip.destinationPlaceId);
    if (previous[id] !== -1) continue;
    const place = compiled.places[compiled.index.place.get(trip.originPlaceId) ?? -1];
    if (!place || place.kind === 'gateway') continue;
    const cars = homeCars.get(place.id);
    if (cars) cars.push(id);
    else homeCars.set(place.id, [id]);
  }
  const homeCarCount = (city: CompiledCity, place: number) =>
    homeCars.get(city.places[place]?.id ?? '')?.length ?? 0;
  function initialOccupancy(city: CompiledCity) {
    const remaining = new Map<number, number>();
    const hour = (scenario.startS / 3600) % 24;
    return Uint32Array.from(city.parking, (f) => {
      // Lead (TASK-103 follow-up): the cars of the persons who exist. Demand generation makes
      // round(residents x personsPerResident) persons per home; full-population stock left
      // most parked cars without an owner, so they never moved.
      if (!remaining.has(f.place))
        remaining.set(
          f.place,
          households
            ? homeCarCount(city, f.place)
            : Math.ceil(
                Math.round(f.residents * scenario.demand.personsPerResident) *
                  scenario.demand.carShare,
              ),
        );
      const kind = city.places[f.place]?.kind;
      const fraction =
        f.occupancyAtStart ??
        (hour >= 9 && hour < 17 && (kind === 'work' || kind === 'school')
          ? 0.7
          : hour >= 9 && hour < 20 && kind === 'retail'
            ? 0.35
            : 0);
      const count = Math.min(
        f.capacity,
        f.occupancyAtStart === null && f.residents
          ? remaining.get(f.place)!
          : Math.round(f.capacity * fraction),
      );
      remaining.set(f.place, Math.max(0, remaining.get(f.place)! - count));
      return count;
    });
  }
  /** Lead (TASK-103 follow-up): OSM lots import as their own `parking` place, which nobody
   * lives at, works at or visits, so a private or customers lot admitted no car. Such a lot
   * serves the places within `LOT_SERVES_M` instead, as their own car park: a customers lot the
   * visitors of non-residential places, a private lot also their workers and residents. */
  let served = servedPlaces(compiled);
  function servedPlaces(city: CompiledCity) {
    return city.parking.map((f) => {
      const owner = city.places[f.place];
      if (f.kind !== 'lot' || (owner && (owner.kind !== 'parking' || owner.events.length)))
        return null;
      return new Set(
        city.places
          .filter(
            (p) =>
              p.kind !== 'parking' &&
              p.kind !== 'gateway' &&
              (f.access !== 'customers' || p.kind !== 'residential') &&
              Math.hypot(p.centroid.x - f.centroid.x, p.centroid.y - f.centroid.y) <= LOT_SERVES_M,
          )
          .map((p) => p.idx),
      );
    });
  }
  const serves = (f: CompiledCity['parking'][number], place: number) =>
    f.place === place || (served[f.idx]?.has(place) ?? false);
  let occupied = initialOccupancy(compiled);
  let spaces = compiled.parkingSpaces ?? [];
  let stock = new Int32Array(spaces.length).fill(-1); // -2 is an initially parked car
  let classes = new Uint8Array(spaces.length);
  let reserved = new Int32Array(spaces.length).fill(-1);
  let revision = 0;
  const rng = createRandom(scenario.seed).derive('street-parking');
  let lotGraphs = compiled.parking.map(
    (f) => compiled.lots?.find((l) => l.id === f.id)?.circulation,
  );
  const lotGraph = (facility: number) => lotGraphs[facility];
  /** TASK-156: each lot's aisle-road car lanes, and the movements joining them. A lot arrival
   * keeps clear of lane cars ahead on all of them. On a public aisle, which through traffic
   * drives, it is a lane's occupant while its body is inside that lane's band, so lane cars
   * follow it and departures' gap checks see it. A private aisle's lane cars are departures
   * from its bays, which start by their own gap check. TASK-164: `stands` is the stretch of
   * each aisle lane a lane car can stand in: from where one enters it (by a movement, else at
   * its first spawning connector) to its end if it leads on, else to its last connector; and
   * each movement joining the aisle lanes that a lane car can drive, given its lane's width. */
  const aisleSegmentsOf = (city: CompiledCity) =>
    city.parking.map((f) => {
      const lot = f.kind === 'lot' ? city.lots?.find((l) => l.id === f.id) : undefined;
      const lanes = (lot?.aisles ?? [])
        .flatMap((id) => city.roads[city.index.road.get(id) ?? -1]?.lanes ?? [])
        .filter((lane) => city.lanes[lane]!.allowed.includes('car'));
      const movements = city.movements
        .filter((m) => lanes.includes(m.fromLane) || lanes.includes(m.toLane))
        .map((m) => -m.idx - 1);
      const stands = lanes.flatMap((idx) => {
        const lane = city.lanes[idx]!,
          stations = lane.connectors.map((c) => city.connectors[c]!);
        const spawns = stations.filter((c) => c.direction !== 'in').map((c) => c.positionM);
        const entered = lane.in.some((i) => !city.movements[i]!.neverGreen);
        if (!entered && !spawns.length) return [];
        const fromM = entered ? 0 : Math.min(...spawns);
        const toM = lane.out.length
          ? lane.lengthM
          : Math.max(fromM, ...stations.map((c) => c.positionM));
        return [{ lane: idx, band: lane as LaneBand, fromM, toM }];
      });
      for (const i of movements) {
        const m = city.movements[-i - 1]!;
        if (
          m.neverGreen ||
          (lanes.includes(m.fromLane) && !stands.some((s) => s.lane === m.fromLane))
        )
          continue;
        const band = { ...m, widthM: city.lanes[m.toLane]!.widthM };
        stands.push({ lane: -1, band, fromM: 0, toM: m.lengthM });
      }
      return {
        lanes: lanes.filter((lane) => city.roads[city.lanes[lane]!.road]!.access[0] === 'yes'),
        segments: [...lanes, ...movements],
        stands,
      };
    });
  let aisleSegments = aisleSegmentsOf(compiled);
  const eligibleSpaces = () =>
    compiled.parking.map((f) =>
      (f.spaces ?? []).filter(
        (i) => f.kind !== 'lot' || !lotGraph(f.idx)?.unreachable.includes(spaces[i]!.lotStall!),
      ),
    );
  let usable = eligibleSpaces();
  const usableSpaces = (f: CompiledCity['parking'][number]) => usable[f.idx]!;
  let departures: ReturnType<typeof parkingEgress>[] = [];
  const departure = (id: number) => departures[id]!;
  // Materialize before stock allocation, and again after a network edit. No per-trip searches.
  const prepareDepartures = () => {
    departures = trips.map((trip, id) =>
      parkingEgress(
        compiled,
        params.laneChangeDistanceM,
        vehicleClasses[vehicles.vclass[id]!]!,
        trip.purpose === 'delivery',
      ),
    );
  };
  prepareDepartures();
  const shuffled = (slots: number[], key: string) => {
    const copy = slots.slice(),
      random = rng.derive(key);
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };
  const prefersStreet = (id: number) =>
    rng.derive(trips[id]!.personId ?? trips[id]!.id).next() < params.streetParkingShare;
  const small = (id: number) => vehicles.vclass[id]! < 2;
  // Lead (TASK-103 merge): memoized per place; load asked it twice per trip.
  const nearHomeCache = new Map<number, CompiledCity['parking']>();
  const nearHome = (place: number) => {
    let cached = nearHomeCache.get(place);
    if (!cached) nearHomeCache.set(place, (cached = nearHomeOf(place)));
    return cached;
  };
  const nearHomeOf = (place: number) => {
    const p = compiled.places[place]!.centroid;
    return compiled.parking
      .filter(
        (f) =>
          f.kind !== 'garage' &&
          (f.access === 'public' ||
            f.place === place ||
            (f.access !== 'customers' && serves(f, place))) &&
          f.connectorsOut.length,
      )
      .map((f) => ({ f, d: Math.hypot(f.centroid.x - p.x, f.centroid.y - p.y) }))
      .filter(({ d }) => d <= params.parkingSearchRadiusM)
      .sort((a, b) => a.d - b.d || a.f.idx - b.f.idx)
      .map(({ f }) => f);
  };
  /** The place whose cars start in each stocked space: its facility's, or the home that moved a
   * garage car there. */
  const slotHome = new Int32Array(spaces.length).fill(-1);
  /** The first trip of the household car parked in a space, for display only (not hashed). */
  const stockCar = new Int32Array(spaces.length).fill(-1);
  for (const f of compiled.parking) {
    for (const slot of shuffled(usableSpaces(f), `stock:${f.id}`).slice(0, occupied[f.idx])) {
      stock[slot] = -2;
      slotHome[slot] = f.place;
    }
  }
  const stockDepartures = parkingEgress(compiled, params.laneChangeDistanceM);
  const homeDepartures = new Map<string, Set<ReturnType<typeof parkingEgress>>>();
  for (const [id, trip] of trips.entries()) {
    if (trip.mode !== 'car' || !small(id)) continue;
    let masks = homeDepartures.get(trip.originPlaceId);
    if (!masks) homeDepartures.set(trip.originPlaceId, (masks = new Set()));
    masks.add(departure(id));
  }
  // Move the residential share out of garages once, in compiled place/facility/slot order.
  for (const p of compiled.places) {
    if (p.kind !== 'residential') continue;
    const masks = [...(homeDepartures.get(p.id) ?? [stockDepartures])];
    const garages = compiled.parking.filter(
      (f) => f.place === p.idx && f.kind === 'garage' && f.occupancyAtStart === null,
    );
    let count = Math.round(
      garages.reduce((n, f) => n + occupied[f.idx]!, 0) * params.streetParkingShare,
    );
    for (const f of nearHome(p.idx)) {
      if (f.occupancyAtStart !== null) continue;
      for (const slot of shuffled(usableSpaces(f), `home:${p.id}:${f.id}`)) {
        if (!count || stock[slot] !== -1) continue;
        if (masks.some((mask) => !mask.spaces[slot])) continue;
        const garage = garages.find((g) => occupied[g.idx]! > 0);
        if (!garage) break;
        stock[slot] = -2;
        slotHome[slot] = p.idx;
        occupied[f.idx]!++;
        occupied[garage.idx]!--;
        count--;
      }
    }
  }
  let cachedHash: number | undefined;
  const allowWithoutExit = new Uint32Array(trips.length);
  let origins = new Int32Array(trips.length).fill(-1);
  let chosen = new Int32Array(trips.length).fill(-1);
  // Hard facilities count cars en route; roadside claims also identify one exact space.
  let heading = new Int32Array(trips.length).fill(-1);
  let enRoute = new Int32Array(compiled.parking.length);
  let claimedSpaces = new Int32Array(trips.length).fill(-1);
  let claimedBy = new Int32Array(spaces.length).fill(-1);
  const claimSince = new Float64Array(trips.length).fill(NaN);
  let clockS = scenario.startS;
  const heldTimes: number[] = [];
  const longestClaims: { vehicleId: number; facility: string; space: number; heldS: number }[] = [];
  const entryRejections = new Map<
    string,
    { facility: string; kind: string; space: number | null; count: number }
  >();
  function release(id: number, timeS = clockS) {
    const slot = claimedSpaces[id]!;
    if (slot !== -1) {
      const heldS = Math.max(0, timeS - claimSince[id]!);
      if (compiled.parking[heading[id]!]!.kind === 'roadside') {
        heldTimes.push(heldS);
        longestClaims.push({
          vehicleId: id + 1,
          facility: compiled.parking[heading[id]!]!.id,
          space: slot,
          heldS,
        });
        longestClaims.sort((a, b) => b.heldS - a.heldS || a.vehicleId - b.vehicleId);
        longestClaims.length = Math.min(10, longestClaims.length);
      }
      claimedBy[slot] = -1;
      claimedSpaces[id] = -1;
    }
    head(id, -1);
    claimSince[id] = NaN;
    cachedHash = undefined;
  }
  function assertClaims() {
    const counts = new Int32Array(compiled.parking.length);
    for (let id = 0; id < trips.length; id++) {
      const facility = heading[id]!;
      if (facility === -1) continue;
      if (vehicles.state[id] === COMPLETED || vehicles.state[id] === FAILED)
        throw new Error(`Parking claim outlived car ${id + 1}`);
      counts[facility]!++;
      const slot = claimedSpaces[id]!;
      if (
        slot !== -1 &&
        (claimedBy[slot] !== id || spaces[slot]!.parking !== facility || stock[slot] !== -1)
      )
        throw new Error(`Invalid parking claim for car ${id + 1}`);
    }
    for (let i = 0; i < counts.length; i++)
      if (counts[i] !== enRoute[i]) throw new Error('Parking claim count mismatch');
    for (let slot = 0; slot < claimedBy.length; slot++)
      if (claimedBy[slot] !== -1 && claimedSpaces[claimedBy[slot]!] !== slot)
        throw new Error('Orphan strip claim');
  }
  const head = (id: number, facility: number) => {
    if (heading[id] !== -1) enRoute[heading[id]!]!--;
    heading[id] = facility;
    if (facility !== -1) enRoute[facility]!++;
  };
  let parked = new Int32Array(trips.length).fill(-1);
  let originSpaces = new Int32Array(trips.length).fill(-1);
  let parkedSpaces = new Int32Array(trips.length).fill(-1);
  const manoeuvreSpaces = new Int32Array(trips.length).fill(-1);
  const left = new Uint8Array(trips.length);
  const noOriginCar = new Uint8Array(trips.length);
  const searching = new Uint8Array(trips.length);
  const searchStart = new Float64Array(trips.length).fill(NaN);
  const searchTime = new Float64Array(trips.length);
  const walking = new Float64Array(trips.length);
  const rejected = new Map<number, Set<number>>();
  const homeBeyond: string[] = [];
  const homeDistances: number[] = [];
  const beyondRadius: NonNullable<Metrics['parking']['home']>['beyondRadius'] = [];
  let arrivals = 0;
  let parkedWithoutExit = 0;
  let totalSearch = 0;
  const available = occupied.slice();
  const availableSpaces = stock.slice();
  const carsLeft = new Map<number, number>();
  const carsAt = (place: number, own: CompiledCity['parking']) =>
    households
      ? homeCarCount(compiled, place)
      : Math.ceil(
          Math.round(
            Math.max(0, ...own.map((f) => f.residents)) * scenario.demand.personsPerResident,
          ) * scenario.demand.carShare,
        );
  // TASK-129: each household car takes a space of its own home's stock, in an order seeded per
  // car rather than by who leaves first. Hand-built trip lists keep first come, first served.
  const firsts = households
    ? [...homeCars.values()]
        .flat()
        .map((id) => ({ id, key: rng.derive(`car:${trips[id]!.carId}`).next() }))
        .sort((a, b) => a.key - b.key || a.id - b.id)
        .map(({ id }) => id)
    : chronology.filter((id) => trips[id]!.mode === 'car' && previous[id] === -1);
  for (const id of firsts) {
    const trip = trips[id]!;
    const place = compiled.index.place.get(trip.originPlaceId);
    if (place !== undefined && compiled.places[place]!.kind === 'gateway') continue;
    const own = compiled.parking.filter((f) => f.place === place);
    const ours = (s: number) =>
      departure(id).spaces[s] &&
      availableSpaces[s] !== -1 &&
      (!households || slotHome[s] === place);
    const street =
      small(id) && prefersStreet(id) ? nearHome(place!).filter((f) => f.kind !== 'garage') : [];
    if (!carsLeft.has(place!)) carsLeft.set(place!, carsAt(place!, own));
    const facility =
      [...street, ...own, ...(small(id) ? nearHome(place!) : [])].find(
        (f) =>
          departure(id).facilities[f.idx] &&
          available[f.idx]! > 0 &&
          (small(id) || f.kind === 'garage') &&
          (f.kind === 'garage' || usableSpaces(f).some(ours)),
      ) ??
      // Neighbours may have taken the street cars moved out of this home's garage; an
      // inferred home garage stands in for parking OSM does not map and admits every car,
      // so a resident's car starts there while the home has residents' cars left (lead,
      // TASK-103 follow-up).
      ((carsLeft.get(place!) ?? 0) > 0
        ? own.find((f) => f.kind === 'garage' && soft(f) && departure(id).facilities[f.idx])
        : undefined);
    carsLeft.set(place!, carsLeft.get(place!)! - 1);
    origins[id] = facility?.idx ?? -1;
    if (facility) {
      available[facility.idx]!--;
      const eligible = usableSpaces(facility).filter(ours);
      const slot = eligible.length ? rng.derive(`origin:${trip.id}`).pick(eligible) : undefined;
      if (slot !== undefined) {
        originSpaces[id] = slot;
        availableSpaces[slot] = -1;
        classes[slot] = vehicles.vclass[id]!;
        stockCar[slot] = id;
      }
    } else if (own.length) noOriginCar[id] = 1;
  }
  const destinationPlace = (id: number) =>
    compiled.places[compiled.index.place.get(trips[id]!.destinationPlaceId)!]!;
  const requiresExit = (id: number) =>
    id >= 0 &&
    nextTrip[id] !== -1 &&
    compiled.places[compiled.index.place.get(trips[id]!.originPlaceId)!]!.kind !== 'gateway';
  const distance = (id: number, facility: number) => {
    const a = destinationPlace(id).centroid,
      b = compiled.parking[facility]!.centroid;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const candidates = new Map<string, CompiledCity['parking']>();
  const facilitiesFor = (id: number) => {
    const destination = destinationPlace(id);
    if (destination.kind === 'gateway') return [];
    const streetFirst = destination.kind === 'residential' && small(id) && prefersStreet(id);
    const key = `${destination.idx}:${small(id)}:${streetFirst}`;
    const cached = candidates.get(key);
    if (cached) return cached;
    const visit = !['residential', 'work', 'school'].includes(destination.kind);
    const rank = (f: CompiledCity['parking'][number]) => {
      // A lot serving the destination as its own car park comes first (lead, TASK-103 follow-up).
      if (f.access !== 'public' && served[f.idx]?.has(destination.idx)) return -1;
      const beyond = distance(id, f.idx) > params.parkingSearchRadiusM;
      const visible = f.kind !== 'garage';
      const ownGarage = f.kind === 'garage' && f.place === destination.idx;
      if ((visit || streetFirst) && visible && !beyond) return 0;
      if (ownGarage) return visit || streetFirst ? 1 : 0;
      if (visible && !beyond) return 1;
      return beyond ? 3 : 2;
    };
    const result = compiled.parking
      .filter(
        (f) =>
          f.connectorsIn.length &&
          (small(id) || f.kind === 'garage') &&
          (serves(f, destination.idx) || f.access === 'public'),
      )
      .sort(
        (a, b) => rank(a) - rank(b) || distance(id, a.idx) - distance(id, b.idx) || a.idx - b.idx,
      );
    candidates.set(key, result);
    return result;
  };
  function required(id: number) {
    const destination = destinationPlace(id);
    // Zero-demand legacy portals (including event gates) retain their admission semantics.
    return (
      destination.kind !== 'gateway' &&
      compiled.parking.some((f) => serves(f, destination.idx) || f.access === 'public')
    );
  }
  /** `atDeparture`: room now is only a forecast. When every admissible facility is full, the car
   * still heads for the first one in choice order that has slots at all; the entry check
   * rejects it if that one is still full on arrival (a home garage empties as its residents
   * leave). */
  function choose(
    id: number,
    timeS: number,
    accept: (connector: number) => boolean | number,
    atDeparture = false,
  ) {
    clockS = timeS;
    release(id, timeS);
    const home = id >= 0 && goingHome[id] === 1;
    const withinHome = (f: CompiledCity['parking'][number]) =>
      distance(id, f.idx) <= params.homeParkingRadiusM ||
      (soft(f) && f.place === destinationPlace(id).idx);
    // TASK-129: a car going home chooses only within the home radius, where it also heads for a
    // full facility and searches on from there, as at departure. It looks beyond the radius only
    // when nothing within admits it any more.
    for (const within of home ? [true, false] : [null]) {
      if (within === false) homeBeyond[id] = beyondReason(id, withinHome);
      // TASK-122: prefer an available, reachable space with an exit nearby. Otherwise retain the
      // legacy choice, rather than forecasting an occupied safe strip and cruising until it
      // empties. TASK-125: a choice with room claims its space (strip) or one place (garage, lot).
      for (const checkExit of requiresExit(id) ? [true, false] : [false])
        for (const needRoom of checkExit || !(atDeparture || within) ? [true] : [true, false])
          for (const f of facilitiesFor(id)) {
            if (within !== null && withinHome(f) !== within) continue;
            if (checkExit && distance(id, f.idx) > params.parkingSearchRadiusM) continue;
            if (
              (needRoom ? !hasRoom(f) : f.capacity === 0) ||
              (!checkExit && !(within && needRoom) && rejected.get(id)?.has(f.idx))
            )
              continue;
            if (
              needRoom &&
              !soft(f) &&
              occupied[f.idx]! + enRoute[f.idx]! - (heading[id] === f.idx ? 1 : 0) >= f.capacity
            )
              continue;
            if (checkExit && !departure(nextTrip[id]!).facilities[f.idx]) continue;
            let selected = -1;
            let bestCostS = Infinity;
            for (const connector of f.kind === 'roadside'
              ? shuffled(f.connectorsIn, `arrival:${trips[id]!.id}`)
              : f.connectorsIn) {
              if (
                !parkingConnectorPermitted(
                  compiled,
                  connector,
                  trips[id]!.vehicleClass,
                  trips[id]!.purpose,
                  'in',
                )
              )
                continue;
              if (
                f.kind !== 'garage' &&
                (needRoom || checkExit) &&
                !hasFreeSpace(connector, id, needRoom, checkExit)
              )
                continue;
              const accepted = accept(connector);
              if (accepted === false) continue;
              if (
                f.kind === 'lot' &&
                f.source.mappedPortals?.length &&
                typeof accepted === 'number'
              ) {
                if (accepted < bestCostS) {
                  selected = connector;
                  bestCostS = accepted;
                }
              } else {
                selected = connector;
                break;
              }
            }
            if (selected === -1) continue;
            vehicles.destination[id] = selected;
            chosen[id] = f.idx;
            allowWithoutExit[id] = Number(requiresExit(id) && !checkExit);
            // TASK-153: the forecast for the full facility a car is leaving claims the place its
            // own car frees, so a later choice cannot take it (TASK-151's van 2796 at pk:2056).
            const exact = f.kind === 'roadside' || !!f.source.mappedPortals?.length;
            const vacated =
              !needRoom &&
              !soft(f) &&
              !left[id] &&
              originFacility(id) === f.idx &&
              occupied[f.idx]! - 1 + enRoute[f.idx]! - (heading[id] === f.idx ? 1 : 0) < f.capacity
                ? originSpace(id)
                : undefined;
            const slot =
              exact && (needRoom || vacated !== undefined)
                ? freeSpace(selected, id, vacated)
                : undefined;
            if (!soft(f) && (needRoom || (vacated !== undefined && (!exact || slot)))) {
              head(id, f.idx);
              claimSince[id] = timeS;
              if (slot) {
                claimedSpaces[id] = slot.idx;
                claimedBy[slot.idx] = id;
              }
            }
            cachedHash = undefined;
            walking[id] = distance(id, f.idx);
            if (!serves(f, destinationPlace(id).idx)) searching[id] = 1;
            return true;
          }
    }
    if (searching[id] && !Number.isNaN(searchStart[id])) searchTime[id] = timeS - searchStart[id]!;
    return false;
  }
  /** Why a car going home looks beyond the radius: nothing there admits it at all, or each
   * facility there is full or claimed, or has room the car cannot reach. */
  function beyondReason(id: number, within: (f: CompiledCity['parking'][number]) => boolean) {
    const near = facilitiesFor(id).filter(within);
    if (!near.length) return 'no facility within the radius';
    const room = near.some(
      (f) =>
        hasRoom(f) &&
        (soft(f) ||
          occupied[f.idx]! + enRoute[f.idx]! - (heading[id] === f.idx ? 1 : 0) < f.capacity) &&
        (f.kind === 'garage' || f.connectorsIn.some((c) => hasFreeSpace(c, id, true, false))),
    );
    return room ? 'free space within the radius unreachable' : 'within the radius full or claimed';
  }
  function originFacility(id: number) {
    const before = previous[id]!;
    return before === -1 ? origins[id]! : parked[before]!;
  }
  function originSpace(id: number) {
    return previous[id] === -1 ? originSpaces[id]! : parkedSpaces[previous[id]!]!;
  }
  function claimReachable(city: CompiledCity, connector: number, slot: number, id: number) {
    const c = city.connectors[connector],
      space = city.parkingSpaces?.[slot];
    if (!c || c.direction === 'out' || !space || c.parking !== space.parking) return false;
    if (
      !parkingConnectorPermitted(city, connector, trips[id]!.vehicleClass, trips[id]!.purpose, 'in')
    )
      return false;
    const f = city.parking[space.parking]!;
    if (f.kind === 'roadside') {
      if (space.connector !== connector) return false;
    } else {
      const graph =
        city === compiled ? lotGraph(f.idx) : city.lots?.find((l) => l.id === f.id)?.circulation;
      const entry = graph?.entries.find((e) => e.connector === connector && e.direction !== 'out');
      if (
        graph?.unreachable.includes(space.lotStall!) ||
        !Number.isFinite(entry?.distances[graph?.stallNodes[space.lotStall!] ?? -1])
      )
        return false;
    }
    if (!requiresExit(id) || allowWithoutExit[id]) return true;
    const later = nextTrip[id]!,
      trip = trips[later]!;
    const exits =
      city === compiled
        ? departure(later)
        : parkingEgress(
            city,
            params.laneChangeDistanceM,
            trip.vehicleClass,
            trip.purpose === 'delivery',
          );
    return !!exits.spaces[slot];
  }
  /** `vacated`: the space a car choosing as it leaves frees (TASK-153). */
  function freeSpace(connector: number, id: number, vacated = -1) {
    const f = compiled.parking[compiled.connectors[connector]!.parking ?? -1];
    if (!f || f.kind === 'garage') return undefined;
    const claim = claimedSpaces[id]!;
    if (claim >= 0)
      return claimReachable(compiled, connector, claim, id) ? spaces[claim] : undefined;
    const scores = spaceScores(connector, id, vacated);
    if (!scores.length) return undefined;
    if (f.kind !== 'lot' || id < 0) return scores[0]!.slot;
    const good = scores.filter(
      (s) => s.score <= scores[0]!.score + params.stallChoiceSlackM + 1e-9,
    );
    return rng.derive(`stall:${trips[id]!.id}`).pick(good).slot;
  }
  /** The free spaces this car may take from `connector`, best first. */
  function spaceScores(connector: number, id: number, vacated = -1) {
    const c = compiled.connectors[connector]!,
      f = compiled.parking[c.parking!]!;
    const point = pointAtDistance(
      compiled.lanes[c.lane]!.polyline,
      compiled.lanes[c.lane]!.cumulative,
      c.positionM,
    );
    const scores: { slot: (typeof spaces)[number]; score: number }[] = [];
    const checkExit = requiresExit(id) && !allowWithoutExit[id];
    const graph = lotGraph(f.idx),
      entry = graph?.entries.find((e) => e.connector === connector && e.direction !== 'out');
    for (const i of usableSpaces(f)) {
      const s = spaces[i]!;
      if (
        (stock[i] !== -1 && i !== vacated) ||
        (reserved[i] !== -1 && reserved[i] !== id) ||
        (claimedBy[i] !== -1 && claimedBy[i] !== id)
      )
        continue;
      // A roadside driver must stop at the target slot, not another car's slot farther along.
      if (f.kind === 'roadside' && s.connector !== connector) continue;
      if (checkExit && !departure(nextTrip[id]!).spaces[i]) continue;
      const node = graph?.stallNodes[s.lotStall!];
      const pathLength =
        f.kind === 'lot'
          ? (entry?.distances[node ?? -1] ?? Infinity)
          : pointDistance(s.position, point);
      if (!Number.isFinite(pathLength)) continue;
      scores.push({
        slot: s,
        score:
          pathLength +
          (f.kind === 'lot' && id >= 0
            ? pointDistance(s.position, destinationPlace(id).centroid)
            : 0),
      });
    }
    return scores.sort((a, b) => a.score - b.score || a.slot.idx - b.slot.idx);
  }
  function hasFreeSpace(
    connector: number,
    id: number,
    needRoom = true,
    checkExit = requiresExit(id) && !allowWithoutExit[id],
  ) {
    const c = compiled.connectors[connector]!,
      f = compiled.parking[c.parking ?? -1];
    if (!f || f.kind === 'garage') return false;
    const graph = lotGraph(f.idx),
      entry = graph?.entries.find((e) => e.connector === connector && e.direction !== 'out');
    return usableSpaces(f).some(
      (i) =>
        (!needRoom ||
          (stock[i] === -1 &&
            (reserved[i] === -1 || reserved[i] === id) &&
            (claimedBy[i] === -1 || claimedBy[i] === id))) &&
        (f.kind === 'roadside'
          ? spaces[i]!.connector === connector
          : Number.isFinite(entry?.distances[graph!.stallNodes[spaces[i]!.lotStall!]!])) &&
        (!checkExit || departure(nextTrip[id]!).spaces[i]),
    );
  }
  function beginSearch(id: number, timeS: number) {
    searching[id] = 1;
    if (Number.isNaN(searchStart[id])) searchStart[id] = timeS;
  }
  const motions = new Map<number, ParkingMotion>();
  let approachReach = new Float64Array(spaces.length * 2).fill(NaN);
  /** TASK-164: the nearest lane station a lot bay's departure sweeps while it backs out. */
  let leaveRear = new Float64Array(spaces.length * 2).fill(NaN);
  const clearHolds = new Map<number, boolean>();
  /** TASK-164: by bay, the exits its departure does not drive past. */
  const missed = new Map<number, number[]>();
  const departureMissed = (slot: number) => {
    let exits = missed.get(slot);
    if (!exits) missed.set(slot, (exits = departureMisses(compiled, slot)));
    return exits;
  };
  const drives = new Map<
    number,
    { path: MotionPath; holdM: number; joinM: number; crossings: LaneCrossing[] }
  >();
  /** TASK-157: by lane, the spans merging lot cars are crossing. */
  const crossing = new Map<number, { fromM: number; toM: number }[]>();
  const motionById = Array<ParkingMotion | undefined>(trips.length).fill(undefined);
  const setMotion = (id: number, m: ParkingMotion) => {
    motions.set(id, m);
    motionById[id] = m;
  };
  const removeMotion = (id: number) => {
    motions.delete(id);
    motionById[id] = undefined;
  };
  const choiceRank = new Uint32Array(trips.length),
    choiceScore = new Float64Array(trips.length),
    bestScore = new Float64Array(trips.length);
  let lotArrivals = 0,
    lotChoices = 0,
    totalEntryToPark = 0,
    totalDrive = 0,
    lotLeaves = 0,
    totalLeave = 0,
    stripManoeuvres = 0,
    totalRank = 0;
  const length = (id: number) =>
    params.vehicleClasses[
      id === -1 ? 'car' : (['car', 'van', 'truck', 'bus'] as const)[vehicles.vclass[id]!]!
    ].lengthM;
  const width = (id: number) =>
    params.vehicleClasses[vehicles.vclass[id] === 0 ? 'car' : 'van'].widthM;
  const lanePose = (connector: number, positionM = compiled.connectors[connector]!.positionM) => {
    const l = compiled.lanes[compiled.connectors[connector]!.lane]!;
    return {
      ...pointAtDistance(l.polyline, l.cumulative, positionM),
      heading: headingAtDistance(l.polyline, l.cumulative, positionM),
    };
  };
  const localPath = (slot: number, connector: number, reverse = false) => {
    const space = spaces[slot]!,
      graph = lotGraph(space.parking)!;
    const nodes = lotPath(graph, connector, space.lotStall!, reverse ? 'out' : 'in');
    if (!nodes) throw new Error('Reserved stall has no circulation path');
    if (reverse) nodes.reverse();
    const points = nodes.map((i) => graph.nodes[i]!);
    if (points.length === 1) points.push(points[0]!);
    return motionPath(points);
  };
  /** Whether a parked car leaving by `connector` starts in its lot: not by its bay's departure. */
  const isLotSpace = (id: number, connector: number) => {
    const slot = spaces[originSpace(id)];
    return (
      !!slot &&
      compiled.parking[slot.parking]!.kind === 'lot' &&
      slot.departure !== connector &&
      !left[id]
    );
  };
  const leavingLot = (m: ParkingMotion) =>
    m.lot &&
    (m.phase === 'leave' || m.phase === 'drive_out' || m.phase === 'exit' || m.phase === 'merge');
  const lotBusy = (facility: number, leaving: boolean, connector: number) =>
    [...motions.values()].some(
      (m) =>
        m.lot &&
        spaces[m.slot]!.parking === facility &&
        (leavingLot(m) !== leaving || m.connector !== connector),
    );
  /** TASK-157: the lanes a car leaving a lot by `exit` meets at grade: the exit road's other
   * lanes, the other carriageway of its street, and the roads meeting it at either end. Other
   * roads drawn across a lot (the bridges above Munich pk:2049) are not crossed, and the lot's
   * own aisles are left to TASK-156. */
  function streetLanes(facility: number, exit: number) {
    const aisles = compiled.lots?.find((l) => l.id === compiled.parking[facility]!.id)?.aisles,
      road = compiled.roads[compiled.lanes[exit]!.road]!;
    return compiled.roads
      .filter(
        (r) =>
          r === road ||
          (road.corridorId !== null && r.corridorId === road.corridorId) ||
          [r.from, r.to].some((n) => n === road.from || n === road.to),
      )
      .filter((r) => !aisles?.includes(r.id))
      .flatMap((r) => r.lanes.map((i) => compiled.lanes[i]!));
  }
  /** A lot bay's exits for this car: permitted, reached by circulation, nearest first. */
  function lotExits(id: number, slot: CParkingSpace) {
    const facility = compiled.parking[slot.parking]!,
      graph = lotGraph(slot.parking)!;
    const distance = (c: number) =>
      graph.entries.find((e) => e.connector === c && e.direction !== 'in')!.distances[
        graph.stallNodes[slot.lotStall!]!
      ]!;
    return facility.connectorsOut
      .filter(
        (c) =>
          parkingConnectorPermitted(
            compiled,
            c,
            trips[id]!.vehicleClass,
            trips[id]!.purpose,
            'out',
          ) && !!lotPath(graph, c, slot.lotStall!, 'out'),
      )
      .sort((a, b) => distance(a) - distance(b) || a - b);
  }
  /** TASK-152: whether a lot exit's drive-out has a pose clear of its exit lane. TASK-164: and
   * whether the hold the car takes there is clear of the stretch of every aisle lane of its lot
   * that a lane car can stand in, the lane's ends respected. Sindelfingen pk:1487's holds for
   * c:2640 stand in an interior junction of its aisles: `bodyClearLane` extends the exit lane's
   * band back past its start, so the hold stops short of the junction's far side. A hold at the
   * mouth end of the aisle it drives (a lane no lane car can stand in there) stays clear. */
  function clearExit(id: number, slot: number, connector: number) {
    const key = (slot * compiled.connectors.length + connector) * 2 + vehicles.vclass[id]!;
    let clear = clearHolds.get(key);
    if (clear === undefined) {
      const out = driveOut(id, slot, connector),
        exit = compiled.connectors[connector]!.lane,
        pose = pathPose(out.path, out.holdM),
        body = corners(pose, length(id), width(id));
      clear =
        holdProgress(out.path, compiled.lanes[exit]!, length(id), width(id)) >= 0 &&
        aisleSegments[spaces[slot]!.parking]!.stands.every(({ lane, band, fromM, toM }) => {
          if (lane === exit || bodyClearOf(pose, band, length(id), width(id))) return true;
          const at = body.map((p) => nearestOnPolyline(band.polyline, p).along);
          return Math.max(...at) <= fromM - length(id) + 1e-6 || Math.min(...at) >= toM - 1e-6;
        });
      clearHolds.set(key, clear);
    }
    return clear;
  }
  /** TASK-150: a lot departure's drive-out path, its hold, and the lane station where it joins
   * from the hold. TASK-157: the hold is clear of every lane the body would stand in, and the
   * merge lists the lanes it crosses before the exit lane. */
  function driveOut(id: number, slot: number, connector: number) {
    const key = (slot * compiled.connectors.length + connector) * 2 + vehicles.vclass[id]!;
    let out = drives.get(key);
    if (out) return out;
    const path = localPath(slot, connector, true),
      c = compiled.connectors[connector]!,
      lane = compiled.lanes[c.lane]!,
      street = streetLanes(spaces[slot]!.parking, lane.idx);
    const holdM = lotHold(path, lane, street, length(id), width(id));
    const hold = pathPose(path, holdM),
      joinM = joinStation(hold, lane, c.positionM),
      merge = manoeuvrePath(hold, lanePose(connector, joinM), false);
    const crossings = laneCrossings(merge, lane, street, length(id), width(id));
    drives.set(key, (out = { path, holdM, joinM, crossings }));
    return out;
  }
  /** TASK-153: the departure's spawn gap is checked at its join station, which can lie short
   * of its connector, so the yield keeps the arriving car clear of both. TASK-157: a car turning
   * in from a lane the merge crosses stops short of the span the crossing checks there. */
  function sharedMouthStop(
    arriving: number,
    leaving: number,
    exit: number,
    way: { joinM: number; crossings: LaneCrossing[] },
  ) {
    const into = compiled.connectors[vehicles.destination[arriving]!],
      out = compiled.connectors[exit]!;
    if (!into || into.parking !== out.parking) return Infinity;
    const gap = Math.max(params.spawnMinGapM, params.idm.minGapM);
    const crossing = way.crossings.find((c) => c.lane === into.lane);
    const [stop, past] =
      into.lane === out.lane
        ? [
            Math.min(out.positionM, way.joinM) - length(leaving) - gap - 0.1,
            Math.max(out.positionM, way.joinM),
          ]
        : crossing
          ? [crossing.fromM - gap - 0.1, crossing.toM]
          : [-Infinity, -Infinity];
    return into.positionM >= stop && into.positionM < past + length(arriving) + gap
      ? stop
      : Infinity;
  }
  function arrivalBlocksDeparture(
    leaving: number,
    exit: number,
    way: { joinM: number; crossings: LaneCrossing[] },
  ) {
    const lanes = [compiled.connectors[exit]!.lane, ...way.crossings.map((c) => c.lane)];
    const approaches = lanes.flatMap((idx) => {
      const lane = compiled.lanes[idx]!;
      return [
        { lane: idx, segment: idx, offset: 0 },
        ...lane.in.flatMap((i) => {
          const movement = compiled.movements[i]!,
            from = compiled.lanes[movement.fromLane]!;
          return [
            { lane: idx, segment: -i - 1, offset: movement.lengthM },
            { lane: idx, segment: from.idx, offset: from.lengthM + movement.lengthM },
          ];
        }),
      ];
    });
    for (const { lane, segment, offset } of approaches)
      for (let id = vehicles.first(segment); id !== -1; id = vehicles.next[id]!) {
        if (compiled.connectors[vehicles.destination[id]!]?.lane !== lane) continue;
        const stop = sharedMouthStop(id, leaving, exit, way);
        if (!Number.isFinite(stop)) continue;
        const speed = vehicles.speed[id]!,
          profile = params.vehicleClasses[vehicleClasses[vehicles.vclass[id]!]!];
        const braking =
          (speed * speed) / (2 * params.idm.bMps2 * profile.decelFactor) +
          speed * params.dtS +
          params.idm.minGapM;
        if (vehicles.position[id]! - offset + braking >= stop) return true;
      }
    return false;
  }
  /** TASK-153: where a departing car stands and will drive until it has joined the lane: body
   * segments along the rest of its leave manoeuvre, drive-out to the hold, and merge. */
  function departureBodies(other: number, m: ParkingMotion) {
    const routes: [MotionPath, number, number][] = [];
    let hold = m.pose;
    if (m.phase !== 'exit')
      routes.push([m.path, m.progressM, m.phase === 'drive_out' ? m.holdM : m.path.lengthM]);
    if (m.phase === 'leave') {
      const out = localPath(m.slot, m.connector, true);
      routes.push([out, 0, m.holdM]);
      hold = pathPose(out, m.holdM);
    } else if (m.phase === 'drive_out') hold = pathPose(m.path, m.holdM);
    if (m.phase !== 'merge') {
      const merge = manoeuvrePath(hold, lanePose(m.connector, m.joinM), false);
      routes.push([merge, 0, merge.lengthM]);
    }
    const bodies = [body(m.pose, length(other))];
    for (const [path, from, to] of routes)
      for (let at = from; ; at = Math.min(to, at + 0.5)) {
        bodies.push(body(pathPose(path, at), length(other)));
        if (at >= to) break;
      }
    return bodies;
  }
  const body = (pose: ParkingPose, lengthM: number) => [
    { x: pose.x - Math.cos(pose.heading) * lengthM, y: pose.y - Math.sin(pose.heading) * lengthM },
    pose,
  ];
  /** Corners of a body from its front bumper, `aheadM` longer at the front. */
  const corners = (pose: ParkingPose, lengthM: number, widthM: number, aheadM = 0) => {
    const c = Math.cos(pose.heading),
      s = Math.sin(pose.heading);
    return [
      [aheadM, -widthM / 2],
      [aheadM, widthM / 2],
      [-lengthM, widthM / 2],
      [-lengthM, -widthM / 2],
    ].map(([a, b]) => ({ x: pose.x + a! * c - b! * s, y: pose.y + a! * s + b! * c }));
  };
  const overlaps = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
    [a, b].every((poly) =>
      poly.every((p, i) => {
        const q = poly[(i + 1) % poly.length]!,
          nx = q.y - p.y,
          ny = p.x - q.x;
        const pa = a.map((v) => v.x * nx + v.y * ny),
          pb = b.map((v) => v.x * nx + v.y * ny);
        return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
      }),
    );
  /** TASK-156: a lot arrival stepping `stepM` to `pose` would move into a lane vehicle on its
   * lot's aisle lanes, or within `minGapM` of one ahead (a kerbside-style departure counts where
   * it is drawn). Cars behind or beside it, and cars bound for this lot, do not hold it. */
  function aisleTraffic(id: number, m: ParkingMotion, pose: ParkingPose, stepM: number) {
    const mine = corners(pose, stepM, width(id), params.idm.minGapM);
    for (const segment of aisleSegments[spaces[m.slot]!.parking]!.segments)
      for (let other = vehicles.first(segment); other !== -1; other = vehicles.next[other]!) {
        const om = motionById[other];
        // Lot motions follow the cohort rules, and a car stopping at one of this lot's entries
        // waits on its admission, which may wait on this very arrival.
        if (
          other === id ||
          om?.lot ||
          compiled.connectors[vehicles.destination[other]!]?.parking === spaces[m.slot]!.parking
        )
          continue;
        const path = segment >= 0 ? compiled.lanes[segment]! : compiled.movements[-segment - 1]!;
        const at = vehicles.position[other]!;
        const theirs = om?.pose ?? {
          ...pointAtDistance(path.polyline, path.cumulative, at),
          heading: headingAtDistance(path.polyline, path.cumulative, at),
        };
        if (overlaps(mine, corners(theirs, length(other), width(other)))) return true;
      }
    return false;
  }
  /** TASK-156: the aisle lane whose band an arriving body is inside (the lane it holds while it
   * still is), and the farthest station its body reaches there. */
  function aisleBand(id: number, m: ParkingMotion, pose: ParkingPose) {
    const rear = body(pose, length(id))[0]!;
    let band: { lane: number; positionM: number; away: number } | undefined;
    for (const lane of aisleSegments[spaces[m.slot]!.parking]!.lanes) {
      const l = compiled.lanes[lane]!;
      if (bodyClearLane(pose, l, length(id), width(id))) continue;
      // bodyClearLane extends a band past the lane's ends; only the lane itself counts here.
      const front = nearestOnPolyline(l.polyline, pose),
        back = nearestOnPolyline(l.polyline, rear),
        inside = (along: number) => along > 1e-6 && along < l.lengthM - 1e-6;
      if (!inside(front.along) && !inside(back.along)) continue;
      const found = { lane, positionM: Math.max(front.along, back.along), away: front.away };
      if (m.laneHeld && lane === m.lane) return found;
      if (!band || found.away < band.away) band = found;
    }
    return band;
  }
  /** TASK-156: room for an arriving body to become a lane's occupant at `positionM`: clear of
   * the car ahead by the following gap, and ahead of the car behind by its braking distance. */
  function laneRoom(id: number, lane: number, positionM: number) {
    for (let other = vehicles.first(lane); other !== -1; other = vehicles.next[other]!) {
      if (other === id) continue;
      const at = vehicles.position[other]!,
        speed = vehicles.speed[other]!;
      if (
        at >= positionM
          ? at - length(other) - params.idm.minGapM < positionM
          : positionM - length(id) - params.idm.minGapM <
            at + (speed * speed) / (2 * params.idm.bMps2) + speed * params.dtS
      )
        return false;
    }
    return true;
  }
  /** The bay and path an arriving car takes if it enters now, or undefined while it waits. */
  function admission(id: number, connector: number) {
    const facility = compiled.parking[compiled.connectors[connector]!.parking ?? -1];
    // One entry cohort at a time; departures are checked against the arrival's own path below.
    if (
      facility?.kind === 'lot' &&
      [...motions.values()].some(
        (m) =>
          m.lot &&
          spaces[m.slot]!.parking === facility.idx &&
          !leavingLot(m) &&
          m.connector !== connector,
      )
    )
      return undefined;
    const free = freeSpace(connector, id);
    if (!free) return undefined;
    let slot = free;
    const lot = compiled.parking[slot.parking]!.kind === 'lot';
    const leader = vehicles.previous[id]!,
      key = slot.idx * 2 + vehicles.vclass[id]!;
    const available =
      leader === -1 ? Infinity : vehicles.position[leader]! - length(leader) - params.idm.minGapM;
    if (!lot && available < approachReach[key]!) return undefined;
    const from = lanePose(connector);
    let path = lot
      ? localPath(slot.idx, connector)
      : manoeuvrePath(from, parkedPose(slot, length(id)), slot.layout === 'parallel');
    if (!lot && leader !== -1) {
      const lane = compiled.lanes[compiled.connectors[connector]!.lane]!;
      const reach = Number.isNaN(approachReach[key])
        ? (approachReach[key] = manoeuvreLaneReach(
            path,
            lane,
            length(id),
            params.vehicleClasses[vehicles.vclass[id] === 0 ? 'car' : 'van'].widthM,
          ))
        : approachReach[key]!;
      if (available < reach) return undefined;
    }
    if (lot) {
      // TASK-153: an arrival enters beside departures, including one holding for a street gap,
      // unless its way to the bay comes within body clearance of where they stand or will go.
      // A bay that is blocked so gives way to the next free one whose way is clear; a claim
      // moves with it.
      const departing = [...motions]
        .filter(([, m]) => leavingLot(m) && spaces[m.slot]!.parking === slot.parking)
        .map(([otherId, m]) => {
          const bodies = departureBodies(otherId, m),
            clearance = (width(id) + width(otherId)) / 2 + 0.3,
            xs = bodies.flat().map((p) => p.x),
            ys = bodies.flat().map((p) => p.y);
          return {
            bodies,
            clearance,
            box: [
              Math.min(...xs) - clearance,
              Math.min(...ys) - clearance,
              Math.max(...xs) + clearance,
              Math.max(...ys) + clearance,
            ],
          };
        });
      const clear = (s: CParkingSpace, p: MotionPath) => {
        const parked = parkedPose(s, length(id)),
          points = [body(parked, length(id))[0]!];
        for (const part of [p, manoeuvrePath(pathPose(p, p.lengthM), parked, false)])
          for (let at = 0; ; at = Math.min(part.lengthM, at + 0.5)) {
            points.push(pathPose(part, at));
            if (at >= part.lengthM) break;
          }
        return !departing.some(({ bodies, clearance, box }) =>
          points.some(
            (q) =>
              q.x >= box[0]! &&
              q.y >= box[1]! &&
              q.x <= box[2]! &&
              q.y <= box[3]! &&
              bodies.some((b) => nearestOnPolyline(b, q).away < clearance),
          ),
        );
      };
      if (departing.length && !clear(slot, path)) {
        const other = spaceScores(connector, id)
          .map((s) => s.slot)
          .find((s) => s !== slot && clear(s, localPath(s.idx, connector)));
        if (!other) return undefined;
        slot = other;
        path = localPath(other.idx, connector);
      }
      if (
        [...motions].some(([otherId, m]) => {
          if (spaces[m.slot]!.parking !== slot.parking) return false;
          const hit = nearestOnPolyline(path.points, m.pose);
          return hit.away < 0.6 && hit.along < length(otherId) + params.idm.minGapM;
        })
      )
        return undefined;
    }
    return { slot, path, from, lot };
  }
  function startArrival(id: number, connector: number, timeS: number) {
    const admitted = admission(id, connector);
    if (!admitted) return false;
    const { slot, path, from, lot } = admitted;
    // TASK-153: a claim moves to the bay the admission gave way to.
    const claim = claimedSpaces[id]!;
    if (lot && claim !== -1 && claim !== slot.idx) {
      claimedBy[claim] = -1;
      claimedSpaces[id] = slot.idx;
      claimedBy[slot.idx] = id;
    }
    reserved[slot.idx] = id;
    manoeuvreSpaces[id] = slot.idx;
    cachedHash = undefined;
    if (lot) {
      const graph = lotGraph(slot.parking)!,
        entry = graph.entries.find((e) => e.connector === connector && e.direction !== 'out')!;
      const scores = usableSpaces(compiled.parking[slot.parking]!)
        .filter((i) => stock[i] === -1 && (reserved[i] === -1 || reserved[i] === id))
        .map((i) => ({
          i,
          score:
            entry.distances[graph.stallNodes[spaces[i]!.lotStall!]!]! +
            pointDistance(spaces[i]!.position, destinationPlace(id).centroid),
        }))
        .filter((s) => Number.isFinite(s.score))
        .sort((a, b) => a.score - b.score || a.i - b.i);
      choiceRank[id] = scores.findIndex((s) => s.i === slot.idx) + 1;
      choiceScore[id] = scores.find((s) => s.i === slot.idx)!.score;
      bestScore[id] = scores[0]!.score;
      totalRank += choiceRank[id]!;
      lotChoices++;
    }
    setMotion(id, {
      phase: lot ? 'drive_in' : 'park',
      lot,
      slot: slot.idx,
      connector,
      lane: compiled.connectors[connector]!.lane,
      path,
      progressM: 0,
      holdM: 0,
      joinM: NaN,
      crossings: [],
      startedS: timeS,
      entryS: timeS,
      driveS: 0,
      laneHeld: !lot,
      pose: from,
      speed: 0,
    });
    // TASK-156: an entry on a public aisle lane keeps the arriving car that lane's occupant.
    const m = motionById[id]!;
    if (lot && aisleBand(id, m, from)?.lane === m.lane) m.laneHeld = true;
    // TASK-164: an entry on a street holds the street lane until the body has left its band,
    // as a kerbside space does.
    if (lot && !m.laneHeld && !aisleSegments[slot.parking]!.segments.includes(m.lane))
      m.laneHeld = true;
    return true;
  }
  function arrive(id: number, connector: number, timeS: number) {
    const f = compiled.connectors[connector]!.parking;
    if (f === undefined) return;
    release(id, timeS);
    cachedHash = undefined;
    if (!hasRoom(compiled.parking[f]!)) throw new Error('Parking admission exceeded capacity');
    if (compiled.parking[f]!.kind !== 'garage') {
      const slot = spaces[manoeuvreSpaces[id]!] ?? freeSpace(connector, id);
      if (!slot || stock[slot.idx] !== -1) throw new Error('Parking slot is occupied');
      stock[slot.idx] = id;
      classes[slot.idx] = vehicles.vclass[id]!;
      reserved[slot.idx] = -1;
      parkedSpaces[id] = slot.idx;
      revision++;
    }
    occupied[f]!++;
    parked[id] = f;
    chosen[id] = f;
    const later = nextTrip[id]!;
    if (
      later !== -1 &&
      !(compiled.parking[f]!.kind === 'garage'
        ? departure(later).facilities[f]
        : departure(later).spaces[parkedSpaces[id]!])
    )
      parkedWithoutExit++;
    if (!Number.isNaN(searchStart[id])) searchTime[id] = timeS - searchStart[id]!;
    if (goingHome[id]) {
      const distanceM = distance(id, f);
      homeDistances.push(distanceM);
      if (distanceM > params.homeParkingRadiusM && !soft(compiled.parking[f]!))
        beyondRadius.push({
          tripId: trips[id]!.id,
          facility: compiled.parking[f]!.id,
          distanceM,
          reason: homeBeyond[id] ?? 'unknown',
        });
    }
    arrivals++;
    totalSearch += searchTime[id]!;
  }
  function nextPath(
    m: ParkingMotion,
    path: MotionPath,
    phase: ParkingMotion['phase'],
    timeS: number,
  ) {
    m.path = path;
    m.phase = phase;
    m.progressM = 0;
    m.startedS = timeS;
  }
  const pathMeetings = new WeakMap<
    MotionPath,
    WeakMap<MotionPath, { at: number; along: number }[]>
  >();
  function meetings(path: MotionPath, other: MotionPath) {
    let byOther = pathMeetings.get(path);
    if (!byOther) pathMeetings.set(path, (byOther = new WeakMap()));
    let shared = byOther.get(other);
    if (!shared) {
      shared = [];
      for (let i = 1; i < path.points.length; i++) {
        const hit = nearestOnPolyline(other.points, path.points[i]!);
        if (hit.away <= 0.01) shared.push({ at: path.cumulative[i]!, along: hit.along });
      }
      byOther.set(other, shared);
    }
    return shared;
  }

  function advance(
    timeS: number,
    callbacks: {
      clearLane: (id: number) => void;
      park: (id: number, connector: number) => void;
      exit: (id: number, connector: number, joinM: number, crossings: LaneCrossing[]) => boolean;
      resume: (id: number, connector: number) => void;
      /** TASK-156: make a lot arrival `lane`'s occupant at `positionM`, or none (-1). */
      occupy?: (id: number, lane: number, positionM: number, speed: number) => void;
    },
  ) {
    clockS = timeS;
    const active = [...motions].sort((a, b) => b[1].progressM - a[1].progressM || a[0] - b[0]);
    const cohorts = new Map<number, typeof active>();
    for (const pair of active) {
      const facility = spaces[pair[1].slot]!.parking;
      let cohort = cohorts.get(facility);
      if (!cohort) cohorts.set(facility, (cohort = []));
      cohort.push(pair);
    }
    for (const [id, m] of active) {
      const space = spaces[m.slot]!,
        before = m.pose;
      if (m.phase === 'exit') {
        // The car holds clear of the lane. A grant inserts it where it joins (the engine may
        // stop short at a destination), which reserves its gap for following traffic before
        // its body crosses the lane edge. TASK-157: the grant also needs a crossing gap on each
        // lane the merge crosses first, which it then holds as a standing obstacle.
        m.speed = 0;
        if (callbacks.exit(id, m.connector, m.joinM, m.crossings)) {
          lotLeaves++;
          totalLeave += timeS - m.entryS;
          totalDrive += m.driveS;
          if (vehicles.state[id] === FAILED) removeMotion(id);
          else {
            const to = lanePose(m.connector, vehicles.position[id]!);
            nextPath(m, manoeuvrePath(m.pose, to, false), 'merge', timeS);
            m.laneHeld = true;
          }
        }
        continue;
      }
      if (m.phase === 'merge' && m.progressM >= m.path.lengthM - 1e-8) {
        // Hand over one step after arrival, so the last moving pose keeps its speed.
        removeMotion(id);
        continue;
      }
      const driving = m.phase === 'drive_in' || m.phase === 'drive_out';
      const duration =
        m.phase === 'leave' ? params.leaveManoeuvreS : params.parkManoeuvreS[space.layout];
      const end = m.phase === 'drive_out' ? m.holdM : m.path.lengthM;
      let target =
        driving || m.phase === 'merge'
          ? Math.min(end, m.progressM + params.lotSpeedMps * params.dtS)
          : (() => {
              const u = Math.min(1, (timeS - m.startedS) / Math.max(duration, params.dtS));
              return m.path.lengthM * u * u * (3 - 2 * u);
            })();
      if (driving) {
        for (const [otherId, other] of cohorts.get(space.parking)!) {
          if (
            otherId === id ||
            !motions.has(otherId) ||
            spaces[other.slot]!.parking !== space.parking
          )
            continue;
          // Neither following nor merge clearance can reach beyond both bodies and gaps.
          const reach =
              length(id) +
              length(otherId) +
              2 * params.idm.minGapM +
              params.lotSpeedMps * params.dtS +
              1,
            dx = other.pose.x - before.x,
            dy = other.pose.y - before.y;
          if (dx * dx + dy * dy > reach * reach) continue;
          const hit = nearestOnPolyline(m.path.points, other.pose);
          if (hit.away < 0.6 && hit.along >= m.progressM - 1e-6)
            target = Math.min(
              target,
              Math.max(m.progressM, hit.along - length(otherId) - params.idm.minGapM),
            );
          // The first shared vertex is a merge. Whoever is already across it keeps it
          // until their rear clears; simultaneous approaches use distance, then id.
          for (const { at, along } of meetings(m.path, other.path)) {
            if (at < m.progressM - 1e-6 || at > target + length(id) + params.idm.minGapM) continue;
            const remaining = along - other.progressM;
            if (
              remaining < -length(otherId) - params.idm.minGapM ||
              remaining > length(otherId) + params.idm.minGapM
            )
              continue;
            const own = at - m.progressM;
            if (
              remaining <= 0 ||
              remaining < own - 1e-6 ||
              (Math.abs(remaining - own) < 1e-6 && otherId < id)
            )
              target = Math.min(target, Math.max(m.progressM, at - params.idm.minGapM));
          }
        }
        m.driveS += params.dtS;
      }
      let pose = pathPose(m.path, target);
      const arriving = m.lot && (m.phase === 'drive_in' || m.phase === 'park');
      if (arriving && m.phase === 'drive_in' && target > m.progressM) {
        // TASK-156: an arrival waits clear of aisle traffic, and enters an aisle lane's band
        // only where it has room to be that lane's occupant.
        const band = aisleBand(id, m, pose);
        if (
          aisleTraffic(id, m, pose, target - m.progressM) ||
          (band &&
            !(m.laneHeld && band.lane === m.lane) &&
            !laneRoom(id, band.lane, band.positionM))
        ) {
          target = m.progressM;
          pose = m.pose;
        }
      }
      m.progressM = target;
      m.pose = pose;
      m.speed = pointDistance(before, m.pose) / params.dtS;
      if (arriving && m.laneHeld && !aisleSegments[space.parking]!.segments.includes(m.lane)) {
        if (bodyClearOf(pose, compiled.lanes[m.lane]!, length(id), width(id))) {
          callbacks.occupy?.(id, -1, 0, 0);
          m.laneHeld = false;
        }
      } else if (arriving) {
        const band = aisleBand(id, m, pose);
        if (band) {
          const held = m.laneHeld && band.lane === m.lane;
          callbacks.occupy?.(
            id,
            band.lane,
            held ? Math.max(vehicles.position[id]!, band.positionM) : band.positionM,
            m.speed,
          );
          m.lane = band.lane;
          m.laneHeld = true;
        } else if (m.laneHeld) {
          callbacks.occupy?.(id, -1, 0, 0);
          m.laneHeld = false;
        }
      }
      if (
        !m.lot &&
        m.phase === 'park' &&
        m.laneHeld &&
        bodyClearLane(
          m.pose,
          compiled.lanes[m.lane]!,
          length(id),
          params.vehicleClasses[vehicles.vclass[id] === 0 ? 'car' : 'van'].widthM,
        )
      ) {
        callbacks.clearLane(id);
        m.laneHeld = false;
      }
      if (target < end - 1e-8) continue;
      if (m.phase === 'drive_in') {
        nextPath(m, manoeuvrePath(m.pose, parkedPose(space, length(id)), false), 'park', timeS);
      } else if (m.phase === 'park') {
        if (m.laneHeld && m.lot) callbacks.occupy?.(id, -1, 0, 0);
        else if (m.laneHeld) callbacks.clearLane(id);
        arrive(id, m.connector, timeS);
        if (m.lot) {
          lotArrivals++;
          totalEntryToPark += timeS - m.entryS;
          totalDrive += m.driveS;
        } else stripManoeuvres++;
        callbacks.park(id, m.connector);
        removeMotion(id);
      } else if (m.phase === 'leave') {
        reserved[m.slot] = -1;
        cachedHash = undefined;
        if (m.lot) {
          // Its hold and join station were fixed when it left its bay.
          nextPath(m, localPath(m.slot, m.connector, true), 'drive_out', timeS);
        } else {
          if (space.departure === undefined) stripManoeuvres++;
          else {
            lotLeaves++;
            totalLeave += timeS - m.entryS;
          }
          removeMotion(id);
          callbacks.resume(id, m.connector);
        }
      } else if (m.phase === 'drive_out') {
        m.phase = 'exit';
      }
    }
    markCrossings();
  }
  function markCrossings() {
    crossing.clear();
    for (const m of motions.values())
      if (m.phase === 'merge')
        for (const c of m.crossings)
          if (m.progressM < c.untilM) crossing.set(c.lane, [...(crossing.get(c.lane) ?? []), c]);
  }
  return {
    location(id: number, atOrigin = false) {
      const facility = atOrigin ? originFacility(id) : parked[id]!;
      const space = atOrigin ? originSpace(id) : parkedSpaces[id]!;
      return { facility, space };
    },
    advance,
    release,
    assertClaims,
    claimSnapshot(): ParkingClaimsSnapshot {
      return {
        facility: heading.slice(),
        space: claimedSpaces.slice(),
        sinceS: claimSince.slice(),
      };
    },
    restoreClaims(snapshot: ParkingClaimsSnapshot) {
      // The compiled city and stock must match; this restores claims, not the whole run.
      heading = snapshot.facility.slice();
      claimedSpaces = snapshot.space.slice();
      claimSince.set(snapshot.sinceS);
      enRoute.fill(0);
      claimedBy.fill(-1);
      for (let id = 0; id < trips.length; id++) {
        if (heading[id] !== -1) {
          chosen[id] = heading[id]!;
          enRoute[heading[id]!]!++;
        }
        if (claimedSpaces[id] !== -1) claimedBy[claimedSpaces[id]!] = id;
      }
      cachedHash = undefined;
      assertClaims();
    },
    motion: (id: number) => motionById[id],
    startArrival,
    lotArrival: (connector: number) =>
      compiled.parking[compiled.connectors[connector]!.parking ?? -1]?.kind === 'lot',
    arrivalStop(id: number) {
      const destination = compiled.connectors[vehicles.destination[id]!];
      if (compiled.parking[destination?.parking ?? -1]?.kind !== 'lot') return undefined;
      let positionM = Infinity;
      for (const [other, m] of motions)
        if (leavingLot(m))
          positionM = Math.min(positionM, sharedMouthStop(id, other, m.connector, m));
      // TASK-153: a car that would enter at once does not wait for the departure.
      return Number.isFinite(positionM) && !admission(id, destination!.idx)
        ? { lane: destination!.lane, positionM }
        : undefined;
    },
    /** TASK-157: where a lane's traffic from `fromM` on meets a lot car crossing it: the near
     * edge of the crossing span, a standing obstacle until the body has left the lane. */
    crossingStop(lane: number, fromM: number) {
      let stop = Infinity;
      for (const span of crossing.get(lane) ?? [])
        if (span.fromM >= fromM) stop = Math.min(stop, span.fromM);
      return stop;
    },
    /** TASK-157: whether a lot car is crossing a lane between two of its stations. */
    crossingBlocks: (lane: number, fromM: number, toM: number) =>
      crossing.get(lane)?.some((span) => span.fromM < toM && span.toM > fromM) ?? false,
    startsInLot: isLotSpace,
    canStartLot(id: number, connector: number) {
      const slot = spaces[originSpace(id)]!;
      if (lotBusy(slot.parking, true, connector)) return false;
      const way = driveOut(id, slot.idx, connector);
      if (arrivalBlocksDeparture(id, connector, way)) return false;
      const out = pathPose(way.path, 0);
      return ![...motions].some(
        ([otherId, m]) =>
          spaces[m.slot]!.parking === slot.parking &&
          (m.phase === 'leave' ||
            pointDistance(out, m.pose) <
              length(otherId) +
                params.idm.minGapM +
                params.lotSpeedMps * (params.leaveManoeuvreS + params.dtS)),
      );
    },
    required,
    departureRoom(id: number) {
      const slot = spaces[originSpace(id)];
      if (
        !slot ||
        left[id] ||
        (compiled.parking[slot.parking]!.kind !== 'roadside' && slot.departure === undefined)
      )
        return true;
      const c = compiled.connectors[slot.departure ?? slot.connector]!,
        lane = compiled.lanes[c.lane]!,
        key = slot.idx * 2 + vehicles.vclass[id]!;
      const path = () =>
        manoeuvrePath(lanePose(c.idx), parkedPose(slot, length(id)), slot.layout === 'parallel');
      if (Number.isNaN(approachReach[key]))
        approachReach[key] = manoeuvreLaneReach(
          path(),
          lane,
          length(id),
          params.vehicleClasses[vehicles.vclass[id] === 0 ? 'car' : 'van'].widthM,
        );
      const reach = approachReach[key]!;
      for (let other = vehicles.last(c.lane); other !== -1; other = vehicles.previous[other]!) {
        if (vehicles.position[other]! < c.positionM) continue;
        if (vehicles.position[other]! - length(other) - params.idm.minGapM < reach) return false;
        break;
      }
      // TASK-164: a lot bay's departure keeps the same room from the lot's arriving cars in its
      // lane's band that are not the lane's occupants (on a private aisle), now and wherever
      // they can drive along their path at lot speed while it backs out: they keep clear of it
      // as drawn, but cannot keep clear of a body backing towards them.
      if (slot.departure !== undefined && motions.size) {
        if (Number.isNaN(leaveRear[key]))
          leaveRear[key] =
            manoeuvreLaneBounds(path(), lane, length(id), width(id))?.low ??
            c.positionM - length(id);
        for (const [other, m] of motions) {
          if (
            !m.lot ||
            (m.phase !== 'drive_in' && m.phase !== 'park') ||
            spaces[m.slot]!.parking !== slot.parking ||
            (m.laneHeld && m.lane === c.lane)
          )
            continue;
          const until = Math.min(
            m.path.lengthM,
            m.progressM + params.lotSpeedMps * params.leaveManoeuvreS,
          );
          for (let at = m.progressM; ; at = Math.min(until, at + 0.5)) {
            const pose = pathPose(m.path, at);
            if (!bodyClearOf(pose, lane, length(other), width(other))) {
              const stations = corners(pose, length(other), width(other)).map(
                (p) => nearestOnPolyline(lane.polyline, p).along,
              );
              if (
                Math.max(...stations) + params.idm.minGapM > leaveRear[key]! &&
                Math.min(...stations) - params.idm.minGapM < reach
              )
                return false;
            }
            if (at >= until) break;
          }
        }
      }
      return true;
    },
    choose,
    noOriginCar: (id: number) => !!noOriginCar[id],
    /** The car's previous trip, whoever drove it (TASK-129), or -1. */
    carBefore: (id: number) => previous[id]!,
    /** TASK-173: a tour that chose to walk as it departed leaves its car where it is. Its trips
     * leave the car's chain, whose trips before and after it both meet at home, and when the tour
     * began the car's day, its starting place passes to the car's next trip. */
    walked(tour: readonly number[]) {
      const first = tour[0]!,
        last = tour.at(-1)!;
      for (let i = 1; i < tour.length; i++)
        if (previous[tour[i]!] !== tour[i - 1]) throw new Error('A walked tour left its car chain');
      const before = previous[first]!,
        after = nextTrip[last]!;
      if (before !== -1) nextTrip[before] = after;
      if (after !== -1) {
        previous[after] = before;
        if (before === -1) {
          origins[after] = origins[first]!;
          originSpaces[after] = originSpaces[first]!;
          noOriginCar[after] = noOriginCar[first]!;
        }
      }
      const slot = originSpaces[first]!;
      if (before === -1 && slot !== -1) stockCar[slot] = after;
      for (const id of tour) {
        previous[id] = nextTrip[id] = -1;
        origins[id] = originSpaces[id] = -1;
        noOriginCar[id] = 0;
      }
      cachedHash = undefined;
    },
    ready(id: number) {
      const before = previous[id]!;
      return (
        before === -1 || vehicles.state[before] === COMPLETED || vehicles.state[before] === FAILED
      );
    },
    stranded(id: number) {
      return previous[id] !== -1 && vehicles.state[previous[id]!] === FAILED;
    },
    hasOriginFacility: (id: number) => originFacility(id) !== -1,
    exits(id: number, fallback: number[]) {
      const slot = spaces[originSpace(id)];
      if (slot && !left[id]) {
        if (compiled.parking[slot.parking]!.kind !== 'lot') return [slot.connector];
        const exits = lotExits(id, slot);
        // TASK-164: a bay's departure stands for the exits it drives past. Each exit it misses
        // stays offered as a lot exit where that exit's hold is clear (Munich pk:2056, whose
        // aisle lanes reach the west exits but not mapped exit c:10872 onto r:669).
        if (slot.departure !== undefined) {
          const misses = departureMissed(slot.idx);
          return [
            slot.departure,
            ...exits.filter((c) => misses.includes(c) && clearExit(id, slot.idx, c)),
          ];
        }
        // TASK-152: a drive-out with no pose clear of its exit lane runs inside the lane band
        // from the bay; TASK-164: one whose hold stands in an aisle lane's band waits in a lane
        // too. Such an exit is offered only when no other exit is (Sindelfingen pk:1487's c:2640,
        // and its bays beside an aisle lane they cannot legally leave into).
        const clear = exits.filter((c) => clearExit(id, slot.idx, c));
        return clear.length ? clear : exits;
      }
      const f = compiled.parking[originFacility(id)];
      if (!f && previous[id] !== -1 && vehicles.state[previous[id]!] !== COMPLETED) {
        const place = compiled.index.place.get(trips[id]!.originPlaceId);
        const own = compiled.parking
          .filter((f) => f.place === place)
          .flatMap((f) => f.connectorsOut);
        if (own.length) return own;
        if (!fallback.length)
          return compiled.parking
            .filter((f) => f.access === 'public')
            .flatMap((f) => f.connectorsOut);
      }
      return f ? f.connectorsOut : fallback;
    },
    /** TASK-164: an origin exit's weight in the draw. A bay's departure carries the share of
     * every exit it drives past, so each of the bay's exits keeps its share. */
    exitShare(id: number, connector: number) {
      const slot = spaces[originSpace(id)];
      const share = (c: number) => compiled.connectors[c]!.throughputPerMin;
      if (!slot || left[id] || connector !== slot.departure) return share(connector);
      const misses = departureMissed(slot.idx);
      return (
        lotExits(id, slot)
          .filter((c) => !misses.includes(c))
          .reduce((sum, c) => sum + share(c), 0) || share(connector)
      );
    },
    depart(id: number, timeS = scenario.startS, connector = spaces[originSpace(id)]?.connector) {
      if (left[id]) return;
      cachedHash = undefined;
      const facility = originFacility(id);
      if (facility !== -1 && occupied[facility]) occupied[facility]!--;
      const slot = originSpace(id);
      if (slot !== -1) {
        stock[slot] = -1;
        const space = spaces[slot]!;
        if (space.manoeuvre && connector !== undefined) {
          const lot =
            compiled.parking[space.parking]!.kind === 'lot' && connector !== space.departure;
          // No clear pose (a stall beside the lane) holds where the drive-out starts.
          const out = lot ? driveOut(id, slot, connector) : null;
          const to = out ? pathPose(out.path, 0) : lanePose(connector);
          const pose = parkedPose(space, length(id));
          const path = manoeuvrePath(pose, to, space.layout === 'parallel', true);
          reserved[slot] = id;
          setMotion(id, {
            phase: 'leave',
            lot,
            slot,
            connector,
            lane: compiled.connectors[connector]!.lane,
            path,
            progressM: 0,
            holdM: out?.holdM ?? 0,
            joinM: out?.joinM ?? NaN,
            crossings: out?.crossings ?? [],
            startedS: timeS,
            entryS: timeS,
            driveS: 0,
            laneHeld: !lot,
            pose,
            speed: 0,
          });
        }
        revision++;
      }
      left[id] = 1;
    },
    leavingSpace: (id: number) =>
      (!left[id] && originSpace(id) !== -1) || motionById[id]?.phase === 'exit',
    needsManoeuvre(connector: number) {
      const c = compiled.connectors[connector]!,
        f = compiled.parking[c.parking ?? -1];
      return f?.kind !== 'garage' && (f?.spaces ?? []).some((i) => spaces[i]!.manoeuvre);
    },
    /** TASK-173: room for one more car now, counting cars on their way (TASK-125). */
    hasRoom: (facility: number) => {
      const f = compiled.parking[facility]!;
      return soft(f) || occupied[facility]! + enRoute[facility]! < f.capacity;
    },
    full(connector: number, id = -1) {
      const facility = compiled.connectors[connector]!.parking;
      if (facility === undefined) return false;
      const f = compiled.parking[facility]!;
      return (
        (!soft(f) &&
          occupied[facility]! + enRoute[facility]! - (heading[id] === facility ? 1 : 0) >=
            f.capacity) ||
        (f.kind !== 'garage' && !hasFreeSpace(connector, id))
      );
    },
    needsChoice(id: number) {
      if (!requiresExit(id) || Number.isNaN(searchStart[id])) return false;
      const connector = compiled.connectors[vehicles.destination[id]!]!;
      const facility = compiled.parking[connector.parking ?? -1];
      return (
        !!facility &&
        (!!allowWithoutExit[id] ||
          (facility.kind === 'garage' ? !hasRoom(facility) : !hasFreeSpace(connector.idx, id)))
      );
    },
    admits(id: number, connector: number) {
      const f = compiled.parking[compiled.connectors[connector]!.parking ?? -1];
      return (
        !f ||
        ((small(id) || f.kind === 'garage') &&
          (f.access === 'public' || serves(f, destinationPlace(id).idx)))
      );
    },
    beginSearch,
    approach(id: number, lane: number, positionM: number, timeS: number) {
      if (!searching[id] || !Number.isNaN(searchStart[id])) return;
      const l = compiled.lanes[lane]!,
        p = pointAtDistance(l.polyline, l.cumulative, positionM),
        d = destinationPlace(id).centroid;
      if (Math.hypot(p.x - d.x, p.y - d.y) <= params.parkingSearchRadiusM) searchStart[id] = timeS;
    },
    reject(id: number, timeS: number) {
      const c = compiled.connectors[vehicles.destination[id]!]!;
      const target = compiled.parking[c.parking!]!;
      const slot =
        target.kind === 'roadside'
          ? (spaces.find((s) => s.connector === c.idx)?.idx ?? null)
          : null;
      const key = `${target.id}:${slot}`;
      const entry = entryRejections.get(key) ?? {
        facility: target.id,
        kind: target.kind,
        space: slot,
        count: 0,
      };
      entry.count++;
      entryRejections.set(key, entry);
      release(id, timeS);
      const f = chosen[id]!;
      const facility = compiled.parking[f];
      // A rejected slot does not exhaust the other slots along the same strip/aisle.
      if (f !== -1 && !facility!.connectorsIn.some((c) => hasFreeSpace(c, id))) {
        if (!rejected.has(id)) rejected.set(id, new Set());
        rejected.get(id)!.add(f);
      }
      beginSearch(id, timeS);
    },
    arrive,
    detail(id: number, timeS: number) {
      const motion = motionById[id];
      const facility =
        compiled.parking[
          motion ? spaces[motion.slot]!.parking : parked[id] === -1 ? chosen[id]! : parked[id]!
        ];
      return {
        parkingPhase: motion?.phase ?? null,
        parkingSpace:
          motion?.slot ??
          (claimedSpaces[id] === -1 ? undefined : claimedSpaces[id]) ??
          ((parkedSpaces[id] === -1 ? manoeuvreSpaces[id] : parkedSpaces[id]) === -1
            ? null
            : parkedSpaces[id] === -1
              ? manoeuvreSpaces[id]!
              : parkedSpaces[id]!),
        stallChoice: choiceRank[id]
          ? { rank: choiceRank[id]!, scoreM: choiceScore[id]!, bestScoreM: bestScore[id]! }
          : null,
        parkingFacility: facility?.id ?? null,
        walkingDistanceM: walking[id]!,
        parkingSearchTimeS:
          parked[id] !== -1 || vehicles.state[id] === FAILED || Number.isNaN(searchStart[id])
            ? searchTime[id]!
            : timeS - searchStart[id]!,
      };
    },
    snapshot: () => occupied.slice(),
    stockSnapshot(): ParkedCarsSnapshot {
      const occupiedBits = new Uint8Array(Math.ceil(spaces.length / 8));
      const ids = new Uint32Array(spaces.length);
      for (let i = 0; i < stock.length; i++)
        if (stock[i] !== -1) {
          occupiedBits[i >> 3]! |= 1 << (i & 7);
          ids[i] = (stock[i]! >= 0 ? stock[i]! : stockCar[i]!) + 1;
        }
      return {
        revision,
        occupied: occupiedBits,
        id: ids,
        vclass: classes.slice(),
        hues: new Uint32Array(spaces.length),
      };
    },
    get revision() {
      return revision;
    },
    stateHash: () => {
      const base = (cachedHash ??= parkingHash([
        occupied,
        origins,
        chosen,
        heading,
        enRoute,
        claimedSpaces,
        Int32Array.from(claimSince, (t) => (Number.isNaN(t) ? -1 : Math.round(t * 10))),
        parked,
        ...(allowWithoutExit.some(Boolean) ? [allowWithoutExit] : []),
        ...(spaces.length ? [stock, originSpaces, parkedSpaces, reserved] : []),
      ]));
      return motions.size
        ? parkingHash([
            new Uint32Array([base]),
            Int32Array.from(
              [...motions]
                .sort((a, b) => a[0] - b[0])
                .flatMap(([id, m]) => [
                  id,
                  m.slot,
                  ['drive_in', 'park', 'leave', 'drive_out', 'exit', 'merge'].indexOf(m.phase),
                  Math.round(m.progressM * 100),
                  Math.round(m.pose.x * 100),
                  Math.round(m.pose.y * 100),
                  Math.round(m.pose.heading * 1000),
                ]),
            ),
          ])
        : base;
    },
    metrics(failed: number, timeS = scenario.startS): Metrics['parking'] {
      const held = heldTimes.slice();
      const longest = longestClaims.slice();
      for (let id = 0; id < trips.length; id++)
        if (claimedSpaces[id] !== -1 && compiled.parking[heading[id]!]!.kind === 'roadside') {
          const heldS = Math.max(0, timeS - claimSince[id]!);
          held.push(heldS);
          longest.push({
            vehicleId: id + 1,
            facility: compiled.parking[heading[id]!]!.id,
            space: claimedSpaces[id]!,
            heldS,
          });
        }
      held.sort((a, b) => a - b);
      longest.sort((a, b) => b.heldS - a.heldS || a.vehicleId - b.vehicleId);
      const percentile = (p: number) => (held.length ? held[Math.ceil(p * held.length) - 1]! : 0);
      const home = homeDistances.slice().sort((a, b) => a - b);
      const homePercentile = (p: number) =>
        home.length ? home[Math.ceil(p * home.length) - 1]! : 0;
      return {
        facilities: compiled.parking.map((f) => ({
          id: f.id,
          occupied: occupied[f.idx]!,
          capacity: f.capacity,
        })),
        parked: occupied.reduce((a, b) => a + b, 0),
        arrivals,
        parkedWithoutExit,
        meanSearchTimeS: arrivals ? totalSearch / arrivals : 0,
        failed,
        claims: {
          active: enRoute.reduce((a, b) => a + b, 0),
          entryRejections: [...entryRejections.values()].reduce((n, entry) => n + entry.count, 0),
          simultaneousStripChoices: 0,
          rejectedEntries: [...entryRejections.values()].map((entry) => ({ ...entry })),
          stripHeld: {
            count: held.length,
            totalS: held.reduce((a, b) => a + b, 0),
            meanS: held.length ? held.reduce((a, b) => a + b, 0) / held.length : 0,
            p50S: percentile(0.5),
            p90S: percentile(0.9),
            p95S: percentile(0.95),
            p99S: percentile(0.99),
            maxS: held.at(-1) ?? 0,
            longest: longest.slice(0, 10),
          },
        },
        motion: {
          meanEntryToParkS: lotArrivals ? totalEntryToPark / lotArrivals : 0,
          meanLotDriveS: lotArrivals + lotLeaves ? totalDrive / (lotArrivals + lotLeaves) : 0,
          meanLotLeaveS: lotLeaves ? totalLeave / lotLeaves : 0,
          stripManoeuvresPerHour:
            (stripManoeuvres * 3600) / Math.max(params.dtS, timeS - scenario.startS),
          meanStallChoiceRank: lotChoices ? totalRank / lotChoices : 0,
        },
        ...(households
          ? {
              home: {
                arrivals: home.length,
                medianM: homePercentile(0.5),
                p90M: homePercentile(0.9),
                maxM: home.at(-1) ?? 0,
                beyondRadius: beyondRadius.map((entry) => ({ ...entry })),
              },
            }
          : {}),
      };
    },
    patch(next: CompiledCity) {
      const topology = (city: CompiledCity, id: string) => {
        const graph = city.lots?.find((l) => l.id === id)?.circulation;
        return (
          graph && [
            graph.nodes,
            graph.edges,
            graph.stallNodes,
            graph.entries.map((e) => [
              city.connectors[e.connector]!.id,
              e.node,
              city.connectors[e.connector]!.direction,
            ]),
          ]
        );
      };
      // World-space trajectories survive an unrelated edit. Changing an occupied path
      // requires restart, just as removing its occupied stall does.
      for (const m of motions.values()) {
        const old = spaces[m.slot]!,
          f = compiled.parking[old.parking]!,
          ordinal = f.spaces!.indexOf(m.slot);
        const target = next.parking[next.index.parking.get(f.id)!],
          slot = next.parkingSpaces?.[target?.spaces?.[ordinal] ?? -1];
        const c = next.connectors[next.index.connector.get(compiled.connectors[m.connector]!.id)!];
        if (
          !slot ||
          !c ||
          JSON.stringify([slot.position, slot.heading, next.lanes[c.lane]!.polyline]) !==
            JSON.stringify([old.position, old.heading, compiled.lanes[m.lane]!.polyline]) ||
          (m.lot &&
            JSON.stringify(topology(next, f.id)) !== JSON.stringify(topology(compiled, f.id))) ||
          m.crossings.some((x) => {
            const lane = next.index.lane.get(compiled.lanes[x.lane]!.id);
            return (
              lane === undefined ||
              JSON.stringify(next.lanes[lane]!.polyline) !==
                JSON.stringify(compiled.lanes[x.lane]!.polyline)
            );
          })
        )
          throw new Error(
            `Parking ${f.id} has an active manoeuvre affected by this edit; restart the run`,
          );
      }
      for (const f of compiled.parking) {
        if (f.kind === 'garage') continue;
        const mapped = next.index.parking.get(f.id);
        const count = mapped === undefined ? 0 : (next.parking[mapped]!.spaces?.length ?? 0);
        if (f.spaces?.some((i, ordinal) => stock[i] !== -1 && ordinal >= count))
          throw new Error(
            `Parking ${f.id} has occupied spaces affected by this edit; restart the run`,
          );
      }
      for (const facility of next.parking) {
        const old = compiled.index.parking.get(facility.id);
        if (old !== undefined && !soft(facility) && occupied[old]! > facility.capacity)
          throw new Error(
            `Parking ${facility.id} has ${occupied[old]} occupied slots; capacity cannot be reduced below occupancy during a run`,
          );
      }
      const remap = (values: Int32Array) =>
        values.map((i) =>
          i === -1 ? -1 : (next.index.parking.get(compiled.parking[i]!.id) ?? -1),
        );
      cachedHash = undefined;
      origins = remap(origins);
      chosen = remap(chosen);
      parked = remap(parked);
      const initial = initialOccupancy(next);
      occupied = Uint32Array.from(
        next.parking,
        (f) => occupied[compiled.index.parking.get(f.id)!] ?? initial[f.idx]!,
      );
      rejected.clear();
      candidates.clear();
      served = servedPlaces(next);
      const oldSpaces = spaces,
        oldStock = stock,
        oldClasses = classes,
        oldReserved = reserved;
      spaces = next.parkingSpaces ?? [];
      const ordinal = new Int32Array(oldSpaces.length);
      for (const f of compiled.parking)
        f.spaces?.forEach((i, n) => {
          ordinal[i] = n;
        });
      const remapSpace = (old: number) => {
        if (old === -1) return -1;
        const s = oldSpaces[old]!;
        const facility = next.index.parking.get(compiled.parking[s.parking]!.id);
        return facility === undefined
          ? -1
          : (next.parking[facility]!.spaces?.[ordinal[old]!] ?? -1);
      };
      // Recheck the claimed bay's actual access before remapping stable slot ordinals.
      for (let id = 0; id < trips.length; id++) {
        const facility = heading[id]!;
        if (facility === -1) continue;
        const slot = claimedSpaces[id]!;
        const connector = compiled.connectors[vehicles.destination[id]!];
        const mappedConnector = connector ? next.index.connector.get(connector.id) : undefined;
        if (
          !next.index.parking.has(compiled.parking[facility]!.id) ||
          (slot !== -1 && !claimReachable(next, mappedConnector ?? -1, remapSpace(slot), id)) ||
          (connector && !next.index.connector.has(connector.id))
        )
          release(id);
      }
      heading = remap(heading);
      claimedSpaces = claimedSpaces.map(remapSpace);
      enRoute = new Int32Array(next.parking.length);
      claimedBy = new Int32Array(spaces.length).fill(-1);
      for (let id = 0; id < trips.length; id++) {
        if (heading[id] !== -1) enRoute[heading[id]!]!++;
        if (claimedSpaces[id] !== -1) claimedBy[claimedSpaces[id]!] = id;
      }
      originSpaces = originSpaces.map(remapSpace);
      parkedSpaces = parkedSpaces.map(remapSpace);
      for (let i = 0; i < manoeuvreSpaces.length; i++)
        manoeuvreSpaces[i] = remapSpace(manoeuvreSpaces[i]!);
      for (const m of motions.values()) {
        m.slot = remapSpace(m.slot);
        m.connector = next.index.connector.get(compiled.connectors[m.connector]!.id)!;
        // TASK-156: an arrival holds an aisle lane, which need not be its entry's.
        const held =
          m.lot && m.laneHeld && (m.phase === 'drive_in' || m.phase === 'park')
            ? next.index.lane.get(compiled.lanes[m.lane]!.id)
            : undefined;
        m.lane = held ?? next.connectors[m.connector]!.lane;
        m.crossings = m.crossings.map((x) => ({
          ...x,
          lane: next.index.lane.get(compiled.lanes[x.lane]!.id)!,
        }));
      }
      stock = new Int32Array(spaces.length).fill(-1);
      classes = new Uint8Array(spaces.length);
      reserved = new Int32Array(spaces.length).fill(-1);
      for (const s of oldSpaces) {
        const mapped = remapSpace(s.idx);
        if (mapped !== -1) {
          stock[mapped] = oldStock[s.idx]!;
          classes[mapped] = oldClasses[s.idx]!;
          reserved[mapped] = oldReserved[s.idx]!;
        }
      }
      revision++;
      compiled = next;
      lotGraphs = compiled.parking.map(
        (f) => compiled.lots?.find((l) => l.id === f.id)?.circulation,
      );
      usable = eligibleSpaces();
      aisleSegments = aisleSegmentsOf(compiled);
      prepareDepartures();
      approachReach = new Float64Array(spaces.length * 2).fill(NaN);
      leaveRear = new Float64Array(spaces.length * 2).fill(NaN);
      clearHolds.clear();
      missed.clear();
      drives.clear();
      markCrossings();
    },
  };
}
