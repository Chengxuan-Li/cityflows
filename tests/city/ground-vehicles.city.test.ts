import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { createGroundVehicles } from '../../src/sim/ground-vehicles';
import { groundOverlaps } from '../sim/ground-vehicle-checks';
import { limit } from '../timeouts';

// TASK-316: London City's morning bank (06:00 to 09:00) with its ground vehicles: turnarounds
// served on their timelines, vehicles holding short of aircraft, never on each other, the same
// run twice, and the aircraft exactly as without vehicles. The full days run in the traffic tier.

const word = (hash: number, value: number) => {
  for (let i = 0; i < 4; i++) {
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193);
    value >>>= 8;
  }
  return hash;
};

async function morning(withVehicles: boolean) {
  const project = await openBundled('london-city-airport');
  const result = compile(project.city);
  if (!result.ok || !result.compiled.airside) throw new Error('London City must compile');
  const fleet = createAircraftFleet(result.compiled.airside, 1);
  const operations = createFlightOperations(fleet, 1, 0);
  const ground = withVehicles
    ? createGroundVehicles(result.compiled, {
        snapshot: () => fleet.snapshot(),
        drainTurnarounds: () => operations.drainTurnarounds(),
      })
    : null;
  let withAircraft = 0,
    between = 0,
    peak = 0;
  for (let step = 0; step <= 9 * 36_000; step++) {
    const timeS = step / 10;
    operations.step(timeS);
    fleet.step(timeS);
    ground?.step(timeS);
    if (!ground || step % 10 !== 0 || timeS < 6 * 3600) continue;
    const vehicles = ground.snapshot();
    peak = Math.max(peak, vehicles.length);
    const found = groundOverlaps(vehicles, fleet.snapshot());
    withAircraft += found.withAircraft.length;
    between += found.withVehicles.length;
  }
  return {
    fleetHash: fleet.hash(word, 0x811c9dc5) >>> 0,
    groundHash: ground ? ground.hash(word, 0x811c9dc5) >>> 0 : 0,
    metrics: ground?.metrics(),
    turnarounds: ground?.turnarounds() ?? [],
    withAircraft,
    withVehicles: between,
    peak,
  };
}

test(
  'London City: ground vehicles work the morning turnarounds and give way',
  { timeout: limit(180_000) },
  async () => {
    const run = await morning(true);
    console.info({ ...run.metrics, withAircraft: run.withAircraft, peak: run.peak });
    const metrics = run.metrics!;
    expect(metrics.turnarounds).toBeGreaterThan(10);
    expect(metrics.served / metrics.visits).toBeGreaterThan(0.5);
    // Served visits came before their vehicle had to leave.
    for (const turn of run.turnarounds)
      for (const visit of turn.visits)
        if (visit.arrivedS !== undefined && visit.slot !== 'tug')
          expect(visit.arrivedS).toBeLessThan(visit.leaveS);
    // Vehicles held short of zones aircraft were coming through.
    expect(metrics.yields).toBeGreaterThan(0);
    expect(run.withVehicles).toBe(0);
    // Known residual (report): a wing of an aircraft towed or pushed past a neighbouring stand.
    expect(run.withAircraft).toBeLessThanOrEqual(2);
    expect(metrics.stuck).toBe(0);
    // The same run twice, and the aircraft unchanged by the vehicles.
    const again = await morning(true);
    expect(again.groundHash).toBe(run.groundHash);
    const alone = await morning(false);
    expect(alone.fleetHash).toBe(run.fleetHash);
  },
);
