import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import type { Scenario } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
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

test('T79 walked tours leave their car at home; driven ones stock it and drive it back', () => {
  const { compiled, scenario, persons, trips } = townMorning();
  const engine = createEngine();
  engine.load({ compiled, trips, scenario, population: persons });
  const modes = engine.metrics().tripOutcomes!.map((outcome) => outcome.mode);
  const walked = trips.filter((trip, id) => trip.mode === 'car' && modes[id] === 'walk');
  expect(walked.length).toBeGreaterThan(0);
  // TASK-129's stock: one parked car per household car whose day drives, none for a walked day.
  const byHome = new Map<string, Set<string>>();
  for (const [id, trip] of trips.entries())
    if (trip.carId && modes[id] === 'car') {
      const home = trip.carId.split(':').slice(2, 4).join(':');
      byHome.set(home, (byHome.get(home) ?? new Set()).add(trip.carId));
    }
  const occupancy = engine.metrics().parking.facilities;
  for (const f of compiled.parking) {
    const place = compiled.places[f.place];
    if (place?.kind !== 'residential') continue;
    expect(occupancy[f.idx]!.occupied).toBe(Math.min(f.capacity, byHome.get(place.id)?.size ?? 0));
  }
  engine.step(3 * 36000);
  const outcomes = engine.metrics().tripOutcomes!;
  for (const [id, trip] of trips.entries()) {
    if (modes[id] !== 'walk' || trip.mode !== 'car') continue;
    // No car moved for a walked tour, on the way out or home.
    expect(engine.inspect(id + 1)!.parkingFacility).toBeNull();
    const person = engine.inspectPerson(trip.personId!)!;
    const record = person.trips.find((t) => t.tripId === trip.id)!;
    expect(record.legs.every((leg) => leg.kind === 'walk')).toBe(true);
    if (outcomes[id]!.arrivedS !== null) expect(record.state).toBe('completed');
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
  const modes = engine.metrics().tripOutcomes!.map((outcome) => outcome.mode);
  const bands = [
    { walk: 0, all: 0 },
    { walk: 0, all: 0 },
  ];
  const place = (id: string) => compiled.places[compiled.index.place.get(id)!]!;
  for (const [id, trip] of trips.entries()) {
    const from = place(trip.originPlaceId),
      to = place(trip.destinationPlaceId);
    if (!trip.personId || from.kind === 'gateway' || to.kind === 'gateway') continue;
    if (trip.vehicleClass !== 'car' || trip.purpose !== 'private') continue;
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
