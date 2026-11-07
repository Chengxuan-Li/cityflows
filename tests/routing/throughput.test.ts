import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { auditRoute } from '../../bench/route-audit';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { tierCities } from '../tier';
import { throughputCities, throughputFixture, throughputRequests } from './throughput-fixtures';

// The roads each request of the fixed sample takes on main 5568eed (a failure reason where it has
// no route), keyed by its connectors and variant. TASK-090: compared within a budget instead of
// exactly. The exact results (movements, target lanes, costs) were captured again for TASK-062,
// TASK-074, TASK-084, TASK-082, TASK-087 and TASK-089, each time because lane lengths, cuts or
// connector positions moved; what matters is that routing is deterministic, every route is
// drivable and the routes mostly stay on their roads.
const recorded = JSON.parse(readFileSync('tests/routing/throughput-routes.json', 'utf8')) as Record<
  string,
  Record<string, string[] | string>
>;

test.each(tierCities(throughputCities))(
  '%s routes its sample deterministically, drivably and at most 10 percent on other roads',
  (name) => {
    const { city, net } = throughputFixture(name);
    const provider = createRouteProvider();
    const costs = freeFlowLinkCosts(net);
    const requests = throughputRequests(net);
    const actual = requests.map(({ request }) => provider.route(net, costs, request));
    // Routed again by a fresh provider, and by this one after a cost-version change, reversed.
    const fresh = createRouteProvider();
    expect(requests.map(({ request }) => fresh.route(net, costs, request))).toEqual(actual);
    costs.version++;
    expect(requests.toReversed().map(({ request }) => provider.route(net, costs, request))).toEqual(
      actual.toReversed(),
    );
    const undrivable = actual.flatMap((result, i) =>
      result.ok
        ? auditRoute(city, net, requests[i]!.request, result.route).map(
            (issue) => `${requests[i]!.key}: ${JSON.stringify(issue)}`,
          )
        : [],
    );
    expect(undrivable).toEqual([]);
    const changed = requests
      .filter(({ key }, i) => {
        const result = actual[i]!;
        const now = result.ok ? result.route.roads.map((r) => net.roads[r]!.id) : result.reason;
        return JSON.stringify(now) !== JSON.stringify(recorded[name]![key]);
      })
      .map(({ key }) => key);
    console.info(name, `${changed.length} of ${requests.length} routes on other roads`, changed);
    expect(changed.length).toBeLessThanOrEqual(Math.floor(0.1 * requests.length));
  },
);
