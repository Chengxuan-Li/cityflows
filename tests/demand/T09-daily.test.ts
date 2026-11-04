import { expect, test } from 'vitest';
import { demandSummary, generatePopulation, scheduleTrips } from '../../src/demand';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import type { Place } from '../../src/schema';

function addPlace(city: ReturnType<typeof grid5x5>, kind: Place['kind'], weight = 1) {
  const id = `p:${city.nextId++}`;
  const place: Place = {
    ...Object.values(city.places)[0]!,
    id,
    kind,
    population: 0,
    jobs: 0,
    attraction: weight,
    connectors: [],
    events: [],
  };
  city.places[id] = place;
  return place;
}

test('T09 full chains reconcile directional peaks, attraction weights and person streams', () => {
  const city = grid5x5();
  const [home, work] = Object.values(city.places);
  home!.population = 400;
  const shop = addPlace(city, 'retail');
  const school = addPlace(city, 'school');
  const park = addPlace(city, 'other', 9);
  const quiet = addPlace(city, 'other', 1);
  const scenario = defaultScenario('grid5x5');
  scenario.demand.workStart.sdS = 0;
  scenario.demand.workDuration.sdS = 0;
  scenario.demand.chains = { schoolShare: 0.25, shopShare: 0.5, leisureShare: 1 };
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  const students = persons.filter((p) => p.agenda.some((a) => a.kind === 'school'));
  expect(students.length).toBeGreaterThan(60);
  expect(students.length).toBeLessThan(140);
  expect(trips.filter((t) => t.destinationPlaceId === shop.id).length).toBeGreaterThan(100);
  expect(trips.filter((t) => t.destinationPlaceId === park.id).length).toBeGreaterThan(
    4 * trips.filter((t) => t.destinationPlaceId === quiet.id).length,
  );
  const morning = trips.filter((t) => t.departS < 10 * 3600);
  expect(morning).toHaveLength(400);
  expect(
    morning.every(
      (t) => t.originPlaceId === home!.id && [work!.id, school.id].includes(t.destinationPlaceId),
    ),
  ).toBe(true);
  expect(
    trips.filter((t) => t.departS >= 14 * 3600 && t.destinationPlaceId === home!.id),
  ).toHaveLength(800);
  for (const person of persons) {
    const own = trips.filter((t) => t.personId === person.id);
    expect(own).toHaveLength(person.agenda.length - 1);
    expect(person.agenda[0]!.kind).toBe('home');
    expect(person.agenda.at(-1)!.kind).toBe('home');
    for (let i = 0; i < own.length; i++) {
      expect(own[i]!.originPlaceId).toBe(person.agenda[i]!.placeId);
      expect(own[i]!.destinationPlaceId).toBe(person.agenda[i + 1]!.placeId);
      expect(own[i]!.departS).toBe(person.agenda[i]!.startS + person.agenda[i]!.durationS);
    }
  }
  const summary = demandSummary(trips, city);
  expect(summary.totalTrips).toBe(trips.length);
  expect(summary.byHour.reduce((a, b) => a + b, 0)).toBe(trips.length);
  for (const field of ['arrivals', 'departures'] as const)
    expect(Object.values(summary.byPlace).reduce((sum, p) => sum + p[field], 0)).toBe(trips.length);
  expect(scheduleTrips(city, [...persons].reverse(), scenario)).toEqual(trips);
});

test('T09 profiles set departures across midnight without clipping the scenario window', () => {
  const city = grid5x5();
  const [home, work] = Object.values(city.places);
  home!.population = 20;
  const hourly = (hour: number) => Array.from({ length: 24 }, (_, i) => (i === hour ? 1 : 0));
  home!.profile = { arrivals: hourly(3), departures: hourly(22) };
  work!.profile = { arrivals: hourly(7), departures: hourly(2) };
  const scenario = defaultScenario('grid5x5');
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  expect(trips).toHaveLength(40);
  for (const person of persons) {
    const own = trips.filter((t) => t.personId === person.id);
    expect(own[0]!.departS).toBeGreaterThanOrEqual(22 * 3600);
    expect(own[0]!.departS).toBeLessThan(23 * 3600);
    expect(own[1]!.departS).toBeGreaterThanOrEqual(26 * 3600);
    expect(own[1]!.departS).toBeLessThan(27 * 3600);
  }
  expect(demandSummary(trips, city).byHour[2]).toBe(20);
});

test('T09 through trips use distinct gateways, hourly totals and population/job weights', () => {
  const city = grid5x5();
  const a = addPlace(city, 'gateway');
  const b = addPlace(city, 'gateway');
  const c = addPlace(city, 'gateway');
  a.population = 1000;
  b.population = 10;
  c.population = 10;
  a.jobs = 0;
  b.jobs = 1000;
  c.jobs = 10;
  const scenario = defaultScenario('grid5x5');
  scenario.demand.throughTripsPerHour[6] = 600;
  scenario.demand.throughTripsPerHour[20] = 100;
  const trips = scheduleTrips(city, [], scenario);
  expect(trips).toHaveLength(700);
  expect(trips.filter((t) => t.departS >= 6 * 3600 && t.departS < 7 * 3600)).toHaveLength(600);
  expect(trips.filter((t) => t.originPlaceId === a.id).length).toBeGreaterThan(650);
  expect(trips.filter((t) => t.destinationPlaceId === b.id).length).toBeGreaterThan(650);
  expect(
    trips.every(
      (t) =>
        city.places[t.originPlaceId]!.kind === 'gateway' &&
        city.places[t.destinationPlaceId]!.kind === 'gateway' &&
        t.originPlaceId !== t.destinationPlaceId,
    ),
  ).toBe(true);
  expect(scheduleTrips(city, [], scenario)).toEqual(trips);
  delete city.places[b.id];
  delete city.places[c.id];
  expect(scheduleTrips(city, [], scenario)).toEqual([]);
});

test('T09 events produce exact counts from a separate stable visitor population', () => {
  const city = grid5x5();
  const gateway = addPlace(city, 'gateway');
  gateway.population = 50;
  gateway.jobs = 50;
  const station = addPlace(city, 'station');
  station.events = [
    { id: 'train', name: 'Train', startS: 29100, durationS: 300, arrivals: 40, departures: 60 },
  ];
  const scenario = defaultScenario('grid5x5');
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  const visitors = trips.filter(
    (t) => t.destinationPlaceId === station.id || t.originPlaceId === station.id,
  );
  expect(visitors).toHaveLength(100);
  expect(visitors.filter((t) => t.destinationPlaceId === station.id)).toHaveLength(40);
  expect(visitors.filter((t) => t.originPlaceId === station.id)).toHaveLength(60);
  expect(visitors.every((t) => t.departS >= 29100 && t.departS < 29400)).toBe(true);
  expect(visitors.every((t) => !persons.some((p) => p.id === t.personId))).toBe(true);
  expect(new Set(visitors.map((t) => t.personId)).size).toBe(60);
  for (const visitor of new Set(visitors.map((t) => t.personId))) {
    const own = visitors.filter((t) => t.personId === visitor);
    if (own.length === 2) {
      expect(own[0]!.destinationPlaceId).toBe(station.id);
      expect(own[1]!.originPlaceId).toBe(station.id);
    }
  }
  station.events.push({
    id: 'later',
    name: 'Later',
    startS: 90000,
    durationS: 0,
    arrivals: 3,
    departures: 0,
  });
  expect(scheduleTrips(city, persons, scenario).filter((t) => t.departS < 90000)).toEqual(trips);
  expect(scheduleTrips(city, persons, scenario).filter((t) => t.departS === 90000)).toHaveLength(3);
});
