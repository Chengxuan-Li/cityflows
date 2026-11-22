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

/** TASK-284: the polygon import of an extract TASK-259 scouted, with Freiburg's options but not
 * its curation, flat. The driving side is left to the importer, which infers it from the location
 * (TASK-268: York left, Lübeck right). The polygon is TASK-259's lat lon pairs
 * (docs/decisions/2026-11-20-more-cities.md, fixtures/osm/ATTRIBUTION.txt). */
async function polygonImport(id: string, extract: string, latLon: string, name: string) {
  const values = latLon.trim().split(/\s+/).map(Number);
  const polygon = values.flatMap((lat, i, all): [number, number][] =>
    i % 2 ? [] : [[all[i + 1]!, lat]],
  );
  const result = importOsmCached(readFileSync(`fixtures/osm/${extract}`, 'utf8'), {
    importerVersion: '1',
    polygon,
    terrain: false,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(-5)));
  result.city.name = name;
  return showcaseProject(result.city, id, '2026-11-21T00:00:00.000Z');
}

/** Builds each bundled real place by its id (`?city=<id>`, `src/ui/bundled-projects.ts`). */
export const realPlaceBuilds: Record<string, () => Promise<string>> = {
  freiburg: buildFreiburgProject,
  munich: () => rawImport('munich', 'Munich Donnersbergerbrücke'),
  sindelfingen: () => rawImport('sindelfingen', 'Sindelfingen A81'),
  philadelphia,
  // The Altstadt island and the Hbf: the Trave, the Elbe-Lübeck canal, the rail line.
  luebeck: () =>
    polygonImport(
      'luebeck',
      'luebeck-altstadt.osm',
      `53.876 10.6895 53.8738 10.682 53.8725 10.6775 53.8708 10.673 53.868 10.666 53.865 10.669
       53.864 10.6745 53.8618 10.679 53.856 10.687 53.8612 10.695 53.8655 10.6982 53.871 10.6985
       53.8752 10.695`,
      'Lübeck Altstadt',
    ),
  // Inside the walls and the inner ring, with the station (query version 11, with the walls).
  york: () =>
    polygonImport(
      'york',
      'york-walls-v11.osm',
      `53.9655 -1.0835 53.9634 -1.0872 53.9628 -1.0895 53.9614 -1.0908 53.9604 -1.0945 53.9592
       -1.0975 53.9556 -1.0968 53.9543 -1.0925 53.9522 -1.0885 53.9514 -1.0842 53.952 -1.0808
       53.9521 -1.078 53.9533 -1.0737 53.9555 -1.0718 53.9577 -1.0713 53.9611 -1.0724 53.9633
       -1.0754 53.9647 -1.0775`,
      'York city centre',
    ),
  // TASK-295: the aerodrome between the Royal Albert and King George V Docks, with Hartmann
  // Road, the Connaught Bridge, North Woolwich Road and the DLR (the lead's query-12 polygon).
  'london-city-airport': () =>
    polygonImport(
      'london-city-airport',
      'london-city-airport.osm',
      '51.4995 0.0356 51.4995 0.0724 51.509 0.0724 51.509 0.0356',
      'London City Airport',
    ),
  heathrow: () =>
    polygonImport(
      'heathrow',
      'heathrow.osm',
      '51.454 -0.4948 51.454 -0.4115 51.4804 -0.4115 51.4804 -0.4948',
      'London Heathrow Airport',
    ),
};

/** TASK-284: bundles available by `?city=<id>` while their showcase gates are pending.
 * Boston is byte-pinned to TASK-303's apron-rule archive until that importer rule lands. */
export const heldOutOfPanel: Record<string, string> = {
  'boston-logan': 'Airport throughput gate',
  heathrow: 'Airport throughput gate',
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
