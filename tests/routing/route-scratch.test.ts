// TASK-243: the provider's and the walk router's kept state (graph access codes, compressed
// edge rows, per-request noise stamps, the walk router's link rows and stamps, the heap's typed
// arrays) gives the results of fresh routers, and the plain computations agree with it.
import { expect, test } from 'vitest';
import { createRandom } from '../../src/geo/random';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts, type RouteRequest } from '../../src/routing';
import { routeCosts } from '../../src/routing/costs';
import { MinHeap } from '../../src/routing/heap';
import { createWalkRouter } from '../../src/routing/walk';
import { throughputRequests } from './throughput-fixtures';

function restrictedTown() {
  const city = town();
  const roads = Object.values(city.roads);
  const rules = ['destination', 'private', 'delivery', 'no'] as const;
  roads.forEach((road, i) => {
    if (i % 5 === 1) road.access = { car: rules[i % 4]!, truck: rules[(i + 1) % 4]! };
  });
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

test('a reused provider routes as fresh ones, its access codes and noise as the plain checks', () => {
  const net = restrictedTown();
  const costs = freeFlowLinkCosts(net);
  const requests: RouteRequest[] = throughputRequests(net).flatMap(({ request }) => [
    request,
    { ...request, vehicleClass: 'truck', purpose: 'delivery' },
    { ...request, vehicleClass: 'truck', purpose: 'private', noise: 0.2, seed: 99 },
  ]);
  const reused = createRouteProvider({ checkSkips: true });
  const results = requests.map((request) => reused.route(net, costs, request));
  expect(results.some((r) => r.ok)).toBe(true);
  expect(results.some((r) => !r.ok && r.reason === 'class_forbidden')).toBe(true);
  requests.forEach((request, i) =>
    expect(createRouteProvider().route(net, costs, request)).toEqual(results[i]),
  );
  // In the reverse order, so each request finds another one's noise stamps and searches.
  for (let i = requests.length - 1; i >= 0; i--)
    expect(reused.route(net, costs, requests[i]!)).toEqual(results[i]);
});

test('route noise equals the generator draw for road indices of every length', () => {
  const net = restrictedTown();
  const roadCount = 120_000;
  const costs = { roadTravelTimeS: new Float64Array(roadCount).fill(7), version: 0 };
  for (const seed of [1, 2, 977, 2 ** 31 - 1, 2 ** 32 - 5]) {
    const request = { ...throughputRequests(net)[0]!.request, noise: 0.3, seed };
    const weights = routeCosts(net, costs, request, undefined, true);
    for (let road = 0; road < roadCount; road += road < 2000 ? 1 : 97)
      expect(weights.transition(road, 2)).toBe(
        9 * (1 + 0.3 * createRandom(seed).derive(road).uniform(-1, 1)),
      );
  }
});

test('a reused walk router walks as fresh ones at each speed and steps factor', () => {
  const graph = restrictedTown().walk;
  const nodes = graph.nodes.length;
  const requests = Array.from({ length: 60 }, (_, i) => ({
    from: i % 3 ? { node: (i * 37) % nodes } : { link: i % graph.links.length, positionM: 0 },
    to: { node: (i * 101 + 7) % nodes },
    speedMps: i % 4 === 0 ? 1.1 : 1.4,
    stepsFactor: i % 5 === 0 ? 0.5 : 0.6,
  }));
  const reused = createWalkRouter(graph, true);
  const results = requests.map((request) => reused.route(request));
  expect(results.filter((r) => r.ok).length).toBeGreaterThan(30);
  requests.forEach((request, i) =>
    expect(createWalkRouter(graph).route(request)).toEqual(results[i]),
  );
});

test('the heap grows past its first capacity and pops by cost, then node', () => {
  const heap = new MinHeap();
  const entries = Array.from({ length: 1000 }, (_, i) => ({
    node: (i * 7919) % 1000,
    cost: (i * 31) % 17,
  }));
  for (const { node, cost } of entries) heap.push(node, cost);
  entries.sort((a, b) => a.cost - b.cost || a.node - b.node);
  for (const { node, cost } of entries) {
    expect(heap.pop()).toBe(node);
    expect(heap.cost).toBe(cost);
  }
  expect(heap.pop()).toBeUndefined();
});
