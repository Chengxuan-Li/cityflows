import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { createEngine } from '../../src/sim/engine';
import { setup, trips } from './fixtures';

// TASK-211: the step skips work that cannot change its outcome: the rail pass of a vehicle that
// has not moved since the last one, a car's lane plan while its route, step, lane and
// destination stay, the lot stop off the way to the destination's lane. `debugSkips` takes none
// of the shortcuts and checks each against the full computation; the results must not differ.
const run = (load: (debugSkips: boolean) => ReturnType<typeof createEngine>, steps: number) =>
  [false, true].map((debugSkips) => {
    const engine = load(debugSkips);
    engine.step(steps);
    return { hash: engine.stateHash(), completed: engine.metrics().trips.completed };
  });

test.each(['rail', 'tram'] as const)(
  'a queue at a %s crossing runs the same without skips',
  (kind) => {
    const city = operatingCrossing(kind);
    const compiled = setup(city);
    const [fast, full] = run((debugSkips) => {
      const engine = createEngine();
      engine.load({
        compiled,
        trips: trips(city, 30, 2),
        scenario: { ...defaultScenario('grid5x5'), startS: 100, endS: 900 },
        debugSkips,
      });
      return engine;
    }, 8000);
    expect(fast!.completed).toBeGreaterThan(20);
    expect(fast).toEqual(full);
  },
);

test('a town morning with lots and lane changes runs the same without skips', () => {
  const city = town();
  const scenario = { ...defaultScenario('town'), endS: 8 * 3600 };
  const compiled = setup(city);
  const [fast, full] = run(
    (debugSkips) => {
      const population = generatePopulation(city, scenario.demand);
      const engine = createEngine();
      engine.load({
        compiled,
        trips: scheduleTrips(city, population, scenario, compiled),
        scenario,
        population,
        debugSkips,
      });
      return engine;
    },
    Math.round((scenario.endS - scenario.startS) / 0.1),
  );
  expect(fast!.completed).toBeGreaterThan(100);
  expect(fast).toEqual(full);
});
