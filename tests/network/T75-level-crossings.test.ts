import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { RailNode } from '../../src/schema/rail';
import { vehicleJson } from '../vehicle-json';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { nearestOnPolyline, pointInPolygon } from '../../src/geo/polyline';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { crossingSegmentClear } from '../../src/network/level-crossings';
import { railGeometry } from '../../src/render/rail-geometry';
import { osm } from '../importers/junction-group-osm';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { citySchema } from '../../src/schema/city.schema';
import { scenarioSchema } from '../../src/schema';
import { crossingCounts, crossingDrawings } from '../../src/render/level-crossings';
import { LevelCrossings3D } from '../../src/render3d/level-crossings';
import { cityHeights } from '../../src/render3d/heights';
import { crossingOsm } from '../importers/level-crossing-osm';
import { tierCities } from '../tier';

function load(xml = crossingOsm()) {
  const r = importOsm(xml, { importerVersion: 'test' });
  if (!r.ok) throw Error(JSON.stringify(r.diagnostics));
  const cc = compile(r.city);
  if (!cc.ok) throw Error('compile');
  return { city: r.city, cc: cc.compiled };
}
test('T75 imports mapped equipment and distinguishes road, tram, pedestrian and grade-separated crossings', async () => {
  const { city, cc } = load();
  expect(
    Object.values(city.rail!.nodes)
      .filter((n) => n.crossing)
      .map((n) => n.crossing!.kind)
      .sort(),
  ).toEqual(['pedestrian', 'rail', 'tram']);
  expect(crossingCounts(cc.rail!.facilities!)).toEqual({
    rail: 1,
    tram: 1,
    approaches: 4,
    gates: 2,
    lights: 4,
    bells: 2,
  });
  const saved = await saveProject({
    city,
    scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))],
  });
  const opened = await openProject(saved);
  expect(opened.ok).toBe(true);
  if (opened.ok) expect(opened.project.city.rail).toEqual(city.rail);
  const old = structuredClone(city);
  for (const n of Object.values(old.rail!.nodes)) delete n.crossing;
  expect(citySchema.safeParse(old).success).toBe(true);
  const oldCompiled = compile(old);
  expect(oldCompiled.ok).toBe(true);
  if (oldCompiled.ok) expect(oldCompiled.compiled.rail!.facilities).toEqual([]);
});
test('T75 shared physical placement faces road approaches, clears the running tracks, and feeds 3D unchanged', () => {
  const { city, cc } = load(),
    facilities = cc.rail!.facilities!;
  const original = JSON.stringify(city);
  const shapes = crossingDrawings(facilities);
  expect(crossingDrawings(facilities)).toEqual(shapes);
  for (const f of facilities)
    for (const a of f.approaches) {
      const node = city.rail!.nodes[f.nodes[0]!]!;
      const to = { x: node.pos.x - a.pos.x, y: node.pos.y - a.pos.y };
      expect(to.x * Math.cos(a.heading) + to.y * Math.sin(a.heading)).toBeGreaterThan(4);
      expect(Math.hypot(a.post.x - a.pos.x, a.post.y - a.pos.y)).toBeCloseTo(a.halfWidthM + 0.8);
      for (const t of cc.rail!.tracks.filter((t) => !t.bridge))
        expect(nearestOnPolyline(t.line, a.post).away).toBeGreaterThanOrEqual(3);
    }
  const view = new LevelCrossings3D(facilities, cityHeights(cc, city));
  expect(view.counts).toEqual(crossingCounts(facilities));
  expect(view.group.children.length).toBeGreaterThan(3);
  expect(shapes[0]!.crosses).toHaveLength(2);
  expect(shapes[1]!.crosses).toHaveLength(0);
  expect(JSON.stringify(city)).toBe(original);
});
test('T75 mapped no tags survive while sandbox rail crossings still draw gates and lights', () => {
  const { city, cc } = load(
    crossingOsm()
      .replace('v="half"', 'v="no"')
      .replaceAll('k="crossing:light" v="yes"', 'k="crossing:light" v="no"')
      .replaceAll('k="crossing:bell" v="yes"', 'k="crossing:bell" v="no"'),
  );
  expect(
    Object.values(city.rail!.nodes).find((n) => n.crossing?.kind === 'rail')!.crossing,
  ).toMatchObject({ barrier: 'no', lights: 'no', bell: 'no' });
  const railway = cc.rail!.facilities!.find((f) => f.kind === 'rail')!;
  expect(railway.approaches.every((a) => a.barrier && a.lights && !a.bell)).toBe(true);
});
test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81']))(
  'T75 %s mapped crossing census and track clearance',
  (name) => {
    const r = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
      context: false,
      terrain: false,
    });
    if (!r.ok) throw Error('import');
    const result = compile(r.city);
    if (!result.ok) throw Error('compile');
    const rail = result.compiled.rail!,
      facilities = rail.facilities!;
    for (const f of facilities)
      for (const a of f.approaches)
        for (const t of rail.tracks.filter((t) => !t.bridge && !t.tunnel))
          expect(nearestOnPolyline(t.line, a.post).away).toBeGreaterThanOrEqual(3 - 1e-7);
    for (const f of facilities)
      for (const a of f.approaches) {
        expect(
          result.compiled.roads
            .filter((r) => pointInPolygon(a.post, [...r.surface, r.surface[0]!]))
            .map((r) => r.id),
          JSON.stringify({ nodes: f.nodes, a }),
        ).toEqual([]);
        expect(
          result.compiled.nodes.some(
            (n) => n.outline.length && pointInPolygon(a.post, [...n.outline, n.outline[0]!]),
          ),
        ).toBe(false);
      }
    // Remove only TASK-136's new fields and the new tram height-pin kind. Every previous
    // canonical/compiled byte, including lanes, movements and diagnostics, stays identical.
    const oldNode = (n: RailNode) => {
      const { crossing, ...rest } = n;
      return { ...rest, ...(crossing?.kind === 'tram' ? { kind: 'plain' } : {}) };
    };
    const { markingTheme, ...source } = r.city;
    expect(markingTheme).toBe('de');
    const oldCity = {
      ...source,
      rail: {
        ...source.rail!,
        nodes: Object.fromEntries(
          Object.entries(source.rail!.nodes).map(([id, n]) => [id, oldNode(n)]),
        ),
      },
    };
    const { facilities: removed, ...oldRail } = rail;
    expect(removed).toBe(facilities);
    const oldCompiled = {
      ...result,
      compiled: { ...result.compiled, rail: { ...oldRail, nodes: rail.nodes.map(oldNode) } },
    };
    const hash = (v: unknown) => createHash('sha256').update(vehicleJson(v)).digest('hex');
    const before = name.startsWith('munich')
      ? [
          '7be026f2964c879ee0767a1fa6b700ad818352f63fc4a36991a82aa699ec3df4',
          // TASK-152 appends 87 Munich bay departure connectors (lane connector lists too); with them
          // removed every pin equals 3e9951a's.
          '895b6f92a41c0c8d89d48c67c8bfb79d42ddcff109e284998df885b3138740d6',
        ]
      : [
          '36ead1d461cbee968be497791dcc660e529b81aba385ac33701c57b730a9e1ba',
          'f27bfb37d71fd86db87c963c9797d048a9606617bea9ecfbc369fe316a550cea',
        ];
    expect([hash(oldCity), hash(oldCompiled)]).toEqual(before);
    expect(crossingCounts(facilities)).toMatchObject(
      name.startsWith('munich')
        ? { rail: 2, tram: 4, approaches: 9, gates: 5 }
        : { rail: 18, tram: 0, approaches: 26, gates: 26 },
    );
    console.info('T75 census', name, {
      mapped: Object.values(r.city.rail!.nodes)
        .filter((n) => n.crossing)
        .map((n) => n.crossing!.kind)
        .reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}),
      equippedNodes: facilities.reduce((n, f) => n + f.nodes.length, 0),
      ...crossingCounts(facilities),
    });
  },
);

test('T75 one-way crossings equip only incoming approaches and left-hand projects use the left kerb', () => {
  const { city, cc } = load(
    crossingOsm().replaceAll(
      '<tag k="highway" v="residential"/>',
      '<tag k="highway" v="residential"/><tag k="oneway" v="yes"/>',
    ),
  );
  for (const f of cc.rail!.facilities!) expect(f.approaches).toHaveLength(1);
  city.drivingSide = 'left';
  const left = compile(city);
  if (!left.ok) throw Error('compile');
  for (const f of left.compiled.rail!.facilities!)
    for (const a of f.approaches) {
      const side =
        -(a.post.x - a.pos.x) * Math.sin(a.heading) + (a.post.y - a.pos.y) * Math.cos(a.heading);
      expect(side).toBeLessThan(-a.halfWidthM);
    }
});
test('T75 diagonal rail clearance checks the complete marking segment', () => {
  const a = { x: -5, y: 0 },
    b = { x: 5, y: 0 };
  const diagonal = [
    { x: -7, y: -10 },
    { x: 8, y: 10 },
  ];
  expect(nearestOnPolyline(diagonal, a).away).toBeGreaterThan(3);
  expect(nearestOnPolyline(diagonal, b).away).toBeGreaterThan(3);
  expect(crossingSegmentClear(a, b, diagonal)).toBe(false);
});
test('T75 nearby disconnected roads do not merge into one facility', () => {
  const { cc } = load(
    osm(
      [
        {
          id: 1,
          tags: { highway: 'service' },
          points: [
            [-100, 0],
            [-8, 0],
            [-2, 0],
          ],
        },
        {
          id: 2,
          tags: { highway: 'service' },
          points: [
            [2, 0],
            [8, 0],
            [100, 0],
          ],
        },
        {
          id: 3,
          tags: { railway: 'rail' },
          points: [
            [-8, -100],
            [-8, 0],
            [-8, 100],
          ],
        },
        {
          id: 4,
          tags: { railway: 'rail' },
          points: [
            [8, -100],
            [8, 0],
            [8, 100],
          ],
        },
      ],
      { '-8,0': { railway: 'level_crossing' }, '8,0': { railway: 'level_crossing' } },
    ),
  );
  expect(cc.rail!.facilities).toHaveLength(2);
});
test('T75 exposed railheads continue through road surfaces in the shared 2D/3D geometry', () => {
  const { city, cc } = load();
  const rails = railGeometry(cc, city).filter((s) => s.crossing);
  expect(rails.length).toBeGreaterThan(0);
  expect(rails.every((s) => s.over && s.detail && s.pick?.kind === 'track')).toBe(true);
  expect(
    rails.some((s) =>
      s.polygons.some((p) =>
        p.some((v) => cc.roads.some((r) => pointInPolygon(v, [...r.surface, r.surface[0]!]))),
      ),
    ),
  ).toBe(true);
});

test.each(['level_crossing', 'tram_level_crossing'] as const)(
  'T75 %s on an excluded driveway never attaches to an unrelated nearby road',
  (kind) => {
    const { city, cc } = load(
      osm(
        [
          {
            id: 1,
            tags: { highway: 'service', service: 'driveway' },
            points: [
              [-100, 0],
              [0, 0],
              [100, 0],
            ],
          },
          {
            id: 2,
            tags: { highway: 'residential' },
            points: [
              [-100, 0.5],
              [0, 0.5],
              [100, 0.5],
            ],
          },
          {
            id: 3,
            tags: { railway: kind === 'level_crossing' ? 'rail' : 'tram' },
            points: [
              [0, -100],
              [0, 0],
              [0, 100],
            ],
          },
          {
            id: 4,
            tags: { highway: 'residential', bridge: 'yes', layer: '1' },
            points: [
              [-100, 0.8],
              [0, 0.8],
              [100, 0.8],
            ],
          },
        ],
        { '0,0': { railway: kind } },
      ),
    );
    const crossing = Object.values(city.rail!.nodes).find((n) => n.crossing)!;
    expect(crossing.crossing!.roadOsmIds).toEqual([1]);
    expect(cc.rail!.facilities).toEqual([]);
  },
);

test('T75 covered building passages remain at grade; ordinary tunnels and bridges are separated', () => {
  for (const [key, value, visible] of [
    ['tunnel', 'building_passage', true],
    ['tunnel', 'yes', false],
    ['bridge', 'yes', false],
  ] as const) {
    const { cc } = load(
      crossingOsm().replace(
        '<tag k="railway" v="rail"/>',
        `<tag k="railway" v="rail"/><tag k="${key}" v="${value}"/>`,
      ),
    );
    expect(
      cc.rail!.facilities!.some((f) => f.kind === 'rail'),
      `${key}=${value}`,
    ).toBe(visible);
    expect(cc.rail!.facilities!.some((f) => f.kind === 'tram')).toBe(true);
  }
});
