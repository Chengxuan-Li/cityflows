import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { demandSummary, generatePopulation, scheduleTrips } from '../../src/demand';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import {
  demandConfigSchema,
  simParamsSchema,
  tripRequestSchema,
  type TripRequest,
} from '../../src/schema';

const cars = { car: 1, van: 0, truck: 0, bus: 0 };

function legacyTrip(trip: TripRequest) {
  return {
    id: trip.id,
    personId: trip.personId,
    originPlaceId: trip.originPlaceId,
    destinationPlaceId: trip.destinationPlaceId,
    departS: trip.departS,
    mode: trip.mode,
    legs: trip.legs,
  };
}

test('explicit vehicle parameters round-trip JSON with no speed cap', () => {
  const car = { lengthM: 4.5, widthM: 1.8, maxSpeedMps: Infinity, accelFactor: 1, decelFactor: 1 };
  const params = {
    vehicleClasses: {
      car,
      van: { ...car, maxSpeedMps: 120 / 3.6 },
      truck: { ...car, maxSpeedMps: 80 / 3.6 },
      bus: { ...car, maxSpeedMps: 80 / 3.6 },
    },
  };
  expect(simParamsSchema.parse(JSON.parse(JSON.stringify(params)))).toEqual({
    ...params,
    headDetourS: 45,
  });
});

test('default class shares belong to each loaded configuration', () => {
  const first = demandConfigSchema.parse(defaultScenario('grid5x5').demand);
  first.classShares.local.car = 0;
  expect(demandConfigSchema.parse(defaultScenario('grid5x5').demand).classShares.local.car).toBe(
    0.92,
  );
});

test('legacy trips and demand receive vehicle defaults at the saved-data boundary', () => {
  const trip = {
    id: 'old',
    personId: null,
    originPlaceId: 'p:1',
    destinationPlaceId: 'p:2',
    departS: 0,
    mode: 'car',
    legs: [],
  };
  expect(tripRequestSchema.parse(trip)).toMatchObject({ vehicleClass: 'car', purpose: 'private' });
  expect(tripRequestSchema.parse({ ...trip, id: 'through:8:0' })).toMatchObject({
    vehicleClass: 'car',
    purpose: 'through',
  });
  const legacy = { ...defaultScenario('grid5x5').demand };
  delete legacy.classShares;
  expect(demandConfigSchema.parse(legacy).classShares).toEqual({
    local: { car: 0.92, van: 0.08, truck: 0, bus: 0 },
    through: { car: 0.8, van: 0.08, truck: 0.12, bus: 0 },
  });
  expect(simParamsSchema.parse({ vehicleLengthM: 9 })).toEqual({ headDetourS: 45 });
});

test('class shares reject empty or non-unit groups and accept bus as an explicit class', () => {
  const demand = defaultScenario('grid5x5').demand;
  expect(
    demandConfigSchema.safeParse({
      ...demand,
      classShares: {
        local: { ...cars, car: 0 },
        through: cars,
      },
    }).success,
  ).toBe(false);
  expect(
    demandConfigSchema.safeParse({
      ...demand,
      classShares: {
        local: { ...cars, van: 0.1 },
        through: cars,
      },
    }).success,
  ).toBe(false);
  expect(
    demandConfigSchema.safeParse({
      ...demand,
      classShares: {
        local: { ...cars, car: 0, bus: 1 },
        through: cars,
      },
    }).success,
  ).toBe(true);
});

test('all-car demand preserves the complete pre-class trip sequence', () => {
  const city = grid5x5();
  Object.values(city.places)[0]!.population = 1000;
  const scenario = defaultScenario('grid5x5');
  scenario.demand.classShares = { local: cars, through: cars };
  const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
  expect(trips.every((trip) => trip.vehicleClass === 'car' && trip.purpose === 'private')).toBe(
    true,
  );
  const legacy = trips.map(legacyTrip);
  expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe(
    'd9b95a4e3cfd788334631d17544f98032823602f8233733a73b0bc0adefbf872',
  );
});

test('separate per-trip streams classify locals, events and through traffic without changing trips', () => {
  const city = grid5x5();
  const [home, work] = Object.values(city.places);
  home!.population = 1000;
  work!.events = [
    { id: 'visit', name: 'Visit', startS: 30000, durationS: 600, arrivals: 10, departures: 10 },
  ];
  for (let i = 0; i < 2; i++) {
    const id = `p:${city.nextId++}`;
    city.places[id] = { ...home!, id, kind: 'gateway', population: 1, jobs: 1, connectors: [] };
  }
  const scenario = defaultScenario('grid5x5');
  scenario.demand.throughTripsPerHour[8] = 100;
  const people = generatePopulation(city, scenario.demand);
  scenario.demand.classShares = { local: cars, through: cars };
  const baseline = scheduleTrips(city, people, scenario);
  scenario.demand.classShares = {
    local: { car: 0, van: 1, truck: 0, bus: 0 },
    through: { car: 0, van: 0, truck: 1, bus: 0 },
  };
  const trips = scheduleTrips(city, people, scenario);
  expect(trips.map(legacyTrip)).toEqual(baseline.map(legacyTrip));
  expect(scheduleTrips(city, [...people].reverse(), scenario)).toEqual(trips);
  const locals = trips.filter((trip) => !trip.id.startsWith('through:'));
  expect(
    locals.every(
      (trip) => trip.vehicleClass === 'van' && ['delivery', 'service'].includes(trip.purpose),
    ),
  ).toBe(true);
  const deliveries = locals.filter((trip) => trip.purpose === 'delivery').length;
  expect(deliveries).toBeGreaterThan(locals.length * 0.4);
  expect(deliveries).toBeLessThan(locals.length * 0.6);
  expect(
    trips
      .filter((trip) => trip.id.startsWith('through:'))
      .every((trip) => trip.vehicleClass === 'truck' && trip.purpose === 'through'),
  ).toBe(true);
  expect(demandSummary(trips, city).byClass).toEqual({
    car: 0,
    van: locals.length,
    truck: 100,
    bus: 0,
  });
});
