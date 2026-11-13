import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import type { Scenario, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { modeDraw } from '../../src/demand/mode-choice';
import { parkingWorld } from '../parking-world';
import { setup } from './fixtures';

function townMorning(modeChoice?: Scenario['demand']['modeChoice']) {
  const city = town();
  const scenario = { ...defaultScenario('town'), startS: 7 * 3600, endS: 10 * 3600 };
  scenario.demand.personsPerResident = 0.2;
  scenario.demand.carShare = 0.6;
  if (modeChoice) scenario.demand.modeChoice = modeChoice;
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  return { city, compiled: setup(city), scenario, persons, trips };
}

/** TASK-173: tours choose as they depart; these are the trips of tours that have started. */
function decided(engine: ReturnType<typeof createEngine>, trips: readonly TripRequest[]) {
  const result = new Set<number>();
  const byPerson = new Map<string, number[]>();
  for (const [id, trip] of trips.entries())
    if (trip.personId) byPerson.set(trip.personId, [...(byPerson.get(trip.personId) ?? []), id]);
  for (const [personId, ids] of byPerson) {
    const records = engine.inspectPerson(personId)?.trips ?? [];
    const home = trips[ids[0]!]!.originPlaceId;
    let started = false;
    for (const id of ids.sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b)) {
      if (trips[id]!.originPlaceId === home)
        started = records.find((r) => r.tripId === trips[id]!.id)?.state !== 'pending';
      if (started) result.add(id);
    }
  }
  return result;
}

test('T79 every household car starts parked at home; a tour that walks leaves it there', () => {
  const { compiled, scenario, persons, trips } = townMorning();
  const engine = createEngine();
  engine.load({ compiled, trips, scenario, population: persons });
  // TASK-173: tours choose as they depart, so the stock is every car of a driver's day (TASK-129),
  // whether its tours will drive or walk.
  expect(engine.metrics().tripOutcomes!.map((outcome) => outcome.mode)).toEqual(
    trips.map((trip) => trip.mode),
  );
  const homeOf = (carId: string) => carId.split(':').slice(2, 4).join(':');
  const cars = new Map<string, Set<string>>();
  for (const trip of trips)
    if (trip.carId)
      cars.set(homeOf(trip.carId), (cars.get(homeOf(trip.carId)) ?? new Set()).add(trip.carId));
  const homes = compiled.parking.filter((f) => compiled.places[f.place]?.kind === 'residential');
  const atLoad = engine.metrics().parking.facilities;
  for (const f of homes)
    expect(atLoad[f.idx]!.occupied).toBe(
      Math.min(f.capacity, cars.get(compiled.places[f.place]!.id)?.size ?? 0),
    );
  engine.step(3 * 36000);
  const outcomes = engine.metrics().tripOutcomes!;
  const walked = trips.filter((trip, id) => trip.mode === 'car' && outcomes[id]!.mode === 'walk');
  expect(walked.length).toBeGreaterThan(0);
  for (const trip of walked) {
    const id = trips.indexOf(trip);
    // No car moved for a walked tour, on the way out or home.
    expect(engine.inspect(id + 1)!.parkingFacility).toBeNull();
    const person = engine.inspectPerson(trip.personId!)!;
    const record = person.trips.find((t) => t.tripId === trip.id)!;
    expect(record.legs.every((leg) => leg.kind === 'walk')).toBe(true);
    if (outcomes[id]!.arrivedS !== null) expect(record.state).toBe('completed');
  }
  // Each home keeps every car that has not driven away (no car is back home by 10:00): the cars
  // of days that walked, and of days not yet started.
  const away = new Map<string, Set<string>>();
  for (const [id, trip] of trips.entries())
    if (trip.carId && outcomes[id]!.mode === 'car' && outcomes[id]!.departedS !== null)
      away.set(homeOf(trip.carId), (away.get(homeOf(trip.carId)) ?? new Set()).add(trip.carId));
  const walkedDays = [...cars.values()]
    .flatMap((set) => [...set])
    .filter((car) =>
      trips.every((trip, id) => trip.carId !== car || outcomes[id]!.mode === 'walk'),
    );
  expect(walkedDays.length).toBeGreaterThan(0);
  const now = engine.metrics().parking.facilities;
  for (const f of homes) {
    const place = compiled.places[f.place]!.id;
    expect(now[f.idx]!.occupied).toBe(atLoad[f.idx]!.occupied - (away.get(place)?.size ?? 0));
  }
  const metrics = engine.metrics().persons!.modes;
  expect(metrics.started.walk).toBeGreaterThan(0);
  expect(metrics.started.car).toBeGreaterThan(0);
  expect(metrics.byHour.walk.reduce((a, b) => a + b, 0)).toBe(metrics.started.walk);
  expect(metrics.completed.walk).toBeGreaterThan(0);
  expect(metrics.completed.drive + metrics.completed.driveWalk).toBeGreaterThan(0);
});

test('T79 the same seed gives the same run; off gives the run without a choice', () => {
  const { compiled, scenario, persons, trips } = townMorning();
  const hash = (modeChoice?: Scenario['demand']['modeChoice']) => {
    const engine = createEngine();
    engine.load({
      compiled,
      trips,
      scenario: { ...scenario, demand: { ...scenario.demand, modeChoice } },
      population: persons,
    });
    engine.step(6000);
    return engine.stateHash();
  };
  const on = hash();
  expect(hash()).toBe(on);
  expect(hash({ enabled: false })).not.toBe(on);
});

test('T79 a city whose trips cannot walk runs exactly as without the choice', () => {
  const run = (enabled: boolean) => {
    const { compiled, scenario, persons, trips } = townMorning({ enabled });
    // No place reaches the walk graph, so no trip can walk.
    const unwalkable = { ...compiled, walk: { ...compiled.walk, places: new Map() } };
    const engine = createEngine();
    engine.load({ compiled: unwalkable, trips, scenario, population: persons });
    const modes = engine.metrics().tripOutcomes!.map((outcome) => outcome.mode);
    expect(modes).toEqual(trips.map((trip) => trip.mode));
    const hashes: number[] = [];
    for (let i = 0; i < 3; i++) {
      engine.step(6000);
      hashes.push(engine.stateHash());
    }
    return hashes;
  };
  expect(run(true)).toEqual(run(false));
});

test('T79 mode-share guard on the town: most short trips walk, fewer as they get longer', () => {
  // The unit-tier half of tests/traffic/munich-mode-share.test.ts. Town seeds 1 to 3: local walk
  // share 81% / 77% / 80%; under 1 km 83% / 76% / 80%, 1 to 2 km 71% / 67% / 76%.
  const { compiled, scenario, persons, trips } = townMorning();
  const engine = createEngine();
  engine.load({ compiled, trips, scenario, population: persons });
  engine.step(3 * 36000);
  const modes = engine.metrics().tripOutcomes!.map((outcome) => outcome.mode);
  const chosen = decided(engine, trips);
  const bands = [
    { walk: 0, all: 0 },
    { walk: 0, all: 0 },
  ];
  const place = (id: string) => compiled.places[compiled.index.place.get(id)!]!;
  for (const [id, trip] of trips.entries()) {
    const from = place(trip.originPlaceId),
      to = place(trip.destinationPlaceId);
    if (!trip.personId || from.kind === 'gateway' || to.kind === 'gateway') continue;
    if (trip.vehicleClass !== 'car' || trip.purpose !== 'private' || !chosen.has(id)) continue;
    const meters = Math.hypot(from.centroid.x - to.centroid.x, from.centroid.y - to.centroid.y);
    const band = bands[Number(meters >= 1000)]!;
    band.all++;
    band.walk += Number(modes[id] === 'walk');
  }
  const [near, far] = bands.map((band) => band.walk / band.all) as [number, number];
  const all = (bands[0]!.walk + bands[1]!.walk) / (bands[0]!.all + bands[1]!.all);
  expect(bands[1]!.all).toBeGreaterThan(100);
  expect(all).toBeGreaterThan(0.7);
  expect(all).toBeLessThan(0.9);
  expect(far).toBeLessThan(near - 0.05);
});

test('T79 a tour that walks leaves its car parked; the car’s next driver takes it from home', () => {
  // TASK-173: the owner's tour chooses at 100 s, before the borrower's day: a coin flip per tour
  // (sensitivity 0), with a seed whose draws walk the owner's tour and drive the borrower's.
  const w = parkingWorld();
  const car = `car:hh:${w.home.id}:0:0`;
  const trip = (name: string, person: string, departS: number, toHome = false): TripRequest => ({
    ...w.trip(name, departS),
    personId: `person:${w.home.id}:${person}`,
    carId: car,
    ...(toHome ? { originPlaceId: w.shop.id, destinationPlaceId: w.home.id } : {}),
  });
  const requests = [
    trip('a-out', '0', 100),
    trip('a-home', '0', 400, true),
    trip('b-out', '1', 401),
  ];
  const seed = Array.from({ length: 100 }, (_, i) => i + 1).find(
    (s) => modeDraw(s, 'a-out') < 0.5 && modeDraw(s, 'b-out') >= 0.5,
  )!;
  const scenario = {
    ...w.scenario,
    seed,
    demand: { ...w.scenario.demand, modeChoice: { sensitivityPerMin: 0 } },
  };
  const compiled = setup(w.city);
  const garage = compiled.parking.find((f) => f.place === compiled.index.place.get(w.home.id))!;
  const engine = createEngine();
  engine.load({ compiled, trips: requests, scenario });
  expect(engine.metrics().parking.facilities[garage.idx]!.occupied).toBe(1);
  let borrowerCar: string | null = null;
  while (engine.timeS < 2000 && engine.metrics().persons!.completed < 3) {
    engine.step();
    const b = engine.inspectPerson(`person:${w.home.id}:1`)!;
    if (!borrowerCar && b.currentLeg?.kind === 'access') borrowerCar = b.car.facility;
  }
  expect(engine.metrics().tripOutcomes!.map((outcome) => outcome.mode)).toEqual([
    'walk',
    'walk',
    'car',
  ]);
  expect(engine.metrics().persons!.completed).toBe(3);
  // The car never left for the walked tour: the borrower takes it from its home space at once.
  expect(borrowerCar).toBe(garage.id);
  expect(engine.metrics().persons!.carWaits.count).toBe(0);
  const owner = engine.inspectPerson(`person:${w.home.id}:0`)!;
  expect(engine.inspect(3)!.departedS!).toBeLessThan(owner.trips[1]!.legs[0]!.arrivedS!);
  expect(engine.metrics().parking.facilities[garage.idx]!.occupied).toBe(0);
});
