import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { serializeShot, parseShot } from './shot';

// Capture: a new location folder with a project build script and a shot to start from.
//   npm run capture:new -- <name> [--city=<bundled city id>]
// The shot starts on the bundled city (or the project the build script writes, once it is
// changed to build one), a 6 s push-in over the first key, with no layers on.

const name = process.argv[2];
const city = process.argv.find((a) => a.startsWith('--city='))?.slice(7) ?? name;
if (!name || !/^[a-z0-9-]+$/.test(name))
  throw new Error('Usage: npm run capture:new -- <name> [--city=<bundled city id>] (kebab-case)');
const dir = `capture/locations/${name}`;
if (existsSync(dir)) throw new Error(`${dir} already exists`);
mkdirSync(dir, { recursive: true });

const project = `node_modules/.cache/cityflows/capture/${name}/project.cityflows.json`;
writeFileSync(
  `${dir}/build-project.ts`,
  `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openBundled } from '../../../bench/bundled-cities';
import { saveProjectJson } from '../../../src/project/save';

// Capture location: the project copy the ${name} shot renders.
//   npm run capture:build -- ${name} [--out=<file>]
// Start from a bundled city (or an import of the area), then add what the shot needs: context
// to the horizon, timed services, demand at the shot's clock, set dressing as data. Point the
// shot's "project" at the output instead of "bundled:${city}".
const out =
  process.argv.find((a) => a.startsWith('--out='))?.slice(6) ??
  '${project}';
const project = await openBundled('${city}');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await saveProjectJson(project, { projectId: '${name}-capture' }));
console.info(out);
`,
);
const shot = parseShot({
  location: name,
  project: `bundled:${city}`,
  duration: 6,
  sim: { start: '08:00' },
  light: { exposure: 1, date: '2026-06-21', sun: { from: '10:00' } },
  map: { basemap: false, labels: false, places: false },
  title: null,
  formats: {
    landscape: { width: 1920, height: 1080, canvasHeight: 1080, fov: 36, titleX: 960 },
    portrait: { width: 1080, height: 1920, canvasHeight: 1920, fov: 51, titleX: 540 },
  },
  keys: [
    { t: 0, x: 0, y: 0, zoom: 4, pitch: 35, bearing: 0 },
    { t: 6, x: 0, y: 0, zoom: 8, pitch: 25, bearing: 20 },
  ],
  layers: {},
});
writeFileSync(`${dir}/shot.json`, serializeShot(shot));
console.info(`${dir}/build-project.ts\n${dir}/shot.json`);
console.info(
  `Open the app with ?capture=${dir}/shot.json to set the keys, then npm run capture -- ${dir}/shot.json --mock=0`,
);
