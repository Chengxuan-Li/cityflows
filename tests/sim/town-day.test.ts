import { env } from 'node:process';
import { expect, it } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { limit } from '../timeouts';

it.skipIf(env.RUN_SLOW !== '1')(
  'runs a full town day with under 1% failed trips and no stranded vehicles',
  () => {
    const city = town();
    const scenario = defaultScenario('town');
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { compiled } = result;
    const population = generatePopulation(city, scenario.demand);
    const trips = scheduleTrips(city, population, scenario, compiled);
    const requested = trips.filter((trip) => trip.departS < scenario.endS).length;
    const engine = createEngine();
    engine.load({ compiled, trips, scenario });
    const dtS = scenario.simParams.dtS ?? DEFAULT_SIM_PARAMS.dtS;
    const steps = Math.round((scenario.endS - scenario.startS) / dtS);
    const sampleSteps = Math.round(1 / dtS);
    let peakDriving = 0;
    let peakQueued = 0;
    const started = performance.now();
    for (let step = 0; step < steps; step += sampleSteps) {
      engine.step(Math.min(sampleSteps, steps - step));
      const { trips } = engine.metrics();
      peakDriving = Math.max(peakDriving, trips.driving);
      peakQueued = Math.max(peakQueued, trips.queuedOrigin + trips.queuedDestination);
    }
    const stepsPerSecond = Math.round((1000 * steps) / (performance.now() - started));
    const metrics = engine.metrics();
    console.info('Town day', {
      nodes: compiled.nodes.length,
      roads: compiled.roads.length,
      lanes: compiled.lanes.length,
      places: compiled.places.length,
      steps,
      stepsPerSecond,
      peakDriving,
      peakQueued,
      ...metrics.trips,
      stranded: metrics.failedByReason.stranded,
      requested,
    });
    expect(metrics.timeS).toBe(scenario.endS);
    expect(metrics.trips.pending).toBe(trips.length - requested);
    expect(metrics.trips.failed / requested).toBeLessThan(0.01);
    expect(metrics.failedByReason.stranded).toBe(0);
  },
  limit(300_000),
);
