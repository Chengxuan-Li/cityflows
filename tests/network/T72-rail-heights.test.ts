import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { Mesh } from 'three';
import { buildCity } from '../../src/fixtures/build-city';
import { pointAtDistance, pointInPolygon } from '../../src/geo/polyline';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import { railGrade, railHeightAt, railHeights } from '../../src/network/rail';
import { cityGrades } from '../../src/render/grades';
import { railGeometry } from '../../src/render/rail-geometry';
import { cityHeights } from '../../src/render3d/heights';
import { buildRail } from '../../src/render3d/rail';
import type { City } from '../../src/schema';
import type { RailNode, RailTrack } from '../../src/schema/rail';
import { osm } from '../importers/junction-group-osm';

// TASK-132 (T72): rail grades. Tunnels lie below ground, bridges clear what they cross, and the
// ramps between them keep within 4% (6% for trams) on the ground-level side, off switches,
// level crossings and road surfaces.

type Section = [from: string, to: string, extra?: Partial<RailTrack>];
function railway(
  city: City,
  nodes: Record<string, [number, number, RailNode['kind']?]>,
  sections: Section[],
) {
  city.rail = {
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, [x, y, kind]]) => [
        id,
        { id, pos: { x, y }, kind: kind ?? 'plain', layer: 0 },
      ]),
    ),
    tracks: Object.fromEntries(
      sections.map(([from, to, extra], i) => {
        const id = `rt:${i + 1}`;
        const a = nodes[from]!,
          b = nodes[to]!;
        return [
          id,
          {
            id,
            from,
            to,
            line: [
              { x: a[0], y: a[1] },
              { x: b[0], y: b[1] },
            ],
            kind: 'rail',
            layer: 0,
            ...extra,
          } satisfies RailTrack,
        ];
      }),
    ),
    platforms: {},
  };
  const result = compile(city);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled;
  const { roadGrades, nodeGrades } = cityGrades(compiled);
  return { compiled, heights: railHeights(compiled, roadGrades, nodeGrades) };
}
const track = (compiled: CompiledCity, id: string) =>
  compiled.rail!.tracks.find((t) => t.id === id)!;
/** Height every metre along a track. */
function profile(compiled: CompiledCity, heights: ReturnType<typeof railHeights>, id: string) {
  const t = track(compiled, id);
  return Array.from({ length: Math.floor(t.lengthM) + 1 }, (_, s) => ({
    s,
    p: pointAtDistance(t.line, t.cumulative, s),
    h: railHeightAt(heights, t, s),
  }));
}
function steepest(compiled: CompiledCity, heights: ReturnType<typeof railHeights>) {
  let worst = 0;
  for (const t of compiled.rail!.tracks) {
    const p = heights.profiles[t.idx]!;
    const step = t.lengthM / (p.length - 1);
    for (let i = 1; i < p.length; i++)
      worst = Math.max(worst, Math.abs(p[i]! - p[i - 1]!) / step / railGrade.maxGrade(t.kind));
  }
  return worst;
}

test('T72 a tunnel section sits below ground with portals at its ends, drawn in both views', () => {
  const { city, node, road } = buildCity('Tunnel', 1);
  road(node(0, 60), node(800, 60));
  const { compiled, heights } = railway(
    city,
    { 'rn:1': [0, 0], 'rn:2': [300, 0], 'rn:3': [500, 0], 'rn:4': [800, 0] },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3', { tunnel: true, layer: -1 }],
      ['rn:3', 'rn:4'],
    ],
  );
  expect(heights.grades).toEqual(['ground', 'tunnel', 'ground']);
  // Train clearance plus cover all the way to both portals; the ramps are outside.
  expect(profile(compiled, heights, 'rt:2').every((q) => q.h === railGrade.tunnelM)).toBe(true);
  expect(heights.portals.map((p) => [compiled.rail!.nodes[p.node]!.id, p.kind]).sort()).toEqual([
    ['rn:2', 'tunnel'],
    ['rn:3', 'tunnel'],
  ]);
  const approach = profile(compiled, heights, 'rt:1');
  expect(approach[0]!.h).toBe(0);
  expect(approach.at(-1)!.h).toBe(railGrade.tunnelM);
  // 7 m at 4% is 175 m of ramp: level ground before it.
  expect(approach.filter((q) => q.h < 0)[0]!.s).toBeGreaterThanOrEqual(300 - 175);
  expect(steepest(compiled, heights)).toBeLessThanOrEqual(1 + 1e-9);
  // 2D: the tunnel is faded with a dashed outline drawn above the ground, and two portal marks.
  const shapes = railGeometry(compiled, city);
  expect(shapes.some((s) => s.pick?.kind === 'track' && s.pick.track === 1 && s.alpha < 1)).toBe(
    true,
  );
  expect(shapes.filter((s) => s.only2d && s.over).length).toBeGreaterThanOrEqual(3);
  // 3D: the tunnel's track is hidden until "See below ground", with its tube.
  const rail = buildRail(compiled, city, cityHeights(compiled, city));
  const below = rail.group.getObjectByName('rail-below') as Mesh,
    tube = rail.group.getObjectByName('rail-tubes') as Mesh;
  expect(below.visible).toBe(false);
  expect(tube.visible).toBe(false);
  const depths = below.geometry.getAttribute('position');
  expect(Math.max(...Array.from({ length: depths.count }, (_, i) => depths.getY(i)))).toBeLessThan(
    -6,
  );
  rail.setBelowGround(true);
  expect(below.visible && tube.visible).toBe(true);
});

test('T72 a bridge over a road and a track clears both, with its ramps outside', () => {
  const { city, node, road } = buildCity('Bridge', 1);
  road(node(400, -60), node(400, 60));
  const { compiled, heights } = railway(
    city,
    {
      'rn:1': [0, 0],
      'rn:2': [340, 0],
      'rn:3': [460, 0],
      'rn:4': [800, 0],
      'rn:5': [380, -100],
      'rn:6': [380, 100],
    },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3', { bridge: true, layer: 1 }],
      ['rn:3', 'rn:4'],
      ['rn:5', 'rn:6'],
    ],
  );
  const deck = profile(compiled, heights, 'rt:2');
  // Over the track (6 m with its overhead line) and the road (4.7 m), each under a 1 m deck.
  expect(heights.levels[1]).toBe(railGrade.trackClearanceM + railGrade.deckM);
  for (const q of deck) expect(q.h).toBe(heights.levels[1]);
  const overRoad = deck.find((q) => Math.abs(q.p.x - 400) < 0.5)!;
  expect(overRoad.h - railGrade.deckM).toBeGreaterThanOrEqual(railGrade.roadClearanceM);
  // The track below keeps to the ground, and the ramps rise on the ground-level side.
  expect(profile(compiled, heights, 'rt:4').every((q) => q.h === 0)).toBe(true);
  expect(profile(compiled, heights, 'rt:1').at(-1)!.h).toBe(heights.levels[1]);
  expect(steepest(compiled, heights)).toBeLessThanOrEqual(1 + 1e-9);
  expect(heights.portals.filter((p) => p.kind === 'bridge')).toHaveLength(2);
  // A bridge over a road alone clears it by 4.7 m.
  const alone = buildCity('Road bridge', 1);
  alone.road(alone.node(400, -60), alone.node(400, 60));
  const roadOnly = railway(
    alone.city,
    { 'rn:1': [0, 0], 'rn:2': [340, 0], 'rn:3': [460, 0], 'rn:4': [800, 0] },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3', { bridge: true, layer: 1 }],
      ['rn:3', 'rn:4'],
    ],
  );
  expect(roadOnly.heights.levels[1]).toBeCloseTo(railGrade.roadClearanceM + railGrade.deckM, 9);
});

test('T72 ramps keep within 4% for rail and 6% for trams, off switches, level crossings and junctions', () => {
  const { city, node, road } = buildCity('Ramps', 1);
  // A road crossing the second rail approach at x = 200, and a junction the tram approach runs
  // through at x = 230, both inside the 175 m (117 m) the ramps would otherwise take.
  road(node(200, -210), node(200, -90));
  const centre = node(230, 300);
  road(node(230, 240), centre);
  road(centre, node(230, 360));
  road(centre, node(170, 240));
  const { compiled, heights } = railway(
    city,
    {
      'rn:1': [0, 0],
      'rn:2': [240, 0, 'switch'],
      'rn:3': [300, 0],
      'rn:4': [600, 0],
      'rn:5': [420, 60],
      'rn:11': [0, 300],
      'rn:12': [300, 300],
      'rn:13': [500, 300],
      'rn:21': [0, -150],
      'rn:22': [300, -150],
      'rn:23': [600, -150],
    },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3'],
      ['rn:3', 'rn:4', { tunnel: true, layer: -1 }],
      ['rn:2', 'rn:5'],
      ['rn:11', 'rn:12', { kind: 'tram' }],
      ['rn:12', 'rn:13', { kind: 'tram', tunnel: true, layer: -1 }],
      ['rn:21', 'rn:22'],
      ['rn:22', 'rn:23', { tunnel: true, layer: -1 }],
    ],
  );
  // The switch 60 m before the portal holds the ramp: the portal is 2.4 m deep, the tunnel
  // reaches its 7 m inside, and neither branch beyond the switch dips.
  expect(profile(compiled, heights, 'rt:2')[0]!.h).toBe(0);
  expect(railHeightAt(heights, track(compiled, 'rt:3'), 0)).toBeCloseTo(-0.04 * 60, 6);
  expect(Math.min(...heights.profiles[2]!)).toBe(railGrade.tunnelM);
  for (const id of ['rt:1', 'rt:4'])
    expect(profile(compiled, heights, id).every((q) => q.h === 0)).toBe(true);
  // The road at x = 200 and the junction at x = 230 hold their ramps: both portals are shallower
  // than 7 m and the tunnels deepen inside; trams ramp at 6%, railways at 4%.
  for (const [ground, tunnel, at, grade] of [
    ['rt:7', 'rt:8', 200, 0.04],
    ['rt:5', 'rt:6', 230, 0.06],
  ] as const) {
    const approach = profile(compiled, heights, ground);
    expect(approach.find((q) => q.s === at)!.h).toBe(0);
    const portal = railHeightAt(heights, track(compiled, tunnel), 0);
    expect(portal).toBeGreaterThan(railGrade.tunnelM);
    expect(portal).toBeLessThan(-grade * (300 - at - 12));
    expect(Math.min(...heights.profiles[track(compiled, tunnel).idx]!)).toBe(railGrade.tunnelM);
    const slope = Math.max(...approach.slice(1).map((q, i) => Math.abs(q.h - approach[i]!.h)));
    expect(slope).toBeGreaterThan(grade - 0.005);
  }
  expect(steepest(compiled, heights)).toBeLessThanOrEqual(1 + 1e-9);
  // Every sample on a road or junction surface stays at grade.
  const surfaces = [
    ...compiled.roads.map((r) => r.surface),
    ...compiled.nodes.filter((n) => n.outline.length >= 3).map((n) => n.outline),
  ].map((ring) => [...ring, ring[0]!]);
  let onSurface = 0;
  for (const t of compiled.rail!.tracks)
    for (const q of profile(compiled, heights, t.id))
      if (surfaces.some((ring) => pointInPolygon(q.p, ring))) {
        onSurface++;
        expect({ track: t.id, s: q.s, h: q.h }).toEqual({ track: t.id, s: q.s, h: 0 });
      }
  expect(onSurface).toBeGreaterThan(5);
  // A level crossing node holds its ramp too.
  const crossing = buildCity('Level crossing', 1);
  const pinned = railway(
    crossing.city,
    { 'rn:1': [0, 0], 'rn:2': [250, 0, 'level_crossing'], 'rn:3': [300, 0], 'rn:4': [600, 0] },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3'],
      ['rn:3', 'rn:4', { tunnel: true, layer: -1 }],
    ],
  );
  expect(profile(pinned.compiled, pinned.heights, 'rt:2')[0]!.h).toBe(0);
  expect(profile(pinned.compiled, pinned.heights, 'rt:1').every((q) => q.h === 0)).toBe(true);
});

test('T72 same import, same hash: tunnels, building passages and bridges from OSM', () => {
  const xml = osm([
    {
      id: 1,
      tags: { highway: 'residential' },
      points: [
        [-250, -200],
        [250, -200],
      ],
    },
    {
      id: 2,
      tags: { railway: 'rail' },
      points: [
        [-290, 0],
        [-100, 0],
      ],
    },
    {
      id: 3,
      tags: { railway: 'rail', tunnel: 'yes', layer: '-1' },
      points: [
        [-100, 0],
        [100, 0],
      ],
    },
    {
      id: 4,
      tags: { railway: 'rail' },
      points: [
        [100, 0],
        [290, 0],
      ],
    },
    {
      id: 5,
      tags: { railway: 'rail', service: 'yard', tunnel: 'building_passage' },
      points: [
        [-200, 150],
        [200, 150],
      ],
    },
  ]);
  const load = () => {
    const result = importOsm(xml, { importerVersion: 'test' });
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics.slice(0, 3)));
    return result.city;
  };
  const hash = (city: City) => createHash('sha256').update(JSON.stringify(city)).digest('hex');
  const a = load(),
    b = load();
  expect(hash(a)).toBe(hash(b));
  const tracks = Object.values(a.rail!.tracks);
  const passage = tracks.find((t) => t.osmId === 5)!;
  // A building passage keeps its layer (-1, below the building) but stays at grade.
  expect(passage).toMatchObject({ covered: true, tunnel: true, layer: -1 });
  expect(tracks.filter((t) => t.covered)).toHaveLength(1);
  const heightsOf = (city: City) => {
    const result = compile(city);
    if (!result.ok) throw Error('compile');
    const { roadGrades, nodeGrades } = cityGrades(result.compiled);
    return {
      compiled: result.compiled,
      heights: railHeights(result.compiled, roadGrades, nodeGrades),
    };
  };
  const one = heightsOf(a),
    two = heightsOf(b);
  expect(one.heights.profiles.map((p) => Array.from(p))).toEqual(
    two.heights.profiles.map((p) => Array.from(p)),
  );
  const byWay = (id: number) => one.compiled.rail!.tracks.filter((t) => t.osmId === id);
  for (const t of byWay(5)) expect(Array.from(one.heights.profiles[t.idx]!)).toEqual([0]);
  for (const t of byWay(3)) expect(one.heights.profiles[t.idx]!.every((h) => h === -7)).toBe(true);
  expect(one.heights.grades[byWay(5)[0]!.idx]).toBe('covered');
});
