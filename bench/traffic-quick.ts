import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from '../src/sim/engine';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { placeTrees } from '../src/render/vegetation';
import { placeStreet, treeContext } from '../src/render/street';
import { compile } from '../src/network';
import { probeMorning } from './import-probe';
import { loadAuditCity } from './junction-audit';
import { createRouteProvider, type RouteProvider } from '../src/routing';

// A quick Munich morning for iterating (TASK-090), advisory only: the traffic gate's run (the
// extract at --scale 0.15, the same demand) stopped at 09:30, its totals and their change against
// main's recorded in bench/traffic-baseline.json. On a18cce0 and 81dfcd0 it ranks the two trees as
// the full morning does on completed trips and gridlock; the gate itself is `npm run test:traffic`.
// Usage: npm run traffic:quick

const untilS = 9.5 * 3600;
const { quick } = JSON.parse(readFileSync('bench/traffic-baseline.json', 'utf8')) as {
  quick: { completed: number; gridlocked: number };
};
const start = performance.now();
const city = loadAuditCity('munich');
const result = compile(city);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
const aisles = new Set(Object.values(city.parking ?? {}).flatMap((lot) => lot.aisles ?? []));
const provider = createRouteProvider();
let checkedRoutes = 0,
  lotRoutes = 0;
const routeProvider: RouteProvider = {
  route(net, costs, request) {
    const route = provider.route(net, costs, request);
    if (!route.ok) return route;
    checkedRoutes++;
    const used = route.route.roads.filter((i) => aisles.has(net.roads[i]!.id));
    if (!used.length) return route;
    lotRoutes++;
    const from = net.roads[net.lanes[request.fromLane]!.road]!.id;
    const to = net.roads[net.lanes[net.connectors[request.toConnector]!.lane]!.road]!.id;
    for (const i of used) {
      const id = net.roads[i]!.id;
      if (
        !Object.values(city.parking ?? {}).some(
          (lot) =>
            lot.aisles?.includes(id) && (lot.aisles.includes(from) || lot.aisles.includes(to)),
        )
      )
        throw new Error(`Through route ${from}>${to} uses lot aisle ${id}`);
    }
    return route;
  },
};
const profiler = process.env.CITYFLOWS_CPU_PROFILE ? new Session() : null;
if (profiler) {
  profiler.connect();
  await profiler.post('Profiler.enable');
  await profiler.post('Profiler.start');
}
const morning = probeMorning(city, result.compiled, 0.15, { untilS, routeProvider });
if (profiler) {
  const { profile } = await profiler.post('Profiler.stop');
  writeFileSync(process.env.CITYFLOWS_CPU_PROFILE!, JSON.stringify(profile));
  profiler.disconnect();
}
console.info('Aisle route audit', { checkedRoutes, lotRoutes, throughAisleRoutes: 0 });
const totals = {
  completed: morning.completed,
  failed: morning.failed,
  gridlocked: morning.failedByReason.gridlocked,
  stalledHeads: morning.stalledHeads,
  failedByReason: morning.failedByReason,
  parking: {
    arrivals: morning.parking.arrivals,
    meanSearchTimeS: morning.parking.meanSearchTimeS,
    failed: morning.parking.failed,
    localArrivals: morning.localArrivals,
  },
  meanDelayS: morning.meanDelayS,
  routeRequests: morning.routeRequests,
  meanRouteMs: morning.meanRouteMs,
};
console.info(
  `Munich at 0.15, 07:00 to 09:30, ${((performance.now() - start) / 1000).toFixed(1)} s:`,
  totals,
);
console.info('against main', {
  completed: totals.completed - quick.completed,
  gridlocked: totals.gridlocked - quick.gridlocked,
});

console.info('gridlocked by road', morning.gridlockedRoads);
console.info('stalled heads', morning.stalledHeadDetails);

// TASK-103: opt-in like-for-like phase timings against the lead's main checkout, through
// the authorized quick gate. Keep the ordinary advisory run unchanged when no root is set.
if (process.env.CITYFLOWS_BASELINE_ROOT) {
  const phase = (
    api: {
      compile: typeof compile;
      createEngine: typeof createEngine;
      generatePopulation: typeof generatePopulation;
      scheduleTrips: typeof scheduleTrips;
      defaultScenario: typeof defaultScenario;
      placeTrees: typeof placeTrees;
      placeStreet: typeof placeStreet;
      treeContext: typeof treeContext;
    },
    source: typeof city,
  ) => {
    const begin = performance.now();
    const result = api.compile(source);
    const compileMs = performance.now() - begin;
    if (!result.ok) throw new Error('Timing city did not compile');
    const startTrees = performance.now();
    const trees = api.placeTrees(result.compiled, api.treeContext(source));
    const treesMs = performance.now() - startTrees;
    const startStreet = performance.now();
    api.placeStreet(result.compiled, source, trees.trees);
    const streetMs = performance.now() - startStreet;
    const scenario = api.defaultScenario('grid5x5');
    scenario.startS = 7 * 3600;
    scenario.endS = untilS;
    scenario.demand.personsPerResident = 0.15;
    const persons = api.generatePopulation(source, scenario.demand);
    const trips = api.scheduleTrips(source, persons, scenario);
    const engine = api.createEngine();
    const startLoad = performance.now();
    engine.load({ compiled: result.compiled, trips, scenario });
    const loadMs = performance.now() - startLoad;
    const startStep = performance.now();
    engine.step((untilS - scenario.startS) * 10);
    const stepMs = performance.now() - startStep;
    return { compileMs, treesMs, streetMs, loadMs, stepMs, meanStepMs: stepMs / 90000 };
  };
  const current = phase(
    {
      compile,
      createEngine,
      generatePopulation,
      scheduleTrips,
      defaultScenario,
      placeTrees,
      placeStreet,
      treeContext,
    },
    city,
  );
  const root = resolve(process.env.CITYFLOWS_BASELINE_ROOT);
  const module = (file: string) => import(pathToFileURL(resolve(root, file)).href);
  const mainApi = Object.assign(
    {},
    ...(await Promise.all([
      module('src/network/index.ts'),
      module('src/sim/engine.ts'),
      module('src/demand/index.ts'),
      module('src/fixtures/scenarios.ts'),
      module('src/render/vegetation.ts'),
      module('src/render/street.ts'),
    ])),
  ) as Parameters<typeof phase>[0];
  const { loadAuditCity: loadMain } = (await module('bench/junction-audit.ts')) as {
    loadAuditCity: typeof loadAuditCity;
  };
  const cwd = process.cwd();
  let main: ReturnType<typeof phase>;
  try {
    process.chdir(root);
    main = phase(mainApi, loadMain('munich'));
  } finally {
    process.chdir(cwd);
  }
  console.info(
    'TASK-103 phase timings (ms)',
    JSON.stringify({
      main,
      current,
      grew: Object.fromEntries(
        Object.entries(current)
          .filter(([key, value]) => value > main[key as keyof typeof main])
          .map(([key, value]) => [key, { main: main[key as keyof typeof main], current: value }]),
      ),
    }),
  );
}
