import { expect, test } from 'vitest';
import { bypass } from '../../src/fixtures/bypass';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { routingFixture } from './fixtures';

test.each([
  [100, true],
  [74, false],
])('T05 at %d km/h chooses expressway = %s', (speed, expected) => {
  const city = bypass();
  Object.values(city.roads).find((road) => road.roadClass === 'motorway')!.speedLimitMps =
    speed / 3.6;
  const { compiled, request } = routingFixture(city);
  const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request);
  if (!result.ok) throw new Error(result.reason);
  expect(result.route.roads.some((idx) => compiled.roads[idx]!.roadClass === 'motorway')).toBe(
    expected,
  );
});

test('T05 per-driver noise produces both route choices across 200 seeds', () => {
  const { compiled, request } = routingFixture(bypass());
  const costs = freeFlowLinkCosts(compiled);
  const provider = createRouteProvider();
  const choices = new Set<boolean>();
  for (let seed = 0; seed < 200; seed++) {
    const result = provider.route(compiled, costs, { ...request, seed, noise: 0.3 });
    if (!result.ok) throw new Error(result.reason);
    choices.add(result.route.roads.some((idx) => compiled.roads[idx]!.roadClass === 'motorway'));
  }
  expect(choices).toEqual(new Set([false, true]));
});
