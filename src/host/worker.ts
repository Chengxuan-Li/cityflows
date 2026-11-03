import Flatbush from 'flatbush';
import { createEngine } from '../sim/engine';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import { createPlayLoop } from './loop';
import type { HostEvent, HostReply, HostWireRequest } from './protocol';

const engine = createEngine();
let inputs: Parameters<typeof engine.load>[0] | undefined;
let loop: ReturnType<typeof createPlayLoop> | undefined;
let multiplier = 1;

function loadedLoop() {
  if (!loop) throw new Error('Load a scenario before using the traffic engine');
  return loop;
}

function load(input: Parameters<typeof engine.load>[0]) {
  const { scenario } = input;
  const dtS = scenario.simParams.dtS ?? DEFAULT_SIM_PARAMS.dtS;
  if (!Number.isFinite(dtS) || dtS <= 0) throw new Error('Simulation step must be positive');
  engine.load(input);
  loop?.pause();
  inputs = input;
  loop = createPlayLoop(engine, {
    dtS,
    endS: scenario.endS,
    now: () => performance.now(),
    emit: (event: HostEvent) => self.postMessage(event),
  });
  loop.setSpeed(multiplier);
}

function handle(request: Exclude<HostWireRequest, { type: 'snapshot' }>) {
  switch (request.type) {
    case 'load': {
      const { compiled, trips, scenario } = request;
      const { data, byteOffset } = compiled.laneSpatial;
      return load({
        compiled: { ...compiled, laneSpatial: Flatbush.from(data, byteOffset) },
        trips,
        scenario,
      });
    }
    case 'play':
      return loadedLoop().play();
    case 'pause':
      return loadedLoop().pause();
    case 'setSpeed':
      if (!Number.isFinite(request.multiplier) || request.multiplier <= 0) {
        throw new Error('Speed multiplier must be positive');
      }
      multiplier = request.multiplier;
      return loop?.setSpeed(multiplier);
    case 'step':
      if (!Number.isSafeInteger(request.steps) || request.steps < 0) {
        throw new Error('Step count must be a nonnegative integer');
      }
      return loadedLoop().step(request.steps);
    case 'restart':
      if (!inputs) throw new Error('Load a scenario before using the traffic engine');
      return load(inputs);
    case 'metrics':
      return { ...engine.metrics(), stepsPerSecond: loadedLoop().stepsPerSecond };
    case 'inspect':
      return engine.inspect(request.vehicleId);
    case 'hash':
      return engine.stateHash();
  }
}

self.addEventListener('message', ({ data: request }: MessageEvent<HostWireRequest>) => {
  const { id } = request;
  try {
    if (request.type === 'snapshot') {
      const { timeS, count, ...arrays } = engine.snapshot();
      const transfer = Object.values(arrays).map((array) => array.buffer);
      const reply: HostReply = { id, ok: true, result: { timeS, count, ...arrays } };
      self.postMessage(reply, { transfer });
    } else {
      self.postMessage({ id, ok: true, result: handle(request) } satisfies HostReply);
    }
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies HostReply);
  }
});
