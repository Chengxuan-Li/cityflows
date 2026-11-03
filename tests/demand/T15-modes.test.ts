import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { tripRequestSchema } from '../../src/schema';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';

test('T15 people without car access produce schema-valid walk trips without vehicle references', () => {
  const city = grid5x5();
  const scenario = defaultScenario('grid5x5');
  scenario.demand.carShare = 0;
  const persons = generatePopulation(city, scenario.demand);
  scenario.demand.carShare = 1; // Scheduling keeps the access assigned to each person.
  const trips = scheduleTrips(city, persons, scenario);

  expect(trips.length).toBeGreaterThan(0);
  for (const trip of trips) {
    expect(trip.mode).toBe('walk');
    expect(trip.legs).toEqual([
      { mode: 'walk', fromPlaceId: trip.originPlaceId, toPlaceId: trip.destinationPlaceId },
    ]);
    expect(tripRequestSchema.parse(JSON.parse(JSON.stringify(trip)))).toEqual(trip);
    expect(trip).not.toHaveProperty('vehicleId');
  }
});
