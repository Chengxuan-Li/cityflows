import { expect, test } from 'vitest';
import { bypass } from '../../src/fixtures/bypass';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { routingFixture } from './fixtures';

test('interleaved route requests leave the result for a fixed seed unchanged', () => {
  const { compiled, request } = routingFixture(grid5x5());
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  const noisy = { ...request, noise: 0.3 };
  const first = provider.route(compiled, costs, noisy);
  expect(first.ok).toBe(true);
  provider.route(compiled, costs, { ...noisy, seed: noisy.seed + 1 });
  expect(provider.route(compiled, costs, noisy)).toEqual(first);
});

test('a version bump rebuilds adjacency after movement availability changes', () => {
  const { compiled, request } = routingFixture(bypass());
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  const first = provider.route(compiled, costs, request);
  if (!first.ok) throw new Error(first.reason);
  compiled.movements[first.route.movements[0]!]!.neverGreen = true;
  compiled.version++;
  const after = provider.route(compiled, costs, request);
  if (!after.ok) throw new Error(after.reason);
  expect(after.route.roads).not.toEqual(first.route.roads);
});

test('cached lane expansions follow network versions and interleaved vehicle classes', () => {
  const { compiled, request } = routingFixture(grid5x5());
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  const first = provider.route(compiled, costs, request);
  if (!first.ok) throw new Error(first.reason);
  const movement = compiled.movements[first.route.movements[1]!]!;
  compiled.lanes[movement.toLane]!.allowed = ['car'];
  compiled.version++;
  for (const vehicleClass of ['truck', 'car', 'truck'] as const) {
    const req = { ...request, vehicleClass };
    expect(provider.route(compiled, costs, req)).toEqual(
      createRouteProvider().route(compiled, costs, req),
    );
  }
  movement.neverGreen = true;
  compiled.version++;
  const after = provider.route(compiled, costs, request);
  expect(after).not.toEqual(first);
  expect(after).toEqual(createRouteProvider().route(compiled, costs, request));
});
