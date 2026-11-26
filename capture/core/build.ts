import { existsSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Capture: builds a location's project copy with its own script.
//   npm run capture:build -- <location> [options the location's build-project.ts takes]

const name = process.argv[2];
const script = `capture/locations/${name}/build-project.ts`;
if (!name || !existsSync(script))
  throw new Error(`Usage: npm run capture:build -- <location>, with ${script} present`);
await import(pathToFileURL(script).href);
