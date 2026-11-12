import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Mesh } from 'three';
import { importOsmCached } from '../../bench/city-cache';
import { buildCity } from '../../src/fixtures/build-city';
import { distance, nearestOnPolyline, pointInPolygon } from '../../src/geo/polyline';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import { catenary, catenaryRule, type Catenary } from '../../src/network/catenary';
import { railHeights } from '../../src/network/rail';
import { cityGrades } from '../../src/render/grades';
import { drawCatenary } from '../../src/render/layers/catenary';
import { buildCatenary } from '../../src/render3d/catenary';
import { cityHeights } from '../../src/render3d/heights';
import type { City } from '../../src/schema';
import type { RailNode, RailPlatform, RailTrack } from '../../src/schema/rail';
import { lonLat, osm } from '../importers/junction-group-osm';
import { tierCities } from '../tier';

// TASK-134 (T74): overhead lines. Tags decide which tracks are wired; parallel tracks share
// portals, single tracks get cantilever masts, and no mast stands on a frog, a level crossing,
// a road or a platform.

type Section = [from: string, to: string, extra?: Partial<RailTrack>, line?: [number, number][]];
function railway(
  city: City,
  nodes: Record<string, [number, number, RailNode['kind']?]>,
  sections: Section[],
  platforms: RailPlatform[] = [],
) {
  city.rail = {
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, [x, y, kind]]) => [
        id,
        { id, pos: { x, y }, kind: kind ?? 'plain', layer: 0 },
      ]),
    ),
    tracks: Object.fromEntries(
      sections.map(([from, to, extra, line], i) => {
        const id = `rt:${i + 1}`;
        const a = nodes[from]!,
          b = nodes[to]!;
        const points = [[a[0], a[1]], ...(line ?? []), [b[0], b[1]]] as [number, number][];
        return [
          id,
          {
            id,
            from,
            to,
            line: points.map(([x, y]) => ({ x, y })),
            kind: 'rail',
            layer: 0,
            ...extra,
          } satisfies RailTrack,
        ];
      }),
    ),
    platforms: Object.fromEntries(platforms.map((p) => [p.id, p])),
  };
  return wire(city);
}
function wire(city: City) {
  const result = compile(city);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled;
  const { roadGrades, nodeGrades } = cityGrades(compiled, city);
  return { compiled, lines: catenary(compiled, roadGrades, nodeGrades) };
}
const trackIdx = (compiled: CompiledCity, id: string) =>
  compiled.rail!.tracks.find((t) => t.id === id)!.idx;
const wiredTracks = (lines: Catenary) =>
  new Set(lines.wires.filter((w) => w.points.length > 1).flatMap((w) => w.tracks));

/** Every mast clear of tracks, frogs, level crossings, road surfaces at its level and platforms. */
function expectClear(compiled: CompiledCity, city: City, lines: Catenary) {
  const { roadGrades, nodeGrades } = cityGrades(compiled, city);
  const heights = railHeights(compiled, roadGrades, nodeGrades);
  const rail = compiled.rail!;
  const roads = [
    ...compiled.roads.map((r) => ({ ring: r.surface, grade: roadGrades[r.idx]! })),
    ...compiled.nodes.map((n) => ({ ring: n.outline, grade: nodeGrades[n.idx]! })),
  ].filter((s) => s.ring.length >= 3 && s.grade >= 0);
  for (const s of lines.supports)
    for (const m of s.masts) {
      if (m.osmId !== undefined) continue;
      for (const f of lines.frogs) expect(distance(f, m.pos)).toBeGreaterThanOrEqual(5);
      for (const n of rail.nodes.filter((n) => n.kind === 'level_crossing'))
        expect(distance(n.pos, m.pos)).toBeGreaterThanOrEqual(catenaryRule.levelCrossingM);
      for (const r of roads)
        if (r.grade * 5 >= m.h - catenaryRule.levelM)
          expect(pointInPolygon(m.pos, [...r.ring, r.ring[0]!])).toBe(false);
      for (const p of rail.platforms)
        if (p.shape.kind === 'polygon') expect(pointInPolygon(m.pos, p.shape.ring)).toBe(false);
      for (const t of rail.tracks) {
        if (heights.grades[t.idx] === 'tunnel') continue;
        const q = nearestOnPolyline(t.line, m.pos);
        if (
          Math.abs(heights.profiles[t.idx]![0]! - m.h) < 3 &&
          heights.profiles[t.idx]!.length === 1
        )
          expect(q.away).toBeGreaterThanOrEqual(
            t.kind === 'tram' ? catenaryRule.tramClearM : catenaryRule.railClearM,
          );
      }
    }
}

test('T74 tags decide the wire: no means none, untagged and contact_line wired; mapped masts', () => {
  const ways: { id: number; tags: Record<string, string>; y: number }[] = [
    { id: 6, tags: { highway: 'residential' }, y: -280 },
    { id: 1, tags: { railway: 'rail' }, y: -150 },
    { id: 2, tags: { railway: 'rail', electrified: 'no' }, y: -50 },
    { id: 3, tags: { railway: 'rail', electrified: 'contact_line', voltage: '15000' }, y: 50 },
    { id: 4, tags: { railway: 'rail', electrified: 'rail' }, y: 150 },
    { id: 5, tags: { railway: 'rail', electrified: 'yes', 'electrified:rail': 'yes' }, y: 250 },
  ];
  const { lat, lon } = lonLat(100, -147),
    far = lonLat(100, -100);
  const xml = osm(
    ways.map(({ id, tags, y }) => ({
      id,
      tags,
      points: [
        [-280, y],
        [280, y],
      ],
    })),
  ).replace(
    '</osm>',
    `<node id="9001" lat="${lat}" lon="${lon}"><tag k="power" v="catenary_mast"/></node>` +
      `<node id="9002" lat="${far.lat}" lon="${far.lon}"><tag k="power" v="catenary_mast"/></node></osm>`,
  );
  const load = () => {
    const result = importOsm(xml, { importerVersion: 'test' });
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics.slice(0, 3)));
    return result.city;
  };
  const city = load();
  const tracks = Object.values(city.rail!.tracks);
  const tag = (id: number) => tracks.find((t) => t.osmId === id)!.contactLine;
  expect([1, 2, 3, 4, 5].map(tag)).toEqual([undefined, false, true, false, false]);
  expect(city.rail!.masts!.map((m) => m.osmId)).toEqual([9001, 9002]);
  const { compiled, lines } = wire(city);
  const byWay = (id: number) => compiled.rail!.tracks.find((t) => t.osmId === id)!.idx;
  expect([1, 2, 3, 4, 5].map((id) => lines.wired[byWay(id)])).toEqual([
    true,
    false,
    true,
    false,
    false,
  ]);
  const wired = wiredTracks(lines);
  expect([1, 2, 3, 4, 5].map((id) => wired.has(byWay(id)))).toEqual([
    true,
    false,
    true,
    false,
    false,
  ]);
  for (const s of lines.supports) for (const t of s.spans) expect(lines.wired[t]).toBe(true);
  // The mapped mast 3 m from way 1 stands where it is mapped; the one 50 m away is listed.
  expect(lines.mapped.map(({ osmId, used }) => [osmId, used])).toEqual([
    [9001, true],
    [9002, false],
  ]);
  expect(lines.mapped[1]!.reason).toContain('8 m');
  const mast = lines.supports.flatMap((s) => s.masts).find((m) => m.osmId === 9001)!;
  expect(distance(mast.pos, city.rail!.masts![0]!.pos)).toBe(0);
  // Same import, same placement.
  const again = wire(load()).lines;
  expect(JSON.stringify(again)).toBe(JSON.stringify(lines));
});

test('T74 four parallel tracks share portals at aligned positions', () => {
  const { city } = buildCity('Track field', 1);
  const ys = [0, 4.5, 9, 13.5];
  const nodes: Record<string, [number, number]> = {};
  const sections: Section[] = [];
  ys.forEach((y, i) => {
    nodes[`rn:${2 * i + 1}`] = [0, y];
    nodes[`rn:${2 * i + 2}`] = [600, y];
    sections.push([`rn:${2 * i + 1}`, `rn:${2 * i + 2}`]);
  });
  const { compiled, lines } = railway(city, nodes, sections);
  expect(lines.supports.length).toBeGreaterThanOrEqual(9);
  expect(lines.bundles).toBe(1);
  const xs: number[] = [];
  for (const s of lines.supports) {
    expect(s.kind).toBe('portal');
    expect(s.masts).toHaveLength(2);
    expect(s.drops.map((d) => d.track).sort()).toEqual([0, 1, 2, 3]);
    // Aligned across the bundle, the masts outside its outer tracks.
    for (const d of s.drops) expect(d.pos.x).toBeCloseTo(s.drops[0]!.pos.x, 6);
    expect(s.masts.map((m) => m.pos.y).sort((a, b) => a - b)).toEqual([
      -catenaryRule.mastOffsetM,
      13.5 + catenaryRule.mastOffsetM,
    ]);
    xs.push(s.drops[0]!.pos.x);
  }
  xs.sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(catenaryRule.straightM + 0.5);
    expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(40);
  }
  expect(xs[0]).toBeLessThanOrEqual(catenaryRule.straightM / 2 + 1);
  // Each track's wire hangs from every portal.
  for (const w of lines.wires)
    expect(w.points.filter((p) => p.support)).toHaveLength(lines.supports.length);
  expect(trackIdx(compiled, 'rt:1')).toBe(0);
});

test('T74 a single track gets cantilever masts, closer on a tight curve', () => {
  const { city } = buildCity('Single track', 1);
  // Straight, then a quarter circle of 300 m radius.
  const arc = Array.from({ length: 19 }, (_, i) => {
    const a = (i * Math.PI) / 2 / 20;
    return [800 + 300 * Math.sin(a), 300 - 300 * Math.cos(a)] as [number, number];
  });
  const { lines } = railway(city, { 'rn:1': [0, 0], 'rn:2': [800, 0], 'rn:3': [1100, 300] }, [
    ['rn:1', 'rn:2'],
    ['rn:2', 'rn:3', {}, arc.slice(1)],
  ]);
  expect(lines.supports.length).toBeGreaterThan(15);
  for (const s of lines.supports) {
    expect(s.kind).toBe('cantilever');
    expect(s.masts).toHaveLength(1);
    expect(s.drops).toHaveLength(1);
    expect(distance(s.masts[0]!.pos, s.drops[0]!.pos)).toBeCloseTo(catenaryRule.mastOffsetM, 6);
  }
  const along = (track: number) =>
    lines.supports
      .filter((s) => s.drops[0]!.track === track)
      .map((s) => s.drops[0]!.s)
      .sort((a, b) => a - b);
  const gaps = (s: number[]) => s.slice(1).map((v, i) => v - s[i]!);
  expect(Math.max(...gaps(along(0)))).toBeLessThanOrEqual(catenaryRule.straightM + 0.5);
  // Straight track well before the curve: 60 m.
  expect(Math.min(...gaps(along(0).filter((s) => s < 700)))).toBeGreaterThan(catenaryRule.gentleM);
  expect(Math.max(...gaps(along(1)))).toBeLessThanOrEqual(catenaryRule.curveM + 0.5);
});

test('T74 no mast stands on a switch frog, a level crossing, a road or a platform', () => {
  const { city, node, road } = buildCity('Obstacles', 1);
  // A road across both tracks at x = 300 and a level crossing at x = 500 on the lower one.
  road(node(300, -80), node(300, 80));
  const platform: RailPlatform = {
    id: 'rp:1',
    shape: {
      kind: 'polygon',
      ring: [
        { x: 620, y: -7 },
        { x: 820, y: -7 },
        { x: 820, y: -2.5 },
        { x: 620, y: -2.5 },
        { x: 620, y: -7 },
      ],
    },
    layer: 0,
    name: 'Halt',
    mode: 'rail',
    tracks: ['rt:5'],
    station: null,
  };
  const { compiled, lines } = railway(
    city,
    {
      'rn:1': [0, 0],
      'rn:2': [100, 0, 'switch'],
      'rn:3': [500, 0, 'level_crossing'],
      'rn:4': [1000, 0],
      'rn:5': [0, 30],
      'rn:6': [1000, 30],
      'rn:7': [400, 30],
    },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3'],
      ['rn:3', 'rn:4'],
      // The branch leaves the switch and runs beside the upper track.
      [
        'rn:2',
        'rn:7',
        {},
        [
          [200, 4],
          [300, 18],
        ],
      ],
      ['rn:7', 'rn:6'],
      ['rn:5', 'rn:7'],
    ],
    [platform],
  );
  expect(lines.frogs.length).toBeGreaterThanOrEqual(1);
  expect(lines.supports.length).toBeGreaterThan(20);
  expectClear(compiled, city, lines);
  expect(lines.skipped).toEqual([]);
  // The track along the platform keeps its supports, masts on the far side; no drop hangs over
  // the level crossing or the road (supports moved along the track instead).
  const halt = lines.supports.filter((s) =>
    s.drops.some((d) => d.track === trackIdx(compiled, 'rt:5') && d.pos.x > 640 && d.pos.x < 800),
  );
  expect(halt.length).toBeGreaterThanOrEqual(2);
  for (const s of halt) for (const m of s.masts) expect(m.pos.y).toBeGreaterThan(-2.5);
  for (const d of lines.supports.flatMap((s) => s.drops)) {
    expect(distance(d.pos, { x: 500, y: 0 })).toBeGreaterThanOrEqual(catenaryRule.levelCrossingM);
    expect(Math.abs(d.pos.x - 300)).toBeGreaterThan(3);
  }
});

test('T74 tunnels carry the wire on fixings, bridges their masts on the deck; both views', () => {
  const { city, node, road } = buildCity('Structures', 1);
  road(node(400, -60), node(400, 60));
  const { compiled, lines } = railway(
    city,
    {
      'rn:1': [0, 0],
      'rn:2': [340, 0],
      'rn:3': [460, 0],
      'rn:4': [800, 0],
      'rn:11': [0, 200],
      'rn:12': [300, 200],
      'rn:13': [500, 200],
      'rn:14': [800, 200],
    },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3', { bridge: true, layer: 1 }],
      ['rn:3', 'rn:4'],
      ['rn:11', 'rn:12'],
      ['rn:12', 'rn:13', { tunnel: true, layer: -1 }],
      ['rn:13', 'rn:14'],
    ],
  );
  const tunnel = trackIdx(compiled, 'rt:5'),
    bridge = trackIdx(compiled, 'rt:2');
  expect(lines.supports.some((s) => s.spans.includes(tunnel))).toBe(false);
  const hidden = lines.wires.filter((w) => w.hidden);
  expect(hidden.flatMap((w) => w.tracks)).toEqual([tunnel]);
  expect(hidden[0]!.points.every((p) => p.h < -6)).toBe(true);
  const deck = lines.supports.filter((s) => s.spans.includes(bridge));
  expect(deck.length).toBeGreaterThanOrEqual(1);
  for (const s of deck) {
    expect(s.layer).toBe(1);
    expect(s.masts[0]!.h).toBeGreaterThan(5);
  }
  expectClear(compiled, city, lines);
  // 2D: supports and wires per grade, without the tunnel's wire.
  const drawn = drawCatenary(lines);
  expect([...drawn.keys()].sort()).toEqual([0, 1]);
  // 3D: one mesh per kind; the tunnel wire only with "See below ground".
  const view = buildCatenary(compiled, city, cityHeights(compiled, city));
  const names = view.group.children.map((c) => c.name).sort();
  expect(names).toEqual([
    'catenary-beams',
    'catenary-masts',
    'catenary-tunnel-wires',
    'catenary-wires',
  ]);
  const below = view.group.getObjectByName('catenary-tunnel-wires') as Mesh;
  expect(below.visible).toBe(false);
  view.setBelowGround(true);
  expect(below.visible).toBe(true);
});

test('T74 street trams get side or centre poles off the road', () => {
  const { city, node, road } = buildCity('Tram street', 1);
  road(node(-50, 0), node(650, 0), { lanes: 2 });
  const { compiled, lines } = railway(
    city,
    { 'rn:1': [0, -1.6], 'rn:2': [600, -1.6], 'rn:3': [0, 1.6], 'rn:4': [600, 1.6] },
    [
      ['rn:1', 'rn:2', { kind: 'tram', form: 'embedded' }],
      ['rn:3', 'rn:4', { kind: 'tram', form: 'embedded' }],
    ],
  );
  expect(lines.supports.length).toBeGreaterThan(8);
  for (const s of lines.supports) {
    expect(s.tram).toBe(true);
    expect(s.kind).toBe('cantilever');
    expect(s.drops).toHaveLength(2);
  }
  expectClear(compiled, city, lines);
});

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81']))(
  'T74 %s: wired and unwired sections, bundles, masts and portals',
  (name) => {
    const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
    const imported = importOsmCached(xml, { importerVersion: '1' });
    if (!imported.ok) throw Error('import');
    const { compiled, lines } = wire(imported.city);
    const tracks = compiled.rail!.tracks;
    const counts = {
      sections: tracks.length,
      tagged: tracks.filter((t) => t.contactLine === true).length,
      untagged: tracks.filter((t) => t.contactLine === undefined).length,
      unwired: tracks.filter((t) => t.contactLine === false).length,
      bundles: lines.bundles,
      supports: lines.supports.length,
      portals: lines.supports.filter((s) => s.kind === 'portal').length,
      cantilevers: lines.supports.filter((s) => s.kind === 'cantilever').length,
      masts: lines.supports.reduce((n, s) => n + s.masts.length, 0),
      widest: Math.max(...lines.supports.map((s) => s.spans.length)),
      shifted: lines.supports.filter((s) => s.shiftM > 0).length,
      skipped: lines.skipped.length,
      mapped: lines.mapped.length,
    };
    console.log(name, JSON.stringify(counts));
    expect(lines.mapped).toEqual([]);
    if (name.startsWith('munich')) {
      // Three ways tagged electrified=no: four sections (ways 289026421, 490580881, 543745078).
      expect(counts.unwired).toBe(4);
      expect(counts.portals).toBeGreaterThan(50);
      expect(counts.skipped).toBe(0);
    } else {
      // Sindelfingen's works sidings are all tagged electrified=no.
      expect(counts.unwired).toBe(counts.sections);
      expect(counts.supports).toBe(0);
    }
    expectClear(compiled, imported.city, lines);
  },
);
