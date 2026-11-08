import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { runHeadless } from '../../src/host/headless';
import { createEngine } from '../../src/sim/engine';
import type { VehicleClass } from '../../src/schema';
import { scenario, setup, trips } from '../sim/fixtures';

test('same city, demand and seed produce identical comparison numbers', () => {
  const city = grid5x5();
  const input = {
    compiled: setup(city),
    trips: trips(city, 12, 4),
    scenario: { ...scenario(), endS: 700 },
  };
  const baseline = runHeadless(input);
  expect(runHeadless(input)).toEqual(baseline);
  expect(baseline.metrics.trips.completed).toBe(12);
  expect(baseline.metrics.completedByClass).toEqual({ car: 12, van: 0, truck: 0, bus: 0 });
  expect(baseline.travelTime.meanS).toBeCloseTo(baseline.metrics.meanTravelTimeS, 8);
  expect(baseline.travelTime.meanDelayS).toBeCloseTo(baseline.metrics.meanDelayS, 8);
  expect(baseline.travelTime.p90DelayS).toBeGreaterThan(0);
  expect(Object.values(baseline.roadVehicleCounts).some((count) => count > 0)).toBe(true);
  expect(baseline.series).toHaveLength(11);
  expect(baseline.metrics.parking.facilities).toHaveLength(2);
  expect(baseline.series.every(({ parkingOccupancy }) => parkingOccupancy !== undefined)).toBe(
    true,
  );
  expect(baseline.series.at(-1)!.parkingOccupancy).toEqual(
    Object.fromEntries(
      baseline.metrics.parking.facilities.map(({ id, occupied }) => [id, occupied]),
    ),
  );
  const interactive = createEngine();
  interactive.load(input);
  interactive.step(6000);
  expect(baseline.metrics).toEqual(interactive.metrics());
  const origin = input.compiled.connectors.find(({ direction }) => direction === 'out')!;
  expect(
    baseline.roadVehicleCounts[input.compiled.roads[input.compiled.lanes[origin.lane]!.road]!.id],
  ).toBe(12);
  expect(Object.values(baseline.roadVehicleCounts).every((count) => count <= 12)).toBe(true);
});

test('unfinished and unsupported trips are not included in the completed travel distribution', () => {
  const city = grid5x5();
  const requests = trips(city, 3);
  requests[1]!.mode = 'walk';
  requests[2]!.departS = 900;
  const result = runHeadless({
    compiled: setup(city),
    trips: requests,
    scenario: { ...scenario(), endS: 101 },
  });
  expect(result.metrics.trips).toMatchObject({ completed: 0, failed: 1, pending: 1, driving: 1 });
  expect(result.metrics.failedByReason.unsupported_mode).toBe(1);
  expect(result.travelTime).toEqual({
    travelTimesS: [],
    delaysS: [],
    meanS: 0,
    meanDelayS: 0,
    p90DelayS: 0,
  });
});

test('headless completion accounting preserves all four vehicle classes', () => {
  const city = grid5x5();
  const classes: VehicleClass[] = ['car', 'van', 'truck', 'bus'];
  for (const road of Object.values(city.roads)) {
    for (const lane of road.lanes) lane.allowed = classes.slice();
  }
  const requests = trips(city, 4, 30).map((trip, index) => ({
    ...trip,
    vehicleClass: classes[index]!,
    purpose: 'through' as const,
  }));
  const result = runHeadless({
    compiled: setup(city),
    trips: requests,
    scenario: { ...scenario(), endS: 700 },
  });
  expect(result.metrics.trips.completed).toBe(4);
  expect(result.metrics.completedByClass).toEqual({ car: 1, van: 1, truck: 1, bus: 1 });
});
