import { describe, expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { walkGreenS, type CompiledCity, type CrossingSpan } from '../../src/network';
import type { City, Scenario, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { sampleCrossings } from './crossing-safety';
import { scenario as baseScenario, setup } from './fixtures';

// TASK-165: a crosswalk is never entered by a walker while a vehicle body stands on it, and a car
// is not admitted into a movement whose exit lane cannot store its whole body beyond the exit-side
// crosswalk. A lane change does not land a body on a span a walker holds (the Munich n:251 case).

const { walkSpeedMps, walkClearanceS } = DEFAULT_SIM_PARAMS;
const carLengthM = DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM;
type Engine = ReturnType<typeof createEngine>;

const trip = (id: string, from: string, to: string, departS: number): TripRequest => ({
  id,
  personId: null,
  originPlaceId: from,
  destinationPlaceId: to,
  departS,
  mode: 'car',
  vehicleClass: 'car',
  purpose: 'private',
  legs: [],
});

function walkPlace(city: City, name: string, pos: { x: number; y: number }) {
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

/** T53's four-way signal of two-lane arms: cars from the west turn right into the south arm and
 * stop at a slow destination connector `arrivalM` into it; walkers cross the south arm. */
function signalExit(arrivalM: number) {
  const { city, node, street, place, signal } = buildCity('Crosswalk clearance', 1);
  const centre = node(0, 0);
  const arms = [node(-150, 0), node(150, 0), node(0, -150), node(0, 150)].map((end) =>
    street(end, centre, 2),
  );
  signal(centre, arms);
  const [westIn] = arms[0]!;
  const [, southOut] = arms[3]!;
  place('West', 'residential', { x: -140, y: 15 }, [{ road: westIn, direction: 'out', lane: 1 }]);
  place('South', 'work', { x: 15, y: 140 }, [
    { road: southOut, direction: 'in', lane: 1, positionM: arrivalM },
  ]);
  const [west, south] = Object.values(city.places);
  // One arrival per two minutes: the next car queues at the connector.
  south!.connectors[0]!.throughputPerMin = 0.5;
  const left = walkPlace(city, 'South-west corner', { x: -16, y: 22 });
  const right = walkPlace(city, 'South-east corner', { x: 16, y: 22 });
  const compiled = setup(city);
  const exitRoad = compiled.index.road.get(southOut.id)!;
  const crossing = compiled.walk.links.find((link) =>
    link.crossing?.spans.some((span) => compiled.lanes[span.lane]!.road === exitRoad),
  )!;
  const exitSpans = crossing.crossing!.spans.filter(
    (span) => compiled.lanes[span.lane]!.road === exitRoad,
  );
  const approach = compiled.lanes[compiled.roads[compiled.index.road.get(westIn.id)!]!.lanes[1]!]!;
  return { compiled, crossing, exitSpans, approach, west: west!.id, south: south!.id, left, right };
}

interface Body {
  id: number;
  lane: number;
  front: number;
  speed: number;
}

function bodies(engine: Engine, compiled: CompiledCity): Body[] {
  const snapshot = engine.snapshot();
  const result: Body[] = [];
  for (let i = 0; i < snapshot.count; i++) {
    const id = snapshot.id[i]!;
    const field = snapshot.lane[i]!;
    const { positionM, speedMps: speed } = engine.inspect(id)!;
    if (field >= 0) result.push({ id, lane: field, front: positionM, speed });
    else {
      const movement = compiled.movements[-field - 1]!;
      const from = compiled.lanes[movement.fromLane]!;
      result.push({ id, lane: from.idx, front: from.lengthM + positionM, speed });
      result.push({ id, lane: movement.toLane, front: positionM - movement.lengthM, speed });
    }
  }
  return result;
}

const over = (body: Body, spans: CrossingSpan[]) =>
  spans.some(
    (span) =>
      span.lane === body.lane &&
      body.front > span.atM - span.halfM &&
      body.front - carLengthM < span.atM + span.halfM,
  );

function load(compiled: CompiledCity, trips: TripRequest[], walkers: Scenario['walkers']) {
  const engine = createEngine();
  engine.load({ compiled, trips, scenario: { ...baseScenario(1), walkers } });
  return engine;
}

describe('T53 crosswalk clearance at a signal exit', () => {
  test('T53 a walker waits while a queued car stands on the crosswalk, then crosses', () => {
    // The connector stands just past the stripes, so a car queued there covers them: it got there
    // with an empty exit lane, and only the slow connector holds it.
    const fixture = signalExit(0);
    const { exitSpans } = fixture;
    const hi = Math.max(...exitSpans.map((s) => s.atM + s.halfM));
    const { compiled, crossing, west, south, left, right } = signalExit(hi + 1.5);
    const trips = Array.from({ length: 4 }, (_, i) => trip(`trip:${i}`, west, south, 100 + i * 5));
    const engine = load(compiled, trips, [{ fromPlaceId: left, toPlaceId: right, perHour: 360 }]);
    const signal = compiled.nodes[crossing.crossing!.node]!.signal!;
    const enoughGreenS = crossing.lengthM / walkSpeedMps + walkClearanceS;
    const states = new Map<number, string>();
    const waitedOnCar = new Set<number>();
    let occupied = false;
    let crossedAfter = 0;
    let occupiedSteps = 0;
    for (let step = 0; step < 6000; step++) {
      const wasOccupied = occupied;
      engine.step();
      expect(sampleCrossings(engine, compiled)).toBeNull();
      occupied = bodies(engine, compiled).some((body) => over(body, crossing.crossing!.spans));
      if (occupied) occupiedSteps++;
      const walkers = engine.snapshot().walkers!;
      for (const id of walkers.id) {
        const walker = engine.inspectWalker(id)!;
        const before = states.get(id);
        states.set(id, walker.state);
        if (walker.link !== crossing.idx) continue;
        if (
          walker.state === 'waiting' &&
          occupied &&
          walkGreenS(signal, crossing.idx, engine.timeS) >= enoughGreenS
        )
          waitedOnCar.add(id);
        if (before === 'waiting' && walker.state === 'crossing') {
          // A walker steps out on what it saw at the start of the step.
          expect(wasOccupied, `walker ${id} stepped onto an occupied crosswalk`).toBe(false);
          if (waitedOnCar.has(id)) crossedAfter++;
        }
      }
    }
    expect(occupiedSteps).toBeGreaterThan(300);
    expect(waitedOnCar.size).toBeGreaterThan(0);
    expect(crossedAfter).toBeGreaterThan(0);
    expect(engine.metrics().trips.completed).toBe(trips.length);
  });

  test('T53 a car is not admitted while the exit cannot store it beyond the crosswalk', () => {
    // A car queued at the connector leaves 6.5 m (a car and its gap) before its rear, but not
    // beyond the stripes: the next car waits at its stop line instead of on the crosswalk.
    const probe = signalExit(0);
    const hi = Math.max(...probe.exitSpans.map((s) => s.atM + s.halfM));
    const { compiled, exitSpans, approach, west, south } = signalExit(hi + 2 * carLengthM + 1);
    const trips = Array.from({ length: 4 }, (_, i) => trip(`trip:${i}`, west, south, 100 + i * 5));
    const engine = load(compiled, trips, undefined);
    let onCrosswalk = 0;
    let heldAtStopLine = 0;
    for (let step = 0; step < 6000; step++) {
      engine.step();
      for (const body of bodies(engine, compiled)) {
        if (body.speed < 0.1 && over(body, exitSpans)) onCrosswalk++;
        if (
          body.lane === approach.idx &&
          body.speed < 0.1 &&
          approach.stopM - body.front < DEFAULT_SIM_PARAMS.idm.minGapM + 0.5
        )
          heldAtStopLine++;
      }
    }
    expect(onCrosswalk).toBe(0);
    expect(heldAtStopLine).toBeGreaterThan(0);
    expect(engine.metrics().trips.completed).toBe(trips.length);
  });
});

/** A four-way signal of two-lane arms. Cars come from the west on the right lane and need the
 * left lane for an arrival 40 m into the east arm, so they change lanes over and just past its
 * crosswalk, which slow walkers cross both ways on their green. */
function signalLaneChange() {
  const { city, node, street, place, signal } = buildCity('Lane change at a crosswalk', 1);
  const centre = node(0, 0);
  const [westIn, westOut] = street(node(-300, 0), centre, 2);
  const [eastOut, eastIn] = street(centre, node(300, 0), 2);
  signal(centre, [
    [westIn, westOut],
    [eastIn, eastOut],
    street(node(0, -150), centre, 2),
    street(node(0, 150), centre, 2),
  ]);
  place('West homes', 'residential', { x: -290, y: 10 }, [
    { road: westIn, direction: 'out', lane: 1 },
  ]);
  place('East offices', 'work', { x: 290, y: 10 }, [
    { road: eastOut, direction: 'in', lane: 0, positionM: 40 },
  ]);
  const [homes, offices] = Object.keys(city.places);
  const north = walkPlace(city, 'North bank', { x: 26, y: -20 });
  const south = walkPlace(city, 'South bank', { x: 26, y: 20 });
  return { compiled: setup(city), homes: homes!, offices: offices!, north, south };
}

test('T53 a lane change does not land a body on a crosswalk span a walker holds', () => {
  const { compiled, homes, offices, north, south } = signalLaneChange();
  const trips = Array.from({ length: 240 }, (_, i) =>
    trip(`trip:${i}`, homes, offices, 100 + i * 2.5),
  );
  const engine = createEngine();
  engine.load({
    compiled,
    trips,
    // Slow walkers stay in a lane's band long enough for a car released behind them to reach it.
    params: { walkSpeedMps: 0.6 },
    scenario: {
      ...baseScenario(1),
      walkers: [
        { fromPlaceId: north, toPlaceId: south, perHour: 600 },
        { fromPlaceId: south, toPlaceId: north, perHour: 600 },
      ],
    },
  });
  let overlap: string | null = null;
  for (let step = 0; step < 12000 && !overlap; step++) {
    engine.step();
    overlap = sampleCrossings(engine, compiled);
  }
  expect(overlap).toBeNull();
  expect(engine.metrics().trips.completed).toBeGreaterThan(50);
});
