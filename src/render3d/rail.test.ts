import { expect, test } from 'vitest';
import { Ray, Vector3, type Mesh } from 'three';
import { buildCity } from '../fixtures/build-city';
import { compile } from '../network';
import { cityHeights } from './heights';
import { buildRail, pickRail3D } from './rail';
import { railHeightAt, railHeights, type RailGraph } from '../network/rail';
import { headingAtDistance, nearestOnPolyline, pointAtDistance } from '../geo/polyline';
import type { RailNode, RailTrack } from '../schema/rail';
import { cityGrades } from '../render/grades';

type Track = RailGraph['tracks'][number];

function bridge() {
  const { city, node, road } = buildCity('Bridge rail', 1);
  road(node(-100, 30), node(100, 30));
  city.rail = {
    nodes: {
      'rn:1': { id: 'rn:1', pos: { x: -200, y: 0 }, kind: 'plain', layer: 0 },
      'rn:2': { id: 'rn:2', pos: { x: 200, y: 0 }, kind: 'plain', layer: 0 },
    },
    tracks: {
      'rt:1': {
        id: 'rt:1',
        from: 'rn:1',
        to: 'rn:2',
        // TASK-132: long enough for 4% ramps from both ground ends to reach the 5 m deck.
        line: [
          { x: -200, y: 0 },
          { x: 200, y: 0 },
        ],
        kind: 'rail',
        layer: 1,
        bridge: true,
      },
    },
    platforms: {},
  };
  const result = compile(city);
  if (!result.ok) throw Error('compile');
  return { city, compiled: result.compiled };
}
test('T62 a two-vertex bridge has a raised deck and ground endpoints', () => {
  const { city, compiled } = bridge();
  const rail = buildRail(compiled, city, cityHeights(compiled, city));
  const p = (rail.group.children[0] as Mesh).geometry.getAttribute('position');
  const heights = Array.from({ length: p.count }, (_, i) => p.getY(i));
  expect(Math.max(...heights)).toBeGreaterThan(5);
  expect(Math.min(...heights)).toBeCloseTo(0.06, 3);
});
test('T62 bridge approach picking uses the same endpoint height as its mesh', () => {
  const { compiled } = bridge();
  const { roadGrades, nodeGrades } = cityGrades(compiled);
  expect(
    pickRail3D(
      compiled,
      railHeights(compiled, roadGrades, nodeGrades),
      { x: -200, y: 0 },
      (p, heightM) => ({
        x: p.x,
        y: heightM * 100,
      }),
    ),
  ).toEqual({ kind: 'track', track: 0 });
});

// TASK-260: two parallel tracks, 4.5 m apart, over a road at x = 0: a bridge from x = -30 to 30,
// raised ground track on either side, the east side ending 30 m on (a map edge) while still up.
function parallelBridge(layers: [number, number]) {
  const { city, node, road } = buildCity('Parallel bridge', 1);
  road(node(0, -60), node(0, 60));
  const nodes: Record<string, RailNode> = {},
    tracks: Record<string, RailTrack> = {};
  for (const [k, y] of [0, 4.5].entries()) {
    const xs = [-250, -30, 30, 60];
    xs.forEach((x, i) => {
      const id = `rn:${k * 4 + i + 1}`;
      nodes[id] = { id, pos: { x, y }, kind: 'plain', layer: 0 };
    });
    for (let i = 0; i < 3; i++) {
      const id = `rt:${k * 3 + i + 1}`;
      tracks[id] = {
        id,
        from: `rn:${k * 4 + i + 1}`,
        to: `rn:${k * 4 + i + 2}`,
        line: [
          { x: xs[i]!, y },
          { x: xs[i + 1]!, y },
        ],
        kind: 'rail',
        layer: i === 1 ? layers[k]! : 0,
        ...(i === 1 ? { bridge: true } : {}),
      };
    }
  }
  city.rail = { nodes, tracks, platforms: {} };
  const result = compile(city);
  if (!result.ok) throw Error('compile');
  const compiled = result.compiled;
  const { roadGrades, nodeGrades } = cityGrades(compiled);
  const heights = railHeights(compiled, roadGrades, nodeGrades);
  const rail = buildRail(compiled, city, cityHeights(compiled, city));
  const solid = rail.group.getObjectByName('rail-structures') as Mesh;
  const p = solid.geometry.getAttribute('position');
  const triangles = Array.from({ length: p.count / 3 }, (_, t) =>
    [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(p, t * 3 + k)),
  );
  const at = (track: string, x: number) => {
    const t = compiled.rail!.tracks.find((t) => t.id === track)!;
    return railHeightAt(heights, t, Math.abs(x - t.line[0]!.x));
  };
  return { triangles, at, rail };
}
/** The highest solid surface over (x, y): its height, or -Infinity. */
function solidTop(triangles: Vector3[][], x: number, y: number) {
  const ray = new Ray(new Vector3(x, 100, y), new Vector3(0, -1, 0)),
    hit = new Vector3();
  let top = -Infinity;
  for (const [a, b, c] of triangles)
    if (ray.intersectTriangle(a!, b!, c!, false, hit)) top = Math.max(top, hit.y);
  return top;
}

test('TASK-260 a bridge over tracks at different heights is one deck that covers no bed', () => {
  // The western track crosses the road at layer 1 (5.7 m), its neighbour at layer 2 (10 m).
  const { triangles, at } = parallelBridge([1, 2]);
  for (let x = -26; x <= 26; x += 1.3)
    for (const [track, y] of [
      ['rt:2', 0],
      ['rt:5', 4.5],
    ] as const)
      for (const dy of [-1, 0, 1]) {
        // The deck meets each bed at that track's rail top, under the paint 6 cm above it.
        const top = solidTop(triangles, x, y + dy);
        expect(top).toBeLessThanOrEqual(at(track, x) + 0.001);
        expect(top).toBeGreaterThan(at(track, x) - 0.05);
      }
  // One deck: no parapet stands between the two tracks.
  expect(solidTop(triangles, 10, 2.25)).toBeLessThan(at('rt:5', 10));
});

/** Rail sections between nodes, `extra` per section, over a road across x = 0. */
function railway(
  nodes: Record<string, [number, number, RailNode['kind']?]>,
  sections: [string, string, Partial<RailTrack>?][],
) {
  const { city, node, road } = buildCity('Rail', 1);
  road(node(0, -60), node(0, 60));
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
        const line = [from, to].map((n) => ({ x: nodes[n]![0], y: nodes[n]![1] }));
        return [id, { id, from, to, line, kind: 'rail', layer: 0, ...extra } satisfies RailTrack];
      }),
    ),
    platforms: {},
  };
  const result = compile(city);
  if (!result.ok) throw Error('compile');
  const compiled = result.compiled;
  const { roadGrades, nodeGrades } = cityGrades(compiled);
  const heights = railHeights(compiled, roadGrades, nodeGrades);
  const rail = buildRail(compiled, city, cityHeights(compiled, city));
  const p = (rail.group.getObjectByName('rail-structures') as Mesh).geometry.getAttribute(
    'position',
  );
  const triangles = Array.from({ length: p.count / 3 }, (_, t) =>
    [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(p, t * 3 + k)),
  );
  const track = (id: string) => compiled.rail!.tracks.find((t) => t.id === id)!;
  const at = (id: string, x: number) =>
    railHeightAt(heights, track(id), nearestOnPolyline(track(id).line, { x, y: 0 }).along);
  return { triangles, track, at, heightOf: (t: Track, s: number) => railHeightAt(heights, t, s) };
}

test('TASK-280 a deck over a switch carries both tracks while they share a bed', () => {
  // A switch at x = -40 onto a bridge over the road: `rt:2` straight on, `rt:3` off at 3 degrees to
  // a ground switch at x = 60 that holds it low. On main the deck took the lower bed and the
  // straight track floated above it.
  const { triangles, track, heightOf } = railway(
    {
      'rn:1': [-300, 0],
      'rn:2': [-40, 0, 'switch'],
      'rn:3': [60, 0],
      'rn:4': [400, 0],
      'rn:5': [40, 4.2],
      'rn:6': [60, 5.25, 'switch'],
      'rn:7': [200, 12],
      'rn:8': [200, 22],
    },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3', { bridge: true, layer: 1 }],
      ['rn:2', 'rn:5', { bridge: true, layer: 1 }],
      ['rn:3', 'rn:4'],
      ['rn:5', 'rn:6'],
      ['rn:6', 'rn:7'],
      ['rn:6', 'rn:8'],
    ],
  );
  let checked = 0;
  for (const id of ['rt:2', 'rt:3']) {
    const t = track(id);
    for (let s = 2; s < 58; s += 1.5) {
      const p = pointAtDistance(t.line, t.cumulative, s),
        heading = headingAtDistance(t.line, t.cumulative, s),
        h = heightOf(t, s);
      for (const off of [-1, 0, 1]) {
        // Under the 6 cm paint, and no more than its depth below the rail top.
        const top = solidTop(
          triangles,
          p.x - Math.sin(heading) * off,
          p.y + Math.cos(heading) * off,
        );
        expect(top).toBeLessThan(h + 0.06);
        expect(top).toBeGreaterThan(h - 0.06);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(200);
});

test('TASK-280 an embankment beside track at grade ends in a retaining wall, not a slope over it', () => {
  // The ramp onto the bridge (y = 0) rises beside a ground track 4.5 m off (y = 4.5) that stays at
  // grade where it crosses the road; on main the ramp's slope lay over its bed.
  const { triangles, at } = railway(
    {
      'rn:1': [-250, 0],
      'rn:2': [-30, 0],
      'rn:3': [30, 0],
      'rn:4': [60, 0],
      'rn:5': [-250, 4.5],
      'rn:6': [60, 4.5],
    },
    [
      ['rn:1', 'rn:2'],
      ['rn:2', 'rn:3', { bridge: true, layer: 1 }],
      ['rn:3', 'rn:4'],
      ['rn:5', 'rn:6'],
    ],
  );
  expect(at('rt:1', -40)).toBeGreaterThan(5);
  for (let x = -200; x <= 55; x += 2.5) {
    // The deck and the embankment stand beside it: over the bed, nothing above the paint.
    for (const dy of [-1, 0, 1]) expect(solidTop(triangles, x, 4.5 + dy)).toBeLessThan(0.06);
  }
});

test('TASK-260 raised track side by side is one embankment, closed by a wall where it ends', () => {
  const { triangles, at, rail } = parallelBridge([1, 1]);
  // Between the tracks the embankment's top, not two slopes meeting below it.
  for (const x of [35, 45, 55, -60, -120])
    expect(solidTop(triangles, x, 2.25)).toBeCloseTo(at(x > 0 ? 'rt:3' : 'rt:1', x), 2);
  // Seen from beyond the east end (x = 60, 4.5 m up), the end is a wall at the end, on each track
  // and between them, not the open ends of each track's slopes.
  const end = at('rt:3', 60);
  expect(end).toBeGreaterThan(4);
  for (const y of [0, 2.25, 4.5]) {
    const ray = new Ray(new Vector3(80, end / 2, y), new Vector3(-1, 0, 0)),
      hit = new Vector3();
    let first = -Infinity;
    for (const [a, b, c] of triangles)
      if (ray.intersectTriangle(a!, b!, c!, false, hit)) first = Math.max(first, hit.x);
    expect(first).toBeGreaterThan(59);
  }
  expect(rail.structures).toMatchObject({ decks: 1, embankments: 2 });
});
