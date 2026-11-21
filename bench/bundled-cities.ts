import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { openProject } from '../src/project/open';
import type { Project } from '../src/project/types';
import { importOsmCached } from './city-cache';
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

/** TASK-285: Center City, Philadelphia, from the Vine Street Expressway to just south of Spruce
 * Street and from 19th to 12th Street: TASK-259's polygon, [longitude, latitude]
 * (docs/decisions/2026-11-20-more-cities.md, fixtures/osm/ATTRIBUTION.txt). */
export const philadelphiaPolygon: [number, number][] = [
  [-75.159, 39.9592],
  [-75.17, 39.9592],
  [-75.1722, 39.9585],
  [-75.173, 39.9566],
  [-75.173, 39.9465],
  [-75.159, 39.9465],
];

/** The polygon import with Freiburg's options but not its curation, flat. */
async function philadelphia(): Promise<string> {
  const result = importOsmCached(
    readFileSync('fixtures/osm/philadelphia-center-city.osm', 'utf8'),
    { importerVersion: '1', drivingSide: 'right', polygon: philadelphiaPolygon, terrain: false },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(-5)));
  result.city.name = 'Philadelphia Center City';
  return showcaseProject(result.city, 'philadelphia', '2026-11-21T00:00:00.000Z');
}

/** Builds each bundled real place by its id (`?city=<id>`, `src/ui/bundled-projects.ts`). */
export const realPlaceBuilds: Record<string, () => Promise<string>> = {
  freiburg: buildFreiburgProject,
  munich: () => rawImport('munich', 'Munich Donnersbergerbrücke'),
  sindelfingen: () => rawImport('sindelfingen', 'Sindelfingen A81'),
  philadelphia,
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
