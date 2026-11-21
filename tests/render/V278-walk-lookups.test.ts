import { expect, test, vi } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { buildWalk } from '../../src/render3d/walk';
import * as heights from '../../src/render3d/heights';

vi.mock('../../src/render3d/heights', async (original) => {
  const actual = await original<typeof heights>();
  return { ...actual, roadSurfaceAt: vi.fn(actual.roadSurfaceAt) };
});

// TASK-278: a sidewalk on a ramp is split into triangles of 2 m or less, which share their
// corners; the 3D walk looks each corner's height up once (Sindelfingen: 1.22 million lookups at
// about 0.26 million points).
test('V278 the 3D walk looks up the road height of each sidewalk point once', () => {
  const { city, node, street } = buildCity('Bridge paving', 1);
  const pair = street(node(0, 0), node(200, 0));
  for (const road of pair) road.layer = 1;
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  const lookups = vi.mocked(heights.roadSurfaceAt);
  lookups.mockClear();
  const meshes = buildWalk(r.compiled, city, heights.cityHeights(r.compiled, city));
  const points = lookups.mock.calls.map(([road, , p]) => `${road.id} ${p.x} ${p.y}`);
  expect(points.length).toBeGreaterThan(100);
  expect(new Set(points).size).toBe(points.length);
  // Each of them is the corner of several triangles.
  expect(meshes.sidewalks.getAttribute('position').count).toBeGreaterThan(3 * points.length);
  for (const g of Object.values(meshes)) g.dispose();
});
