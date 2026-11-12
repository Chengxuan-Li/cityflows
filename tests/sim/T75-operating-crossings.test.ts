import { expect, test } from 'vitest';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { createEngine } from '../../src/sim/engine';
import { createRailCrossings, CROSSING_OPEN, CROSSING_CLOSED } from '../../src/sim/rail-crossings';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { trainTimetable } from '../../src/network/trains';
import { setup, trips } from './fixtures';

test('T75 a car brakes at the painted line, waits for the last carriage, and resumes', () => {
  const city = operatingCrossing();
  const compiled = setup(city);
  const engine = createEngine();
  const trip = trips(city, 1)[0]!;
  trip.departS = 145;
  engine.load({
    compiled,
    trips: [trip],
    scenario: { ...defaultScenario('grid5x5'), startS: 140, endS: 250 },
  });
  let stopped = 0,
    largestDeceleration = 0;
  let previousSpeed = 0;
  const line = compiled.rail!.facilities![0]!.stops![0]!.stopM;
  for (let i = 0; i < 1100; i++) {
    engine.step();
    const car = engine.inspect(1)!;
    const rail = engine.snapshot().rail!;
    if (car?.state === 'driving') {
      largestDeceleration = Math.max(largestDeceleration, (previousSpeed - car.speedMps) / 0.1);
      previousSpeed = car.speedMps;
      if (car.speedMps < 0.1 && Math.abs(car.positionM - line) < 0.2) {
        stopped++;
        expect(rail.crossings[0]).toBe(CROSSING_CLOSED);
      }
      if (rail.crossings[0] !== CROSSING_OPEN && car.positionM < line + 1)
        expect(car.positionM).toBeLessThanOrEqual(line + 1e-6);
    }
  }
  expect(stopped).toBeGreaterThan(100);
  expect(engine.inspect(1)!.state).toBe('completed');
  expect(largestDeceleration).toBeLessThan(3);
});

test('T75 a stranded long vehicle holds the service before its nose enters, then its rear clears', () => {
  const compiled = setup(operatingCrossing());
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.vclass[0] = 2;
  const facility = compiled.rail!.facilities![0]!;
  const span = facility.spans!.find((s) => s.segment >= 0)!;
  vehicles.insert(0, span.segment, span.toM + 6);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 140, () => false)!;
  for (let i = 0; i < 800; i++) control.step(140 + i * 0.1);
  let snapshot = control.snapshot();
  expect(snapshot.crossings[0]).toBe(CROSSING_CLOSED);
  expect(snapshot.railReady[0]).toBe(0);
  expect(snapshot.trains).toHaveLength(1);
  expect(snapshot.trains[0]!.speedMps).toBe(0);
  expect(snapshot.trains[0]!.positionM + 100).toBeLessThan(997.5);
  vehicles.position[0] = span.toM + 12 + 1;
  for (let i = 0; i < 400; i++) control.step(220 + i * 0.1);
  snapshot = control.snapshot();
  expect(snapshot.crossings[0]).toBe(CROSSING_OPEN);
  expect(snapshot.trains[0]!.positionM).toBeGreaterThan(1102.5);
});

test('T75 an open crossing refuses a car without storage beyond all tracks', () => {
  const compiled = setup(operatingCrossing());
  const facility = compiled.rail!.facilities![0]!;
  const stop = facility.stops![0]!;
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.insert(0, stop.lane, stop.stopM - 10);
  vehicles.insert(1, stop.lane, stop.stopM + 14);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 140, () => false)!;
  expect(control.snapshot().crossings[0]).toBe(CROSSING_OPEN);
  expect(control.hold(0)).toBe(stop.stopM);
  vehicles.position[1] = vehicles.position[1]! + 30;
  expect(control.hold(0)).toBe(Infinity);
});

test('T75 a fast car in the warning dilemma zone clears with bounded braking', () => {
  const city = operatingCrossing(),
    compiled = setup(city),
    engine = createEngine();
  const trip = trips(city, 1)[0]!;
  trip.departS = 130;
  engine.load({
    compiled,
    trips: [trip],
    scenario: { ...defaultScenario('grid5x5'), startS: 125, endS: 250 },
  });
  let previousSpeed = 0,
    deceleration = 0,
    passedProtected = false;
  const stop = compiled.rail!.facilities![0]!.stops![0]!.stopM;
  for (let i = 0; i < 1250; i++) {
    engine.step();
    const car = engine.inspect(1);
    if (!car || car.state !== 'driving') continue;
    deceleration = Math.max(deceleration, (previousSpeed - car.speedMps) / 0.1);
    previousSpeed = car.speedMps;
    if (
      engine.snapshot().rail!.crossings[0] !== CROSSING_OPEN &&
      car.positionM > stop &&
      car.positionM < stop + 20
    )
      passedProtected = true;
  }
  expect(passedProtected).toBe(true);
  expect(deceleration).toBeLessThan(3);
  expect(engine.inspect(1)!.state).toBe('completed');
});

test('T75 release retains a downstream road red, including clearance over a junction movement', () => {
  const { city, node, road, place } = buildCity('Signal beyond crossing', 136);
  const start = node(-400, 0),
    signal = node(10, 0),
    end = node(400, 0);
  const approach = road(start, signal),
    exit = road(signal, end);
  approach.provenance = { source: 'generated', osmIds: [10] };
  place('Homes', 'residential', { x: -380, y: 15 }, [
    { road: approach, direction: 'out', positionM: 20 },
  ]);
  place('Work', 'work', { x: 380, y: 15 }, [{ road: exit, direction: 'in', positionM: 370 }]);
  city.rail = operatingCrossing().rail;
  signal.control = 'signal';
  signal.signal = {
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 230, groups: [] },
      { durationS: 30, groups: [{ from: approach.id, to: exit.id }] },
    ],
  };
  const compiled = setup(city),
    engine = createEngine();
  const trip = trips(city, 1)[0]!;
  trip.departS = 145;
  engine.load({
    compiled,
    trips: [trip],
    scenario: { ...defaultScenario('grid5x5'), startS: 140, endS: 320 },
  });
  engine.step(800);
  expect(engine.snapshot().rail!.crossings[0]).toBe(CROSSING_OPEN);
  expect(engine.inspect(1)!.positionM).toBeLessThanOrEqual(
    compiled.rail!.facilities![0]!.stops![0]!.stopM + 1e-6,
  );
  engine.step(1000);
  expect(engine.inspect(1)!.state).toBe('completed');
});

test('T75 restart is deterministic and an unserved facility has exact road-state parity', () => {
  const city = operatingCrossing();
  // No boundary-to-boundary service after the mapped exit becomes a buffer with a binding direction.
  city.rail!.nodes['rn:3']!.kind = 'buffer_stop';
  const compiled = setup(city);
  expect(trainTimetable(compiled.rail!).routes).toHaveLength(0);
  const ordinary = structuredClone(city);
  delete ordinary.rail;
  const a = createEngine(),
    b = createEngine();
  const input = {
    trips: trips(city, 10, 1),
    scenario: { ...defaultScenario('grid5x5'), startS: 100, endS: 250 },
  };
  a.load({ ...input, compiled });
  b.load({ ...input, compiled: setup(ordinary) });
  for (let i = 0; i < 15; i++) {
    a.step(100);
    b.step(100);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.snapshot().rail!.crossings[0]).toBe(CROSSING_OPEN);
  }
  const hash = a.stateHash();
  a.load({ ...input, compiled });
  a.step(1500);
  expect(a.stateHash()).toBe(hash);
});
