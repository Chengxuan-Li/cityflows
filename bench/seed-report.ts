import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadAuditCity } from './junction-audit';
import { probeMorning } from './import-probe';
import { compile } from '../src/network';
import { DEFAULT_SIM_PARAMS } from '../src/sim/params';
import type { IntersectionObserver } from '../src/sim/intersection';
import type { TrafficEngine, VehicleDetail } from '../src/sim/types';

// TASK-172, the nightly three-seed report (advisory, never a gate): Munich at 0.15 to 10:00 on
// demand seeds 1 to 3, mode choice off and on, six runs in parallel child processes.
// Usage: npm run seed-report -- --out <dir> [--previous <report.json>] [--jobs n] [--seeds 1,2,3]
// [--actuated on|off] (TASK-180: other seeds; every generated program's actuation set).
// Writes <dir>/seed-report.json and <dir>/seed-report.md.

const SCALE = 0.15;
/** The Landsberger loop's six roads (TASK-154's drain criteria; `probeMorning`'s loop census). */
const LOOP_ROADS = ['r:961', 'r:364', 'r:248', 'r:703', 'r:273', 'r:997'];
/** Criterion (b): the most wait one visit to a loop road may add. */
const VISIT_LIMIT_S = 900;
/** Criterion (a): a dependency ring that persisted this long is sustained (the stalled-head
 * threshold; TASK-154 does not fix a figure). */
const SUSTAINED_RING_S = 300;
/** Rings are only inferred from 08:30, as in `bench/task131-traffic.ts`. */
const RING_FROM_S = 27000;

interface Run {
  seed: number;
  modeChoice: boolean;
  completed: number;
  gridlocked: number;
  stalledHeads: number;
  parkingFailures: number;
  meanDelayS: number;
  stateHash: number;
  drain: {
    /** Distinct dependency rings seen through a loop road, the longest one's persistence, and
     * the rings present at 10:00 (criterion a). */
    rings: number;
    longestRingS: number;
    ringsAtEnd: number;
    /** Most wait any one visit added, per loop road (criterion b). */
    visitPeakS: Record<string, number>;
    /** Cars standing over `boxWaitS` on inner links at 10:00, and the longest inner stand of the
     * morning (criterion c). */
    innerOverBox: number;
    longestInnerStopS: number;
  };
  /** Choice-on runs only. */
  modes?: {
    localPersonTrips: number;
    walkShareLocal: number;
    gatewayPersonTrips: number;
    /** Null for a band with no trips. */
    walkShareByBand: Record<string, number | null>;
  };
}

interface Report {
  commit: string;
  generatedAt: string;
  scale: number;
  /** TASK-180: the actuation set on every generated program, when the run overrode it. */
  actuated?: boolean;
  runs: Run[];
  failed: { seed: number; modeChoice: boolean; error: string }[];
}

/** One run, with TASK-154's observers (`bench/task131-traffic.ts`) cut down to the figures the
 * drain criteria need. */
function runOne(seed: number, modeChoice: boolean, actuated?: boolean): Run {
  const city = loadAuditCity('munich');
  if (actuated !== undefined)
    for (const owner of [...Object.values(city.nodes), ...Object.values(city.junctionGroups ?? {})])
      if (owner.signal) owner.signal.actuated = actuated;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { compiled } = result;
  const watched = new Set(LOOP_ROADS);
  const boxWaitS = DEFAULT_SIM_PARAMS.intersection.boxWaitS;
  const decisions = new Map<
    number,
    { reason: Parameters<IntersectionObserver>[2]; movement: number; other?: number }
  >();
  const roadOf = new Map<number, string>();
  const visits = new Map<number, number>(); // car on a loop road: its wait on entering it
  const stoppedSince = new Map<number, number>();
  const standing = new Map<number, { segment: number; sinceS: number }>();
  const visitPeakS = Object.fromEntries(LOOP_ROADS.map((road) => [road, 0]));
  const rings = new Map<string, { firstS: number; lastS: number; longestS: number }>();
  let ringsAtEnd = 0;
  let innerOverBox = 0;
  let longestInnerStopS = 0;
  let tick = 0;

  const morning = probeMorning(city, compiled, SCALE, {
    demandSeed: seed,
    modeChoice,
    intersectionObserver(id, movement, reason, other) {
      decisions.set(id + 1, { reason, movement: movement.idx, other: other?.idx });
    },
    observe(engine: TrafficEngine) {
      if (++tick % 10) return;
      const snapshot = engine.snapshot();
      const active = new Set(snapshot.id);
      for (const map of [roadOf, visits, stoppedSince, standing])
        for (const id of map.keys()) if (!active.has(id)) map.delete(id);
      const census = engine.timeS >= RING_FROM_S;
      const heads = new Map<number, VehicleDetail>();
      let overBox = 0;
      for (const [i, id] of snapshot.id.entries()) {
        const segment = snapshot.lane[i]!;
        if (segment === -2147483648) {
          roadOf.delete(id);
          visits.delete(id);
          continue;
        }
        const movement = segment < 0 ? compiled.movements[-segment - 1]! : null;
        const road = compiled.roads[compiled.lanes[movement?.fromLane ?? segment]!.road]!;
        const stopped = snapshot.speed[i]! < 0.1;
        if (!stopped) stoppedSince.delete(id);
        else if (!stoppedSince.has(id)) stoppedSince.set(id, engine.timeS);
        let detail: VehicleDetail | undefined;
        if (roadOf.get(id) !== road.id) {
          roadOf.set(id, road.id);
          visits.delete(id);
          if (watched.has(road.id)) visits.set(id, (detail = engine.inspect(id)!).waitingS);
        }
        const entryWaitS = visits.get(id);
        if (entryWaitS !== undefined) {
          const addedS = (detail ??= engine.inspect(id)!).waitingS - entryWaitS;
          visitPeakS[road.id] = Math.max(visitPeakS[road.id]!, addedS);
        }
        if (road.group !== undefined && stopped) {
          const previous = standing.get(id);
          const sinceS = previous?.segment === segment ? previous.sinceS : snapshot.timeS;
          standing.set(id, { segment, sinceS });
          longestInnerStopS = Math.max(longestInnerStopS, snapshot.timeS - sinceS);
          if (snapshot.timeS - sinceS > boxWaitS) overBox++;
        } else standing.delete(id);
        if (census) {
          detail ??= engine.inspect(id)!;
          const head = heads.get(segment);
          if (!head || head.positionM < detail.positionM) heads.set(segment, detail);
        }
      }
      innerOverBox = overBox;
      if (!census) return;
      // An edge runs from a stopped head to the stopped head that blocks it; a ring is a cycle
      // of such edges through a loop road.
      const edges = new Map<number, number>();
      for (const [segment, head] of heads) {
        if (
          head.state !== 'driving' ||
          engine.timeS - (stoppedSince.get(head.id) ?? engine.timeS) < 10
        )
          continue;
        const decision = decisions.get(head.id);
        const movement =
          segment < 0
            ? compiled.movements[-segment - 1]!
            : compiled.movements[decision?.movement ?? -1];
        if (!movement || decision?.reason === 'signal' || decision?.reason === 'stop') continue;
        let blocker = heads.get(movement.toLane);
        if (
          (decision?.reason === 'movement' || decision?.reason === 'approach') &&
          decision.other !== undefined
        ) {
          const other = compiled.movements[decision.other]!;
          blocker = heads.get(-other.idx - 1) ?? heads.get(other.fromLane);
        }
        if (!blocker || blocker.id === head.id || blocker.speedMps >= 0.1) continue;
        edges.set(head.id, blocker.id);
      }
      const current = new Set<string>();
      for (const id of edges.keys()) {
        const path: number[] = [];
        let next: number | undefined = id;
        while (next !== undefined && !path.includes(next)) {
          path.push(next);
          next = edges.get(next);
        }
        if (next === undefined) continue;
        const ring = path.slice(path.indexOf(next));
        if (ring.length < 2 || !ring.some((member) => watched.has(roadOf.get(member) ?? '')))
          continue;
        const key = [...ring].sort((a, b) => a - b).join(',');
        current.add(key);
        const span = rings.get(key);
        if (span && engine.timeS - span.lastS <= 1.5) span.lastS = engine.timeS;
        else if (span) Object.assign(span, { firstS: engine.timeS, lastS: engine.timeS });
        else rings.set(key, { firstS: engine.timeS, lastS: engine.timeS, longestS: 0 });
        const updated = rings.get(key)!;
        updated.longestS = Math.max(updated.longestS, updated.lastS - updated.firstS);
      }
      ringsAtEnd = current.size;
    },
  });

  const { modes } = morning;
  return {
    seed,
    modeChoice,
    completed: morning.completed,
    gridlocked: morning.failedByReason.gridlocked,
    stalledHeads: morning.stalledHeads,
    parkingFailures: morning.failedByReason.no_parking,
    meanDelayS: morning.meanDelayS,
    stateHash: morning.stateHash,
    drain: {
      rings: rings.size,
      longestRingS: Math.max(0, ...[...rings.values()].map((span) => span.longestS)),
      ringsAtEnd,
      visitPeakS,
      innerOverBox,
      longestInnerStopS,
    },
    ...(modeChoice && {
      modes: {
        localPersonTrips: modes.localPersonTrips,
        walkShareLocal: modes.walkShareLocal,
        gatewayPersonTrips: modes.gatewayPersonTrips,
        walkShareByBand: Object.fromEntries(
          Object.entries(modes.byBand).map(([band, { walk, car, walkShare }]) => [
            band,
            walk + car ? walkShare : null,
          ]),
        ),
      },
    }),
  };
}

const n = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
/** A figure with its change since the previous report, when there is one. */
const delta = (value: number, before: number | undefined) =>
  before === undefined
    ? n(value)
    : `${n(value)} (${value === before ? '=' : (value > before ? '+' : '-') + n(Math.abs(value - before))})`;
const pct = (share: number | null) => (share === null ? '-' : `${(100 * share).toFixed(1)}%`);
const label = (run: Run) => `${run.seed} | ${run.modeChoice ? 'on' : 'off'}`;

function markdown(
  seeds: number[],
  report: Report,
  previous: Report | undefined,
  baseline: Record<string, number>,
) {
  const before = (run: Run) =>
    previous?.runs.find((p) => p.seed === run.seed && p.modeChoice === run.modeChoice);
  const sorted = report.runs.toSorted((a, b) => a.seed - b.seed || +a.modeChoice - +b.modeChoice);
  const lines = [
    `## Munich at ${SCALE} to 10:00, seeds ${seeds.join(', ')}`,
    '',
    `Commit \`${report.commit}\`. Previous report: ${previous ? `\`${previous.commit}\`` : 'none'}.${report.actuated === undefined ? '' : ` Signals ${report.actuated ? 'actuated' : 'fixed-time'}.`} Advisory; changes since the previous report in parentheses.`,
    '',
    '| Seed | Mode choice | Completed | Gridlocked | Stalled heads | Parking failures | Mean delay (s) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const run of sorted) {
    const p = before(run);
    lines.push(
      `| ${label(run)} | ${delta(run.completed, p?.completed)} | ${delta(run.gridlocked, p?.gridlocked)} | ${delta(run.stalledHeads, p?.stalledHeads)} | ${delta(run.parkingFailures, p?.parkingFailures)} | ${delta(Math.round(run.meanDelayS * 10) / 10, p && Math.round(p.meanDelayS * 10) / 10)} |`,
    );
  }
  const seed1 = sorted.find((run) => run.seed === 1 && !run.modeChoice);
  if (seed1)
    lines.push(
      '',
      `Against \`bench/traffic-baseline.json\` (seed 1, mode choice off): completed ${delta(seed1.completed, baseline.completed)}, gridlocked ${delta(seed1.gridlocked, baseline.gridlocked)}, stalled heads ${delta(seed1.stalledHeads, baseline.stalledHeads)}.`,
    );
  lines.push(
    '',
    '### Drain criteria',
    '',
    `(a) no dependency ring through a loop road persisting ${SUSTAINED_RING_S} s or more; (b) no single visit to a loop road adding more than ${VISIT_LIMIT_S} s of waiting; (c) no car standing over ${DEFAULT_SIM_PARAMS.intersection.boxWaitS} s on an inner link at 10:00; (d) no stalled head. Rings: distinct, longest persistence, present at 10:00. Loop roads: worst single-visit wait in seconds.`,
    '',
    `| Seed | Mode choice | (a) | (b) | (c) | (d) | ${LOOP_ROADS.map((road) => `\`${road}\``).join(' | ')} |`,
    `| --- | --- | --- | --- | --- | --- | ${LOOP_ROADS.map(() => '---').join(' | ')} |`,
  );
  const verdict = (met: boolean, detail: string) => `${met ? 'met' : '**NOT MET**'} (${detail})`;
  for (const run of sorted) {
    const { drain } = run;
    const worst = Math.max(...Object.values(drain.visitPeakS));
    lines.push(
      `| ${label(run)} | ${verdict(drain.longestRingS < SUSTAINED_RING_S, `${drain.rings} / ${n(drain.longestRingS)} s / ${drain.ringsAtEnd}`)} | ${verdict(worst <= VISIT_LIMIT_S, `${n(Math.round(worst))} s`)} | ${verdict(drain.innerOverBox === 0, `${drain.innerOverBox}, longest ${n(Math.round(drain.longestInnerStopS))} s`)} | ${verdict(run.stalledHeads === 0, String(run.stalledHeads))} | ${LOOP_ROADS.map((road) => n(Math.round(drain.visitPeakS[road]!))).join(' | ')} |`,
    );
  }
  const choice = sorted.filter((run) => run.modes);
  if (choice.length) {
    const bands = Object.keys(choice[0]!.modes!.walkShareByBand);
    lines.push(
      '',
      '### Mode shares, choice on',
      '',
      `Walk share of local person trips, overall and by straight-line distance band. Gateway person trips always drive.`,
      '',
      `| Seed | Local person trips | Walk share | ${bands.join(' | ')} | Gateway person trips |`,
      `| --- | --- | --- | ${bands.map(() => '---').join(' | ')} | --- |`,
    );
    for (const run of choice) {
      const m = run.modes!;
      const p = before(run)?.modes;
      lines.push(
        `| ${run.seed} | ${delta(m.localPersonTrips, p?.localPersonTrips)} | ${pct(m.walkShareLocal)} | ${bands.map((band) => pct(m.walkShareByBand[band]!)).join(' | ')} | ${delta(m.gatewayPersonTrips, p?.gatewayPersonTrips)} |`,
      );
    }
  }
  for (const f of report.failed)
    lines.push(
      '',
      `Run seed ${f.seed}, mode choice ${f.modeChoice ? 'on' : 'off'} failed: ${f.error}`,
    );
  return lines.join('\n') + '\n';
}

function worker(seed: number, modeChoice: boolean, actuated?: boolean) {
  console.log(JSON.stringify(runOne(seed, modeChoice, actuated)));
}

async function main(args: string[]) {
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const out = option('--out');
  if (!out) throw new Error('Usage: seed-report --out <dir> [--previous <report.json>] [--jobs n]');
  const jobs = Number(option('--jobs') ?? Math.min(6, Math.max(1, availableParallelism() - 1)));
  const seeds = (option('--seeds') ?? '1,2,3').split(',').map(Number);
  const actuated = option('--actuated');
  const previousFile = option('--previous');
  const previous =
    previousFile && existsSync(previousFile)
      ? (JSON.parse(readFileSync(previousFile, 'utf8')) as Report)
      : undefined;
  if (previousFile && !previous) console.info(`No previous report at ${previousFile}`);

  const queue = seeds.flatMap((seed) => [false, true].map((modeChoice) => ({ seed, modeChoice })));
  const report: Report = {
    commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    generatedAt: new Date().toISOString(),
    scale: SCALE,
    ...(actuated && { actuated: actuated === 'on' }),
    runs: [],
    failed: [],
  };
  const start = (seed: number, modeChoice: boolean) =>
    new Promise<void>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          ...process.execArgv,
          fileURLToPath(import.meta.url),
          '--worker',
          String(seed),
          modeChoice ? 'on' : 'off',
          ...(actuated ? [actuated] : []),
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk));
      child.on('close', (code) => {
        const name = `seed ${seed}, mode choice ${modeChoice ? 'on' : 'off'}`;
        try {
          if (code !== 0) throw new Error(`exited with code ${code}`);
          report.runs.push(JSON.parse(stdout.trim().split('\n').at(-1)!) as Run);
          console.info(`done: ${name}`);
        } catch (error) {
          report.failed.push({ seed, modeChoice, error: (error as Error).message });
          console.error(`failed: ${name}: ${(error as Error).message}`);
        }
        resolve();
      });
    });
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (let run = queue.shift(); run; run = queue.shift()) await start(run.seed, run.modeChoice);
    }),
  );

  mkdirSync(out, { recursive: true });
  const baseline = JSON.parse(readFileSync('bench/traffic-baseline.json', 'utf8')) as Record<
    string,
    number
  >;
  report.runs.sort((a, b) => a.seed - b.seed || +a.modeChoice - +b.modeChoice);
  writeFileSync(join(out, 'seed-report.json'), JSON.stringify(report, null, 2));
  const summary = markdown(seeds, report, previous, baseline);
  writeFileSync(join(out, 'seed-report.md'), summary);
  console.info(summary);
  if (report.failed.length) process.exitCode = 1;
}

const args = process.argv.slice(2);
if (args[0] === '--worker')
  worker(Number(args[1]), args[2] === 'on', args[3] === undefined ? undefined : args[3] === 'on');
else await main(args);
