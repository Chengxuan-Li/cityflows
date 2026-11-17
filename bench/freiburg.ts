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

/** A road by its OSM way, entering (or leaving) the node mapped from an OSM node. */
function osmRoad(city: City, way: number, node: string, end: 'to' | 'from') {
  const road = Object.values(city.roads).find(
    (r) => r.provenance.osmIds?.includes(way) && r[end] === node,
  );
  if (!road) throw new Error(`Freiburg curation: no road of way ${way} ${end} ${node}`);
  return road;
}

function osmNode(city: City, osmId: number) {
  const node = Object.values(city.nodes).find((n) => n.provenance.osmIds?.[0] === osmId);
  if (!node) throw new Error(`Freiburg curation: no node for OSM node ${osmId}`);
  return node;
}

const curated = { source: 'authored' as const };

/** TASK-198: the edits that make the polygon import the showcase, each keyed to OSM ids so it
 * fails loudly if a rebuilt import moves. */
export function curateFreiburg(city: City): void {
  // Stefan-Meier-Straße widens from one lane to five in the last 40 m before the Bismarckallee
  // junctions, over OSM ways too short to change lanes on: the single lane feeds them all.
  const widening = osmNode(city, 2229682285);
  const narrow = osmRoad(city, 44111632, widening.id, 'to');
  const wide = osmRoad(city, 233466343, widening.id, 'from');
  for (const toLane of wide.lanes.keys())
    widening.turnRules.push({
      from: narrow.id,
      to: wide.id,
      fromLane: 0,
      toLane,
      allowed: true,
      provenance: curated,
    });
  // The B 31a's right lane keeps right at a way boundary into the link to Lessingstraße; the
  // import read its slight_right arrow as a move to the middle lane, leaving the link unfed.
  const boundary = osmNode(city, 2427358469);
  const before = osmRoad(city, 309990768, boundary.id, 'to');
  boundary.turnRules = boundary.turnRules.filter((rule) => rule.from !== before.id);
}
