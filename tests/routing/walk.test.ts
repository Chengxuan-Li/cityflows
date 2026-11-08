import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { createWalkRouter } from '../../src/routing/walk';

test('opposite-side places must walk via a crossing; requests do not leak scratch state', () => {
  const { city, node, street, place } = buildCity('Walk across street', 1);
  const a = node(0, 0),
    b = node(150, 0);
  street(a, b);
  street(b, node(300, 0));
  street(b, node(150, 150));
  place('Door A', 'residential', { x: 60, y: -10 }, []);
  place('Door B', 'work', { x: 60, y: 10 }, []);
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const graph = result.compiled.walk,
    router = createWalkRouter(graph);
  const ids = Object.keys(city.places);
  const req = { from: { placeId: ids[0]! }, to: { placeId: ids[1]! }, speedMps: 1.4 };
  const route = router.route(req);
  expect(route.ok).toBe(true);
  if (!route.ok) throw new Error(route.reason);
  expect(route.route.links.some((i) => graph.links[i]!.kind === 'crossing')).toBe(true);
  expect(route.route.lengthM).toBeGreaterThan(140);
  expect(router.route({ ...req, speedMps: 2.8 })).toMatchObject({
    ok: true,
    route: { costS: route.route.costS / 2 },
  });
  expect(router.route(req)).toEqual(route);
});

test('walk positions use partial links, and steps cost more than an equal-distance path', () => {
  const { city } = buildCity('Shortest walk', 1);
  city.walk = { nodes: {}, links: {} };
  for (const [i, pos] of [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 20 },
  ].entries()) {
    const id = `wn:${i + 1}`;
    city.walk.nodes[id] = { id, pos, layer: 0, provenance: { source: 'authored' } };
  }
  for (const [i, [a, b, kind]] of (
    [
      [1, 2, 'steps'],
      [1, 3, 'path'],
      [3, 2, 'path'],
    ] as const
  ).entries()) {
    const id = `wl:${i + 4}`,
      from = `wn:${a}`,
      to = `wn:${b}`;
    city.walk.links[id] = {
      id,
      from,
      to,
      kind,
      line: [city.walk.nodes[from]!.pos, city.walk.nodes[to]!.pos],
      widthM: null,
      provenance: { source: 'authored' },
    };
  }
  city.nextId = 10;
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const g = result.compiled.walk,
    router = createWalkRouter(g);
  const route = router.route({
    from: { node: g.sourceNodes.get('wn:1')! },
    to: { node: g.sourceNodes.get('wn:2')! },
    speedMps: 1,
  });
  expect(route.ok && route.route.links.every((i) => g.links[i]!.kind === 'path')).toBe(true);
  const link = g.links.find((l) => l.kind === 'steps')!.idx;
  const partial = router.route({
    from: { link, positionM: 30 },
    to: { link, positionM: 70 },
    speedMps: 1,
  });
  expect(partial).toMatchObject({
    ok: true,
    route: { lengthM: 40, costS: 40 / 0.6, links: [link] },
  });
});

test('nearby mapped endpoints do not invent a crossing over a one-way street', () => {
  const { city, node, road } = buildCity('No inferred jaywalking', 1);
  road(node(0, 0), node(120, 0));
  city.walk = { nodes: {}, links: {} };
  for (const [i, y] of [-2, -10, 2, 10].entries()) {
    const id = `wn:${i + 10}`;
    city.walk.nodes[id] = { id, pos: { x: 60, y }, layer: 0, provenance: { source: 'authored' } };
  }
  for (const [i, [a, b]] of [
    [10, 11],
    [12, 13],
  ].entries()) {
    const id = `wl:${i + 20}`,
      from = `wn:${a}`,
      to = `wn:${b}`;
    city.walk.links[id] = {
      id,
      from,
      to,
      line: [city.walk.nodes[from]!.pos, city.walk.nodes[to]!.pos],
      kind: 'footway',
      widthM: null,
      provenance: { source: 'authored' },
    };
  }
  city.nextId = 30;
  const c = compile(city);
  if (!c.ok) throw new Error('compile');
  const g = c.compiled.walk;
  const route = createWalkRouter(g).route({
    from: { node: g.sourceNodes.get('wn:10')! },
    to: { node: g.sourceNodes.get('wn:12')! },
  });
  expect(!route.ok || route.route.lengthM > 100).toBe(true);
});
