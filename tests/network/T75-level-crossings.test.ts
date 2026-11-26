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
          // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
          // TASK-190: no bay under 4.5 m of a ramp: Munich pk:2050 and pk:2056 lose 2 + 4 bays, so their capacities and every
          // later parking space and connector index move; with the bays restored every pin equals 9680f36's.
          // TASK-194: generated signal programs are actuated (`actuated: true`).
          // TASK-214: lanes through splits and merges (Munich: r:589, r:728, the n:27 and n:194 ramps).
          // TASK-220: 16 of Munich's 54 tram tracks change `form` (10 grass, 6 embedded); with every
          // tram `form` stripped the city equals b3bcde6's.
          // TASK-233: Munich's 10 Trappentreustraße roads are shared lanes (sharedLane inferred, no centre line).
          // TASK-271: Munich's 14 passage roads and 77 passage walk links at grade.
          // TASK-290: Munich's mapped garage entrance moves c:1911 from r:1071 to r:1070.
          '6fcdf825427650c4e60b14bcd890aa1c53e92dc162a239505d91716aa21e1af6',
          // TASK-152, TASK-156 and TASK-164 append 87 + 22 + 17 Munich bay departure connectors (lane connector lists too); with them
          // removed every pin equals 3e9951a's.
          // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
          // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
          // TASK-190: no bay under 4.5 m of a ramp: Munich pk:2050 and pk:2056 lose 2 + 4 bays, so their capacities and every
          // later parking space and connector index move; with the bays restored every pin equals 9680f36's.
          // TASK-194: generated signal programs are actuated (`actuated: true`).
          // TASK-214: lanes through splits and merges (Munich: r:589, r:728, the n:27 and n:194 ramps).
          // TASK-220: 16 of Munich's 54 tram tracks change `form` (10 grass, 6 embedded); with every
          // tram `form` stripped the city equals b3bcde6's.
          // TASK-233: Munich's 10 Trappentreustraße roads are shared lanes (sharedLane inferred, no centre line).
          // TASK-235 (TASK-221): lane transitions carried through plain nodes (Munich: the n:194 ramp, r:259).
          // TASK-271: Munich's 14 passage roads and 77 passage walk links at grade.
          // TASK-290: Munich's compiled garage connector c:1911 moves from r:1071 to r:1070.
          // TASK-294: four public roads only Munich's private r:1109 reaches are a pocket (zone ids).
          '2a1177263f24fe71098c676118cecfc777e1c291182ac1c6d78ee9d68832cbfb',
        ]
      : [
          // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
          // TASK-194: generated signal programs are actuated (`actuated: true`).
          // TASK-214: lanes through splits and merges (Sindelfingen geometry moves by millimetres).
          // TASK-233: 8 Sindelfingen roads are shared lanes (sharedLane inferred, no centre line).
          // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
          // TASK-290: Sindelfingen's mapped garage entrance moves c:1449 from r:97 to r:954.
          // TASK-351: Entenseestraße's loop joins the circulation core; p:1408, p:1410 move onto it.
          // TASK-254: the A 81's `placement=right_of:1` (r:464, r:1252, r:1254 set 1.75 m right).
          '4c0f40e93de12c9562504506b5cad98c0d95ae2530e5d7473778ab16763dd4e3',
          // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
          // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
          // TASK-194: generated signal programs are actuated (`actuated: true`).
          // TASK-214: lanes through splits and merges (Sindelfingen geometry moves by millimetres).
          // TASK-233: 8 Sindelfingen roads are shared lanes (sharedLane inferred, no centre line).
          // TASK-235 (TASK-221): lane transitions carried through plain nodes (Sindelfingen geometry moves by millimetres).
          // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
          // TASK-290: Sindelfingen's compiled garage connector c:1449 moves from r:97 to r:954.
          // TASK-294: lot pk:1490, reached only through the works' private roads, gains its bay departures.
          // TASK-348: Sindelfingen's signalised crossings n:422 and n:733 laid out as plain nodes.
          // TASK-351: Entenseestraße's loop joins the circulation core; p:1408, p:1410 move onto it.
          // TASK-348 + TASK-351: both on main (crossings laid out as plain nodes; the new circulation core).
          // TASK-254: the A 81's `placement=right_of:1` (r:464, r:1252, r:1254 set 1.75 m right).
          'b1db199e1159bf0c626e938aa5c9b7e8997ab6377d9e19184657b47702642c33',
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
