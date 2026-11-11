import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { importOsm } from '../../src/importers/osm';
import { parseOsm } from '../../src/importers/osm/parse';
import { isTramStopNode, tramIsland } from '../../src/importers/osm/tram-stops';
import { distance, nearestOnPolyline, pointInPolygon } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile } from '../../src/network';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { scenarioSchema } from '../../src/schema';
import type { City } from '../../src/schema';
import { citySchema } from '../../src/schema/city.schema';
import { tierCities } from '../tier';
import { osm } from './junction-group-osm';
import { line, stopTags, synthetic } from './tram-stop-osm';

// TASK-137 (T73): tram stops from OSM stop positions and platforms: grouped by name and side,
// mapped platforms kept, islands generated for the rest and clear of every carriageway.

function load(xml = synthetic()) {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result;
}
const stopsOf = (city: City, name: string) =>
  Object.values(city.rail!.tramStops!).filter((s) => s.name === name);
const mean = (ring: Vec2[]) => ({
  x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
  y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
});
const ringOf = (city: City, stop: { platform: unknown }) => {
  const p = stop.platform as { kind: string; ring?: Vec2[]; platform?: string } | null;
  if (p?.kind === 'generated') return p.ring!;
  return (city.rail!.platforms[p!.platform!]!.shape as { ring: Vec2[] }).ring;
};

test('T73 stops group by name and side: one per island, each tied to the tracks it serves', () => {
  const { city } = load();
  const alpha = stopsOf(city, 'Alpha');
  expect(alpha).toHaveLength(2);
  // Each side's stop position joined the platform beside its own track.
  const [north, south] = alpha.sort((a, b) => ringOf(city, a)[0]!.y - ringOf(city, b)[0]!.y);
  for (const stop of alpha) {
    expect(stop.platform?.kind).toBe('mapped');
    expect(stop.provenance?.inferred).toBeUndefined();
    expect(stop.lines).toEqual(['5', '9', 'N5']);
    expect(stop.halts).toHaveLength(1);
    expect(stop.osmIds).toHaveLength(2);
  }
  const trackY = (id: string) => city.rail!.tracks[id]!.line[0]!.y;
  // The stop position joins the two sections of its track, west and east of it.
  expect(north!.tracks.map(trackY).map(Math.round)).toEqual([40, 40]);
  expect(south!.tracks.map(trackY).map(Math.round)).toEqual([45, 45]);
  expect(Math.abs(north!.halts[0]!.pos.y - 40)).toBeLessThan(0.1);
  expect(Math.abs(south!.halts[0]!.pos.y - 45)).toBeLessThan(0.1);
  // A tag on one platform does not leak to the other.
  expect(north!.shelter).toBeUndefined();
  expect(south!.shelter).toBe(true);
  // Delta's two tracks, 6 m apart, share one centre island; Epsilon and Beta stand alone.
  expect(stopsOf(city, 'Delta')).toHaveLength(1);
  expect(stopsOf(city, 'Delta')[0]!.tracks).toHaveLength(4);
  expect(stopsOf(city, 'Epsilon')).toHaveLength(1);
  expect(stopsOf(city, 'Beta')).toHaveLength(1);
  expect(Object.keys(city.rail!.tramStops!)).toHaveLength(2 + 1 + 1 + 1 + 1);
  expect(citySchema.safeParse(city).success).toBe(true);
});

test('T73 mapped platforms keep their shapes; a railway=platform beside a tram track is one', () => {
  const { city } = load();
  const rect = (name: string, y: number) => {
    const stop = stopsOf(city, name).find((s) => Math.abs(mean(ringOf(city, s)).y - y) < 3)!;
    return ringOf(city, stop);
  };
  const near = (a: Vec2, x: number, y: number) => distance(a, { x, y }) < 0.5;
  const ring = rect('Alpha', 37.35);
  expect(ring).toHaveLength(5);
  expect(ring.some((p) => near(p, -15, 36.1))).toBe(true);
  expect(ring.some((p) => near(p, 15, 38.6))).toBe(true);
  // Epsilon's platform has no `tram=yes`: the track beside it makes it a tram platform.
  const epsilon = stopsOf(city, 'Epsilon')[0]!;
  expect(epsilon.platform).toEqual({ kind: 'mapped', platform: expect.stringMatching(/^rp:/) });
  expect(epsilon.shelter).toBe(false);
  expect(epsilon.bench).toBe(true);
  const shape = city.rail!.platforms[(epsilon.platform as { platform: string }).platform]!.shape;
  expect(shape.kind).toBe('polygon');
});

test('T73 a stop position without a platform gets an island beside its track, clear of every carriageway', () => {
  const { city } = load();
  const compiled = compile(city);
  if (!compiled.ok) throw Error('compile');
  const beta = stopsOf(city, 'Beta')[0]!;
  expect(beta.platform?.kind).toBe('generated');
  expect(beta.provenance?.inferred).toEqual(['platform']);
  expect(beta.lines).toEqual(['7', 'S1']);
  // On the side the platform node lies (north of the track at y = 100): 2.5 m wide from 1.4 m.
  const ring = ringOf(city, beta);
  const ys = ring.map((p) => p.y),
    xs = ring.map((p) => p.x);
  expect(Math.max(...ys)).toBeCloseTo(100 - tramIsland.clearM, 1);
  expect(Math.min(...ys)).toBeCloseTo(100 - tramIsland.clearM - tramIsland.widthM, 1);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(tramIsland.lengthM, 0);
  expect(beta.halts[0]!.pos.x).toBeGreaterThan(Math.min(...xs));
  expect(beta.halts[0]!.pos.x).toBeLessThan(Math.max(...xs));
  // Gamma stands beside Main's carriageway: the island goes where there is no lane.
  const gamma = stopsOf(city, 'Gamma')[0]!;
  expect(gamma.platform?.kind).toBe('generated');
  const roads = compiled.compiled.roads.map((r) => [...r.surface, r.surface[0]!]);
  for (const stop of Object.values(city.rail!.tramStops!)) {
    if (stop.platform?.kind !== 'generated') continue;
    const island = stop.platform.ring;
    for (let i = 0; i < island.length; i++) {
      const a = island[i]!,
        b = island[(i + 1) % island.length]!;
      // The corners and a sample along every edge are outside every road surface.
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        expect({ stop: stop.id, p, inRoad: roads.some((r) => pointInPolygon(p, r, 0)) }).toEqual({
          stop: stop.id,
          p,
          inRoad: false,
        });
      }
    }
  }
  expect(Math.max(...ringOf(city, gamma).map((p) => p.y))).toBeLessThan(-9);
  // Delta's centre island lies between its two tracks, 1.4 m from each.
  const delta = stopsOf(city, 'Delta')[0]!;
  expect(delta.platform?.kind).toBe('generated');
  const dys = ringOf(city, delta).map((p) => p.y);
  expect(Math.min(...dys)).toBeCloseTo(160 + tramIsland.clearM, 1);
  expect(Math.max(...dys)).toBeCloseTo(166 - tramIsland.clearM, 1);
});

test('T73 an island with no room beside its track is left out and noted; the stop stays', () => {
  // The tram runs inside a four-lane street: both sides are carriageway.
  const { city, diagnostics } = load(
    osm(
      [
        {
          id: 1,
          tags: { highway: 'secondary', lanes: '4', name: 'Main' },
          points: [
            [-250, 0],
            [0, 0],
            [250, 0],
          ],
        },
        { id: 2, tags: { railway: 'tram', embedded: 'yes' }, points: line(0) },
      ],
      { '0,0': stopTags('Inside') },
    ),
  );
  const [stop] = Object.values(city.rail!.tramStops!);
  expect(stop!.name).toBe('Inside');
  expect(stop!.platform).toBeNull();
  const note = diagnostics.find((d) => d.code === 'osm_tram_stop_no_island')!;
  expect(note.severity).toBe('info');
  expect(note.refs).toEqual([stop!.id]);
});

test('T73 tram stops survive ZIP save and open', async () => {
  const { city } = load();
  const opened = await openProject(
    await saveProject({ city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] }),
  );
  expect(opened.ok).toBe(true);
  if (opened.ok) expect(opened.project.city.rail!.tramStops).toEqual(city.rail!.tramStops);
});

test('T73 the same import gives the same city, and trams without stops get no tram stops', () => {
  const hash = (c: City) => createHash('sha256').update(JSON.stringify(c)).digest('hex');
  expect(hash(load().city)).toBe(hash(load().city));
  const none = load(
    osm(
      [
        {
          id: 1,
          tags: { highway: 'secondary', lanes: '4', name: 'Main' },
          points: [
            [-250, 40],
            [250, 40],
          ],
        },
        { id: 2, tags: { railway: 'tram' }, points: line(80) },
      ],
      {},
    ),
  );
  expect(none.city.rail!.tracks).not.toEqual({});
  expect(none.city.rail!.tramStops).toBeUndefined();
});

test.each(tierCities(['munich-donnersberger']))(
  'T73 %s: every railway=tram_stop becomes a stop or is listed with its reason',
  (name) => {
    const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
    const result = importOsmCached(xml, { importerVersion: 'test' });
    if (!result.ok) throw Error('import');
    const city = result.city;
    const data = parseOsm(xml);
    if (typeof data === 'string') throw Error(data);
    const nodes = data.node.filter((n) => n.tag.railway === 'tram_stop');
    expect(nodes).toHaveLength(19);
    const stops = Object.values(city.rail!.tramStops!);
    const placed = new Set(stops.flatMap((s) => s.osmIds));
    const skipped = new Set(
      result.diagnostics
        .filter((d) => d.code === 'osm_tram_stop_skipped')
        .flatMap((d) => d.refs.map((r) => Number(r.slice('node/'.length)))),
    );
    const bbox = city.geo!.bbox;
    const inside = (n: { lon: number; lat: number }) =>
      n.lon >= bbox[0] && n.lon <= bbox[2] && n.lat >= bbox[1] && n.lat <= bbox[3];
    // 7 of the 19 are placed (six stop positions on a platform and the Donnersbergerstraße marker);
    // the other 12 lie outside the extract's bounding box and are listed so.
    expect(nodes.filter((n) => placed.has(n.id))).toHaveLength(7);
    for (const n of nodes) {
      expect({ id: n.id, placed: placed.has(n.id), listed: skipped.has(n.id) }).toEqual({
        id: n.id,
        placed: placed.has(n.id),
        listed: !placed.has(n.id),
      });
      if (!placed.has(n.id)) expect(inside(n)).toBe(false);
    }
    // The stop positions with `tram=yes` and `railway=stop` (Arnulfstraße) are stops, too.
    expect(
      data.node.filter((n) => isTramStopNode(n.tag) && inside(n) && !placed.has(n.id)),
    ).toEqual([]);
    // 14 islands: every mapped tram platform of the extract, none generated.
    expect(stops).toHaveLength(14);
    expect(stops.filter((s) => s.platform?.kind === 'mapped')).toHaveLength(14);
    expect(stops.filter((s) => s.platform?.kind === 'generated')).toHaveLength(0);
    for (const s of stops) {
      expect(s.tracks.every((id) => city.rail!.tracks[id]!.kind === 'tram')).toBe(true);
      expect(s.lines.length).toBeGreaterThan(0);
      expect(s.halts.length).toBeGreaterThan(0);
      for (const h of s.halts)
        expect(nearestOnPolyline(city.rail!.tracks[h.track]!.line, h.pos).away).toBeLessThan(1);
    }
    // Both directions of Trappentreustraße, Barthstraße, Schrenkstraße, Burghausener Straße,
    // Marsstraße and Donnersbergerstraße; Deroystraße and Am Lokschuppen one platform each.
    const names = Object.entries(
      stops.reduce<Record<string, number>>(
        (m, s) => ({ ...m, [s.name]: (m[s.name] ?? 0) + 1 }),
        {},
      ),
    ).sort();
    expect(names).toEqual([
      ['Am Lokschuppen', 1],
      ['Barthstraße', 2],
      ['Burghausener Straße', 2],
      ['Deroystraße', 1],
      ['Donnersbergerstraße', 2],
      ['Marsstraße', 2],
      ['Schrenkstraße', 2],
      ['Trappentreustraße', 2],
    ]);
    // The extract has no route relations: lines come from the descriptions.
    expect(stops.find((s) => s.name === 'Trappentreustraße')!.lines).toEqual(['18', '19', 'N19']);
    expect(stops.find((s) => s.name === 'Marsstraße')!.lines).toContain('16');
    // Same import, same stops.
    const again = importOsmCached(xml, { importerVersion: 'test' });
    if (!again.ok) throw Error('import');
    expect(again.city.rail!.tramStops).toEqual(city.rail!.tramStops);
    expect(citySchema.safeParse(city).success).toBe(true);
  },
);
