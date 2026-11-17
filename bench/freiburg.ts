import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { lonLatToLocal } from '../src/geo/projection';
import type { Vec2 } from '../src/geo/vec2';
import { generatePopulation } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { parseOsm, type OsmData } from '../src/importers/osm/parse';
import { polygonCenter } from '../src/importers/osm/places';
import type { ImportOptions } from '../src/importers/types';
import { openProject } from '../src/project/open';
import { saveProjectJson } from '../src/project/save';
import type { Project } from '../src/project/types';
import type { City, ContextFeature } from '../src/schema';
import { importOsmCached } from './city-cache';

// TASK-198: the showcase landing city. Freiburg im Breisgau's Altstadt and Hauptbahnhof, inside
// the rail line, the rings and the Dreisam: the polygon TASK-197 scouted
// (docs/decisions/2026-11-17-landing-city.md) and fetched as fixtures/osm/freiburg-altstadt.osm.
// Rebuild the bundled project on purpose with
//   node --experimental-strip-types --import ./bench/register.ts bench/freiburg.ts

export const freiburgExtract = 'fixtures/osm/freiburg-altstadt.osm';
export const freiburgProject = 'fixtures/projects/freiburg.cityflows.json';

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

type Building = Extract<ContextFeature, { kind: 'area' }>;

/** The building feature drawn from an OSM way (context features keep no OSM ids). */
function osmBuilding(city: City, data: OsmData, wayId: number): Building {
  const nodes = new Map(data.node.map((n) => [n.id, n]));
  const way = data.way.find((w) => w.id === wayId)!;
  const centre = polygonCenter(
    way.nd.slice(0, -1).map((id) => lonLatToLocal(city.geo!, nodes.get(id)!)),
  )!;
  const building = city.context!.features.find(
    (f): f is Building =>
      f.kind === 'area' &&
      f.class === 'building' &&
      Math.hypot(
        polygonCenter(f.rings[0]!)!.x - centre.x,
        polygonCenter(f.rings[0]!)!.y - centre.y,
      ) < 1,
  );
  if (!building) throw new Error(`Freiburg curation: no building for OSM way ${wayId}`);
  return building;
}

const curated = { source: 'authored' as const };

/** TASK-198: the edits that make the polygon import the showcase, each keyed to OSM ids so it
 * fails loudly if a rebuilt import moves. */
export function curateFreiburg(city: City, data: OsmData): void {
  city.name = 'Freiburg im Breisgau';
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

  // Building passages and covered streets (the Bismarckallee under the Hauptbahnhof's
  // concourse, Schwabentorplatz, Raustraße) run at grade under a roof, as rail already reads
  // them; the importer puts them a level down. Their nodes and walk links come up with them.
  const atGrade = new Set(
    data.way
      .filter(
        ({ tag }) =>
          tag.layer === undefined &&
          (tag.tunnel === 'building_passage' || (tag.covered === 'yes' && !tag.tunnel)),
      )
      .map(({ id }) => id),
  );
  const raised = new Set<string>();
  for (const road of Object.values(city.roads))
    if ((road.layer ?? 0) < 0 && road.provenance.osmIds?.some((id) => atGrade.has(id))) {
      road.layer = 0;
      raised.add(road.from).add(road.to);
    }
  for (const id of raised)
    if (Object.values(city.roads).every((r) => (r.from !== id && r.to !== id) || !r.layer))
      city.nodes[id]!.layer = 0;
  const walk = city.walk!;
  const walkNodes = new Set<string>();
  for (const link of Object.values(walk.links))
    if ((link.layer ?? 0) < 0 && link.provenance.osmIds?.some((id) => atGrade.has(id))) {
      link.layer = 0;
      walkNodes.add(link.from).add(link.to);
    }
  for (const id of walkNodes)
    if (Object.values(walk.links).every((l) => (l.from !== id && l.to !== id) || !l.layer))
      walk.nodes[id]!.layer = 0;

  // The Münster's height tag is its spire's (116 m): the nave and choir stand at 30 m under a
  // gabled roof, and the west tower rises on its square base to the openwork spire.
  const minster = osmBuilding(city, data, 110404213);
  minster.heightM = 30;
  minster.roof = { shape: 'gabled', heightM: 12 };
  const tower: Vec2[] = (
    [
      [7.8521141, 47.9955958],
      [7.8523018, 47.9956009],
      [7.8523094, 47.9954752],
      [7.8521216, 47.9954702],
    ] as const
  ).map(([lon, lat]) => {
    const p = lonLatToLocal(city.geo!, { lon, lat });
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  });
  city.context!.features.push({
    kind: 'area',
    class: 'building',
    sub: 'tower',
    rings: [[...tower, tower[0]!]],
    heightM: 116,
    roof: { shape: 'pyramidal', heightM: 46 },
  });
  // St. Martin's 34 m is its ridge turret's: the church body stands at 22 m.
  const martin = osmBuilding(city, data, 106951792);
  martin.heightM = 22;
  martin.roof = { ...martin.roof, shape: 'gabled', heightM: 9 };
}

/** The bundled project, as the app opens it: the curated city, the showcase demand (0.15
 * persons per resident, mode choice on) and its population, paused at 07:00. */
export async function buildFreiburgProject(): Promise<string> {
  const xml = readFileSync(freiburgExtract, 'utf8');
  const data = parseOsm(xml);
  if (typeof data === 'string') throw new Error(data);
  const city = importFreiburg();
  curateFreiburg(city, data);
  const scenario = defaultScenario('grid5x5');
  scenario.id = 'freiburg';
  scenario.name = city.name;
  scenario.demand.personsPerResident = 0.15;
  // The population ships with the project: generating it took 1.3 s of the landing load.
  const population = generatePopulation(city, scenario.demand);
  // The showcase 3D camera: from over the Dreisam towards the Münster and the Schlossberg.
  const view = {
    camera: { '3d': { centre: { x: 400, y: -40 }, scale: 1.6, pitch: 50, bearing: -60 } },
    layers: null,
    selection: null,
  };
  const project: Project = { city, population, scenarios: [scenario], view };
  return saveProjectJson(project, { projectId: 'freiburg', savedAt: '2026-11-17T00:00:00.000Z' });
}

/** The committed bundled project, opened as the app opens it. */
export async function openFreiburg(): Promise<Project> {
  const result = await openProject(readFileSync(freiburgProject, 'utf8'));
  if (!result.ok) throw new Error(`${result.file}: ${result.error}`);
  return result.project;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('bench/freiburg.ts')) {
  const json = await buildFreiburgProject();
  writeFileSync(freiburgProject, json);
  console.info(`${freiburgProject}: ${(json.length / 1e6).toFixed(2)} MB`);
}
