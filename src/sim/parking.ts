import { pointAtDistance } from '../geo/polyline';
import { createRandom } from '../geo/random';
import type { CompiledCity } from '../network';
import type { Scenario, SimParams, TripRequest } from '../schema';
import type { Metrics, ParkedCarsSnapshot } from './types';
import { COMPLETED, FAILED, type Vehicles } from './vehicle';
import { parkingHash } from './hash';

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
    for (const slot of (f.spaces ?? []).slice(0, occupied[f.idx])) stock[slot] = -2;
  }
  // Move the residential share out of garages once, in compiled place/facility/slot order.
  for (const p of compiled.places) {
    if (p.kind !== 'residential') continue;
    const garages = compiled.parking.filter(
      (f) => f.place === p.idx && f.kind === 'garage' && f.occupancyAtStart === null,
    );
    let count = Math.round(
      garages.reduce((n, f) => n + occupied[f.idx]!, 0) * params.streetParkingShare,
    );
    for (const f of nearHome(p.idx)) {
      if (f.occupancyAtStart !== null) continue;
      for (const slot of f.spaces ?? []) {
        if (!count || stock[slot] !== -1) continue;
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
  const parkUntil = new Float64Array(trips.length).fill(NaN);
  const leaveUntil = new Float64Array(trips.length).fill(-Infinity);
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
      if (before !== undefined && trips[before]!.destinationPlaceId === trip.originPlaceId)
        previous[id] = before;
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
            f.connectorsOut.length && available[f.idx]! > 0 && (small(id) || f.kind === 'garage'),
        ) ??
        // Neighbours may have taken the street cars moved out of this home's garage; an
        // inferred home garage stands in for parking OSM does not map and admits every car,
        // so a resident's car starts there while the home has residents' cars left (lead,
        // TASK-103 follow-up).
        ((homeCars.get(place!) ?? 0) > 0
          ? own.find((f) => f.kind === 'garage' && soft(f) && f.connectorsOut.length)
          : undefined);
      homeCars.set(place!, homeCars.get(place!)! - 1);
      origins[id] = facility?.idx ?? -1;
      if (facility) {
        available[facility.idx]!--;
        const slot = facility.spaces?.find((s) => availableSpaces[s] !== -1);
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
        for (const connector of f.connectorsIn) {
          if (f.kind !== 'garage' && needRoom && !freeSpace(connector, id)) continue;
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
    let best: (typeof spaces)[number] | undefined,
      distance = Infinity;
    for (const i of f.spaces ?? []) {
      const s = spaces[i]!;
      if (stock[i] !== -1 || (reserved[i] !== -1 && reserved[i] !== id)) continue;
      // A roadside driver must stop at the target slot, not another car's slot farther along.
      if (f.kind === 'roadside' && s.connector !== connector) continue;
      const d = Math.hypot(s.position.x - point.x, s.position.y - point.y);
      if (d < distance) {
        best = s;
        distance = d;
      }
    }
    return best;
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
      const slot = spaces[originSpace(id)];
      if (slot && !left[id]) return [slot.connector];
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
    depart(id: number, timeS = scenario.startS) {
      if (left[id]) return;
      cachedHash = undefined;
      const facility = originFacility(id);
      if (facility !== -1 && occupied[facility]) occupied[facility]!--;
      const slot = originSpace(id);
      if (slot !== -1) {
        stock[slot] = -1;
        if (spaces[slot]?.manoeuvre) leaveUntil[id] = timeS + params.leaveManoeuvreS;
        revision++;
      }
      left[id] = 1;
    },
    departing: (id: number, timeS: number) => timeS < leaveUntil[id]! - 1e-9,
    leavingSpace: (id: number) => !left[id] && originSpace(id) !== -1,
    needsManoeuvre(connector: number) {
      const c = compiled.connectors[connector]!,
        f = compiled.parking[c.parking ?? -1];
      return f?.kind !== 'garage' && (f?.spaces ?? []).some((i) => spaces[i]!.manoeuvre);
    },
    holdArrival(id: number, connector: number, timeS: number) {
      if (Number.isNaN(parkUntil[id])) {
        const slot = freeSpace(connector, id);
        if (!slot) return false;
        manoeuvreSpaces[id] = slot.idx;
        reserved[slot.idx] = id;
        parkUntil[id] = timeS + params.parkManoeuvreS[slot.layout];
        cachedHash = undefined;
      }
      return timeS >= parkUntil[id]! - 1e-9;
    },
    full(connector: number, id = -1) {
      const facility = compiled.connectors[connector]!.parking;
      if (facility === undefined) return false;
      const f = compiled.parking[facility]!;
      return f.kind === 'garage' ? !hasRoom(f) : !freeSpace(connector, id);
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
      if (f !== -1 && !facility!.connectorsIn.some((c) => freeSpace(c, id))) {
        if (!rejected.has(id)) rejected.set(id, new Set());
        rejected.get(id)!.add(f);
      }
      beginSearch(id, timeS);
    },
    arrive(id: number, connector: number, timeS: number) {
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
    stateHash: () =>
      (cachedHash ??= parkingHash([
        occupied,
        origins,
        chosen,
        parked,
        ...(spaces.length ? [stock, originSpaces, parkedSpaces, reserved] : []),
      ])),
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
        oldClasses = classes;
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
      stock = new Int32Array(spaces.length).fill(-1);
      classes = new Uint8Array(spaces.length);
      reserved = new Int32Array(spaces.length).fill(-1);
      for (const s of oldSpaces) {
        const mapped = remapSpace(s.idx);
        if (mapped !== -1) {
          stock[mapped] = oldStock[s.idx]!;
          classes[mapped] = oldClasses[s.idx]!;
        }
      }
      manoeuvreSpaces.fill(-1);
      parkUntil.fill(NaN);
      revision++;
      compiled = next;
    },
  };
}
