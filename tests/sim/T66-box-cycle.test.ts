import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { sampleConflictZones } from './conflict-zone-safety';
import { scenario, setup } from './fixtures';

function ring(count = 50) {
  const { city, node, road, place } = buildCity('Box ring', 1);
  const corners = [node(0, 0), node(80, 0), node(80, 80), node(0, 80)];
  corners.forEach((corner, i) => road(corner, corners[(i + 1) % 4]!));
  const origins: string[] = [],
    destinations: string[] = [];
  for (const [i, corner] of corners.entries()) {
    const dx = (corner.pos.x - 40) * 3,
      dy = (corner.pos.y - 40) * 3;
    const feeder = road(node(corner.pos.x + dx, corner.pos.y + dy), corner);
    const exit = road(corner, node(corner.pos.x - dy, corner.pos.y + dx));
    place(`Origin ${i}`, 'gateway', corner.pos, [{ road: feeder, direction: 'out', positionM: 5 }]);
    origins.push(Object.values(city.places).at(-1)!.id);
    place(`Exit ${i}`, 'gateway', corner.pos, [{ road: exit, direction: 'in', positionM: 80 }]);
    destinations.push(Object.values(city.places).at(-1)!.id);
  }
  const requests: TripRequest[] = origins.flatMap((originPlaceId, i) =>
    Array.from({ length: count }, (_, j) => ({
      id: `${i}:${j}`,
      personId: null,
      originPlaceId,
      destinationPlaceId: destinations[(i + 2) % 4]!,
      departS: 100 + j * 0.5,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    })),
  );
  const compiled = setup(city),
    engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: {
      gridlock: { respawnS: 1e6, fadeS: 5, maxRespawns: 3 },
      maxReplans: 0,
    },
  });
  return { engine, compiled, requests };
}

test('T66: a loaded four-junction ring drains within ten minutes without recovery', () => {
  const { engine, compiled, requests } = ring();
  for (let i = 0; i < 6000; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.metrics().trips.completed).toBe(requests.length);
  expect(engine.metrics().respawns).toBe(0);
});

test('T66: uncongested arrivals retain main times and order', () => {
  const { engine, requests } = ring(1);
  const arrived: number[] = [],
    times: number[] = [];
  for (let i = 0; i < 2000; i++) {
    engine.step();
    for (let id = 1; id <= requests.length; id++) {
      const detail = engine.inspect(id);
      if (detail?.state === 'completed' && !arrived.includes(id)) {
        arrived.push(id);
        times.push(detail.arrivedS!);
      }
    }
  }
  expect(arrived).toEqual([2, 3, 4, 1]);
  expect(times).toEqual([144.1, 144.2, 144.7, 144.9]);
});

test('T66: the ring is deterministic for the same seed', () => {
  const a = ring(10),
    b = ring(10);
  for (let i = 0; i < 2000; i++) {
    a.engine.step();
    b.engine.step();
    if (i % 100 === 0) expect(a.engine.stateHash()).toBe(b.engine.stateHash());
  }
});

function headDiamond(usefulBypass = false, alternateLane = false) {
  const { city, node, road, place } = buildCity('Two head decisions', 1);
  const start = node(-150, 0),
    a = node(0, 0),
    middle = node(0, 100),
    b = node(150, 100),
    goal = node(150, 0),
    back = node(-150, 100);
  a.control = 'yield';
  b.control = 'yield';
  const approachA = road(start, a, { lanes: alternateLane ? 2 : 1 }),
    blockedA = road(a, goal, { lanes: alternateLane ? 2 : 1 });
  const intoB = road(a, middle),
    approachB = road(middle, b),
    blockedB = road(b, goal);
  const intoA = road(b, back, {
      via: [
        { x: 150, y: 200 },
        { x: -150, y: 200 },
      ],
    }),
    returning = road(back, start);
  const destinationRoad = road(goal, node(350, 0));
  if (usefulBypass) {
    const far = node(1200, 100);
    road(b, far);
    road(far, goal, {
      via: [
        { x: 1200, y: -200 },
        { x: 150, y: -200 },
      ],
    });
  }
  const provenance = { source: 'authored' } as const;
  if (alternateLane) {
    start.turnRules = [
      { from: returning.id, to: approachA.id, allowed: false, provenance },
      { from: returning.id, to: approachA.id, fromLane: 0, toLane: 1, allowed: true, provenance },
    ];
    a.turnRules = [
      { from: approachA.id, to: blockedA.id, allowed: false, provenance },
      { from: approachA.id, to: intoB.id, allowed: false, provenance },
      { from: approachA.id, to: intoB.id, fromLane: 0, toLane: 0, allowed: true, provenance },
      ...[0, 1].map((lane) => ({
        from: approachA.id,
        to: blockedA.id,
        fromLane: lane,
        toLane: lane,
        allowed: true,
        provenance,
      })),
    ];
  }
  const initial = setup(city),
    sourceLane = initial.index.lane.get(`${approachA.id}#0`)!;
  const requests: TripRequest[] = [],
    closed: string[] = [];
  const add = (
    name: string,
    from: typeof blockedA,
    at: number,
    to: typeof blockedA,
    positionM: number,
    shut = false,
  ) => {
    place(`${name} origin`, 'gateway', a.pos, [{ road: from, direction: 'out', positionM: at }]);
    const origin = Object.values(city.places).at(-1)!;
    place(`${name} destination`, 'gateway', a.pos, [{ road: to, direction: 'in', positionM }]);
    const destination = Object.values(city.places).at(-1)!;
    if (shut) {
      destination.capacity = 0;
      closed.push(destination.id);
    }
    requests.push({
      id: name,
      personId: null,
      originPlaceId: origin.id,
      destinationPlaceId: destination.id,
      departS: shut ? 100 : 102,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'through',
      legs: [],
    });
  };
  add('block A', blockedA, 6.5, blockedA, 6.5, true);
  add('block B', blockedB, 6.5, blockedB, 6.5, true);
  add('subject', approachA, initial.lanes[sourceLane]!.stopM - 2, destinationRoad, 150);
  const compiled = setup(city),
    engine = createEngine(),
    executed: string[] = [];
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: {
      headDetourS: 3,
      maxReplans: 0,
      gridlock: { respawnS: 1e6, fadeS: 5, maxRespawns: 3 },
    },
    headDetourObserver(id, lane) {
      if (id === 2) executed.push(compiled.lanes[lane]!.id);
    },
  });
  return { city, compiled, engine, closed, executed, approachA, approachB, intoA, intoB };
}

test('T66: two individually nonreturning head choices cannot repeat an earlier unresolved blockage', () => {
  const { city, compiled, engine, closed, executed, approachA, approachB } = headDiamond();
  for (let i = 0; i < 2500; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(executed).toEqual([`${approachA.id}#0`]);
  expect(engine.inspect(3)).toMatchObject({
    lane: compiled.index.lane.get(`${approachB.id}#0`),
    respawns: 0,
  });
  city.places[closed[1]!]!.capacity = null;
  const next = setup(city);
  engine.patch(next);
  for (let i = 0; i < 1500; i++) {
    engine.step();
    sampleConflictZones(engine, next);
  }
  expect(engine.inspect(3)).toMatchObject({ state: 'completed', respawns: 0 });
});

test('T66: a genuinely useful second-head bypass remains available', () => {
  const { compiled, engine, executed, approachB } = headDiamond(true);
  for (let i = 0; i < 6000; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(executed).toContain(`${approachB.id}#0`);
  expect(engine.inspect(3)).toMatchObject({ state: 'completed', respawns: 0 });
});

test('T66: returning in a different usable lane is progress past the earlier blockage', () => {
  const { compiled, engine } = headDiamond(false, true);
  for (let i = 0; i < 4000; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.inspect(3)).toMatchObject({ state: 'completed', respawns: 0 });
});

function boundedSecondWindow(returnLane: 0 | 1 | null) {
  const { city, node, road, place } = buildCity('One further hold window', 1);
  const start = node(0, 0),
    junction = node(100, 0),
    end = node(250, 0),
    corner = node(0, 150);
  const approach = road(start, junction, { lanes: 2 }),
    escape = road(junction, end);
  const goal = node(250, 60),
    exit = road(junction, goal, { roadClass: 'ramp' });
  const final = road(goal, node(250, 200));
  const provenance = { source: 'authored' } as const;
  if (returnLane === null) road(end, goal);
  else {
    road(end, corner);
    const returning = road(corner, start, { lanes: 2 });
    start.turnRules = [
      { from: returning.id, to: approach.id, allowed: false, provenance },
      {
        from: returning.id,
        to: approach.id,
        fromLane: returnLane,
        toLane: returnLane,
        allowed: true,
        provenance,
      },
    ];
  }
  junction.turnRules = [
    { from: approach.id, to: exit.id, allowed: false, provenance },
    { from: approach.id, to: exit.id, fromLane: 1, toLane: 0, allowed: true, provenance },
    { from: approach.id, to: escape.id, allowed: false, provenance },
    { from: approach.id, to: escape.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  const first = setup(city),
    lanes = first.roads[first.index.road.get(approach.id)!]!.lanes;
  const stop = Math.min(...lanes.map((l) => first.lanes[l]!.lengthM)) - 6;
  const requests: TripRequest[] = [],
    closed: string[] = [];
  for (let i = 0; i < 4; i++) {
    const positionM = stop + 1 - i * 22;
    place(`Blocker ${i}`, 'gateway', junction.pos, [
      { road: approach, lane: 1, direction: 'out', positionM },
    ]);
    const origin = Object.values(city.places).at(-1)!;
    place(`Closed ${i}`, 'work', junction.pos, [
      { road: approach, lane: 1, direction: 'in', positionM },
    ]);
    const destination = Object.values(city.places).at(-1)!;
    destination.capacity = 0;
    closed.push(destination.id);
    requests.push({
      id: `queue:${i}`,
      personId: null,
      originPlaceId: origin.id,
      destinationPlaceId: destination.id,
      departS: 100,
      mode: 'car',
      vehicleClass: 'truck',
      purpose: 'private',
      legs: [],
    });
  }
  place('Subject origin', 'gateway', start.pos, [
    { road: approach, lane: 0, direction: 'out', positionM: stop - 15 },
  ]);
  const origin = Object.values(city.places).at(-1)!;
  place('Subject destination', 'gateway', goal.pos, [
    { road: final, direction: 'in', positionM: 100 },
  ]);
  requests.push({
    id: 'subject',
    personId: null,
    originPlaceId: origin.id,
    destinationPlaceId: Object.values(city.places).at(-1)!.id,
    departS: 101,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const net = () => {
    const compiled = setup(city);
    for (const l of lanes) compiled.lanes[l]!.stopM = stop;
    return compiled;
  };
  const compiled = net(),
    engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: {
      spawnMinGapM: 2,
      laneChangeDistanceM: 5,
      maxReplans: 0,
      gridlock: { respawnS: 1e6, fadeS: 5, maxRespawns: 3 },
      vehicleClasses: {
        ...DEFAULT_SIM_PARAMS.vehicleClasses,
        truck: { ...DEFAULT_SIM_PARAMS.vehicleClasses.truck, lengthM: 20 },
      },
    },
  });
  return { city, engine, compiled, net, closed, lanes };
}

test.each([0, 1, null] as const)(
  'T66: only a different-lane return gets one further hold (%s)',
  (returnLane) => {
    const { engine, compiled, lanes } = boundedSecondWindow(returnLane);
    let firstHeld = NaN,
      departed = NaN;
    for (let i = 0; i < 1300; i++) {
      engine.step();
      sampleConflictZones(engine, compiled);
      const car = engine.inspect(5);
      if (!car || car.state !== 'driving') continue;
      if (car.lane === lanes[0] && car.speedMps <= 1.01 && Number.isNaN(firstHeld))
        firstHeld = engine.timeS;
      if (car.lane !== lanes[0] && Number.isNaN(departed)) departed = engine.timeS;
    }
    const wait = departed - firstHeld;
    expect(wait).toBeGreaterThanOrEqual(returnLane === 1 ? 60 : 30);
    expect(wait).toBeLessThan(returnLane === 1 ? 72 : 42);
    expect(engine.inspect(5)!.routeReason).toBe('missed_turn');
  },
);

test('T66: a safe gap during the extra window still takes the original turn', () => {
  const { city, engine, compiled, net, closed, lanes } = boundedSecondWindow(1);
  for (let i = 0; i < 470; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.inspect(5)).toMatchObject({ lane: lanes[0], routeReason: 'initial', respawns: 0 });
  for (const id of closed) city.places[id]!.capacity = null;
  const next = net();
  engine.patch(next);
  for (let i = 0; i < 1300; i++) {
    engine.step();
    sampleConflictZones(engine, next);
  }
  expect(engine.inspect(5)).toMatchObject({
    state: 'completed',
    routeReason: 'initial',
    respawns: 0,
  });
});
