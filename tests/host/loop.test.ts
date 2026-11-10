import { afterEach, expect, test, vi } from 'vitest';
import { createPlayLoop } from '../../src/host/loop';
import type { HostEvent } from '../../src/host/protocol';

afterEach(() => vi.useRealTimers());

function setup(endS = 100, facilities: { id: string; occupied: number; capacity: number }[] = []) {
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
      meanDelayS: steps / 100,
      parking: {
        facilities,
        parked: 0,
        arrivals: 0,
        parkedWithoutExit: 0,
        meanSearchTimeS: 0,
        failed: 0,
      },
      trips: {
        pending: 0,
        queuedOrigin: 0,
        driving: steps,
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

test('samples actual minute boundaries across manual batches, play and pause', () => {
  const run = setup(245);
  expect(run.loop.metricsSeries()).toEqual([
    { timeS: 0, driving: 0, queued: 0, completed: 0, meanDelayS: 0 },
  ]);
  run.loop.step(1799);
  expect(run.loop.metricsSeries().map(({ timeS }) => timeS)).toEqual([0, 60, 120]);
  run.loop.setSpeed(20);
  run.loop.play();
  run.tick();
  run.loop.pause();
  run.tick(60_000);
  expect(run.loop.metricsSeries().at(-1)).toEqual({
    timeS: 180,
    driving: 1800,
    queued: 0,
    completed: 0,
    meanDelayS: 18,
  });
  run.loop.step(10_000);
  expect(run.loop.metricsSeries().map(({ timeS }) => timeS)).toEqual([0, 60, 120, 180, 240]);
  run.loop.step(1);
  expect(run.loop.metricsSeries()).toHaveLength(5);
  expect(setup().loop.metricsSeries()).toHaveLength(1);
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

test('records independent facility occupancy at each simulated minute', () => {
  const facilities = [
    { id: 'pk:1', occupied: 2, capacity: 8 },
    { id: 'pk:2', occupied: 0, capacity: 4 },
  ];
  const run = setup(180, facilities);
  facilities[0]!.occupied = 5;
  facilities[1]!.occupied = 1;
  run.loop.step(600);
  facilities[0]!.occupied = 3;
  facilities[1]!.occupied = 2;
  run.loop.step(600);
  expect(
    run.loop.metricsSeries().map(({ timeS, parkingOccupancy }) => ({ timeS, parkingOccupancy })),
  ).toEqual([
    { timeS: 0, parkingOccupancy: { 'pk:1': 2, 'pk:2': 0 } },
    { timeS: 60, parkingOccupancy: { 'pk:1': 5, 'pk:2': 1 } },
    { timeS: 120, parkingOccupancy: { 'pk:1': 3, 'pk:2': 2 } },
  ]);
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
