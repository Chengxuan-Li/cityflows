import { expect, test } from 'vitest';
import { buildCity } from '../fixtures/build-city';
import { compile } from '../network';
import { railGeometry, pickRail } from './rail-geometry';

test('T62 shared rail shapes keep non-tram paint clear of asphalt, and tracks are pickable', () => {
  const { city, node, road } = buildCity('Rail paint', 1);
  road(node(50, -30), node(50, 30));
  city.rail = {
    nodes: {
      'rn:1': { id: 'rn:1', pos: { x: 0, y: 0 }, layer: 0, kind: 'plain' },
      'rn:2': { id: 'rn:2', pos: { x: 100, y: 0 }, layer: 0, kind: 'plain' },
    },
    tracks: {
      'rt:1': {
        id: 'rt:1',
        from: 'rn:1',
        to: 'rn:2',
        line: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        kind: 'rail',
        layer: 0,
      },
    },
    platforms: {},
  };
  const result = compile(city);
  if (!result.ok) throw Error('compile failed');
  const shapes = railGeometry(result.compiled, city);
  expect(shapes.length).toBeGreaterThan(0);
  expect(shapes.flatMap((s) => s.polygons.flat()).some((p) => Math.abs(p.x - 50) < 1)).toBe(false);
  expect(pickRail(result.compiled, { x: 10, y: 0 }, 1)).toEqual({ kind: 'track', track: 0 });
  expect(pickRail(result.compiled, { x: 50, y: 0 }, 1, 0)).toBeNull();
  result.compiled.rail!.tracks[0]!.kind = 'tram';
  expect(pickRail(result.compiled, { x: 50, y: 0 }, 1, 0)).toEqual({ kind: 'track', track: 0 });
  city.roads = {};
  const railOnly = compile(city);
  if (!railOnly.ok) throw Error('compile');
  expect(railGeometry(railOnly.compiled, city).length).toBeGreaterThan(0);
});
