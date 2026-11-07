import { expect, test } from 'vitest';
import { Polygon } from 'pixi.js';
import { buildCity } from '../../fixtures/build-city';
import { nearestOnPolyline } from '../../geo/polyline';
import { compile } from '../../network';
import { shadowRoadSurface, deckEdges, gradeShadowSurface } from './shadows';

function bridge() {
  const { city, node, road } = buildCity('Shadows', 1);
  const a = node(0, 0),
    b = node(100, 0);
  const deck = road(a, b);
  deck.layer = 1;
  const opposite = road(b, a);
  opposite.layer = 1;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

test('a bridge shadow meets both ground abutments and reaches full height after 20 m', () => {
  const road = bridge().roads[0]!;
  const shadow = shadowRoadSurface(road, 1, 0, [0, 0]);
  const has = (x: number, y: number) =>
    nearestOnPolyline([...shadow, shadow[0]!], { x, y }).away < 1e-6;
  expect(has(2.5, -1.5)).toBe(true);
  expect(has(97.5, -1.5)).toBe(true);
  expect(has(12.5 + 1.5 / Math.SQRT2, -1.5 + 1.5 / Math.SQRT2)).toBe(true);
  expect(has(22.5 + 3 / Math.SQRT2, -1.5 + 3 / Math.SQRT2)).toBe(true);
  expect(has(77.5 + 3 / Math.SQRT2, -1.5 + 3 / Math.SQRT2)).toBe(true);
});

test('a same-grade continuation keeps its height and a missing intermediate grade doubles it', () => {
  const road = bridge().roads[0]!;
  const shadow = shadowRoadSurface(road, 2, 0, [2, 2]);
  expect(shadow[0]!.x).toBeCloseTo(2.5 + 6 / Math.SQRT2);
  expect(shadow[0]!.y).toBeCloseTo(-1.5 + 6 / Math.SQRT2);
  // The penumbra must taper too, rather than leave an offset cap at the abutment.
  expect(shadowRoadSurface(road, 2, 0, [0, 0], 1.5)[0]).toEqual(road.surface[0]);
});

test('parapets omit road end cuts and shared edges of adjacent same-grade surfaces', () => {
  const city = bridge();
  const road = city.roads[0]!;
  // Coincident opposite decks cover both of this road's edges completely.
  expect(deckEdges(city, road, [1, 1])).toEqual([]);
  const edges = deckEdges(city, road, [1, 0]);
  expect(edges).toHaveLength(2);
  for (const edge of edges) {
    expect(edge.every((p) => Math.abs(p.y) === 1.5)).toBe(true);
    // Half a stroke's clearance from each ground junction mouth.
    expect(Math.abs(edge.at(-1)!.x - edge[0]!.x)).toBeCloseTo(94.65);
  }
});

test('a disjoint deck inside a loop of raised roads keeps its parapets', () => {
  const { city, node, road } = buildCity('Enclosed deck', 1);
  const deck = road(node(-10, 0), node(10, 0));
  road(node(-30, -20), node(30, -20));
  road(node(-30, 20), node(30, 20));
  road(node(-20, -30), node(-20, 30));
  road(node(20, -30), node(20, 30));
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled;
  const own = compiled.roads[compiled.index.road.get(deck.id)!]!;
  const edges = deckEdges(
    compiled,
    own,
    compiled.roads.map(() => 1),
  );
  expect(edges).toHaveLength(2);
  expect(edges.every((line) => line.every((p) => Math.abs(p.y) === 1.5))).toBe(true);
});

test('ground streets cast no shadows even when a tunnel exists below them', () => {
  const city = bridge();
  expect(gradeShadowSurface(city, 0, -1, [0, -1], [0, 0])).toEqual([]);
});

test('lower streets shade their own north-west edge without casting outside the surface', () => {
  const city = bridge();
  const rings = gradeShadowSurface(city, -1, undefined, [-1, -1], [0, 0]);
  const contains = (x: number, y: number) => rings.some((ring) => new Polygon(ring).contains(x, y));
  expect(contains(50, -1.4)).toBe(true);
  expect(contains(50, 1.4)).toBe(false);
  expect(contains(50, -1.6)).toBe(false);
  expect(contains(50, 1.6)).toBe(false);
  expect(contains(2.51, -1.4)).toBe(false); // The inset meets the ground portal at zero depth.
});
