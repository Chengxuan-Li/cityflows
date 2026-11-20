import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup } from './fixtures';

/**
 * TASK-247: one approach lane carries two movements that two phases of an actuated signal serve,
 * as Bismarckallee's r:1479 lane 1 at Freiburg's n:1132 (straight on in phase 2, right into r:1134
 * in phase 1). Cars bound straight on and right alternate in the queue. The head waits for its
 * phase; the car behind it is in range and planning the green movement, so it kept that green to
 * its maximum though it could not reach the stop line, and the phases swapped at their maximums
 * with one or two cars served each: Freiburg's 08:00 queue ran back 200 m to the station.
 */
function sharedLane() {
  const { city, node, road, place, signal } = buildCity('A shared lane into two phases', 247);
  const center = node(0, 0);
  const approach = road(node(0, 200), center);
  const north = road(center, node(0, -200));
  const east = road(center, node(200, 0));
  signal(center, [
    [approach, north],
    [approach, east],
  ]);
  center.signal!.phases = [
    { durationS: 30, groups: [{ from: approach.id, to: north.id }] },
    { durationS: 30, groups: [{ from: approach.id, to: east.id }] },
  ];
  center.signal!.actuated = true;
  place('South', 'gateway', { x: 10, y: 200 }, [{ road: approach, direction: 'out' }]);
  place('North', 'gateway', { x: 10, y: -200 }, [{ road: north, direction: 'in', positionM: 190 }]);
  place('East', 'gateway', { x: 200, y: 10 }, [{ road: east, direction: 'in', positionM: 190 }]);
  const [south, northGate, eastGate] = Object.values(city.places);
  const trips: TripRequest[] = Array.from({ length: 40 }, (_, i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: south!.id,
    destinationPlaceId: (i % 2 ? eastGate : northGate)!.id,
    departS: 100 + i * 3,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  const compiled = setup(city);
  return { compiled, trips, center: compiled.index.node.get(center.id)! };
}

test('TASK-247 a car behind a head waiting for another phase does not extend the green', () => {
  const { compiled, trips, center } = sharedLane();
  const engine = createEngine();
  engine.load({ compiled, trips, scenario: { ...scenario(), endS: 1000 } });
  // The longest green while cars queue for both phases.
  let longest = 0;
  let greenS = 0;
  while (engine.timeS < 1000) {
    engine.step(10);
    greenS = engine.snapshot().signals!.state[center] === 0 ? greenS + 1 : 0;
    if (engine.metrics().trips.driving > 1) longest = Math.max(longest, greenS);
  }
  // Before TASK-247 the greens ran to their 30 s maximum and 26 of the 40 cars had arrived by
  // 1,000 s.
  expect(engine.metrics().trips).toMatchObject({ completed: 40, failed: 0, driving: 0 });
  expect(longest).toBeLessThan(30);
});
