import { beforeAll, expect, test } from 'vitest';
import { probeMorning } from '../../bench/import-probe';
import { loadAuditCity } from '../../bench/junction-audit';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile, type CompiledCity } from '../../src/network';
import type { City } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { limit } from '../timeouts';

// TASK-113 guard (owner, 2026-11-13): the traffic gate measures car traffic with mode choice off;
// this Munich morning at 0.15, seed 1, runs the default scenario with it on. Not in
// `test:traffic:light` (a second whole Munich run); the full traffic tier runs it.
// TASK-173: each tour chooses as it departs, from that minute's link costs and the car's actual
// space, and the census counts the trips of tours started by 10:00. Seeds 1 to 3: local walk share
// 78.5% / 79.2% / 78.9% of 7,021 / 7,035 / 7,035 trips; vehicle trips completed 2,557 / 2,527 /
// 2,539, 0 gridlocked, 0 stalled heads, 0 parking failures in each. Main 0d7405b (choice at load)
// on the same census: 73.6% / 74.2% / 73.8% (70.6% / 71.2% / 70.7% over the whole day's 7,315 to
// 7,337 trips). Of seed 1's +4.9 points, link costs of the hour give +3.7 (free-flow costs at
// departure: 74.8%), the walk from the car's actual space +1.1, parking room 0.
// TASK-174: transit is the third mode (trams; Munich's S-Bahn calls at one stop inside the extract),
// and persons without a free car choose between walk and transit. Seeds 1 to 3: walk 77.6% / 78.5%
// / 78.6% of 7,021 / 7,035 / 7,035 trips, transit 0.80% / 1.28% / 0.54% (28 / 45 / 19 trips
// started, rising with distance: 0.2% under 0.5 km, 0.4 to 1.5% to 1 km, 1.3 to 2.1% to 2 km);
// vehicle trips completed 2,560 / 2,505 / 2,531, 0 gridlocked, 0 stalled heads. The walk band and
// the completion floor hold unchanged. A ride saves little walking in a 1.5 km district: the mean
// plan walks 12 min, waits 3 and rides 1 against a 15 min walk.

let city: City;
let compiled: CompiledCity;
let morning: ReturnType<typeof probeMorning>;

beforeAll(() => {
  city = loadAuditCity('munich');
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  compiled = result.compiled;
  morning = probeMorning(city, compiled, 0.15);
  console.info('Munich morning at 0.15 with mode choice', {
    completed: morning.completed,
    failedByReason: morning.failedByReason,
    stalledHeads: morning.stalledHeads,
    modes: JSON.stringify(morning.modes),
  });
}, limit(1_200_000));

test('mode share: about 70% of local person trips walk, fewer the farther they go', () => {
  const { walkShareLocal, byBand, localPersonTrips } = morning.modes;
  expect(localPersonTrips).toBeGreaterThan(6500);
  // The seeds span 0.7 points; five points either side catches a changed model or input, not
  // seed noise.
  expect(walkShareLocal).toBeGreaterThan(0.74);
  expect(walkShareLocal).toBeLessThan(0.84);
  // Seed 1: 85% under 0.5 km, 81% to 1 km, 66% to 2 km (no local trips beyond 2 km).
  const shares = Object.values(byBand)
    .filter((band) => band.walk + band.car >= 100)
    .map((band) => band.walkShare);
  expect(shares.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]! - 0.03);
  expect(morning.personMetrics!.walkTripsFailed).toBe(0);
});

test('mode share: about one local trip in a hundred takes the tram, riders ride and get off', () => {
  const { transitShareLocal, byBand, transit } = morning.modes;
  // Seeds 0.54% to 1.28%: a band around them, with transit rising from the shortest band.
  expect(transitShareLocal).toBeGreaterThan(0.002);
  expect(transitShareLocal).toBeLessThan(0.03);
  expect(byBand['<2 km']!.transitShare).toBeGreaterThan(byBand['<0.5 km']!.transitShare);
  const trams = transit!.lines.filter((l) => l.name.startsWith('Tram'));
  expect(trams.reduce((n, l) => n + l.boardings, 0)).toBeGreaterThan(5);
  // TASK-128's riders get off the S-Bahn at Donnersbergerbrücke: 581 to 588 by 10:00.
  const sbahn = transit!.lines.filter((l) => l.name.startsWith('S-Bahn'));
  expect(sbahn.reduce((n, l) => n + l.riderAlightings, 0)).toBeGreaterThan(500);
  expect(transit!.gaveUp).toBe(0);
});

test('mode share: car trips complete with no stalled heads and gridlock within the gate', () => {
  expect(morning.stalledHeads).toBe(0);
  // The gate's limit: 1.5 times the baseline's 5 gridlocked.
  expect(morning.failedByReason.gridlocked).toBeLessThanOrEqual(7);
  expect(morning.failed).toBe(
    morning.failedByReason.gridlocked + morning.failedByReason.no_parking,
  );
  expect(morning.failedByReason.no_parking).toBeLessThan(0.02 * morning.localArrivals);
  // Seeds 2,527 to 2,557: ten percent below the lowest.
  expect(morning.completed).toBeGreaterThanOrEqual(2270);
});

test('mode share: the same seed chooses the same modes and starts the same run', () => {
  const load = () => {
    const scenario = defaultScenario('grid5x5', 1);
    scenario.demand.personsPerResident = 0.15;
    scenario.startS = 7 * 3600;
    scenario.endS = 10 * 3600;
    const population = generatePopulation(city, scenario.demand);
    const trips = scheduleTrips(city, population, scenario, compiled);
    const engine = createEngine();
    engine.load({ compiled, trips, scenario, population });
    engine.step(3000);
    return {
      modes: engine.metrics().tripOutcomes!.map((outcome) => outcome.mode),
      hash: engine.stateHash(),
    };
  };
  const first = load();
  // TASK-173: at 07:05 the walks are the day's trips of persons without a free car and those of
  // tours that chose to walk by then (seed 1: 2,675).
  expect(first.modes.filter((mode) => mode === 'walk').length).toBeGreaterThan(2000);
  expect(load()).toEqual(first);
});
