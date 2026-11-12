import { expect, test } from 'vitest';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { createEngine } from '../../src/sim/engine';
import { createRailCrossings, CROSSING_OPEN, CROSSING_CLOSED } from '../../src/sim/rail-crossings';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { railTimetable } from '../../src/network/trams';
import { patchChanges } from '../../src/sim/patch';
import { setup, trips } from './fixtures';

test.each(['rail', 'tram'] as const)(
  'T75 a car brakes at the painted line for %s, waits for the last carriage, and resumes',
  (kind) => {
    const city = operatingCrossing(kind);
    const compiled = setup(city);
    const engine = createEngine();
    const trip = trips(city, 1)[0]!;
    trip.departS = kind === 'rail' ? 145 : 82;
    engine.load({
      compiled,
      trips: [trip],
      scenario: { ...defaultScenario('grid5x5'), startS: kind === 'rail' ? 140 : 80, endS: 250 },
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
    expect(stopped).toBeGreaterThan(kind === 'rail' ? 100 : 20);
    expect(engine.inspect(1)!.state).toBe('completed');
    expect(largestDeceleration).toBeLessThan(3);
  },
);

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
  expect(control.held(0)).toBe(false);
  vehicles.position[1] = vehicles.position[1]! + 30;
  expect(control.hold(0)).toBe(Infinity);
});

test('T75 a car stopped safely beyond a marking yields to rail without an empty-band wait cycle', () => {
  const compiled = setup(operatingCrossing()),
    facility = compiled.rail!.facilities![0]!;
  const stop = facility.stops![0]!,
    span = facility.spans!.find((s) => s.segment === stop.lane)!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.insert(0, stop.lane, stop.stopM + 1);
  expect(vehicles.position[0]!).toBeLessThan(span.fromM);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 140, () => false)!;
  let protectedOnce = false;
  for (let i = 0; i < 900; i++) {
    control.step(140 + i * 0.1);
    const snapshot = control.snapshot();
    if (snapshot.crossings[0] !== CROSSING_OPEN) {
      protectedOnce = true;
      expect(control.hold(0)).toBeGreaterThanOrEqual(vehicles.position[0]!);
      expect(control.hold(0)).toBeLessThan(span.fromM);
    }
    expect(snapshot.trains.every((t) => t.speedMps > 0)).toBe(true);
  }
  expect(protectedOnce).toBe(true);
  expect(control.snapshot().crossings[0]).toBe(CROSSING_OPEN);
});

test('T75 recovery exemption requires the protected crossing stop to bind at the vehicle nose', () => {
  const compiled = setup(operatingCrossing()),
    stop = compiled.rail!.facilities![0]!.stops![0]!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.insert(0, stop.lane, stop.stopM - 100);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 180, () => false)!;
  expect(control.hold(0)).toBe(stop.stopM);
  control.binding(0, true);
  expect(control.held(0)).toBe(false);
  vehicles.position[0] = stop.stopM;
  expect(control.hold(0)).toBe(stop.stopM);
  control.binding(0, true);
  expect(control.held(0)).toBe(true);
  control.binding(0, false);
  expect(control.held(0)).toBe(false);
});

test.each([false, true])(
  'T75 an exact lane-end crossing stop prevents boundary transfer (junction=%s)',
  (junction) => {
    const { city, node, road, place } = buildCity('Crossing stop on segment boundary', 136);
    const start = node(-400, 0),
      center = node(-3, 0),
      end = node(400, 0);
    const before = road(start, center),
      after = road(center, end);
    before.provenance = after.provenance = { source: 'generated', osmIds: [10] };
    if (junction) road(center, node(80, -200));
    place('Homes', 'residential', { x: -380, y: 15 }, [
      { road: before, direction: 'out', positionM: 20 },
    ]);
    place('Work', 'work', { x: 380, y: 15 }, [{ road: after, direction: 'in', positionM: 370 }]);
    city.rail = operatingCrossing().rail;
    const compiled = setup(city),
      lane = compiled.index.lane.get(`${before.id}#0`)!;
    compiled.rail!.facilities![0]!.stops = [{ lane, stopM: compiled.lanes[lane]!.lengthM }];
    const engine = createEngine(),
      trip = trips(city, 1)[0]!;
    trip.departS = 145;
    engine.load({
      compiled,
      trips: [trip],
      scenario: { ...defaultScenario('grid5x5'), startS: 140, endS: 280 },
    });
    let atBoundary = 0;
    for (let i = 0; i < 1400; i++) {
      engine.step();
      const car = engine.inspect(1),
        rail = engine.snapshot().rail!;
      if (car?.state === 'driving' && rail.crossings[0] === CROSSING_CLOSED) {
        expect(car.lane).toBe(lane);
        if (Math.abs(car.positionM - compiled.lanes[lane]!.lengthM) < 1e-6) atBoundary++;
      }
    }
    expect(atBoundary).toBeGreaterThan(10);
    expect(engine.inspect(1)!.state).toBe('completed');
  },
);

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

test('T75 opposing services on adjacent tracks keep one continuous protected interval', () => {
  const city = operatingCrossing();
  const rail = city.rail!;
  for (const [id, y] of [
    ['rn:4', -1000],
    ['rn:5', 0],
    ['rn:6', 1000],
  ] as const)
    rail.nodes[id] = {
      id,
      pos: { x: 6, y },
      kind: y === 0 ? 'level_crossing' : 'plain',
      layer: 0,
      ...(y === 0 ? { crossing: { kind: 'rail', roadOsmIds: [10] } } : {}),
    };
  rail.tracks['rt:3'] = {
    ...rail.tracks['rt:1']!,
    id: 'rt:3',
    from: 'rn:4',
    to: 'rn:5',
    line: [
      { x: 6, y: -1000 },
      { x: 6, y: 0 },
    ],
    preferredDirection: 'backward',
  };
  rail.tracks['rt:4'] = {
    ...rail.tracks['rt:2']!,
    id: 'rt:4',
    from: 'rn:5',
    to: 'rn:6',
    line: [
      { x: 6, y: 0 },
      { x: 6, y: 1000 },
    ],
    preferredDirection: 'backward',
  };
  const compiled = setup(city),
    table = railTimetable(compiled.rail!);
  expect(compiled.rail!.facilities).toHaveLength(1);
  expect(table.routes).toHaveLength(2);
  table.departures = [
    { route: 0, timeS: 77, requestedS: 77 },
    { route: 1, timeS: 87, requestedS: 87 },
  ];
  const vehicles = createVehicles(0, compiled.lanes.length, compiled.movements.length);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 140, () => false)!;
  for (let i = 0; i < 850; i++) {
    const timeS = 140 + i * 0.1;
    control.step(timeS);
    if (timeS > 166 && timeS < 208) expect(control.snapshot().crossings[0]).toBe(CROSSING_CLOSED);
  }
  expect(control.snapshot().crossings[0]).toBe(CROSSING_OPEN);
});

test('T75 a delayed service keeps following and opposing trains outside its occupied sections', () => {
  const compiled = setup(operatingCrossing()),
    table = railTimetable(compiled.rail!);
  const route = table.routes[0]!;
  table.routes.push({
    ...route,
    id: `${route.id}:opposing`,
    from: route.to,
    to: route.from,
    sections: [...route.sections].reverse().map((s) => ({
      ...s,
      forward: !s.forward,
      startM: route.lengthM - s.endM,
      endM: route.lengthM - s.startM,
    })),
  });
  table.departures = [
    { route: 0, timeS: 77, requestedS: 77 },
    { route: 0, timeS: 237, requestedS: 237 },
    { route: 1, timeS: 300, requestedS: 300 },
  ];
  const facility = compiled.rail!.facilities![0]!,
    span = facility.spans![0]!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.insert(0, span.segment, (span.fromM + span.toM) / 2);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 140, () => false)!;
  let anyFollowing = false;
  for (let i = 0; i < 4500; i++) {
    if (i === 2400) vehicles.position[0] = span.toM + 20;
    control.step(140 + i * 0.1);
    const snapshot = control.snapshot();
    const tracks = snapshot.trains.flatMap((t) => t.occupied);
    expect(new Set(tracks).size).toBe(tracks.length);
    if (i > 260 && i < 2400) expect(snapshot.crossings[0]).toBe(CROSSING_CLOSED);
    if (snapshot.trains.some((t) => t.id.includes('/237/') && t.cars.length)) anyFollowing = true;
  }
  expect(anyFollowing).toBe(true);
});

test('T75 pause snapshots and live edits preserve service clocks; restart repeats the interaction', () => {
  const city = operatingCrossing(),
    compiled = setup(city),
    engine = createEngine();
  const trip = trips(city, 1)[0]!;
  trip.departS = 145;
  const scenario = { ...defaultScenario('grid5x5'), startS: 140, endS: 250 };
  engine.load({ compiled, trips: [trip], scenario });
  engine.step(350);
  const paused = engine.snapshot().rail!;
  expect(engine.snapshot().rail).toEqual(paused);
  city.version++;
  engine.patch(setup(city));
  expect(engine.snapshot().rail).toEqual(paused);
  engine.step(750);
  const end = engine.snapshot().rail!;
  const hash = engine.stateHash();
  engine.load({ compiled, trips: [trip], scenario });
  engine.step(1100);
  expect(engine.stateHash()).toBe(hash);
  expect(engine.snapshot().rail).toEqual(end);
});

test('T75 a long rear stays protected across a lane boundary after its route is reset', () => {
  const { city, node, road } = buildCity('Crossing before lane boundary', 136);
  const before = road(node(-400, 0), node(5, 0));
  const after = road(city.nodes[before.to]!, node(400, 0));
  before.provenance = { source: 'generated', osmIds: [10] };
  city.rail = operatingCrossing().rail;
  const compiled = setup(city),
    facility = compiled.rail!.facilities![0]!;
  const laneBefore = compiled.index.lane.get(`${before.id}#0`)!;
  const laneAfter = compiled.index.lane.get(`${after.id}#0`)!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.vclass[0] = 2;
  vehicles.insert(0, laneBefore, compiled.lanes[laneBefore]!.lengthM - 1);
  let control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 175, () => false)!;
  control.step(175);
  vehicles.remove(0);
  vehicles.insert(0, laneAfter, 2);
  vehicles.route[0] = null;
  vehicles.routeStep[0] = 0;
  for (let i = 1; i < 400; i++) control.step(175 + i * 0.1);
  const held = control.snapshot();
  expect(held.crossings[0]).toBe(CROSSING_CLOSED);
  expect(held.railReady[0]).toBe(0);
  expect(held.trains[0]!.speedMps).toBe(0);
  expect(facility.spans!.some((s) => s.segment === laneBefore)).toBe(true);
  // A new unrelated road shifts dense indices; a paused edit must retain the actual rear.
  const added = road(node(1000, 1000), node(1100, 1000));
  delete city.roads[added.id];
  city.roads['r:1'] = { ...added, id: 'r:1' };
  city.version++;
  const next = setup(city),
    mapping = patchChanges(compiled, next);
  const clocks = control.clocks(),
    roadState = control.roadState(mapping);
  vehicles.resetSegments(next.lanes.length, next.movements.length);
  vehicles.insert(0, mapping.lanes[laneAfter]!, 2);
  control = createRailCrossings(
    next,
    vehicles,
    DEFAULT_SIM_PARAMS,
    215,
    () => false,
    clocks,
    roadState,
  )!;
  expect(control.snapshot()).toEqual(held);
  vehicles.position[0] = 25;
  for (let i = 0; i < 400; i++) control.step(215 + i * 0.1);
  expect(control.snapshot().crossings[0]).toBe(CROSSING_OPEN);
});

test('T75 a vehicle on a real junction movement holds rail until its full rear exits', () => {
  const { city, node, road } = buildCity('Crossing inside junction', 136);
  const west = node(-400, 0),
    center = node(0, 0),
    east = node(400, 0);
  const before = road(west, center),
    after = road(center, east);
  before.provenance = after.provenance = { source: 'generated', osmIds: [10] };
  road(center, node(100, -200));
  city.rail = operatingCrossing().rail;
  const compiled = setup(city);
  const from = compiled.index.lane.get(`${before.id}#0`)!,
    to = compiled.index.lane.get(`${after.id}#0`)!;
  const movement = compiled.movements.find((m) => m.fromLane === from && m.toLane === to)!;
  expect(movement.lengthM).toBeGreaterThan(0);
  expect(compiled.rail!.facilities![0]!.spans!.some((s) => s.segment === -movement.idx - 1)).toBe(
    true,
  );
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.vclass[0] = 2;
  vehicles.insert(0, -movement.idx - 1, movement.lengthM / 2);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 175, () => false)!;
  for (let i = 0; i < 400; i++) control.step(175 + i * 0.1);
  expect(control.snapshot().railReady[0]).toBe(0);
  expect(control.snapshot().trains[0]!.speedMps).toBe(0);
  vehicles.remove(0);
  vehicles.insert(0, to, 1);
  control.step(215);
  expect(control.snapshot().railReady[0]).toBe(0);
  vehicles.position[0] = 30;
  for (let i = 1; i < 400; i++) control.step(215 + i * 0.1);
  expect(control.snapshot().crossings[0]).toBe(CROSSING_OPEN);
});

test('T75 a car waiting at one crossing does not falsely reserve a second unmetered crossing ahead', () => {
  const city = operatingCrossing(),
    rail = city.rail!;
  rail.nodes['rn:3'] = {
    id: 'rn:3',
    pos: { x: 60, y: 0 },
    kind: 'level_crossing',
    layer: 0,
    crossing: { kind: 'rail', roadOsmIds: [10] },
  };
  rail.nodes['rn:4'] = { id: 'rn:4', pos: { x: 60, y: -1000 }, kind: 'plain', layer: 0 };
  rail.tracks['rt:2']!.to = 'rn:3';
  rail.tracks['rt:2']!.line = [
    { x: 0, y: 0 },
    { x: 0, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 0 },
  ];
  rail.tracks['rt:3'] = {
    ...rail.tracks['rt:1']!,
    id: 'rt:3',
    from: 'rn:3',
    to: 'rn:4',
    line: [
      { x: 60, y: 0 },
      { x: 60, y: -1000 },
    ],
  };
  const compiled = setup(city),
    table = railTimetable(compiled.rail!);
  expect(table.routes).toHaveLength(1);
  table.departures = [{ route: 0, timeS: 0, requestedS: 0 }];
  const facilities = compiled.rail!.facilities!;
  expect(facilities).toHaveLength(2);
  // Reproduce an older facility that omitted a legal incoming marking.
  facilities[1]!.stops = [];
  const stop = facilities[0]!.stops![0]!;
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  vehicles.state[0] = DRIVING;
  vehicles.insert(0, stop.lane, stop.stopM);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 60, () => false)!;
  let protectedFirst = false,
    reopenedFirst = false;
  for (let i = 0; i < 1400; i++) {
    control.step(60 + i * 0.1);
    const snapshot = control.snapshot();
    if (snapshot.crossings[0] === CROSSING_CLOSED) protectedFirst = true;
    if (protectedFirst && snapshot.crossings[0] === CROSSING_OPEN) reopenedFirst = true;
    expect(snapshot.trains.every((t) => t.speedMps > 0)).toBe(true);
  }
  expect(reopenedFirst).toBe(true);
  expect([...control.snapshot().crossings]).toEqual([CROSSING_OPEN, CROSSING_OPEN]);
});

test.each(['pedestrian', 'bridge', 'unmapped'] as const)(
  'T75 %s crossings have exact road-state parity',
  (kind) => {
    const city = operatingCrossing();
    if (kind === 'pedestrian') city.rail!.nodes['rn:2']!.crossing!.kind = 'pedestrian';
    if (kind === 'bridge')
      for (const t of Object.values(city.rail!.tracks)) {
        t.bridge = true;
        t.layer = 1;
      }
    if (kind === 'unmapped') delete city.rail!.nodes['rn:2']!.crossing;
    const ordinary = structuredClone(city);
    delete ordinary.rail;
    const a = createEngine(),
      b = createEngine();
    const input = {
      trips: trips(city, 10, 1),
      scenario: { ...defaultScenario('grid5x5'), startS: 100, endS: 250 },
    };
    a.load({ ...input, compiled: setup(city) });
    b.load({ ...input, compiled: setup(ordinary) });
    a.step(1500);
    b.step(1500);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.snapshot().rail!.crossings).toHaveLength(0);
  },
);

test('T75 restart is deterministic and an unserved facility has exact road-state parity', () => {
  const city = operatingCrossing();
  // No boundary-to-boundary service after the mapped exit becomes a buffer with a binding direction.
  city.rail!.nodes['rn:3']!.kind = 'buffer_stop';
  const compiled = setup(city);
  expect(railTimetable(compiled.rail!).routes).toHaveLength(0);
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

test('T75 an open single-lane crossing admits a moving platoon with free downstream storage', () => {
  const compiled = setup(operatingCrossing()),
    facility = compiled.rail!.facilities![0]!,
    stop = facility.stops![0]!,
    end = facility.spans!.find((s) => s.segment === stop.lane)!.toM;
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.speed.fill(10);
  for (const [id, front] of [end + 0.5, stop.stopM - 15, stop.stopM - 34].entries())
    vehicles.insert(id, stop.lane, front);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 100, () => false)!;
  expect(control.snapshot().crossings[0]).toBe(CROSSING_OPEN);
  expect(control.hold(1)).toBe(Infinity);
  expect(control.hold(2)).toBe(Infinity);
});

test.each([0, 2])(
  'T75 open platoon storage counts the full intervening vehicle body (%s)',
  (kind) => {
    const compiled = setup(operatingCrossing()),
      facility = compiled.rail!.facilities![0]!,
      stop = facility.stops![0]!,
      end = facility.spans!.find((s) => s.segment === stop.lane)!.toM;
    const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
    vehicles.state.fill(DRIVING);
    vehicles.speed.fill(2);
    vehicles.speed[2] = 0;
    vehicles.vclass[0] = kind;
    const full = kind === 2 ? 20.5 : 13;
    vehicles.insert(0, stop.lane, end + 0.5);
    vehicles.insert(1, stop.lane, stop.stopM - 20);
    vehicles.insert(2, stop.lane, end + full + 4.5);
    const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 100, () => false)!;
    expect(control.hold(1)).toBe(stop.stopM);
    vehicles.position[2] = vehicles.position[2]! + 3;
    expect(control.hold(1)).toBe(Infinity);
  },
);

test('T75 open platoons cannot borrow a downstream access slot', () => {
  const source = operatingCrossing();
  const work = Object.values(source.places).find((p) => p.kind === 'work')!;
  work.connectors[0]!.positionM = 430;
  const compiled = setup(source),
    facility = compiled.rail!.facilities![0]!,
    stop = facility.stops![0]!,
    end = facility.spans!.find((s) => s.segment === stop.lane)!.toM;
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.speed.fill(10);
  for (const [id, front] of [end + 0.5, stop.stopM - 15, stop.stopM - 34].entries())
    vehicles.insert(id, stop.lane, front);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 100, () => false)!;
  expect(control.hold(1)).toBe(Infinity);
  expect(control.hold(2)).toBe(stop.stopM);
});

test('T75 an open multilane crossing retains conservative storage admission', () => {
  const source = operatingCrossing();
  Object.values(source.roads)[0]!.lanes.push({ ...Object.values(source.roads)[0]!.lanes[0]! });
  const compiled = setup(source),
    facility = compiled.rail!.facilities![0]!,
    stop = facility.stops![0]!,
    end = facility.spans!.find((s) => s.segment === stop.lane)!.toM;
  const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
  vehicles.state.fill(DRIVING);
  vehicles.speed.fill(10);
  vehicles.insert(0, stop.lane, end + 0.5);
  vehicles.insert(1, stop.lane, stop.stopM - 15);
  const control = createRailCrossings(compiled, vehicles, DEFAULT_SIM_PARAMS, 100, () => false)!;
  expect(control.hold(1)).toBe(stop.stopM);
});

test('T75 an open three-car platoon keeps exact ordinary-road trajectories', () => {
  const source = operatingCrossing(),
    ordinary = structuredClone(source);
  delete ordinary.rail;
  const requests = trips(source, 3, 1).map((trip, i) => ({ ...trip, departS: i }));
  const scenario = {
    ...defaultScenario('grid5x5', 1),
    startS: 0,
    endS: 120,
    simParams: { streetParkingShare: 0 },
  };
  const protectedRoad = createEngine(),
    reference = createEngine();
  protectedRoad.load({ compiled: setup(source), trips: requests, scenario });
  reference.load({ compiled: setup(ordinary), trips: requests, scenario });
  for (let i = 0; i < 1200; i++) {
    protectedRoad.step();
    reference.step();
    expect(protectedRoad.snapshot().rail!.crossings[0]).toBe(CROSSING_OPEN);
    expect(protectedRoad.stateHash()).toBe(reference.stateHash());
  }
  expect(protectedRoad.metrics().trips.completed).toBe(3);
});
