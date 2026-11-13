import { expect, test } from 'vitest';
import { compile } from '../../src/network';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import type { ParkingPose } from '../../src/sim/manoeuvre';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createParking } from '../../src/sim/parking';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { parkingWorld } from '../parking-world';

/** SAT on two 4.5 x 1.8 m car bodies, each given by its front bumper. */
function overlap(a: ParkingPose, b: ParkingPose) {
  const corners = (p: ParkingPose) =>
    [
      [-4.5, -0.9],
      [0, -0.9],
      [0, 0.9],
      [-4.5, 0.9],
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

/** pk:2049's pattern on the authored lot: an entry mouth and an exit mouth at 215 m, where a
 * queue for a slow gateway at 218 m stands across the exit. The gateway lies in the exit's mouth
 * zone, so the queue stands there regardless of TASK-169's keep clear; three cars cover the exit
 * and leave the entry at 205 m free. */
function twoMouthWorld(entryM: number) {
  const w = parkingWorld();
  w.home.kind = 'gateway';
  w.home.population = 0;
  w.shop.jobs = 0;
  const lot = w.city.parking![w.id]!;
  lot.placeId = w.shop.id;
  lot.occupancyAtStart = 0.3;
  lot.connectors = [
    { ...lot.connectors[0]!, positionM: entryM, direction: 'in' },
    {
      id: allocateId(w.city, 'c'),
      roadId: w.street.id,
      lane: 0,
      positionM: 215,
      direction: 'out',
      throughputPerMin: 60,
    },
  ];
  const east = allocateId(w.city, 'p');
  w.city.places[east] = {
    ...w.home,
    id: east,
    name: 'East',
    shape: { kind: 'point', pos: { x: 300, y: -12 } },
    connectors: [
      {
        id: allocateId(w.city, 'c'),
        roadId: w.street.id,
        lane: 0,
        positionM: 218,
        direction: 'in',
        throughputPerMin: 1,
      },
    ],
  };
  const result = compile(w.city);
  if (!result.ok) throw new Error('Two-mouth world compile');
  const through = (name: string, departS: number): TripRequest => ({
    ...w.trip(name, departS),
    personId: null,
    destinationPlaceId: east,
  });
  const leaving = (name: string, departS: number): TripRequest => ({
    ...w.trip(name, departS),
    personId: null,
    originPlaceId: w.shop.id,
    destinationPlaceId: w.home.id,
  });
  return {
    ...w,
    net: result.compiled,
    trips: [
      ...Array.from({ length: 3 }, (_, i) => through(`through:${i}`, 100 + i * 2)),
      leaving('leave:0', 120),
      leaving('leave:1', 124),
      { ...w.trip('arrival', 170), personId: null },
    ],
  };
}

test.each([
  [100, 'its own mouth'],
  // TASK-149's yield used to hold this arrival upstream until both departures had merged.
  [205, 'a mouth on the exit lane, short of the exit'],
])('TASK-153 an arrival at %i m (%s) enters while departures wait for a street gap', (entryM) => {
  const w = twoMouthWorld(entryM),
    engine = createEngine();
  engine.load({ compiled: w.net, trips: w.trips, scenario: { ...w.scenario, endS: 3000 } });
  const lot = [4, 5, 6],
    arrival = 6;
  let besideHold = 0,
    refused = 0,
    contacts = 0;
  for (let step = 0; step < 20000; step++) {
    engine.step();
    const details = lot.map((id) => engine.inspect(id));
    if (details[2]?.state === 'queued_destination') refused++;
    if (
      details[2]?.state === ('in_lot' as string) &&
      details.slice(0, 2).some((d) => d?.parkingPhase === 'exit')
    )
      besideHold++;
    const s = engine.snapshot(),
      poses: ParkingPose[] = [];
    for (let i = 0; i < s.count; i++)
      if (lot.includes(s.id[i]!) && s.state[i] === 6)
        poses.push({ x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! });
    for (let i = 0; i < poses.length; i++)
      for (let j = i + 1; j < poses.length; j++) contacts += Number(overlap(poses[i]!, poses[j]!));
    if (lot.every((id) => engine.inspect(id)?.state === 'completed')) break;
  }
  // Before TASK-153 the arrival waited 124 s (at 100 m) or 120 s (at 205 m) for both departures.
  expect(besideHold).toBeGreaterThan(50);
  expect(refused).toBeLessThan(10);
  expect(contacts).toBe(0);
  for (const id of lot) expect(engine.inspect(id)!.state).toBe('completed');
  expect(engine.inspect(arrival)!.arrivedS).toBeLessThan(engine.inspect(4)!.departedS! + 120);
});

test('TASK-153 an arrival yielding at a shared mouth stops clear of the departure join station', () => {
  // The lot lies upstream of its mouth, so the hold joins the lane short of the connector.
  const w = parkingWorld();
  w.home.kind = 'gateway';
  w.home.population = 0;
  w.shop.jobs = 0;
  const spec = w.city.parking![w.id]!;
  spec.placeId = w.shop.id;
  spec.occupancyAtStart = 0.25;
  spec.shape = {
    kind: 'polygon',
    ring: [
      { x: 60, y: 4 },
      { x: 146, y: 4 },
      { x: 146, y: 30 },
      { x: 60, y: 30 },
    ],
  };
  const result = compile(w.city);
  if (!result.ok) throw new Error('Shared mouth compile');
  const net = result.compiled,
    mouth = net.connectors[net.parking[net.index.parking.get(w.id)!]!.connectorsOut[0]!]!;
  const trips = [
    { ...w.trip('arrival'), personId: null },
    {
      ...w.trip('departure'),
      personId: null,
      originPlaceId: w.shop.id,
      destinationPlaceId: w.home.id,
    },
  ];
  const vehicles = createVehicles(2, net.lanes.length, net.movements.length);
  const parking = createParking(net, trips, w.scenario, DEFAULT_SIM_PARAMS, vehicles);
  vehicles.destination[0] = mouth.idx;
  vehicles.insert(0, mouth.lane, 60);
  vehicles.state[0] = DRIVING;
  expect(parking.startsInLot(1, mouth.idx)).toBe(true);
  parking.depart(1, 100, mouth.idx);
  let joinM = NaN;
  const callbacks = {
    clearLane() {},
    park() {},
    exit(_id: number, _connector: number, positionM: number) {
      joinM = positionM;
      return false;
    },
    resume() {},
  };
  for (let i = 0; i < 400 && parking.motion(1)?.phase !== 'exit'; i++)
    parking.advance(100 + i * DEFAULT_SIM_PARAMS.dtS, callbacks);
  parking.advance(140, callbacks);
  expect(joinM).toBeLessThan(mouth.positionM);
  // The grant's spawn gap: the departure's length plus the spawn gap behind its join station.
  const stop = parking.arrivalStop(0)!;
  expect(stop.lane).toBe(mouth.lane);
  expect(joinM - stop.positionM).toBeGreaterThanOrEqual(
    DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM + DEFAULT_SIM_PARAMS.spawnMinGapM,
  );
});

test('TASK-153 a car leaving a full lot for a place the lot serves keeps a place there', () => {
  // TASK-151's van 2796 at pk:2056: it left its full lot for a destination the same lot serves,
  // chose that lot without a claim, and another car claimed its vacated bay.
  const w = parkingWorld();
  w.home.kind = 'gateway';
  w.home.population = 0;
  const spec = w.city.parking![w.id]!;
  spec.placeId = w.shop.id;
  spec.occupancyAtStart = 1;
  const result = compile(w.city);
  if (!result.ok) throw new Error('Full lot compile');
  const net = result.compiled,
    facility = net.parking[net.index.parking.get(w.id)!]!;
  const visit = (name: string): TripRequest => ({
    ...w.trip(name),
    personId: null,
    originPlaceId: w.shop.id,
    destinationPlaceId: w.shop.id,
  });
  const trips = [visit('leaving'), { ...w.trip('other'), personId: null }];
  const vehicles = createVehicles(2, net.lanes.length, net.movements.length);
  const parking = createParking(net, trips, w.scenario, DEFAULT_SIM_PARAMS, vehicles);
  expect(parking.startsInLot(0, facility.connectorsOut[0]!)).toBe(true);
  expect(parking.snapshot()[facility.idx]).toBe(facility.capacity);
  expect(parking.choose(0, 100, () => 0, true)).toBe(true);
  expect(parking.claimSnapshot().facility[0]).toBe(facility.idx);
  parking.depart(0, 100, facility.connectorsOut[0]!);
  // Its own vacated place is not free for the next car.
  expect(parking.full(facility.connectorsIn[0]!, 1)).toBe(true);
  expect(parking.full(facility.connectorsIn[0]!, 0)).toBe(false);
  parking.assertClaims();
});
