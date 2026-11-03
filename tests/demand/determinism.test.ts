import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';

test('seeded populations and trips repeat, with tied trips ordered by id', () => {
  const city = grid5x5();
  const scenario = defaultScenario('grid5x5');
  scenario.demand.carShare = 0.5;
  scenario.demand.workStart.sdS = 0;
  scenario.demand.workDuration.sdS = 0;
  const persons = generatePopulation(city, scenario.demand);

  expect(persons.some((person) => person.hasCar)).toBe(true);
  expect(persons.some((person) => !person.hasCar)).toBe(true);
  expect(generatePopulation(city, scenario.demand)).toEqual(persons);
  const trips = scheduleTrips(city, persons, scenario);
  expect(scheduleTrips(city, [...persons].reverse(), scenario)).toEqual(trips);
  expect(scheduleTrips(city, generatePopulation(city, scenario.demand), scenario)).toEqual(trips);
  expect(trips).toEqual([...trips].sort((a, b) => a.departS - b.departS || (a.id < b.id ? -1 : 1)));

  const other = defaultScenario('grid5x5', 2);
  other.demand.carShare = 0.5;
  expect(scheduleTrips(city, generatePopulation(city, other.demand), other)).not.toEqual(trips);
});

test('adding a populated gateway preserves existing person streams', () => {
  const city = grid5x5();
  const [home] = Object.values(city.places);
  home!.population = 100;
  const scenario = defaultScenario('grid5x5');
  scenario.demand.personsPerResident = 0.2;
  scenario.demand.carShare = 0.5;
  const original = generatePopulation(city, scenario.demand);
  const originalTrips = scheduleTrips(city, original, scenario);

  const gatewayId = 'p:0';
  city.places[gatewayId] = { ...home!, id: gatewayId, kind: 'gateway', connectors: [] };
  const expanded = generatePopulation(city, scenario.demand);
  expect(expanded.filter((person) => person.homePlaceId === gatewayId)).toHaveLength(20);
  const expandedTrips = scheduleTrips(city, expanded, scenario);
  expect(expanded.filter((person) => person.homePlaceId === home!.id)).toEqual(original);
  const originalIds = new Set(original.map((person) => person.id));
  expect(expandedTrips.filter((trip) => originalIds.has(trip.personId!))).toEqual(originalTrips);
});

test('without jobs residents keep a home agenda and generate no trips', () => {
  const city = grid5x5();
  for (const place of Object.values(city.places)) place.jobs = 0;
  const scenario = defaultScenario('grid5x5');
  const persons = generatePopulation(city, scenario.demand);

  expect(persons.length).toBeGreaterThan(0);
  expect(scheduleTrips(city, persons, scenario)).toEqual([]);
  for (const person of persons) {
    expect(person.workPlaceId).toBeNull();
    expect(person.agenda).toEqual([
      { kind: 'home', placeId: person.homePlaceId, startS: 0, durationS: 86400 },
    ]);
  }
});
