import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openBundled } from '../../../bench/bundled-cities';
import { saveProjectJson } from '../../../src/project/save';

// Capture location: the project copy the freiburg shot renders.
//   npm run capture:build -- freiburg [--out=<file>]
// Start from a bundled city (or an import of the area), then add what the shot needs: context
// to the horizon, timed services, demand at the shot's clock, set dressing as data. Point the
// shot's "project" at the output instead of "bundled:freiburg".
const out =
  process.argv.find((a) => a.startsWith('--out='))?.slice(6) ??
  'node_modules/.cache/cityflows/capture/freiburg/project.cityflows.json';
const project = await openBundled('freiburg');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await saveProjectJson(project, { projectId: 'freiburg-capture' }));
console.info(out);
