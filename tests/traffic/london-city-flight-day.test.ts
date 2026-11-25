import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { createGroundVehicles } from '../../src/sim/ground-vehicles';
import { groundOverlaps } from '../sim/ground-vehicle-checks';
import type { AirportWind } from '../../src/sim/runway-configuration';
import { onRunway, overlaps } from '../sim/aircraft-checks';
import { limit } from '../timeouts';

async function flightDay(seed: number, winds: { timeS: number; wind: AirportWind }[] = []) {
  const project = await openBundled('london-city-airport');
  const result = compile(project.city);
  if (!result.ok || !result.compiled.airside) throw new Error('London City must compile');
  const fleet = createAircraftFleet(result.compiled.airside, seed);
  const operations = createFlightOperations(fleet, seed, 0);
  // TASK-316: with its ground vehicles, which the aircraft never see.
  const ground = createGroundVehicles(result.compiled, {
    snapshot: () => fleet.snapshot(),
    movementSpace: () => fleet.movementSpace(),
    drainTurnarounds: () => operations.drainTurnarounds(),
  });
  let vehicleOverlaps = 0;
  let vehicleAircraftOverlaps = 0;
  let overlapCount = 0;
  let runwayConflicts = 0;
  let peakStuck = 0;
  let peakMovingOnApron = 0;
  let concurrentApronSamples = 0;
  for (let step = 0; step < 864_000; step++) {
    const timeS = step / 10;
    for (const change of winds) if (change.timeS * 10 === step) operations.setWind(change.wind);
    operations.step(timeS);
    fleet.step(timeS);
    ground.step(timeS);
    if (step % 10 !== 0) continue;
    const aircraft = fleet.snapshot();
    const vehicles = groundOverlaps(ground.snapshot(), aircraft);
    vehicleOverlaps += vehicles.withVehicles.length;
    vehicleAircraftOverlaps += vehicles.withAircraft.length;
    overlapCount += overlaps(aircraft).length;
    runwayConflicts += Number(onRunway(aircraft).length > 1);
    peakStuck = Math.max(peakStuck, fleet.metrics().stuck);
    const moving = aircraft.filter(
      ({ state, speedMps, onRunway }) =>
        !onRunway &&
        speedMps > 0.05 &&
        (state === 'taxi' || state === 'tow' || state === 'pushback'),
    ).length;
    peakMovingOnApron = Math.max(peakMovingOnApron, moving);
    concurrentApronSamples += Number(moving > 1);
  }
  operations.step(86_400);
  return {
    metrics: operations.metrics(),
    aircraft: fleet.metrics(),
    transitions: fleet.runwayTransitions(),
    overlapCount,
    runwayConflicts,
    peakStuck,
    peakMovingOnApron,
    concurrentApronSamples,
    vehicles: ground.metrics(),
    vehicleOverlaps,
    vehicleAircraftOverlaps,
  };
}

test.for([1, 2, 3])(
  'London City operates its flight day with seed %i',
  { timeout: limit(120_000) },
  async (seed) => {
    const day = await flightDay(seed);
    console.info({ seed, ...day });
    const { metrics, aircraft } = day;
    expect(metrics.scheduled).toBe(150);
    expect(metrics.completed / metrics.scheduled).toBeGreaterThanOrEqual(0.98);
    expect(day.overlapCount).toBe(0);
    expect(day.runwayConflicts).toBe(0);
    expect(day.peakStuck).toBe(0);
    expect(day.peakMovingOnApron).toBeGreaterThan(1);
    expect(aircraft.goArounds).toBe(0);
    expect(metrics.meanDelayS).toBeLessThanOrEqual(300);
    expect(metrics.worstDelayS).toBeLessThanOrEqual(1800);
    expect(day.vehicleOverlaps).toBe(0);
    expect(day.vehicleAircraftOverlaps).toBe(0);
    // TASK-316 / TASK-350: visits served and pushes with a vehicle tug (seeds 1 to 3: 91 to 93%
    // and 78 to 81%; before TASK-350 64 to 73% and 54 to 59%, with vehicles holding one another
    // off where parked tails cover the apron road).
    expect(day.vehicles.served).toBeGreaterThanOrEqual(0.85 * day.vehicles.visits);
    const { pushbacks, tugsMissing } = day.vehicles;
    expect(pushbacks - tugsMissing).toBeGreaterThanOrEqual(0.75 * pushbacks);
  },
);

test(
  'London City changes runway with two wind changes at the default seed',
  { timeout: limit(120_000) },
  async () => {
    const hourS = 3600;
    const day = await flightDay(1, [
      // An easterly beyond the 5 kt tailwind limit on 27 turns the airport to 09 ...
      { timeS: 8.5 * hourS, wind: { fromDeg: 70, speedKt: 12 } },
      // ... and the westerly's return turns it back to 27.
      { timeS: 17.5 * hourS, wind: { fromDeg: 250, speedKt: 10 } },
    ]);
    console.info(day);
    expect(day.transitions.map(({ fromId, toId }) => [fromId, toId])).toEqual([
      ['27', '09'],
      ['09', '27'],
    ]);
    for (const { startS, openS } of day.transitions) expect(openS).toBeGreaterThanOrEqual(startS);
    expect(day.metrics.completed / day.metrics.scheduled).toBeGreaterThanOrEqual(0.98);
    expect(day.overlapCount).toBe(0);
    expect(day.runwayConflicts).toBe(0);
    expect(day.peakStuck).toBe(0);
  },
);
