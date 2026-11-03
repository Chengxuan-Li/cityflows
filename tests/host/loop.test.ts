import { afterEach, expect, test, vi } from 'vitest';
import { createPlayLoop } from '../../src/host/loop';
import type { HostEvent } from '../../src/host/protocol';

afterEach(() => vi.useRealTimers());

function setup(endS = 100) {
  vi.useFakeTimers();
  let now = 0;
  let steps = 0;
  const events: HostEvent[] = [];
  const engine = {
    get timeS() {
      return steps / 10;
    },
    step(count: number) {
      steps += count;
    },
    metrics: () => ({
      trips: {
        pending: 0,
        queuedOrigin: 0,
        driving: 0,
        queuedDestination: 0,
        completed: 0,
        failed: 0,
      },
    }),
  };
  const loop = createPlayLoop(engine, {
    dtS: 0.1,
    endS,
    now: () => now,
    emit: (event) => events.push(event),
  });
  return {
    loop,
    events,
    get steps() {
      return steps;
    },
    tick(wallMs = 100) {
      now += wallMs;
      vi.advanceTimersByTime(100);
    },
  };
}

test('tracks 5× wall time and emits ten ticks per second', () => {
  const run = setup();
  run.loop.setSpeed(5);
  run.loop.play();
  run.loop.play();
  for (let i = 0; i < 10; i++) run.tick();

  expect(run.steps).toBe(50);
  expect(run.events).toHaveLength(10);
  expect(run.events.at(-1)).toMatchObject({ type: 'tick', timeS: 5, achievedMultiplier: 5 });
});

test('caps a delayed tick, reports the achieved speed, and discards the backlog', () => {
  const run = setup();
  run.loop.setSpeed(20);
  run.loop.play();
  run.tick(1000);

  expect(run.steps).toBe(25);
  expect(run.events.at(-1)).toMatchObject({ type: 'tick', achievedMultiplier: 2.5 });

  run.tick();
  expect(run.steps).toBe(45);
  expect(run.events.at(-1)).toMatchObject({ type: 'tick', achievedMultiplier: 20 });
});

test('preserves fractional steps across ticks and excludes paused time', () => {
  const run = setup();
  run.loop.play();
  run.tick(160);
  run.tick(40);
  expect(run.steps).toBe(2);

  run.loop.pause();
  run.tick(2000);
  expect(run.steps).toBe(2);

  run.loop.play();
  run.tick();
  expect(run.steps).toBe(3);
});

test('stops at the end time and emits finished once', () => {
  const run = setup(0.3);
  run.loop.setSpeed(5);
  run.loop.play();
  run.tick();
  run.tick();
  run.loop.play();
  run.loop.step(10);
  run.tick();

  expect(run.steps).toBe(3);
  expect(run.events).toMatchObject([
    { type: 'tick', timeS: 0.3, achievedMultiplier: 3 },
    { type: 'finished', timeS: 0.3 },
  ]);
});
