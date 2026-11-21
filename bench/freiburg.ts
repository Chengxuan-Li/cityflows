import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { generatePopulation } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { parseOsm, type OsmData } from '../src/importers/osm/parse';
import type { ImportOptions } from '../src/importers/types';
import { openProject } from '../src/project/open';
import { saveProjectJson } from '../src/project/save';
import type { Project } from '../src/project/types';
import type { City } from '../src/schema';
import { importOsmCached } from './city-cache';

// TASK-198: the showcase landing city. Freiburg im Breisgau's Altstadt and Hauptbahnhof, inside
// the rail line, the rings and the Dreisam: the polygon TASK-197 scouted
// (docs/decisions/2026-11-17-landing-city.md), fetched as fixtures/osm/freiburg-altstadt.osm
// (TASK-201: again on 2026-11-18, with building parts).
// Rebuild the bundled project on purpose with `bench/bundled-cities.ts` (every real place), or
// alone with
//   node --experimental-strip-types --import ./bench/register.ts bench/freiburg.ts

export const freiburgExtract = 'fixtures/osm/freiburg-altstadt.osm';
export const freiburgProject = 'fixtures/projects/freiburg.cityflows.json';
/** TASK-201: the Schlossberg's foot and the Dreisam's fall, from AWS Terrain Tiles
 * (`bench/terrain-fetch.ts freiburg`). Not loaded into the project: the owner kept Freiburg flat
 * for now (2026-11-18), as its 3D scene took 15 s to build on terrain against a 5 s budget. */
export const freiburgTerrain = 'fixtures/terrain/freiburg.json';

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

/** Removes roads, their turn rules and the nodes only they used. */
function removeRoads(city: City, ids: string[]) {
  for (const id of ids) {
    const { from, to } = city.roads[id]!;
    delete city.roads[id];
    for (const node of Object.values(city.nodes)) {
      node.turnRules = node.turnRules.filter((rule) => rule.from !== id && rule.to !== id);
      node.minorRoads = node.minorRoads.filter((road) => road !== id);
    }
    for (const end of [from, to])
      if (Object.values(city.roads).every((r) => r.from !== end && r.to !== end))
        delete city.nodes[end];
  }
}

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

  // TASK-201: the Münster, St. Martin, the gates and the Kaufhaus stand in 3D on their
  // `building:part` areas (the Münster's openwork spire is its 37 to 116 m part), so TASK-198's
  // capped bodies and added tower are gone.

  // Siegesdenkmal: Habsburgerstraße and the Friedrichring/Leopoldring cross as two dual
  // carriageways, a box of four signalised nodes joined by 10 m inner roads that the group's
  // program keeps green. A U-turn round the box (westbound back east, eastbound back west) left
  // turners queued inside it from both sides and locked it from 07:40 (41 trips gridlocked, a
  // 7,904 s visit): the U-turns are banned there.
  for (const [node, from, to] of [
    [334224228, 651622058, 660517976], // n:862: Friedrichring westbound, then south round the box
    [5276630819, 651622057, 651622058], // n:1660: northbound inner road, then west round the box
  ] as const) {
    const at = osmNode(city, node);
    at.turnRules.push({
      from: osmRoad(city, from, at.id, 'to').id,
      to: osmRoad(city, to, at.id, 'from').id,
      allowed: false,
      provenance: curated,
    });
  }
  // The polygon's east tip cuts the ring road where it bends outside for 150 m, so Leopoldring
  // and Schlossbergring are gateways with a primary road's demand each, although most of the
  // ring's traffic passes them by (the demand has no through trips, and the joining way is
  // outside the extract). Their demand is cut to 30%: at full demand Schlossbergring's entry
  // queued for 1,491 s in one lane into the Schwabentor junction.
  for (const way of [243604098, 1259488934]) {
    const gateway = Object.values(city.places).find(
      (p) => p.kind === 'gateway' && p.provenance.osmIds?.includes(way),
    )!;
    gateway.population = Math.round(gateway.population * 0.3);
    gateway.jobs = Math.round(gateway.jobs * 0.3);
  }

  // TASK-207: three lots whose only access the polygon cut prunes (a bbox import reaches the two
  // by the west edge from Haslacher Straße, way 51729602, and Farben-Thon's from the service way
  // 1198950930): no car reaches them, and each showed as stalls without a path and a facility
  // without an exit. Their areas stay on the map among the surroundings.
  for (const osmId of [3078479, 124266993, 526598839]) {
    const lot = Object.values(city.parking ?? {}).find(
      (p) => p.kind === 'lot' && p.provenance.osmIds?.[0] === osmId,
    );
    if (!lot || lot.connectors.length) throw new Error(`Freiburg curation: lot ${osmId} moved`);
    removeRoads(city, lot.aisles ?? []);
    delete city.parking![lot.id];
  }
  // TASK-207: Schwabentorplatz's bus road and the Schlossbergring's service road go on only into
  // the pedestrian Schwabentor (ways 41455468 and 242280648: trams, buses and bicycles), which
  // the import does not drive, so each was a one-way dead end that a car could enter.
  removeRoads(
    city,
    [30642127, 53799667].map((way) => {
      const roads = Object.values(city.roads).filter((r) => r.provenance.osmIds?.includes(way));
      if (roads.length !== 1) throw new Error(`Freiburg curation: way ${way} moved`);
      return roads[0]!.id;
    }),
  );
  // TASK-207: the ZOB's two-way stretch (way 238477557) ends against the one-way bus road
  // through the station (30655298); its backward lane, a taxi rank, turns round there.
  const zob = osmNode(city, 2463105124);
  zob.turnRules.push({
    from: osmRoad(city, 238477557, zob.id, 'to').id,
    to: osmRoad(city, 238477557, zob.id, 'from').id,
    allowed: true,
    provenance: curated,
  });
}

/** A bundled real place as the app opens it: the city, the showcase demand (0.15 persons per
 * resident, mode choice on) and its population, paused at 07:00, saved with a fixed date so a
 * rebuild of the same city is byte-identical. */
export async function showcaseProject(
  city: City,
  id: string,
  savedAt: string,
  view?: Project['view'],
): Promise<string> {
  const scenario = defaultScenario('grid5x5');
  scenario.id = id;
  scenario.name = city.name;
  scenario.demand.personsPerResident = 0.15;
  // The population ships with the project: generating it took 1.3 s of the landing load.
  const population = generatePopulation(city, scenario.demand);
  const project: Project = { city, population, scenarios: [scenario], ...(view && { view }) };
  return saveProjectJson(project, { projectId: id, savedAt });
}

/** The bundled project: the curated city with the showcase 3D camera. */
export async function buildFreiburgProject(): Promise<string> {
  const xml = readFileSync(freiburgExtract, 'utf8');
  const data = parseOsm(xml);
  if (typeof data === 'string') throw new Error(data);
  const city = importFreiburg();
  curateFreiburg(city, data);
  // The showcase 3D camera: from over the Dreisam towards the Münster and the Schlossberg.
  const view = {
    camera: { '3d': { centre: { x: -300, y: 220 }, scale: 1.18, pitch: 50, bearing: -60 } },
    layers: null,
    selection: null,
  };
  return showcaseProject(city, 'freiburg', '2026-11-17T00:00:00.000Z', view);
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
