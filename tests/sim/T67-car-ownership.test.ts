import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { allocateId, vehicleClasses, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createParking } from '../../src/sim/parking';
import { createVehicles } from '../../src/sim/vehicle';
import { parkingWorld } from '../parking-world';
import { setup } from './fixtures';

/** The parking world with a six-space strip near home, as in T57. */
function world(streetParkingShare = 1, homeStrip = { occupancyAtStart: null as number | null }) {
  const w = parkingWorld();
  const id = allocateId(w.city, 'pk');
  w.city.parking![id] = {
    id,
    kind: 'roadside',
    name: 'Home strip',
    capacity: 6,
    access: 'public',
    placeId: null,
    connectors: [],
    shape: null,
    strip: { roadId: w.street.id, side: 'right', fromM: 35, toM: 80, layout: 'parallel' },
    ...(homeStrip.occupancyAtStart === null
      ? {}
      : { occupancyAtStart: homeStrip.occupancyAtStart }),
    provenance: { source: 'authored' },
  };
  w.scenario.simParams.streetParkingShare = streetParkingShare;
  // These household car trips drive as given (TASK-113's choice would walk the short ones).
  w.scenario.demand.modeChoice = { enabled: false };
  return { ...w, stripId: id };
}

/** A household car trip of `person` (a member of the world's one home). */
function carTrip(
  w: ReturnType<typeof world>,
  name: string,
  person: string,
  car: number,
  departS: number,
  toHome = false,
): TripRequest {
  return {
    ...w.trip(name, departS),
    personId: `person:${w.home.id}:${person}`,
    carId: `car:hh:${w.home.id}:0:${car}`,
    ...(toHome ? { originPlaceId: w.shop.id, destinationPlaceId: w.home.id } : {}),
  };
}

test('T67 a second driver leaves from where the first parked, waiting for the late car', () => {
  const w = world();
  const requests = [
    carTrip(w, 'a-out', '0', 0, 100),
    carTrip(w, 'a-home', '0', 0, 400, true),
    // The borrower's day starts before the owner is back; the household's other car is free.
    carTrip(w, 'b-out', '1', 0, 401),
    carTrip(w, 'c-out', '2', 1, 402),
  ];
  const engine = createEngine();
  engine.load({ compiled: setup(w.city), trips: requests, scenario: w.scenario });
  type Car = { facility: string | null; space: number | null };
  let parkedAt: Car | null = null;
  let borrowerCar: Car | null = null;
  while (engine.timeS < 3000 && engine.metrics().persons!.completed < 4) {
    engine.step();
    const a = engine.inspectPerson(`person:${w.home.id}:0`)!;
    if (!parkedAt && a.trips[1]!.legs.some((l) => l.kind === 'egress'))
      parkedAt = { ...engine.inspectPerson(`person:${w.home.id}:0`)!.car };
    const b = engine.inspectPerson(`person:${w.home.id}:1`)!;
    if (!borrowerCar && b.currentLeg?.kind === 'access') borrowerCar = { ...b.car };
  }
  expect(engine.metrics().persons!.completed).toBe(4);
  expect(parkedAt!.facility).toBe(w.stripId);
  // Not the other car on the same strip, nor one in the garage: the car the owner parked.
  expect(borrowerCar).toEqual(parkedAt);
  const homeArrival = engine.inspect(2)!.arrivedS!;
  expect(engine.inspectPerson(`person:${w.home.id}:1`)!.trips[0]!.legs[0]!.startedS).toBe(
    homeArrival,
  );
  expect(engine.inspect(3)!.departedS!).toBeGreaterThan(homeArrival);
  const waits = engine.metrics().persons!.carWaits;
  expect(waits.count).toBe(1);
  expect(waits.maxS).toBeCloseTo(homeArrival - 401, 0);
  // The household's other car left from its own space, untouched by the borrower.
  expect(engine.inspect(4)!.departedS!).toBeLessThan(homeArrival);
});

test('T67 a borrower whose car is not back waits for it and takes no other car', () => {
  const w = world();
  const requests = [
    carTrip(w, 'a-out', '0', 0, 100),
    // The owner's return falls after the run's end, so car 0 stays at the shop.
    carTrip(w, 'a-home', '0', 0, 2100, true),
    carTrip(w, 'b-out', '1', 0, 2200),
    carTrip(w, 'c-out', '2', 1, 1000),
  ];
  const engine = createEngine();
  engine.load({ compiled: setup(w.city), trips: requests, scenario: w.scenario });
  engine.step(30000);
  expect(engine.inspect(1)!.state).toBe('completed');
  expect(engine.inspect(2)?.departedS ?? null).toBeNull();
  expect(engine.inspect(4)!.state).toBe('completed');
  expect(engine.inspect(3)?.departedS ?? null).toBeNull();
  const borrower = engine.inspectPerson(`person:${w.home.id}:1`)!;
  expect(borrower.trips[0]!.state).toBe('pending');
  expect(borrower.carId).toBe(`car:hh:${w.home.id}:0:0`);
  // Still waiting: a wait is counted when the car comes back.
  expect(engine.metrics().persons!.carWaits.count).toBe(0);
});

function homeRadiusParking(carIds: boolean, occupancyAtStart: number) {
  const w = world(0, { occupancyAtStart });
  w.home.population = 0; // no inferred home garage
  const compiled = setup(w.city);
  const requests = [carTrip(w, 'out', '0', 0, 100), carTrip(w, 'home', '0', 0, 200, true)].map(
    (trip) => (carIds ? trip : { ...trip, carId: undefined }),
  );
  const vehicles = createVehicles(
    requests.length,
    compiled.lanes.length,
    compiled.movements.length,
  );
  requests.forEach((trip, id) => (vehicles.vclass[id] = vehicleClasses.indexOf(trip.vehicleClass)));
  const parking = createParking(
    compiled,
    requests,
    w.scenario,
    // The lot (141 m from home) lies beyond this radius; the strip (about 40 m) within it.
    { ...DEFAULT_SIM_PARAMS, streetParkingShare: 0, homeParkingRadiusM: 100 },
    vehicles,
  );
  const choose = (timeS: number) => {
    let chosen = -1;
    const ok = parking.choose(1, timeS, (connector) => ((chosen = connector), true));
    vehicles.destination[1] = chosen;
    return ok ? parking.detail(1, timeS).parkingFacility : null;
  };
  return { w, parking, choose, compiled };
}

test('T67 a car going home parks within the home radius while anything there admits it', () => {
  // Room on the strip: within the radius, as before.
  expect(homeRadiusParking(true, 0.5).choose(200)).toBe(homeRadiusParking(true, 0.5).w.stripId);
  // The strip full: before households a car took the lot beyond; a household car going home heads
  // for the strip and searches there, and goes beyond only once the strip has refused it.
  const legacy = homeRadiusParking(false, 1);
  expect(legacy.choose(200)).toBe(legacy.w.id);
  const { w, parking, choose, compiled } = homeRadiusParking(true, 1);
  expect(choose(200)).toBe(w.stripId);
  parking.reject(1, 230);
  expect(choose(230)).toBe(w.id);
  parking.arrive(1, compiled.parking.find((f) => f.id === w.id)!.connectorsIn[0]!, 260);
  expect(parking.metrics(0, 260).home!.beyondRadius).toEqual([
    expect.objectContaining({
      tripId: 'home',
      facility: w.id,
      reason: 'within the radius full or claimed',
    }),
  ]);
});

test('T67 the 07:00 stock is the household cars, each in a space of its own home', () => {
  const w = world(0.5);
  const requests = ['0', '1', '2', '3'].map((person, k) =>
    carTrip(w, `out-${k}`, person, k, 100 + k),
  );
  const compiled = setup(w.city);
  const vehicles = createVehicles(
    requests.length,
    compiled.lanes.length,
    compiled.movements.length,
  );
  const parking = createParking(
    compiled,
    requests,
    w.scenario,
    {
      ...DEFAULT_SIM_PARAMS,
      streetParkingShare: 0.5,
    },
    vehicles,
  );
  const strip = compiled.parking.find((f) => f.id === w.stripId)!;
  const garage = compiled.parking.find((f) => f.place === compiled.index.place.get(w.home.id))!;
  // Four cars, not ceil(round(20 residents x 1) x 1) = 20: half moved to the strip.
  expect(parking.snapshot()[strip.idx]).toBe(2);
  expect(parking.snapshot()[garage.idx]).toBe(2);
  const stock = parking.stockSnapshot();
  const parked = strip.spaces!.filter((s) => stock.occupied[s >> 3]! & (1 << (s & 7)));
  // Every parked car is one of the household's cars, and leaves from its own space.
  for (const space of parked) {
    const id = stock.id[space]! - 1;
    expect(requests[id]!.carId).toMatch(`car:hh:${w.home.id}:`);
    expect(parking.location(id, true).space).toBe(space);
  }
  expect(requests.map((_, id) => parking.location(id, true).facility).sort()).toEqual(
    [garage.idx, garage.idx, strip.idx, strip.idx].sort(),
  );
});

test('T67 town: home stock equals household cars, late shifts borrow, the same seed repeats', () => {
  const city = town();
  // A late-shift workplace: its workers leave home after 18:00, when day workers' cars are back.
  const late = Object.values(city.places).find((p) => p.kind === 'work')!;
  late.profile = {
    arrivals: Array.from({ length: 24 }, (_, hour) => Number(hour === 18)),
    departures: Array.from({ length: 24 }, (_, hour) => Number(hour === 23)),
  };
  const scenario = { ...defaultScenario('town'), startS: 7 * 3600, endS: 9 * 3600 };
  scenario.demand.carShare = 0.5;
  scenario.demand.personsPerResident = 0.2;
  // Every driver drives all day (TASK-113 off): the stock is then every household car driven.
  scenario.demand.modeChoice = { enabled: false };
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  const compiled = setup(city);
  const run = () => {
    const engine = createEngine();
    engine.load({ compiled, trips, scenario, population: persons });
    return engine;
  };
  const engine = run();
  const byHome = new Map<string, number>();
  for (const carId of new Set(trips.flatMap((trip) => trip.carId ?? []))) {
    const home = carId.split(':').slice(2, 4).join(':');
    byHome.set(home, (byHome.get(home) ?? 0) + 1);
  }
  const occupancy = engine.metrics().parking.facilities;
  for (const f of compiled.parking) {
    const place = compiled.places[f.place];
    if (place?.kind !== 'residential') continue;
    expect(occupancy[f.idx]!.occupied).toBe(Math.min(f.capacity, byHome.get(place.id) ?? 0));
  }
  engine.step(7200 * 10);
  const again = run();
  again.step(7200 * 10);
  expect(again.stateHash()).toBe(engine.stateHash());
  const detail = persons
    .map((p) => engine.inspectPerson(p.id))
    .find((d) => d?.carOwner && d.carOwner !== d.id)!;
  expect(detail.household!.members).toContain(detail.carOwner);
});

test('T67 homes of one person replay main: same trips and simulation hashes', () => {
  const city = town();
  for (const place of Object.values(city.places))
    if (place.kind === 'residential') place.population = 1;
  const scenario = defaultScenario('town');
  // TASK-113 off replays main exactly: the hashes below are main's (with TASK-165's rule).
  scenario.demand.modeChoice = { enabled: false };
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  const engine = createEngine();
  engine.load({ compiled: setup(city), trips, scenario, population: persons });
  // Recorded on main cd0b994 (after TASK-154, TASK-153 and PR #1): hashes at 08:00, 12:00 and
  // 18:00 (every person has a car). TASK-165: re-recorded; exit storage is measured beyond the
  // exit crosswalk, so cars wait at the stop line rather than on the stripes.
  const hashes: number[] = [];
  for (const hours of [1, 3, 7]) {
    engine.step(hours * 36000);
    hashes.push(engine.stateHash());
  }
  expect(trips).toHaveLength(1614);
  expect(hashes).toEqual([1843605177, 3544339055, 4008114394]);
});
