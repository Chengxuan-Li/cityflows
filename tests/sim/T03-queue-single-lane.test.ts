import { expect, test } from 'vitest';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { GREEN, RED, updateSignals } from '../../src/sim/signals';
import { scenario, setup, trips } from './fixtures';

test('T03 a single-lane queue grows on red and drains on green with safe gaps', () => {
  const city = signalApproach();
  for (const place of Object.values(city.places)) {
    place.connectors = place.connectors.filter((connector) => connector.lane === 0);
  }
  const compiled = setup(city);
  const requests = trips(city, 10, 0.5).map((trip) => ({ ...trip, departS: trip.departS - 71 }));
  const approach = compiled.places[0]!.connectorsOut[0]!;
  const lane = compiled.connectors[approach]!.lane;
  const engine = createEngine();
  engine.load({ compiled, scenario: { ...scenario(), startS: 29 }, trips: requests });

  let lastQueued = 0;
  let queueAfterFirstGreen = Infinity;
  let largestRedQueue = 0;
  let entries = 0;
  const onMovement = new Set<number>();
  for (let i = 0; i < 3800; i++) {
    const time = engine.timeS;
    engine.step();
    const view = engine.snapshot();
    const positions: number[] = [];
    let queued = 0;
    for (const [index, id] of view.id.entries()) {
      const detail = engine.inspect(id)!;
      if (view.lane[index] === lane) {
        positions.push(detail.positionM);
        if (detail.speedMps < 0.15) queued++;
      }
      if (view.lane[index]! < 0 && !onMovement.has(id)) {
        entries++;
        expect(time).toBeGreaterThanOrEqual(116);
        expect(time % 116).toBeLessThan(28);
        onMovement.add(id);
      }
    }
    positions.sort((a, b) => b - a);
    const { vehicleLengthM, idm } = DEFAULT_SIM_PARAMS;
    for (let j = 1; j < positions.length; j++) {
      expect(positions[j - 1]! - positions[j]! - vehicleLengthM).toBeGreaterThanOrEqual(
        idm.minGapM - 1e-8,
      );
    }
    if (time < 116) largestRedQueue = Math.max(largestRedQueue, queued);
    if (time === 145) queueAfterFirstGreen = queued;
    lastQueued = queued;
  }
  expect(largestRedQueue).toBe(10);
  expect(queueAfterFirstGreen).toBeLessThan(largestRedQueue);
  expect(lastQueued).toBe(0);
  expect(entries).toBe(10);
  expect(engine.metrics().trips.completed).toBe(10);
});

test('an exact fractional signal boundary starts all-red', () => {
  const city = signalApproach();
  const signal = Object.values(city.nodes).find((node) => node.signal)!.signal!;
  signal.phases = [{ ...signal.phases[0]!, durationS: 0.1 }];
  signal.amberS = 0;
  signal.allRedS = 0.2;
  const compiled = setup(city);
  const colors = new Uint8Array(compiled.movements.length);
  const movement = compiled.nodes.find((node) => node.signal)!.signal!.phases[0]!.movements[0]!;
  updateSignals(compiled, 0, colors);
  expect(colors[movement]).toBe(GREEN);
  updateSignals(compiled, 0.1, colors);
  expect(colors[movement]).toBe(RED);
});
