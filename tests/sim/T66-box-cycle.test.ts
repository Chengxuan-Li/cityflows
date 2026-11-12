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

function missedChange(returnLane: number, arriveBeforeJunction = false) {
  const { city, node, road, place } = buildCity('Repeated failed change', 1);
  const start = node(0, 0),
    junction = node(100, 0),
    end = node(250, 0),
    corner = node(0, 150);
  const approach = road(start, junction, { lanes: 3 }),
    escape = road(junction, end),
    exit = road(junction, node(100, 150));
  road(end, corner);
  const returning = road(corner, start),
    provenance = { source: 'authored' } as const;
  start.turnRules = [
    { from: returning.id, to: approach.id, allowed: false, provenance },
    {
      from: returning.id,
      to: approach.id,
      fromLane: 0,
      toLane: returnLane,
      allowed: true,
      provenance,
    },
  ];
  junction.turnRules = [
    { from: approach.id, to: exit.id, allowed: false, provenance },
    { from: approach.id, to: exit.id, fromLane: 2, toLane: 0, allowed: true, provenance },
    { from: approach.id, to: escape.id, allowed: false, provenance },
    { from: approach.id, to: escape.id, fromLane: 0, toLane: 0, allowed: true, provenance },
  ];
  const initial = setup(city),
    lanes = initial.roads[initial.index.road.get(approach.id)!]!.lanes;
  const stop = Math.min(...lanes.map((l) => initial.lanes[l]!.lengthM)) - 6;
  const requests: TripRequest[] = [],
    closed: string[] = [];
  for (let i = 0; i < 4; i++) {
    const positionM = stop + 1 - i * 22;
    place(`Queue ${i}`, 'gateway', junction.pos, [
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
  place('Subject destination', 'gateway', junction.pos, [
    {
      road: arriveBeforeJunction ? approach : exit,
      lane: 0,
      direction: 'in',
      positionM: arriveBeforeJunction ? 20 : 100,
    },
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
    const c = setup(city);
    [stop + 1.5, stop + 4.5, stop].forEach((m, i) => (c.lanes[lanes[i]!]!.stopM = m));
    return c;
  };
  const engine = createEngine(),
    compiled = net();
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
  return { city, engine, net, closed, stop, lanes };
}

test('T66: a fallback repeating the exact approach and failed change holds before all crossed stops', () => {
  const { city, engine, net, closed, stop, lanes } = missedChange(0);
  engine.step(800);
  expect(engine.inspect(5)).toMatchObject({ lane: lanes[0], routeReason: 'initial', respawns: 0 });
  expect(engine.inspect(5)!.positionM).toBeLessThanOrEqual(stop - 2 + 1e-8);
  for (const id of closed) city.places[id]!.capacity = null;
  const next = net();
  engine.patch(next);
  for (let i = 0; i < 1500; i++) {
    engine.step();
    sampleConflictZones(engine, next);
  }
  expect(engine.inspect(5)).toMatchObject({
    state: 'completed',
    routeReason: 'initial',
    respawns: 0,
  });
});

test('T66: a bypass into another usable lane remains available', () => {
  const { engine } = missedChange(2);
  engine.step(1800);
  expect(engine.inspect(5)).toMatchObject({
    state: 'completed',
    routeReason: 'missed_turn',
    respawns: 0,
  });
});

test('T66: a return reaching the destination before the failed junction remains available', () => {
  const { engine } = missedChange(0, true);
  engine.step(1800);
  expect(engine.inspect(5)).toMatchObject({ state: 'completed', respawns: 0 });
});

test('T66: an edit moving a crossed stop behind the car releases the bounded hold', () => {
  const { engine, net, lanes } = missedChange(0);
  engine.step(250);
  const next = net();
  next.lanes[lanes[2]!]!.stopM = engine.inspect(5)!.positionM - 1;
  engine.patch(next);
  engine.step(200);
  expect(engine.inspect(5)!.routeReason).toBe('missed_turn');
});
