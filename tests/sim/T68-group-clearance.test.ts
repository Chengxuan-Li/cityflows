import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup } from './fixtures';

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
  engine.step(600);
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
