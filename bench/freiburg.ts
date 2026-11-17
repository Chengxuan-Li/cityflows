import { readFileSync } from 'node:fs';
import type { ImportOptions } from '../src/importers/types';
import type { City } from '../src/schema';
import { importOsmCached } from './city-cache';

// TASK-198: the showcase landing city. Freiburg im Breisgau's Altstadt and Hauptbahnhof, inside
// the rail line, the rings and the Dreisam: the polygon TASK-197 scouted
// (docs/decisions/2026-11-17-landing-city.md) and fetched as fixtures/osm/freiburg-altstadt.osm.

export const freiburgExtract = 'fixtures/osm/freiburg-altstadt.osm';

/** [longitude, latitude], from the decision document's lat lon pairs. */
export const freiburgPolygon: [number, number][] = [
  [7.834, 47.992],
  [7.8368, 47.9962],
  [7.841, 48.001],
  [7.8445, 48.001],
  [7.853, 47.9992],
  [7.8548, 47.9986],
  [7.8578, 47.9968],
  [7.8565, 47.9935],
  [7.856, 47.99],
  [7.85, 47.9895],
  [7.8458, 47.9894],
  [7.842, 47.9908],
  [7.8385, 47.9913],
];

export const freiburgOptions: ImportOptions = {
  importerVersion: '1',
  drivingSide: 'right',
  polygon: freiburgPolygon,
  terrain: false,
};

/** The polygon import of the committed extract, from the import cache when it ran before. */
export function importFreiburg(): City {
  const result = importOsmCached(readFileSync(freiburgExtract, 'utf8'), freiburgOptions);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(-5)));
  return result.city;
}
