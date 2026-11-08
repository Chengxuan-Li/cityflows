import { readFileSync } from 'node:fs';
import { compile } from '../src/network';
import { probeMorning } from './import-probe';
import { loadAuditCity } from './junction-audit';

// A quick Munich morning for iterating (TASK-090), advisory only: the traffic gate's run (the
// extract at --scale 0.15, the same demand) stopped at 09:30, its totals and their change against
// main's recorded in bench/traffic-baseline.json. On a18cce0 and 81dfcd0 it ranks the two trees as
// the full morning does on completed trips and gridlock; the gate itself is `npm run test:traffic`.
// Usage: npm run traffic:quick

const untilS = 9.5 * 3600;
const { quick } = JSON.parse(readFileSync('bench/traffic-baseline.json', 'utf8')) as {
  quick: { completed: number; gridlocked: number };
};
const start = performance.now();
const city = loadAuditCity('munich');
const result = compile(city);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
const morning = probeMorning(city, result.compiled, 0.15, { untilS });
const totals = {
  completed: morning.completed,
  failed: morning.failed,
  gridlocked: morning.failedByReason.gridlocked,
  stalledHeads: morning.stalledHeads,
  failedByReason: morning.failedByReason,
  parking: {
    arrivals: morning.parking.arrivals,
    meanSearchTimeS: morning.parking.meanSearchTimeS,
    failed: morning.parking.failed,
    localArrivals: morning.localArrivals,
  },
};
console.info(
  `Munich at 0.15, 07:00 to 09:30, ${((performance.now() - start) / 1000).toFixed(1)} s:`,
  totals,
);
console.info('against main', {
  completed: totals.completed - quick.completed,
  gridlocked: totals.gridlocked - quick.gridlocked,
});
