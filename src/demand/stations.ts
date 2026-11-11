import { distance } from '../geo/polyline';
import { createRandom } from '../geo/random';
import type { Vec2 } from '../geo/vec2';
import { centroid } from '../network/compile';
import { compileRail } from '../network/rail';
import { stationArrivals, trainTimetable } from '../network/trains';
import type { City, Place, Scenario, TripRequest } from '../schema';
import { riderKind, riderProfile, ridersPerStop, type RiderKind } from './rider-profile';
import { weightedChoice } from './selection';
import { tripVehicle } from './vehicle';

const dayS = 86400;

export interface RiderStop {
  stationId: string;
  platform: string;
  arrivalS: number;
  /** Straight line x detour from the train's middle to the nearest entrance, at walking speed. */
  doorS: number;
  kind: RiderKind | null;
  /** Riders at this stop before rounding. */
  expected: number;
  riders: number;
  /** Why a stop brought nobody: no riders at that hour, rounded to zero, no entrance to leave
   * by, or no eligible place within the radius. */
  empty: 'no_service_hour' | 'rounded_to_zero' | 'no_entrance' | 'no_destination' | null;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `rider:<stationId>:<platform>@<arrival second>:<i>`; the stop key is the platform and time. */
export const riderId = (stationId: string, platform: string, arrivalS: number, i: number) =>
  `rider:${stationId}:${platform}@${Math.round(arrivalS)}:${i}`;

/** The station and train of a rider id, or null for anyone else. */
export function riderOf(personId: string) {
  const match = /^rider:(.+):([^:@]+:[^:@]+)@(\d+):\d+$/.exec(personId);
  if (!match) return null;
  const arrivalS = Number(match[3]);
  return {
    stationId: match[1]!,
    platform: match[2]!,
    arrivalS,
    kind: riderKind(Math.floor(arrivalS / 3600) % 24)!,
  };
}

/**
 * TASK-128: every S-Bahn stop at a platform of a station place brings riders who get off, walk
 * out of the station's entrances to a place nearby and later walk back to the station, where
 * their trip ends. Riders are walk-only persons outside the population; they are deterministic
 * from the city, the train timetable and the scenario seed. A rider whose walk out would leave
 * before the scenario starts is already at the destination: only the return is emitted.
 */
export function stationRiders(
  city: City,
  scenario: Scenario,
): { trips: TripRequest[]; stops: RiderStop[] } {
  const stations = Object.values(city.places)
    .filter((p) => p.station?.platforms.length)
    .sort(byId);
  if (!city.rail || !stations.length) return { trips: [], stops: [] };
  const rail = compileRail(city)!;
  const stationOf = new Map<string, Place>();
  for (const station of stations)
    for (const platform of station.station!.platforms) stationOf.set(platform, station);
  const centres = new Map<string, Vec2 | null>(
    Object.values(city.places).map((p) => [p.id, centroid(p.shape)]),
  );
  const speed = scenario.simParams.walkSpeedMps ?? riderProfile.walkSpeedMps;
  const walkS = (a: Vec2, b: Vec2) => (distance(a, b) * riderProfile.detour) / speed;
  const places = Object.values(city.places).sort(byId);
  const candidates = new Map(
    stations.map((station) => {
      const centre = centres.get(station.id)!;
      return [
        station.id,
        places.flatMap((p) => {
          const at = centres.get(p.id);
          if (!at || !centre || p.id === station.id || p.kind === 'gateway' || p.kind === 'parking')
            return [];
          const d = distance(centre, at);
          return d <= riderProfile.radiusM
            ? [{ place: p, at, decay: Math.exp(-d / riderProfile.decayM) }]
            : [];
        }),
      ];
    }),
  );
  const { demand } = scenario;
  const root = createRandom(scenario.seed).derive('riders');
  const trips: TripRequest[] = [];
  const stops: RiderStop[] = [];
  for (const arrival of stationArrivals(rail, trainTimetable(rail), 0, dayS)) {
    const station = stationOf.get(arrival.platform);
    if (arrival.kind !== 'sbahn' || !station) continue;
    const doors = station.station!.entrances.flatMap((id) => {
      const node = city.walk?.nodes[id];
      return node ? [node.pos] : [];
    });
    const hour = Math.floor(arrival.arrivalS / 3600) % 24;
    const kind = riderKind(hour);
    const expected = ridersPerStop(hour) * demand.personsPerResident;
    const stopId = `${station.id}:${arrival.platform}@${Math.round(arrival.arrivalS)}`;
    const random = root.derive(stopId);
    const count = Math.floor(expected) + Number(random.next() < expected % 1);
    const weight = (c: { place: Place; decay: number }) =>
      (kind === 'commuter' ? c.place.jobs : c.place.attraction) * c.decay;
    const eligible = candidates.get(station.id)!.filter((c) => weight(c) > 0);
    const doorS = doors.length ? Math.min(...doors.map((d) => walkS(arrival.middle, d))) : 0;
    const riders = eligible.length && doors.length ? count : 0;
    stops.push({
      stationId: station.id,
      platform: arrival.platform,
      arrivalS: arrival.arrivalS,
      doorS,
      kind,
      expected,
      riders,
      empty: riders
        ? null
        : !kind
          ? 'no_service_hour'
          : !count
            ? 'rounded_to_zero'
            : !doors.length
              ? 'no_entrance'
              : 'no_destination',
    });
    for (let i = 0; i < riders; i++) {
      const personId = riderId(station.id, arrival.platform, arrival.arrivalS, i);
      const draw = root.derive(personId);
      const destination = weightedChoice(eligible, weight, draw)!;
      const stayS =
        kind === 'commuter'
          ? Math.max(0, draw.normal(demand.workDuration.meanS, demand.workDuration.sdS))
          : draw.uniform(riderProfile.visitStayS.min, riderProfile.visitStayS.max);
      const outS = arrival.arrivalS + doorS;
      const backS = outS + walkS(centres.get(station.id)!, destination.at) + stayS;
      const emit = (suffix: 'out' | 'back', from: string, to: string, departS: number) => {
        const id = `${personId}:${suffix}`;
        trips.push({
          id,
          personId,
          originPlaceId: from,
          destinationPlaceId: to,
          departS,
          mode: 'walk',
          legs: [{ mode: 'walk', fromPlaceId: from, toPlaceId: to }],
          ...tripVehicle(id, demand, 'local', 'walk'),
        });
      };
      if (outS >= scenario.startS) emit('out', station.id, destination.place.id, outS);
      emit('back', destination.place.id, station.id, backS);
    }
  }
  return { trips, stops };
}
