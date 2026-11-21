import { createHash } from 'node:crypto';
import process from 'node:process';
import { InstancedMesh, type BufferGeometry, type Object3D } from 'three';
import { compile } from '../src/network';
import { paintedCity } from '../src/render/road-paint';
import { buildFootbridges } from '../src/render3d/footbridges';
import { buildGeometry } from '../src/render3d/geometry';
import { cityHeights } from '../src/render3d/heights';
import { buildWalk } from '../src/render3d/walk';
import { openBundled } from './bundled-cities';

// TASK-278: headless times of the 3D build's height-heavy parts per bundled city (as the app opens
// it, flat), with a sha256 of the walk and footbridge meshes and of buildGeometry's road and
// marking meshes.
// Usage:
// node --experimental-strip-types --import ./bench/register.ts bench/walk-height-time.ts
//   [freiburg|munich|sindelfingen ...] [--runs N]

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt < 0 ? 3 : Number(args[runsAt + 1]);
const names = args.filter((a, i) => !a.startsWith('--') && (runsAt < 0 || i !== runsAt + 1));
const cities = names.length ? names : ['freiburg', 'munich', 'sindelfingen'];

/** A geometry's attribute arrays, by name. */
const arrays = (g: BufferGeometry) =>
  Object.keys(g.attributes)
    .sort()
    .map((name) => g.getAttribute(name).array as Float32Array);
/** The meshes' attribute arrays, and the piers' and posts' instance matrices. */
const meshArrays = (root: Object3D) => {
  const found: Float32Array[] = [];
  root.traverse((o) => {
    if (o instanceof InstancedMesh) found.push(o.instanceMatrix.array as Float32Array);
    else if ('geometry' in o) found.push(...arrays(o.geometry as BufferGeometry));
  });
  return found;
};
const hashOf = (data: Float32Array[]) => {
  const hash = createHash('sha256');
  for (const array of data)
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  return hash.digest('hex').slice(0, 16);
};
const seconds = (ms: number[]) => ms.map((t) => (t / 1000).toFixed(2)).join(', ');

for (const name of cities) {
  const project = await openBundled(name);
  const result = compile(project.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const city = paintedCity(result.compiled);
  const source = project.city;
  const times = { geometry: [] as number[], walk: [] as number[], footbridges: [] as number[] };
  let hashes = { walk: '', footbridges: '', roads: '' };
  for (let i = 0; i < runs; i++) {
    let start = performance.now();
    const geometry = buildGeometry(city, source);
    times.geometry.push(performance.now() - start);
    // A fresh heights object per run, as each 3D build makes, so no per-heights cache carries over.
    const heights = cityHeights(city, source);
    start = performance.now();
    const walk = buildWalk(city, source, heights);
    times.walk.push(performance.now() - start);
    start = performance.now();
    const footbridges = buildFootbridges(city, source, heights);
    times.footbridges.push(performance.now() - start);
    hashes = {
      walk: hashOf([walk.sidewalks, walk.footways, walk.steps].flatMap(arrays)),
      footbridges: `${hashOf(meshArrays(footbridges.group))} ${JSON.stringify(footbridges.counts)}`,
      roads: hashOf(
        [geometry.surfaces, geometry.slabs, geometry.crossings, geometry.markings].flatMap(arrays),
      ),
    };
  }
  console.info(
    `${name}: buildGeometry ${seconds(times.geometry)} s; buildWalk ${seconds(times.walk)} s; ` +
      `buildFootbridges ${seconds(times.footbridges)} s; walk ${hashes.walk}, ` +
      `footbridges ${hashes.footbridges}, roads ${hashes.roads}`,
  );
}
