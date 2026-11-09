import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRandom } from '../src/geo/random';
import { compile } from '../src/network';
import { probeMorning } from './import-probe';
import { loadAuditCity } from './junction-audit';

// TASK-121: repeatable 1 cm perturbations away from B56. Baseline is an explicit checkout,
// so a concurrently advancing main never silently changes the comparison.
// CITYFLOWS_BASELINE_ROOT=<checkout> npm exec -- node --experimental-strip-types
//   --import ./bench/register.ts ./bench/head-detour-stability.ts [output.json]
const root = process.env.CITYFLOWS_BASELINE_ROOT;
if (!root) throw new Error('Set CITYFLOWS_BASELINE_ROOT to the main baseline checkout');
const baseline = (await import(pathToFileURL(resolve(root, 'bench/import-probe.ts')).href)) as {
  probeMorning: typeof probeMorning;
};
const source = loadAuditCity('munich');
const excluded = new Set(['n:138', 'n:263', 'n:967', 'n:638']);
const candidates = Object.values(source.roads)
  .filter(
    (road) =>
      road.roadClass === 'residential' &&
      !excluded.has(road.from) &&
      !excluded.has(road.to) &&
      road.centerline.length > 2,
  )
  .sort((a, b) => a.id.localeCompare(b.id));
const records: unknown[] = [];
for (const seed of [1, 2, 3]) {
  const city = structuredClone(source);
  const random = createRandom(seed);
  const road = city.roads[candidates[Math.floor(random.next() * candidates.length)]!.id]!;
  const angle = random.next() * 2 * Math.PI;
  const dx = Math.cos(angle) * 0.01,
    dy = Math.sin(angle) * 0.01;
  // Interior vertices only: endpoints, junctions and topology stay fixed.
  for (const point of road.centerline.slice(1, -1)) {
    point.x += dx;
    point.y += dy;
  }
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  for (const [tree, probe] of [
    ['main', baseline.probeMorning],
    ['branch', probeMorning],
  ] as const) {
    const start = performance.now();
    const morning = probe(city, result.compiled, 0.15, { untilS: 9.5 * 3600 });
    const record = {
      seed,
      road: road.id,
      dx,
      dy,
      tree,
      elapsedMs: performance.now() - start,
      ...morning,
    };
    records.push(record);
    console.info(
      JSON.stringify({
        seed,
        road: road.id,
        tree,
        completed: morning.completed,
        gridlocked: morning.failedByReason.gridlocked,
        routeRequests: morning.routeRequests,
      }),
    );
  }
}
writeFileSync(process.argv[2] ?? 'task121-stability.log', JSON.stringify(records, null, 2));
for (const tree of ['main', 'branch']) {
  const counts = (records as { tree: string; completed: number }[])
    .filter((r) => r.tree === tree)
    .map((r) => r.completed);
  console.info({ tree, completed: counts, spread: Math.max(...counts) - Math.min(...counts) });
}
