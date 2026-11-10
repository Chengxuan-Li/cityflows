import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { probeMorning } from '../../bench/import-probe';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile, type CompiledCity } from '../../src/network';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import type { TrafficEngine } from '../../src/sim/types';
import { sampleConflictZones } from '../sim/conflict-zone-safety';

// TASK-090: the one Munich morning at scale 0.15, 7:00 to 10:00, that T21, T29 and the traffic
// gates each ran on their own: `npm run import-probe` at --scale 0.15, run once with every
// test's observer attached. Each assertion keeps its test's name.

const { missedTurnAfterS } = DEFAULT_SIM_PARAMS;
/** Main's figures at 0.15, recorded once for every gate. */
const baseline = JSON.parse(readFileSync('bench/traffic-baseline.json', 'utf8')) as {
  completed: number;
  gridlocked: number;
  stalledHeads: number;
};

/** T21: contacting-zone samples at every step, and the first overlap found. */
const zones = { contacts: 0, overlap: '' };
/** T29: the longest a car off its target lanes stood still, sampled every second. */
const offTarget = { longest: 0, longestWatched: 0 };
let endS = 0;
let morning: ReturnType<typeof probeMorning>;

function t29Observer(compiled: CompiledCity) {
  const watched = new Set(['r:639', 'r:1299', 'r:968', 'r:884']);
  const since = new Map<number, number>();
  return (engine: TrafficEngine) => {
    const snapshot = engine.snapshot();
    for (const [index, id] of snapshot.id.entries()) {
      const lane = compiled.lanes[snapshot.lane[index]!];
      const detail = lane && snapshot.speed[index]! < 0.1 ? engine.inspect(id)! : null;
      const step = detail?.route?.roads.indexOf(lane!.road) ?? -1;
      const isOffTarget =
        detail !== null &&
        step >= 0 &&
        step < detail.route!.roads.length - 1 &&
        !detail.route!.targetLanes[step]!.includes(lane!.idx);
      if (!isOffTarget) {
        since.delete(id);
        continue;
      }
      const start = since.get(id) ?? engine.timeS;
      since.set(id, start);
      offTarget.longest = Math.max(offTarget.longest, engine.timeS - start);
      if (watched.has(compiled.roads[lane!.road]!.id))
        offTarget.longestWatched = Math.max(offTarget.longestWatched, engine.timeS - start);
    }
  };
}

beforeAll(() => {
  const city = loadAuditCity('munich');
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { compiled } = result;
  const t29 = t29Observer(compiled);
  let steps = 0;
  morning = probeMorning(city, compiled, 0.15, {
    observe(engine) {
      steps++;
      if (!zones.overlap)
        try {
          zones.contacts += sampleConflictZones(engine, compiled);
        } catch (error) {
          zones.overlap = (error as Error).message;
        }
      if (steps % 10 === 0) t29(engine);
      endS = engine.timeS;
    },
  });
  console.info('Munich morning at 0.15', {
    completed: morning.completed,
    failed: morning.failed,
    failedByReason: morning.failedByReason,
    stalledHeads: morning.stalledHeads,
    contacts: zones.contacts,
    offTarget,
  });
}, 600_000);

test('traffic gate: Munich at 0.15 against main (docs/plan.md "Geometry rework")', () => {
  // 90 percent of main's completed trips, gridlock at most 1.5 times main's, every failure a
  // gridlock or a counted parking failure, and no more stalled jam heads than main. The owner reset the baseline at TASK-099
  // (2026-11-07), which replaced the fixed 3 497 floor and T36.4/T38.5's stage figures; the lead
  // reset it again at TASK-100 (mixed fleet), TASK-104 (surface lots), TASK-102 (garages), TASK-116,
  // TASK-103 (visible parking), TASK-118/119 (parking motion) and TASK-121/112 (queue-head
  // detours, person walks) and TASK-125 (parking claims). TASK-121 restores zero stalled heads.
  expect(morning.completed).toBeGreaterThanOrEqual(Math.ceil(0.9 * baseline.completed));
  expect(morning.failedByReason.gridlocked).toBeLessThanOrEqual(1.5 * baseline.gridlocked);
  // TASK-103: a counted parking failure is the other allowed failure, under 2% of local arrivals.
  expect(morning.failed).toBe(
    morning.failedByReason.gridlocked + morning.failedByReason.no_parking,
  );
  expect(morning.failedByReason.no_parking).toBeLessThan(0.02 * morning.localArrivals);
  expect(morning.stalledHeads).toBeLessThanOrEqual(baseline.stalledHeads);
});

test('T63 parking claims meet the TASK-125 Munich 10:00 gate', () => {
  expect(morning.completed).toBeGreaterThanOrEqual(3571);
  expect(morning.failedByReason.gridlocked).toBeLessThanOrEqual(23);
  expect(morning.failedByReason.no_parking).toBeLessThanOrEqual(13);
  expect(morning.stalledHeads).toBe(0);
  expect(morning.parkingSearchTimeS).toBeLessThan(56894);
  expect(morning.parking.claims!.simultaneousStripChoices).toBe(0);
});

test('T21: Munich at scale 0.15 has no contacting-zone overlap at any morning step', () => {
  expect(zones.overlap).toBe('');
  expect(zones.contacts).toBeGreaterThan(0);
  expect(endS).toBe(10 * 3600);
  // The only failures are trips stuck at a jam head again after their last respawn (TASK-077).
  // TASK-103: a counted parking failure is the other allowed failure, under 2% of local arrivals.
  expect(morning.failed).toBe(
    morning.failedByReason.gridlocked + morning.failedByReason.no_parking,
  );
  expect(morning.failedByReason.no_parking).toBeLessThan(0.02 * morning.localArrivals);
});

// Known to fail (TASK-076 report): Munich still gridlocks from about 08:00, and from then cars
// off their target lanes stand in the jammed queues for hours (TASK-077's respawn is the
// escape). Before the lock the longest off-target hold at the end of a lane is on r:639, about
// 70 s. Turn this into `test` once the city no longer locks.
test.fails('T29 Munich at 0.15: no car off its target lanes stands still for long', () => {
  expect(offTarget.longest).toBeLessThanOrEqual(missedTurnAfterS + 10);
  expect(offTarget.longestWatched).toBeLessThanOrEqual(missedTurnAfterS + 10);
});
