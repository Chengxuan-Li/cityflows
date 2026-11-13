import { describe, expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile, walkGreenS, type CompiledCity, type CWalkLink } from '../../src/network';
import { crossingArms } from '../../src/network/crossings';
import type { City, Scenario, SignalProgram, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { sampleCrossings } from './crossing-safety';
import { scenario as baseScenario, setup } from './fixtures';

// TASK-111: walkers and the rules between them and vehicles. A street with a T junction for the
// zebra (every crossing at an unsignalised junction of three arms is a zebra), a four-way signal
// for walk green, turning yields and the exclusive pedestrian phase. Every run samples the safety
// invariant at every step: no vehicle's body overlaps a crossing span while a walker is inside
// that span on the same lane (gate 4).

const { crossingClearM, walkSpeedMps, walkClearanceS } = DEFAULT_SIM_PARAMS;
type Engine = ReturnType<typeof createEngine>;

function trip(id: string, from: string, to: string, departS: number): TripRequest {
  return {
    id,
    personId: null,
    originPlaceId: from,
    destinationPlaceId: to,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  };
}

function place(city: City, name: string, pos: { x: number; y: number }) {
  const id = `p:${city.nextId++}`;
  city.places[id] = {
    id,
    name,
    kind: 'other',
    shape: { kind: 'point', pos },
    population: 0,
    jobs: 0,
    attraction: 1,
    capacity: null,
    connectors: [],
    profile: null,
    events: [],
    provenance: { source: 'generated' },
  };
  return id;
}

/** A two-way street west to east through a T junction; walkers cross its east arm. */
function zebraStreet() {
  const { city, node, street, place: carPlace } = buildCity('Zebra', 1);
  const west = node(-300, 0),
    centre = node(0, 0),
    east = node(300, 0);
  const [westIn, westOut] = street(west, centre);
  const [eastOut, eastIn] = street(centre, east);
  street(centre, node(0, -150));
  // Departures from homes and arrivals at offices, so garages neither run dry nor fill up.
  carPlace('West homes', 'residential', { x: -290, y: 10 }, [{ road: westIn, direction: 'out' }]);
  carPlace('East offices', 'work', { x: 290, y: 10 }, [
    { road: eastOut, direction: 'in', positionM: 250 },
  ]);
  carPlace('East homes', 'residential', { x: 290, y: -10 }, [{ road: eastIn, direction: 'out' }]);
  carPlace('West offices', 'work', { x: -290, y: -10 }, [
    { road: westOut, direction: 'in', positionM: 250 },
  ]);
  const north = place(city, 'North bank', { x: 24, y: -14 });
  const south = place(city, 'South bank', { x: 24, y: 14 });
  const [westHomes, eastOffices, eastHomes, westOffices] = Object.keys(city.places);
  return { city, north, south, westHomes, eastOffices, eastHomes, westOffices };
}

/** A four-way signal of two-lane arms, one phase per arm (`buildCity`); walkers cross the south
 * arm, cars from the west turn right into it. */
function signalJunction(program?: (arms: string[][]) => SignalProgram) {
  const { city, node, street, place: carPlace, signal } = buildCity('Walk signal', 1);
  const centre = node(0, 0);
  const ends = [node(-150, 0), node(150, 0), node(0, -150), node(0, 150)];
  const arms = ends.map((end) => street(end, centre, 2));
  signal(centre, arms);
  if (program)
    centre.signal = program(arms.map(([incoming, outgoing]) => [incoming.id, outgoing.id]));
  const [westIn] = arms[0]!;
  const [, southOut] = arms[3]!;
  carPlace('West', 'residential', { x: -140, y: 15 }, [
    { road: westIn, direction: 'out', lane: 1 },
  ]);
  carPlace('South', 'work', { x: 15, y: 140 }, [
    { road: southOut, direction: 'in', lane: 1, positionM: 120 },
  ]);
  const left = place(city, 'South-west corner', { x: -16, y: 22 });
  const right = place(city, 'South-east corner', { x: 16, y: 22 });
  return { city, centre: centre.id, left, right };
}

function load(
  compiled: CompiledCity,
  trips: TripRequest[],
  walkers: Scenario['walkers'],
  seed = 1,
): Engine {
  const engine = createEngine();
  engine.load({ compiled, trips, scenario: { ...baseScenario(seed), walkers } });
  return engine;
}

interface Body {
  id: number;
  lane: number;
  front: number;
  speed: number;
}

/** Vehicle bodies in the metres of the lanes they cover: a vehicle on a movement is measured on
 * the lane it leaves (its rear may still be there) and on the lane it enters. */
function bodies(engine: Engine, lanes: Set<number>, compiled: CompiledCity) {
  const snapshot = engine.snapshot();
  const result: Body[] = [];
  for (let i = 0; i < snapshot.count; i++) {
    const field = snapshot.lane[i]!;
    const movement = field < 0 ? compiled.movements[-field - 1]! : undefined;
    const covered = movement ? [movement.fromLane, movement.toLane] : [field];
    if (!covered.some((lane) => lanes.has(lane))) continue;
    const { positionM, speedMps } = engine.inspect(snapshot.id[i]!)!;
    const id = snapshot.id[i]!;
    if (!movement) result.push({ id, lane: field, front: positionM, speed: speedMps });
    else {
      const from = compiled.lanes[movement.fromLane]!;
      result.push({ id, lane: from.idx, front: from.lengthM + positionM, speed: speedMps });
      result.push({
        id,
        lane: movement.toLane,
        front: positionM - movement.lengthM,
        speed: speedMps,
      });
    }
  }
  return result;
}

interface WalkerAt {
  id: number;
  state: string;
  link: number;
  s: number;
}

function walkersOf(engine: Engine): WalkerAt[] {
  const walkers = engine.snapshot().walkers!;
  return Array.from(walkers.id, (id) => {
    const d = engine.inspectWalker(id)!;
    return { id, state: d.state, link: d.link, s: d.positionM };
  });
}

const crossingLinks = (compiled: CompiledCity, test: (link: CWalkLink) => boolean) =>
  compiled.walk.links.filter((link) => link.crossing && test(link));

describe('T53 zebra', () => {
  const { city, north, south, westHomes, eastOffices, eastHomes, westOffices } = zebraStreet();
  const compiled = setup(city);
  const crossing = crossingLinks(
    compiled,
    (link) => link.crossing!.control === 'zebra' && link.line.every((p) => p.x > 3),
  );
  const spans = crossing.flatMap((link) => link.crossing!.spans);
  const lanes = new Set(spans.map((span) => span.lane));
  const trips = Array.from({ length: 160 }, (_, i) =>
    i % 2
      ? trip(`trip:${i}`, eastHomes!, westOffices!, 100 + i * 3.1)
      : trip(`trip:${i}`, westHomes!, eastOffices!, 100 + i * 2.7),
  );
  const walkers = [{ fromPlaceId: north, toPlaceId: south, perHour: 240 }];

  function observe() {
    const engine = load(compiled, trips, walkers);
    const events = { held: 0, released: 0, passedWhileWaiting: 0, bothHeld: 0, overlap: '' };
    const heldCars = new Set<number>();
    const holding = new Map<number, Set<number>>();
    const hashes: number[] = [];
    let previous = new Map<number, number>();
    for (let step = 0; step < 6000; step++) {
      engine.step();
      const cars = bodies(engine, lanes, compiled);
      const people = walkersOf(engine);
      events.overlap ||= sampleCrossings(engine, compiled) ?? '';
      const onCrossing = people.filter((w) => crossing.some((l) => l.idx === w.link));
      // Waiting walkers stand at the end of the sidewalk leg before the crossing.
      const waiting = people.filter((w) => w.state === 'waiting');
      const heldRoads = new Set<number>();
      for (const car of cars) {
        const span = spans.find((s) => s.lane === car.lane);
        if (!span) continue;
        const lo = span.atM - span.halfM;
        const before = previous.get(car.id);
        const yielding =
          car.front <= lo && car.front > lo - 4 && (onCrossing.length > 0 || waiting.length > 0);
        // Nothing else slows a car this close to the stripes on this street.
        if (yielding && car.speed < 1) heldRoads.add(compiled.lanes[car.lane]!.road);
        if (yielding && car.speed < 0.1) {
          heldCars.add(car.id);
          events.held++;
        }
        if (before !== undefined && before <= lo && car.front > lo) {
          if (waiting.length && !heldCars.has(car.id)) events.passedWhileWaiting++;
          if (heldCars.has(car.id)) {
            events.released++;
            // Released only once every walker on the crossing is past this lane by crossingClearM.
            for (const walker of onCrossing) {
              const at = compiled.walk.links[walker.link]!.crossing!.spans.find(
                (s) => s.lane === car.lane,
              );
              if (!at) continue;
              const link = compiled.walk.links[walker.link]!;
              // Walkers go north to south: along the link if its first point is the northern one.
              const forward = link.line[0]!.y < link.line.at(-1)!.y;
              const past = forward
                ? walker.s > at.linkM + at.linkHalfM + crossingClearM - 0.15
                : walker.s < at.linkM - at.linkHalfM - crossingClearM + 0.15;
              expect(past, `vehicle ${car.id} went before walker ${walker.id} cleared`).toBe(true);
            }
          }
        }
      }
      // The roads on which a walker on the crossing has held a car, over its crossing.
      for (const walker of onCrossing) {
        const roads = holding.get(walker.id) ?? new Set<number>();
        for (const road of heldRoads) roads.add(road);
        holding.set(walker.id, roads);
      }
      previous = new Map(cars.map((car) => [car.id, car.front]));
      if (step % 600 === 599) hashes.push(engine.stateHash());
    }
    events.bothHeld = [...holding.values()].filter((roads) => roads.size === 2).length;
    return { events, hashes, metrics: engine.metrics() };
  }

  const first = observe();

  test('T53 a car that can stop stops for a waiting walker, and goes after it clears its lane', () => {
    expect(first.events.held).toBeGreaterThan(0);
    expect(first.events.released).toBeGreaterThan(0);
    expect(first.metrics.walkers!.vehicleStops.zebra).toBeGreaterThan(0);
    expect(first.metrics.walkers!.vehicleDelayS.zebra).toBeGreaterThan(0);
    expect(first.metrics.walkers!.crossings.zebra).toBeGreaterThan(10);
  });

  test('T53 a car too close to stop passes while the walker waits', () => {
    expect(first.events.passedWhileWaiting).toBeGreaterThan(0);
    expect(first.metrics.walkers!.meanWaitS.zebra).toBeGreaterThan(0);
  });

  test('T53 a walker on the crossing holds every crossed lane, both directions', () => {
    expect(new Set(spans.map((s) => compiled.lanes[s.lane]!.road)).size).toBe(2);
    expect(first.events.bothHeld).toBeGreaterThan(0);
  });

  test('T53 gate 4: no vehicle body over a span a walker is inside, and no hard stops', () => {
    expect(first.events.overlap).toBe('');
    expect(first.metrics.walkers!.hardStops).toBe(0);
    expect(first.metrics.trips.failed).toBe(0);
  });

  test('T53 walkers and their yields are deterministic', () => {
    expect(observe().hashes).toEqual(first.hashes);
    const plain = load(compiled, trips, undefined);
    plain.step(6000);
    expect(plain.stateHash()).not.toBe(first.hashes.at(-1));
  });
});

describe('T53 signals', () => {
  const trips = (city: City) => {
    const [west, south] = Object.values(city.places).filter((p) => p.connectors.length);
    return Array.from({ length: 120 }, (_, i) =>
      trip(`trip:${i}`, west!.id, south!.id, 100 + i * 4),
    );
  };

  function run(
    city: City,
    compiled: CompiledCity,
    walkers: Scenario['walkers'],
    steps: number,
    each?: (engine: Engine, people: WalkerAt[], timeS: number) => void,
  ) {
    const engine = load(compiled, trips(city), walkers);
    let overlap = '';
    for (let step = 0; step < steps; step++) {
      engine.step();
      const people = walkersOf(engine);
      overlap ||= sampleCrossings(engine, compiled) ?? '';
      each?.(engine, people, engine.timeS);
    }
    return { engine, overlap };
  }

  test('T53 a walker starts only on walk green with enough left; a turning car yields to it', () => {
    const { city, centre, left, right } = signalJunction();
    const compiled = setup(city);
    const node = compiled.nodes[compiled.index.node.get(centre)!]!;
    const crossings = crossingLinks(compiled, (link) => link.crossing!.node === node.idx);
    expect(crossings).toHaveLength(4);
    const south = crossings.find((link) => link.line.every((p) => p.y > 3))!;
    const states = new Map<number, string>();
    let starts = 0;
    let turningHeld = 0;
    const exitSpans = south.crossing!.spans;
    const { engine, overlap } = run(
      city,
      compiled,
      [
        { fromPlaceId: left, toPlaceId: right, perHour: 300 },
        { fromPlaceId: right, toPlaceId: left, perHour: 300 },
      ],
      7200,
      (engine, people, timeS) => {
        for (const walker of people) {
          const link = compiled.walk.links[walker.link];
          if (
            walker.state === 'crossing' &&
            states.get(walker.id) === 'waiting' &&
            link?.crossing
          ) {
            starts++;
            const green = walkGreenS(node.signal!, link.idx, timeS - 0.1);
            expect(green).toBeGreaterThanOrEqual(
              link.lengthM / walkSpeedMps + walkClearanceS - 0.2,
            );
          }
          states.set(walker.id, walker.state);
        }
        const onSouth = people.some((w) => w.link === south.idx);
        if (!onSouth) return;
        const snapshot = engine.snapshot();
        for (let i = 0; i < snapshot.count; i++) {
          const field = snapshot.lane[i]!;
          if (snapshot.speed[i]! >= 0.1) continue;
          const car = engine.inspect(snapshot.id[i]!)!;
          const step =
            field >= 0 ? (car.route?.roads.indexOf(compiled.lanes[field]!.road) ?? -1) : -1;
          const movement =
            compiled.movements[field < 0 ? -field - 1 : (car.route?.movements[step - 1] ?? -1)];
          if (
            !movement ||
            (field >= 0 &&
              car.positionM >= DEFAULT_SIM_PARAMS.vehicleClasses[car.vehicleClass].lengthM)
          )
            continue;
          const span = exitSpans.find((s) => s.lane === movement.toLane);
          if (span && movement.turn === 'right') turningHeld++;
        }
      },
    );
    expect(starts).toBeGreaterThan(20);
    expect(turningHeld).toBeGreaterThan(0);
    expect(engine.metrics().walkers!.vehicleStops.signal).toBeGreaterThan(0);
    expect(overlap).toBe('');
    expect(engine.metrics().walkers!.hardStops).toBe(0);
  });

  test('T53 an exclusive pedestrian phase stops every vehicle movement', () => {
    const { city, centre, left, right } = signalJunction((arms) => ({
      offsetS: 0,
      amberS: 3,
      allRedS: 1,
      phases: [
        ...arms.map(([incoming], i) => ({
          durationS: 20,
          groups: arms.flatMap(([, outgoing], j) =>
            i === j ? [] : [{ from: incoming!, to: outgoing! }],
          ),
          walk: [],
        })),
        {
          durationS: 15,
          groups: [],
          walk: arms.map(([incoming]) => ({ roadId: incoming!, end: 'end' as const })),
        },
      ],
    }));
    const compiled = setup(city);
    const node = compiled.nodes[compiled.index.node.get(centre)!]!;
    const signal = node.signal!;
    expect(signal.phases.at(-1)!.movements).toHaveLength(0);
    expect(signal.phases.at(-1)!.walk).toHaveLength(4);
    expect(signal.phases.slice(0, 4).every((phase) => phase.walk.length === 0)).toBe(true);
    const exclusiveStart = signal.phases.slice(0, 4).reduce((s, p) => s + p.durationS + 4, 0);
    let entered = 0;
    let crossedInPhase = 0;
    const lanes = new Map<number, number>();
    const states = new Map<number, string>();
    run(
      city,
      compiled,
      [
        { fromPlaceId: left, toPlaceId: right, perHour: 400 },
        { fromPlaceId: right, toPlaceId: left, perHour: 400 },
      ],
      6000,
      (engine, people, timeS) => {
        const elapsed = (timeS + signal.offsetS) % signal.cycleS;
        const exclusive = elapsed >= exclusiveStart && elapsed < exclusiveStart + 15;
        const snapshot = engine.snapshot();
        for (let i = 0; i < snapshot.count; i++) {
          const id = snapshot.id[i]!;
          const field = snapshot.lane[i]!;
          if (exclusive && field < 0 && (lanes.get(id) ?? 0) >= 0) {
            // A car that crossed the stop line on amber may still be in the junction: only a
            // movement entered from the approach after the exclusive phase began counts.
            if (elapsed > exclusiveStart + 0.15) entered++;
          }
          lanes.set(id, field);
        }
        for (const walker of people) {
          if (walker.state === 'crossing' && states.get(walker.id) === 'waiting' && exclusive)
            crossedInPhase++;
          states.set(walker.id, walker.state);
        }
      },
    );
    expect(entered).toBe(0);
    expect(crossedInPhase).toBeGreaterThan(0);
  });

  test('T53 patches keep phase epochs for walkers too', () => {
    const { city, left, right } = signalJunction();
    const compiled = setup(city);
    const walkers = [{ fromPlaceId: left, toPlaceId: right, perHour: 300 }];
    const plain = load(compiled, trips(city), walkers);
    const patched = load(compiled, trips(city), walkers);
    plain.step(1500);
    patched.step(1500);
    // A recompile that changes nothing keeps every phase, so walkers keep their timing.
    const same = compile({ ...structuredClone(city), version: city.version + 1 });
    if (!same.ok) throw new Error('compile');
    patched.patch(same.compiled);
    plain.step(1500);
    patched.step(1500);
    expect(patched.stateHash()).toBe(plain.stateHash());
    expect(patched.metrics().walkers).toEqual(plain.metrics().walkers);

    // A changed program restarts from the patch time: with walk green on the south arm in its
    // first phase, walkers waiting there step out at once.
    const engine = load(compiled, trips(city), walkers);
    const south = crossingLinks(compiled, (link) => link.line.every((p) => p.y > 3))[0]!;
    let waitingAt = -1;
    for (let step = 0; step < 4000 && waitingAt === -1; step++) {
      engine.step();
      const node = compiled.nodes[south.crossing!.node]!;
      if (walkGreenS(node.signal!, south.idx, engine.timeS) > 0) continue;
      waitingAt = walkersOf(engine).find((w) => w.state === 'waiting')?.id ?? -1;
    }
    expect(waitingAt).toBeGreaterThan(0);
    const edited = structuredClone(city);
    const signal = Object.values(edited.nodes).find((n) => n.signal)!.signal!;
    // The south approach's phase first: walk green on every other arm, the south arm red.
    signal.phases = [signal.phases[1]!, ...signal.phases.filter((_, i) => i !== 1)];
    edited.version++;
    const next = compile(edited);
    if (!next.ok) throw new Error('compile');
    engine.patch(next.compiled);
    engine.step(2);
    expect(engine.inspectWalker(waitingAt)!.state).not.toBe('waiting');
  });

  test('T53 gate 4 at the signal: the safety invariant holds with dense walkers', () => {
    const { city, left, right } = signalJunction();
    const compiled = setup(city);
    const { overlap, engine } = run(
      city,
      compiled,
      [
        { fromPlaceId: left, toPlaceId: right, perHour: 900 },
        { fromPlaceId: right, toPlaceId: left, perHour: 900 },
      ],
      6000,
    );
    expect(overlap).toBe('');
    expect(engine.metrics().zoneStops).toBe(0);
    expect(engine.metrics().trips.failed).toBe(0);
  });
});

test('T53 crossing spans cover both directions of a street; walk groups compile per arm', () => {
  const { city } = signalJunction();
  const compiled = setup(city);
  const node = compiled.nodes.find((n) => n.signal)!;
  const arms = crossingArms(compiled, node);
  for (const link of crossingLinks(compiled, () => true)) {
    const roads = new Set(link.crossing!.spans.map((s) => compiled.lanes[s.lane]!.road));
    expect(roads.size).toBe(2);
    expect(link.crossing!.spans).toHaveLength(4);
    expect(arms[link.crossing!.arm]!.some((e) => e.road.idx === link.crossing!.road)).toBe(true);
  }
});
