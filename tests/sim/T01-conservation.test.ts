import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test('T01 accounts for 300 trips over two hours without losing any vehicle id', () => {
  const city = grid5x5();
  const engine = createEngine();
  engine.load({ compiled: setup(city), scenario: scenario(), trips: trips(city, 300, 1) });
  for (let i = 0; i < 720; i++) {
    engine.step(100);
    expect(Object.values(engine.metrics().trips).reduce((a, b) => a + b)).toBe(300);
  }
  expect(engine.timeS).toBe(7300);
  const { trips: counts, failedByReason } = engine.metrics();
  expect(counts.pending + counts.driving).toBe(0);
  expect(counts.completed).toBeGreaterThan(0);
  expect(Object.values(failedByReason).reduce((a, b) => a + b)).toBe(counts.failed);
  for (let id = 1; id <= 300; id++) {
    const detail = engine.inspect(id)!;
    expect(detail).not.toBeNull();
    if (detail.state === 'failed') expect(detail.failReason).not.toBeNull();
    if (detail.state.startsWith('queued')) expect(detail.waitingS).toBeGreaterThan(0);
  }
});

test('releases trips from before start immediately and keeps trips after end pending', () => {
  const city = grid5x5();
  const [early, late] = trips(city, 2);
  early!.departS = 80;
  late!.departS = 101;
  const engine = createEngine();
  engine.load({
    compiled: setup(city),
    scenario: { ...scenario(), endS: 100 },
    trips: [early!, late!],
  });
  engine.step(1000);
  expect(engine.metrics().trips.pending).toBe(1);
  expect(engine.inspect(1)?.departedS).toBe(100);
});
