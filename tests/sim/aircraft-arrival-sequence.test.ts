import { expect, test } from 'vitest';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { overlaps } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-363: an arrival that cannot reach its stand while an aircraft stands parked across its way
// in steps out of the landing order; the arrivals behind it land first. On the fixture
// (tests/sim/airside-fixture.ts, `hook` and `far`) an E190 parked at K stands in the way of a
// B777 taxiing along the parallel taxiway to J, east of K.

function scenario(rules: string) {
  const before = process.env.T363;
  process.env.T363 = rules;
  const { city, stands } = airportFixture({ hook: true, far: true });
  const fleet = createAircraftFleet(setup(city).airside!, 1);
  if (before === undefined) delete process.env.T363;
  else process.env.T363 = before;
  const parked = fleet.spawnParked({ typeId: 'E190', stand: stands.K! });
  if (!parked.ok) throw new Error(parked.reason);
  const heavy = fleet.requestArrival({ typeId: 'B77W', runwayEnd: '27', stand: stands.J! });
  if (!heavy.ok) throw new Error(heavy.reason);
  const next = fleet.requestArrival({ typeId: 'E190', runwayEnd: '27', stand: stands.R! });
  if (!next.ok) throw new Error(next.reason);
  const appeared: Record<number, number | undefined> = {};
  const leaveS = 900;
  for (let step = 0; step * 0.1 <= 2400; step++) {
    const timeS = step / 10;
    if (timeS === leaveS) expect(fleet.requestDeparture(parked.id, '27').ok).toBe(true);
    fleet.step(timeS);
    for (const id of [heavy.id, next.id])
      if (appeared[id] === undefined && fleet.statusOf(id) !== undefined) appeared[id] = timeS;
    if (step % 10 === 0) expect(overlaps(fleet.snapshot()), `bodies at ${timeS} s`).toEqual([]);
  }
  return {
    heavyS: appeared[heavy.id],
    nextS: appeared[next.id],
    leaveS,
    metrics: fleet.metrics(),
    steppedOut: fleet.arrivalCauses().steppedOut,
  };
}

test('an arrival behind a parked aircraft does not hold the next arrival', () => {
  const { heavyS, nextS, leaveS, metrics, steppedOut } = scenario('pk');
  // The E190 behind it lands at once; the B777 appears once K's aircraft has left.
  expect(nextS).toBeLessThan(60);
  expect(heavyS).toBeGreaterThan(leaveS);
  expect(metrics).toMatchObject({ landed: 2, departed: 1, stuck: 0, goArounds: 0 });
  expect(steppedOut['27 J']).toBeGreaterThan(leaveS - 60);
});

test('without the rule the B777, ordered first, holds the E190 in the air', () => {
  const { heavyS, nextS, leaveS, metrics } = scenario('off');
  expect(nextS).toBeGreaterThan(leaveS);
  expect(heavyS).toBeGreaterThan(leaveS);
  expect(metrics).toMatchObject({ landed: 2, departed: 1, stuck: 0 });
});
