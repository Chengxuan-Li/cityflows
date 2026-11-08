import { pointAtDistance } from '../geo/polyline';
import type { CompiledCity } from '../network';
import type { Scenario, SimParams, TripRequest } from '../schema';
import type { Metrics } from './types';
import { COMPLETED, FAILED, type Vehicles } from './vehicle';
import { parkingHash } from './hash';

export function createParking(
  compiled: CompiledCity,
  trips: TripRequest[],
  scenario: Scenario,
  params: SimParams,
  vehicles: Vehicles,
) {
  function initialOccupancy(city: CompiledCity) {
    const remaining = new Map<number, number>();
    const hour = (scenario.startS / 3600) % 24;
    return Uint32Array.from(city.parking, (f) => {
      if (!remaining.has(f.place))
        remaining.set(f.place, Math.ceil(f.residents * scenario.demand.carShare));
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
  let occupied = initialOccupancy(compiled);
  let cachedHash: number | undefined;
  const previous = new Int32Array(trips.length).fill(-1);
  let origins = new Int32Array(trips.length).fill(-1);
  let chosen = new Int32Array(trips.length).fill(-1);
  let parked = new Int32Array(trips.length).fill(-1);
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
  for (const id of chronology) {
    const trip = trips[id]!;
    if (trip.mode !== 'car') continue;
    if (trip.personId !== null) {
      const before = last.get(trip.personId);
      if (before !== undefined && trips[before]!.destinationPlaceId === trip.originPlaceId)
        previous[id] = before;
      last.set(trip.personId, id);
    }
    if (previous[id] === -1) {
      const place = compiled.index.place.get(trip.originPlaceId);
      if (place !== undefined && compiled.places[place]!.kind === 'gateway') continue;
      const own = compiled.parking.filter((f) => f.place === place);
      const facility = own.find((f) => f.connectorsOut.length && available[f.idx]! > 0);
      origins[id] = facility?.idx ?? -1;
      if (facility) available[facility.idx]!--;
      else if (own.length) noOriginCar[id] = 1;
    }
  }
  const destinationPlace = (id: number) =>
    compiled.places[compiled.index.place.get(trips[id]!.destinationPlaceId)!]!;
  const distance = (id: number, facility: number) => {
    const a = destinationPlace(id).centroid,
      b = compiled.parking[facility]!.centroid;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const facilitiesFor = (id: number) => {
    const destination = destinationPlace(id);
    if (destination.kind === 'gateway') return [];
    return compiled.parking
      .filter(
        (f) => f.connectorsIn.length && (f.place === destination.idx || f.access === 'public'),
      )
      .sort(
        (a, b) =>
          Number(b.place === destination.idx) - Number(a.place === destination.idx) ||
          Number(distance(id, a.idx) > params.parkingSearchRadiusM) -
            Number(distance(id, b.idx) > params.parkingSearchRadiusM) ||
          distance(id, a.idx) - distance(id, b.idx) ||
          a.idx - b.idx,
      );
  };
  function required(id: number) {
    const destination = destinationPlace(id);
    // Zero-demand legacy portals (including event gates) retain their admission semantics.
    return (
      destination.kind !== 'gateway' &&
      compiled.parking.some((f) => f.place === destination.idx || f.access === 'public')
    );
  }
  function choose(id: number, timeS: number, accept: (connector: number) => boolean) {
    for (const f of facilitiesFor(id)) {
      if (occupied[f.idx]! >= f.capacity || rejected.get(id)?.has(f.idx)) continue;
      for (const connector of f.connectorsIn) {
        if (!accept(connector)) continue;
        chosen[id] = f.idx;
        cachedHash = undefined;
        walking[id] = distance(id, f.idx);
        if (f.place !== destinationPlace(id).idx) searching[id] = 1;
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
  function beginSearch(id: number, timeS: number) {
    searching[id] = 1;
    if (Number.isNaN(searchStart[id])) searchStart[id] = timeS;
  }
  return {
    required,
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
    depart(id: number) {
      if (left[id]) return;
      cachedHash = undefined;
      const facility = originFacility(id);
      if (facility !== -1 && occupied[facility]) occupied[facility]!--;
      left[id] = 1;
    },
    full(connector: number) {
      const facility = compiled.connectors[connector]!.parking;
      return facility !== undefined && occupied[facility]! >= compiled.parking[facility]!.capacity;
    },
    admits(id: number, connector: number) {
      const f = compiled.parking[compiled.connectors[connector]!.parking ?? -1];
      return !f || f.access === 'public' || f.place === destinationPlace(id).idx;
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
      const f = chosen[id]!;
      if (f !== -1) {
        if (!rejected.has(id)) rejected.set(id, new Set());
        rejected.get(id)!.add(f);
      }
      beginSearch(id, timeS);
    },
    arrive(id: number, connector: number, timeS: number) {
      const f = compiled.connectors[connector]!.parking;
      if (f === undefined) return;
      cachedHash = undefined;
      if (occupied[f]! >= compiled.parking[f]!.capacity)
        throw new Error('Parking admission exceeded capacity');
      occupied[f]!++;
      parked[id] = f;
      chosen[id] = f;
      if (!Number.isNaN(searchStart[id])) searchTime[id] = timeS - searchStart[id]!;
      arrivals++;
      totalSearch += searchTime[id]!;
    },
    detail(id: number, timeS: number) {
      const facility = compiled.parking[parked[id] === -1 ? chosen[id]! : parked[id]!];
      return {
        parkingFacility: facility?.id ?? null,
        walkingDistanceM: walking[id]!,
        parkingSearchTimeS:
          parked[id] !== -1 || vehicles.state[id] === FAILED || Number.isNaN(searchStart[id])
            ? searchTime[id]!
            : timeS - searchStart[id]!,
      };
    },
    snapshot: () => occupied.slice(),
    stateHash: () => (cachedHash ??= parkingHash([occupied, origins, chosen, parked])),
    metrics(failed: number): Metrics['parking'] {
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
      };
    },
    patch(next: CompiledCity) {
      for (const facility of next.parking) {
        const old = compiled.index.parking.get(facility.id);
        if (old !== undefined && occupied[old]! > facility.capacity)
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
      compiled = next;
    },
  };
}
