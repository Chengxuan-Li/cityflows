import { expect, test } from 'vitest';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { overlaps } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-339: no aircraft waits on an aircraft parked or resting across its way with no movement
// planned (tests/sim/airside-fixture.ts, `hook`: an aircraft at stand K stands in a B777's way
// along the parallel taxiway).

function fleetOf() {
  const { city, stands } = airportFixture({ hook: true });
  const graph = setup(city).airside!;
  return { stands, fleet: createAircraftFleet(graph, 1) };
}

function run(
  fleet: ReturnType<typeof createAircraftFleet>,
  untilS: number,
  at: (timeS: number) => void = () => {},
) {
  for (let step = 0; step * 0.1 <= untilS; step++) {
    at(step / 10);
    fleet.step(step * 0.1);
    if (step % 10 === 0) expect(overlaps(fleet.snapshot()), `bodies at ${step / 10} s`).toEqual([]);
  }
}

test('a tow that would park across a departure’s way goes second, though ordered first', () => {
  const { fleet, stands } = fleetOf();
  // The tow from L2 to K, round the loop and east along the parallel taxiway past E1, is under
  // way when the B777 at E1 asks to leave for 27. Parked at K the tow would stand in the B777's
  // way for good, so it waits short of E1 until the B777 is past, and parks behind it.
  const tow = fleet.spawnParked({ typeId: 'E190', stand: stands.L2 });
  const heavy = fleet.spawnParked({ typeId: 'B77W', stand: stands.E1 });
  if (!tow.ok || !heavy.ok) throw new Error('parked');
  expect(fleet.requestTow(tow.id, { stand: stands.K! }).ok).toBe(true);
  let requestedS = Infinity;
  run(fleet, 1800, (timeS) => {
    if (requestedS === Infinity && fleet.statusOf(tow.id) === 'tow') {
      requestedS = timeS;
      expect(fleet.requestDeparture(heavy.id, '27').ok).toBe(true);
    }
  });
  expect(requestedS).toBeLessThan(600);
  expect(fleet.metrics()).toMatchObject({ departed: 1, towed: 1, stuck: 0 });
  expect(fleet.parkedBlockS()).toBe(0);
});
