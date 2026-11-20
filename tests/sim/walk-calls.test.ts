import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { walkLightAt } from '../../src/render/layers/walkers';
import type { SignalProgram } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup } from './fixtures';

// TASK-245: walkers at signalised crossings are served within a cycle.

/** Walkers cross the south arm of a four-way signal (four 25 s phases, a 116 s cycle) with no
 * vehicles from `startS`, until `startS + 900`. */
function southEngine(
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
  return { engine, compiled, center: compiled.index.node.get(center.id)!, untilS };
}

/** The longest kerb wait of any walker and the walker metrics of `southEngine`'s run. */
function southWalkers(...args: Parameters<typeof southEngine>) {
  const { engine, untilS } = southEngine(...args);
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

/** Explicit walk green for the west, east and north arms only: the south crossing never shows
 * walk green. */
const southUnserved = (actuated: boolean) => (signal: SignalProgram, roads: string[][]) => {
  signal.actuated = actuated;
  signal.phases.forEach((phase, i) => {
    phase.walk = [0, 1, 2]
      .filter((arm) => arm !== i)
      .map((arm) => ({ roadId: roads[arm]![0]!, end: 'end' as const }));
  });
};

test('a signal crossing no phase gives walk green is crossed in a gap', () => {
  // Its walkers waited for ever. They now cross as without a signal.
  for (const actuated of [false, true]) {
    const run = southWalkers(25_200, 2, southUnserved(actuated));
    expect(run.walkers.crossings.signal, `actuated ${actuated}`).toBeGreaterThan(25);
    expect(run.longest, `actuated ${actuated}`).toBeLessThan(1);
  }
});

test('the walk light of a signal crossing no phase serves is dark, never red (TASK-252)', () => {
  // Walkers cross the south crossing in a gap, so its light drew red while they legally crossed.
  // It is dark in the run's snapshot and in the renderers' reading of the program; the served
  // crossings still change between red and green.
  for (const actuated of [false, true]) {
    const { engine, compiled, center, untilS } = southEngine(25_200, 2, southUnserved(actuated));
    const signal = compiled.nodes[center]!.signal!;
    const served = new Set(signal.phases.flatMap((phase) => phase.walk));
    const links = compiled.walk.links.filter(
      (l) => l.crossing?.control === 'signal' && l.crossing.node === center,
    );
    const unserved = links.filter((l) => !served.has(l.idx));
    expect(unserved.length, `actuated ${actuated}`).toBeGreaterThan(0);
    const lights = new Set<number>();
    let crossing = 0;
    while (engine.timeS < untilS) {
      engine.step(10);
      const { walk } = engine.snapshot().signals!;
      for (const l of unserved) {
        expect(walk[l.idx], `actuated ${actuated} at ${engine.timeS} s`).toBe(2);
        expect(walkLightAt(signal, l.idx, engine.timeS)).toBe(2);
      }
      for (const l of links) if (served.has(l.idx)) lights.add(walk[l.idx]!);
      crossing += engine.snapshot().walkers!.state.filter((s) => s === 3).length;
    }
    expect([...lights].sort(), `actuated ${actuated}`).toEqual([0, 1]);
    expect(crossing, `actuated ${actuated}`).toBeGreaterThan(0);
  }
});
