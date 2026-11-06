import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createRouteProvider, freeFlowLinkCosts, type RouteResult } from '../../src/routing';
import { throughputCities, throughputFixture, throughputRequests } from './throughput-fixtures';

// Captured before TASK-062 from main at 1a14d7a, and again for TASK-074, whose setbacks move lane
// lengths: the same roads everywhere, one Sindelfingen route on other lanes, 7 Sindelfingen and
// 12 Munich costs moved. Captured again for TASK-084 (separated coincident pairs, relaxed
// roads): the same roads everywhere, one Munich route through other movements, 30 Sindelfingen
// and 14 Munich costs moved. Again for TASK-082 (lanes offset from corridor reference lines):
// the same roads, movements and lanes everywhere, 8 Sindelfingen and 6 Munich costs moved by
// at most 0.01 percent. Again for TASK-087 (dual carriageways pushed apart, r:729/r:984 side by
// side): Munich has 259 connectors (260 before), so its fixed sample of connector pairs shifts
// and 90 of its 96 requests are others; Sindelfingen's requests are the same and route on the
// same roads, 87 through renumbered movements (n:580 loses one).
// Includes the complete result, not just road IDs: equal-cost ties, movements, target lanes and
// exact costs matter.
const expected = JSON.parse(readFileSync('tests/routing/throughput-routes.json', 'utf8')) as Record<
  string,
  RouteResult[]
>;

test.each(throughputCities)('%s preserves the baseline routes exactly', (name) => {
  const net = throughputFixture(name);
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(net);
  const requests = throughputRequests(net);
  const actual = requests.map((request) => provider.route(net, costs, request));
  expect(actual).toEqual(expected[name]);
  // Reuse the provider after other requests and a cost-version change.
  costs.version++;
  expect(requests.toReversed().map((request) => provider.route(net, costs, request))).toEqual(
    expected[name]!.toReversed(),
  );
});
