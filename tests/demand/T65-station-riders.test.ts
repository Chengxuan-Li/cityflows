import { expect } from 'vitest';
import { loadAuditCity } from '../../bench/junction-audit';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { riderKind, riderProfile, ridersPerStop } from '../../src/demand/rider-profile';
import { riderOf, stationRiders } from '../../src/demand/stations';
import { distance } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { station } from '../../src/fixtures/station';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import { centroid } from '../../src/network/compile';
import { compileRail } from '../../src/network/rail';
import { trainPoint, trainTimetable } from '../../src/network/trains';
import type { City, Scenario, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { TRANSIT_RIDER_ID } from '../../src/sim/transit';
import { cityTest, unitTest } from '../tier';
import { railStation } from './rail-station';

// TASK-128 (T65): S-Bahn riders get off at a station, walk out of its entrances to a place nearby
// and walk back later; the synthetic rail station is T64's rail city beside the Station fixture.
function scenarioFor(scale: number, startS = 0): Scenario {
  const scenario = defaultScenario('station');
  scenario.demand.personsPerResident = scale;
  scenario.demand.workDuration = { meanS: 8 * 3600, sdS: 0 };
  scenario.startS = startS;
  scenario.endS = 86400;
  return scenario;
}

const centre = (city: City, id: string) => centroid(city.places[id]!.shape)!;
const byRider = (trips: TripRequest[]) => {
  const riders = new Map<string, TripRequest[]>();
  for (const t of trips) riders.set(t.personId!, [...(riders.get(t.personId!) ?? []), t]);
  return riders;
};

unitTest('T65 riders leave the station only after an S-Bahn stop, by the stated door delay', () => {
  const { city, station } = railStation();
  const rail = compileRail(city)!,
    table = trainTimetable(rail);
  expect(table.routes.map((r) => r.kind).sort()).toEqual(['mainline', 'sbahn']);
  const sbahn = table.routes.findIndex((r) => r.kind === 'sbahn');
  const route = table.routes[sbahn]!,
    stop = route.stops[0]!;
  // The platform-to-door walk: straight line x 1.3 at walking speed to the nearest entrance,
  // from the train's middle (the stop's figure) or from each rider's own point along the train.
  const doorS = (p: Vec2) =>
    (Math.min(...station.station!.entrances.map((id) => distance(p, city.walk!.nodes[id]!.pos))) *
      riderProfile.detour) /
    riderProfile.walkSpeedMps;
  const along = Array.from({ length: 136 }, (_, i) =>
    doorS(trainPoint(rail, route, stop.positionM - 67.5 + i)),
  );
  const [nearS, farS] = [Math.min(...along), Math.max(...along)];
  const arrivals = new Set<number>();
  for (const d of table.departures.filter((d) => d.route === sbahn))
    for (let t = d.timeS + stop.arrivalS; t < 86400; t += table.periodS)
      arrivals.add(Math.round(t));
  const { trips, stops } = stationRiders(city, scenarioFor(1));
  // Only S-Bahn stops at the platform: 15 an hour; the main line passes beside it and brings none.
  expect(stops).toHaveLength(arrivals.size);
  expect(stops.every((s) => arrivals.has(Math.round(s.arrivalS)))).toBe(true);
  expect(table.routes.find((r) => r.kind === 'mainline')!.stops).toEqual([]);
  const out = trips.filter((t) => t.id.endsWith(':out'));
  expect(out.length).toBeGreaterThan(0);
  for (const t of out) {
    const rider = riderOf(t.personId!)!;
    expect(rider.stationId).toBe(station.id);
    expect(arrivals.has(rider.arrivalS)).toBe(true);
    expect(t.originPlaceId).toBe(station.id);
    expect(t.mode).toBe('walk');
    expect(t.departS - rider.arrivalS).toBeGreaterThanOrEqual(nearS - 0.6);
    expect(t.departS - rider.arrivalS).toBeLessThanOrEqual(farS + 0.6);
  }
  // Riders leave over about a minute, not all at once.
  const first = out.filter(
    (t) => riderOf(t.personId!)!.arrivalS === riderOf(out[0]!.personId!)!.arrivalS,
  );
  expect(new Set(first.map((t) => Math.round(t.departS))).size).toBeGreaterThan(first.length / 2);
  const s = stops.find((s) => s.riders)!;
  expect(s.doorS).toBeCloseTo(doorS(trainPoint(rail, route, stop.positionM)), 9);
});

unitTest(
  'T65 riders per stop follow the profile, scale with personsPerResident and keep the expected count',
  () => {
    const { city } = railStation();
    const full = stationRiders(city, scenarioFor(1)).stops;
    for (const s of full) {
      const hour = Math.floor(s.arrivalS / 3600) % 24;
      expect(s.riders).toBe(ridersPerStop(hour));
      expect(s.kind).toBe(riderKind(hour));
    }
    expect(ridersPerStop(7)).toBe(50);
    expect(ridersPerStop(15)).toBe(10);
    expect(ridersPerStop(22) + ridersPerStop(4)).toBe(0);
    expect(full.filter((s) => s.empty === 'no_service_hour')).toHaveLength(
      full.filter((s) => {
        const hour = Math.floor(s.arrivalS / 3600) % 24;
        return hour >= 22 || hour < 5;
      }).length,
    );
    for (const scale of [0.15, 0.5]) {
      const stops = stationRiders(city, scenarioFor(scale)).stops;
      let riders = 0,
        expected = 0,
        variance = 0;
      for (const s of stops) {
        expect(s.expected).toBeCloseTo(
          ridersPerStop(Math.floor(s.arrivalS / 3600) % 24) * scale,
          9,
        );
        expect([Math.floor(s.expected), Math.ceil(s.expected)]).toContain(s.riders);
        riders += s.riders;
        expected += s.expected;
        variance += (s.expected % 1) * (1 - (s.expected % 1));
      }
      expect(Math.abs(riders - expected)).toBeLessThan(4 * Math.sqrt(variance) + 1);
    }
  },
);

unitTest(
  'T65 destinations lie within 1 500 m and are never a gateway, parking or the station',
  () => {
    const { city, station, offices, shops, far } = railStation();
    const { trips } = stationRiders(city, scenarioFor(1));
    const chosen = new Set<string>();
    for (const [personId, list] of byRider(trips)) {
      const destination = list.at(-1)!.originPlaceId;
      chosen.add(destination);
      const place = city.places[destination]!;
      expect(distance(centre(city, station.id), centre(city, destination))).toBeLessThanOrEqual(
        1500,
      );
      expect(['gateway', 'parking', 'station']).not.toContain(place.kind);
      // Commuters go to jobs, visitors to attractions.
      if (riderOf(personId)!.kind === 'commuter') expect(place.jobs).toBeGreaterThan(0);
      else expect(place.attraction).toBeGreaterThan(0);
    }
    expect([...chosen].sort()).toEqual([offices.id, shops.id].sort());
    expect(chosen.has(far.id)).toBe(false);
    // A station with no eligible place brings no riders, and says why.
    delete city.places[offices.id];
    delete city.places[shops.id];
    const empty = stationRiders(city, scenarioFor(1));
    expect(empty.trips).toEqual([]);
    expect(empty.stops.filter((s) => s.kind).every((s) => s.empty === 'no_destination')).toBe(true);
  },
);

unitTest('T65 each rider walks back to the station after the stated stay', () => {
  const { city, station } = railStation();
  const scenario = scenarioFor(1);
  const { trips } = stationRiders(city, scenario);
  for (const [personId, [out, back]] of byRider(trips)) {
    expect(back!.id).toBe(`${personId}:back`);
    expect(back!.originPlaceId).toBe(out!.destinationPlaceId);
    expect(back!.destinationPlaceId).toBe(station.id);
    expect(back!.mode).toBe('walk');
    // The return leaves after the straight-line walk there (x 1.3) and the stay.
    const walkS =
      (distance(centre(city, station.id), centre(city, out!.destinationPlaceId)) *
        riderProfile.detour) /
      riderProfile.walkSpeedMps;
    const stayS = back!.departS - out!.departS - walkS;
    if (riderOf(personId)!.kind === 'commuter') expect(stayS).toBeCloseTo(8 * 3600, 6);
    else {
      expect(stayS).toBeGreaterThanOrEqual(3600);
      expect(stayS).toBeLessThanOrEqual(3 * 3600);
    }
  }
  // A rider whose walk out would leave before the run starts is at the destination already.
  const late = stationRiders(city, scenarioFor(1, 9 * 3600)).trips;
  for (const [, list] of byRider(late)) {
    const out = list.find((t) => t.id.endsWith(':out'));
    if (out) expect(out.departS).toBeGreaterThanOrEqual(9 * 3600);
    expect(list.at(-1)!.id.endsWith(':back')).toBe(true);
  }
  expect(late.filter((t) => t.id.endsWith(':back'))).toHaveLength(
    trips.filter((t) => t.id.endsWith(':back')).length,
  );
});

unitTest(
  'T65 riders are deterministic and walk out of the entrances and back in the simulation',
  () => {
    const { city, station } = railStation();
    const scenario = scenarioFor(0.15, 7 * 3600);
    scenario.endS = 7.5 * 3600;
    const first = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
    const second = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
    expect(second).toEqual(first);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
    const { compiled } = result;
    const doors = station.station!.entrances.map((id) => city.walk!.nodes[id]!.pos);
    const hashes: number[] = [];
    for (let run = 0; run < 2; run++) {
      const engine = createEngine();
      engine.load({ compiled, trips: first, scenario });
      const starts: Vec2[] = [];
      let walkers = new Set<number>();
      for (let step = 0; step < 18000; step++) {
        engine.step();
        if (run || step % 10) continue;
        const snapshot = engine.snapshot().walkers;
        const now = new Set<number>();
        for (let i = 0; i < (snapshot?.count ?? 0); i++) {
          // TASK-174: riders getting off the train are drawn from its doors to the entrance
          // before their walk; the walkers are the ids below theirs.
          if (snapshot!.id[i]! >= TRANSIT_RIDER_ID) continue;
          now.add(snapshot!.id[i]!);
          if (!walkers.has(snapshot!.id[i]!))
            starts.push({ x: snapshot!.x[i]!, y: snapshot!.y[i]! });
        }
        walkers = now;
      }
      hashes.push(engine.stateHash());
      if (run) continue;
      const out = first.filter((t) => t.id.endsWith(':out') && t.departS < scenario.endS - 900);
      expect(out.length).toBeGreaterThan(5);
      // Each rider's first walker appears at a station entrance, not on the platform.
      expect(starts.length).toBeGreaterThan(5);
      for (const p of starts) expect(Math.min(...doors.map((d) => distance(d, p)))).toBeLessThan(6);
      for (const t of out) {
        const person = engine.inspectPerson(t.personId!)!;
        expect(person.trips[0]!.state).toBe('completed');
        expect(person.trips[0]!.legs[0]!.kind).toBe('walk');
        expect(person.trips[0]!.legs[0]!.distanceM).toBeGreaterThan(0);
      }
    }
    expect(hashes[1]).toBe(hashes[0]);
  },
);

unitTest(
  'T65 no trains, no riders: Grid, Town, Station and Sindelfingen trip lists are unchanged',
  () => {
    for (const city of [grid5x5(), town(), station(), loadAuditCity('sindelfingen')]) {
      const scenario = scenarioFor(0.15);
      expect(stationRiders(city, scenario)).toEqual({ trips: [], stops: [] });
    }
  },
);

cityTest('T65 Munich: riders at Donnersbergerbrücke follow its timetable', () => {
  const city = loadAuditCity('munich');
  const scenario = scenarioFor(0.15, 7 * 3600);
  const { trips, stops } = stationRiders(city, scenario);
  expect(new Set(stops.map((s) => s.stationId))).toEqual(new Set(['p:1484']));
  expect(new Set(stops.map((s) => s.platform))).toEqual(new Set(['rp:10743', 'rp:10744']));
  // 15 S-Bahn stops an hour at each platform; about 7.5 riders per stop at the 07:00 peak.
  const seven = stops.filter((s) => Math.floor(s.arrivalS / 3600) === 7);
  expect(seven).toHaveLength(30);
  const riders = seven.reduce((n, s) => n + s.riders, 0);
  expect(riders).toBeGreaterThan(190);
  expect(riders).toBeLessThan(260);
  expect(stops.filter((s) => s.empty && s.empty !== 'no_service_hour')).toEqual([]);
  expect(trips.filter((t) => t.id.endsWith(':back'))).toHaveLength(
    stops.reduce((n, s) => n + s.riders, 0),
  );
});
