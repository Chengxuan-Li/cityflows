import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { openProject } from '../src/project/open';
import type { Project } from '../src/project/types';
import { buildFreiburgProject, showcaseProject } from './freiburg';
import { loadAuditCity } from './junction-audit';

// TASK-258: the builder of every bundled real place in the New city panel. Freiburg keeps its
// recipe and curation (`bench/freiburg.ts`); the other cities ship the raw import of their
// committed extract with the options their own tests use (`loadAuditCity`), as the owner's
// 2026-11-20 rule asks: no per-id curation. tests/city/bundled-cities.city.test.ts fails when an
// archive no longer matches a fresh build, so after an importer change rebuild them all with
//   node --experimental-strip-types --import ./bench/register.ts bench/bundled-cities.ts
// or some of them by id (`... bench/bundled-cities.ts munich sindelfingen`).

export const projectFile = (id: string) => `fixtures/projects/${id}.cityflows.json`;

/** The bbox import as the city's tests make it, flat: with the terrain fixture the 3D scene took
 * 9.8 s (Munich) and 19.5 s (Sindelfingen) after the click against the landing budget of 5 s
 * (TASK-258), so the terrain is dropped as Freiburg's is (TASK-201). */
async function rawImport(id: 'munich' | 'sindelfingen', name: string): Promise<string> {
  const city = loadAuditCity(id);
  city.name = name;
  delete city.terrain;
  return showcaseProject(city, id, '2026-11-20T00:00:00.000Z');
}

/** Builds each bundled real place by its id (`?city=<id>`, `src/ui/bundled-projects.ts`). */
export const realPlaceBuilds: Record<string, () => Promise<string>> = {
  freiburg: buildFreiburgProject,
  munich: () => rawImport('munich', 'Munich Donnersbergerbrücke'),
  sindelfingen: () => rawImport('sindelfingen', 'Sindelfingen A81'),
};

/** The committed bundled project, opened as the app opens it. */
export async function openBundled(id: string): Promise<Project> {
  const result = await openProject(readFileSync(projectFile(id), 'utf8'));
  if (!result.ok) throw new Error(`${result.file}: ${result.error}`);
  return result.project;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('bench/bundled-cities.ts')) {
  const ids = process.argv.slice(2);
  for (const id of ids.length ? ids : Object.keys(realPlaceBuilds)) {
    const build = realPlaceBuilds[id];
    if (!build) throw new Error(`Unknown real place ${id}: ${Object.keys(realPlaceBuilds)}`);
    const json = await build();
    writeFileSync(projectFile(id), json);
    console.info(`${projectFile(id)}: ${(json.length / 1e6).toFixed(2)} MB`);
  }
}
