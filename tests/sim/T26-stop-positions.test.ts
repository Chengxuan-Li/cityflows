import { expect, test } from 'vitest';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { scenario, setup, trips } from './fixtures';
import { opposing } from './zone-fixtures';
import { sampleConflictZones } from './conflict-zone-safety';
import { populateStops } from '../../src/network/stops';

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
  expect(lane.stopM).toBe(lane.lengthM - 3);
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

test('T26: a served outer lane sets the stop position across the approach, but short lanes get no crossing', () => {
  const compiled = setup(signalApproach());
  const node = compiled.nodes.find((n) => n.signal)!;
  const road = compiled.roads.find((r) => r.to === node.idx)!;
  const [inner, outer] = road.lanes.map((i) => compiled.lanes[i]!);
  for (const i of inner!.out) compiled.movements[i]!.neverGreen = true;
  populateStops(compiled);
  expect(inner!.stopM).toBe(inner!.lengthM - 3);
  expect(outer!.stopM).toBe(outer!.lengthM - 3);
  outer!.lengthM = 10;
  populateStops(compiled);
  expect(outer!.stopM).toBe(7);
  outer!.lengthM = 9.99;
  populateStops(compiled);
  expect(outer!.stopM).toBe(9.99);
  for (const i of outer!.out) compiled.movements[i]!.neverGreen = true;
  populateStops(compiled);
  expect(inner!.stopM).toBe(inner!.lengthM);
});
