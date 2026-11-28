import { expect, test } from 'vitest';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { overlaps } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-382 (`T382=s`): a tow does not start while its way meets the way off the runway of an
// arrival ordered to land, unless that arrival waits for the tow. On the fixture
// (tests/sim/airside-fixture.ts) a B777 towed along the parallel taxiway meets the exit of a
// B777 landing on 27.

function scenario(from: 'E1', to: 'L1' | 'L2', arrivalStand: 'L1' | 'E2') {
  const before = process.env.T382;
  process.env.T382 = 's';
  const { city, stands } = airportFixture();
  const fleet = createAircraftFleet(setup(city).airside!, 1);
  if (before === undefined) delete process.env.T382;
  else process.env.T382 = before;
  const parked = fleet.spawnParked({ typeId: 'B77W', stand: stands[from] });
  if (!parked.ok) throw new Error(parked.reason);
  const arrival = fleet.requestArrival({
    typeId: 'B77W',
    runwayEnd: '27',
    stand: stands[arrivalStand],
  });
  if (!arrival.ok) throw new Error(arrival.reason);
  let towedS = -1;
  let landedS = -1;
  for (let step = 0; step * 0.5 <= 900; step++) {
    const timeS = step / 2;
    if (timeS === 5) expect(fleet.requestTow(parked.id, { stand: stands[to] }).ok).toBe(true);
    fleet.step(timeS);
    for (const e of fleet.drainEvents()) {
      if (e.id === parked.id && e.kind === 'towed') towedS = timeS;
      if (e.id === arrival.id && e.kind === 'parked') landedS = timeS;
    }
    if (step % 2 === 0) expect(overlaps(fleet.snapshot()), `bodies at ${timeS} s`).toEqual([]);
  }
  return { towedS, landedS, wayOffS: fleet.startRefusals()['tow wayOff']?.s ?? 0 };
}

test('a tow waits at its stand while an arrival is to leave the runway across its way', () => {
  const { towedS, landedS, wayOffS } = scenario('E1', 'L2', 'L1');
  expect(wayOffS).toBeGreaterThan(0);
  expect(landedS).toBeGreaterThan(0);
  expect(towedS).toBeGreaterThan(landedS);
});

test('an arrival that waits for the tow does not hold it at its stand', () => {
  const { towedS, landedS, wayOffS } = scenario('E1', 'L1', 'E2');
  expect(wayOffS).toBe(0);
  expect(towedS).toBeGreaterThan(0);
  expect(landedS).toBeGreaterThan(towedS);
});
