import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { railTimetable } from '../../src/network/trams';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

function exitQueue(served = true) {
  const { city, node, road } = buildCity('Two approaches sharing a short exit', 147);
  const junction = node(0, 0),
    downstream = node(20, 0);
  const crossing = road(node(-120, 0), junction),
    side = road(node(0, -120), junction);
  const exit = road(junction, downstream);
  road(downstream, node(140, 0));
  road(node(20, -120), downstream);
  crossing.provenance = { source: 'generated', osmIds: [10] };
  city.rail = operatingCrossing('tram').rail;
  for (const railNode of Object.values(city.rail!.nodes)) railNode.pos.x = -6;
  for (const track of Object.values(city.rail!.tracks)) for (const p of track.line) p.x = -6;
  const compiled = setup(city);
  if (!served) railTimetable(compiled.rail!).departures = [];
  const lane = (id: string) => compiled.index.lane.get(id + '#0')!;
  const movement = (from: string) =>
    compiled.movements.find((m) => m.fromLane === lane(from) && m.toLane === lane(exit.id))!;
  const railExit = movement(crossing.id),
    other = movement(side.id);
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  const span = compiled.rail!.facilities![0]!.spans!.find((s) => s.segment === railExit.fromLane)!;
  vehicles.insert(
    0,
    railExit.fromLane,
    Math.min(compiled.lanes[railExit.fromLane]!.lengthM, span.toM + 1),
  );
  vehicles.movement[0] = railExit.idx;
  vehicles.insert(1, other.fromLane, compiled.lanes[other.fromLane]!.lengthM - 2);
  vehicles.movement[1] = other.idx;
  const order: number[] = [];
  const intersections = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS, undefined, {
    onDecision(id, _move, reason) {
      if (reason === 'granted') order.push(id);
    },
  });
  intersections.signals(0);
  return { vehicles, intersections, railExit, other, order };
}

test.each([true, false])(
  'T75 competing turns keep an occupied served rail exit clear (served %s)',
  (served) => {
    const { vehicles, intersections, railExit, other } = exitQueue(served);
    vehicles.insert(2, other.toLane, 5);
    vehicles.speed[2] = 8;
    expect(other.conflicts).toContain(railExit.idx);
    expect(intersections.blockedExit(1, other)).toBeNull();
    intersections.request(1, other);
    intersections.resolve();
    expect(intersections.grants[1]).toBe(served ? -1 : other.idx);
    if (served) {
      vehicles.remove(2);
      intersections.request(1, other);
      intersections.resolve();
      expect(intersections.grants[1]).toBe(other.idx);
    }
  },
);

test('T75 a vehicle clearing the track gets the first legal grant into shared storage', () => {
  const { intersections, railExit, other, order } = exitQueue();
  railExit.priority = 1;
  other.priority = 32;
  intersections.request(1, other);
  intersections.request(0, railExit);
  intersections.resolve();
  expect(order[0]).toBe(0);
  expect(intersections.grants[0]).toBe(railExit.idx);
});
