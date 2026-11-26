import { expect, test } from 'vitest';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { overlaps } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-340: under the progressive order, three tows whose ways meet at the loop junction (-600, 400) and along the parallel taxiway are
// ordered without a ring of waits that none can leave: all three park, no bodies overlap.

test('three tows meeting at a junction all park, apart', () => {
  const { city, stands } = airportFixture();
  const fleet = createAircraftFleet(setup(city).airside!, 1);
  // R's tow runs north up the link and east to E1; L1's east along the loop to L2, which L2's
  // aircraft leaves for C1 round the loop's east side and along the parallel taxiway.
  const a = fleet.spawnParked({ typeId: 'E190', stand: stands.R });
  const b = fleet.spawnParked({ typeId: 'E190', stand: stands.L1 });
  const c = fleet.spawnParked({ typeId: 'E190', stand: stands.L2 });
  if (!a.ok || !b.ok || !c.ok) throw new Error('parked');
  expect(fleet.requestTow(c.id, { stand: stands.C1 }).ok).toBe(true);
  expect(fleet.requestTow(a.id, { stand: stands.E1 }).ok).toBe(true);
  let asked = false;
  let sawReservation = false;
  let sawWait = false;
  for (let step = 0; step * 0.1 <= 2400 && fleet.metrics().towed < 3; step++) {
    // L1's tow asks for L2 once L2's aircraft has left it.
    if (!asked && fleet.statusOf(c.id) !== 'parked') {
      const r = fleet.requestTow(b.id, { stand: stands.L2 });
      asked = r.ok;
    }
    fleet.step(step * 0.1);
    if (step % 10 === 0) {
      expect(overlaps(fleet.snapshot()), `bodies at ${step / 10} s`).toEqual([]);
      if (!sawWait || !sawReservation) {
        const debug = fleet.debugSnapshot(true);
        sawWait ||= debug.aircraftWaits!.some(({ from, to }) => from !== to);
        sawReservation ||= debug.aircraft!.some(
          ({ reservations, radiusM }) =>
            radiusM > 0 &&
            reservations.some(
              ({ edge, fromM, toM }) => fleet.graph.edges[edge] && fromM >= 0 && toM > fromM,
            ),
        );
      }
    }
  }
  expect(asked).toBe(true);
  expect(sawReservation && sawWait).toBe(true);
  expect(fleet.metrics()).toMatchObject({ towed: 3, stuck: 0 });
});
