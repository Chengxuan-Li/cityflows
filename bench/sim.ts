import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { cpus, platform } from 'node:os';
import process from 'node:process';
import { compile } from '../src/network';
import {
  createRouteProvider,
  freeFlowLinkCosts,
  type RouteRequest,
  type RouteResult,
} from '../src/routing';
import { createEngine } from '../src/sim/engine';
import { workload, workloadNames } from './workloads';

const selected = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
const profiling = process.argv.includes('--profile');
const routesOnly = process.argv.includes('--routes-only');
assert(globalThis.gc, 'Use npm run bench so retained heap is measured after GC');
assert(
  !selected || workloadNames.some((name) => name === selected),
  `Unknown workload: ${selected}`,
);
const mib = (bytes: number) => Math.round((bytes / 1024 ** 2) * 100) / 100;
const rows = [];
const reports = [];
console.info({ node: process.version, platform: platform(), cpu: cpus()[0]?.model });
const durationS = routesOnly ? 0 : profiling ? 3 * 3600 : 86400;
console.info(
  routesOnly
    ? 'Routing only: median of three 3,000-request batches'
    : profiling
      ? 'Profile: 07:00–10:00 (not a 24-hour memory run)'
      : '24 simulated hours from 07:00; morning throughput covers 07:00–10:00',
);
if (!routesOnly)
  console.info(
    'Peak counts are sampled every 60 simulated seconds; step timers exclude metrics and snapshots.',
  );

for (const name of workloadNames) {
  if (selected && selected !== name) continue;
  const { city, scenario, population, trips } = workload(name);
  if (durationS) scenario.endS = scenario.startS + durationS;
  const result = compile(city);
  assert(result.ok, JSON.stringify(result.diagnostics));
  const { compiled } = result;
  const engine = createEngine();
  engine.load({ compiled, trips, scenario });
  const sampleSteps = 600;
  let peakActive = 0;
  let peakTimeS = 0;
  let peakQueuedOrigin = 0;
  let dayMs = 0;
  let morningMs = 0;
  let morningSteps = 0;
  let snapshotMs = 0;
  let snapshotCount = 0;
  const heap = () => {
    globalThis.gc!();
    const usage = process.memoryUsage();
    return { heapMiB: mib(usage.heapUsed), arrayBuffersMiB: mib(usage.arrayBuffers) };
  };
  const before = heap();
  let afterPeak = before;
  const profiler = profiling ? new Session() : undefined;
  if (profiler) {
    profiler.connect();
    await profiler.post('Profiler.enable');
    await profiler.post('Profiler.setSamplingInterval', { interval: 1000 });
  }
  let profile;
  let reviewMs = 0;
  let reviewCounts;
  for (let step = 0; step < durationS * 10; step += sampleSteps) {
    const morning = engine.timeS >= 7 * 3600 && engine.timeS < 10 * 3600;
    if (profiler && engine.timeS === 7 * 3600) await profiler.post('Profiler.start');
    const start = performance.now();
    engine.step(sampleSteps);
    const elapsed = performance.now() - start;
    dayMs += elapsed;
    if (engine.timeS <= 18 * 3600) reviewMs += elapsed;
    if (morning) {
      morningMs += elapsed;
      morningSteps += sampleSteps;
    }
    const counts = engine.metrics().trips;
    assert.equal(
      Object.values(counts).reduce((sum, n) => sum + n, 0),
      trips.length,
    );
    if (counts.driving + counts.queuedDestination > peakActive) {
      peakActive = counts.driving + counts.queuedDestination;
      peakTimeS = engine.timeS;
    }
    peakQueuedOrigin = Math.max(peakQueuedOrigin, counts.queuedOrigin);
    if (engine.timeS === 18 * 3600) reviewCounts = counts;
    if (engine.timeS === 10 * 3600) {
      if (profiler) profile = (await profiler.post('Profiler.stop')).profile;
      afterPeak = heap();
    }
    if (!profiling && engine.timeS === 8 * 3600 + 180) {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) snapshotCount = engine.snapshot().count;
      snapshotMs = (performance.now() - start) / 1000;
    }
  }
  profiler?.disconnect();
  const afterDay = heap();
  const metrics = engine.metrics();
  if (name !== 'grid5x5-stress') assert.equal(metrics.trips.failed, 0, `${name}: failed trips`);
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  const origins = compiled.connectors.filter((c) => c.direction !== 'in');
  const destinations = compiled.connectors.filter((c) => c.direction !== 'out');
  const requests: RouteRequest[] = Array.from({ length: 3000 }, (_, i) => {
    const origin = origins[i % origins.length]!;
    return {
      fromLane: origin.lane,
      fromPosM: origin.positionM,
      toConnector: destinations[Math.floor(i / origins.length) % destinations.length]!.idx,
      vehicleClass: 'car',
      desiredSpeedFactor: 1,
      noise: 0.1,
      seed: i + 1,
    };
  });
  for (const request of requests.slice(0, 1000)) provider.route(compiled, costs, request);
  const routeRates: number[] = [];
  const routes: RouteResult[] = [];
  for (let trial = 0; trial < 3; trial++) {
    routes.length = 0;
    const routeStart = performance.now();
    for (const [i, request] of requests.entries()) {
      if (i % 60 === 0) costs.version++;
      routes.push(provider.route(compiled, costs, request));
    }
    routeRates.push(Math.round((requests.length * 1000) / (performance.now() - routeStart)));
    assert(
      routes.every((route) => route.ok),
      `${name}: route failed`,
    );
  }
  const routesPerSecond = [...routeRates].sort((a, b) => a - b)[1]!;
  const routeHash = createHash('sha256').update(JSON.stringify(routes)).digest('hex');
  const snapshotStart = performance.now();
  for (let i = 0; i < 1000; i++) engine.snapshot();
  const snapshotAtEndMs = (performance.now() - snapshotStart) / 1000;
  const row = {
    scenario: name,
    persons: population.length,
    trips: trips.length,
    peakActive,
    peakTimeS,
    peakQueuedOrigin,
    'morning steps/s': routesOnly ? null : Math.round((morningSteps * 1000) / morningMs),
    '24h steps/s': durationS === 86400 ? Math.round((durationS * 10000) / dayMs) : null,
    'routes/s': routesPerSecond,
    'heap start MiB': before.heapMiB,
    'heap 10h MiB': afterPeak.heapMiB,
    'heap end MiB': afterDay.heapMiB,
    'buffers end MiB': afterDay.arrayBuffersMiB,
    zoneStops: metrics.zoneStops,
    respawns: metrics.respawns,
    completed: metrics.trips.completed,
    failed: metrics.trips.failed,
    unfinished: trips.length - metrics.trips.completed - metrics.trips.failed,
  };
  let hotspots: { frame: string; sharePercent: number }[] = [];
  if (profile) {
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map<number, number>();
    for (const node of profile.nodes)
      for (const child of node.children ?? []) parents.set(child, node.id);
    const shares = new Map<string, number>();
    let total = 0;
    for (const [i, sample] of (profile.samples ?? []).entries()) {
      const weight = profile.timeDeltas?.[i] ?? 1;
      total += weight;
      let node = nodes.get(sample)!;
      while (!node.callFrame.url.includes('/src/') && parents.has(node.id))
        node = nodes.get(parents.get(node.id)!)!;
      const frame = node.callFrame.url.includes('/src/')
        ? `${node.callFrame.url.split('/src/')[1]}:${node.callFrame.functionName || '(anonymous)'}`
        : nodes.get(sample)!.callFrame.functionName;
      shares.set(frame, (shares.get(frame) ?? 0) + weight);
    }
    hotspots = [...shares]
      .map(([frame, weight]) => ({
        frame,
        sharePercent: Math.round((weight / total) * 10000) / 100,
      }))
      .sort((a, b) => b.sharePercent - a.sharePercent);
    await mkdir('bench/profiles', { recursive: true });
    await writeFile(`bench/profiles/${name}.cpuprofile.log`, JSON.stringify(profile));
  }
  rows.push(row);
  reports.push({
    ...row,
    afterDay,
    hash: engine.stateHash(),
    snapshotAtEndMs,
    snapshotMs,
    snapshotCount,
    routeRates,
    routeHash,
    hotspots,
    finalTrips: metrics.trips,
    failedByReason: metrics.failedByReason,
    reviewWindow: reviewCounts
      ? {
          stepsPerSecond: Math.round(396000000 / reviewMs),
          requested: trips.filter((trip) => trip.departS < 18 * 3600).length,
          counts: reviewCounts,
        }
      : null,
  });
}
console.table(
  routesOnly ? rows.map((row) => ({ scenario: row.scenario, 'routes/s': row['routes/s'] })) : rows,
);
await writeFile(
  'bench/latest.log',
  JSON.stringify(
    { environment: { node: process.version, cpu: cpus()[0]?.model }, durationS, reports },
    null,
    2,
  ),
);
if (profiling)
  for (const report of reports) console.info(report.scenario, report.hotspots.slice(0, 15));
