import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openBundled } from '../../../bench/bundled-cities';
import { generatePopulation } from '../../../src/demand/population';
import { glazeCanaryWharf, pitchRoofs, plantTrees, shapeExcel } from './dress';
import { createGeoReference, lonLatToLocal } from '../../../src/geo/projection';
import type { Vec2 } from '../../../src/geo/vec2';
import { importContext } from '../../../src/importers/osm/context';
import { parseOsm } from '../../../src/importers/osm/parse';
import { compileRail } from '../../../src/network/rail';
import { buildTimetable, platformDepartures } from '../../../src/network/trains';
import { saveProjectJson } from '../../../src/project/save';
import type { City, ContextFeature } from '../../../src/schema';
import { parseShot, simAt } from '../../core/shot';

// Capture location (cinematic-captures branch only): the project the London City Airport shot
// renders. The airport with its surroundings out to Canary Wharf as context, the two
// Woolwich-branch services timed to leave King George V together as the shot starts, a busier,
// later morning so the streets carry traffic at 09:03, and set dressing (./dress.ts).
//   npm run capture:build -- london-city-airport [--shot=<file>] [--out=<file>]
// The trains leave at the shot's video time TRAINS_DEPART_T; the shot's sim cue (the A220's
// rotation, ./probe-flights.ts) fixes the clock. Rebuild after changing the shot's timing.
const option = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const shotPath = option('shot') ?? 'capture/locations/london-city-airport/shot.json';
const shot = parseShot(JSON.parse(readFileSync(shotPath, 'utf8')));
const out = option('out') ?? shot.project;
const TRAINS_DEPART_T = 0.6;
const departS = simAt(shot, TRAINS_DEPART_T);
const cache = 'node_modules/.cache/cityflows/capture/london-city-airport/surroundings.osm';
const bbox = '51.490,-0.035,51.522,0.075';

const project = await openBundled('london-city-airport');
const city = project.city;

// Route ids (and so their departure offsets) come from their end nodes' ids: renumber the end
// node of each service until it leaves King George V at `departS`.
const services = [
  { end: 'rn:9922', platform: 'rp:10021' }, // eastbound, Platform 1
  { end: 'rn:9815', platform: 'rp:10031' }, // westbound, Platform 2
];
const leaves = (c: City, platform: string) => {
  const rail = compileRail(c)!;
  return platformDepartures(rail, buildTimetable(rail), platform, departS - 1, 1)[0]!.departureS;
};
const renumber = (c: City, from: string, to: string) => {
  const nodes = c.rail!.nodes;
  nodes[to] = { ...nodes[from]!, id: to };
  delete nodes[from];
  for (const t of Object.values(c.rail!.tracks)) {
    if (t.from === from) t.from = to;
    if (t.to === from) t.to = to;
  }
};
let next = city.nextId;
for (const service of services) {
  let id = service.end;
  for (;;) {
    const candidate = `rn:${next++}`;
    renumber(city, id, candidate);
    id = candidate;
    if (Math.abs(leaves(city, service.platform) - departS) < 0.5) break;
    if (next > city.nextId + 50_000) throw new Error(`No id times ${service.end}`);
  }
  console.info(service.end, '->', id, 'leaves', leaves(city, service.platform).toFixed(1));
}
for (const s of services) {
  const at = leaves(city, s.platform);
  if (Math.abs(at - departS) > 1) throw new Error(`${s.platform} leaves at ${at}, not ${departS}`);
}
city.nextId = next;

// The surroundings out to Canary Wharf, read by the importer's own context rules from an Overpass
// extract (buildings and parts, water, green, rail, trees; no built-up landuse tints). Only what
// lies outside the airport extract is added: inside it the bundled city already has its own.
if (!existsSync(cache)) {
  const tags = [
    '[building][building!=no]',
    '[natural~"^(water|wood|scrub|grassland)$"]',
    '[waterway~"^(riverbank|river|canal|dock)$"]',
    '[landuse~"^(reservoir|basin|grass|meadow|forest|recreation_ground|village_green|allotments|cemetery)$"]',
    '[leisure~"^(park|garden|pitch|marina)$"]',
  ];
  const query =
    '[out:xml][timeout:180];(' +
    tags.map((t) => `way${t}(${bbox});rel${t}[type=multipolygon](${bbox});`).join('') +
    `way["building:part"]["building:part"!=no](${bbox});way[railway~"^(rail|light_rail|subway)$"](${bbox});node[natural=tree](${bbox});` +
    ');(._;>>;);out body;';
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    // Overpass refuses requests without a client name (406).
    headers: { 'User-Agent': 'cityflows-bench/0.1' },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, await response.text());
}
const data = parseOsm(readFileSync(cache, 'utf8'));
if (typeof data === 'string') throw new Error(data);
const geo = createGeoReference(city.geo!.origin);
const local = (lon: number, lat: number) => lonLatToLocal(geo, { lon, lat });
const positions = new Map(data.node.map((node) => [node.id, local(node.lon, node.lat)]));
const [s0, w0, n0, e0] = bbox.split(',').map(Number) as [number, number, number, number];
const [west, south, east, north] = city.geo!.bbox;
const inner = { min: local(west, north), max: local(east, south) };
const inside = (p: Vec2) =>
  p.x > inner.min.x && p.x < inner.max.x && p.y > inner.min.y && p.y < inner.max.y;
const points = (f: ContextFeature) =>
  f.kind === 'point' ? [f.pos] : f.kind === 'line' ? f.line : f.rings.flat();
const surroundings = importContext(data, positions, {
  min: local(w0, n0),
  max: local(e0, s0),
}).filter((f) =>
  // Flat areas may run on under the city's own (the river, the docks); solids and lines may not.
  f.kind === 'area' && f.class !== 'building' ? !points(f).every(inside) : !points(f).some(inside),
);
city.context!.features.push(...surroundings);
console.info('Surrounding features', surroundings.length);

// More residents travel, due at work around 09:00 rather than 08:00 and spread wider: about 100
// vehicles on the move at the liftoff, flowing (more jam the streets by the station). Flights and
// trains keep their own timetables.
const scenario = project.scenarios[0]!;
scenario.demand = {
  ...scenario.demand,
  personsPerResident: 0.18,
  workStart: { meanS: 32400, sdS: 3000 },
};
project.population = generatePopulation(city, scenario.demand);
console.info('Persons', project.population.length);
console.info('Pitched roofs', pitchRoofs(city));
console.info('Trees planted', plantTrees(city));
console.info('Glazed towers', glazeCanaryWharf(city, local));
console.info('ExCeL halls', shapeExcel(city, local));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await saveProjectJson(project, { projectId: 'london-city-airport-intro' }));
console.info(out);
