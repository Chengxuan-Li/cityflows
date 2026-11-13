import { readFileSync } from 'node:fs';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { town } from '../src/fixtures/town';
import { importOsmCached } from './city-cache';
import { compile } from '../src/network';
import { createEngine } from '../src/sim/engine';

// node --experimental-strip-types --import ./bench/register.ts bench/passthrough-probe.ts
console.info('Measuring town day and Munich morning (step-only timers, seed 1)');
const imported = importOsmCached(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
  importerVersion: '1',
  drivingSide: 'right',
  bbox: [11.525, 48.135, 11.545, 48.148],
});
if (!imported.ok) throw new Error('Munich import failed');
for (const [name, city, endS] of [
  ['town-day', town(), 18 * 3600],
  ['Munich-morning', imported.city, 10 * 3600],
] as const) {
  const scenario = defaultScenario('town');
  scenario.endS = endS;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const trips = scheduleTrips(
    city,
    generatePopulation(city, scenario.demand),
    scenario,
    result.compiled,
  );
  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips, scenario });
  const steps = (endS - scenario.startS) * 10;
  let elapsedMs = 0;
  for (let step = 0; step < steps; step += 600) {
    const start = performance.now();
    engine.step(600);
    elapsedMs += performance.now() - start;
  }
  const metrics = engine.metrics();
  console.info(
    JSON.stringify({
      name,
      requested: trips.filter((trip) => trip.departS < endS).length,
      ...metrics.trips,
      meanDelayS: metrics.meanDelayS,
      stepsPerSecond: Math.round((steps * 1000) / elapsedMs),
      hash: engine.stateHash(),
    }),
  );
}
