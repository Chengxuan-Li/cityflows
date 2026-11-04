import { readFileSync } from 'node:fs';
import process from 'node:process';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { importOsm } from '../src/importers/osm';
import { compile } from '../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../src/routing';
import { createEngine } from '../src/sim/engine';

// Import an OSM fixture, compile it, and run its morning headless: the baseline the import
// wave measures against. Usage: npm run import-probe -- fixtures/osm/<name>.osm w s e n
const [file, ...bounds] = process.argv.slice(2);
if (!file || bounds.length !== 4) throw new Error('Usage: import-probe <file.osm> w s e n');
const bbox = bounds.map(Number) as [number, number, number, number];
const xml = readFileSync(file, 'utf8');
const imported = importOsm(xml, { importerVersion: '1', drivingSide: 'right', bbox });
const byCode = new Map<string, number>();
for (const { code } of imported.diagnostics) byCode.set(code, (byCode.get(code) ?? 0) + 1);
console.table([...byCode].map(([code, count]) => ({ code, count })));
if (!imported.ok) throw new Error('import failed');
const { city } = imported;
const roads = Object.values(city.roads);
const places = Object.values(city.places);
const byClass = new Map<string, number>();
for (const road of roads) byClass.set(road.roadClass, (byClass.get(road.roadClass) ?? 0) + 1);
console.table([...byClass].map(([roadClass, count]) => ({ roadClass, count })));
console.info({
  nodes: Object.keys(city.nodes).length,
  roads: roads.length,
  signals: Object.values(city.nodes).filter((n) => n.control === 'signal').length,
  places: places.length,
  byKind: Object.fromEntries(
    [...new Set(places.map((p) => p.kind))].map((kind) => [
      kind,
      places.filter((p) => p.kind === kind).length,
    ]),
  ),
  population: places.reduce((sum, p) => sum + p.population, 0),
  jobs: places.reduce((sum, p) => sum + p.jobs, 0),
});
const result = compile(city);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
const { compiled } = result;
const compiledCodes = new Map<string, number>();
for (const { code } of result.diagnostics)
  compiledCodes.set(code, (compiledCodes.get(code) ?? 0) + 1);
console.table([...compiledCodes].map(([code, count]) => ({ code, count })));
const provider = createRouteProvider();
const costs = freeFlowLinkCosts(compiled);
const outs = compiled.connectors.filter((c) => c.direction !== 'in');
const ins = compiled.connectors.filter((c) => c.direction !== 'out');
let ok = 0;
let total = 0;
for (const origin of outs)
  for (const destination of ins) {
    if (origin.place === destination.place) continue;
    total++;
    const route = provider.route(compiled, costs, {
      fromLane: origin.lane,
      fromPosM: origin.positionM,
      toConnector: destination.idx,
      vehicleClass: 'car',
      desiredSpeedFactor: 1,
      noise: 0,
      seed: 1,
    });
    if (route.ok) ok++;
  }
console.info({ connectorPairs: total, routable: ok });
const scenario = defaultScenario('grid5x5');
scenario.startS = 7 * 3600;
scenario.endS = 10 * 3600;
const population = generatePopulation(city, scenario.demand);
const trips = scheduleTrips(city, population, scenario);
const engine = createEngine();
engine.load({ compiled, trips, scenario });
let peak = 0;
for (let step = 0; step < 3 * 36000; step += 600) {
  engine.step(600);
  peak = Math.max(peak, engine.metrics().trips.driving);
}
const metrics = engine.metrics();
console.info({
  persons: population.length,
  trips: trips.length,
  peakDriving: peak,
  ...metrics.trips,
  failedByReason: metrics.failedByReason,
});
