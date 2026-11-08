import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test('a driver can pass a queue using an earlier legal lane change on the same road chain', () => {
  const { city, node, road, place } = buildCity('Earlier lane change', 1);
  const a = node(0, 0);
  const b = node(100, 0);
  const c = node(200, 0);
  const d = node(300, 0);
  const approach = road(a, b, { lanes: 3 });
  approach.lanes[2]!.allowed = ['bus'];
  const queued = road(b, c, { lanes: 2 });
  road(c, d, { lanes: 2 });
  const exit = road(d, node(300, 100));
  road(d, node(300, -100));
  place('Origin', 'residential', a.pos, [
    { road: approach, lane: 0, positionM: 80, direction: 'out' },
  ]);
  place('Destination', 'work', exit.centerline.at(-1)!, [
    { road: exit, positionM: 80, direction: 'in' },
  ]);
  place('Blocker origin', 'residential', b.pos, [
    { road: queued, lane: 0, positionM: 40, direction: 'out' },
  ]);
  place('Closed destination', 'work', c.pos, [
    { road: queued, lane: 0, positionM: 50, direction: 'in' },
  ]);
  const [, , blockerOrigin, closed] = Object.values(city.places);
  closed!.capacity = 0;
  const [trip] = trips(city, 1);
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: scenario(),
    trips: [
      { ...trip!, departS: 110, vehicleClass: 'van' },
      {
        ...trip!,
        id: 'blocker',
        originPlaceId: blockerOrigin!.id,
        destinationPlaceId: closed!.id,
      },
    ],
  });
  let passed = false;
  for (let step = 0; step < 800; step++) {
    engine.step();
    const driver = engine.inspect(1)!;
    if (driver?.lane === compiled.index.lane.get(`${queued.id}#1`)) passed = true;
  }
  expect(engine.inspect(2)!.state).toBe('queued_destination');
  expect(passed).toBe(true);
  expect(engine.inspect(1)!.state).toBe('completed');
});
