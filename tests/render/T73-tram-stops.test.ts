// TASK-137: tram stops are visual only. T73 pins the placement of an island's furniture (inside it,
// clear of its edge, the marking on the track), that it is deterministic, that it changes neither
// the city nor the compiled network, and the 3D batches.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { deepInside, nearestOnPolyline, pointInPolygon } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';
import type { FurnitureBox } from '../../src/render/station-furniture';
import {
  placeTramStops,
  tramStopCounts,
  tramStopSize,
  type TramStopPlacement,
} from '../../src/render/tram-stops';
import { cityHeights } from '../../src/render3d/heights';
import { TramStops3D } from '../../src/render3d/tram-stops';
import { synthetic } from '../importers/tram-stop-osm';
import { tierCities } from '../tier';
import { vehicleJson } from '../vehicle-json';

function load(xml = synthetic()) {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}
function compiled(city: City) {
  const result = compile(city);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}
const hash = (value: unknown) => createHash('sha256').update(vehicleJson(value)).digest('hex');
const samples = (b: FurnitureBox): Vec2[] => {
  const c = Math.cos(b.heading),
    s = Math.sin(b.heading);
  return [-1, 0, 1].flatMap((i) =>
    [-1, 0, 1].map((j) => ({
      x: b.x + (i * b.length * c) / 2 - (j * b.width * s) / 2,
      y: b.y + (i * b.length * s) / 2 + (j * b.width * c) / 2,
    })),
  );
};
/** Furniture lies on the island, `clearM` from its edge. */
function expectOnIsland(placements: TramStopPlacement[]) {
  for (const p of placements) {
    if (!p.ring.length) continue;
    const things = [...p.shelters, ...p.boards, ...(p.display ? [p.display] : [])];
    for (const b of things)
      for (const point of samples(b))
        expect(deepInside(point, p.ring, tramStopSize.clearM - 1e-9)).toBe(true);
    for (const point of p.tactile ?? []) expect(pointInPolygon(point, p.ring)).toBe(true);
  }
}

test('T73 an island carries a shelter, two name boards, a display and a tactile strip, inside it', () => {
  const city = load(),
    cc = compiled(city);
  const placements = placeTramStops(cc, city);
  expect(placements).toHaveLength(Object.keys(city.rail!.tramStops!).length);
  expectOnIsland(placements);
  const byName = (name: string) => placements.filter((p) => p.name === name);
  for (const p of placements.filter((p) => p.ring.length)) {
    expect(p.boards).toHaveLength(2);
    expect(p.display).not.toBeNull();
    expect(p.tactile).not.toBeNull();
    // The back of the island is away from the track it serves (a centre island has two).
    const stop = city.rail!.tramStops![p.stop]!;
    if (stop.halts.length > 1) continue;
    const middle = p.display!;
    const toTrack = stop.tracks
      .map((id) => nearestOnPolyline(cc.rail!.tracks.find((t) => t.id === id)!.line, middle))
      .sort((a, b) => a.away - b.away)[0]!;
    const side =
      (toTrack.point.x - middle.x) * -Math.sin(middle.heading) +
      (toTrack.point.y - middle.y) * Math.cos(middle.heading);
    expect(Math.sign(side)).toBe(-p.back);
  }
  // A shelter by default, none where the platform is tagged `shelter=no`.
  expect(byName('Alpha').map((p) => p.shelters.length)).toEqual([1, 1]);
  expect(byName('Beta')[0]!.shelters).toHaveLength(1);
  expect(byName('Epsilon')[0]!.shelters).toHaveLength(0);
  // The marking is a thin box across the track at the halt, aligned with it.
  for (const p of placements) {
    const stop = city.rail!.tramStops![p.stop]!;
    expect(p.marks).toHaveLength(stop.halts.length);
    for (const [i, m] of p.marks.entries()) {
      const track = cc.rail!.tracks.find((t) => t.id === stop.halts[i]!.track)!;
      const { away, direction } = nearestOnPolyline(track.line, m);
      expect(away).toBeLessThan(0.01);
      expect(
        Math.abs(Math.cos(m.heading) * direction.y - Math.sin(m.heading) * direction.x),
      ).toBeLessThan(1e-6);
      expect(m.length).toBeLessThan(m.width);
      expect(m.embedded).toBe((track.form ?? 'embedded') === 'embedded');
    }
  }
});

test('T73 placement is deterministic; compiled stops add only service metadata', () => {
  const city = load(),
    snapshot = JSON.stringify(city),
    cc = compiled(city);
  const placements = placeTramStops(cc, city);
  expect(JSON.stringify(city)).toBe(snapshot);
  const again = load();
  expect(placeTramStops(compiled(again), again)).toEqual(placements);
  // TASK-138 carries stop metadata for service; all other compiled bytes are unchanged.
  const without = structuredClone(city);
  delete without.rail!.tramStops;
  const withStops = compiled(city);
  expect(withStops.rail!.tramStops).toHaveLength(Object.keys(city.rail!.tramStops!).length);
  delete withStops.rail!.tramStops;
  expect(hash(compiled(without))).toBe(hash(withStops));
  expect(placeTramStops(compiled(without), without)).toEqual([]);
});

/** A canvas context that records the text it draws. */
function recorder(drawn: string[]) {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'measureText'
          ? (text: string) => ({ width: text.length * 10 })
          : (...args: unknown[]) => {
              if (key === 'fillText') drawn.push(String(args[0]));
            },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return (width: number, height: number) =>
    ({ width, height, getContext: () => context }) as unknown as HTMLCanvasElement;
}

test('T73 3D: islands rise 0.25 m, panels are batched per text, boards and displays show name and lines', () => {
  const city = load(),
    cc = compiled(city);
  const placements = placeTramStops(cc, city);
  const drawn: string[] = [];
  const stops = new TramStops3D(placements, cityHeights(cc, city), recorder(drawn));
  expect(stops.counts).toEqual(tramStopCounts(placements));
  // One vertex-coloured mesh for islands, strips and markings.
  const position = stops.paint.geometry.getAttribute('position');
  const ys = Array.from({ length: position.count }, (_, i) => position.getY(i));
  expect(Math.max(...ys)).toBeCloseTo(tramStopSize.islandM + 0.025, 2);
  expect(ys.some((y) => Math.abs(y - tramStopSize.islandM) < 1e-6)).toBe(true);
  // A name board per stop name, a display per name and set of lines: every panel mesh holds
  // the instances that share its texture.
  const boardCount = placements.reduce((n, p) => n + p.boards.length, 0);
  const displayCount = placements.filter((p) => p.display).length;
  expect(stops.panels.reduce((n, m) => n + m.count, 0)).toBe(boardCount + displayCount);
  expect(stops.panels.length).toBeLessThan(boardCount + displayCount);
  expect(stops.texts.filter((t) => t.includes('\n'))).toContain('Alpha\n5  9  N5');
  expect(drawn).toEqual(
    expect.arrayContaining(['Alpha', 'Beta', 'Delta', '5', '9', 'N5', '7', 'S1']),
  );
  // Posts: two per board and per display, four per shelter.
  const shelters = placements.reduce((n, p) => n + p.shelters.length, 0);
  expect(stops.posts.count).toBe(2 * boardCount + 2 * displayCount + 4 * shelters);
  expect(stops.roofs.count).toBe(shelters);
});

test.each(tierCities(['munich-donnersberger']))(
  'T73 %s: the 14 stops carry shelters, boards and a display on their islands',
  (name) => {
    const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: 'test',
    });
    if (!imported.ok) throw Error('import');
    const city = imported.city,
      snapshot = JSON.stringify(city),
      cc = compiled(city),
      placements = placeTramStops(cc, city);
    expect(JSON.stringify(city)).toBe(snapshot);
    expect(placements).toHaveLength(14);
    expectOnIsland(placements);
    // Munich's platforms are 2 to 3 m wide: Am Lokschuppen's 4 m fragment and Marsstraße's
    // irregular shape (ts:10820) take no shelter, and the fragment no board or display.
    expect(tramStopCounts(placements)).toEqual({
      stops: 14,
      islands: 14,
      shelters: 12,
      boards: 26,
      displays: 13,
      marks: 14,
    });
    const again = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: 'test',
    });
    if (!again.ok) throw Error('import');
    expect(placeTramStops(compiled(again.city), again.city)).toEqual(placements);
  },
);
