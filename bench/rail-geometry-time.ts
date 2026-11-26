import { createHash } from 'node:crypto';
import process from 'node:process';
import { compile, type CompiledCity } from '../src/network';
import { railGeometry } from '../src/render/rail-geometry';
import type { City } from '../src/schema';
import { openFreiburg } from './freiburg';
import { loadAuditCity } from './junction-audit';

// TASK-266: headless `railGeometry` time and output hash per city. Usage:
// node --experimental-strip-types --import ./bench/register.ts bench/rail-geometry-time.ts
//   [freiburg|munich|sindelfingen ...] [--runs N]

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt < 0 ? 3 : Number(args[runsAt + 1]);
const names = args.filter((a, i) => !a.startsWith('--') && (runsAt < 0 || i !== runsAt + 1));
const cities = names.length ? names : ['freiburg', 'munich', 'sindelfingen'];

const railShapesHash = (shapes: ReturnType<typeof railGeometry>) =>
  createHash('sha256').update(JSON.stringify(shapes)).digest('hex');

for (const name of cities) {
  const city: City =
    name === 'freiburg'
      ? (await openFreiburg()).city
      : loadAuditCity(name as 'munich' | 'sindelfingen');
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const compiled: CompiledCity = result.compiled;
  const times: number[] = [];
  let shapes: ReturnType<typeof railGeometry> = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    shapes = railGeometry(compiled, city);
    times.push(performance.now() - start);
  }
  console.info(
    `${name}: ${times.map((t) => `${(t / 1000).toFixed(2)} s`).join(', ')}; ` +
      `${compiled.rail?.tracks.length ?? 0} tracks, ${shapes.length} shapes, ${railShapesHash(shapes)}`,
  );
}
