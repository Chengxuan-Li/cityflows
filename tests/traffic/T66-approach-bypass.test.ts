import { beforeAll, expect, test } from 'vitest';
import { compileAuditCity } from '../../bench/junction-audit';
import type { CompiledCity } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';

let compiled: CompiledCity;
beforeAll(() => {
  compiled = compileAuditCity('munich');
});

test.each([
  ['r:267#0', 'c:1845', 'r:671', false],
  ['r:1276#0', 'c:1444', 'r:968', true],
] as const)(
  'T66: traced Munich fallback %s to %s has approach bypass: %s',
  (from, to, approach, exists) => {
    const provider = createRouteProvider(),
      costs = freeFlowLinkCosts(compiled);
    const request = {
      fromLane: compiled.index.lane.get(from)!,
      fromPosM: 0,
      toConnector: compiled.index.connector.get(to)!,
      vehicleClass: 'car' as const,
      purpose: 'private' as const,
      desiredSpeedFactor: 1,
      noise: 0,
      seed: 1,
    };
    const normal = provider.route(compiled, costs, request);
    expect(normal.ok).toBe(true);
    const avoidApproachRoad = compiled.index.road.get(approach)!;
    const bypass = provider.route(compiled, costs, { ...request, avoidApproachRoad });
    expect(bypass.ok).toBe(exists);
    if (bypass.ok) expect(bypass.route.roads).not.toContain(avoidApproachRoad);
    else if (normal.ok) expect(normal.route.roads).toContain(avoidApproachRoad);
    expect(provider.route(compiled, costs, request)).toEqual(normal);
  },
);
