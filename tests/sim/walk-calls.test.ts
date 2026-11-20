import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { SignalProgram } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup } from './fixtures';

// TASK-245: walkers at signalised crossings are served within a cycle.

/** Walkers cross the south arm of a four-way signal (four 25 s phases, a 116 s cycle) with no
 * vehicles from `startS`; returns the longest kerb wait of any walker and the walker metrics. */
function southWalkers(
  startS: number,
  lanes: number,
  program: (signal: SignalProgram, roads: string[][]) => void,
) {
  const { city, node, street, place, signal } = buildCity('Four-way signal', 1);
  const center = node(0, 0);
  const arms = [node(-120, 0), node(120, 0), node(0, -120), node(0, 120)].map((end) =>
    street(end, center, lanes),
  );
  signal(center, arms);
  program(
    center.signal!,
    arms.map((pair) => pair.map((r) => r.id)),
  );
  const [southIn, southOut] = arms[3]!;
  place('South-west', 'gateway', { x: -20, y: 60 }, [
    { road: southIn, direction: 'in', positionM: 60 },
  ]);
  place('South-east', 'gateway', { x: 20, y: 60 }, [
    { road: southOut, direction: 'in', positionM: 60 },
  ]);
  const compiled = setup(city);
  const [from, to] = Object.values(city.places);
  const engine = createEngine();
  const untilS = startS + 900;
  engine.load({
    compiled,
    trips: [],
    scenario: {
      ...scenario(),
      startS,
      endS: untilS,
      walkers: [{ fromPlaceId: from!.id, toPlaceId: to!.id, perHour: 120 }],
    },
  });
  let longest = 0;
  while (engine.timeS < untilS) {
    engine.step(10);
    for (const id of engine.snapshot().walkers!.id)
      longest = Math.max(longest, engine.inspectWalker(id)!.currentWaitS);
  }
  return { longest, walkers: engine.metrics().walkers! };
}

test('an actuated green resting with walk green serves a waiting walker at once', () => {
  // The controller rests in the phase with south-arm walk green and extends it to exactly the
  // time a walker's run needs. Before TASK-245 the remaining green, (t + need) - t, fell short of
  // the need by a rounding error at some crossing lengths and times of day, so no walker crossed
  // in 15 minutes (one lane at 09:10, three lanes at 07:00). At 100 s the controller starts in
  // another phase, so the first walker waits for the change.
  for (const lanes of [1, 2, 3])
    for (const startS of [100, 25_200, 33_000]) {
      const run = southWalkers(startS, lanes, (signal) => (signal.actuated = true));
      expect(run.walkers.crossings.signal, `${lanes} lanes from ${startS} s`).toBeGreaterThan(25);
      expect(run.longest, `${lanes} lanes from ${startS} s`).toBeLessThan(20);
    }
});

test('a signal crossing no phase gives walk green is crossed in a gap', () => {
  // Explicit walk green for the west, east and north arms only: the south crossing never shows
  // walk green, and its walkers waited for ever. They now cross as without a signal.
  for (const actuated of [false, true]) {
    const run = southWalkers(25_200, 2, (signal, roads) => {
      signal.actuated = actuated;
      signal.phases.forEach((phase, i) => {
        phase.walk = [0, 1, 2]
          .filter((arm) => arm !== i)
          .map((arm) => ({ roadId: roads[arm]![0]!, end: 'end' as const }));
      });
    });
    expect(run.walkers.crossings.signal, `actuated ${actuated}`).toBeGreaterThan(25);
    expect(run.longest, `actuated ${actuated}`).toBeLessThan(1);
  }
});
