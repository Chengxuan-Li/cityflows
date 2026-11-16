import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { createEngine } from '../../src/sim/engine';
import { setup, trips } from './fixtures';

// TASK-187: the rail hold looks for the car ahead from the vehicle itself, not from the end of
// its lane's list, which is exact only while every list stays ordered by position. Queues at a
// closed crossing, and a town morning with lots, garages and roadside manoeuvres, keep it.
test.each(['rail', 'tram'] as const)(
  'lane lists stay ordered in a queue at a %s crossing',
  (kind) => {
    const city = operatingCrossing(kind);
    const engine = createEngine();
    engine.load({
      compiled: setup(city),
      trips: trips(city, 30, 2),
      scenario: { ...defaultScenario('grid5x5'), startS: 100, endS: 900 },
      debugLaneOrder: true,
    });
    engine.step(8000);
    expect(engine.metrics().trips.completed).toBeGreaterThan(20);
  },
);

test('lane lists stay ordered through a town morning with parking', () => {
  const city = town();
  const scenario = { ...defaultScenario('town'), endS: 8 * 3600 };
  const compiled = setup(city);
  const population = generatePopulation(city, scenario.demand);
  const engine = createEngine();
  engine.load({
    compiled,
    trips: scheduleTrips(city, population, scenario, compiled),
    scenario,
    population,
    debugLaneOrder: true,
  });
  engine.step(Math.round((scenario.endS - scenario.startS) / 0.1));
  expect(engine.metrics().trips.completed).toBeGreaterThan(100);
});
