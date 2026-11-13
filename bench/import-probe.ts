import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { householdCensus } from '../src/demand/households';
import { riderOf, stationRiders } from '../src/demand/stations';
import { defaultScenario } from '../src/fixtures/scenarios';
import { importOsmCached } from './city-cache';
import { compile, type CompiledCity } from '../src/network';
import type { City, Scenario, TripRequest } from '../src/schema';
import { createRouteProvider, freeFlowLinkCosts, type RouteProvider } from '../src/routing';
import { createWalkRouter, type WalkRequest, type WalkRoute } from '../src/routing/walk';
import { distance, pointAtDistance } from '../src/geo/polyline';
import { createEngine } from '../src/sim/engine';
import type { IntersectionObserver } from '../src/sim/intersection';
import type { Metrics, TrafficEngine } from '../src/sim/types';
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
import { trainCensus, trainTimetable } from '../src/network/trains';

// Import an OSM fixture, compile it, and run its morning headless: the baseline the import
// wave measures against. Usage: npm run import-probe -- fixtures/osm/<name>.osm w s e n [--scale n]
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/import-probe.ts')) {
  const [file, ...args] = process.argv.slice(2);
  if (!file || args.length < 4 || (args.length - 4) % 2)
    throw new Error(
      'Usage: import-probe <file.osm> w s e n [--scale n] [--seed n] [--mode-choice on|off] [--walk-legs file.json] [--parking-report file.json]',
    );
  let scaleArg = '1',
    seedArg = '1',
    modeChoiceArg = 'on',
    walkLegsFile: string | undefined,
    parkingReportFile: string | undefined;
  for (let i = 4; i < args.length; i += 2) {
    if (args[i] === '--scale') scaleArg = args[i + 1]!;
    else if (args[i] === '--seed') seedArg = args[i + 1]!;
    else if (args[i] === '--mode-choice') modeChoiceArg = args[i + 1]!;
    else if (args[i] === '--walk-legs') walkLegsFile = args[i + 1]!;
    else if (args[i] === '--parking-report') parkingReportFile = args[i + 1]!;
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  const scale = Number(scaleArg);
  const demandSeed = Number(seedArg);
  if (!Number.isSafeInteger(demandSeed) || demandSeed < 1)
    throw new Error('--seed must be a positive integer');
  if (modeChoiceArg !== 'on' && modeChoiceArg !== 'off')
    throw new Error('--mode-choice must be on or off');
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
  if (compiled.rail) {
    const start = performance.now();
    const timetable = trainTimetable(compiled.rail);
    console.info('Train timetable build ms', performance.now() - start);
    console.info('Train census', trainCensus(compiled.rail, timetable));
  }
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
    demandSeed,
    modeChoice: modeChoiceArg === 'on',
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
  console.info('Mode census', JSON.stringify(morning.modes));
}

/** TASK-113: the person trips by mode (as the mode choice left them; TASK-173: the caller passes
 * the trips whose tours have chosen) and straight-line distance band, each mode's distance
 * profile, and the person metrics' shares by hour and completions by mode. Local trips have no
 * gateway end; trips with one always drive. TASK-174: transit (mode `rail`) is the third mode,
 * with the riders per line and stop from the transit metrics. */
export function modeCensus(
  compiled: CompiledCity,
  trips: readonly TripRequest[],
  persons: Metrics['persons'],
  transit?: Metrics['transit'],
) {
  const bands = [500, 1000, 2000, 3000, Infinity];
  const label = (m: number) => (m === Infinity ? '3 km+' : `<${m / 1000} km`);
  const byBand = Object.fromEntries(
    bands.map((m) => [label(m), { walk: 0, car: 0, transit: 0, walkShare: 0, transitShare: 0 }]),
  );
  const distances: Record<'walk' | 'car' | 'transit', number[]> = {
    walk: [],
    car: [],
    transit: [],
  };
  let gatewayCar = 0;
  for (const trip of trips) {
    if (trip.personId === null || trip.purpose !== 'private' || trip.vehicleClass !== 'car')
      continue;
    // TASK-128's station riders came by train: outside the choice and the shares.
    if (riderOf(trip.personId)) continue;
    const place = (id: string) => compiled.places[compiled.index.place.get(id)!]!;
    const from = place(trip.originPlaceId),
      to = place(trip.destinationPlaceId);
    if (from.kind === 'gateway' || to.kind === 'gateway') {
      gatewayCar++;
      continue;
    }
    const meters = distance(from.centroid, to.centroid);
    const mode = trip.mode === 'walk' ? 'walk' : trip.mode === 'rail' ? 'transit' : 'car';
    byBand[label(bands.find((m) => meters < m)!)]![mode]++;
    distances[mode].push(meters);
  }
  for (const band of Object.values(byBand)) {
    const all = band.walk + band.car + band.transit;
    band.walkShare = all ? band.walk / all : 0;
    band.transitShare = all ? band.transit / all : 0;
  }
  const profile = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const at = (q: number) =>
      Math.round(sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0);
    return { trips: sorted.length, p10M: at(0.1), medianM: at(0.5), p90M: at(0.9) };
  };
  const local = distances.walk.length + distances.car.length + distances.transit.length;
  const byHour = persons
    ? persons.modes.byHour.walk.flatMap((walk, hour) => {
        const car = persons.modes.byHour.car[hour]!,
          transit = persons.modes.byHour.transit[hour]!;
        const all = walk + car + transit;
        return all
          ? [{ hour, walk, car, transit, walkShare: walk / all, transitShare: transit / all }]
          : [];
      })
    : [];
  return {
    localPersonTrips: local,
    walkShareLocal: local ? distances.walk.length / local : 0,
    transitShareLocal: local ? distances.transit.length / local : 0,
    gatewayPersonTrips: gatewayCar,
    byBand,
    profile: {
      walk: profile(distances.walk),
      car: profile(distances.car),
      transit: profile(distances.transit),
    },
    startedByHour: byHour,
    started: persons?.modes.started,
    completed: persons?.modes.completed,
    transit: transit && {
      lines: transit.lines.map(
        ({ name, capacity, boardings, alightings, riderBoardings, riderAlightings, peakLoad }) => ({
          name,
          capacity,
          boardings,
          alightings,
          riderBoardings,
          riderAlightings,
          peakLoad,
        }),
      ),
      stops: transit.stops.filter((s) => s.boardings + s.alightings),
      waits: transit.waits,
      deniedBoardings: transit.deniedBoardings,
      gaveUp: transit.gaveUp,
    },
  };
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
 * `observe` sees the engine after every step (the traffic tier's observers, TASK-090). `seed`
 * and `endS` give the other demand seeds and a longer day (TASK-129). */
export function probeMorning(
  city: City,
  compiled: CompiledCity,
  scale = 1,
  {
    untilS = 10 * 3600,
    observe,
    routeProvider,
    includeWalkLegs = false,
    demandSeed = 1,
    endS = 10 * 3600,
    intersectionObserver,
    engine = createEngine(),
    originObserver,
    headDetourObserver,
    modeChoice = true,
  }: {
    /** TASK-113: false turns the mode choice off (every driver drives, as before). */
    modeChoice?: boolean;
    endS?: number;
    untilS?: number;
    observe?: (engine: TrafficEngine) => void;
    routeProvider?: RouteProvider;
    includeWalkLegs?: boolean;
    demandSeed?: number;
    intersectionObserver?: IntersectionObserver;
    engine?: ReturnType<typeof createEngine>;
    originObserver?: Parameters<ReturnType<typeof createEngine>['load']>[0]['originObserver'];
    headDetourObserver?: Parameters<
      ReturnType<typeof createEngine>['load']
    >[0]['headDetourObserver'];
  } = {},
) {
  const scenario = defaultScenario('grid5x5', demandSeed);
  scenario.demand.personsPerResident = scale;
  scenario.startS = 7 * 3600;
  scenario.endS = endS;
  if (!modeChoice) scenario.demand.modeChoice = { enabled: false };
  const population = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, population, scenario, compiled);
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
    intersectionObserver,
    originObserver,
    headDetourObserver(id, lane, movement) {
      headDetours++;
      detoured.add(id);
      const road = compiled.roads[compiled.lanes[lane]!.road]!.id;
      headDetourRoads[road] = (headDetourRoads[road] ?? 0) + 1;
      headDetourObserver?.(id, lane, movement);
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
  const stepStart = performance.now();
  for (let step = 0; step < (untilS - scenario.startS) * 10; step += 600) {
    for (let i = 0; i < Math.min(600, (untilS - scenario.startS) * 10 - step); i++) {
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
  const stepTimeMs = performance.now() - stepStart;
  // Driving vehicles on a movement or first on their lane that have not moved for 300 s.
  const end = engine.snapshot();
  const front = new Map<number, number>();
  const loopCensus = Object.fromEntries(
    ['r:961', 'r:364', 'r:248', 'r:703', 'r:273', 'r:997'].map((road) => [
      road,
      { vehicles: 0, longestWaitS: 0, longestWaitingVehicle: 0 },
    ]),
  );
  for (const [index, id] of end.id.entries()) {
    const lane = end.lane[index]!;
    if (lane !== -2147483648) {
      const from = lane >= 0 ? lane : compiled.movements[-lane - 1]!.fromLane;
      const census = loopCensus[compiled.roads[compiled.lanes[from]!.road]!.id];
      if (census) {
        census.vehicles++;
        const detail = engine.inspect(id)!;
        if (detail.waitingS > census.longestWaitS) {
          census.longestWaitS = detail.waitingS;
          census.longestWaitingVehicle = id;
        }
      }
    }
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
  // Vehicle trips only: walk and transit trips (TASK-128 riders, tours that walk or ride) are not
  // vehicle trips and never pending.
  const releasedTrips =
    metrics.tripOutcomes!.filter((t) => t.mode === 'car').length - metrics.trips.pending;
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
  const outcomes = metrics.tripOutcomes!;
  // TASK-113: the trips as the run took them, walked tours without their car.
  const travelled = trips.map((trip, id) => {
    if (outcomes[id]!.mode === trip.mode) return trip;
    const walked: typeof trip = { ...trip, mode: outcomes[id]!.mode };
    delete walked.carId;
    return walked;
  });
  // TASK-173: a tour chooses its mode as it departs, so the census counts the trips of home-based
  // tours (each person's day split at departures from where it began) that had started by the
  // end of the run.
  const personTrips = new Map<string, number[]>();
  for (const [id, trip] of trips.entries())
    if (trip.personId !== null)
      personTrips.set(trip.personId, [...(personTrips.get(trip.personId) ?? []), id]);
  const decided = new Set<number>();
  for (const [personId, ids] of personTrips) {
    const states = new Map(
      engine.inspectPerson(personId)?.trips.map((record) => [record.tripId, record.state]) ?? [],
    );
    ids.sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
    const home = trips[ids[0]!]!.originPlaceId;
    let started = false;
    for (const id of ids) {
      if (trips[id]!.originPlaceId === home)
        started = (states.get(trips[id]!.id) ?? 'pending') !== 'pending';
      if (started) decided.add(id);
    }
  }
  // TASK-129: households, cars and drivers, and the stock against the formula it replaces.
  const homes = Object.values(city.places).filter((p) => p.kind === 'residential');
  const households = {
    ...householdCensus(city, population, travelled),
    homeCars: population.filter(
      (p) => p.hasCar && city.places[p.homePlaceId]!.kind === 'residential',
    ).length,
    formulaStock: homes.reduce(
      (n, p) => n + Math.ceil(Math.round(p.population * scale) * scenario.demand.carShare),
      0,
    ),
    carWaits: metrics.persons?.carWaits,
    home: metrics.parking.home,
  };
  return {
    scale,
    demandSeed,
    stepTimeMs,
    loopCensus,
    stateHash: engine.stateHash(),
    persons: population.length,
    households,
    modes: modeCensus(
      compiled,
      travelled.filter((_, id) => decided.has(id)),
      metrics.persons,
      metrics.transit,
    ),
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
    // Vehicle arrivals only: a walked trip's outcome reads as completed from the start.
    localArrivals: travelled.filter(
      (trip, id) =>
        trip.mode === 'car' &&
        city.places[trip.destinationPlaceId]!.kind !== 'gateway' &&
        (engine.inspect(id + 1)?.state === 'completed' ||
          engine.inspect(id + 1)?.failReason === 'no_parking'),
    ).length,
    gatewayTraffic,
    sampledRoadTraffic,
    failures: Object.fromEntries(failures),
    riders: riderCensus(city, scenario, trips, engine, untilS),
  };
}

/** TASK-128: S-Bahn riders, generated over the day and run to `untilS`. */
export function riderCensus(
  city: City,
  scenario: Scenario,
  trips: TripRequest[],
  engine: TrafficEngine,
  untilS: number,
) {
  const { stops } = stationRiders(city, scenario);
  if (!stops.length) return null;
  const perHour: Record<number, { commuter: number; visitor: number }> = {};
  const perPlatform: Record<string, number> = {};
  const emptyStops: Record<string, number> = {};
  for (const s of stops) {
    const hour = Math.floor(s.arrivalS / 3600);
    if (s.kind) (perHour[hour] ??= { commuter: 0, visitor: 0 })[s.kind] += s.riders;
    perPlatform[s.platform] = (perPlatform[s.platform] ?? 0) + s.riders;
    if (s.empty) emptyStops[s.empty] = (emptyStops[s.empty] ?? 0) + 1;
  }
  const doors = stops.map((s) => s.doorS).sort((a, b) => a - b);
  const riderTrips = trips.filter((t) => t.personId && riderOf(t.personId));
  const destinations: Record<string, number> = {};
  for (const t of riderTrips)
    if (t.id.endsWith(':back'))
      destinations[t.originPlaceId] = (destinations[t.originPlaceId] ?? 0) + 1;
  const outcome = { released: 0, started: 0, completed: 0, active: 0, failed: 0, walkFallbacks: 0 };
  const failedByReason: Record<string, number> = {};
  const distances: number[] = [];
  const delays: number[] = [];
  for (const id of new Set(riderTrips.map((t) => t.personId!))) {
    const person = engine.inspectPerson(id)!;
    for (const trip of person.trips) {
      if (trip.departS <= untilS) outcome.released++;
      if (trip.state === 'pending') continue;
      outcome.started++;
      if (trip.state === 'completed') outcome.completed++;
      if (trip.state === 'active') outcome.active++;
      if (trip.state === 'failed') {
        outcome.failed++;
        failedByReason[trip.failReason!] = (failedByReason[trip.failReason!] ?? 0) + 1;
      }
      const leg = trip.legs[0];
      if (leg?.walkerId !== null && leg?.walkerId !== undefined) distances.push(leg.distanceM);
      else if (leg && trip.state !== 'failed') outcome.walkFallbacks++;
      if (trip.tripId.endsWith(':out') && leg?.startedS !== null && leg?.startedS !== undefined)
        delays.push(leg.startedS - riderOf(id)!.arrivalS);
    }
  }
  distances.sort((a, b) => a - b);
  delays.sort((a, b) => a - b);
  const at = (list: number[], q: number) =>
    list[Math.min(list.length - 1, Math.floor(q * list.length))] ?? null;
  return {
    riders: stops.reduce((n, s) => n + s.riders, 0),
    stops: stops.length,
    perHour,
    perPlatform,
    emptyStops,
    doorDelayS: { median: at(doors, 0.5), max: doors.at(-1) ?? null },
    startDelayS: { median: at(delays, 0.5), max: delays.at(-1) ?? null },
    topDestinations: Object.entries(destinations)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 10)
      .map(([id, count]) => ({
        id,
        name: city.places[id]!.name,
        kind: city.places[id]!.kind,
        count,
      })),
    walkM: { median: at(distances, 0.5), p90: at(distances, 0.9), legs: distances.length },
    trips: riderTrips.length,
    ...outcome,
    failedByReason,
  };
}
