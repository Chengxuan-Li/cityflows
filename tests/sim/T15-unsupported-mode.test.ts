import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test('T15 records unsupported modes immediately without spawning a vehicle', () => {
  const city = grid5x5();
  const engine = createEngine();
  engine.load({
    compiled: setup(city),
    scenario: scenario(),
    trips: trips(city, 1).map((trip) => ({ ...trip, mode: 'walk' })),
  });
  expect(engine.metrics().trips.failed).toBe(1);
  expect(engine.metrics().failedByReason.unsupported_mode).toBe(1);
  engine.step(30);
  expect(engine.snapshot().count).toBe(0);
  expect(engine.metrics().trips.pending).toBe(0);
});
