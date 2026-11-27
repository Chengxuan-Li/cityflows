import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import type { TurnaroundEvent } from '../../src/sim/flight-operations';
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
        movementSpace: () => fleet.movementSpace(),
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
    expect(metrics.served / metrics.visits).toBeGreaterThan(0.4);
    // Served visits came before their vehicle had to leave.
    for (const turn of run.turnarounds)
      for (const visit of turn.visits)
        if (visit.arrivedS !== undefined && visit.slot !== 'tug')
          expect(visit.arrivedS).toBeLessThan(visit.leaveS);
    // Vehicles held short of zones aircraft were coming through.
    expect(metrics.yields).toBeGreaterThan(0);
    expect(Object.values(metrics.missingTugsBy).reduce((n, count) => n + count, 0)).toBe(
      metrics.tugsMissing,
    );
    expect(Object.values(metrics.droppedBy).reduce((n, count) => n + count, 0)).toBe(
      metrics.dropped,
    );
    expect(Object.values(metrics.lateBy).reduce((n, count) => n + count, 0)).toBe(
      metrics.late + metrics.missed,
    );
    expect(Object.values(metrics.queuedBy).reduce((n, count) => n + count, 0)).toBe(metrics.stuck);
    expect(run.withVehicles).toBe(0);
    expect(run.withAircraft).toBe(0);
    // A few wait long for an aircraft whose due push or tow is late (report).
    expect(metrics.stuck).toBeLessThanOrEqual(3);
    // The same run twice, and the aircraft unchanged by the vehicles.
    const again = await morning(true);
    expect(again.groundHash).toBe(run.groundHash);
    const alone = await morning(false);
    expect(alone.fleetHash).toBe(run.fleetHash);
  },
);

test(
  'Zurich: a tug takes the short road route to a remote stand',
  { timeout: limit(60_000) },
  async () => {
    const project = await openBundled('zurich-airport');
    const result = compile(project.city);
    if (!result.ok || !result.compiled.airside) throw new Error('Zurich must compile');
    const graph = result.compiled.airside;
    const fleet = createAircraftFleet(graph, 1);
    const stand = 'st:21356';
    const typeId = 'E190';
    const parked = fleet.spawnParked({ typeId, stand });
    if (!parked.ok) throw new Error('The test aircraft must fit its stand');
    const events: TurnaroundEvent[] = [
      {
        kind: 'tow-planned',
        id: parked.id,
        stand: graph.index.stand.get(stand)!,
        typeId,
        timeS: 300,
      },
    ];
    const ground = createGroundVehicles(result.compiled, {
      snapshot: () => fleet.snapshot(),
      movementSpace: () => [],
      drainTurnarounds: () => events.splice(0),
    });
    // The geographically nearest depot is over 7 km away by road. Another needs only about 1.3 km.
    for (let step = 0; step <= 3_000; step++) ground.step(step / 10);
    expect(ground.metrics().served).toBe(1);
  },
);
