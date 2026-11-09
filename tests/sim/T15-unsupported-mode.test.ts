import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test.each(['bus', 'rail'] as const)(
  'T15 records unsupported %s immediately without spawning a vehicle',
  (mode) => {
    const city = grid5x5();
    const engine = createEngine();
    engine.load({
      compiled: setup(city),
      scenario: scenario(),
      trips: trips(city, 1).map((trip) => ({ ...trip, mode })),
    });
    expect(engine.metrics().trips.failed).toBe(1);
    expect(engine.metrics().failedByReason.unsupported_mode).toBe(1);
    engine.step(30);
    expect(engine.snapshot().count).toBe(0);
    expect(engine.metrics().trips.pending).toBe(0);
  },
);

test('T15 walk trips with a gateway end remain unsupported', () => {
  const city = grid5x5();
  const request = { ...trips(city, 1)[0]!, mode: 'walk' as const };
  city.places[request.originPlaceId]!.kind = 'gateway';
  const engine = createEngine();
  engine.load({ compiled: setup(city), scenario: scenario(), trips: [request] });
  expect(engine.metrics().failedByReason.unsupported_mode).toBe(1);
  engine.step(30);
  expect(engine.snapshot().walkers?.count ?? 0).toBe(0);
});
