import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { scenario, setup, trips } from './fixtures';

test('T08 limited admission creates spillback and both connectors meter traffic', () => {
  const { city, node, road, place } = buildCity('Capacity-limited workplace', 1);
  const link = road(node(0, 0), node(200, 0));
  place('Homes', 'residential', { x: 10, y: 10 }, [{ road: link, direction: 'out' }]);
  place('Offices', 'work', { x: 110, y: 10 }, [{ road: link, direction: 'in', positionM: 100 }]);
  const compiled = setup(city);
  const destination = compiled.places[1]!;
  destination.capacity = 0;

  const engine = createEngine();
  engine.load({ compiled, scenario: scenario(), trips: trips(city, 3) });
  engine.step(700);
  const head = engine.inspect(1)!;
  const follower = engine.inspect(2)!;
  expect(head.state).toBe('queued_destination');
  expect(head.positionM).toBe(100);
  expect(head.waitingS).toBeGreaterThan(1);
  expect(follower.state).toBe('driving');
  expect(follower.speedMps).toBeLessThan(0.05);
  expect(head.positionM - follower.positionM).toBeCloseTo(
    DEFAULT_SIM_PARAMS.vehicleLengthM + DEFAULT_SIM_PARAMS.idm.minGapM,
    1,
  );
  for (let id = 2; id <= 3; id++) {
    expect(
      engine.inspect(id)!.departedS! - engine.inspect(id - 1)!.departedS!,
    ).toBeGreaterThanOrEqual(2);
  }
  destination.capacity = 1;
  engine.step(300);
  expect(engine.metrics().trips.completed).toBe(1);
  expect(engine.inspect(2)?.state).toBe('queued_destination');
  destination.capacity = 3;
  engine.step(300);
  expect(engine.metrics().trips.completed).toBe(3);
  expect(engine.inspect(3)!.arrivedS! - engine.inspect(2)!.arrivedS!).toBeGreaterThanOrEqual(2);
});
