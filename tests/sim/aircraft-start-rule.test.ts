import { expect, test } from 'vitest';
import { createAircraftFleet, type AircraftPoseSnapshot } from '../../src/sim/aircraft';
import { overlaps, onRunway } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-330: departures start when their way out is clear (tests/sim/airside-fixture.ts).

function fleetOf(hook = false) {
  const { city, stands } = airportFixture({ hook });
  const graph = setup(city).airside!;
  return { stands, fleet: createAircraftFleet(graph, 1) };
}

type Track = (AircraftPoseSnapshot & { timeS: number })[];

/** Steps the fleet at 0.1 s to `untilS`, calling `at` before each step and checking bodies and
 * runway use every second; returns the poses by aircraft. */
function run(
  fleet: ReturnType<typeof createAircraftFleet>,
  untilS: number,
  at: (step: number) => void = () => {},
) {
  const poses = new Map<number, Track>();
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

const firstS = (poses: Track, test: (p: AircraftPoseSnapshot) => boolean) =>
  poses.find(test)?.timeS ?? Infinity;
const offBlockS = (poses: Track) => firstS(poses, (p) => p.state === 'pushback');
/** The longest a taxiing aircraft stood still. */
function longestTaxiStop(poses: Track) {
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

test('a departure whose way out meets a queued arrival still far out starts, and is clear of it when it lands', () => {
  const { fleet, stands } = fleetOf();
  // Three arrivals on 27 for the remote stands go first; the fourth, for C1, vacates at
  // x = -300 and taxis east past E2 to C1, where the departure at E2 bound for 27 pushes back
  // and taxis east. The fourth is ordered before the departure but lands minutes later.
  for (const stand of [stands.L1, stands.L2, stands.R])
    expect(fleet.requestArrival({ typeId: 'A20N', runwayEnd: '27', stand }).ok).toBe(true);
  const arrival = fleet.requestArrival({ typeId: 'A20N', runwayEnd: '27', stand: stands.C1 });
  const departure = fleet.spawnParked({ typeId: 'A20N', stand: stands.E2 });
  if (!arrival.ok || !departure.ok) throw new Error('requests');
  const poses = run(fleet, 1200, (step) => {
    if (step === 50) expect(fleet.requestDeparture(departure.id, '27').ok).toBe(true);
  });
  const arrivalTrack = poses.get(arrival.id)!;
  const departureTrack = poses.get(departure.id)!;
  const landS = firstS(arrivalTrack, (p) => p.state === 'landing-roll');
  // It pushes back within a minute of its request, not after the arrival has passed.
  expect(offBlockS(departureTrack)).toBeLessThan(65);
  expect(fleet.metrics()).toMatchObject({ landed: 4, departed: 1, active: 4, stuck: 0 });
  // When the arrival touches down, the departure is past C1 on its way east.
  const atLanding = departureTrack.find((p) => p.timeS >= landS);
  expect(!atLanding || atLanding.x > 100 || atLanding.y < 150).toBe(true);
  expect(longestTaxiStop(arrivalTrack)).toBeLessThan(30);
});

/** Touchdown times by aircraft, from the snapshots' landing roll. */
const touchdownS = (poses: Map<number, Track>, id: number) =>
  firstS(poses.get(id)!, (p) => p.state === 'landing-roll');

test('arrivals are spaced on final, several at once, and land without going around', () => {
  const { fleet, stands } = fleetOf();
  // Four A320neos for the contact stands all vacate at x = -300 and taxi east along the parallel
  // taxiway: each still follows the one ahead off the runway.
  const ids = [stands.E1, stands.E2, stands.C1, stands.C2].map((stand) => {
    const result = fleet.requestArrival({ typeId: 'A20N', runwayEnd: '27', stand });
    if (!result.ok) throw new Error(result.reason);
    return result.id;
  });
  let together = 0;
  const poses = run(fleet, 900, (step) => {
    if (step % 10) return;
    const airborne = fleet.snapshot().filter((p) => p.state === 'approach').length;
    together = Math.max(together, airborne);
  });
  expect(fleet.metrics()).toMatchObject({ landed: 4, goArounds: 0, stuck: 0 });
  expect(together).toBeGreaterThanOrEqual(2);
  const times = ids.map((id) => touchdownS(poses, id)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  // At least 2.5 NM at 71 m/s apart, and not one landing every few minutes (200 s before).
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual((2.5 * 1852) / 71 - 1);
  expect(Math.max(...gaps)).toBeLessThan(150);
});

test('a medium arrival behind a heavy keeps the wake spacing', () => {
  const { fleet, stands } = fleetOf();
  const heavy = fleet.requestArrival({ typeId: 'B77W', runwayEnd: '27', stand: stands.E1 });
  const medium = fleet.requestArrival({ typeId: 'A20N', runwayEnd: '27', stand: stands.C1 });
  if (!heavy.ok || !medium.ok) throw new Error('requests');
  const poses = run(fleet, 600);
  expect(fleet.metrics()).toMatchObject({ landed: 2, goArounds: 0 });
  // 5 NM at the A320neo's 71 m/s.
  expect(touchdownS(poses, medium.id) - touchdownS(poses, heavy.id)).toBeGreaterThanOrEqual(
    (5 * 1852) / 71 - 1,
  );
});
