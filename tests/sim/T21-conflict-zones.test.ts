import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { junctions } from '../../src/fixtures/junctions';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { importOsm } from '../../src/importers/osm';
import { allocateId, type City, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { patchChanges } from '../../src/sim/patch';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { scenario, setup, trips } from './fixtures';
import { sampleConflictZones } from './conflict-zone-safety';

function opposing() {
  const city = signalApproach();
  // Four-lane arms leave room after crossing the opposing median lane for rear clearance.
  for (const road of Object.values(city.roads)) {
    road.lanes.push({ ...road.lanes[0]! }, { ...road.lanes[0]! });
    road.lateralOffsetM = 6;
  }
  const compiled = setup(city);
  const left = compiled.movements.find((m) => m.turn === 'left')!;
  const through = compiled.movements.find(
    (m) => m.turn === 'through' && left.conflicts.includes(m.idx) && m.toLane !== left.toLane,
  )!;
  compiled.nodes[left.node]!.control = 'uncontrolled';
  compiled.nodes[left.node]!.signal = null;
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  const intersections = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS);
  for (const [id, path] of [left, through, left].entries()) {
    vehicles.state[id] = DRIVING;
    vehicles.movement[id] = path.idx;
    vehicles.insert(
      id,
      path.fromLane,
      compiled.lanes[path.fromLane]!.lengthM - (id === 2 ? 20 : 2),
    );
  }
  const request = (id: number) => {
    intersections.request(id, compiled.movements[vehicles.movement[id]!]!);
    intersections.resolve();
  };
  return { city, compiled, left, through, vehicles, intersections, request };
}

test('T21: an opposing queue is released as the left-turn rear clears its zone', () => {
  const { left, through, vehicles, intersections, request } = opposing();
  const end = left.conflictZones[left.conflicts.indexOf(through.idx)]![1];
  request(0);
  expect(intersections.grants[0]).toBe(left.idx);
  request(1);
  expect(intersections.grants[1]).toBe(-1); // approach reservation
  vehicles.remove(0);
  vehicles.insert(0, -left.idx - 1, end + DEFAULT_SIM_PARAMS.vehicleLengthM - 0.001);
  request(1);
  expect(intersections.grants[1]).toBe(-1); // rear still in contact
  vehicles.position[0] = end + DEFAULT_SIM_PARAMS.vehicleLengthM;
  expect(vehicles.position[0]).toBeLessThan(left.lengthM);
  request(1);
  expect(intersections.grants[1]).toBe(through.idx);
  expect(intersections.grants[0]).toBe(left.idx); // grant persists to movement exit
});

test('T21: a cleared leader cannot hide a following approach grant or movement occupant', () => {
  const { left, through, vehicles, intersections, request } = opposing();
  const end = left.conflictZones[left.conflicts.indexOf(through.idx)]![1];
  request(0);
  request(2);
  vehicles.remove(0);
  vehicles.insert(0, -left.idx - 1, end + DEFAULT_SIM_PARAMS.vehicleLengthM);
  request(1);
  expect(intersections.grants[1]).toBe(-1);
  vehicles.remove(2);
  vehicles.insert(2, -left.idx - 1, 0);
  request(1);
  expect(intersections.grants[1]).toBe(-1);
  vehicles.remove(2);
  intersections.release(2);
  request(1);
  expect(intersections.grants[1]).toBe(through.idx);
});

test.each(['yield', 'stop'] as const)(
  'T21: %s gaps reach the zone start instead of the stop line',
  (control) => {
    const { compiled, left, through, vehicles, intersections, request } = opposing();
    compiled.nodes[left.node]!.control = control;
    left.priority = 1;
    through.priority = 32;
    const start = through.conflictZones[through.conflicts.indexOf(left.idx)]![0];
    expect(start).toBeGreaterThan(0);
    vehicles.speed[1] = 2;
    vehicles.stopped[0] = 1;
    const distance = 2 * DEFAULT_SIM_PARAMS.intersection.gapS - start / 2;
    vehicles.position[1] = compiled.lanes[through.fromLane]!.lengthM - distance;
    expect(distance / vehicles.speed[1]!).toBeLessThan(DEFAULT_SIM_PARAMS.intersection.gapS);
    request(0);
    expect(intersections.grants[0]).toBe(left.idx);
  },
);

// Demand on every legal movement, including junctions in disconnected fixture components.
function movementTrips(city: City): TripRequest[] {
  const compiled = setup(city);
  const places = compiled.lanes.map((lane) => {
    const id = allocateId(city, 'p');
    city.places[id] = {
      id,
      name: lane.id,
      kind: 'gateway',
      shape: { kind: 'point', pos: lane.polyline[0]! },
      population: 0,
      jobs: 0,
      attraction: 1,
      capacity: null,
      profile: null,
      events: [],
      provenance: { source: 'generated' },
      connectors: ['out', 'in'].map((direction) => ({
        id: allocateId(city, 'c'),
        roadId: compiled.roads[lane.road]!.id,
        lane: lane.lane,
        positionM:
          direction === 'out' ? Math.max(5, lane.lengthM - 40) : Math.min(30, lane.lengthM - 5),
        direction: direction as 'in' | 'out',
        throughputPerMin: 120,
      })),
    };
    return id;
  });
  return compiled.movements
    .filter((m) => !m.neverGreen)
    .flatMap((path) =>
      Array.from({ length: 4 }, (_, i) => ({
        id: `${path.id}:${i}`,
        personId: null,
        originPlaceId: places[path.fromLane]!,
        destinationPlaceId: places[path.toLane]!,
        departS: 100 + i * 3,
        mode: 'car' as const,
        legs: [],
      })),
    );
}

test('T21: a live patch uses replacement zones while preserving a movement occupant', () => {
  const { city, left, through } = opposing();
  for (const node of Object.values(city.nodes)) {
    node.control = 'uncontrolled';
    node.signal = null;
  }
  const all = movementTrips(city);
  const requests = [
    all.find((trip) => trip.id === `${left.id}:0`)!,
    { ...all.find((trip) => trip.id === `${through.id}:0`)!, departS: 102 },
  ];
  const next = setup(city);
  const before = setup(city);
  for (const movement of before.movements) {
    movement.conflictZones = movement.conflicts.map(() => [0, movement.lengthM]);
  }
  const engines = [createEngine(), createEngine(), createEngine()];
  engines.forEach((engine, i) =>
    engine.load({ compiled: i === 2 ? next : before, trips: requests, scenario: scenario() }),
  );
  let patched = false;
  for (let step = 0; step < 1000; step++) {
    engines.forEach((engine) => engine.step());
    if (!patched && engines[0]!.inspect(1)?.lane === -left.idx - 1) {
      const car = engines[0]!.inspect(1)!;
      expect(engines[0]!.patch(next).stranded).toBe(0);
      expect(engines[0]!.inspect(1)).toMatchObject({
        lane: car.lane,
        positionM: car.positionM,
        speedMps: car.speedMps,
      });
      patched = true;
    }
    sampleConflictZones(engines[0]!, next);
    expect(engines[0]!.stateHash()).toBe(engines[2]!.stateHash());
  }
  expect(patched).toBe(true);
  expect(engines[0]!.metrics().trips.completed).toBe(2);
  expect(engines[0]!.inspect(2)!.arrivedS).toBeLessThan(engines[1]!.inspect(2)!.arrivedS!);
});

test('T21: expanding a conflict zone invalidates approach grants at the patched node', () => {
  const { city, left, through } = opposing();
  const before = setup(city);
  const after = setup(city);
  const path = after.movements[left.idx]!;
  path.conflictZones[path.conflicts.indexOf(through.idx)]![1] = path.lengthM;
  expect(patchChanges(before, after).changedNodes).toEqual(new Set([path.node]));
});

test('T21: a zone expansion makes an already granted opposing approach brake again', () => {
  const { city, left, through } = opposing();
  for (const node of Object.values(city.nodes)) {
    node.control = 'uncontrolled';
    node.signal = null;
  }
  const all = movementTrips(city);
  const requests = [
    all.find((trip) => trip.id === `${left.id}:0`)!,
    { ...all.find((trip) => trip.id === `${through.id}:0`)!, departS: 102 },
  ];
  const before = setup(city);
  const after = setup(city);
  const path = after.movements[left.idx]!;
  const zone = path.conflictZones[path.conflicts.indexOf(through.idx)]!;
  const clear = zone[1] + DEFAULT_SIM_PARAMS.vehicleLengthM;
  zone[1] = path.lengthM;
  const engines = [createEngine(), createEngine()];
  engines.forEach((engine) =>
    engine.load({ compiled: before, trips: requests, scenario: scenario() }),
  );
  let checked = false;
  for (let step = 0; step < 400; step++) {
    engines.forEach((engine) => engine.step());
    const car = engines[0]!.inspect(1)!;
    if (car.lane !== -left.idx - 1 || car.positionM < clear) continue;
    engines.forEach((engine) => engine.step()); // grant the opposing approach with the old zone
    expect(engines[0]!.inspect(2)!.lane).toBe(through.fromLane);
    expect(engines[0]!.inspect(1)!.lane).toBe(-left.idx - 1);
    engines[0]!.patch(after);
    engines.forEach((engine) => engine.step());
    expect(engines[0]!.inspect(2)!.speedMps).toBeLessThan(engines[1]!.inspect(2)!.speedMps);
    sampleConflictZones(engines[0]!, after);
    checked = true;
    break;
  }
  expect(checked).toBe(true);
});

test.each([
  ['four-way signal', signalApproach],
  ['junction fixture', junctions],
] as const)('T21: %s has no contacting-zone overlap at any step of the whole run', (_, fixture) => {
  const city = fixture();
  const requests = movementTrips(city);
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({ compiled, trips: requests, scenario: { ...scenario(), endS: 700 } });
  let contacts = 0;
  for (let step = 0; step < 6000; step++) {
    engine.step();
    contacts += sampleConflictZones(engine, compiled);
  }
  expect(contacts).toBeGreaterThan(0);
  expect(engine.metrics().trips.completed).toBe(requests.length);
  expect(engine.metrics().trips.failed).toBe(0);
});

test('T21: grid has no contacting-zone overlap at any step of two hours', () => {
  const city = grid5x5();
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({ compiled, trips: trips(city, 300, 1), scenario: scenario() });
  let contacts = 0;
  for (let step = 0; step < 72000; step++) {
    engine.step();
    contacts += sampleConflictZones(engine, compiled);
  }
  expect(contacts).toBeGreaterThan(0);
  expect(engine.metrics().trips.completed).toBe(300);
  expect(engine.metrics().trips.failed).toBe(0);
});

test('T21: Munich at scale 0.15 has no contacting-zone overlap at any morning step', () => {
  const imported = importOsm(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
    importerVersion: '1',
    drivingSide: 'right',
    bbox: [11.525, 48.135, 11.545, 48.148],
  });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const { city } = imported;
  const compiled = setup(city);
  const morning = defaultScenario('grid5x5');
  morning.startS = 7 * 3600;
  morning.endS = 10 * 3600;
  morning.demand.personsPerResident = 0.15;
  const requests = scheduleTrips(city, generatePopulation(city, morning.demand), morning);
  const engine = createEngine();
  engine.load({ compiled, trips: requests, scenario: morning });
  let contacts = 0;
  for (let step = 0; step < 108000; step++) {
    engine.step();
    contacts += sampleConflictZones(engine, compiled);
  }
  expect(contacts).toBeGreaterThan(0);
  expect(engine.timeS).toBe(10 * 3600);
  expect(engine.metrics().trips.failed).toBe(0);
}, 300000);
