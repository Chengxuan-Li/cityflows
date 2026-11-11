import { expect, test as citiesTest } from 'vitest';
import { auditCities, compileAuditCity } from '../../bench/junction-audit';
import { workload } from '../../bench/workloads';
import { compile } from '../../src/network';
import { crossingPlacement, crossingSpan, servedSignal } from '../../src/network/crossings';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { crossingStripes } from '../../src/render/layers/roads';
import { scenario, setup, trips } from './fixtures';
import { opposing } from './zone-fixtures';
import { sampleConflictZones } from './conflict-zone-safety';
import { populateStops } from '../../src/network/stops';
import { tierCities, unitTest as test } from '../tier';

test('T26: entry requests begin at stopM and a coarse red step clamps before it', () => {
  for (const distance of [15, 3]) {
    const city = signalApproach();
    const compiled = setup(city);
    const origin = compiled.connectors.find((c) => c.direction === 'out')!;
    const lane = compiled.lanes[origin.lane]!;
    compiled.places[origin.place]!.connectorsOut = [origin.idx];
    origin.positionM = lane.stopM - distance;
    const decisions: string[] = [];
    const engine = createEngine();
    engine.load({
      compiled,
      scenario: { ...scenario(), startS: 29 },
      trips: trips(city, 1).map((t) => ({ ...t, departS: 29 })),
      params: {
        dtS: 4,
        idm: { ...DEFAULT_SIM_PARAMS.idm, aMps2: 100, bMps2: 1e6, desiredSpeedSd: 0 },
      },
      intersectionObserver: (_id, _movement, reason) => decisions.push(reason),
    });
    engine.step();
    expect(decisions).toContain('signal');
    expect(engine.inspect(1)).toMatchObject({ lane: lane.idx, positionM: lane.stopM - 2 });
  }
});

test('T26: a red queue stands before the crossing and drives the remaining road on green', () => {
  const city = signalApproach();
  const compiled = setup(city);
  const origin = compiled.connectors.find((c) => c.direction === 'out')!;
  const lane = compiled.lanes[origin.lane]!;
  // TASK-094: the stop line lies 0.5 m short of the set-back crossing's far edge.
  const span = crossingSpan(compiled, lane, true)!;
  expect(span.nearM - span.farM).toBeCloseTo(2.5, 9);
  expect(lane.stopM).toBe(span.farM - 0.5);
  expect(lane.lengthM - lane.stopM).toBeGreaterThan(3);
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: { ...scenario(), startS: 29 },
    trips: trips(city, 4, 0.5).map((t) => ({ ...t, departS: t.departS - 71 })),
  });
  engine.step(600);
  const queue = [...engine.snapshot().id].map((id) => engine.inspect(id)!);
  expect(queue).toHaveLength(4);
  for (const car of queue) {
    const approach = compiled.lanes[car.lane]!;
    expect(car.speedMps).toBe(0);
    expect(car.positionM).toBeLessThanOrEqual(approach.stopM - 2 + 1e-6);
    expect(car.positionM).toBeLessThanOrEqual(span.farM - 0.5);
  }
  const front = Math.max(...queue.map((car) => car.positionM));
  expect(front).toBeCloseTo(lane.stopM - DEFAULT_SIM_PARAMS.idm.minGapM, 0);
  let traversed = false;
  for (let step = 0; step < 1500; step++) {
    engine.step();
    sampleConflictZones(engine, compiled);
    const car = engine.inspect(1)!;
    if (car.lane === lane.idx && car.positionM > lane.stopM) traversed = true;
  }
  expect(traversed).toBe(true);
  expect(engine.metrics().trips).toMatchObject({ completed: 4, failed: 0 });
});

test.each(['yield', 'stop'] as const)(
  'T26: %s gaps use the major stop position plus its conflict-zone offset',
  (control) => {
    const { compiled, left, through, vehicles, request, intersections } = opposing();
    compiled.nodes[left.node]!.control = control;
    left.priority = 1;
    through.priority = 32;
    vehicles.stopped[0] = 1;
    vehicles.speed[1] = 2;
    const lane = compiled.lanes[through.fromLane]!;
    const start = through.conflictZones[through.conflicts.indexOf(left.idx)]![0];
    lane.stopM = lane.lengthM - 3;
    vehicles.position[1] = lane.stopM + start - 2 * DEFAULT_SIM_PARAMS.intersection.gapS + 0.1;
    request(0);
    expect(intersections.grants[0]).toBe(-1);
    vehicles.position[1] -= 0.2;
    request(0);
    expect(intersections.grants[0]).toBe(left.idx);
  },
);

test('T26: stop signs without crossings retain lane-end stops and the one-second rule', () => {
  const city = signalApproach();
  const junction = Object.values(city.nodes).find((node) => node.signal)!;
  junction.control = 'stop';
  junction.signal = null;
  junction.minorRoads = Object.values(city.roads)
    .filter((r) => r.to === junction.id)
    .map((r) => r.id);
  const compiled = setup(city);
  for (const lane of compiled.lanes) expect(lane.stopM).toBe(lane.lengthM);
  const engine = createEngine();
  engine.load({ compiled, trips: trips(city, 1), scenario: scenario() });
  let stationary = 0;
  let entered = false;
  for (let step = 0; step < 1000; step++) {
    engine.step();
    const car = engine.inspect(1)!;
    if (car.lane < 0) {
      entered = true;
      break;
    }
    if (car.speedMps === 0) stationary += 0.1;
  }
  expect(entered).toBe(true);
  expect(stationary).toBeGreaterThanOrEqual(1 - 1e-9);
});

test('T26: a served outer lane sets the stop position across the approach; without a crossing TASK-072 holds', () => {
  const city = signalApproach();
  const compiled = setup(city);
  const node = compiled.nodes.find((n) => n.signal)!;
  const road = compiled.roads.find((r) => r.to === node.idx)!;
  const [inner, outer] = road.lanes.map((i) => compiled.lanes[i]!);
  for (const i of inner!.out) compiled.movements[i]!.neverGreen = true;
  populateStops(compiled);
  for (const lane of [inner!, outer!])
    expect(lane.stopM).toBe(crossingSpan(compiled, lane, true)!.farM - 0.5);
  // The stop line may not move into the first half of a lane: there the end draws no crossing.
  const { farM } = crossingPlacement(compiled, road, true);
  outer!.lengthM = 2 * (farM + 0.5) + 0.01;
  populateStops(compiled);
  expect(outer!.stopM).toBeCloseTo(outer!.lengthM - farM - 0.5, 9);
  outer!.lengthM = 2 * (farM + 0.5) - 0.01;
  populateStops(compiled);
  expect(crossingStripes(compiled, road, true)).toEqual([]);
  expect(outer!.stopM).toBe(outer!.lengthM - 3);
  expect(inner!.stopM).toBe(inner!.lengthM - 3);
  outer!.lengthM = 9.99;
  populateStops(compiled);
  expect(outer!.stopM).toBe(9.99);
  outer!.lengthM = 100;
  // A crossing turned off: TASK-072's stop.
  const off = { ...city.roads[road.id]!, crossings: { end: false } };
  populateStops(compiled, { roads: { ...city.roads, [road.id]: off } });
  expect(outer!.stopM).toBe(97);
  const edited = compile({ ...city, roads: { ...city.roads, [road.id]: off } });
  if (!edited.ok) throw new Error('compile');
  const lane = edited.compiled.lanes[edited.compiled.index.lane.get(outer!.id)!]!;
  expect(lane.stopM).toBe(lane.lengthM - 3);
  for (const i of outer!.out) compiled.movements[i]!.neverGreen = true;
  populateStops(compiled);
  expect(inner!.stopM).toBe(inner!.lengthM);
});

citiesTest.each(tierCities(auditCities))(
  'T26: on %s every signalized approach with a crossing stops 0.5 m short of its far edge',
  (name) => {
    const city = compileAuditCity(name);
    const counts = { lanes: 0, crossing: 0, fallback: 0 };
    for (const lane of city.lanes) {
      const road = city.roads[lane.road]!;
      // TASK-131: a junction group's inner road carries no control, so its lanes stop at their
      // end even where the next member is signalized (no stop line on an inner link).
      if (road.group !== undefined || !servedSignal(city, road)) {
        expect(lane.stopM).toBe(lane.lengthM);
        continue;
      }
      counts.lanes++;
      const span = crossingSpan(city, lane, true);
      if (!span) {
        counts.fallback++;
        expect(crossingStripes(city, road, true)).toEqual([]);
        expect(lane.stopM).toBe(lane.lengthM - (lane.lengthM >= 10 ? 3 : 0));
        continue;
      }
      counts.crossing++;
      expect(lane.stopM).toBe(span.farM - 0.5);
      expect(lane.stopM).toBeGreaterThanOrEqual(lane.lengthM / 2);
      expect(span.farM).toBeLessThan(span.nearM);
    }
    console.info('T26 stops', name, counts);
    expect(counts.crossing).toBeGreaterThan(0);
  },
  120_000,
);

// A car that passed the stop line on a grant and loses it at red (the grant release, unchanged by
// TASK-094) stands where it is, between the stop line and the junction: in the town's 07:00 to
// 10:00, 7 cars on main (at most 2.1 m past the stop line), 18 with the stop line behind the
// crossing (at most 14.8 m). Every other car held at red stands before the crossing.
test('T26: on the town, cars held at red stand at least 0.5 m short of the crossing', () => {
  const { city, scenario: run, trips: requests } = workload('town');
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const { compiled } = result;
  run.endS = run.startS + 1800;
  const refused = new Set<number>();
  // The lane each car last got a grant from: refused there again, it lost the grant.
  const grantedFrom = new Map<number, number>();
  const engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: run,
    intersectionObserver: (id, movement, reason) => {
      if (reason === 'signal') refused.add(id + 1);
      if (reason === 'granted') grantedFrom.set(id + 1, movement.fromLane);
    },
  });
  let held = 0;
  const released = new Set<number>();
  while (engine.timeS < run.endS) {
    refused.clear();
    engine.step();
    for (const id of refused) {
      const car = engine.inspect(id)!;
      if (car.lane < 0 || car.speedMps > 0) continue;
      const lane = compiled.lanes[car.lane]!;
      const span = crossingSpan(compiled, lane, true);
      if (!span) continue;
      const clamp = lane.stopM - DEFAULT_SIM_PARAMS.idm.minGapM;
      if (grantedFrom.get(id) === lane.idx && car.positionM > clamp + 1e-6) {
        released.add(id);
        continue;
      }
      held++;
      expect(car.positionM).toBeLessThanOrEqual(clamp + 1e-6);
      expect(car.positionM).toBeLessThanOrEqual(span.farM - 0.5);
    }
  }
  console.info('T26 town held at red', { held, released: released.size });
  expect(held).toBeGreaterThan(1000);
});
