import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { createRailCrossings } from '../../src/sim/rail-crossings';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

/**
 * TASK-202: one crossing with stop markings on two approaches. The car passes the marking on
 * `before` (for the turn straight into the crossing) but turns onto the bypass, loops back and
 * meets the same crossing from `before` again, about 280 m on. A second car stands just past the
 * tracks, so the crossing has no storage beyond it. (Freiburg's Eisenbahnstraße: a car held at
 * a marking on r:1719 for conditions at the same facility 185 m further on.)
 */
function bypass(through = false) {
  const { city, node, road } = buildCity('A bypass returns to the same crossing', 202);
  const west = node(-100, 0),
    junction = node(-20, 0),
    south = node(-80, 50);
  const before = road(west, junction),
    crossing = road(junction, node(400, 0));
  const loop = road(junction, south),
    back = road(south, west);
  crossing.provenance = { source: 'generated', osmIds: [10] };
  city.rail = operatingCrossing().rail;
  const compiled = setup(city),
    facility = compiled.rail!.facilities![0]!;
  const lane = (r: { id: string }) => compiled.index.lane.get(`${r.id}#0`)!;
  const lanes = (through ? [before, crossing] : [before, loop, back, before, crossing]).map(lane);
  const movements = lanes
    .slice(0, -1)
    .map(
      (from, i) =>
        compiled.movements.find((m) => m.fromLane === from && m.toLane === lanes[i + 1])!.idx,
    );
  // The marking of the approach the car passes: a stop line on `before` for the crossing.
  const mark = compiled.lanes[lanes[0]!]!.lengthM - 3;
  facility.stops!.push({ lane: lanes[0]!, stopM: mark });
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.insert(0, lanes[0]!, mark - 1);
  vehicles.movement[0] = movements[0]!;
  vehicles.route[0] = {
    roads: lanes.map((l) => compiled.lanes[l]!.road),
    movements,
    targetLanes: lanes.map((l) => [l]),
    costS: 0,
  };
  const span = facility.spans!.find((s) => s.segment === lanes.at(-1))!;
  vehicles.insert(1, span.segment, span.toM + 1);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 140, () => false)!;
  return { vehicles, control, mark };
}

test('TASK-202 a marking for a turn the car does not take does not hold it for a later return', () => {
  const { control, mark } = bypass();
  // Held, if at all, at the marking it meets on its return, not at the one it passes now.
  expect(control.hold(0)).toBeGreaterThan(mark + 100);
});

test('TASK-202 passing a marking for a turn the car does not take does not commit it', () => {
  const { control, vehicles, mark } = bypass();
  vehicles.speed[0] = 5;
  control.step(140);
  vehicles.position[0] = mark + 0.1;
  control.step(140.1);
  expect(control.roadState({ lanes: [], movements: [] }).admissions[0]!.ids).not.toContain(0);
});

test('TASK-202 the same marking still holds a car turning straight into the crossing', () => {
  const { control, mark } = bypass(true);
  expect(control.hold(0)).toBe(mark);
});
