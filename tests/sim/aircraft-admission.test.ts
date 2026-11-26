import { expect, test } from 'vitest';
import { createAircraftFleet, type AircraftPoseSnapshot } from '../../src/sim/aircraft';
import { overlaps, onRunway } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-329: moving aircraft never wait for aircraft that have not started (tests/sim/airside-fixture.ts).

function fleetOf(hook = false) {
  const { city, stands } = airportFixture({ hook });
  const graph = setup(city).airside!;
  return { stands, fleet: createAircraftFleet(graph, 1) };
}

/** Steps the fleet at 0.1 s to `untilS`, calling `at` before each step and checking bodies and
 * runway use every second; returns the poses by aircraft. */
function run(
  fleet: ReturnType<typeof createAircraftFleet>,
  untilS: number,
  at: (step: number) => void = () => {},
) {
  const poses = new Map<number, (AircraftPoseSnapshot & { timeS: number })[]>();
  for (let step = 0; step * 0.1 <= untilS; step++) {
    at(step);
    fleet.step(step * 0.1);
    if (step % 10) continue;
    const snapshot = fleet.snapshot();
    expect(overlaps(snapshot), `bodies at ${step / 10} s`).toEqual([]);
    expect(onRunway(snapshot).length).toBeLessThanOrEqual(1);
    for (const pose of snapshot) {
      const list = poses.get(pose.id) ?? [];
      list.push({ ...pose, timeS: step / 10 });
      poses.set(pose.id, list);
    }
  }
  return poses;
}

const firstS = (
  poses: (AircraftPoseSnapshot & { timeS: number })[],
  test: (p: AircraftPoseSnapshot) => boolean,
) => poses.find(test)?.timeS ?? Infinity;
/** The longest a taxiing aircraft stood still. */
function longestTaxiStop(poses: (AircraftPoseSnapshot & { timeS: number })[]) {
  let longest = 0;
  let since: number | null = null;
  for (const p of poses) {
    const still = p.state === 'taxi' && p.speedMps < 0.05;
    if (still) since ??= p.timeS;
    else since = null;
    if (since !== null) longest = Math.max(longest, p.timeS - since);
  }
  return longest;
}

test('a taxiing arrival passes a departure ordered before it that has not started; the departure starts after', () => {
  const { fleet, stands } = fleetOf();
  // A tow from L2 to C2 passes E1's lead-in on the parallel taxiway; the departure at E1 is
  // ordered after it and cannot push back until it has passed.
  const tow = fleet.spawnParked({ typeId: 'E190', stand: stands.L2 });
  const departure = fleet.spawnParked({ typeId: 'A20N', stand: stands.E1 });
  if (!tow.ok || !departure.ok) throw new Error('parked');
  expect(fleet.requestTow(tow.id, { stand: stands.C2 }).ok).toBe(true);
  expect(fleet.requestDeparture(departure.id, '27').ok).toBe(true);
  let arrival = -1;
  const poses = run(fleet, 900, (step) => {
    // Requested once the departure is ordered: it lands on 27, vacates at x = -300 and taxis
    // east past E1 to C1, through the departure's pushback.
    if (step !== 150) return;
    const result = fleet.requestArrival({ typeId: 'A20N', runwayEnd: '27', stand: stands.C1 });
    if (!result.ok) throw new Error(result.reason);
    arrival = result.id;
  });
  const arrivalTrack = poses.get(arrival)!;
  const departureTrack = poses.get(departure.id)!;
  const pastE1S = firstS(arrivalTrack, (p) => p.state === 'taxi' && p.y > 150 && p.x > -100);
  const offBlockS = firstS(departureTrack, (p) => p.state === 'pushback');
  expect(pastE1S).toBeLessThan(offBlockS);
  expect(fleet.metrics()).toMatchObject({ landed: 1, departed: 1, towed: 1, stuck: 0 });
  // The arrival never waits on the taxiway for the departure still at its stand.
  expect(longestTaxiStop(arrivalTrack)).toBeLessThan(30);
});

test('a departure that would wait for an aircraft parked in its way waits at its stand; one ordered after it goes first', () => {
  const { fleet, stands } = fleetOf(true);
  // The B777 at E1 bound for 27 passes stand K, whose parked A320neo stands in its way: it waits
  // for K to leave. The A320neo at C1, ordered after the B777, also leaves for 27, and K's,
  // ordered after both, pushes back across their way.
  const heavy = fleet.spawnParked({ typeId: 'B77W', stand: stands.E1 });
  const second = fleet.spawnParked({ typeId: 'A20N', stand: stands.C1 });
  const inTheWay = fleet.spawnParked({ typeId: 'A20N', stand: stands.K! });
  if (!heavy.ok || !second.ok || !inTheWay.ok) throw new Error('parked');
  expect(fleet.requestDeparture(heavy.id, '27').ok).toBe(true);
  const poses = run(fleet, 1200, (step) => {
    if (step === 100) expect(fleet.requestDeparture(second.id, '27').ok).toBe(true);
    if (step === 200) expect(fleet.requestDeparture(inTheWay.id, '27').ok).toBe(true);
  });
  expect(fleet.metrics()).toMatchObject({ departed: 3, active: 0, stuck: 0 });
  const heavyTrack = poses.get(heavy.id)!;
  // The B777 waits at its stand, not on the taxiway, until K's aircraft has left its stand, and
  // the A320neo ordered after it goes first.
  const offBlockS = (id: number) => firstS(poses.get(id)!, (p) => p.state === 'pushback');
  expect(offBlockS(heavy.id)).toBeGreaterThan(offBlockS(inTheWay.id));
  expect(offBlockS(heavy.id)).toBeGreaterThan(offBlockS(second.id));
  expect(longestTaxiStop(heavyTrack)).toBeLessThan(30);
});
