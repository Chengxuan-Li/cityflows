import { expect, test } from 'vitest';
import { probeMorning } from '../../bench/import-probe';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { fixture } from '../importers/fixtures';

// TASK-090: the morning of tests/importers/munich.test.ts, at full demand (scale 1, not the 0.15
// of the other mornings), so it runs on its own, beside tests/traffic/munich-morning.test.ts.
test('Munich import satisfies topology, demand, route and morning-run targets', () => {
  const { xml } = fixture('munich-donnersberger');
  const imported = importOsmCached(xml, {
    importerVersion: 'test',
    bbox: [11.525, 48.135, 11.545, 48.148],
  });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const { city } = imported;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const morning = probeMorning(city, result.compiled);
  console.info('Munich morning probe', morning);
  expect(morning.releasedTrips).toBeGreaterThan(10_000);
  // At full demand the city jams; the only failures are trips stuck at a jam head again after
  // their last respawn (TASK-077).
  // TASK-103: a counted parking failure is the other allowed failure, under 2% of local arrivals.
  expect(morning.failed).toBe(
    morning.failedByReason.gridlocked + morning.failedByReason.no_parking,
  );
  // Lead (TASK-121/112 merge, 2026-11-09): back to 2% (30 of 1 729). Most failures are still trip
  // cars on strips they cannot drive away from (one-way lanes into the crop); TASK-122 removes them.
  expect(morning.failedByReason.no_parking).toBeLessThan(0.02 * morning.localArrivals);
  expect(morning.completed).toBeGreaterThanOrEqual(Math.floor(445 * 0.99));
  expect(morning.gatewayTraffic.trunk!.entered).toBeGreaterThan(0);
  expect(morning.gatewayTraffic.trunk!.left).toBeGreaterThan(0);
  expect(morning.sampledRoadTraffic.ramp!.entered).toBeGreaterThan(0);
  expect(morning.sampledRoadTraffic.ramp!.left).toBeGreaterThan(0);
}, 900_000); // CI runners took 203 to 479 s before TASK-118/119 (lead, 2026-11-09)
