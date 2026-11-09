import {
  distance as pointDistance,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
} from '../geo/polyline';
import { createRandom } from '../geo/random';
import type { CompiledCity } from '../network';
import { lotPath } from '../network/lot-paths';
import { vehicleClasses, type Scenario, type SimParams, type TripRequest } from '../schema';
import { parkingEgress } from './parking-egress';
import type { Metrics, ParkedCarsSnapshot } from './types';
import { COMPLETED, FAILED, type Vehicles } from './vehicle';
import { parkingHash } from './hash';
import {
  bodyClearLane,
  manoeuvrePath,
  manoeuvreLaneReach,
  motionPath,
  parkedPose,
  pathPose,
  type MotionPath,
  type ParkingPose,
} from './manoeuvre';

interface ParkingMotion {
  phase: 'drive_in' | 'park' | 'leave' | 'drive_out' | 'exit';
  lot: boolean;
  slot: number;
  connector: number;
  lane: number;
  path: MotionPath;
  progressM: number;
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
          Math.ceil(
            Math.round(f.residents * scenario.demand.personsPerResident) * scenario.demand.carShare,
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
  for (const f of compiled.parking) {
    for (const slot of shuffled(usableSpaces(f), `stock:${f.id}`).slice(0, occupied[f.idx]))
      stock[slot] = -2;
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
        occupied[f.idx]!++;
        occupied[garage.idx]!--;
        count--;
      }
    }
  }
  let cachedHash: number | undefined;
  const previous = new Int32Array(trips.length).fill(-1);
  const nextTrip = new Int32Array(trips.length).fill(-1);
  let origins = new Int32Array(trips.length).fill(-1);
  let chosen = new Int32Array(trips.length).fill(-1);
  // Cars on their way to each lot (lead, TASK-103 follow-up): a lot whose free stalls are all
  // spoken for drops out of the choice, so its served places do not all converge on it.
  let heading = new Int32Array(trips.length).fill(-1);
  let enRoute = new Int32Array(compiled.parking.length);
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
  let arrivals = 0;
  let totalSearch = 0;
  const last = new Map<string, number>();
  const chronology = trips
    .map((_, id) => id)
    .sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
  const available = occupied.slice();
  const availableSpaces = stock.slice();
  const homeCars = new Map<number, number>();
  const carsAt = (own: CompiledCity['parking']) =>
    Math.ceil(
      Math.round(Math.max(0, ...own.map((f) => f.residents)) * scenario.demand.personsPerResident) *
        scenario.demand.carShare,
    );
  for (const id of chronology) {
    const trip = trips[id]!;
    if (trip.mode !== 'car') continue;
    if (trip.personId !== null) {
      const before = last.get(trip.personId);
      if (before !== undefined && trips[before]!.destinationPlaceId === trip.originPlaceId) {
        previous[id] = before;
        // Owner (TASK-122): preserve inbound gateway visitors until gateway routing is fixed.
        const origin = compiled.index.place.get(trips[before]!.originPlaceId)!;
        if (compiled.places[origin]!.kind !== 'gateway') nextTrip[before] = id;
      }
      last.set(trip.personId, id);
    }
    if (previous[id] === -1) {
      const place = compiled.index.place.get(trip.originPlaceId);
      if (place !== undefined && compiled.places[place]!.kind === 'gateway') continue;
      const own = compiled.parking.filter((f) => f.place === place);
      const street =
        small(id) && prefersStreet(id) ? nearHome(place!).filter((f) => f.kind !== 'garage') : [];
      if (!homeCars.has(place!)) homeCars.set(place!, carsAt(own));
      const facility =
        [...street, ...own, ...(small(id) ? nearHome(place!) : [])].find(
          (f) =>
            departure(id).facilities[f.idx] &&
            available[f.idx]! > 0 &&
            (small(id) || f.kind === 'garage') &&
            (f.kind === 'garage' ||
              usableSpaces(f).some((s) => departure(id).spaces[s] && availableSpaces[s] !== -1)),
        ) ??
        // Neighbours may have taken the street cars moved out of this home's garage; an
        // inferred home garage stands in for parking OSM does not map and admits every car,
        // so a resident's car starts there while the home has residents' cars left (lead,
        // TASK-103 follow-up).
        ((homeCars.get(place!) ?? 0) > 0
          ? own.find((f) => f.kind === 'garage' && soft(f) && departure(id).facilities[f.idx])
          : undefined);
      homeCars.set(place!, homeCars.get(place!)! - 1);
      origins[id] = facility?.idx ?? -1;
      if (facility) {
        available[facility.idx]!--;
        const eligible = usableSpaces(facility).filter(
          (s) => departure(id).spaces[s] && availableSpaces[s] !== -1,
        );
        const slot = eligible.length ? rng.derive(`origin:${trip.id}`).pick(eligible) : undefined;
        if (slot !== undefined) {
          originSpaces[id] = slot;
          availableSpaces[slot] = -1;
          classes[slot] = vehicles.vclass[id]!;
        }
      } else if (own.length) noOriginCar[id] = 1;
    }
  }
  const destinationPlace = (id: number) =>
    compiled.places[compiled.index.place.get(trips[id]!.destinationPlaceId)!]!;
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
    accept: (connector: number) => boolean,
    atDeparture = false,
  ) {
    for (const needRoom of atDeparture ? [true, false] : [true])
      for (const f of facilitiesFor(id)) {
        if ((needRoom ? !hasRoom(f) : f.capacity === 0) || rejected.get(id)?.has(f.idx)) continue;
        if (
          needRoom &&
          f.kind === 'lot' &&
          occupied[f.idx]! + enRoute[f.idx]! - (heading[id] === f.idx ? 1 : 0) >= f.capacity
        )
          continue;
        if (nextTrip[id] !== -1 && !departure(nextTrip[id]!).facilities[f.idx]) continue;
        for (const connector of f.kind === 'roadside'
          ? shuffled(f.connectorsIn, `arrival:${trips[id]!.id}`)
          : f.connectorsIn) {
          if (
            f.kind !== 'garage' &&
            (needRoom || nextTrip[id] !== -1) &&
            !hasFreeSpace(connector, id, needRoom)
          )
            continue;
          if (!accept(connector)) continue;
          chosen[id] = f.idx;
          head(id, f.kind === 'lot' ? f.idx : -1);
          cachedHash = undefined;
          walking[id] = distance(id, f.idx);
          if (!serves(f, destinationPlace(id).idx)) searching[id] = 1;
          return true;
        }
      }
    if (searching[id] && !Number.isNaN(searchStart[id])) searchTime[id] = timeS - searchStart[id]!;
    return false;
  }
  function originFacility(id: number) {
    const before = previous[id]!;
    return before === -1 ? origins[id]! : parked[before]!;
  }
  function originSpace(id: number) {
    return previous[id] === -1 ? originSpaces[id]! : parkedSpaces[previous[id]!]!;
  }
  function freeSpace(connector: number, id: number) {
    const c = compiled.connectors[connector]!,
      f = compiled.parking[c.parking ?? -1];
    if (!f || f.kind === 'garage') return undefined;
    const point = pointAtDistance(
      compiled.lanes[c.lane]!.polyline,
      compiled.lanes[c.lane]!.cumulative,
      c.positionM,
    );
    const scores: { slot: (typeof spaces)[number]; score: number }[] = [];
    const graph = lotGraph(f.idx),
      entry = graph?.entries.find((e) => e.connector === connector);
    for (const i of usableSpaces(f)) {
      const s = spaces[i]!;
      if (stock[i] !== -1 || (reserved[i] !== -1 && reserved[i] !== id)) continue;
      // A roadside driver must stop at the target slot, not another car's slot farther along.
      if (f.kind === 'roadside' && s.connector !== connector) continue;
      if (id >= 0 && nextTrip[id] !== -1 && !departure(nextTrip[id]!).spaces[i]) continue;
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
    scores.sort((a, b) => a.score - b.score || a.slot.idx - b.slot.idx);
    if (!scores.length) return undefined;
    if (f.kind !== 'lot' || id < 0) return scores[0]!.slot;
    const good = scores.filter(
      (s) => s.score <= scores[0]!.score + params.stallChoiceSlackM + 1e-9,
    );
    return rng.derive(`stall:${trips[id]!.id}`).pick(good).slot;
  }
  function hasFreeSpace(connector: number, id: number, needRoom = true) {
    const c = compiled.connectors[connector]!,
      f = compiled.parking[c.parking ?? -1];
    if (!f || f.kind === 'garage') return false;
    const graph = lotGraph(f.idx),
      entry = graph?.entries.find((e) => e.connector === connector);
    return usableSpaces(f).some(
      (i) =>
        (!needRoom || (stock[i] === -1 && (reserved[i] === -1 || reserved[i] === id))) &&
        (f.kind === 'roadside'
          ? spaces[i]!.connector === connector
          : Number.isFinite(entry?.distances[graph!.stallNodes[spaces[i]!.lotStall!]!])) &&
        (id < 0 || nextTrip[id] === -1 || departure(nextTrip[id]!).spaces[i]),
    );
  }
  function beginSearch(id: number, timeS: number) {
    searching[id] = 1;
    if (Number.isNaN(searchStart[id])) searchStart[id] = timeS;
  }
  const motions = new Map<number, ParkingMotion>();
  let approachReach = new Float64Array(spaces.length * 2).fill(NaN);
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
  const lanePose = (connector: number): ParkingPose => {
    const c = compiled.connectors[connector]!,
      l = compiled.lanes[c.lane]!;
    return {
      ...pointAtDistance(l.polyline, l.cumulative, c.positionM),
      heading: headingAtDistance(l.polyline, l.cumulative, c.positionM),
    };
  };
  const localPath = (slot: number, connector: number, reverse = false) => {
    const space = spaces[slot]!,
      graph = lotGraph(space.parking)!;
    const nodes = lotPath(graph, connector, space.lotStall!);
    if (!nodes) throw new Error('Reserved stall has no circulation path');
    if (reverse) nodes.reverse();
    const points = nodes.map((i) => graph.nodes[i]!);
    if (points.length === 1) points.push(points[0]!);
    return motionPath(points);
  };
  const isLotSpace = (id: number) => {
    const slot = spaces[originSpace(id)];
    return !!slot && compiled.parking[slot.parking]!.kind === 'lot' && !left[id];
  };
  const lotBusy = (facility: number, leaving: boolean, connector: number) =>
    [...motions.values()].some(
      (m) =>
        m.lot &&
        spaces[m.slot]!.parking === facility &&
        ((m.phase === 'leave' || m.phase === 'drive_out' || m.phase === 'exit') !== leaving ||
          m.connector !== connector),
    );
  function startArrival(id: number, connector: number, timeS: number) {
    const facility = compiled.parking[compiled.connectors[connector]!.parking ?? -1];
    if (facility?.kind === 'lot' && lotBusy(facility.idx, false, connector)) return false;
    const slot = freeSpace(connector, id);
    if (!slot) return false;
    const lot = compiled.parking[slot.parking]!.kind === 'lot';
    const leader = vehicles.previous[id]!,
      key = slot.idx * 2 + vehicles.vclass[id]!;
    const available =
      leader === -1 ? Infinity : vehicles.position[leader]! - length(leader) - params.idm.minGapM;
    if (!lot && available < approachReach[key]!) return false;
    const from = lanePose(connector),
      path = lot
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
      if (available < reach) return false;
    }
    if (
      lot &&
      [...motions].some(([otherId, m]) => {
        if (spaces[m.slot]!.parking !== slot.parking) return false;
        const hit = nearestOnPolyline(path.points, m.pose);
        return hit.away < 0.6 && hit.along < length(otherId) + params.idm.minGapM;
      })
    )
      return false;
    reserved[slot.idx] = id;
    manoeuvreSpaces[id] = slot.idx;
    cachedHash = undefined;
    if (lot) {
      const graph = lotGraph(slot.parking)!,
        entry = graph.entries.find((e) => e.connector === connector)!;
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
      startedS: timeS,
      entryS: timeS,
      driveS: 0,
      laneHeld: !lot,
      pose: from,
      speed: 0,
    });
    return true;
  }
  function arrive(id: number, connector: number, timeS: number) {
    const f = compiled.connectors[connector]!.parking;
    if (f === undefined) return;
    head(id, -1);
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
    if (!Number.isNaN(searchStart[id])) searchTime[id] = timeS - searchStart[id]!;
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
      exit: (id: number, connector: number) => boolean;
      resume: (id: number, connector: number) => void;
    },
  ) {
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
        m.speed = 0;
        if (callbacks.exit(id, m.connector)) {
          lotLeaves++;
          totalLeave += timeS - m.entryS;
          totalDrive += m.driveS;
          removeMotion(id);
        }
        continue;
      }
      const driving = m.phase === 'drive_in' || m.phase === 'drive_out';
      const duration =
        m.phase === 'leave' ? params.leaveManoeuvreS : params.parkManoeuvreS[space.layout];
      let target = driving
        ? Math.min(m.path.lengthM, m.progressM + params.lotSpeedMps * params.dtS)
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
      m.progressM = target;
      m.pose = pathPose(m.path, target);
      m.speed = pointDistance(before, m.pose) / params.dtS;
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
      if (target < m.path.lengthM - 1e-8) continue;
      if (m.phase === 'drive_in') {
        nextPath(m, manoeuvrePath(m.pose, parkedPose(space, length(id)), false), 'park', timeS);
      } else if (m.phase === 'park') {
        if (m.laneHeld) callbacks.clearLane(id);
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
        if (m.lot) nextPath(m, localPath(m.slot, m.connector, true), 'drive_out', timeS);
        else {
          stripManoeuvres++;
          removeMotion(id);
          callbacks.resume(id, m.connector);
        }
      } else if (m.phase === 'drive_out') {
        m.phase = 'exit';
      }
    }
  }
  return {
    location(id: number, atOrigin = false) {
      const facility = atOrigin ? originFacility(id) : parked[id]!;
      const space = atOrigin ? originSpace(id) : parkedSpaces[id]!;
      return { facility, space };
    },
    advance,
    motion: (id: number) => motionById[id],
    startArrival,
    lotArrival: (connector: number) =>
      compiled.parking[compiled.connectors[connector]!.parking ?? -1]?.kind === 'lot',
    startsInLot: isLotSpace,
    canStartLot(id: number, connector: number) {
      const slot = spaces[originSpace(id)]!;
      if (lotBusy(slot.parking, true, connector)) return false;
      const out = pathPose(localPath(slot.idx, connector, true), 0);
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
      if (!slot || left[id] || compiled.parking[slot.parking]!.kind !== 'roadside') return true;
      const c = compiled.connectors[slot.connector]!,
        lane = compiled.lanes[c.lane]!,
        key = slot.idx * 2 + vehicles.vclass[id]!;
      if (Number.isNaN(approachReach[key]))
        approachReach[key] = manoeuvreLaneReach(
          manoeuvrePath(lanePose(c.idx), parkedPose(slot, length(id)), slot.layout === 'parallel'),
          lane,
          length(id),
          params.vehicleClasses[vehicles.vclass[id] === 0 ? 'car' : 'van'].widthM,
        );
      for (let other = vehicles.last(c.lane); other !== -1; other = vehicles.previous[other]!) {
        if (vehicles.position[other]! < c.positionM) continue;
        return (
          vehicles.position[other]! - length(other) - params.idm.minGapM >= approachReach[key]!
        );
      }
      return true;
    },
    choose,
    noOriginCar: (id: number) => !!noOriginCar[id],
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
        const facility = compiled.parking[slot.parking]!;
        if (facility.kind === 'lot') {
          const graph = lotGraph(slot.parking)!;
          return facility.connectorsOut
            .filter((c) => !!lotPath(graph, c, slot.lotStall!))
            .sort(
              (a, b) =>
                graph.entries.find((e) => e.connector === a)!.distances[
                  graph.stallNodes[slot.lotStall!]!
                ]! -
                  graph.entries.find((e) => e.connector === b)!.distances[
                    graph.stallNodes[slot.lotStall!]!
                  ]! || a - b,
            );
        }
        return [slot.connector];
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
          const lot = compiled.parking[space.parking]!.kind === 'lot';
          const out = lot ? localPath(slot, connector, true) : null;
          const to = out ? pathPose(out, 0) : lanePose(connector);
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
    full(connector: number, id = -1) {
      const facility = compiled.connectors[connector]!.parking;
      if (facility === undefined) return false;
      const f = compiled.parking[facility]!;
      return f.kind === 'garage' ? !hasRoom(f) : !hasFreeSpace(connector, id);
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
      head(id, -1);
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
          ids[i] = stock[i]! >= 0 ? stock[i]! + 1 : 0;
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
        parked,
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
                  ['drive_in', 'park', 'leave', 'drive_out', 'exit'].indexOf(m.phase),
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
      return {
        facilities: compiled.parking.map((f) => ({
          id: f.id,
          occupied: occupied[f.idx]!,
          capacity: f.capacity,
        })),
        parked: occupied.reduce((a, b) => a + b, 0),
        arrivals,
        meanSearchTimeS: arrivals ? totalSearch / arrivals : 0,
        failed,
        motion: {
          meanEntryToParkS: lotArrivals ? totalEntryToPark / lotArrivals : 0,
          meanLotDriveS: lotArrivals + lotLeaves ? totalDrive / (lotArrivals + lotLeaves) : 0,
          meanLotLeaveS: lotLeaves ? totalLeave / lotLeaves : 0,
          stripManoeuvresPerHour:
            (stripManoeuvres * 3600) / Math.max(params.dtS, timeS - scenario.startS),
          meanStallChoiceRank: lotChoices ? totalRank / lotChoices : 0,
        },
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
            JSON.stringify(topology(next, f.id)) !== JSON.stringify(topology(compiled, f.id)))
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
      heading = remap(heading);
      enRoute = new Int32Array(next.parking.length);
      for (const f of heading) if (f !== -1) enRoute[f]!++;
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
      originSpaces = originSpaces.map(remapSpace);
      parkedSpaces = parkedSpaces.map(remapSpace);
      for (let i = 0; i < manoeuvreSpaces.length; i++)
        manoeuvreSpaces[i] = remapSpace(manoeuvreSpaces[i]!);
      for (const m of motions.values()) {
        m.slot = remapSpace(m.slot);
        m.connector = next.index.connector.get(compiled.connectors[m.connector]!.id)!;
        m.lane = next.connectors[m.connector]!.lane;
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
      prepareDepartures();
      approachReach = new Float64Array(spaces.length * 2).fill(NaN);
    },
  };
}
