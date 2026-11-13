import { expect, test } from 'vitest';
import { buildCity, generated } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile, type CompiledCity } from '../../src/network';
import { allocateId, type City, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { departureMisses } from '../../src/network/parking';
import { bodyClearLane, bodyClearOf } from '../../src/sim/manoeuvre';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createParking } from '../../src/sim/parking';
import { createVehicles } from '../../src/sim/vehicle';

type Pose = { x: number; y: number; heading: number };
const { lengthM, widthM } = DEFAULT_SIM_PARAMS.vehicleClasses.car;

/** SAT on two car bodies, each given by its front bumper. */
function overlap(a: Pose, b: Pose) {
  const corners = (p: Pose) =>
    [
      [-lengthM, -widthM / 2],
      [0, -widthM / 2],
      [0, widthM / 2],
      [-lengthM, widthM / 2],
    ].map(([x, y]) => ({
      x: p.x + x! * Math.cos(p.heading) - y! * Math.sin(p.heading),
      y: p.y + x! * Math.sin(p.heading) + y! * Math.cos(p.heading),
    }));
  return ![a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2].some((h) => {
    const project = (p: { x: number; y: number }) => p.x * Math.cos(h) + p.y * Math.sin(h),
      aa = corners(a).map(project),
      bb = corners(b).map(project);
    return Math.max(...aa) <= Math.min(...bb) + 1e-4 || Math.max(...bb) <= Math.min(...aa) + 1e-4;
  });
}

const trip = (name: string, origin: string, destination: string, departS: number): TripRequest => ({
  id: name,
  personId: null,
  originPlaceId: origin,
  destinationPlaceId: destination,
  departS,
  mode: 'car',
  vehicleClass: 'car',
  purpose: 'private',
  legs: [],
});

/**
 * TASK-152's loop (a m b c n d) with a parking aisle road from m down to n. `twoWay`: the aisle
 * is a two-way street whose southbound half is a dead end at n, and the lot (its west row, beside
 * that half) is entered on it at m and left on the northbound half at m, like Munich pk:2050.
 * `westExit` adds a second way out, onto the street a-m, which no lane car on the aisle reaches.
 * Otherwise the aisle is one-way north, entered at n, and through traffic queues along it.
 */
function aisleWorld(kind: 'two-way' | 'one-way', westExit = false) {
  const { city, node, road, street, place } = buildCity('Lot aisle lanes', 156);
  const a = node(0, 0),
    m = node(200, 0),
    b = node(400, 0),
    c = node(400, 120),
    n = node(200, 120),
    d = node(0, 120);
  const west = road(a, m),
    east = road(m, b);
  road(b, c);
  const south = road(c, n),
    southWest = road(n, d);
  const left = road(d, a);
  const aisles = kind === 'two-way' ? street(m, n) : [road(n, m)];
  for (const r of aisles) r.roadClass = 'service';
  if (kind === 'two-way')
    n.turnRules = [southWest, aisles[1]!].map((to) => ({
      from: aisles[0]!.id,
      to: to.id,
      allowed: false,
      provenance: generated,
    }));
  place('Shop', 'retail', { x: 240, y: 60 }, []);
  place('South out', 'gateway', { x: 400, y: 130 }, [
    { road: south, positionM: 20, direction: 'out' },
  ]);
  place('East in', 'gateway', { x: 380, y: -10 }, [{ road: east, positionM: 5, direction: 'in' }]);
  place('Home in', 'gateway', { x: -10, y: 60 }, [{ road: left, positionM: 60, direction: 'in' }]);
  const [shop, southOut, eastIn, homeIn] = Object.values(city.places);
  for (const p of Object.values(city.places)) p.population = p.jobs = 0;
  // Through traffic's destination admits one car per 20 s just past the aisle, so it queues
  // back along the aisle lane.
  eastIn!.connectors[0]!.throughputPerMin = 3;
  const id = allocateId(city, 'pk');
  const connector = (road: City['roads'][string], positionM: number, direction: 'in' | 'out') => ({
    id: allocateId(city, 'c'),
    roadId: road.id,
    lane: 0,
    positionM,
    direction,
    throughputPerMin: 30,
  });
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 0,
      access: 'public',
      placeId: shop!.id,
      connectors:
        kind === 'two-way'
          ? [
              connector(aisles[0]!, 0, 'in'),
              connector(aisles[1]!, 110, 'out'),
              ...(westExit ? [connector(west, 186, 'out')] : []),
            ]
          : [],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 185, y: 10 },
          { x: kind === 'two-way' ? 199 : 215, y: 10 },
          { x: kind === 'two-way' ? 199 : 215, y: 110 },
          { x: 185, y: 110 },
        ],
      },
      aisles: aisles.map((r) => r.id),
      entries: kind === 'two-way' ? [m.id] : [m.id, n.id],
      occupancyAtStart: 0,
      provenance: { source: 'authored' },
    },
  };
  return {
    city,
    id,
    aisles,
    shop: shop!.id,
    southOut: southOut!.id,
    eastIn: eastIn!.id,
    homeIn: homeIn!.id,
  };
}

function compiled(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

function stockOne(city: City, id: string) {
  const first = compiled(city);
  city.parking![id]!.occupancyAtStart = 1 / first.parking[first.index.parking.get(id)!]!.capacity;
  return compiled(city);
}

const lane = (net: CompiledCity, road: City['roads'][string]) =>
  net.lanes[net.index.lane.get(`${road.id}#0`)!]!;

test('TASK-156 a bay on the dead-end half of a two-way aisle leaves into the other half, which passes its exit, and never waits in the lot', () => {
  const w = aisleWorld('two-way');
  const net = stockOne(w.city, w.id);
  const lot = net.parking[net.index.parking.get(w.id)!]!;
  const deadEnd = lane(net, w.aisles[0]!),
    through = lane(net, w.aisles[1]!);
  // The bays line the southbound half, which no lane car reaches past its entry at m.
  expect(lot.spaces!.length).toBeGreaterThan(20);
  for (const i of lot.spaces!) {
    const space = net.parkingSpaces![i]!;
    expect(space.lane).toBe(deadEnd.idx);
    expect(net.connectors[space.departure!]!.lane).toBe(through.idx);
  }
  const scenario = { ...defaultScenario('grid5x5', 156), startS: 100, endS: 900 };
  const trips = [trip('leaving', w.shop, w.homeIn, 160)];
  const engine = createEngine();
  engine.load({ compiled: net, trips, scenario });
  const phases = new Set<string>();
  for (let step = 0; step < 8000; step++) {
    engine.step();
    const detail = engine.inspect(1);
    if (!detail) continue;
    if (detail.parkingPhase) phases.add(detail.parkingPhase);
    const s = engine.snapshot();
    const at = [...s.id].indexOf(1);
    // It never stands still inside the dead-end half's band.
    if (at !== -1 && s.speed[at]! < 1e-6 && detail.state !== 'queued_origin')
      expect(
        bodyClearLane(
          { x: s.x[at]!, y: s.y[at]!, heading: s.heading[at]! },
          deadEnd,
          lengthM,
          widthM,
        ),
        `stands in ${deadEnd.id} at ${engine.timeS}`,
      ).toBe(true);
    if (detail.state === 'completed' || detail.state === 'failed') break;
  }
  expect([...phases]).toEqual(['leave']);
  expect(engine.inspect(1)!.state).toBe('completed');
});

test('TASK-164 a bay whose aisle departure misses an exit keeps that exit, and each exit keeps its share of the draw', () => {
  const w = aisleWorld('two-way', true);
  w.city.parking![w.id]!.occupancyAtStart = 1;
  const net = compiled(w.city);
  const lot = net.parking[net.index.parking.get(w.id)!]!;
  const through = lane(net, w.aisles[1]!);
  const west = lot.connectorsOut.find((c) => net.connectors[c]!.lane !== through.idx)!;
  const street = net.lanes[net.connectors[west]!.lane]!;
  expect(lot.connectorsOut.length).toBe(2);
  expect(lot.spaces!.length).toBeGreaterThan(20);
  // Every bay leaves into the through half, which passes the aisle exit but not the west one.
  for (const i of lot.spaces!) {
    expect(net.connectors[net.parkingSpaces![i]!.departure!]!.lane).toBe(through.idx);
    expect(departureMisses(net, i)).toEqual([west]);
  }
  const trips = Array.from({ length: 16 }, (_, i) =>
    trip(`leave:${i}`, w.shop, w.homeIn, 160 + i * 25),
  );
  const scenario = { ...defaultScenario('grid5x5', 164), startS: 100, endS: 2500 };
  const vehicles = createVehicles(trips.length, net.lanes.length, net.movements.length);
  const parking = createParking(net, trips, scenario, DEFAULT_SIM_PARAMS, vehicles);
  for (let id = 0; id < trips.length; id++) {
    const departure = net.parkingSpaces![parking.location(id, true).space]!.departure!;
    expect(parking.exits(id, [])).toEqual([departure, west]);
    expect([departure, west].map((c) => parking.exitShare(id, c))).toEqual([30, 30]);
  }
  const engine = createEngine();
  engine.load({ compiled: net, trips, scenario });
  const lotExit = new Set<number>();
  for (let step = 0; step < 24000; step++) {
    engine.step();
    const s = engine.snapshot();
    for (let at = 0; at < s.count; at++) {
      const detail = engine.inspect(s.id[at]!)!;
      if (detail.parkingPhase === 'drive_out') lotExit.add(s.id[at]!);
      // A car leaving by the west exit waits clear of the street and of the through half, where
      // lane cars drive (it may touch the dead-end half only past the entry, where none can).
      if (detail.parkingPhase === 'exit')
        for (const band of [street, through])
          expect(
            bodyClearOf(
              { x: s.x[at]!, y: s.y[at]!, heading: s.heading[at]! },
              band,
              lengthM,
              widthM,
            ),
            `car ${s.id[at]} holds in ${band.id}`,
          ).toBe(true);
    }
    if (trips.every((_, i) => ['completed', 'failed'].includes(engine.inspect(i + 1)?.state ?? '')))
      break;
  }
  // Both ways out are used.
  expect(lotExit.size).toBeGreaterThan(0);
  expect(lotExit.size).toBeLessThan(trips.length);
  expect(trips.every((_, i) => engine.inspect(i + 1)!.state === 'completed')).toBe(true);
});

test('TASK-156 lot arrivals on an aisle lane never overlap the cars queued in it, and every car arrives', () => {
  const w = aisleWorld('one-way');
  const net = compiled(w.city);
  const scenario = {
    ...defaultScenario('grid5x5', 156),
    startS: 100,
    endS: 1500,
    simParams: { streetParkingShare: 0 },
  };
  const through = Array.from({ length: 10 }, (_, i) =>
    trip(`through:${i}`, w.southOut, w.eastIn, 100 + i * 4),
  );
  const arrivals = Array.from({ length: 8 }, (_, i) =>
    trip(`arrive:${i}`, w.southOut, w.shop, 102 + i * 5),
  );
  const trips = [...through, ...arrivals];
  const engine = createEngine();
  engine.load({ compiled: net, trips, scenario });
  const arriving = new Set(arrivals.map((_, i) => through.length + i + 1));
  let samples = 0,
    overlaps = 0;
  for (let step = 0; step < 14000; step++) {
    engine.step();
    const s = engine.snapshot();
    for (let i = 0; i < s.count; i++) {
      if (!arriving.has(s.id[i]!)) continue;
      const phase = engine.inspect(s.id[i]!)!.parkingPhase;
      if (phase !== 'drive_in' && phase !== 'park') continue;
      samples++;
      const pose = { x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! };
      for (let j = 0; j < s.count; j++)
        if (j !== i && overlap(pose, { x: s.x[j]!, y: s.y[j]!, heading: s.heading[j]! }))
          overlaps++;
    }
    if (trips.every((_, i) => ['completed', 'failed'].includes(engine.inspect(i + 1)?.state ?? '')))
      break;
  }
  expect(samples).toBeGreaterThan(100);
  expect(overlaps).toBe(0);
  expect(engine.metrics().trips.failed).toBe(0);
  expect(trips.every((_, i) => engine.inspect(i + 1)!.state === 'completed')).toBe(true);
});

test('TASK-164 on a private aisle a bay departure never starts onto or just ahead of an arriving lot car', () => {
  const w = aisleWorld('one-way');
  for (const road of w.aisles) road.access = { all: 'private' };
  w.city.parking![w.id]!.occupancyAtStart = 0.5;
  const net = compiled(w.city);
  const lot = net.parking[net.index.parking.get(w.id)!]!;
  expect(lot.spaces!.every((i) => net.parkingSpaces![i]!.departure !== undefined)).toBe(true);
  const scenario = {
    ...defaultScenario('grid5x5', 164),
    startS: 100,
    endS: 2500,
    simParams: { streetParkingShare: 0 },
  };
  const arrivals = Array.from({ length: 12 }, (_, i) =>
    trip(`arrive:${i}`, w.southOut, w.shop, 100 + i * 6),
  );
  const departures = Array.from({ length: 12 }, (_, i) =>
    trip(`leave:${i}`, w.shop, w.homeIn, 103 + i * 6),
  );
  const trips = [...arrivals, ...departures];
  const engine = createEngine();
  engine.load({ compiled: net, trips, scenario });
  const arriving = new Set(arrivals.map((_, i) => i + 1));
  const started = new Map<number, number>();
  let samples = 0,
    conflicts = 0;
  for (let step = 0; step < 24000; step++) {
    engine.step();
    const s = engine.snapshot();
    const poses = new Map<number, Pose>();
    for (let i = 0; i < s.count; i++)
      poses.set(s.id[i]!, { x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! });
    for (const [id, pose] of poses) {
      const detail = engine.inspect(id)!;
      if (arriving.has(id) || detail.parkingPhase !== 'leave') continue;
      if (!started.has(id)) started.set(id, engine.timeS);
      if (engine.timeS - started.get(id)! > 4) continue;
      // While it backs out, no arriving lot car is within the following gap of its body along
      // the aisle, nor overlaps it.
      for (const other of arriving) {
        const theirs = poses.get(other);
        const phase = engine.inspect(other)?.parkingPhase;
        if (!theirs || (phase !== 'drive_in' && phase !== 'park')) continue;
        samples++;
        const grown = {
          x: theirs.x + Math.cos(theirs.heading) * DEFAULT_SIM_PARAMS.idm.minGapM,
          y: theirs.y + Math.sin(theirs.heading) * DEFAULT_SIM_PARAMS.idm.minGapM,
          heading: theirs.heading,
        };
        if (overlap(pose, theirs) || overlap(pose, grown)) conflicts++;
      }
    }
    if (trips.every((_, i) => ['completed', 'failed'].includes(engine.inspect(i + 1)?.state ?? '')))
      break;
  }
  expect(started.size).toBe(departures.length);
  expect(samples).toBeGreaterThan(0);
  expect(conflicts).toBe(0);
  expect(trips.every((_, i) => engine.inspect(i + 1)!.state === 'completed')).toBe(true);
});
