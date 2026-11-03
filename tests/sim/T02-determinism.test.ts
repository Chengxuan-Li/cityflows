import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test('T02 per-step hashes reproduce across engines and reload, and respond to the seed', () => {
  const city = grid5x5();
  const input = { compiled: setup(city), scenario: scenario(), trips: trips(city, 60, 1) };
  const first = createEngine();
  const twin = createEngine();
  const other = createEngine();
  first.load(input);
  twin.load(input);
  other.load({ ...input, scenario: scenario(2) });
  const hashes: number[] = [];
  let diverged = false;
  for (let i = 0; i < 3000; i++) {
    first.step();
    twin.step();
    other.step();
    const hash = first.stateHash();
    hashes.push(hash);
    expect(twin.stateHash()).toBe(hash);
    diverged ||= hash !== other.stateHash();
  }
  expect(diverged).toBe(true);
  first.load(input);
  for (const hash of hashes) {
    first.step();
    expect(first.stateHash()).toBe(hash);
  }
});
