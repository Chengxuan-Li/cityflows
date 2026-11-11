import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import {
  assignCars,
  CAR_RETURN_MARGIN_S,
  HOUSEHOLD_SIZE_SHARES,
  householdCensus,
  withHouseholds,
} from '../../src/demand/households';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { openProject } from '../../src/project/open';
import { saveProjectJson } from '../../src/project/save';
import type { Person } from '../../src/schema';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

test('T67 household sizes follow the 2023 microcensus shares over many homes', () => {
  // Few large homes, so leaving out each home's last (truncated) household biases nothing.
  const city = town();
  for (const place of Object.values(city.places))
    if (place.kind === 'residential') place.population *= 20;
  const scenario = defaultScenario('town');
  const persons = generatePopulation(city, scenario.demand);
  const homes = new Map<string, string[]>();
  for (const person of persons) {
    const list = homes.get(person.homePlaceId) ?? [];
    if (!list.includes(person.householdId)) list.push(person.householdId);
    homes.set(person.homePlaceId, list);
  }
  const size = new Map<string, number>();
  for (const person of persons)
    size.set(person.householdId, (size.get(person.householdId) ?? 0) + 1);
  // The last household of a home takes the persons left over, so leave it out of the shares.
  const drawn = [...homes.values()].flatMap((ids) => ids.slice(0, -1).map((id) => size.get(id)!));
  expect(drawn.length).toBeGreaterThan(2000);
  HOUSEHOLD_SIZE_SHARES.forEach((share, i) => {
    const observed = drawn.filter((n) => n === i + 1).length / drawn.length;
    expect(Math.abs(observed - share)).toBeLessThan(0.02);
  });
  expect(Math.max(...size.values())).toBeLessThanOrEqual(HOUSEHOLD_SIZE_SHARES.length);
  // Households group a home's persons in person order.
  for (const person of persons) expect(person.householdId).toMatch(`hh:${person.homePlaceId}:`);
});

test('T67 the same seed gives the same households, and a new place leaves other homes alone', () => {
  const city = grid5x5();
  const [home] = Object.values(city.places);
  home!.population = 60;
  const scenario = defaultScenario('grid5x5');
  const persons = generatePopulation(city, scenario.demand);
  expect(generatePopulation(city, scenario.demand)).toEqual(persons);
  expect(new Set(persons.map((p) => p.householdId)).size).toBeLessThan(persons.length);

  city.places['p:0'] = { ...home!, id: 'p:0', name: 'New homes', connectors: [] };
  const expanded = generatePopulation(city, scenario.demand);
  expect(expanded.filter((p) => p.homePlaceId === home!.id)).toEqual(
    persons.filter((p) => p.homePlaceId === home!.id),
  );
  // A gateway person, an external commuter, is a household of one.
  city.places['p:0'].kind = 'gateway';
  const commuters = generatePopulation(city, scenario.demand).filter(
    (p) => p.homePlaceId === 'p:0',
  );
  expect(new Set(commuters.map((p) => p.householdId)).size).toBe(commuters.length);
});

test('T67 a saved population without households opens with the households a regenerated one has', async () => {
  const city = town();
  const scenario = defaultScenario('town');
  scenario.demand.personsPerResident = 0.2;
  const persons = generatePopulation(city, scenario.demand);
  const saved = persons.map(({ householdId: _, ...person }) => person);
  expect(withHouseholds(city, saved, scenario.demand.seed)).toEqual(persons);
  const json = await saveProjectJson({
    city,
    scenarios: [scenario],
    population: saved as Person[],
    baseline: { city, scenario, population: saved as Person[] },
  });
  const opened = await openProject(json);
  if (!opened.ok) throw new Error(opened.error);
  expect(opened.project.population).toEqual(persons);
  expect(opened.project.baseline!.population).toEqual(persons);
});

test('T67 car ownership leaves the hasCar draws and the agendas as they were on main', () => {
  // Digests recorded on main a1cc570 (`generatePopulation` and `scheduleTrips` at car share 0.5).
  const pins = {
    grid5x5: { withCar: 543, assignments: '7d19d036c6b1a42c', agendas: '2287507df094329d' },
    town: { withCar: 3448, assignments: 'dd63a3fd62749fe6', agendas: '9dc5d7ee6dfde5ea' },
  };
  for (const [name, city] of [
    ['grid5x5', grid5x5()],
    ['town', town()],
  ] as const) {
    const scenario = defaultScenario(name);
    scenario.demand.carShare = 0.5;
    const persons = generatePopulation(city, scenario.demand);
    const trips = scheduleTrips(city, persons, scenario);
    expect({
      withCar: persons.filter((p) => p.hasCar).length,
      assignments: digest(persons.map((p) => [p.id, p.homePlaceId, p.workPlaceId, p.hasCar])),
      agendas: digest(persons.map((p) => p.agenda)),
    }).toEqual(pins[name]);
    // One car per member with a car, so the fleet is today's car owners.
    const census = householdCensus(city, persons, trips);
    expect(census.cars).toBe(pins[name].withCar);
    const owners = new Map<string, number>();
    for (const p of persons)
      if (p.hasCar) owners.set(p.householdId, (owners.get(p.householdId) ?? 0) + 1);
    for (const trip of trips) {
      if (!trip.carId) continue;
      const household = trip.carId.slice(4, trip.carId.lastIndexOf(':'));
      const driver = persons.find((p) => p.id === trip.personId)!;
      // Nobody drives a car outside their household.
      expect(household).toBe(driver.householdId);
      expect(Number(trip.carId.slice(trip.carId.lastIndexOf(':') + 1))).toBeLessThan(
        owners.get(household)!,
      );
    }
    // Everyone's day runs about 08:00 to 17:00, so the others find no car free all day.
    expect(census.borrowedCarDays).toBe(0);
    expect(census.noFreeCar).toBeGreaterThan(0);
    expect(trips.filter((t) => t.mode === 'car').every((t) => t.carId)).toBe(
      trips.some((t) => t.mode === 'car' && t.personId?.startsWith('person:')),
    );
  }
});

function member(id: string, hasCar: boolean, awayFromS: number | null, homeAtS = 0): Person {
  return {
    id: `person:p:1:${id}`,
    homePlaceId: 'p:1',
    householdId: 'hh:p:1:0',
    workPlaceId: 'p:2',
    hasCar,
    agenda:
      awayFromS === null
        ? [{ kind: 'home', placeId: 'p:1', startS: 0, durationS: 86400 }]
        : [
            { kind: 'home', placeId: 'p:1', startS: 0, durationS: awayFromS },
            { kind: 'work', placeId: 'p:2', startS: awayFromS, durationS: homeAtS - awayFromS },
            { kind: 'home', placeId: 'p:1', startS: homeAtS, durationS: 86400 - homeAtS },
          ],
  };
}

test('T67 owners drive their cars; others borrow only a car free for their whole day away', () => {
  const h = (hours: number) => hours * 3600;
  const persons = [
    member('0', true, h(7), h(16)), // owns car 0
    member('1', false, h(17), h(22)), // car 0 is back by 16:30: borrows it
    member('2', false, h(16) + CAR_RETURN_MARGIN_S - 60, h(23)), // too early for car 0, car 1 taken
    member('3', true, null), // owns car 1, stays home all day
    member('4', false, h(6), h(23)), // first departure: takes the free car 1
    member('5', false, null), // no day away: wants no car
  ];
  const drivers = assignCars(persons);
  expect(Object.fromEntries(drivers)).toEqual({
    'person:p:1:0': 'car:hh:p:1:0:0',
    'person:p:1:1': 'car:hh:p:1:0:0',
    'person:p:1:4': 'car:hh:p:1:0:1',
  });
  // Order does not matter, and a home without owners walks.
  expect(assignCars([...persons].reverse())).toEqual(drivers);
  expect(assignCars(persons.map((p) => ({ ...p, hasCar: false }))).size).toBe(0);
});
