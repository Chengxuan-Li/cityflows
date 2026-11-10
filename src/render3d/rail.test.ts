import { expect, test } from 'vitest';
import type { Mesh } from 'three';
import { buildCity } from '../fixtures/build-city';
import { compile } from '../network';
import { cityHeights } from './heights';
import { buildRail, pickRail3D } from './rail';

function bridge() {
  const { city, node, road } = buildCity('Bridge rail', 1);
  road(node(-100, 30), node(100, 30));
  city.rail = {
    nodes: {
      'rn:1': { id: 'rn:1', pos: { x: -100, y: 0 }, kind: 'plain', layer: 0 },
      'rn:2': { id: 'rn:2', pos: { x: 100, y: 0 }, kind: 'plain', layer: 0 },
    },
    tracks: {
      'rt:1': {
        id: 'rt:1',
        from: 'rn:1',
        to: 'rn:2',
        line: [
          { x: -100, y: 0 },
          { x: 100, y: 0 },
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
  expect(
    pickRail3D(compiled, { x: -100, y: 0 }, (p, heightM) => ({ x: p.x, y: heightM * 100 })),
  ).toEqual({ kind: 'track', track: 0 });
});
