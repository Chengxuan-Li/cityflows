import { beforeAll, expect, test } from 'vitest';
import { compileAuditCity } from '../../bench/junction-audit';
import type { CompiledCity } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { createLaneChanges } from '../../src/sim/lane-change';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';

let compiled: CompiledCity;
beforeAll(() => {
  compiled = compileAuditCity('munich');
});

test('T29: real r1258 discretionary move adds one necessary change through the short corridor', () => {
  const source = compiled.index.lane.get('r:1258#3')!,
    other = compiled.index.lane.get('r:1258#2')!;
  const positionM = 58.951400069319355;
  const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), {
    fromLane: source,
    fromPosM: positionM,
    toConnector: compiled.index.connector.get('c:1845')!,
    vehicleClass: 'car',
    purpose: 'private',
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  });
  if (!result.ok) throw new Error(result.reason);
  expect(result.route.roads.slice(0, 5).map((i) => compiled.roads[i]!.id)).toEqual([
    'r:1258',
    'r:313',
    'r:706',
    'r:1300',
    'r:671',
  ]);
  expect(result.route.targetLanes[0]).toEqual(expect.arrayContaining([source, other]));
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.route[0] = result.route;
  vehicles.destination[0] = compiled.index.connector.get('c:1845')!;
  vehicles.insert(0, source, positionM);
  const normal = createLaneChanges(compiled, vehicles, DEFAULT_SIM_PARAMS);
  expect(normal.futureChanges(0, source, positionM)).toBe(0);
  expect(normal.futureChanges(0, other, positionM)).toBe(1);
  const short = createLaneChanges(compiled, vehicles, {
    ...DEFAULT_SIM_PARAMS,
    missedTurnAfterS: 1,
  });
  expect(short.futureChanges(0, source, positionM)).toBe(0);
  expect(short.futureChanges(0, other, positionM)).toBe(0);
});
