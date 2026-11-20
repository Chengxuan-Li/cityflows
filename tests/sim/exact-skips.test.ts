import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createRailCrossings } from '../../src/sim/rail-crossings';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup, trips } from './fixtures';

// TASK-211: the step skips work that cannot change its outcome: the rail pass of a vehicle that
// has not moved since the last one, a car's lane plan while its route, step, lane and
// destination stay, the lot stop off the way to the destination's lane. TASK-230: a car's motion
// flag mirrors its parking motion, a trip's mode flag its mode, a trip's origin kind is looked up
// once, and the signal pass visits a list of the granted cars. `debugSkips` takes none of the
// shortcuts and checks each against the full computation; the results must not differ.
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

// TASK-237: a car's crossing ranges are kept while it moves up short of the next span end or
// marking on its path; with `debugSkips` every kept range is found again and compared (it throws
// on a difference). A car driving up to and over the crossing, through warning and closure, holds
// the same with and without the check.
test.each(['rail', 'tram'] as const)(
  'kept crossing ranges match ranges found afresh along a %s approach',
  (kind) => {
    const compiled = setup(operatingCrossing(kind));
    const stop = compiled.rail!.facilities![0]!.stops![0]!;
    const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
    vehicles.state[0] = DRIVING;
    vehicles.insert(0, stop.lane, 5);
    const control = (check: boolean) =>
      createRailCrossings(
        compiled,
        vehicles,
        DEFAULT_SIM_PARAMS,
        100,
        () => false,
        undefined,
        undefined,
        check,
      )!;
    const fast = control(false),
      full = control(true);
    const lane = compiled.lanes[stop.lane]!;
    const holds: number[] = [];
    for (let i = 0; vehicles.position[0]! < lane.lengthM; i++) {
      fast.step(100 + i * 0.1);
      full.step(100 + i * 0.1);
      const a = fast.hold(0);
      expect(a).toBe(full.hold(0));
      expect(fast.holdRed(0)).toBe(full.holdRed(0));
      holds.push(a);
      vehicles.position[0] = Math.min(lane.lengthM, vehicles.position[0]! + 0.37);
      vehicles.speed[0] = 3.7;
    }
    expect(holds.some((h) => h === Infinity)).toBe(true);
    expect(holds.some((h) => h < Infinity)).toBe(true);
  },
);
