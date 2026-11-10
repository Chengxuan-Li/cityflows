import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compileRail } from '../../src/network/rail';
import { buildTimetable, trainsAt } from '../../src/network/trains';
import { citySchema } from '../../src/schema';
import type { RailNetwork } from '../../src/schema/rail';

function fixture(single = false) {
  const { city } = buildCity('Trains', 1);
  const rail: RailNetwork = { nodes: {}, tracks: {}, platforms: {} };
  for (let row = 0; row < (single ? 1 : 2); row++) {
    for (let i = 0; i < 4; i++) {
      const id = `rn:${row * 4 + i}`;
      rail.nodes[id] = { id, pos: { x: i * 400, y: row * 6 }, kind: 'plain', layer: 0 };
    }
    for (let i = 0; i < 3; i++) {
      const id = `rt:${row * 3 + i}`;
      rail.tracks[id] = {
        id,
        from: `rn:${row * 4 + i}`,
        to: `rn:${row * 4 + i + 1}`,
        line: [rail.nodes[`rn:${row * 4 + i}`]!.pos, rail.nodes[`rn:${row * 4 + i + 1}`]!.pos],
        kind: 'rail',
        layer: 0,
      };
    }
  }
  if (!single) {
    rail.tracks['rt:6'] = {
      id: 'rt:6',
      from: 'rn:1',
      to: 'rn:6',
      line: [rail.nodes['rn:1']!.pos, rail.nodes['rn:6']!.pos],
      kind: 'rail',
      service: 'crossover',
      layer: 0,
    };
    rail.platforms['rp:1'] = {
      id: 'rp:1',
      shape: {
        kind: 'line',
        line: [
          { x: 500, y: 9 },
          { x: 700, y: 9 },
        ],
      },
      name: 'Central',
      station: 'p:1',
      mode: 'rail',
      layer: 0,
      tracks: ['rt:4'],
    };
  }
  city.rail = rail;
  return city;
}

test('T64 routes use permitted switch connections, right-hand running and boundary ends only', () => {
  const rail = compileRail(fixture())!;
  const table = buildTimetable(rail);
  expect(table.routes).toHaveLength(2);
  for (const r of table.routes) {
    for (let i = 1; i < r.sections.length; i++) {
      const a = r.sections[i - 1]!,
        b = r.sections[i]!;
      expect(rail.connections).toContainEqual({
        node: a.forward ? rail.tracks[a.track]!.toNode : rail.tracks[a.track]!.fromNode,
        from: a.track,
        to: b.track,
      });
    }
    expect(r.sections.every((s) => s.forward === rail.tracks[s.track]!.line[0]!.y > 0)).toBe(true);
    expect(rail.nodes[r.from]!.boundary).toBe(true);
    expect(rail.nodes[r.to]!.boundary).toBe(true);
  }
  expect(table.routes.map((r) => r.kind).sort()).toEqual(['mainline', 'sbahn']);
});

test('T64 preferred direction survives boundary validation and constrains all route sections', () => {
  const city = fixture(true);
  city.rail!.tracks['rt:1']!.preferredDirection = 'backward';
  expect(citySchema.parse(JSON.parse(JSON.stringify(city))).rail).toEqual(city.rail);
  const rail = compileRail(city)!;
  const table = buildTimetable(rail);
  expect(table.routes).toHaveLength(1);
  expect(table.routes[0]!.sections.every((s) => !s.forward)).toBe(true);
});

test('T64 S-Bahn middle dwells at platform middle for 40 seconds; main line passes', () => {
  const rail = compileRail(fixture())!,
    table = buildTimetable(rail);
  const trip = table.departures.find((d) => table.routes[d.route]!.kind === 'sbahn')!;
  const route = table.routes[trip.route]!,
    stop = route.stops[0]!;
  for (const dt of [0, 10, 39.999]) {
    const train = trainsAt(rail, table, trip.timeS + stop.arrivalS + dt).find(
      (t) => t.route === trip.route,
    )!;
    expect(train.positionM).toBeCloseTo(stop.positionM, 6);
    expect(train.speedMps).toBeCloseTo(0, 8);
    expect(train.centre.x).toBeCloseTo(600, 6);
  }
  expect(
    trainsAt(rail, table, trip.timeS + stop.arrivalS + 41).find((t) => t.route === trip.route)!
      .speedMps,
  ).toBeCloseTo(0.8, 5);
  expect(table.routes.find((r) => r.kind === 'mainline')!.stops).toEqual([]);
});

test.each([false, true])(
  'T64 whole bodies never share a section over 24 h, including opposing single track (%s), seeking and cycle seams',
  (single) => {
    const rail = compileRail(fixture(single))!,
      table = buildTimetable(rail);
    expect(table.hash).toBe(buildTimetable(rail).hash);
    for (let time = 0; time < 86400; time++) {
      const occupied = new Set<number>();
      for (const train of trainsAt(rail, table, time))
        for (const section of train.occupied) {
          expect(occupied.has(section)).toBe(false);
          occupied.add(section);
        }
    }
    const sought = trainsAt(rail, table, 25999.5);
    trainsAt(rail, table, 1);
    expect(trainsAt(rail, table, 25999.5)).toEqual(sought);
  },
);

test('T64 terminal exception: boundary train stops its nose at a buffer and reverses out, never at a switch', () => {
  const city = fixture(true);
  city.rail!.nodes['rn:3']!.kind = 'buffer_stop';
  const rail = compileRail(city)!,
    table = buildTimetable(rail);
  expect(table.routes).toHaveLength(1);
  const route = table.routes[0]!;
  expect(route.terminal).toBe(rail.nodes.findIndex((n) => n.id === 'rn:3'));
  const departure = table.departures[0]!;
  const stop = route.phases.find((p) => p.speedMps === 0 && p.acceleration === 0)!;
  const arrival = trainsAt(rail, table, departure.timeS + stop.timeS + 5).find(
    (t) => t.route === departure.route,
  )!;
  expect(arrival.positionM).toBeCloseTo(1100);
  const returning = trainsAt(rail, table, departure.timeS + stop.timeS + 45).find(
    (t) => t.route === departure.route,
  )!;
  expect(returning.positionM).toBeLessThan(arrival.positionM);
  expect(Math.cos(returning.cars[0]!.heading)).toBeLessThan(-0.99);
  for (let time = 0; time < 86400; time++) {
    const used = new Set<number>();
    for (const train of trainsAt(rail, table, time))
      for (const i of train.occupied) {
        expect(used.has(i)).toBe(false);
        used.add(i);
      }
  }
});

test('T64 entering and exiting train bodies are clipped at the imported boundary', () => {
  const rail = compileRail(fixture(true))!,
    table = buildTimetable(rail);
  const d = table.departures[0]!;
  for (const dt of [0.2, table.routes[d.route]!.durationS - 0.2]) {
    const train = trainsAt(rail, table, d.timeS + dt).find((t) => t.route === d.route)!;
    for (const car of train.cars) {
      expect(car.x - car.lengthM / 2).toBeGreaterThanOrEqual(0);
      expect(car.x + car.lengthM / 2).toBeLessThanOrEqual(1200);
    }
    expect(train.cars.length).toBeLessThan(8);
  }
});

test('T64 terminal services expose both station arrivals and choose the next stop by leg', () => {
  const city = fixture(true);
  city.rail!.nodes['rn:3']!.kind = 'buffer_stop';
  city.rail!.platforms['rp:1'] = {
    id: 'rp:1',
    shape: { kind: 'point', pos: { x: 600, y: 3 } },
    name: 'Central',
    station: 'p:1',
    mode: 'rail',
    layer: 0,
    tracks: ['rt:1'],
  };
  const rail = compileRail(city)!,
    table = buildTimetable(rail),
    r = table.routes[0]!,
    d = table.departures[0]!;
  expect(r.stops).toHaveLength(2);
  expect(r.stops[1]!.arrivalS).toBeCloseTo(r.durationS - r.stops[0]!.arrivalS - 40);
  expect(trainsAt(rail, table, d.timeS + 1).find((t) => t.route === 0)!.next).toBe('Central');
  const returning = trainsAt(rail, table, d.timeS + r.stops[1]!.arrivalS + 41).find(
    (t) => t.route === 0,
  )!;
  expect(returning.next).toBe('Exit');
});
