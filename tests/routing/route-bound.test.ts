// TASK-251: a request with a bound returns the unbounded result, or `above_bound` when no route
// it can return costs less than the bound (the road search's cost is a lower bound).
import { expect, test } from 'vitest';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts, type RouteRequest } from '../../src/routing';
import { throughputRequests } from './throughput-fixtures';

test('a bounded request routes as an unbounded one or stops only where no route beats the bound', () => {
  const result = compile(town());
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  // Uneven costs, so routes take dearer movements and lane changes (the lane search) too.
  const costs = freeFlowLinkCosts(net);
  costs.roadTravelTimeS.forEach((cost, road) => {
    costs.roadTravelTimeS[road] = cost * (1 + ((road * 7919) % 13) / 4);
  });
  const requests: RouteRequest[] = throughputRequests(net).flatMap(({ request }) => [
    request,
    { ...request, noise: 0.15, seed: 7 },
    { ...request, vehicleClass: 'truck', purpose: 'delivery' },
  ]);
  const provider = createRouteProvider({ checkSkips: true });
  const outcomes = { same: 0, above: 0, laneSearched: 0 };
  for (const request of requests) {
    const full = provider.route(net, costs, request);
    if (!full.ok) continue;
    const costS = full.route.costS;
    for (const boundS of [costS * 0.8, costS, costS * (1 + 1e-12), costS * 1.2]) {
      const bounded = provider.route(net, costs, request, boundS);
      if (!bounded.ok && bounded.reason === 'above_bound') {
        expect(costS).toBeGreaterThanOrEqual(boundS);
        outcomes.above++;
      } else {
        expect(bounded).toEqual(full);
        outcomes.same++;
        // At its own cost, a route dearer than its road search (lane changes, dearer movements).
        if (boundS === costS) outcomes.laneSearched++;
      }
    }
  }
  expect(outcomes.above).toBeGreaterThan(requests.length / 2);
  expect(outcomes.same).toBeGreaterThan(requests.length);
  expect(outcomes.laneSearched).toBeGreaterThan(0);
});
