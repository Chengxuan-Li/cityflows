import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createIntersections } from '../../src/sim/intersection';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { createMerges } from '../../src/sim/merge';
import { scenario, setup } from './fixtures';
import { sampleConflictZones } from './conflict-zone-safety';

function groupFixture(blocked: boolean) {
  const { city, node, road, place } = buildCity('Group clearance', 1);
  const first = node(100, 0);
  const second = node(120, 0);
  const entry = road(node(0, 0), first);
  const inner = road(first, second);
  const exit = road(second, node(300, 0));
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [first.id, second.id],
      innerRoads: [inner.id],
      signal: null,
      provenance: { source: 'authored' },
    },
  };
  place('Origin', 'gateway', first.pos, [{ road: entry, direction: 'out', positionM: 85 }]);
  place('Destination', 'work', second.pos, [{ road: exit, direction: 'in', positionM: 150 }]);
  place('Blocker origin', 'gateway', second.pos, [
    { road: exit, direction: 'out', positionM: 6.5 },
  ]);
  place('Closed destination', 'work', second.pos, [
    { road: exit, direction: 'in', positionM: 6.5 },
  ]);
  const places = Object.values(city.places);
  places[3]!.capacity = 0;
  const pairs = [
    [2, 3],
    [0, 1],
  ];
  const requests: TripRequest[] = pairs.map(([from, to], i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: places[from!]!.id,
    destinationPlaceId: places[to!]!.id,
    departS: i === 0 ? 100 : 102,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  if (!blocked) requests.shift();
  return { city, compiled: setup(city), trips: requests, entry, inner, exit };
}

test.each([false, true])(
  'T68: a short external continuation uses downstream storage (full: %s)',
  (full) => {
    const { city, node, road, place } = buildCity('Short group exit', 1);
    const a = node(100, 0),
      b = node(120, 0),
      c = node(125.5, 0);
    const entry = road(node(0, 0), a),
      inner = road(a, b),
      short = road(b, c),
      onward = road(c, node(300, 0));
    city.junctionGroups = {
      'jg:100': {
        id: 'jg:100',
        nodes: [a.id, b.id],
        innerRoads: [inner.id],
        signal: null,
        provenance: { source: 'authored' },
      },
    };
    place('Origin', 'gateway', a.pos, [{ road: entry, direction: 'out', positionM: 85 }]);
    place('Destination', 'work', c.pos, [{ road: onward, direction: 'in', positionM: 120 }]);
    place('Blocker origin', 'gateway', c.pos, [{ road: onward, direction: 'out', positionM: 6.5 }]);
    place('Closed', 'work', c.pos, [{ road: onward, direction: 'in', positionM: 6.5 }]);
    const places = Object.values(city.places);
    places[3]!.capacity = 0;
    const pairs = full
      ? [
          [2, 3],
          [0, 1],
        ]
      : [[0, 1]];
    const requests: TripRequest[] = pairs.map(([from, to], i) => ({
      id: `trip:${i}`,
      personId: null,
      originPlaceId: places[from!]!.id,
      destinationPlaceId: places[to!]!.id,
      departS: i === 0 ? 100 : 102,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    }));
    const compiled = setup(city),
      engine = createEngine(),
      subject = full ? 2 : 1;
    expect(compiled.lanes[compiled.index.lane.get(`${short.id}#0`)!]!.lengthM).toBeLessThan(6.5);
    engine.load({ compiled, trips: requests, scenario: scenario(), params: { maxReplans: 0 } });
    const entryLane = compiled.index.lane.get(`${entry.id}#0`)!;
    for (let i = 0; i < 600; i++) {
      engine.step();
      sampleConflictZones(engine, compiled);
      const car = engine.inspect(subject);
      if (full && car?.state === 'driving') expect(car.lane).toBe(entryLane);
    }
    expect(engine.inspect(subject)).toMatchObject({
      state: full ? 'driving' : 'completed',
      respawns: 0,
    });
  },
);

test('T68: a fallback onto the same next road clears its actual legal group suffix', () => {
  const { city, node, road, place } = buildCity('Same-next-road fallback', 1);
  const start = node(0, 0),
    a = node(100, 0),
    b = node(120, 0),
    far = node(270, 0),
    corner = node(270, 150);
  const entry = road(start, a, { lanes: 2 }),
    inner = road(a, b, { lanes: 2 }),
    goal = road(b, node(120, 200));
  const bypass = road(b, far);
  road(far, corner);
  road(corner, b, {
    via: [
      { x: 60, y: 150 },
      { x: 60, y: 0 },
    ],
  });
  const provenance = { source: 'authored' } as const;
  b.turnRules = [
    { from: inner.id, to: goal.id, allowed: false, provenance },
    { from: inner.id, to: goal.id, fromLane: 1, toLane: 0, allowed: true, provenance },
    { from: inner.id, to: bypass.id, allowed: false, provenance },
    { from: inner.id, to: bypass.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id],
      innerRoads: [inner.id],
      signal: null,
      provenance,
    },
  };
  const initial = setup(city),
    stop = initial.lanes[initial.index.lane.get(`${entry.id}#1`)!]!.stopM;
  const requests: TripRequest[] = [];
  for (let i = 0; i < 4; i++) {
    const pos = stop - 0.5 - i * 22;
    place(`Blocker ${i}`, 'gateway', a.pos, [
      { road: entry, lane: 1, direction: 'out', positionM: pos },
    ]);
    const origin = Object.values(city.places).at(-1)!;
    place(`Closed ${i}`, 'work', a.pos, [
      { road: entry, lane: 1, direction: 'in', positionM: pos },
    ]);
    const destination = Object.values(city.places).at(-1)!;
    destination.capacity = 0;
    requests.push({
      id: `blocker:${i}`,
      personId: null,
      originPlaceId: origin.id,
      destinationPlaceId: destination.id,
      departS: 100,
      mode: 'car',
      vehicleClass: 'truck',
      purpose: 'through',
      legs: [],
    });
  }
  place('Subject', 'gateway', start.pos, [
    { road: entry, lane: 0, direction: 'out', positionM: 20 },
  ]);
  const origin = Object.values(city.places).at(-1)!;
  place('Destination', 'gateway', b.pos, [{ road: goal, direction: 'in', positionM: 150 }]);
  requests.push({
    id: 'subject',
    personId: null,
    originPlaceId: origin.id,
    destinationPlaceId: Object.values(city.places).at(-1)!.id,
    departS: 101,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'through',
    legs: [],
  });
  const compiled = setup(city),
    engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: {
      spawnMinGapM: 2,
      maxReplans: 0,
      gridlock: { respawnS: 1e6, fadeS: 5, maxRespawns: 3 },
      vehicleClasses: {
        ...DEFAULT_SIM_PARAMS.vehicleClasses,
        truck: { ...DEFAULT_SIM_PARAMS.vehicleClasses.truck, lengthM: 20 },
      },
    },
  });
  for (let i = 0; i < 2500; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.inspect(5)).toMatchObject({
    state: 'completed',
    routeReason: 'missed_turn',
    respawns: 0,
  });
});

test('T68: a proposed head alternative on the same next road uses its own suffix', () => {
  const { city, node, road, place } = buildCity('Same-road head alternative', 1);
  const a = node(100, 0),
    b = node(120, 0),
    far = node(270, 0),
    corner = node(270, 150);
  const entry = road(node(0, 0), a),
    inner = road(a, b, { lanes: 2 }),
    goal = road(b, node(120, 220), { lanes: 2 });
  const bypass = road(b, far);
  road(far, corner);
  const returning = road(corner, b, {
      via: [
        { x: 60, y: 150 },
        { x: 60, y: 0 },
      ],
    }),
    provenance = { source: 'authored' } as const;
  b.turnRules = [
    { from: inner.id, to: goal.id, allowed: false, provenance },
    { from: inner.id, to: goal.id, fromLane: 0, toLane: 0, allowed: true, provenance },
    { from: inner.id, to: bypass.id, allowed: false, provenance },
    { from: inner.id, to: bypass.id, fromLane: 1, toLane: 0, allowed: true, provenance },
    { from: returning.id, to: goal.id, allowed: false, provenance },
    { from: returning.id, to: goal.id, fromLane: 0, toLane: 1, allowed: true, provenance },
  ];
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id],
      innerRoads: [inner.id],
      signal: null,
      provenance,
    },
  };
  place('Blocker', 'gateway', b.pos, [{ road: goal, lane: 0, direction: 'out', positionM: 6.5 }]);
  const blocker = Object.values(city.places).at(-1)!;
  place('Closed', 'gateway', b.pos, [{ road: goal, lane: 0, direction: 'in', positionM: 6.5 }]);
  const closed = Object.values(city.places).at(-1)!;
  closed.capacity = 0;
  place('Subject', 'gateway', a.pos, [{ road: entry, direction: 'out', positionM: 85 }]);
  const origin = Object.values(city.places).at(-1)!;
  place('Destination', 'gateway', b.pos, [
    { road: goal, lane: 1, direction: 'in', positionM: 150 },
  ]);
  const destination = Object.values(city.places).at(-1)!;
  const requests: TripRequest[] = [
    [blocker.id, closed.id],
    [origin.id, destination.id],
  ].map(([from, to], i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: from!,
    destinationPlaceId: to!,
    departS: i === 0 ? 100 : 102,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'through',
    legs: [],
  }));
  const compiled = setup(city),
    engine = createEngine();
  let detoured = 0;
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: {
      headDetourS: 3,
      maxReplans: 0,
      gridlock: { respawnS: 1e6, fadeS: 5, maxRespawns: 3 },
    },
    headDetourObserver(id) {
      if (id === 1) detoured++;
    },
  });
  for (let i = 0; i < 2500; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.inspect(2)).toMatchObject({ state: 'completed', respawns: 0 });
  expect(detoured).toBe(1);
});

test('T68: a route may end at an accepting connector on an inner road', () => {
  const fixture = groupFixture(false);
  Object.values(fixture.city.places)[1]!.connectors[0]!.roadId = fixture.inner.id;
  Object.values(fixture.city.places)[1]!.connectors[0]!.positionM = 15;
  const compiled = setup(fixture.city);
  const engine = createEngine();
  engine.load({ compiled, trips: fixture.trips, scenario: scenario(), params: { maxReplans: 0 } });
  engine.step(600);
  expect(engine.inspect(1)).toMatchObject({ state: 'completed', respawns: 0 });
});

test('T68: a short group exit lands in the lane that actually reaches the destination', () => {
  const fixture = groupFixture(false);
  const exit = fixture.city.roads[fixture.exit.id]!;
  exit.lanes.push({ ...exit.lanes[0]! });
  const end = fixture.city.nodes[fixture.inner.to]!;
  const provenance = { source: 'authored' } as const;
  end.turnRules = [
    { from: fixture.inner.id, to: exit.id, allowed: false, provenance },
    ...[0, 1].map((toLane) => ({
      from: fixture.inner.id,
      to: exit.id,
      fromLane: 0,
      toLane,
      allowed: true,
      provenance,
    })),
  ];
  const destination = Object.values(fixture.city.places)[1]!.connectors[0]!;
  destination.lane = 1;
  destination.positionM = 15;
  const compiled = setup(fixture.city),
    engine = createEngine();
  engine.load({ compiled, trips: fixture.trips, scenario: scenario(), params: { maxReplans: 0 } });
  const exitLane = compiled.index.lane.get(`${fixture.exit.id}#1`)!;
  let entered = false;
  for (let i = 0; i < 600; i++) {
    engine.step();
    const car = engine.inspect(1);
    if (
      !entered &&
      car &&
      compiled.lanes[car.lane]?.road === compiled.index.road.get(fixture.exit.id)
    ) {
      expect(car.lane).toBe(exitLane);
      entered = true;
    }
  }
  expect(entered).toBe(true);
  expect(engine.inspect(1)).toMatchObject({ state: 'completed', respawns: 0 });
});

test('T68: an internally required safe lane change remains reachable through a group', () => {
  const { city, node, road, place } = buildCity('Group lane change', 1);
  const a = node(100, 0),
    b = node(160, 0);
  const entry = road(node(0, 0), a),
    inner = road(a, b, { lanes: 2 }),
    exit = road(b, node(320, 0));
  const provenance = { source: 'authored' } as const;
  a.turnRules = [
    { from: entry.id, to: inner.id, allowed: false, provenance },
    { from: entry.id, to: inner.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  b.turnRules = [
    { from: inner.id, to: exit.id, allowed: false, provenance },
    { from: inner.id, to: exit.id, fromLane: 1, toLane: 0, allowed: true, provenance },
  ];
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id],
      innerRoads: [inner.id],
      signal: null,
      provenance,
    },
  };
  place('Origin', 'gateway', a.pos, [{ road: entry, direction: 'out', positionM: 85 }]);
  place('Destination', 'work', b.pos, [{ road: exit, direction: 'in', positionM: 120 }]);
  const places = Object.values(city.places);
  const compiled = setup(city);
  const requests: TripRequest[] = [
    {
      id: 'trip:0',
      personId: null,
      originPlaceId: places[0]!.id,
      destinationPlaceId: places[1]!.id,
      departS: 100,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    },
  ];
  const engine = createEngine();
  engine.load({ compiled, trips: requests, scenario: scenario(), params: { maxReplans: 0 } });
  for (let i = 0; i < 600; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.inspect(1)).toMatchObject({ state: 'completed', respawns: 0 });
});

test('T68: a group entry waits outside while its final exit is full, beyond boxWaitS', () => {
  const fixture = groupFixture(true);
  const engine = createEngine();
  engine.load({ ...fixture, scenario: scenario(), params: { maxReplans: 0 } });
  const entryLane = fixture.compiled.index.lane.get(`${fixture.entry.id}#0`)!;
  for (let i = 0; i < 600; i++) {
    engine.step();
    const car = engine.inspect(2);
    if (car?.state === 'driving') expect(car.lane).toBe(entryLane);
  }
  expect(engine.inspect(2)).toMatchObject({ state: 'driving', respawns: 0 });
});

test('T68: an empty group clears a car to its destination with no inner stop and deterministically', () => {
  const fixture = groupFixture(false);
  const run = () => {
    const engine = createEngine();
    engine.load({ ...fixture, scenario: scenario(), params: { maxReplans: 0 } });
    const innerLane = fixture.compiled.index.lane.get(`${fixture.inner.id}#0`)!;
    for (let i = 0; i < 600; i++) {
      engine.step();
      const car = engine.inspect(1);
      if (car?.lane === innerLane) expect(car.speedMps).toBeGreaterThan(0.1);
    }
    expect(engine.inspect(1)).toMatchObject({ state: 'completed', respawns: 0 });
    return engine.stateHash();
  };
  expect(run()).toBe(run());
});

test('T68: entry rechecks an exit that fills after the approach grant', () => {
  const fixture = groupFixture(true);
  fixture.trips[0]!.departS = 103;
  const engine = createEngine();
  let grants = 0;
  engine.load({
    ...fixture,
    scenario: scenario(),
    params: { maxReplans: 0 },
    intersectionObserver(id, _movement, reason) {
      if (id === 1 && reason === 'granted') grants++;
    },
  });
  const entryLane = fixture.compiled.index.lane.get(`${fixture.entry.id}#0`)!;
  for (let i = 0; i < 600; i++) {
    engine.step();
    const car = engine.inspect(2);
    if (car?.state === 'driving') expect(car.lane).toBe(entryLane);
  }
  expect(grants).toBeGreaterThan(0);
});

test('T68: two group entries cannot both spend one remaining exit space', () => {
  const { city, node, road, place } = buildCity('Competing group entries', 1);
  const a = node(100, -15),
    b = node(100, 15),
    c = node(125, 0);
  const entryA = road(node(0, -15), a),
    entryB = road(node(0, 15), b);
  const innerA = road(a, c),
    innerB = road(b, c),
    exit = road(c, node(300, 0));
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id, c.id],
      innerRoads: [innerA.id, innerB.id],
      signal: null,
      provenance: { source: 'authored' },
    },
  };
  place('Blocker origin', 'gateway', c.pos, [{ road: exit, direction: 'out', positionM: 13 }]);
  place('Closed destination', 'work', c.pos, [{ road: exit, direction: 'in', positionM: 13 }]);
  place('Origin A', 'gateway', a.pos, [{ road: entryA, direction: 'out', positionM: 85 }]);
  place('Origin B', 'gateway', b.pos, [{ road: entryB, direction: 'out', positionM: 85 }]);
  place('Destination', 'work', c.pos, [{ road: exit, direction: 'in', positionM: 150 }]);
  const places = Object.values(city.places);
  places[1]!.capacity = 0;
  const requests: TripRequest[] = [
    [0, 1],
    [2, 4],
    [3, 4],
  ].map(([from, to], i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: places[from!]!.id,
    destinationPlaceId: places[to!]!.id,
    departS: i === 0 ? 100 : 102,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  const compiled = setup(city);
  const entries = new Set([entryA, entryB].map((r) => compiled.index.lane.get(`${r.id}#0`)!));
  const engine = createEngine();
  engine.load({ compiled, trips: requests, scenario: scenario(), params: { maxReplans: 0 } });
  for (let i = 0; i < 600; i++) {
    engine.step();
    const entered = [engine.inspect(2), engine.inspect(3)].filter(
      (car) => car?.state === 'driving' && !entries.has(car.lane),
    );
    expect(entered).toHaveLength(entered.length > 0 ? 1 : 0);
  }
});

test('T68: a group clears a crossing path before admitting a conflicting entry', () => {
  const { city, node, road, place } = buildCity('Conflicting group paths', 1);
  const a = node(0, 0),
    b = node(30, 0),
    c = node(30, -30);
  const entryA = road(node(-100, 0), a),
    entryC = road(node(30, -130), c);
  const innerA = road(a, b),
    innerC = road(c, b);
  const east = road(b, node(180, 0)),
    south = road(b, node(30, 150));
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id, c.id],
      innerRoads: [innerA.id, innerC.id],
      signal: null,
      provenance: { source: 'authored' },
    },
  };
  place('Origin A', 'gateway', a.pos, [{ road: entryA, direction: 'out', positionM: 85 }]);
  place('Destination A', 'work', b.pos, [{ road: east, direction: 'in', positionM: 100 }]);
  place('Origin C', 'gateway', c.pos, [{ road: entryC, direction: 'out', positionM: 85 }]);
  place('Destination C', 'work', b.pos, [{ road: south, direction: 'in', positionM: 100 }]);
  const places = Object.values(city.places);
  const requests: TripRequest[] = [
    [0, 1],
    [2, 3],
  ].map(([from, to], i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: places[from!]!.id,
    destinationPlaceId: places[to!]!.id,
    departS: 100,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  const compiled = setup(city);
  const entries = new Set([entryA, entryC].map((r) => compiled.index.lane.get(`${r.id}#0`)!));
  const exits = new Set([east, south].map((r) => compiled.index.lane.get(`${r.id}#0`)!));
  const turnA = compiled.movements.find(
    (m) =>
      compiled.lanes[m.fromLane]!.road === compiled.index.road.get(innerA.id) &&
      compiled.lanes[m.toLane]!.road === compiled.index.road.get(east.id),
  )!;
  const turnC = compiled.movements.find(
    (m) =>
      compiled.lanes[m.fromLane]!.road === compiled.index.road.get(innerC.id) &&
      compiled.lanes[m.toLane]!.road === compiled.index.road.get(east.id),
  )!;
  expect(turnA.conflicts).toContain(turnC.idx);
  const engine = createEngine();
  engine.load({ compiled, trips: requests, scenario: scenario(), params: { maxReplans: 0 } });
  for (let i = 0; i < 600; i++) {
    engine.step();
    const inside = [engine.inspect(1), engine.inspect(2)].filter(
      (car) => car?.state === 'driving' && !entries.has(car.lane) && !exits.has(car.lane),
    );
    expect(inside.length).toBeLessThanOrEqual(1);
  }
  expect(engine.metrics().trips.completed).toBe(2);
});

test('T68: a rear-cleared member conflict does not reserve the rest of a long group', () => {
  const { city, node, road, place } = buildCity('Cleared group member', 1);
  const a = node(0, 0),
    b = node(60, 0),
    c = node(0, 60);
  const west = road(node(-100, 0), a),
    north = road(node(0, -100), a);
  const innerEast = road(a, b, { speedKmh: 18 }),
    innerSouth = road(a, c, { speedKmh: 18 });
  const east = road(b, node(180, 0)),
    south = road(c, node(0, 180));
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id, c.id],
      innerRoads: [innerEast.id, innerSouth.id],
      signal: null,
      provenance: { source: 'authored' },
    },
  };
  place('Origin west', 'gateway', a.pos, [{ road: west, direction: 'out', positionM: 85 }]);
  place('Destination east', 'work', b.pos, [{ road: east, direction: 'in', positionM: 100 }]);
  place('Origin north', 'gateway', a.pos, [{ road: north, direction: 'out', positionM: 85 }]);
  place('Destination south', 'work', c.pos, [{ road: south, direction: 'in', positionM: 100 }]);
  const places = Object.values(city.places);
  const requests: TripRequest[] = [
    [0, 1],
    [2, 3],
  ].map(([from, to], i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: places[from!]!.id,
    destinationPlaceId: places[to!]!.id,
    departS: 100,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  const compiled = setup(city),
    engine = createEngine();
  const inner = new Set([innerEast, innerSouth].map((r) => compiled.index.lane.get(`${r.id}#0`)!));
  engine.load({ compiled, trips: requests, scenario: scenario(), params: { maxReplans: 0 } });
  let concurrent = false;
  for (let i = 0; i < 900; i++) {
    engine.step();
    if (inner.has(engine.inspect(1)?.lane ?? -1) && inner.has(engine.inspect(2)?.lane ?? -1))
      concurrent = true;
  }
  expect(concurrent).toBe(true);
  expect(engine.metrics().trips.completed).toBe(2);
});

test('T68: a reserved inner merge does not yield back to a ramp waiting outside the group', () => {
  const { city, node, road, place } = buildCity('Reserved group merge', 1);
  const a = node(100, 0),
    b = node(160, 0);
  const entry = road(node(0, 0), a, { roadClass: 'primary', speedKmh: 18 }),
    inner = road(a, b, { roadClass: 'primary', speedKmh: 18 });
  const ramp = road(node(20, -25), b, { roadClass: 'ramp' }),
    exit = road(b, node(300, 0), { roadClass: 'primary', speedKmh: 18 });
  city.junctionGroups = {
    'jg:100': {
      id: 'jg:100',
      nodes: [a.id, b.id],
      innerRoads: [inner.id],
      signal: null,
      provenance: { source: 'authored' },
    },
  };
  const initial = setup(city),
    rampStop = initial.lanes[initial.index.lane.get(`${ramp.id}#0`)!]!.stopM;
  place('Main origin', 'gateway', a.pos, [{ road: entry, direction: 'out', positionM: 85 }]);
  place('Ramp origin', 'gateway', b.pos, [
    { road: ramp, direction: 'out', positionM: rampStop - 2 },
  ]);
  place('Destination', 'work', b.pos, [{ road: exit, direction: 'in', positionM: 120 }]);
  const places = Object.values(city.places);
  const requests: TripRequest[] = [0, 1].map((p) => ({
    id: `trip:${p}`,
    personId: null,
    originPlaceId: places[p]!.id,
    destinationPlaceId: places[2]!.id,
    departS: p === 0 ? 100 : 106,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  const compiled = setup(city),
    engine = createEngine();
  expect(
    compiled.movements.find((m) => m.fromLane === compiled.index.lane.get(`${inner.id}#0`))!.turn,
  ).toBe('merge');
  engine.load({ compiled, trips: requests, scenario: scenario(), params: { maxReplans: 0 } });
  for (let i = 0; i < 600; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.metrics().trips.completed).toBe(2);
  expect(engine.metrics().respawns).toBe(0);
});

test.each(['rear', 'idm', 'follower'] as const)(
  'T68: an active clearance retains %s safety after entry',
  (kind) => {
    const { city, node, road, place } = buildCity('Changed merge gap', 1);
    const a = node(100, 0),
      b = node(160, 0);
    const entry = road(node(0, 0), a, { roadClass: 'primary' });
    const inner = road(a, b, { roadClass: kind === 'follower' ? 'ramp' : 'primary' });
    const side = road(node(20, -25), b, { roadClass: kind === 'follower' ? 'primary' : 'ramp' });
    const exit = road(b, node(300, 0), { roadClass: 'primary' });
    city.junctionGroups = {
      'jg:100': {
        id: 'jg:100',
        nodes: [a.id, b.id],
        innerRoads: [inner.id],
        signal: null,
        provenance: { source: 'authored' },
      },
    };
    place('Destination', 'gateway', b.pos, [{ road: exit, direction: 'in', positionM: 100 }]);
    const compiled = setup(city),
      from = compiled.index.lane.get(`${entry.id}#0`)!,
      innerLane = compiled.index.lane.get(`${inner.id}#0`)!;
    const exitLane = compiled.index.lane.get(`${exit.id}#0`)!,
      sideLane = compiled.index.lane.get(`${side.id}#0`)!;
    const destination = compiled.connectors[0]!.idx;
    const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), {
      fromLane: from,
      fromPosM: 80,
      toConnector: destination,
      vehicleClass: 'car',
      desiredSpeedFactor: 1,
      noise: 0,
      seed: 1,
    });
    if (!result.ok) throw new Error(result.reason);
    const vehicles = createVehicles(2, compiled.lanes.length, compiled.movements.length);
    vehicles.state.fill(DRIVING);
    vehicles.speedFactor.fill(1);
    vehicles.route[0] = result.route;
    vehicles.destination[0] = destination;
    const first = compiled.movements[result.route.movements[0]!]!,
      merge = compiled.movements[result.route.movements[1]!]!;
    vehicles.insert(0, from, 80);
    vehicles.movement[0] = first.idx;
    const merges = createMerges(compiled, vehicles, DEFAULT_SIM_PARAMS);
    const intersections = createIntersections(
      compiled,
      vehicles,
      DEFAULT_SIM_PARAMS,
      merges.canEnter,
    );
    intersections.request(0, first);
    intersections.resolve();
    expect(intersections.grants[0]).toBe(first.idx);
    intersections.enterGroup(0, first);
    intersections.release(0);
    vehicles.remove(0);
    vehicles.insert(0, innerLane, compiled.lanes[innerLane]!.stopM - 2);
    vehicles.movement[0] = merge.idx;
    vehicles.routeStep[0] = 1;
    vehicles.speed[0] = kind === 'idm' ? 15 : 5;
    if (kind === 'follower') {
      vehicles.insert(1, sideLane, compiled.lanes[sideLane]!.stopM - 1);
      vehicles.speed[1] = 25;
      vehicles.movement[1] = compiled.lanes[sideLane]!.out[0]!;
    } else {
      vehicles.insert(1, exitLane, kind === 'rear' ? 1 : 8.5);
      vehicles.speed[1] = kind === 'rear' ? 0 : 3;
    }
    intersections.request(0, merge);
    intersections.resolve();
    expect(intersections.grants[0]).toBe(-1);
  },
);
