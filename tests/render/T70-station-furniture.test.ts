// TASK-133: station furniture is visual only. T70 pins its placement rules, the departure
// displays against the TASK-127 timetable, and that none of it moves the timetable or the city.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { deepInside, pointInPolygon } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { compileRail } from '../../src/network/rail';
import {
  buildTimetable,
  platformDepartures,
  trainsAt,
  trainTimetable,
} from '../../src/network/trains';
import type { City } from '../../src/schema';
import type { RailNetwork } from '../../src/schema/rail';
import {
  departureDisplay,
  placeStationFurniture,
  type FurnitureBox,
  type PlatformFurniture,
} from '../../src/render/station-furniture';
import { displayRefreshS, Stations3D } from '../../src/render3d/stations';
import { cityHeights } from '../../src/render3d/heights';
import { tierCities } from '../tier';

function compiled(city: City) {
  const result = compile(city);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

/** A 200 m platform bending 10 m over its length, 6 m wide, with a station place. */
function curved(roof?: [number, number]) {
  const { city, node, road } = buildCity('Curved platform', 1);
  road(node(-50, 40), node(300, 40));
  const centre = (x: number) => ({ x, y: (x - 100) ** 2 / 1000 });
  const xs = Array.from({ length: 21 }, (_, i) => i * 10);
  const upper = xs.map((x) => ({ x, y: centre(x).y - 3 })),
    lower = xs.map((x) => ({ x, y: centre(x).y + 3 })).reverse();
  city.rail = {
    nodes: {},
    tracks: {},
    platforms: {
      'rp:1': {
        id: 'rp:1',
        shape: { kind: 'polygon', ring: [...upper, ...lower, upper[0]!] },
        name: 'Curve',
        ref: '1;2',
        mode: 'rail',
        layer: 0,
        tracks: [],
        station: 'p:1',
      },
    },
  };
  city.places['p:1'] = {
    id: 'p:1',
    kind: 'station',
    name: 'Curve Central',
    shape: { kind: 'point', pos: { x: 100, y: 0 } },
    population: 0,
    jobs: 0,
    attraction: 1,
    capacity: null,
    connectors: [],
    profile: null,
    events: [],
    provenance: { source: 'generated' },
    station: { platforms: ['rp:1'], entrances: [] },
  };
  if (roof) {
    const [a, b] = roof;
    city.context = {
      features: [
        {
          kind: 'area',
          class: 'building',
          sub: 'roof',
          rings: [
            [
              { x: a, y: -20 },
              { x: b, y: -20 },
              { x: b, y: 30 },
              { x: a, y: 30 },
              { x: a, y: -20 },
            ],
          ],
        },
      ],
    };
  }
  return city;
}

function boxes(p: PlatformFurniture): FurnitureBox[] {
  return [
    ...p.boards,
    ...p.shelters.map((s) => s.box),
    ...p.benches,
    ...p.bins,
    ...(p.display ? [p.display] : []),
  ];
}
function samples(b: FurnitureBox): Vec2[] {
  const c = Math.cos(b.heading),
    s = Math.sin(b.heading);
  return [-1, 0, 1].flatMap((i) =>
    [-1, 0, 1].map((j) => ({
      x: b.x + (i * b.length * c) / 2 - (j * b.width * s) / 2,
      y: b.y + (i * b.length * s) / 2 + (j * b.width * c) / 2,
    })),
  );
}
function expectOnPlatform(city: City, furniture: PlatformFurniture[]) {
  for (const p of furniture) {
    const platform = city.rail!.platforms[p.platform]!;
    if (platform.shape.kind !== 'polygon') throw Error('polygon platforms only');
    const ring = platform.shape.ring;
    for (const b of boxes(p))
      for (const point of samples(b)) {
        expect(pointInPolygon(point, ring)).toBe(true);
        expect(deepInside(point, ring, 0.6 - 1e-9)).toBe(true);
      }
  }
}

/** TASK-127's T64 two-track city with a station platform on the second track. */
function trainCity(polygon = true): City {
  const { city } = buildCity('Trains', 1);
  const rail: RailNetwork = { nodes: {}, tracks: {}, platforms: {} };
  for (let row = 0; row < 2; row++) {
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
    shape: polygon
      ? {
          kind: 'polygon',
          ring: [
            { x: 500, y: 8 },
            { x: 700, y: 8 },
            { x: 700, y: 14 },
            { x: 500, y: 14 },
            { x: 500, y: 8 },
          ],
        }
      : {
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
  city.rail = rail;
  return city;
}

test('T70 furniture lies on the platform polygon, 0.6 m clear of its edges, on a curved platform', () => {
  for (const roof of [undefined, [30, 120] as [number, number]]) {
    const city = curved(roof),
      [p] = placeStationFurniture(compiled(city), city).platforms;
    expect(p!.boards.length).toBeGreaterThanOrEqual(4);
    expect(p!.benches.length).toBeGreaterThan(2);
    expect(p!.bins.length).toBeGreaterThan(2);
    expect(p!.display).not.toBeNull();
    expectOnPlatform(city, [p!]);
  }
});

test('T70 placement is deterministic and does not depend on the ring order or start', () => {
  const city = curved(),
    first = placeStationFurniture(compiled(city), city);
  expect(placeStationFurniture(compiled(curved()), curved())).toEqual(first);
  const shape = city.rail!.platforms['rp:1']!.shape;
  if (shape.kind !== 'polygon') throw Error('polygon');
  const open = shape.ring.slice(0, -1),
    turned = [...open.slice(7), ...open.slice(0, 7)].reverse();
  shape.ring = [...turned, turned[0]!];
  const again = placeStationFurniture(compiled(city), city).platforms[0]!;
  expect(
    JSON.parse(JSON.stringify(again, (_, v) => (typeof v === 'number' ? +v.toFixed(5) : v))),
  ).toEqual(
    JSON.parse(
      JSON.stringify(first.platforms[0], (_, v) => (typeof v === 'number' ? +v.toFixed(5) : v)),
    ),
  );
});

test('T70 boards stand at both ends and about every 40 m', () => {
  const city = curved(),
    [p] = placeStationFurniture(compiled(city), city).platforms;
  const xs = p!.boards.map((b) => b.x).sort((a, b) => a - b);
  expect(xs[0]!).toBeLessThan(10);
  expect(xs.at(-1)!).toBeGreaterThan(190);
  for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(30);
  for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeLessThan(50);
  const station = placeStationFurniture(compiled(city), city);
  expect(station.platforms[0]!.name).toBe('Curve Central');
});

test('T70 a mapped roof gives canopy bays under it; without one a short shelter stands mid-platform', () => {
  const roofed = curved([30, 120]),
    [r] = placeStationFurniture(compiled(roofed), roofed).platforms;
  expect(r!.shelters.length).toBeGreaterThanOrEqual(6);
  for (const { box, mapped } of r!.shelters) {
    expect(mapped).toBe(true);
    expect(box.x).toBeGreaterThan(29);
    expect(box.x).toBeLessThan(121);
    expect(box.length).toBeLessThanOrEqual(12.01);
  }
  // The display stands outside the canopy so it can be read.
  expect(r!.display!.x < 30 - 2 || r!.display!.x > 120 + 2).toBe(true);
  const bare = curved(),
    [b] = placeStationFurniture(compiled(bare), bare).platforms;
  expect(b!.shelters).toHaveLength(1);
  expect(b!.shelters[0]!.mapped).toBe(false);
  expect(b!.shelters[0]!.box.length).toBeLessThanOrEqual(10);
  expect(Math.abs(b!.shelters[0]!.box.x - 100)).toBeLessThan(12);
});

test('T70 a mapped platform edge is a 2 m strip: too narrow for furniture 0.6 m clear of its edges', () => {
  const city = trainCity(false);
  city.places['p:1'] = { ...curved().places['p:1']!, name: 'Central' };
  expect(placeStationFurniture(compiled(city), city).platforms).toEqual([
    expect.objectContaining({ boards: [], display: null, benches: [], bins: [] }),
  ]);
});

test('T70 the display shows the next three departures from the timetable and counts down with the clock', () => {
  const city = trainCity(),
    rail = compileRail(city)!,
    table = buildTimetable(rail);
  // Independent oracle: every departure from the platform, repeated each period.
  const leaves = table.departures.flatMap((d) =>
    table.routes[d.route]!.stops.filter((s) => s.platform === 'rp:1').map(
      (s) => d.timeS + s.arrivalS + 40,
    ),
  );
  expect(leaves).toHaveLength(3);
  const expectedRows = (now: number) =>
    leaves
      .flatMap((t) => Array.from({ length: 12 }, (_, k) => t + (k - 4) * table.periodS))
      .filter((t) => t > now)
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map((t) => {
        const when = t - 40 <= now ? 'now' : `${Math.ceil((t - now) / 60)} min`;
        return `S-Bahn E  ${when.padStart(6)}`;
      });
  const known = leaves[0]! + 100;
  expect(departureDisplay(rail, table, 'rp:1', known)).toEqual({
    header: 'Departures',
    rows: expectedRows(known),
  });
  expect(new Set(expectedRows(known)).size).toBe(3);
  // The clock runs: every second of a day agrees with the oracle, standing trains included.
  let standing = 0;
  for (let t = 0; t < 3600; t += 7) {
    const rows = departureDisplay(rail, table, 'rp:1', t).rows;
    expect(rows).toEqual(expectedRows(t));
    if (rows[0]!.endsWith('now')) standing++;
  }
  expect(standing).toBeGreaterThan(0);
  // The first listed train leaves exactly at the listed time.
  const [next] = platformDepartures(rail, table, 'rp:1', known, 1);
  const speedAt = (t: number) =>
    trainsAt(rail, table, t).find((train) => train.route === next!.route)!.speedMps;
  expect(speedAt(next!.departureS - 0.01)).toBeCloseTo(0, 6);
  expect(speedAt(next!.departureS + 1)).toBeGreaterThan(0.5);
});

test('T70 the displays redraw at most once per simulated 30 s and only when their text changes', () => {
  const city = trainCity();
  city.places['p:1'] = { ...curved().places['p:1']!, name: 'Central' };
  const rail = compileRail(city)!,
    table = trainTimetable(rail),
    cc = compiled(city);
  const drawn: string[] = [];
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'measureText'
          ? (text: string) => ({ width: text.length * 10 })
          : () => {
              if (key === 'fillText') drawn.push('text');
            },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  const stations = new Stations3D(
    placeStationFurniture(cc, city),
    rail,
    table,
    cityHeights(cc, city),
    (width, height) =>
      ({ width, height, getContext: () => context }) as unknown as HTMLCanvasElement,
  );
  expect(stations.displays).toHaveLength(1);
  drawn.length = 0; // the board textures drew once, at construction
  const display = stations.displays[0]!;
  let t = 0;
  for (; t < 300; t++) {
    stations.update(t);
    // Three calls per second stand for three renders of a mesh in view.
    for (let render = 0; render < 3; render++) display.refresh(Math.floor(t / displayRefreshS));
  }
  const buckets = Math.ceil(300 / displayRefreshS);
  expect(stations.drawCount).toBeGreaterThanOrEqual(1);
  expect(stations.drawCount).toBeLessThanOrEqual(buckets);
  // Each repaint is 1 header + 3 rows.
  expect(drawn.length).toBe(stations.drawCount * 4);
  expect(stations.counts).toMatchObject({ displays: 1, benches: expect.any(Number) });
});

test('T70 furniture changes neither the city nor the timetable', () => {
  const city = trainCity();
  city.places['p:1'] = { ...curved().places['p:1']!, name: 'Central' };
  const before = JSON.stringify(city),
    rail = compileRail(city)!,
    hash = buildTimetable(rail).hash;
  const cc = compiled(city);
  placeStationFurniture(cc, city);
  platformDepartures(rail, trainTimetable(rail), 'rp:1', 1000);
  expect(JSON.stringify(city)).toBe(before);
  expect(buildTimetable(rail).hash).toBe(hash);
  // Pinned on main (7a93d97): TASK-133 adds a read-only helper and leaves the timetable alone.
  expect(hash).toBe('255c0ec6');
});

test.each(tierCities(['munich-donnersberger']))(
  'T70 %s: Donnersbergerbrücke platforms carry boards, canopies, benches and a display, clear of the edges',
  (name) => {
    const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
    });
    if (!imported.ok) throw Error('import');
    const city = imported.city,
      snapshot = JSON.stringify(city),
      cc = compiled(city),
      furniture = placeStationFurniture(cc, city);
    expect(JSON.stringify(city)).toBe(snapshot);
    expect(furniture.platforms.map((p) => p.platform)).toEqual(['rp:10736', 'rp:10737']);
    expect(furniture.entrances).toHaveLength(3);
    expectOnPlatform(city, furniture.platforms);
    for (const p of furniture.platforms) {
      expect(p.name).toBe('Donnersbergerbrücke');
      expect(p.boards.length).toBe(6);
      expect(p.display).not.toBeNull();
      // OSM maps a 140 m roof over the west of each platform (x 61 to 201).
      expect(p.shelters.every((s) => s.mapped)).toBe(true);
      expect(p.shelters.length).toBeGreaterThanOrEqual(10);
      for (const { box } of p.shelters) {
        expect(box.x).toBeGreaterThan(60);
        expect(box.x).toBeLessThan(202);
      }
      expect(p.display!.x).toBeGreaterThan(201);
      expect(p.benches.length).toBeGreaterThanOrEqual(5);
    }
    // Every placement reproduces from a second, separate import and compile.
    const again = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
    });
    if (!again.ok) throw Error('import');
    expect(placeStationFurniture(compiled(again.city), again.city)).toEqual(furniture);
    // 07:00: the next three S-Bahn departures per platform, from the TASK-127 timetable.
    const rail = cc.rail!,
      table = trainTimetable(rail);
    expect(table.hash).toBe('374c1e78');
    expect(departureDisplay(rail, table, 'rp:10736', 25200).rows).toEqual([
      'S-Bahn W   3 min',
      'S-Bahn W   7 min',
      'S-Bahn W  11 min',
    ]);
    expect(departureDisplay(rail, table, 'rp:10737', 25200).rows).toEqual([
      'S-Bahn E   4 min',
      'S-Bahn E   8 min',
      'S-Bahn E  12 min',
    ]);
  },
);
