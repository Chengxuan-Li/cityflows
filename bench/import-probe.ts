import { readFileSync } from 'node:fs';
import process from 'node:process';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { importOsmCached } from './city-cache';
import { compile, type CompiledCity } from '../src/network';
import type { City } from '../src/schema';
import { createRouteProvider, freeFlowLinkCosts, type RouteProvider } from '../src/routing';
import { createEngine } from '../src/sim/engine';
import type { TrafficEngine } from '../src/sim/types';

// Import an OSM fixture, compile it, and run its morning headless: the baseline the import
// wave measures against. Usage: npm run import-probe -- fixtures/osm/<name>.osm w s e n [--scale n]
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/import-probe.ts')) {
  const [file, ...args] = process.argv.slice(2);
  if (!file || (args.length !== 4 && !(args.length === 6 && args[4] === '--scale')))
    throw new Error('Usage: import-probe <file.osm> w s e n [--scale n]');
  const scaleArg = args[5] ?? '1';
  const scale = Number(scaleArg);
  if (!scaleArg.trim() || !Number.isFinite(scale) || scale < 0)
    throw new Error('--scale must be a finite, nonnegative number');
  const bbox = args.slice(0, 4).map(Number) as [number, number, number, number];
  const xml = readFileSync(file, 'utf8');
  const imported = importOsmCached(xml, { importerVersion: '1', drivingSide: 'right', bbox });
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
  console.info(probeMorning(city, compiled, scale));
}

/** `untilS` stops the run early (the same demand, a prefix of the morning: `traffic:quick`);
 * `observe` sees the engine after every step (the traffic tier's observers, TASK-090). */
export function probeMorning(
  city: City,
  compiled: CompiledCity,
  scale = 1,
  {
    untilS = 10 * 3600,
    observe,
    routeProvider,
  }: {
    untilS?: number;
    observe?: (engine: TrafficEngine) => void;
    routeProvider?: RouteProvider;
  } = {},
) {
  const scenario = defaultScenario('grid5x5');
  scenario.demand.personsPerResident = scale;
  scenario.startS = 7 * 3600;
  scenario.endS = 10 * 3600;
  const population = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, population, scenario);
  const engine = createEngine();
  engine.load({ compiled, trips, scenario, ...(routeProvider && { routeProvider }) });
  let peak = 0;
  const completedByHalfHour: number[] = [];
  let completedBefore = 0;
  // Where each vehicle was at a sample and since when, to find heads that stand still.
  const still = new Map<number, { lane: number; x: number; y: number; sinceS: number }>();
  const initialRoad = new Map<number, number>();
  const lastRoad = new Map<number, number>();
  const sampledRoadTraffic: Record<string, { entered: number; left: number }> = {};
  const recordRoad = (road: number, direction: 'entered' | 'left') => {
    const cls = compiled.roads[road]!.roadClass;
    (sampledRoadTraffic[cls] ??= { entered: 0, left: 0 })[direction]++;
  };
  for (let step = 0; step < (untilS - scenario.startS) * 10; step += 600) {
    for (let i = 0; i < 600; i++) {
      engine.step();
      observe?.(engine);
    }
    const { trips: counts } = engine.metrics();
    peak = Math.max(peak, counts.driving);
    if ((step + 600) % 18000 === 0) {
      completedByHalfHour.push(counts.completed - completedBefore);
      completedBefore = counts.completed;
    }
    const snapshot = engine.snapshot();
    for (const [index, id] of snapshot.id.entries()) {
      const [lane, x, y] = [snapshot.lane[index]!, snapshot.x[index]!, snapshot.y[index]!];
      const last = still.get(id);
      if (!last || last.lane !== lane || last.x !== x || last.y !== y)
        still.set(id, { lane, x, y, sinceS: snapshot.timeS });
    }
    for (const [index, id] of snapshot.id.entries()) {
      if (!initialRoad.has(id)) {
        const road = engine.inspect(id)?.route?.roads[0];
        if (road !== undefined) initialRoad.set(id, road);
      }
      const lane = snapshot.lane[index]!;
      if (lane < 0) continue;
      const road = compiled.lanes[lane]!.road;
      const previous = lastRoad.get(id);
      if (road !== previous) {
        if (previous !== undefined) recordRoad(previous, 'left');
        recordRoad(road, 'entered');
        lastRoad.set(id, road);
      }
    }
  }
  const metrics = engine.metrics();
  // Driving vehicles on a movement or first on their lane that have not moved for 300 s.
  const end = engine.snapshot();
  const front = new Map<number, number>();
  for (const [index, id] of end.id.entries()) {
    const lane = end.lane[index]!;
    if (lane < 0) continue;
    const ahead = front.get(lane);
    if (ahead === undefined || engine.inspect(id)!.positionM > engine.inspect(ahead)!.positionM)
      front.set(lane, id);
  }
  let stalledHeads = 0;
  for (const [index, id] of end.id.entries()) {
    const lane = end.lane[index]!;
    if (end.state[index] !== 1 || (lane >= 0 && front.get(lane) !== id)) continue;
    if (end.timeS - still.get(id)!.sinceS >= 300) stalledHeads++;
  }
  const gatewayTraffic: Record<string, { entered: number; left: number }> = {};
  const failures = new Map<string, number>();
  for (const [i, trip] of trips.entries()) {
    const detail = engine.inspect(i + 1);
    if (!detail) continue;
    if (detail.failReason) {
      const lane = compiled.lanes[detail.lane];
      const key = `${detail.failReason}:${lane?.id ?? 'unspawned'}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
    }
    const first = initialRoad.get(i + 1) ?? detail.route?.roads[0];
    if (
      detail.departedS !== null &&
      first !== undefined &&
      city.places[trip.originPlaceId]!.kind === 'gateway'
    ) {
      const cls = compiled.roads[first]!.roadClass;
      (gatewayTraffic[cls] ??= { entered: 0, left: 0 }).entered++;
    }
    if (detail.state === 'completed' && city.places[trip.destinationPlaceId]!.kind === 'gateway') {
      const cls = compiled.roads[compiled.lanes[detail.lane]!.road]!.roadClass;
      (gatewayTraffic[cls] ??= { entered: 0, left: 0 }).left++;
    }
  }
  const releasedTrips = trips.length - metrics.trips.pending;
  return {
    scale,
    persons: population.length,
    trips: trips.length,
    releasedTrips,
    completedShareOfReleased: releasedTrips ? metrics.trips.completed / releasedTrips : 0,
    failedShareOfReleased: releasedTrips ? metrics.trips.failed / releasedTrips : 0,
    peakDriving: peak,
    completedByHalfHour,
    stalledHeads,
    zoneStops: metrics.zoneStops,
    respawns: metrics.respawns,
    ...metrics.trips,
    failedByReason: metrics.failedByReason,
    parking: metrics.parking,
    localArrivals: trips.filter(
      (trip, id) =>
        city.places[trip.destinationPlaceId]!.kind !== 'gateway' &&
        (engine.inspect(id + 1)?.state === 'completed' ||
          engine.inspect(id + 1)?.failReason === 'no_parking'),
    ).length,
    gatewayTraffic,
    sampledRoadTraffic,
    failures: Object.fromEntries(failures),
  };
}
