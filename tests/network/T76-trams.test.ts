import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compileRail } from '../../src/network/rail';
import { buildTramTimetable, railTimetable } from '../../src/network/trams';
import { buildTimetable, trainsAt, trainPoseAt } from '../../src/network/trains';

function fixture() {
  const { city } = buildCity('Trams', 1);
  city.rail = { nodes: {}, tracks: {}, platforms: {}, tramStops: {} };
  for (let i = 0; i < 4; i++) {
    const id = `rn:${i}`;
    city.rail.nodes[id] = { id, pos: { x: i * 200, y: 0 }, layer: 0, kind: 'plain' };
    if (i) {
      const track = `rt:${i}`;
      city.rail.tracks[track] = {
        id: track,
        from: `rn:${i - 1}`,
        to: id,
        line: [city.rail.nodes[`rn:${i - 1}`]!.pos, city.rail.nodes[id]!.pos],
        kind: 'tram',
        layer: 0,
      };
    }
  }
  city.rail.tramStops!['ts:1'] = {
    id: 'ts:1',
    name: 'Central',
    lines: ['1'],
    layer: 0,
    tracks: ['rt:2'],
    halts: [{ track: 'rt:2', pos: { x: 300, y: 0 } }],
    platform: null,
    osmIds: [],
  };
  return city;
}

test('T76 connected synthetic tram service is separate from trains, deterministic and reversible', () => {
  const rail = compileRail(fixture())!,
    table = buildTramTimetable(rail);
  expect(table.routes).toHaveLength(2);
  expect(table.routes.every((r) => r.kind === 'tram')).toBe(true);
  expect(buildTimetable(rail).routes).toEqual([]);
  expect(buildTramTimetable(rail)).toEqual(table);
  expect(table.routes.map((r) => r.sections[0]!.forward).sort()).toEqual([false, true]);
  for (const route of table.routes) {
    for (let i = 1; i < route.sections.length; i++) {
      const a = route.sections[i - 1]!,
        b = route.sections[i]!;
      expect(rail.connections).toContainEqual({
        node: a.forward ? rail.tracks[a.track]!.toNode : rail.tracks[a.track]!.fromNode,
        from: a.track,
        to: b.track,
      });
    }
  }
});

test('T76 tram centre serves mapped halt for 25 seconds and arbitrary-age sampling agrees', () => {
  const rail = compileRail(fixture())!,
    table = buildTramTimetable(rail);
  const departure = table.departures[0]!,
    route = table.routes[departure.route]!,
    stop = route.stops[0]!;
  expect(stop.platform).toBe('ts:1');
  for (const dt of [0, 10, 24.999]) {
    const age = stop.arrivalS + dt;
    const pose = trainPoseAt(rail, table, 0, 0, age)!;
    expect(pose.speedMps).toBe(0);
    expect(pose.centre.x).toBeCloseTo(300);
    expect(trainsAt(rail, table, departure.timeS + age)).toContainEqual(pose);
  }
  expect(trainPoseAt(rail, table, 0, 0, stop.arrivalS + 26)!.speedMps).toBeCloseTo(1);
});

test('T76 disconnected tracks and old cities cannot invent service', () => {
  const city = fixture();
  delete city.rail!.tracks['rt:2'];
  const rail = compileRail(city)!;
  expect(
    buildTramTimetable(rail).routes.every((r) => r.sections.length === 1 && r.stops.length === 0),
  ).toBe(true);
  city.rail!.tracks = {};
  expect(railTimetable(compileRail(city)!).routes).toEqual([]);
});

test('T76 reservations protect opposing tram bodies over cycle seam and seeking', () => {
  const rail = compileRail(fixture())!,
    table = railTimetable(rail);
  for (let time = 0; time < 7200; time += 0.5) {
    const used = new Set<number>();
    for (const pose of trainsAt(rail, table, time))
      for (const track of pose.occupied) {
        expect(used.has(track)).toBe(false);
        used.add(track);
      }
  }
  const poses = trainsAt(rail, table, 5000);
  trainsAt(rail, table, 1);
  expect(trainsAt(rail, table, 5000)).toEqual(poses);
});

test('T76 tram speed respects mapped limits, skips depot tracks, and mixed periods preserve cadence', () => {
  const city = fixture();
  city.rail!.tracks['rt:2']!.maxSpeedMps = 5;
  const rail = compileRail(city)!,
    table = buildTramTimetable(rail);
  for (const route of table.routes)
    for (let age = 0; age < route.durationS; age += 0.5) {
      const d = table.departures.findIndex((d) => table.routes[d.route] === route),
        p = trainPoseAt(rail, table, d, 0, age)!;
      if (p.centre.x > 200 && p.centre.x < 400) expect(p.speedMps).toBeLessThanOrEqual(5.000001);
    }
  city.rail!.tracks['rt:2']!.service = 'yard';
  expect(buildTramTimetable(compileRail(city)!).routes).toEqual([]);
  const mixed = fixture();
  for (const [id, pos] of [
    ['rn:10', { x: 0, y: 100 }],
    ['rn:11', { x: 600, y: 100 }],
  ] as const)
    mixed.rail!.nodes[id] = { id, pos, layer: 0, kind: 'plain' };
  mixed.rail!.tracks['rt:10'] = {
    id: 'rt:10',
    from: 'rn:10',
    to: 'rn:11',
    line: [
      { x: 0, y: 100 },
      { x: 600, y: 100 },
    ],
    kind: 'rail',
    layer: 0,
    maxSpeedMps: 1,
  };
  const graph = compileRail(mixed)!,
    train = buildTimetable(graph),
    tram = buildTramTimetable(graph),
    both = railTimetable(graph);
  expect(train.periodS).toBeGreaterThan(tram.periodS);
  for (const [source, offset] of [
    [train, 0],
    [tram, train.routes.length],
  ] as const) {
    for (let time = 0; time < both.periodS * 2; time += 13) {
      const expected = trainsAt(graph, source, time).map((p) => [
        p.route,
        Math.round(p.positionM * 1e6) / 1e6,
        Math.round(p.speedMps * 1e6) / 1e6,
      ]);
      const actual = trainsAt(graph, both, time)
        .filter((p) => p.route >= offset && p.route < offset + source.routes.length)
        .map((p) => [
          p.route - offset,
          Math.round(p.positionM * 1e6) / 1e6,
          Math.round(p.speedMps * 1e6) / 1e6,
        ]);
      expect(actual.sort()).toEqual(expected.sort());
    }
  }
});
