import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { onRunway, overlaps } from '../sim/aircraft-checks';
import { limit } from '../timeouts';

test.for([1, 2, 3])(
  'London City operates its flight day with seed %i',
  { timeout: limit(120_000) },
  async (seed) => {
    const project = await openBundled('london-city-airport');
    const result = compile(project.city);
    if (!result.ok || !result.compiled.airside) throw new Error('London City must compile');
    const fleet = createAircraftFleet(result.compiled.airside, seed);
    const operations = createFlightOperations(fleet, seed, 0);
    let overlapCount = 0;
    let runwayConflicts = 0;
    let peakStuck = 0;
    let peakMovingOnApron = 0;
    let concurrentApronSamples = 0;
    for (let step = 0; step < 864_000; step++) {
      const timeS = step / 10;
      operations.step(timeS);
      fleet.step(timeS);
      if (step % 10 !== 0) continue;
      const aircraft = fleet.snapshot();
      overlapCount += overlaps(aircraft).length;
      runwayConflicts += Number(onRunway(aircraft).length > 1);
      peakStuck = Math.max(peakStuck, fleet.metrics().stuck);
      const moving = aircraft.filter(
        ({ state, speedMps, onRunway }) =>
          !onRunway &&
          speedMps > 0.05 &&
          (state === 'taxi' || state === 'tow' || state === 'pushback'),
      ).length;
      peakMovingOnApron = Math.max(peakMovingOnApron, moving);
      concurrentApronSamples += Number(moving > 1);
    }
    operations.step(86_400);
    const metrics = operations.metrics();
    console.info({
      seed,
      ...metrics,
      aircraft: fleet.metrics(),
      overlapCount,
      runwayConflicts,
      peakStuck,
      peakMovingOnApron,
      concurrentApronSamples,
    });
    expect(metrics.scheduled).toBe(150);
    expect(metrics.completed / metrics.scheduled).toBeGreaterThanOrEqual(0.98);
    expect(overlapCount).toBe(0);
    expect(runwayConflicts).toBe(0);
    expect(peakStuck).toBe(0);
    expect(peakMovingOnApron).toBeGreaterThan(1);
    if (seed === project.scenarios[0]!.seed) {
      expect(metrics.meanDelayS).toBeLessThanOrEqual(300);
      expect(metrics.worstDelayS).toBeLessThanOrEqual(1800);
    }
  },
);
