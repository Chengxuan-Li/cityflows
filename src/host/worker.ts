import Flatbush from 'flatbush';
import { createEngine } from '../sim/engine';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import { createPlayLoop } from './loop';
import { runHeadless } from './headless';
import { createExportRecorder, tripRecords } from './export-data';
import type { HostEvent, HostReply, HostWireRequest } from './protocol';

const engine = createEngine();
let inputs: Parameters<typeof engine.load>[0] | undefined;
let loop: ReturnType<typeof createPlayLoop> | undefined;
let multiplier = 1;
let lastOverlayMs = -Infinity;
let recorder: ReturnType<typeof createExportRecorder> | undefined;

function loadedRecorder() {
  if (!recorder) throw new Error('Load a scenario before exporting traffic');
  return recorder;
}

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
  lastOverlayMs = -Infinity;
  recorder = createExportRecorder(engine, input.compiled);
  loop = createPlayLoop(engine, {
    dtS,
    endS: scenario.endS,
    now: () => performance.now(),
    emit: (event: HostEvent) => self.postMessage(event),
    afterStep: () => loadedRecorder().observe(),
  });
  loop.setSpeed(multiplier);
}

function handle(request: Exclude<HostWireRequest, { type: 'snapshot' }>) {
  switch (request.type) {
    case 'patch': {
      if (!inputs) throw new Error('Load a scenario before using the traffic engine');
      const { data, byteOffset } = request.compiled.laneSpatial;
      const compiled = { ...request.compiled, laneSpatial: Flatbush.from(data, byteOffset) };
      const started = performance.now();
      const result = engine.patch(compiled);
      inputs = { ...inputs, compiled };
      loadedRecorder().patch(compiled);
      lastOverlayMs = -Infinity;
      performance.clearMeasures('cityflows.patch');
      performance.measure('cityflows.patch', { start: started, end: performance.now() });
      return { ...result, timeS: engine.timeS };
    }
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
    case 'metricsSeries':
      return loadedLoop().metricsSeries();
    case 'runHeadless':
      if (!inputs) throw new Error('Load a scenario before using the traffic engine');
      return runHeadless(inputs, (timeS) =>
        self.postMessage({ type: 'headlessProgress', timeS } satisfies HostEvent),
      );
    case 'tripRecords':
      loadedLoop();
      return tripRecords(engine, inputs!.trips);
    case 'roadStats':
      return loadedRecorder().roadStats();
    case 'trajectories':
      return request.enabled === undefined
        ? loadedRecorder().trajectories()
        : loadedRecorder().setTrajectories(request.enabled);
    case 'trajectoryStatus':
      return loadedRecorder().trajectoryStatus();
    case 'inspect':
      return engine.inspect(request.vehicleId);
    case 'inspectWalker':
      return engine.inspectWalker(request.walkerId);
    case 'hash':
      return engine.stateHash();
  }
}

self.addEventListener('message', ({ data: request }: MessageEvent<HostWireRequest>) => {
  const { id } = request;
  try {
    if (request.type === 'snapshot') {
      const { timeS, count, parkingOccupancy: occupancy, walkers, ...arrays } = engine.snapshot();
      const transfer = Object.values(arrays).map((array) => array.buffer);
      if (walkers)
        for (const array of Object.values(walkers))
          if (typeof array !== 'number') transfer.push(array.buffer);
      const now = performance.now();
      const updateOverlays = now - lastOverlayMs >= 500;
      const roadSpeedRatio = updateOverlays ? engine.metrics().roadSpeedRatio : undefined;
      const parkingOccupancy = updateOverlays ? occupancy : undefined;
      if (roadSpeedRatio) {
        lastOverlayMs = now;
        transfer.push(roadSpeedRatio.buffer);
      }
      if (parkingOccupancy) transfer.push(parkingOccupancy.buffer);
      const reply: HostReply = {
        id,
        ok: true,
        result: { timeS, count, ...arrays, roadSpeedRatio, parkingOccupancy, walkers },
      };
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
