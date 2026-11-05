import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createEngine } from '../../src/sim/engine';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { scenario, setup, trips } from './fixtures';

function crossing(control: 'stop' | 'yield') {
  const { city, node, road, place } = buildCity('Priority', 1);
  const junction = node(0, 0);
  const minor = road(node(0, -150), junction);
  const major = road(node(-150, 0), junction, { roadClass: 'primary' });
  const south = road(junction, node(0, 150));
  road(junction, node(150, 0));
  junction.control = control;
  junction.minorRoads = [minor.id];
  place('Origin', 'residential', { x: 0, y: -120 }, [
    { road: minor, direction: 'out', positionM: 10 },
  ]);
  place('Destination', 'work', { x: 0, y: 120 }, [
    { road: south, direction: 'in', positionM: 100 },
  ]);
  const compiled = setup(city);
  const movement = compiled.movements.find(
    (m) =>
      compiled.roads[compiled.lanes[m.fromLane]!.road]!.id === minor.id && m.turn === 'through',
  )!;
  const conflicting = compiled.movements.find(
    (m) =>
      compiled.roads[compiled.lanes[m.fromLane]!.road]!.id === major.id && m.turn === 'through',
  )!;
  return { city, compiled, movement, conflicting };
}

test.each(['stop', 'yield'] as const)('T05 %s with an empty major approach', (control) => {
  const { city, compiled, movement } = crossing(control);
  const engine = createEngine();
  engine.load({ compiled, scenario: scenario(), trips: trips(city, 1) });
  let stationary = 0;
  let reached = false;
  for (let i = 0; i < 600; i++) {
    const before = engine.inspect(1);
    engine.step();
    const car = engine.inspect(1)!;
    if (car.lane === movement.fromLane && car.speedMps === 0 && before?.speedMps === 0)
      stationary += 0.1;
    if (car.lane < 0) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  if (control === 'stop') expect(stationary).toBeGreaterThanOrEqual(1 - 1e-9);
  else expect(stationary).toBe(0);
});

test.each([3.9, 4, 4.1])('T05 yield accepts a major gap of %s seconds iff at least gapS', (gap) => {
  const { compiled, movement, conflicting } = crossing('yield');
  const zoneStart = conflicting.conflictZones[conflicting.conflicts.indexOf(movement.idx)]![0];
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  for (const [id, path] of [movement, conflicting].entries()) {
    vehicles.state[id] = DRIVING;
    vehicles.movement[id] = path.idx;
    vehicles.speed[id] = 10;
    vehicles.insert(
      id,
      path.fromLane,
      compiled.lanes[path.fromLane]!.lengthM - (id ? gap * 10 - zoneStart : 12),
    );
  }
  const junctions = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS);
  junctions.request(0, movement);
  junctions.resolve();
  expect(junctions.grants[0]).toBe(gap >= 4 ? movement.idx : -1);
});
