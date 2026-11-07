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
  expect(morning.failed).toBe(morning.failedByReason.gridlocked);
  expect(morning.completed).toBeGreaterThanOrEqual(Math.floor(445 * 0.99));
  expect(morning.gatewayTraffic.trunk!.entered).toBeGreaterThan(0);
  expect(morning.gatewayTraffic.trunk!.left).toBeGreaterThan(0);
  expect(morning.sampledRoadTraffic.ramp!.entered).toBeGreaterThan(0);
  expect(morning.sampledRoadTraffic.ramp!.left).toBeGreaterThan(0);
}, 600_000);
