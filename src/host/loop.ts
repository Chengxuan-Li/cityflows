import type { Metrics, TrafficEngine } from '../sim/types';
import type { HostEvent } from './protocol';

const tickMs = 100;
const maxStepsPerTick = 25;
const stepEpsilon = 1e-8;

interface LoopOptions {
  dtS: number;
  endS: number;
  now: () => number; // monotonic milliseconds
  emit: (event: HostEvent) => void;
}

type LoopEngine = Pick<TrafficEngine, 'timeS' | 'step'> & {
  metrics(): Pick<Metrics, 'trips'>;
};

export function createPlayLoop(engine: LoopEngine, { dtS, endS, now, emit }: LoopOptions) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastTickMs = 0;
  let accountedMs = 0;
  let multiplier = 1;
  let budget = 0;
  let stepsPerSecond = 0;
  let finished = false;

  function pause() {
    clearInterval(timer);
    timer = undefined;
    stepsPerSecond = 0;
  }

  function accrue(wallMs: number) {
    budget += ((wallMs - accountedMs) * multiplier) / (1000 * dtS);
    accountedMs = wallMs;
  }

  function remainingSteps() {
    // Round up to the first fixed step at or after the end, allowing for clock arithmetic.
    return Math.max(0, Math.ceil((endS - engine.timeS) / dtS - stepEpsilon));
  }

  function advance(steps: number) {
    const count = Math.min(steps, remainingSteps());
    if (count > 0) engine.step(count);
    return count;
  }

  function finishIfDone() {
    if (finished || remainingSteps() > 0) return;
    finished = true;
    pause();
    emit({ type: 'finished', timeS: engine.timeS });
  }

  function tick() {
    try {
      const wallMs = now();
      const elapsedS = (wallMs - lastTickMs) / 1000;
      lastTickMs = wallMs;
      accrue(wallMs);
      const due = Math.floor(budget + stepEpsilon);
      // Retain fractional steps, but drop whole steps the worker couldn't keep up with.
      budget = Math.max(0, budget - due);
      const steps = advance(Math.min(due, maxStepsPerTick));
      stepsPerSecond = elapsedS > 0 ? steps / elapsedS : 0;
      emit({
        type: 'tick',
        timeS: engine.timeS,
        achievedMultiplier: stepsPerSecond * dtS,
        counts: engine.metrics().trips,
      });
      finishIfDone();
    } catch (error) {
      pause();
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    play() {
      if (timer !== undefined || finished) return;
      finishIfDone();
      if (finished) return;
      lastTickMs = accountedMs = now();
      budget = 0;
      timer = setInterval(tick, tickMs);
    },
    pause,
    setSpeed(value: number) {
      if (timer !== undefined) accrue(now());
      multiplier = value;
    },
    step(steps: number) {
      advance(steps);
      finishIfDone();
    },
    get stepsPerSecond() {
      return stepsPerSecond;
    },
  };
}
