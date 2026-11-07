import { expect, it } from 'vitest';
import { buildCity } from '../fixtures/build-city';
import { compile } from '../network';
import { cityHeights, heightAt, heightSlopeAt } from './heights';

it('uses the full approach instead of levelling off halfway along it', () => {
  const road = { lengthM: 140, deckM: 10, fromM: 0, toM: 10 };
  expect(heightAt(road, 0)).toBe(0);
  expect(heightAt(road, 70)).toBe(5);
  expect(heightAt(road, 105)).toBeCloseTo(8.4375);
  expect(heightAt(road, 140)).toBe(10);
  expect(heightSlopeAt(road, 0)).toBe(0);
  expect(heightSlopeAt(road, 140)).toBe(0);
});

it('keeps flat grades exact and preserves a bridge or tunnel extremum', () => {
  for (const deckM of [-5, 0, 5, 10]) {
    const flat = { lengthM: 50, deckM, fromM: deckM, toM: deckM };
    for (let s = 0; s <= 50; s += 0.5) expect(heightAt(flat, s)).toBe(deckM);
  }
  for (const deckM of [-5, 5]) {
    const bridge = { lengthM: 240, deckM, fromM: 0, toM: 0 };
    expect(heightAt(bridge, 0)).toBe(0);
    expect(heightAt(bridge, 60)).toBe(deckM);
    expect(heightAt(bridge, 120)).toBe(deckM);
    expect(heightAt(bridge, 180)).toBe(deckM);
    expect(heightAt(bridge, 240)).toBe(0);
    expect(heightSlopeAt(bridge, 120)).toBe(0);
    for (let s = 0; s <= 240; s += 0.5) {
      expect(heightAt(bridge, s)).toBeGreaterThanOrEqual(Math.min(0, deckM));
      expect(heightAt(bridge, s)).toBeLessThanOrEqual(Math.max(0, deckM));
    }
  }
});

it('matches the inferred slope through a tunnel-to-bridge connection without overshoot', () => {
  const b = buildCity('Connected grade profile', 98);
  const a = b.node(-120, 0, -1),
    ground = b.node(0, 0, 0),
    deck = b.node(140, 0, 2),
    end = b.node(300, 0, 2);
  b.road(a, ground).layer = -1;
  b.road(ground, deck).layer = 2;
  b.road(deck, end).layer = 2;
  const result = compile(b.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const heights = cityHeights(result.compiled, b.city);
  const before = heights.roads[0]!,
    after = heights.roads[1]!;
  expect(heightSlopeAt(before, before.lengthM)).toBeGreaterThan(0);
  expect(heightSlopeAt(before, before.lengthM)).toBeCloseTo(heightSlopeAt(after, 0), 12);
  expect(heightSlopeAt(after, after.lengthM)).toBe(0);
  expect(heightAt(after, after.lengthM / 2)).toBeLessThan(8);
  for (const road of [before, after])
    for (let s = 0; s <= road.lengthM; s += 0.5) {
      expect(heightAt(road, s)).toBeGreaterThanOrEqual(Math.min(road.fromM, road.toM));
      expect(heightAt(road, s)).toBeLessThanOrEqual(Math.max(road.fromM, road.toM));
      if (s + 0.5 <= road.lengthM)
        expect(heightAt(road, s + 0.5)).toBeGreaterThanOrEqual(heightAt(road, s));
    }
  // Road boundaries have matching position and one-sided tangent.
  const epsilon = 1e-6;
  expect(heightAt(before, before.lengthM)).toBe(heightAt(after, 0));
  expect(
    Math.abs(heightAt(before, before.lengthM - epsilon) - heightAt(after, epsilon)),
  ).toBeLessThan(1e-5);
});

it('keeps a real junction level instead of carrying a through slope across it', () => {
  const b = buildCity('Level junction', 98);
  const a = b.node(-120, 0, -1),
    junction = b.node(0, 0, 0),
    deck = b.node(140, 0, 2),
    side = b.node(0, 120, 0);
  b.road(a, junction).layer = -1;
  b.road(junction, deck).layer = 2;
  b.road(junction, side);
  const result = compile(b.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const heights = cityHeights(result.compiled, b.city);
  expect(heightSlopeAt(heights.roads[0]!, heights.roads[0]!.lengthM)).toBe(0);
  expect(heightSlopeAt(heights.roads[1]!, 0)).toBe(0);
  expect(heights.nodes[result.compiled.index.node.get(junction.id)!]).toBe(0);
});

it('keeps an outline-free junction with an allowed U-turn level', () => {
  const b = buildCity('Inclined U-turn', 98);
  const a = b.node(-120, 0, -1),
    middle = b.node(0, 0, 0),
    deck = b.node(140, 0, 2);
  const [incoming, reverse] = b.street(a, middle);
  for (const road of [incoming, reverse]) road.layer = -1;
  for (const road of b.street(middle, deck)) road.layer = 2;
  middle.turnRules.push({
    from: incoming.id,
    to: reverse.id,
    allowed: true,
    provenance: { source: 'generated' },
  });
  const result = compile(b.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const city = result.compiled,
    heights = cityHeights(city, b.city),
    node = city.nodes[city.index.node.get(middle.id)!]!;
  expect(node.outline).toHaveLength(0);
  expect(city.movements.some((m) => m.node === node.idx && m.turn === 'uturn')).toBe(true);
  for (const road of city.roads) {
    const height = heights.roads[road.idx]!;
    if (road.to === node.idx) expect(heightSlopeAt(height, height.lengthM)).toBe(0);
    if (road.from === node.idx) expect(heightSlopeAt(height, 0)).toBe(0);
  }
});
