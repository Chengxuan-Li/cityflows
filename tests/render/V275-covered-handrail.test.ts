import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { Vec2 } from '../../src/geo/vec2';
import { compile } from '../../src/network';
import { buildFootbridges, footbridgeSize } from '../../src/render3d/footbridges';
import { cityHeights } from '../../src/render3d/heights';
import type { City, HandrailSide, WalkLink } from '../../src/schema';

// TASK-275: railings by a walk link's mapped `handrail`, canopies by its `covered`.

const walkNode = (id: string, x: number, y: number, layer: number) => ({
  id,
  pos: { x, y },
  layer,
  provenance: { source: 'osm' as const },
});
const link = (
  id: string,
  from: string,
  to: string,
  line: Vec2[],
  kind: 'footway' | 'steps',
  layer: number,
): WalkLink => ({ id, from, to, line, kind, layer, widthM: 2, provenance: { source: 'osm' } });
const ring = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
  { x: x0, y: y0 },
];

/** TASK-262's fixture: an east-west street under a footbridge at x = 60 (layer 1), heading
 * south from y = -30 to 30, landing on stairs to the ground at y = 40, its north end at a
 * building wall, a roof over it from y = -20 to 20. Plus a covered path at grade along y = -25
 * from x = 40 to 80, under the deck at x = 60. */
function city() {
  const { city, node, street } = buildCity('Covered and handrail', 1);
  street(node(0, 0), node(120, 0));
  city.walk = {
    nodes: {
      'wn:1': walkNode('wn:1', 60, -30, 1),
      'wn:2': walkNode('wn:2', 60, 30, 1),
      'wn:3': walkNode('wn:3', 60, 40, 0),
      'wn:4': walkNode('wn:4', 40, -25, 0),
      'wn:5': walkNode('wn:5', 80, -25, 0),
    },
    links: {
      'wl:1': link(
        'wl:1',
        'wn:1',
        'wn:2',
        [
          { x: 60, y: -30 },
          { x: 60, y: 30 },
        ],
        'footway',
        1,
      ),
      'wl:2': link(
        'wl:2',
        'wn:2',
        'wn:3',
        [
          { x: 60, y: 30 },
          { x: 60, y: 40 },
        ],
        'steps',
        1,
      ),
      'wl:3': link(
        'wl:3',
        'wn:4',
        'wn:5',
        [
          { x: 40, y: -25 },
          { x: 80, y: -25 },
        ],
        'footway',
        0,
      ),
    },
  };
  city.context = {
    features: [
      { kind: 'area', class: 'building', heightM: 12, rings: [ring(50, -45, 70, -30.2)] },
      {
        kind: 'area',
        class: 'building',
        sub: 'roof',
        minHeightM: 3,
        rings: [ring(57, -20, 63, 20)],
      },
    ],
  };
  return city;
}

function build(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const { group, counts } = buildFootbridges(
    result.compiled,
    city,
    cityHeights(result.compiled, city),
  );
  const vertices = (i: number) => {
    const p = (
      group.children[i] as never as { geometry: { getAttribute(n: string): never } }
    ).geometry.getAttribute('position') as {
      count: number;
      getX(i: number): number;
      getY(i: number): number;
      getZ(i: number): number;
    };
    return Array.from({ length: p.count }, (_, k) => ({
      x: p.getX(k),
      z: p.getY(k),
      y: p.getZ(k),
    }));
  };
  return { counts, rails: vertices(1), canopy: vertices(2) };
}

const deckTop = 5.14;
const railTop = deckTop + footbridgeSize.railM;
/** Rail vertices at handrail height along the deck's side `x` over the street. */
const railAt = (rails: { x: number; y: number; z: number }[], x: number) =>
  rails.some((v) => Math.abs(v.x - x) < 0.1 && Math.abs(v.y) < 2 && Math.abs(v.z - railTop) < 0.01);

test('V275 untagged ways draw as before: railings both sides, no canopy of their own', () => {
  const { counts, rails, canopy } = build(city());
  expect(railAt(rails, 59) && railAt(rails, 61)).toBe(true);
  expect(counts).toMatchObject({ handrailLinks: 0, coveredLinks: 0, lightCanopies: 0 });
  expect(canopy).toHaveLength(0);
});

test.each([
  [['left'], [61]],
  [['right'], [59]],
  [
    ['left', 'right'],
    [59, 61],
  ],
  [[], []],
] as [HandrailSide[], number[]][])(
  'V275 a deck with handrail %j has railings on its sides at x = %j (heading south, left is east)',
  (handrail, sides) => {
    const tagged = city();
    tagged.walk!.links['wl:1']!.handrail = handrail;
    const { counts, rails } = build(tagged);
    expect(counts.handrailLinks).toBe(1);
    for (const x of [59, 61]) expect(railAt(rails, x), `x ${x}`).toBe(sides.includes(x));
  },
);

test('V275 a centre handrail runs along the line', () => {
  const tagged = city();
  tagged.walk!.links['wl:1']!.handrail = ['center'];
  const { counts, rails } = build(tagged);
  expect(counts.centerRailM).toBe(60);
  expect(railAt(rails, 60)).toBe(true);
  expect(railAt(rails, 59) || railAt(rails, 61)).toBe(false);
});

test('V275 a stair flight at grade carries its mapped handrail on the side named, none untagged', () => {
  // A 3 m slope north to south; the stairs climb it from y = 100 to 110 at x = 5.
  const sloped = (handrail?: HandrailSide[]) => {
    const c = city();
    c.terrain = {
      source: 'Test elevations',
      originM: { x: 0, y: 100 },
      cellM: 10,
      cols: 2,
      rows: 2,
      baseM: 0,
      heights: Buffer.from([0, 0, 0, 0, 30, 0, 30, 0]).toString('base64'),
    };
    c.walk!.nodes['wn:6'] = walkNode('wn:6', 5, 100, 0);
    c.walk!.nodes['wn:7'] = walkNode('wn:7', 5, 110, 0);
    c.walk!.links['wl:4'] = {
      ...link(
        'wl:4',
        'wn:6',
        'wn:7',
        [
          { x: 5, y: 100 },
          { x: 5, y: 110 },
        ],
        'steps',
        0,
      ),
      ...(handrail ? { handrail } : {}),
    };
    return build(c);
  };
  const onFlight = (rails: { x: number; y: number; z: number }[], x: number) =>
    rails.filter((v) => Math.abs(v.x - x) < 0.1 && v.y > 101 && v.y < 109);
  const untagged = sloped();
  expect(onFlight(untagged.rails, 4).length + onFlight(untagged.rails, 6).length).toBe(0);
  // Heading south, right is west.
  const right = sloped(['right']);
  expect(right.counts.handrailLinks).toBe(1);
  expect(onFlight(right.rails, 6)).toHaveLength(0);
  const west = onFlight(right.rails, 4);
  expect(west.length).toBeGreaterThan(0);
  // The handrail climbs with the flight, 1 m over its pitch line (3.14 m over 10 m).
  for (const y of [102, 105, 108]) {
    const top = Math.max(...west.filter((v) => Math.abs(v.y - y) < 0.6).map((v) => v.z));
    expect(top).toBeCloseTo(0.14 + ((y - 100) / 10) * 3 + footbridgeSize.railM, 0);
  }
});

test('V275 a covered deck gets a light canopy where no roof is mapped over it; under the roof it keeps the roof', () => {
  const covered = city();
  covered.walk!.links['wl:1']!.covered = true;
  const { counts, canopy } = build(covered);
  expect(counts).toMatchObject({ coveredLinks: 1, lightCanopies: 1, canopies: 1 });
  // Posts every 5 m or so, alternating sides on a narrow deck (one post grid per spacing).
  expect(counts.lightCanopyPosts).toBeGreaterThanOrEqual(3);
  // The deck's 60 m less the roof's 40 m, 2 m wide.
  expect(counts.lightCanopyM2).toBeGreaterThan(36);
  expect(counts.lightCanopyM2).toBeLessThan(44);
  const under = deckTop + footbridgeSize.canopyM;
  expect(canopy.some((v) => v.y < -21 && Math.abs(v.z - under) < 0.01)).toBe(true);
  expect(canopy.some((v) => v.y > 21 && Math.abs(v.z - under) < 0.01)).toBe(true);
  expect(canopy.some((v) => Math.abs(v.y) < 19)).toBe(false);
});

test('V275 a covered way at grade gets a canopy except where something stands over it', () => {
  const covered = city();
  covered.walk!.links['wl:3']!.covered = true;
  const { counts, canopy } = build(covered);
  expect(counts).toMatchObject({ coveredLinks: 1, lightCanopies: 1 });
  const under = 0.14 + footbridgeSize.canopyM;
  for (const x of [45, 75])
    expect(canopy.some((v) => Math.abs(v.x - x) < 2 && Math.abs(v.z - under) < 0.01)).toBe(true);
  // None under the footbridge deck at x = 60 (2 m wide, 5.14 m up).
  expect(canopy.some((v) => Math.abs(v.x - 60) < 0.8 && Math.abs(v.y + 25) < 0.9)).toBe(false);
  // Its 40 m, less about 2 m under the deck, 2 m wide.
  expect(counts.lightCanopyM2).toBeGreaterThan(70);
  expect(counts.lightCanopyM2).toBeLessThan(78);
});
