import { expect } from 'vitest';
import { loadAuditCity } from '../../bench/junction-audit';
import { buildCity } from '../../src/fixtures/build-city';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { compile, type CompiledCity } from '../../src/network';
import { demandSplit, MIN_GREEN_S } from '../../src/network/signal-program';
import type { City, Scenario, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createVehicles, OFF_LANE } from '../../src/sim/vehicle';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createSignalControl, signalControllers, timedSignals } from '../../src/sim/signals';
import { cityTest, unitTest } from '../tier';
import { scenario, setup } from './fixtures';

// TASK-170: demand-split and actuated signal timing (architecture section 5.4).

unitTest('demand split: equal saturation from the minimums, shared groups never bind', () => {
  // Two phases; group 0 (load 3) in phase 0, group 1 (load 1) in phase 1, group 2 in both.
  expect(demandSplit([[0], [1], [0, 1]], [3, 1, 50], [5, 5], 60)).toEqual([45, 15]);
  // Three phases; a group in phases 0 and 1 binds with group 2 alone in phase 2.
  expect(demandSplit([[0, 1], [2]], [2, 1], [5, 5, 5], 60)).toEqual([20, 20, 20]);
  // A heavy load cannot take a phase below its minimum.
  expect(demandSplit([[0], [1]], [100, 0.01], [5, 12], 60)).toEqual([48, 12]);
  // No load, or minimums over the green time: the program's own split stands.
  expect(demandSplit([[0], [1]], [0, 0], [5, 5], 60)).toBeNull();
  expect(demandSplit([[0], [1]], [1, 1], [40, 30], 60)).toBeNull();
});

/** The four-way signal with gateways on its west and east arms (no parking); `program` sets the
 * timing flags. Trips run from west to east and, with `back`, the other way too. */
function fourWay(program: { demandSplit?: boolean; actuated?: boolean }, back = false) {
  const city = signalApproach();
  const node = Object.values(city.nodes).find((n) => n.signal)!;
  Object.assign(node.signal!, program);
  for (const place of Object.values(city.places)) place.kind = 'gateway';
  const compiled = setup(city);
  const [homes, offices] = Object.values(city.places);
  const trips: TripRequest[] = Array.from({ length: back ? 80 : 40 }, (_, i) => {
    const [from, to] = back && i % 2 ? [offices!, homes!] : [homes!, offices!];
    return {
      id: `trip:${i}`,
      personId: null,
      originPlaceId: from.id,
      destinationPlaceId: to.id,
      departS: 100 + Math.floor(i / (back ? 2 : 1)) * 3,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    };
  });
  return { city, compiled, trips, node: compiled.index.node.get(node.id)! };
}

function run(
  { compiled, trips, node }: ReturnType<typeof fourWay>,
  untilS = 600,
  load: Partial<Scenario> = {},
) {
  const engine = createEngine();
  engine.load({ compiled, trips, scenario: { ...scenario(), ...load } });
  // The phases shown green once traffic arrives (an actuated signal rests in its phase at
  // load until then).
  const phases = new Set<string>();
  while (engine.timeS < untilS) {
    engine.step(10);
    const signals = engine.snapshot().signals!;
    if (signals.state[node] === 0 && engine.timeS > 150) phases.add(String(signals.phase[node]));
  }
  const metrics = engine.metrics();
  return { engine, metrics, phases: [...phases].sort() };
}

unitTest('demand split: the run times the loaded approach, the others keep their minimums', () => {
  const fixed = fourWay({});
  const split = fourWay({ demandSplit: true });
  const signal = fixed.compiled.nodes[fixed.node]!.signal!;
  const timed = timedSignals(
    split.compiled,
    new Map(signal.phases[0]!.movements.map((m) => [split.compiled.movements[m]!.id, 40])),
    DEFAULT_SIM_PARAMS,
  )[split.node]!;
  const greens = timed.phases.map((p) => p.durationS);
  // Each other phase keeps the time to cross its widest arm (four 3.5 m lanes and the gaps at
  // walking speed, plus the clearance), above MIN_GREEN_S; the west approach takes the rest.
  const minimum = greens[1]!;
  expect(minimum).toBeGreaterThan(MIN_GREEN_S);
  expect(greens.slice(1)).toEqual([minimum, minimum, minimum]);
  expect(greens.reduce((a, b) => a + b)).toBe(100);
  expect(timed.cycleS).toBe(signal.cycleS);

  const before = run(fixed);
  const after = run(split);
  expect(after.engine.signalTiming()).toEqual({
    [split.compiled.nodes[split.node]!.id]: greens,
  });
  expect(before.engine.signalTiming()).toEqual({});
  expect(after.metrics.trips.completed).toBe(40);
  expect(before.metrics.trips.completed).toBe(40);
  // The west approach waits less with the longer green.
  expect(after.metrics.meanDelayS).toBeLessThan(before.metrics.meanDelayS * 0.7);
});

unitTest('actuation: unused phases are skipped and a green without competing demand rests', () => {
  const fixed = run(fourWay({}, true));
  const actuated = run(fourWay({ actuated: true }, true));
  expect(fixed.phases).toEqual(['0', '1', '2', '3']);
  // Only the west and east approaches have traffic: north and south never turn green.
  expect(actuated.phases).toEqual(['0', '1']);
  expect(actuated.metrics.trips.completed).toBe(80);
  expect(fixed.metrics.trips.completed).toBe(80);
  expect(actuated.metrics.meanDelayS).toBeLessThan(fixed.metrics.meanDelayS);

  // One direction only: once the west approach has the green it rests there.
  const oneWay = run(fourWay({}));
  const resting = run(fourWay({ actuated: true }));
  expect(resting.phases).toEqual(['0']);
  expect(resting.metrics.meanDelayS).toBeLessThan(oneWay.metrics.meanDelayS / 2);
});

unitTest('actuation: a walker waiting at a red crossing calls its walk green', () => {
  // Walkers cross the south arm, whose walk light is red while the south approach is green.
  function walk(actuated: boolean) {
    const { city, node, street, place, signal } = buildCity('Four-way signal', 1);
    const center = node(0, 0);
    const arms = [node(-120, 0), node(120, 0), node(0, -120), node(0, 120)].map((end) =>
      street(end, center, 2),
    );
    signal(center, arms);
    if (actuated) center.signal!.actuated = true;
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
    engine.load({
      compiled,
      trips: [],
      scenario: {
        ...scenario(),
        walkers: [{ fromPlaceId: from!.id, toPlaceId: to!.id, perHour: 60 }],
      },
    });
    const index = compiled.index.node.get(center.id)!;
    const shown: number[] = [];
    while (engine.timeS < 900) {
      engine.step(10);
      const signals = engine.snapshot().signals!;
      if (signals.state[index] === 0 && shown.at(-1) !== signals.phase[index])
        shown.push(signals.phase[index]!);
    }
    return { shown, walkers: engine.metrics().walkers! };
  }
  const fixed = walk(false);
  const actuated = walk(true);
  // At load the actuated signal rests in the south approach's phase (its offset puts it there);
  // the first walker's call moves it to the next phase with south-arm walk green, where it rests.
  expect(actuated.shown).toEqual([3, 0]);
  expect(actuated.walkers.crossings.signal).toBe(11);
  expect(fixed.walkers.crossings.signal).toBe(10);
  expect(actuated.walkers.meanWaitS.signal).toBeLessThan(fixed.walkers.meanWaitS.signal / 2);
});

unitTest('actuation: amber and all-red keep the walk green the next phase keeps (TASK-188)', () => {
  // West and east traffic: the controller alternates phases 0 and 1. A crossing walk-green in
  // both stays green through the change between them, as under the fixed program; one walk-green
  // only in the ending phase turns red with its amber.
  function lights(actuated: boolean) {
    const four = fourWay(actuated ? { actuated: true } : {}, true);
    const { compiled, trips, node } = four;
    const signal = compiled.nodes[node]!.signal!;
    const links = compiled.walk.links.filter((l) => l.crossing?.node === node);
    const engine = createEngine();
    engine.load({ compiled, trips, scenario: scenario() });
    // Per change from phase `from` to phase `to`: whether each link was walk-green at every step
    // of the amber and all-red between them.
    const changes: { from: number; to: number; green: boolean[] }[] = [];
    let open: { from: number; green: boolean[] } | null = null;
    while (engine.timeS < 600) {
      engine.step(1);
      const { phase, state, walk } = engine.snapshot().signals!;
      if (state[node] !== 0) {
        open ??= { from: phase[node]!, green: links.map(() => true) };
        links.forEach((l, i) => (open!.green[i] &&= walk[l.idx] === 1));
      } else if (open) {
        changes.push({ ...open, to: phase[node]! });
        open = null;
      }
    }
    return { signal, links, changes };
  }
  for (const actuated of [false, true]) {
    const { signal, links, changes } = lights(actuated);
    const change = changes.find((c) => c.from === 0 && c.to === 1);
    expect(change, `actuated ${actuated}`).toBeDefined();
    const kept = links.map(
      (l) => signal.phases[0]!.walk.includes(l.idx) && signal.phases[1]!.walk.includes(l.idx),
    );
    expect(kept.some(Boolean)).toBe(true);
    expect(links.some((l, i) => !kept[i] && signal.phases[0]!.walk.includes(l.idx))).toBe(true);
    expect(change!.green, `actuated ${actuated}`).toEqual(kept);
  }
});

unitTest(
  'a movement the next phase serves too stays green through amber and all-red (TASK-194)',
  () => {
    // West to east is green in phases 0 and 1, east to west in phase 1 only; north and south keep
    // a phase each. Cars keep entering west to east in the all-red between phases 0 and 1, and
    // none enters in the all-red after phase 1.
    function entries(actuated: boolean) {
      const four = fourWay(actuated ? { actuated: true } : {}, true);
      const program = Object.values(four.city.nodes).find((n) => n.signal)!.signal!;
      const [westEast, eastWest] = program.phases.map((p) => p.groups[0]!);
      program.phases[0]!.groups = [westEast!];
      program.phases[1]!.groups = [westEast!, eastWest!];
      const compiled = setup(four.city);
      const kept = new Set(compiled.nodes[four.node]!.signal!.phases[0]!.movements);
      const engine = createEngine();
      engine.load({ compiled, trips: four.trips, scenario: scenario() });
      const entered = new Set<number>();
      // Entries onto the west-to-east movements in all-red, by change.
      const counts: Record<string, number> = {};
      while (engine.timeS < 700) {
        engine.step(1);
        const view = engine.snapshot();
        const { phase, state, next } = view.signals!;
        if (state[four.node] !== 0 && !actuated)
          expect(next[four.node]).toBe((phase[four.node]! + 1) % 4);
        for (const [i, id] of view.id.entries()) {
          const lane = view.lane[i]!;
          if (lane >= 0 || lane === OFF_LANE || entered.has(id)) continue;
          entered.add(id);
          if (state[four.node] !== 2 || !kept.has(-lane - 1)) continue;
          const change = `${phase[four.node]}>${next[four.node]}`;
          counts[change] = (counts[change] ?? 0) + 1;
        }
      }
      expect(engine.metrics().trips.completed).toBe(80);
      return counts;
    }
    for (const actuated of [false, true]) {
      const counts = entries(actuated);
      expect(counts['0>1'] ?? 0, `actuated ${actuated}`).toBeGreaterThan(0);
      expect(Object.keys(counts), `actuated ${actuated}`).toEqual(['0>1']);
    }
  },
);

unitTest(
  'actuation: a car waiting short of a short approach lane calls its phase (TASK-199)',
  () => {
    // The south arm reaches the signal over a 9 m road behind a way boundary, as Freiburg's
    // Wallstraße reaches n:68: a car held before the boundary is off the approach lane but within
    // `DETECT_M` of the stop line along its route, and calls the south phase from the resting west
    // green; one 60 m back does not.
    const { city, node, street, signal } = buildCity('Short approach', 1);
    const center = node(0, 0);
    const boundary = node(0, 9);
    const arms = [node(-120, 0), node(120, 0), node(0, -120)].map((end) => street(end, center));
    const south = street(boundary, center);
    const [far] = street(node(0, 150), boundary);
    signal(center, [...arms, south]);
    center.signal!.actuated = true;
    const compiled = setup(city);
    const road = (id: string) => compiled.index.road.get(id)!;
    const lane = (id: string) => compiled.roads[road(id)]!.lanes[0]!;
    const into = (from: number, to: number) =>
      compiled.lanes[from]!.out.find((m) => compiled.movements[m]!.toLane === to)!;
    const east = arms[1]![1];
    const route = {
      roads: [road(far!.id), road(south[0].id), road(east.id)],
      movements: [into(lane(far!.id), lane(south[0].id)), into(lane(south[0].id), lane(east.id))],
      targetLanes: [],
      costS: 0,
    };
    const index = compiled.index.node.get(center.id)!;
    const signals = compiled.nodes.map((n) => n.signal);
    function shown(backM: number) {
      const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
      const farLane = compiled.lanes[lane(far!.id)]!;
      vehicles.insert(0, farLane.idx, farLane.lengthM - backM);
      vehicles.state[0] = 1;
      vehicles.route[0] = route;
      vehicles.movement[0] = route.movements[0]!;
      const control = createSignalControl(
        compiled,
        signals,
        vehicles,
        DEFAULT_SIM_PARAMS,
        0,
        () => undefined,
      );
      const phases = new Set<number>();
      const colors = new Uint8Array(compiled.movements.length);
      for (let t = 0; t < 120; t += 0.1) {
        control.update(t, colors);
        const states = control.snapshot(t);
        if (states.state[index] === 0) phases.add(states.phase[index]!);
      }
      return [...phases];
    }
    expect(shown(2)).toEqual([0, 3]);
    expect(shown(60)).toEqual([0]);
  },
);

unitTest('actuation and demand split follow a live edit and stay deterministic', () => {
  const a = run(fourWay({ demandSplit: true, actuated: true }, true));
  const b = run(fourWay({ demandSplit: true, actuated: true }, true));
  expect(a.engine.stateHash()).toBe(b.engine.stateHash());
  const edited = fourWay({ demandSplit: true, actuated: true }, true);
  const engine = createEngine();
  engine.load({ compiled: edited.compiled, trips: edited.trips, scenario: scenario() });
  engine.step(2000);
  const city: City = structuredClone(edited.city);
  const signal = Object.values(city.nodes).find((n) => n.signal)!.signal!;
  signal.phases[0]!.durationS = 40;
  const next = compile(city);
  if (!next.ok) throw new Error('Edit must compile');
  engine.patch(next.compiled);
  expect(engine.signalTiming()[Object.values(city.nodes).find((n) => n.signal)!.id]).toHaveLength(
    4,
  );
  engine.step(4000);
  expect(engine.metrics().trips.completed).toBe(80);
});

function groupCensus(compiled: CompiledCity) {
  const flows = new Map(compiled.movements.map((m) => [m.id, 1 + (m.idx % 7)]));
  const timed = timedSignals(compiled, flows, DEFAULT_SIM_PARAMS);
  return signalControllers(compiled).map(({ id, nodes }) => {
    const signal = compiled.nodes[nodes[0]!]!.signal!;
    return {
      id,
      members: nodes.map((n) => timed[n]!.phases.map((p) => p.durationS)),
      programS: signal.phases.reduce((sum, p) => sum + p.durationS, 0),
      demandSplit: !!signal.demandSplit,
    };
  });
}

cityTest(
  'Munich: generated programs are actuated (TASK-194); a demand split times group members alike',
  () => {
    const city = structuredClone(loadAuditCity('munich'));
    const programs = [
      ...Object.values(city.nodes).map((n) => n.signal),
      ...Object.values(city.junctionGroups ?? {}).map((g) => g.signal),
    ].filter((p) => p !== null);
    for (const program of programs) {
      expect(program.actuated).toBe(true);
      expect(program.demandSplit).toBeUndefined();
      program.demandSplit = true;
    }
    const result = compile(city);
    if (!result.ok) throw new Error('Munich must compile');
    const census = groupCensus(result.compiled);
    // Munich: nine signalised junction groups and one single signal node (n:635).
    expect(census).toHaveLength(10);
    for (const { id, members, programS, demandSplit } of census) {
      expect(demandSplit, id).toBe(true);
      for (const greens of members) {
        expect(greens, id).toEqual(members[0]);
        expect(
          greens.reduce((a, b) => a + b),
          id,
        ).toBeCloseTo(programS, 6);
        for (const green of greens) expect(green, id).toBeGreaterThanOrEqual(MIN_GREEN_S);
      }
    }
  },
);
