import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { pointInPolygon } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile } from '../../src/network';
import { walkGeometry } from '../../src/render/walk-geometry';
import { buildFootbridges, footbridgeSize, liftCanopies } from '../../src/render3d/footbridges';
import { cityHeights } from '../../src/render3d/heights';
import type { City, ContextAreaFeature } from '../../src/schema';

/** An east-west street under a footbridge at x = 60 (layer 1, 5 m), north end landing on stairs
 * down to the ground, south end at a building wall. */
function bridgeCity() {
  const { city, node, street } = buildCity('Footbridge', 1);
  street(node(0, 0), node(120, 0));
  const walkNode = (id: string, x: number, y: number, layer: number) => ({
    id,
    pos: { x, y },
    layer,
    provenance: { source: 'osm' as const },
  });
  const link = (id: string, from: string, to: string, line: Vec2[], kind: 'footway' | 'steps') => ({
    id,
    from,
    to,
    line,
    kind,
    layer: 1,
    widthM: 2,
    provenance: { source: 'osm' as const },
  });
  city.walk = {
    nodes: {
      'wn:1': walkNode('wn:1', 60, -30, 1),
      'wn:2': walkNode('wn:2', 60, 30, 1),
      'wn:3': walkNode('wn:3', 60, 40, 0),
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
      ),
    },
  };
  const ring = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
  const roof: ContextAreaFeature = {
    kind: 'area',
    class: 'building',
    sub: 'roof',
    minHeightM: 3,
    rings: [ring(57, -20, 63, 20)],
  };
  city.context = {
    features: [
      { kind: 'area', class: 'building', heightM: 12, rings: [ring(50, -45, 70, -30.2)] },
      roof,
    ],
  };
  return { city, roof };
}

function build(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const heights = cityHeights(result.compiled, city);
  return {
    compiled: result.compiled,
    heights,
    ...buildFootbridges(result.compiled, city, heights),
  };
}

const vertices = (mesh: {
  geometry: {
    getAttribute(name: string): {
      count: number;
      getX(i: number): number;
      getY(i: number): number;
      getZ(i: number): number;
    };
  };
}) => {
  const p = mesh.geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), z: p.getY(i), y: p.getZ(i) }));
};

test('V262 a footbridge has a deck with depth, railings on its open sides and piers clear of the carriageway', () => {
  const { city } = bridgeCity();
  const { compiled, group, counts, piers } = build(city);
  expect(counts.bridges).toBe(1);
  expect(counts.links).toBe(2);
  const [deck, rails] = group.children as never as Parameters<typeof vertices>[0][];
  const deckTop = 5.14;
  // Fascias and underside reach the deck depth below the paving along the raised span.
  const deckVertices = vertices(deck!);
  expect(
    deckVertices.some(
      (v) => Math.abs(v.y) < 5 && Math.abs(v.z - (deckTop - footbridgeSize.deckM)) < 0.01,
    ),
  ).toBe(true);
  // Railings at handrail height on both sides over the street.
  const railVertices = vertices(rails!);
  for (const side of [59, 61])
    expect(
      railVertices.some(
        (v) =>
          Math.abs(v.x - side) < 0.1 &&
          Math.abs(v.y) < 2 &&
          Math.abs(v.z - deckTop - footbridgeSize.railM) < 0.01,
      ),
      `side ${side}`,
    ).toBe(true);
  // None across the deck where it meets the stairs (north) or the building (south).
  for (const end of [30, -30])
    expect(
      railVertices.some((v) => Math.abs(v.y - end) < 0.2 && Math.abs(v.x - 60) < 0.5),
      `end ${end}`,
    ).toBe(false);
  // The stairs carry their own railings.
  expect(railVertices.some((v) => v.y > 31 && v.y < 39)).toBe(true);
  // Piers: none on the carriageway or on the stair flight (TASK-262b), the 60 m span supported
  // beside the street.
  expect(piers.length).toBeGreaterThanOrEqual(3);
  const road = compiled.roads[0]!;
  const flight = walkGeometry(compiled, city).find((shape) => shape.link.kind === 'steps')!;
  for (const pier of piers) {
    expect(pointInPolygon(pier.p, [...road.surface, road.surface[0]!])).toBe(false);
    for (const tri of flight.polygons)
      expect(pointInPolygon(pier.p, [...tri, tri[0]!]), 'on the flight').toBe(false);
    expect(pier.top).toBeCloseTo(deckTop - footbridgeSize.deckM, 1);
  }
  // At most `pierSpacingM` between neighbouring piers, except where the deck spans the street.
  const ys = piers.map((p) => p.p.y).sort((a, b) => a - b);
  const width = Math.max(...road.surface.map((p) => Math.abs(p.y)));
  for (let i = 1; i < ys.length; i++)
    if (ys[i - 1]! > width || ys[i]! < -width)
      expect(ys[i]! - ys[i - 1]!).toBeLessThanOrEqual(footbridgeSize.pierSpacingM + 0.01);
  expect(ys.some((y) => y < -width) && ys.some((y) => y > width)).toBe(true);
});

test('V262 a roof over a footbridge deck is its canopy, on posts above the deck', () => {
  const { city, roof } = bridgeCity();
  const { compiled, heights, counts } = build(city);
  const features = liftCanopies(compiled, city, heights, city.context!.features);
  const lifted = features.find((f) => f.kind === 'area' && f.rings === roof.rings);
  expect(lifted).toMatchObject({ minHeightM: 5.14 + footbridgeSize.canopyM });
  expect(counts.canopies).toBe(1);
  expect(counts.canopyPosts).toBeGreaterThanOrEqual(4);
  // A platform roof at the ground, crossed by the deck, stays where the importer put it.
  city.context!.features[1] = {
    ...roof,
    rings: [
      [
        { x: 0, y: 10 },
        { x: 120, y: 10 },
        { x: 120, y: 16 },
        { x: 0, y: 16 },
        { x: 0, y: 10 },
      ],
    ],
  };
  const again = build(city);
  expect(liftCanopies(again.compiled, city, again.heights, city.context!.features)).toBe(
    city.context!.features,
  );
});
