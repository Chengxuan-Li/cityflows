import { beforeAll, expect, test } from 'vitest';
import { loadAuditCity } from '../../bench/junction-audit';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile, type CompiledCity } from '../../src/network';
import type { Scenario } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import type { Metrics } from '../../src/sim/types';
import { sampleCrossings } from '../sim/crossing-safety';

// TASK-111 gates 4 and 5 on Munich: the traffic gate's morning at 0.15, 07:00 to 08:00, with the
// test source at 2 000 walkers per hour over ten crossing pairs (four over signals, among them
// Landsberger Straße at the Donnersbergerbrücke, six over zebras), sampled at every step.

export const munichWalkerPairs: [string, string][] = [
  ['p:1571', 'p:1831'], // signals n:963 and n:262, Landsberger Straße at the Donnersbergerbrücke
  ['p:1831', 'p:1571'],
  ['p:1579', 'p:1809'], // signal n:328, Landsberger Straße and Schrenkstraße
  ['p:1579', 'p:1799'], // signal n:328
  ['p:1709', 'p:1675'], // zebras at n:79
  ['p:1789', 'p:1793'], // zebras at n:85
  ['p:1573', 'p:1789'], // zebras at n:189
  ['p:1751', 'p:1673'], // zebra at n:859 (TASK-119 removed street-side parking place p:1667)
  ['p:1575', 'p:1669'], // zebra at n:421
  ['p:1677', 'p:1709'], // zebra at n:212
];

let compiled: CompiledCity;
const runs: Record<'plain' | 'walkers', { metrics: Metrics; overlap: string | null }> = {} as never;

beforeAll(() => {
  const city = loadAuditCity('munich');
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  compiled = result.compiled;
  const scenario: Scenario = { ...defaultScenario('grid5x5'), startS: 7 * 3600, endS: 10 * 3600 };
  scenario.demand.personsPerResident = 0.15;
  const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
  const walkers = munichWalkerPairs.map(([fromPlaceId, toPlaceId]) => ({
    fromPlaceId,
    toPlaceId,
    perHour: 200,
  }));
  for (const kind of ['plain', 'walkers'] as const) {
    const engine = createEngine();
    engine.load({
      compiled,
      trips,
      scenario: kind === 'walkers' ? { ...scenario, walkers } : scenario,
    });
    let overlap: string | null = null;
    for (let step = 0; step < 36000; step++) {
      engine.step();
      if (kind === 'walkers') overlap ??= sampleCrossings(engine, compiled);
    }
    runs[kind] = { metrics: engine.metrics(), overlap };
  }
}, 900_000);

test('T53 Munich: no vehicle body over a crossing span a walker is inside', () => {
  expect(runs.walkers.overlap).toBeNull();
  const walkers = runs.walkers.metrics.walkers!;
  console.info('T53 Munich walkers', JSON.stringify(walkers));
  expect(walkers.dropped).toBe(0);
  expect(walkers.completed).toBeGreaterThan(1500);
  expect(walkers.crossings.zebra).toBeGreaterThan(0);
  expect(walkers.crossings.signal).toBeGreaterThan(0);
});

test('T53 Munich: zone stops do not rise beyond noise and traffic still flows', () => {
  const { plain, walkers } = runs;
  console.info('T53 Munich vehicles', {
    zoneStops: [plain.metrics.zoneStops, walkers.metrics.zoneStops],
    completed: [plain.metrics.trips.completed, walkers.metrics.trips.completed],
    gridlocked: [
      plain.metrics.failedByReason.gridlocked,
      walkers.metrics.failedByReason.gridlocked,
    ],
  });
  expect(walkers.metrics.zoneStops).toBeLessThanOrEqual(plain.metrics.zoneStops * 1.5 + 10);
  // Lead: TASK-103 lowered this to 0.94 while unowned stock crowded the curbs; with starting
  // stock per person the walkers cost 1.4% again (1 938 to 1 911), so TASK-111's 0.97 held.
  // TASK-122 (owner, 2026-11-10): 0.95. Cars that no longer park where they cannot leave send
  // more traffic through the Landsberger corridor two walker pairs cross; over three demand seeds
  // the walkers cost 2.2 to 4.1% (main 0.4 to 1.9%).
  expect(walkers.metrics.trips.completed).toBeGreaterThan(plain.metrics.trips.completed * 0.95);
  expect(walkers.metrics.failedByReason.gridlocked).toBeLessThanOrEqual(
    plain.metrics.failedByReason.gridlocked + 3,
  );
});
