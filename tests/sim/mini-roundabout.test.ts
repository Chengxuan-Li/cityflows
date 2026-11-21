import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { MINI_ROUNDABOUT } from '../../src/network/junctions';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

// TASK-269 (D4): of two cars arriving together at a mini-roundabout, the one on the side the
// circulating traffic comes from goes first: the left in right-hand traffic (anticlockwise), the
// right in left-hand traffic (clockwise). An equal junction's rule is the other side's.
function arrivals(
  drivingSide: 'left' | 'right',
  mini: boolean,
  eastClass: 'primary' | 'residential',
) {
  const { city, node, road } = buildCity('Mini', 1);
  city.drivingSide = drivingSide;
  const junction = node(0, 0);
  // y is south: `south` enters heading north, `east` heading west, from the south car's right.
  const south = road(node(0, 150), junction);
  const east = road(node(150, 0), junction, { roadClass: eastClass });
  road(junction, node(0, -150));
  road(junction, node(-150, 0));
  if (mini) {
    junction.control = 'yield';
    junction.minorRoads = [south.id, east.id];
    junction.provenance = { source: 'generated', inferred: [MINI_ROUNDABOUT] };
  }
  const compiled = setup(city);
  const through = (id: string) =>
    compiled.movements.find(
      (m) => compiled.roads[compiled.lanes[m.fromLane]!.road]!.id === id && m.turn === 'through',
    )!;
  const paths = [through(south.id), through(east.id)];
  expect(paths[0]!.conflicts).toContain(paths[1]!.idx);
  if (mini) expect(paths[0]!.priority).toBe(paths[1]!.priority);
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  for (const [id, path] of paths.entries()) {
    vehicles.state[id] = DRIVING;
    vehicles.movement[id] = path.idx;
    vehicles.speed[id] = 8;
    vehicles.insert(id, path.fromLane, compiled.lanes[path.fromLane]!.lengthM - 10);
  }
  const junctions = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS);
  for (const [id, path] of paths.entries()) junctions.request(id, path);
  junctions.resolve();
  expect(compiled.nodes[paths[0]!.node]!.miniRoundabout).toBe(mini || undefined);
  return [...junctions.grants].map((grant) => grant !== -1);
}

// Granted: [the car from the south, the car from the east, on its right].
test.each([
  ['right', true, 'primary', [true, false]],
  ['left', true, 'primary', [false, true]],
  ['left', true, 'residential', [false, true]],
  ['right', false, 'primary', [false, true]],
  ['right', false, 'residential', [false, true]],
  ['left', false, 'residential', [true, false]],
] as const)(
  '%s-hand traffic, mini-roundabout %s, east road %s: granted %j',
  (side, mini, east, granted) => {
    expect(arrivals(side, mini, east)).toEqual(granted);
  },
);
