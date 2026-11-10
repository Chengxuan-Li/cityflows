import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { importOsmCached } from './city-cache';
import { compile, type CompiledCity } from '../src/network';
import type { City } from '../src/schema';
import { createRouteProvider, freeFlowLinkCosts, type RouteProvider } from '../src/routing';
import { createWalkRouter, type WalkRequest, type WalkRoute } from '../src/routing/walk';
import { distance, pointAtDistance } from '../src/geo/polyline';
import { createEngine } from '../src/sim/engine';
import type { TrafficEngine } from '../src/sim/types';
import { walkComponents } from '../src/network/walk-joins';
import { parkingEgress } from '../src/network/parking-egress';

/** Car departure census, independent of the pedestrian counters. Gateways and strips are reported separately. */
export function carExitCensus(compiled: CompiledCity) {
  const exits = parkingEgress(compiled, 30);
  const facilities = compiled.parking.filter((f) => !exits.facilities[f.idx]);
  const places = compiled.places.filter(
    (p) => p.connectorsOut.length && !p.connectorsOut.some((i) => exits.connectors[i]),
  );
  return {
    facilities: facilities.length,
    spaces: facilities.reduce((n, f) => n + f.capacity, 0),
    garagesAndLots: facilities
      .filter((f) => f.kind !== 'roadside')
      .map((f) => ({ id: f.id, spaces: f.capacity })),
    strips: facilities
      .filter((f) => f.kind === 'roadside')
      .map((f) => ({ id: f.id, spaces: f.capacity })),
    places: places.filter((p) => p.kind !== 'gateway').map((p) => p.id),
    gateways: places.filter((p) => p.kind === 'gateway').map((p) => p.id),
  };
}
import { railCensus } from '../src/network/rail';

// Import an OSM fixture, compile it, and run its morning headless: the baseline the import
// wave measures against. Usage: npm run import-probe -- fixtures/osm/<name>.osm w s e n [--scale n]
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/import-probe.ts')) {
  const [file, ...args] = process.argv.slice(2);
  if (!file || args.length < 4 || (args.length - 4) % 2)
    throw new Error(
      'Usage: import-probe <file.osm> w s e n [--scale n] [--walk-legs file.json] [--parking-report file.json]',
    );
  let scaleArg = '1',
    walkLegsFile: string | undefined,
    parkingReportFile: string | undefined;
  for (let i = 4; i < args.length; i += 2) {
    if (args[i] === '--scale') scaleArg = args[i + 1]!;
    else if (args[i] === '--walk-legs') walkLegsFile = args[i + 1]!;
    else if (args[i] === '--parking-report') parkingReportFile = args[i + 1]!;
    else throw new Error(`Unknown option: ${args[i]}`);
  }
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
  console.info('Walk connectivity', probeWalk(city, compiled));
  console.info('Car exits', carExitCensus(compiled));
  if (compiled.rail) console.info('Rail census', railCensus(city, compiled.rail));
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
  const { walkLegs, ...morning } = probeMorning(city, compiled, scale, {
    includeWalkLegs: !!walkLegsFile,
  });
  if (walkLegsFile) writeFileSync(walkLegsFile, JSON.stringify(walkLegs, null, 2));
  if (parkingReportFile)
    writeFileSync(
      parkingReportFile,
      JSON.stringify(
        {
          completed: morning.completed,
          gridlocked: morning.failedByReason.gridlocked,
          noParking: morning.failedByReason.no_parking,
          stalledHeads: morning.stalledHeads,
          totalSearchS: morning.parkingSearchTimeS,
          ...morning.parking,
        },
        null,
        2,
      ),
    );
  console.info(morning);
}

/** Compare the actual routed endpoints, including direction and partial first/last links. */
export function walkDetour(graph: CompiledCity['walk'], route: WalkRoute) {
  const point = (leg: WalkRoute['legs'][number], at: number) => {
    const link = graph.links[leg.link]!;
    return pointAtDistance(link.line, link.cumulative, at);
  };
  const first = route.legs[0],
    last = route.legs.at(-1);
  const from = first ? point(first, first.fromM) : null;
  const to = last ? point(last, last.toM) : null;
  const straightM = from && to ? distance(from, to) : 0;
  return {
    from,
    to,
    straightM,
    detour:
      straightM > 0 ? route.lengthM / straightM : route.lengthM === 0 ? 1 : ('unbounded' as const),
  };
}

export function matchWalkRoute<T extends { legs: WalkRoute['legs'] }>(
  candidates: T[],
  walker: { state: string; link: number | null; positionM: number },
): T {
  const matches = candidates.filter(({ legs }) => {
    if (!legs.length) return walker.state === 'done' && walker.link === -1;
    if (walker.state === 'done') {
      const last = legs.at(-1);
      return last?.link === walker.link && Math.abs(last.toM - walker.positionM) < 1e-6;
    }
    return legs.some(
      (leg) =>
        leg.link === walker.link &&
        walker.positionM >= Math.min(leg.fromM, leg.toM) - 1e-6 &&
        walker.positionM <= Math.max(leg.fromM, leg.toM) + 1e-6,
    );
  });
  if (matches.length !== 1) throw new Error(`Measured walk has ${matches.length} matching paths`);
  return matches[0]!;
}

/** Count actual walk anchors separately from entities with no viable attachment. */
export function probeWalk(city: City, compiled: CompiledCity) {
  const graph = compiled.walk,
    { labels, sizes, core } = walkComponents(graph);
  const outside = (anchors: Map<string, number[]>) =>
    [...anchors].filter(([, nodes]) => !nodes.some((i) => labels[i] === core)).map(([id]) => id);
  const kinds: Record<string, number> = {},
    rules: Record<string, number> = {};
  for (const l of graph.links) {
    kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
    if (!l.generated) continue;
    const rule =
      l.kind === 'sidewalk' &&
      city.roads[compiled.roads[l.road!]!.id]!.sidewalk?.[l.side!] === 'separate'
        ? 'separateFallback'
        : l.id.split(':')[0]!;
    rules[rule] = (rules[rule] ?? 0) + 1;
  }
  return {
    nodes: graph.nodes.length,
    links: graph.links.length,
    components: sizes.length,
    largest: sizes[core] ?? 0,
    kinds,
    generatedByRule: rules,
    places: {
      anchors: graph.places.size,
      outside: outside(graph.places),
      unattached: Object.keys(city.places).filter((id) => !graph.places.has(id)),
    },
    parking: {
      anchors: graph.parking.size,
      outside: outside(graph.parking),
      unattached: Object.keys(city.parking ?? {}).filter((id) => !graph.parking.has(id)),
    },
    connectors: {
      anchors: graph.connectors.size,
      outside: [...graph.connectors].filter(([, i]) => labels[i] !== core).map(([id]) => id),
    },
  };
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
    includeWalkLegs = false,
  }: {
    untilS?: number;
    observe?: (engine: TrafficEngine) => void;
    routeProvider?: RouteProvider;
    includeWalkLegs?: boolean;
  } = {},
) {
  const scenario = defaultScenario('grid5x5');
  scenario.demand.personsPerResident = scale;
  scenario.startS = 7 * 3600;
  scenario.endS = 10 * 3600;
  const population = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, population, scenario);
  const engine = createEngine();
  const provider = routeProvider ?? createRouteProvider();
  const walkRouter = createWalkRouter(compiled.walk);
  let routeRequests = 0;
  let routeTimeMs = 0;
  const detoured = new Set<number>();
  const headDetourRoads: Record<string, number> = {};
  let headDetours = 0;
  let walkRouteRequests = 0;
  let walkRouteTimeMs = 0;
  const routeKey = (route: { links: number[]; lengthM: number }, from = '', to = '') =>
    `${from}>${to}:${route.links.join(',')}:${route.lengthM}`;
  const walkRoutes = new Map<
    string,
    (ReturnType<typeof walkDetour> & {
      request: WalkRequest;
      legs: WalkRoute['legs'];
    })[]
  >();
  engine.load({
    compiled,
    trips,
    scenario,
    headDetourObserver(id, lane) {
      headDetours++;
      detoured.add(id);
      const road = compiled.roads[compiled.lanes[lane]!.road]!.id;
      headDetourRoads[road] = (headDetourRoads[road] ?? 0) + 1;
    },
    population,
    walkRouter: {
      route(request) {
        const start = performance.now();
        const result = walkRouter.route(request);
        walkRouteTimeMs += performance.now() - start;
        walkRouteRequests++;
        if (includeWalkLegs && result.ok) {
          const key = routeKey(
            result.route,
            'placeId' in request.from ? request.from.placeId : '',
            'placeId' in request.to ? request.to.placeId : '',
          );
          const candidates = walkRoutes.get(key) ?? [];
          if (
            !candidates.some((c) =>
              c.legs.every(
                (leg, i) =>
                  leg.fromM === result.route.legs[i]!.fromM &&
                  leg.toM === result.route.legs[i]!.toM,
              ),
            )
          )
            candidates.push({
              ...walkDetour(compiled.walk, result.route),
              request: { from: { ...request.from }, to: { ...request.to } },
              legs: result.route.legs.map((leg) => ({ ...leg })),
            });
          walkRoutes.set(key, candidates);
        }
        return result;
      },
    },
    routeProvider: {
      route(network, costs, request) {
        const start = performance.now();
        const result = provider.route(network, costs, request);
        routeTimeMs += performance.now() - start;
        routeRequests++;
        return result;
      },
    },
  });
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
  const stalledHeadDetails: { tripId: string; road: string; lane: number }[] = [];
  for (const [index, id] of end.id.entries()) {
    const lane = end.lane[index]!;
    if (end.state[index] !== 1 || (lane >= 0 && front.get(lane) !== id)) continue;
    if (end.timeS - still.get(id)!.sinceS >= 300) {
      stalledHeads++;
      const from = lane >= 0 ? lane : compiled.movements[-lane - 1]!.fromLane;
      stalledHeadDetails.push({
        tripId: engine.inspect(id)!.tripId,
        road: compiled.roads[compiled.lanes[from]!.road]!.id,
        lane,
      });
    }
  }
  const gatewayTraffic: Record<string, { entered: number; left: number }> = {};
  const failures = new Map<string, number>();
  const gridlockedRoads: Record<string, number> = {};
  for (const [i, trip] of trips.entries()) {
    const detail = engine.inspect(i + 1);
    if (!detail) continue;
    if (detail.failReason) {
      const lane = compiled.lanes[detail.lane];
      const key = `${detail.failReason}:${lane?.id ?? 'unspawned'}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
      if (detail.failReason === 'gridlocked') {
        const from = lane ?? compiled.lanes[compiled.movements[-detail.lane - 1]!.fromLane]!;
        const road = compiled.roads[from.road]!.id;
        gridlockedRoads[road] = (gridlockedRoads[road] ?? 0) + 1;
      }
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
  const parkingNodes = new Map<number, Set<string>>();
  const parkingAt = (node: number, id: string) => {
    const list = parkingNodes.get(node) ?? new Set<string>();
    list.add(id);
    parkingNodes.set(node, list);
  };
  if (includeWalkLegs) {
    for (const [id, nodes] of compiled.walk.parking) for (const n of nodes) parkingAt(n, id);
    for (const c of compiled.connectors) {
      const node = compiled.walk.connectors.get(c.id);
      if (node !== undefined && c.parking !== undefined)
        parkingAt(node, compiled.parking[c.parking]!.id);
    }
  }
  const walkLegs = includeWalkLegs
    ? population.flatMap(({ id }) => {
        const person = engine.inspectPerson(id);
        return (
          person?.trips.flatMap((trip) =>
            trip.legs
              .filter((leg) => leg.kind !== 'drive' && leg.startedS !== null)
              .map((leg) => {
                const walker = leg.walkerId === null ? null : engine.inspectWalker(leg.walkerId);
                const info = walker?.route
                  ? matchWalkRoute(
                      walkRoutes.get(
                        routeKey(
                          walker.route,
                          leg.kind === 'egress' ? '' : trip.originPlaceId,
                          leg.kind === 'access' ? '' : trip.destinationPlaceId,
                        ),
                      ) ?? [],
                      walker,
                    )
                  : undefined;
                if (walker?.route && !info)
                  throw new Error(`Missing measured walk route: ${walker.id}`);
                const position = info?.legs.length
                  ? leg.kind === 'access'
                    ? info.request.to
                    : info.request.from
                  : undefined;
                return {
                  personId: id,
                  tripId: trip.tripId,
                  kind: leg.kind,
                  state: leg.state,
                  originPlaceId: trip.originPlaceId,
                  destinationPlaceId: trip.destinationPlaceId,
                  startedS: leg.startedS,
                  arrivedS: leg.arrivedS,
                  distanceM: leg.distanceM,
                  routedM: info ? leg.distanceM : null,
                  routing:
                    leg.distanceM === 0 && leg.state !== 'failed'
                      ? 'zero'
                      : info
                        ? 'routed'
                        : leg.state === 'failed'
                          ? 'unreachable'
                          : leg.distanceM === 0
                            ? 'zero'
                            : 'fallback',
                  from: info?.from ?? null,
                  to: info?.to ?? null,
                  straightM: info?.straightM ?? leg.distanceM,
                  detour: info?.detour ?? (leg.state === 'failed' ? null : 1),
                  parkingCandidates:
                    position && 'node' in position
                      ? [...(parkingNodes.get(position.node) ?? [])]
                      : [],
                  carFacilityAtEnd: person.car.facility,
                  path:
                    info && (info.detour === 'unbounded' || info.detour > 3)
                      ? info.legs.map((leg) => ({
                          link: compiled.walk.links[leg.link]!.id,
                          fromM: leg.fromM,
                          toM: leg.toM,
                        }))
                      : undefined,
                };
              }),
          ) ?? []
        );
      })
    : undefined;
  return {
    scale,
    persons: population.length,
    trips: trips.length,
    releasedTrips,
    completedShareOfReleased: releasedTrips ? metrics.trips.completed / releasedTrips : 0,
    failedShareOfReleased: releasedTrips ? metrics.trips.failed / releasedTrips : 0,
    peakDriving: peak,
    peakWalkers: metrics.walkers?.peakActive ?? 0,
    personMetrics: metrics.persons,
    walkLegs,
    walkers: metrics.walkers,
    completedByHalfHour,
    stalledHeads,
    stalledHeadDetails,
    gridlockedRoads,
    meanDelayS: metrics.meanDelayS,
    routeRequests,
    headDetours,
    detouredHeads: detoured.size,
    detouredFailed: [...detoured].filter((id) => engine.inspect(id + 1)?.state === 'failed').length,
    headDetourRoads,
    meanRouteMs: routeRequests ? routeTimeMs / routeRequests : 0,
    walkRouteRequests,
    walkRouteTimeMs,
    zoneStops: metrics.zoneStops,
    respawns: metrics.respawns,
    ...metrics.trips,
    failedByReason: metrics.failedByReason,
    parking: metrics.parking,
    parkingSearchTimeS: (metrics.tripOutcomes ?? []).reduce((n, t) => n + t.parkingSearchTimeS, 0),
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
