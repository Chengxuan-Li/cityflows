import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import {
  allocateId,
  simParamsSchema,
  type ParkingFacility,
  type TripRequest,
} from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createParking } from '../../src/sim/parking';
import { createVehicles } from '../../src/sim/vehicle';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { scenario } from './fixtures';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { generatePopulation, scheduleTrips } from '../../src/demand';

function parkingWorld() {
  const world = buildCity('Parking choices', 48);
  const { city, node, road, place } = world;
  const a = node(0, 0),
    b = node(600, 0),
    c = node(600, 200),
    d = node(0, 200);
  const roads = [road(a, b), road(b, c), road(c, d), road(d, a)];
  place('Home', 'residential', { x: 20, y: 10 }, [
    { road: roads[0]!, direction: 'both', positionM: 20 },
  ]);
  place('Work', 'work', { x: 200, y: 10 }, [
    { road: roads[0]!, direction: 'both', positionM: 200 },
  ]);
  const [home, work] = Object.values(city.places);
  home!.population = 2;
  work!.jobs = 2;
  city.parking = {};
  function garage(
    owner: string | null,
    x: number,
    capacity: number,
    access: ParkingFacility['access'] = 'public',
  ) {
    const id = allocateId(city, 'pk');
    const facility: ParkingFacility = {
      id,
      kind: 'garage',
      name: id,
      capacity,
      access,
      placeId: owner,
      shape: { kind: 'point', pos: { x, y: 10 } },
      connectors: [
        {
          id: allocateId(city, 'c'),
          roadId: roads[0]!.id,
          lane: 0,
          positionM: x,
          direction: 'both',
          throughputPerMin: 600,
        },
      ],
      provenance: { source: 'authored' },
      occupancyAtStart: 0,
    };
    city.parking![id] = facility;
    return facility;
  }
  const homeGarage = garage(home!.id, 20, 2, 'private');
  homeGarage.occupancyAtStart = 1;
  const own = garage(work!.id, 200, 1, 'customers');
  const near = garage(null, 300, 2);
  const far = garage(null, 550, 2);
  function trip(id: string, origin = home!.id, destination = work!.id, departS = 100): TripRequest {
    return {
      id,
      personId: id,
      originPlaceId: origin,
      destinationPlaceId: destination,
      departS,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    };
  }
  function run(requests = [trip('one')]) {
    const result = compile(city);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error('Invalid parking fixture');
    const engine = createEngine();
    engine.load({ compiled: result.compiled, trips: requests, scenario: scenario(48) });
    return { engine, compiled: result.compiled };
  }
  return { ...world, home: home!, work: work!, homeGarage, own, near, far, garage, trip, run };
}

test('T48 own garage first; a returning car departs from where it parked', () => {
  const w = parkingWorld();
  w.own.capacity = 0;
  const requests = [
    w.trip('one'),
    { ...w.trip('return', w.work.id, w.home.id, 200), personId: 'one' },
  ];
  const { engine } = w.run(requests);
  engine.step(800);
  expect(engine.inspect(1)?.parkingFacility).toBe(w.near.id);
  expect(engine.inspect(1)?.walkingDistanceM).toBe(100);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.near.id)?.occupied).toBe(1);
  engine.step(201);
  // TASK-112: the driver must finish egress and return to this garage on foot first.
  while (engine.timeS < 600 && engine.inspect(2)?.departedS === null) engine.step();
  expect(engine.inspect(2)?.positionM).toBeGreaterThanOrEqual(300);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.near.id)?.occupied).toBe(0);
  engine.step(1800);
  expect(engine.metrics().trips.completed).toBe(2);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.homeGarage.id)?.occupied).toBe(
    2,
  );
});

test('T48 concurrent arrivals recheck full facilities and cruise, deterministically', () => {
  const w = parkingWorld();
  const requests = [w.trip('one'), w.trip('two')];
  const first = w.run(requests).engine,
    second = w.run(requests).engine;
  first.step(1500);
  second.step(1500);
  expect(first.metrics().trips.completed).toBe(2);
  expect(first.inspect(1)?.parkingFacility).toBe(w.own.id);
  expect(first.inspect(2)?.parkingFacility).toBe(w.near.id);
  expect(first.inspect(2)?.parkingSearchTimeS).toBeGreaterThan(0);
  expect(first.metrics().parking.meanSearchTimeS).toBeGreaterThan(0);
  for (const facility of first.metrics().parking.facilities)
    expect(facility.occupied).toBeLessThanOrEqual(facility.capacity);
  expect(first.snapshot().parkingOccupancy).toEqual(second.snapshot().parkingOccupancy);
  expect(first.metrics()).toEqual(second.metrics());
  expect(first.stateHash()).toBe(second.stateHash());
});

test('T48 restricted garages reject other places; beyond-radius fallback and counted exhaustion', () => {
  const w = parkingWorld();
  w.own.capacity = 0;
  w.near.access = 'private';
  w.far.shape = { kind: 'point', pos: { x: 900, y: 10 } };
  const { engine } = w.run();
  engine.step(1500);
  expect(engine.inspect(1)?.parkingFacility).toBe(w.far.id);
  expect(engine.inspect(1)?.walkingDistanceM).toBe(700);
  w.far.capacity = 0;
  const failed = w.run().engine;
  failed.step(200); // TASK-112: access to the garage precedes the parking-route check.
  expect(failed.metrics().failedByReason.no_parking).toBe(1);
  expect(failed.metrics().parking.failed).toBe(1);
});

test('T48 old and authored cities infer private garages without changing the source city', () => {
  const w = parkingWorld();
  delete w.city.parking;
  const before = structuredClone(w.city);
  const result = compile(w.city);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Compile failed');
  expect(result.compiled.parking).toHaveLength(2);
  expect(
    result.compiled.parking.every(
      (f) => f.access === 'private' && f.source.provenance.inferred?.includes('implicitGarage'),
    ),
  ).toBe(true);
  expect(w.city).toEqual(before);
});

test('T48 implicit garages with ample capacity preserve grid morning completions within one percent', () => {
  const city = grid5x5(48),
    config = { ...scenario(48), startS: 7 * 3600, endS: 9 * 3600 };
  config.demand.personsPerResident = 0.03;
  const requests = scheduleTrips(city, generatePopulation(city, config.demand), config);
  const result = compile(city);
  if (!result.ok) throw new Error('Invalid grid');
  const legacy = {
    ...result.compiled,
    connectors: result.compiled.connectors.map((c) => ({ ...c })),
    parking: [],
    index: { ...result.compiled.index, parking: new Map() },
  };
  for (const connector of legacy.connectors) delete connector.parking;
  const engine = createEngine(),
    reference = createEngine();
  engine.load({ compiled: result.compiled, trips: requests, scenario: config });
  reference.load({ compiled: legacy, trips: requests, scenario: config });
  engine.step(72000);
  reference.step(72000);
  expect(reference.metrics().trips.completed).toBeGreaterThan(20);
  expect(
    Math.abs(engine.metrics().trips.completed - reference.metrics().trips.completed),
  ).toBeLessThanOrEqual(reference.metrics().trips.completed * 0.01);
  expect(engine.metrics().failedByReason.no_parking).toBe(0);
});

test('T48 explicit starting occupancy and weekday work defaults are bounded', () => {
  const w = parkingWorld();
  w.own.capacity = 10;
  delete w.own.occupancyAtStart;
  const result = compile(w.city);
  if (!result.ok) throw new Error('Invalid parking city');
  const engine = createEngine();
  const config = { ...scenario(), startS: 12 * 3600, endS: 13 * 3600 };
  engine.load({ compiled: result.compiled, trips: [], scenario: config });
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.own.id)?.occupied).toBe(7);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.homeGarage.id)?.occupied).toBe(
    2,
  );
});

test('T48 one mapped garage cannot suppress parking for an aggregate block of buildings', () => {
  const w = parkingWorld();
  w.work.jobs = 100;
  w.work.provenance = { source: 'osm', osmIds: [1, 2], inferred: ['blockAggregation'] };
  const result = compile(w.city);
  if (!result.ok) throw new Error('Invalid parking city');
  const facilities = result.compiled.parking.filter(
    (f) => f.place === result.compiled.index.place.get(w.work.id),
  );
  expect(facilities).toHaveLength(2);
  expect(facilities.reduce((sum, f) => sum + f.capacity, 0)).toBe(100);
  expect(w.own.capacity).toBe(1);
});

test('T48 departures allocate the counted initial cars across all home garages', () => {
  const w = parkingWorld();
  w.homeGarage.capacity = 1;
  const second = w.garage(w.home.id, 35, 1, 'private');
  second.occupancyAtStart = 1;
  w.own.capacity = 3;
  const { engine } = w.run([w.trip('one'), w.trip('two'), w.trip('three')]);
  engine.step(500); // TASK-112: reach the second garage, 15 m farther from the home.
  expect(engine.inspect(2)?.route?.roads.length).toBeGreaterThan(0);
  expect(engine.inspect(2)?.departedS).not.toBeNull();
  expect(engine.metrics().failedByReason.no_parking).toBe(1);
  expect(
    engine
      .metrics()
      .parking.facilities.filter((f) => [w.homeGarage.id, second.id].includes(f.id))
      .map((f) => f.occupied),
  ).toEqual([0, 0]);
});

test('T48 a live capacity edit cannot erase parked stock', () => {
  const w = parkingWorld(),
    { engine } = w.run([]);
  w.homeGarage.capacity = 1;
  const result = compile(w.city);
  if (!result.ok) throw new Error('Invalid parking edit');
  expect(() => engine.patch(result.compiled)).toThrow(/occupied/);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.homeGarage.id)?.occupied).toBe(
    2,
  );
});

test('T48 deleting an approaching garage entry chooses another facility instead of a place portal', () => {
  const w = parkingWorld(),
    { engine } = w.run();
  engine.step(20);
  w.own.connectors = [];
  const result = compile(w.city);
  if (!result.ok) throw new Error('Invalid entry edit');
  engine.patch(result.compiled);
  engine.step(1000);
  expect(engine.metrics().trips.completed).toBe(1);
  expect(engine.inspect(1)?.parkingFacility).toBe(w.near.id);
  expect(engine.metrics().parking.arrivals).toBe(1);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.near.id)?.occupied).toBe(1);
});

test('T48 a class can depart through the second usable garage exit', () => {
  const w = parkingWorld();
  const road = w.city.roads[w.homeGarage.connectors[0]!.roadId]!;
  road.lanes[0]!.allowed = ['car'];
  road.lanes.push({ widthM: 3, allowed: ['car', 'van', 'truck', 'bus'] });
  w.homeGarage.connectors.push({
    ...w.homeGarage.connectors[0]!,
    id: allocateId(w.city, 'c'),
    lane: 1,
  });
  w.own.connectors[0]!.lane = 1;
  const { engine } = w.run([{ ...w.trip('truck'), vehicleClass: 'truck' }]);
  engine.step(1200);
  expect(engine.metrics().trips.completed).toBe(1);
  expect(engine.inspect(1)?.parkingFacility).toBe(w.own.id);
});

test('T48 a car chain uses a garage even when the activity place has no road portal', () => {
  const w = parkingWorld();
  w.work.connectors = [];
  const { engine } = w.run([
    w.trip('one'),
    { ...w.trip('return', w.work.id, w.home.id, 200), personId: 'one' },
  ]);
  engine.step(4000);
  expect(engine.metrics().trips.completed).toBe(2);
  expect(engine.metrics().trips.failed).toBe(0);
});

test('T48 a public facility is reusable after departure from a different activity place', () => {
  const w = parkingWorld();
  const road = w.city.roads[w.near.connectors[0]!.roadId]!;
  w.place('Public parking', 'parking', { x: 300, y: 15 }, [
    { road, direction: 'both', positionM: 300 },
  ]);
  const owner = Object.values(w.city.places).find((p) => p.name === 'Public parking')!;
  owner.capacity = 1;
  w.near.placeId = owner.id;
  w.near.capacity = 1;
  w.own.capacity = 0;
  const { engine } = w.run([
    w.trip('one'),
    { ...w.trip('return', w.work.id, w.home.id, 200), personId: 'one' },
    w.trip('two', w.home.id, w.work.id, 500),
  ]);
  engine.step(6500);
  expect(engine.metrics().trips.completed).toBe(3);
  expect(engine.metrics().parking.arrivals).toBe(3);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.near.id)?.occupied).toBe(1);
});

test('T48 removing one entrance keeps an own garage with a second entrance eligible', () => {
  const w = parkingWorld();
  w.own.connectors.push({ ...w.own.connectors[0]!, id: allocateId(w.city, 'c'), positionM: 250 });
  const { engine } = w.run();
  engine.step(20);
  w.own.connectors.shift();
  const edited = compile(w.city);
  if (!edited.ok) throw new Error('Invalid entry edit');
  engine.patch(edited.compiled);
  engine.step(1500);
  expect(engine.inspect(1)?.parkingFacility).toBe(w.own.id);
});

test('T48 access changes are checked again on arrival', () => {
  const w = parkingWorld();
  w.own.capacity = 0;
  const { engine } = w.run();
  engine.step(20);
  w.near.access = 'private';
  const edited = compile(w.city);
  if (!edited.ok) throw new Error('Invalid access edit');
  engine.patch(edited.compiled);
  engine.step(1500);
  expect(engine.inspect(1)?.parkingFacility).toBe(w.far.id);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.near.id)?.occupied).toBe(0);
});

test('T48 saved scenarios retain and validate the parking search radius', () => {
  expect(simParamsSchema.parse({ parkingSearchRadiusM: 250 })).toMatchObject({
    parkingSearchRadiusM: 250,
  });
  expect(simParamsSchema.safeParse({ parkingSearchRadiusM: -1 }).success).toBe(false);
});

test('T48 a place and its inferred polygon garage share a centroid and have no walk egress', () => {
  const w = parkingWorld();
  delete w.city.parking;
  w.work.shape = {
    kind: 'polygon',
    ring: [
      { x: 200, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 10 },
      { x: 200, y: 100 },
    ],
  };
  const { engine, compiled } = w.run();
  const f = compiled.parking.find((f) => f.place === compiled.index.place.get(w.work.id))!;
  expect(f.centroid).toEqual(compiled.places[f.place]!.centroid);
  engine.step(1500);
  expect(engine.inspect(1)?.walkingDistanceM).toBe(0);
});

test('T48 gateway traffic remains unlimited even if a garage names the gateway', () => {
  const w = parkingWorld();
  w.home.kind = 'gateway';
  w.work.kind = 'gateway';
  w.homeGarage.capacity = 0;
  const { engine } = w.run([{ ...w.trip('through'), purpose: 'through' }]);
  engine.step(1500);
  expect(engine.metrics().trips.completed).toBe(1);
  expect(engine.metrics().parking.arrivals).toBe(0);
  expect(engine.inspect(1)?.parkingFacility).toBeNull();
});

test('T48 the parking hash reflects choice, departure, arrival and added facilities', () => {
  const w = parkingWorld(),
    requests = [w.trip('one')];
  const compiled = compile(w.city);
  if (!compiled.ok) throw new Error('Invalid parking fixture');
  const vehicles = createVehicles(
    1,
    compiled.compiled.lanes.length,
    compiled.compiled.movements.length,
  );
  const parking = createParking(
    compiled.compiled,
    requests,
    scenario(),
    DEFAULT_SIM_PARAMS,
    vehicles,
  );
  const initial = parking.stateHash();
  expect(parking.choose(0, 100, () => true)).toBe(true);
  const chosen = parking.stateHash();
  expect(chosen).not.toBe(initial);
  parking.depart(0);
  const departed = parking.stateHash();
  expect(departed).not.toBe(chosen);
  const own = compiled.compiled.parking[compiled.compiled.index.parking.get(w.own.id)!]!;
  parking.arrive(0, own.connectorsIn[0]!, 120);
  const arrived = parking.stateHash();
  expect(arrived).not.toBe(departed);
  w.garage(null, 400, 2);
  const next = compile(w.city);
  if (!next.ok) throw new Error('Invalid parking edit');
  parking.patch(next.compiled);
  expect(parking.stateHash()).not.toBe(arrived);
});
