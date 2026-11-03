import { generatePopulation, scheduleTrips } from '../src/demand';
import { grid5x5 } from '../src/fixtures/grid5x5';
import { defaultScenario } from '../src/fixtures/scenarios';
import { createEngineClient } from '../src/host/client';
import { compile } from '../src/network';

const status = document.querySelector<HTMLOutputElement>('#status')!;
const achieved = document.querySelector<HTMLOutputElement>('#achieved')!;
const time = document.querySelector<HTMLOutputElement>('#time')!;
const counts = document.querySelector<HTMLPreElement>('#counts')!;
const snapshot = document.querySelector<HTMLOutputElement>('#snapshot')!;
const client = createEngineClient(
  new Worker(new URL('../src/host/worker.ts', import.meta.url), { type: 'module' }),
);
let playing = false;

function fail(error: unknown) {
  playing = false;
  status.value = error instanceof Error ? error.message : String(error);
}

async function pullSnapshot() {
  const { count } = await client.snapshot();
  snapshot.value = String(count);
  if (playing) requestAnimationFrame(() => void pullSnapshot().catch(fail));
}

client.onEvent((event) => {
  switch (event.type) {
    case 'tick': {
      achieved.value = `${event.achievedMultiplier.toFixed(2)}×`;
      time.value = `${event.timeS.toFixed(1)} s`;
      const { pending, queuedOrigin, driving, queuedDestination, completed, failed } = event.counts;
      counts.textContent = [
        `Pending               ${pending}`,
        `Queued at origin      ${queuedOrigin}`,
        `Driving               ${driving}`,
        `Queued at destination ${queuedDestination}`,
        `Completed             ${completed}`,
        `Failed                ${failed}`,
      ].join('\n');
      break;
    }
    case 'finished':
      playing = false;
      status.value = 'Finished';
      break;
    case 'error':
      fail(event.message);
      break;
  }
});

async function start() {
  const city = grid5x5();
  const result = compile(city);
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  const scenario = defaultScenario('grid5x5');
  scenario.endS = scenario.startS + 600;
  scenario.demand.workStart = { meanS: scenario.startS + 5, sdS: 2 };
  scenario.demand.workDuration = { meanS: 300, sdS: 10 };
  const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
  await client.load({ compiled: result.compiled, trips, scenario });
  await client.setSpeed(10);
  await client.play();
  playing = true;
  status.value = 'Playing';
  await pullSnapshot();
}

void start().catch(fail);
