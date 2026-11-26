import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compileAirside } from '../src/network/airside';
import { openProject } from '../src/project/open';

// TASK-321: an abstract airside simulator that tests railway-style block signalling and dynamic
// one-way taxi flows before any change to the CityFlows engine. The taxi network is collapsed to
// blocks (junctions, and junction-to-junction segments cut into blocks of about 150 m); aircraft
// are tokens that hold one block each and move in fixed 5 s steps along a route (runway exit to
// stand, stand to the departure runway's line-up). Four policies:
//   A  claim only the block ahead, first come (today's style);
//   B  block signalling: never enter a junction unless the block beyond it is free (the overlap),
//      and enter a segment only with a direction lock on every segment from there through to the
//      next safe place to stop (a stand, the line-up, a runway exit taxiway);
//   C  B with soft one-way flows chosen per runway configuration: each segment prefers the
//      direction most of that configuration's routes take, a wrong-way move costs three times its
//      length in routing (allowed when no alternative exists, counted), and a segment taken in
//      its preferred direction is a safe place;
//   D  C with a loop-capacity rule: refuse any move that would close a circular wait (the
//      dynamic form of "never fill a cycle of blocks"); AD is A with that rule alone.
// In B, C and D a block freed during a step goes to the longest waiter, and a pushback does not
// cut in ahead of a following aircraft. Gridlocks are circular waits among aircraft that cannot
// move (strongly connected components of the wait-for graph), checked every simulated minute.
//   node --experimental-strip-types --import ./bench/register.ts bench/block-signalling.ts \
//     pilots OUTDIR [--levels 30,60,90] [--hours 3] [--seeds 1,2,3] [--policies A,AD,B,C,D]
//   node --experimental-strip-types --import ./bench/register.ts bench/block-signalling.ts \
//     airport PROJECT OUTDIR --configs westerly:27L:27R,easterly:09L:09R [--levels 60,80,95]
//     [--figure-level 80] [--block 150]
// It prints one table per configuration and writes OUTDIR/*-results.json and one SVG per
// configuration (every policy at the figure level, seed 1). BS_DEBUG=1 lists aircraft stuck at
// the end; BS_CHAIN=1 follows the first one's chain of blockers.

type Vec = { x: number; y: number };
/** `AD`: A with D's loop rule alone, a control for whether the rule needs B's signalling. */
type Policy = 'A' | 'B' | 'C' | 'D' | 'AD';

/** The subset of the compiled `AirsideGraph` the bench reads; the pilots build the same shape. */
interface Layout {
  name: string;
  nodes: { pos: Vec }[];
  edges: { from: number; to: number; kind: string; line: Vec[]; lengthM: number }[];
  runways: {
    ref: string;
    ends: { designator: string; stationM: number }[];
    nodes: number[];
    stationsM: number[];
    line: Vec[];
  }[];
  stands: { root: number; pos: Vec }[];
}

interface Config {
  id: string;
  arrival: string;
  departure: string;
  /** Layout nodes used as runway exits; by default the runway's nodes 1.4 to 2.8 km in. */
  exits?: number[];
}

const P = {
  dtS: 5,
  speedMps: 8,
  blockM: 150,
  clusterM: 35,
  runwayJunctionSteps: 4,
  pushS: 60,
  arrSepS: 80,
  depSepS: 75,
  landBusyS: 50,
  takeoffBusyS: 40,
  landingLookS: 30,
  goAroundS: 600,
  wrongCost: 3,
  junctionCostM: 20,
  exitMinM: 1400,
  exitMaxM: 2800,
  stuckS: 900,
};

// ---------- geometry ----------

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
function cumulative(line: Vec[]) {
  const c = [0];
  for (let i = 1; i < line.length; i++) c.push(c[i - 1]! + dist(line[i - 1]!, line[i]!));
  return c;
}
function pointAt(line: Vec[], cum: number[], s: number): Vec {
  for (let i = 1; i < line.length; i++) {
    if (cum[i]! >= s || i === line.length - 1) {
      const span = cum[i]! - cum[i - 1]! || 1;
      const f = Math.max(0, Math.min(1, (s - cum[i - 1]!) / span));
      const a = line[i - 1]!;
      const b = line[i]!;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return line[0]!;
}
function subLine(line: Vec[], cum: number[], s0: number, s1: number) {
  const out = [pointAt(line, cum, s0)];
  for (let i = 1; i < line.length - 1; i++) if (cum[i]! > s0 && cum[i]! < s1) out.push(line[i]!);
  out.push(pointAt(line, cum, s1));
  return out;
}

// ---------- block network ----------

type Place = { j: number } | { seg: number; k: number };
interface Junction {
  pos: Vec;
  runway: number;
  block: number;
  arcs: { seg: number; dir: 1 | -1; to: number }[];
}
interface Seg {
  a: number;
  b: number;
  line: Vec[];
  cum: number[];
  len: number;
  blocks: number[];
}
interface Block {
  kind: 'j' | 's' | 'stand';
  seg: number;
  junction: number;
  steps: number;
  s0: number;
  s1: number;
  pos: Vec;
}
interface Net {
  name: string;
  junctions: Junction[];
  segs: Seg[];
  blocks: Block[];
  stands: { block: number; pos: Vec; attach: Place }[];
  runways: {
    ref: string;
    line: Vec[];
    ends: { designator: string; stationM: number }[];
    nodes: { junction: number; stationM: number }[];
  }[];
  nodeJunction: Int32Array;
}

function buildNet(layout: Layout): Net {
  const n = layout.nodes.length;
  const inc: number[][] = layout.nodes.map(() => []);
  const runwayOf = new Int32Array(n).fill(-1);
  layout.runways.forEach((r, ri) => r.nodes.forEach((v) => (runwayOf[v] = ri)));
  layout.edges.forEach((e, ei) => {
    if (e.kind === 'runway' || e.kind === 'lead_in' || e.from === e.to) return;
    inc[e.from]!.push(ei);
    inc[e.to]!.push(ei);
  });
  const isJ = (v: number) => inc[v]!.length > 0 && (inc[v]!.length !== 2 || runwayOf[v]! >= 0);

  // Chains of taxi edges between junction nodes.
  const chains: { a: number; b: number; nodes: number[]; stations: number[]; line: Vec[] }[] = [];
  const used = new Uint8Array(layout.edges.length);
  for (let v = 0; v < n; v++) {
    if (!isJ(v)) continue;
    for (const first of inc[v]!) {
      if (used[first]) continue;
      let cur = v;
      let e = first;
      const nodes = [v];
      const stations = [0];
      const line: Vec[] = [layout.nodes[v]!.pos];
      let station = 0;
      let ok = true;
      for (;;) {
        used[e] = 1;
        const E = layout.edges[e]!;
        const fwd = E.from === cur;
        const pts = fwd ? E.line : [...E.line].reverse();
        for (let i = 1; i < pts.length; i++) {
          station += dist(line[line.length - 1]!, pts[i]!);
          line.push(pts[i]!);
        }
        cur = fwd ? E.to : E.from;
        nodes.push(cur);
        stations.push(station);
        if (isJ(cur)) break;
        const next = inc[cur]!.find((x) => x !== e && !used[x]);
        if (next === undefined) {
          ok = false;
          break;
        }
        e = next;
      }
      if (ok) chains.push({ a: v, b: cur, nodes, stations, line });
    }
  }

  // Junction nodes closer than `clusterM` (off the runways) act as one junction.
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (v: number): number => (parent[v] === v ? v : (parent[v] = find(parent[v]!)));
  for (const c of chains) {
    const len = c.stations[c.stations.length - 1]!;
    if (len < P.clusterM && c.a !== c.b && runwayOf[c.a]! < 0 && runwayOf[c.b]! < 0)
      parent[find(c.a)] = find(c.b);
  }
  const nodeJunction = new Int32Array(n).fill(-1);
  const junctions: Junction[] = [];
  const blocks: Block[] = [];
  const members = new Map<number, number[]>();
  for (let v = 0; v < n; v++) {
    if (!isJ(v)) continue;
    const r = find(v);
    if (!members.has(r)) members.set(r, []);
    members.get(r)!.push(v);
  }
  for (const list of members.values()) {
    const pos = {
      x: list.reduce((s, v) => s + layout.nodes[v]!.pos.x, 0) / list.length,
      y: list.reduce((s, v) => s + layout.nodes[v]!.pos.y, 0) / list.length,
    };
    const runway = list.map((v) => runwayOf[v]!).find((r) => r >= 0) ?? -1;
    const j = junctions.length;
    for (const v of list) nodeJunction[v] = j;
    junctions.push({ pos, runway, block: blocks.length, arcs: [] });
    blocks.push({
      kind: 'j',
      seg: -1,
      junction: j,
      steps: runway >= 0 ? P.runwayJunctionSteps : 1,
      s0: 0,
      s1: 0,
      pos,
    });
  }

  const segs: Seg[] = [];
  const nodeSeg = new Map<number, { seg: number; station: number }>();
  for (const c of chains) {
    const ja = nodeJunction[c.a]!;
    const jb = nodeJunction[c.b]!;
    const len = c.stations[c.stations.length - 1]!;
    if (ja === jb && len < 2 * P.clusterM) {
      for (const v of c.nodes) if (nodeJunction[v]! < 0) nodeJunction[v] = ja;
      continue;
    }
    const s = segs.length;
    const nb = Math.max(1, Math.round(len / P.blockM));
    const seg: Seg = { a: ja, b: jb, line: c.line, cum: cumulative(c.line), len, blocks: [] };
    for (let k = 0; k < nb; k++) {
      const s0 = (k * len) / nb;
      const s1 = ((k + 1) * len) / nb;
      seg.blocks.push(blocks.length);
      blocks.push({
        kind: 's',
        seg: s,
        junction: -1,
        steps: Math.max(1, Math.ceil((s1 - s0) / P.speedMps / P.dtS)),
        s0,
        s1,
        pos: pointAt(seg.line, seg.cum, (s0 + s1) / 2),
      });
    }
    segs.push(seg);
    junctions[ja]!.arcs.push({ seg: s, dir: 1, to: jb });
    junctions[jb]!.arcs.push({ seg: s, dir: -1, to: ja });
    c.nodes.forEach((v, i) => {
      if (i > 0 && i < c.nodes.length - 1) nodeSeg.set(v, { seg: s, station: c.stations[i]! });
    });
  }

  const stands: Net['stands'] = [];
  for (const st of layout.stands) {
    let attach: Place | null = null;
    if (nodeJunction[st.root]! >= 0) attach = { j: nodeJunction[st.root]! };
    else {
      const at = nodeSeg.get(st.root);
      if (at) {
        const seg = segs[at.seg]!;
        const nb = seg.blocks.length;
        attach = { seg: at.seg, k: Math.min(nb - 1, Math.floor((at.station / seg.len) * nb)) };
      }
    }
    if (!attach) continue;
    stands.push({ block: blocks.length, pos: st.pos, attach });
    blocks.push({ kind: 'stand', seg: -1, junction: -1, steps: 0, s0: 0, s1: 0, pos: st.pos });
  }

  const runways = layout.runways.map((r) => ({
    ref: r.ref,
    line: r.line,
    ends: r.ends,
    nodes: r.nodes.flatMap((v, i) =>
      nodeJunction[v]! >= 0 && inc[v]!.length > 0
        ? [{ junction: nodeJunction[v]!, stationM: r.stationsM[i]! }]
        : [],
    ),
  }));
  return { name: layout.name, junctions, segs, blocks, stands, runways, nodeJunction };
}

// ---------- routing ----------

interface Route {
  blocks: number[];
  dirs: number[];
  cost: number;
}

function heapPush(h: [number, number][], item: [number, number]) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p]![0] <= h[i]![0]) break;
    [h[p], h[i]] = [h[i]!, h[p]!];
    i = p;
  }
}
function heapPop(h: [number, number][]) {
  const top = h[0]!;
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l]![0] < h[m]![0]) m = l;
      if (r < h.length && h[r]![0] < h[m]![0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i]!, h[m]!];
      i = m;
    }
  }
  return top;
}

/** A routing cost factor per segment and direction. */
type Weight = (seg: number, dir: number) => number;
const prefWeight =
  (pref: Int8Array): Weight =>
  (s, d) =>
    pref[s] === -d ? P.wrongCost : 1;

function findRoute(net: Net, from: Place, to: Place, w: Weight): Route | null {
  const J = net.junctions.length;
  const best = new Float64Array(J).fill(Infinity);
  const prevJ = new Int32Array(J).fill(-1);
  const prevSeg = new Int32Array(J).fill(-1);
  const prevDir = new Int8Array(J);
  const heap: [number, number][] = [];
  const relax = (j: number, d: number, pj: number, ps: number, pd: number) => {
    if (d >= best[j]!) return;
    best[j] = d;
    prevJ[j] = pj;
    prevSeg[j] = ps;
    prevDir[j] = pd;
    heapPush(heap, [d, j]);
  };
  // prevSeg -2: reached from the start segment (prevDir its direction); -3: the start junction.
  if ('j' in from) relax(from.j, 0, -1, -3, 0);
  else {
    const s = net.segs[from.seg]!;
    const nb = s.blocks.length;
    relax(s.a, ((from.k + 0.5) / nb) * s.len * w(from.seg, -1), -1, -2, -1);
    relax(s.b, ((nb - from.k - 0.5) / nb) * s.len * w(from.seg, 1), -1, -2, 1);
  }
  while (heap.length) {
    const [d, v] = heapPop(heap);
    if (d > best[v]!) continue;
    for (const arc of net.junctions[v]!.arcs)
      relax(
        arc.to,
        d + P.junctionCostM + net.segs[arc.seg]!.len * w(arc.seg, arc.dir),
        v,
        arc.seg,
        arc.dir,
      );
  }
  let total: number;
  let endJ: number;
  let endDir = 0;
  let direct = false;
  if ('j' in to) {
    total = best[to.j]!;
    endJ = to.j;
  } else {
    const s = net.segs[to.seg]!;
    const nb = s.blocks.length;
    const viaA = best[s.a]! + ((to.k + 0.5) / nb) * s.len * w(to.seg, 1);
    const viaB = best[s.b]! + ((nb - to.k - 0.5) / nb) * s.len * w(to.seg, -1);
    [total, endJ, endDir] = viaA <= viaB ? [viaA, s.a, 1] : [viaB, s.b, -1];
    if (!('j' in from) && from.seg === to.seg) {
      const d = Math.sign(to.k - from.k) || 1;
      const c = (Math.abs(to.k - from.k) / nb) * s.len * w(to.seg, d);
      if (c <= total) [total, direct, endDir] = [c, true, d];
    }
  }
  if (!Number.isFinite(total)) return null;
  const out: number[] = [];
  const dirs: number[] = [];
  const pushJ = (j: number) => {
    out.push(net.junctions[j]!.block);
    dirs.push(0);
  };
  const pushSeg = (s: number, d: number, k0: number, k1: number) => {
    const bl = net.segs[s]!.blocks;
    for (let k = k0; d > 0 ? k <= k1 : k >= k1; k += d) {
      out.push(bl[k]!);
      dirs.push(d);
    }
  };
  if (direct && !('j' in from) && !('j' in to)) {
    pushSeg(from.seg, endDir, from.k, to.k);
    return { blocks: out, dirs, cost: total };
  }
  const hops: { seg: number; dir: number; to: number }[] = [];
  let v = endJ;
  while (prevSeg[v]! >= 0) {
    hops.push({ seg: prevSeg[v]!, dir: prevDir[v]!, to: v });
    v = prevJ[v]!;
  }
  hops.reverse();
  if ('j' in from) pushJ(from.j);
  else {
    const d = prevDir[v]!;
    pushSeg(from.seg, d, from.k, d > 0 ? net.segs[from.seg]!.blocks.length - 1 : 0);
    pushJ(v);
  }
  for (const h of hops) {
    const nb = net.segs[h.seg]!.blocks.length;
    pushSeg(h.seg, h.dir, h.dir > 0 ? 0 : nb - 1, h.dir > 0 ? nb - 1 : 0);
    pushJ(h.to);
  }
  if (!('j' in to)) {
    const nb = net.segs[to.seg]!.blocks.length;
    pushSeg(to.seg, endDir, endDir > 0 ? 0 : nb - 1, to.k);
  }
  return { blocks: out, dirs, cost: total };
}

// ---------- runway configuration ----------

interface Ops {
  config: Config;
  arrRunway: number;
  depRunway: number;
  exits: number[];
  lineup: number;
  exitDir: Int8Array;
  stands: number[];
}

function resolveOps(net: Net, cfg: Config): Ops {
  const endOf = (designator: string) => {
    for (let r = 0; r < net.runways.length; r++) {
      const end = net.runways[r]!.ends.find((e) => e.designator === designator);
      if (end) return { r, station: end.stationM };
    }
    throw new Error(`No runway end ${designator} in ${net.name}`);
  };
  const arr = endOf(cfg.arrival);
  const dep = endOf(cfg.departure);
  const arrNodes = net.runways[arr.r]!.nodes;
  let exits = cfg.exits
    ? cfg.exits.map((v) => net.nodeJunction[v]!)
    : arrNodes
        .filter((x) => {
          const d = Math.abs(x.stationM - arr.station);
          return d >= P.exitMinM && d <= P.exitMaxM;
        })
        .map((x) => x.junction);
  if (!exits.length)
    exits = [...arrNodes]
      .sort(
        (a, b) =>
          Math.abs(Math.abs(a.stationM - arr.station) - 2000) -
          Math.abs(Math.abs(b.stationM - arr.station) - 2000),
      )
      .slice(0, 2)
      .map((x) => x.junction);
  exits = [...new Set(exits)];
  const lineup = [...net.runways[dep.r]!.nodes].sort(
    (a, b) => Math.abs(a.stationM - dep.station) - Math.abs(b.stationM - dep.station),
  )[0]!.junction;
  const exitDir = new Int8Array(net.segs.length);
  for (const j of exits) for (const arc of net.junctions[j]!.arcs) exitDir[arc.seg] = arc.dir;
  const zero: Weight = () => 1;
  const ops: Ops = {
    config: cfg,
    arrRunway: arr.r,
    depRunway: dep.r,
    exits,
    lineup,
    exitDir,
    stands: [],
  };
  ops.stands = net.stands.flatMap((st, i) =>
    arrivalRoute(net, ops, i, zero) && findRoute(net, st.attach, { j: lineup }, zero) ? [i] : [],
  );
  return ops;
}

/** The arrival route from the best exit to a stand, without the exit junction itself. */
function arrivalRoute(net: Net, ops: Ops, stand: number, w: Weight) {
  let best: Route | null = null;
  for (const j of ops.exits) {
    const r = findRoute(net, { j }, net.stands[stand]!.attach, w);
    if (r && (!best || r.cost < best.cost)) best = r;
  }
  if (!best) return null;
  return {
    blocks: [...best.blocks.slice(1), net.stands[stand]!.block],
    dirs: [...best.dirs.slice(1), 0],
    cost: best.cost,
  };
}
function departureRoute(net: Net, ops: Ops, stand: number, w: Weight) {
  const r = findRoute(net, net.stands[stand]!.attach, { j: ops.lineup }, w);
  if (!r) return null;
  return { blocks: [net.stands[stand]!.block, ...r.blocks], dirs: [0, ...r.dirs], cost: r.cost };
}

/** Policy C's one-way preferences for a configuration. Every stand's arrival and departure is
 * routed in turn, each seeing the flows assigned so far: a segment costs more in the direction
 * against the flow it already carries (up to `1 + opposeCost` times its length), so opposing
 * flows spread to parallel taxiways where one exists. After a few passes (each route re-routed
 * against the others) every segment prefers the direction most of its flow takes. */
function orient(net: Net, ops: Ops, opposeCost = 2, passes = 4) {
  const S = net.segs.length;
  const fp = new Float64Array(S);
  const fm = new Float64Array(S);
  const w: Weight = (s, d) => {
    const same = d > 0 ? fp[s]! : fm[s]!;
    const opp = d > 0 ? fm[s]! : fp[s]!;
    return 1 + (opposeCost * opp) / (opp + same + 1);
  };
  type Od = { stand: number; arr: boolean; runs: [number, number][] };
  const ods: Od[] = ops.stands.flatMap((stand) => [
    { stand, arr: true, runs: [] },
    { stand, arr: false, runs: [] },
  ]);
  const runsOf = (r: Route | null) => {
    const out: [number, number][] = [];
    if (!r) return out;
    r.blocks.forEach((b, i) => {
      const s = net.blocks[b]!.seg;
      if (s >= 0 && out[out.length - 1]?.[0] !== s) out.push([s, r.dirs[i]!]);
    });
    return out;
  };
  const add = (runs: [number, number][], k: number) => {
    for (const [s, d] of runs) (d > 0 ? fp : fm)[s] += k;
  };
  for (let pass = 0; pass < passes; pass++)
    for (const od of ods) {
      add(od.runs, -1);
      od.runs = runsOf(
        od.arr ? arrivalRoute(net, ops, od.stand, w) : departureRoute(net, ops, od.stand, w),
      );
      add(od.runs, 1);
    }
  const pref = new Int8Array(S);
  for (let s = 0; s < S; s++) pref[s] = fp[s]! > fm[s]! ? 1 : fm[s]! > fp[s]! ? -1 : 0;
  return pref;
}

// ---------- simulation ----------

interface Aircraft {
  id: number;
  kind: 'arr' | 'dep';
  blocks: number[];
  dirs: number[];
  pos: number;
  remain: number;
  startT: number;
  freeS: number;
  waitSince: number;
  failed: boolean;
  locks: Set<number>;
  stand: number;
  deadlocked: boolean;
}

interface Snap {
  t: number;
  state: Int8Array;
}

interface RunOptions {
  levelPerH: number;
  hours: number;
  seed: number;
  turnMin: number;
  turnMax: number;
  parkedShare: number;
  snapEveryS: number;
}

interface Metrics {
  completed: number;
  perHour: number;
  arrivals: number;
  departures: number;
  goArounds: number;
  gridlocks: number;
  firstGridlockMin: number | null;
  deadlockedEnd: number;
  stuckEnd: number;
  /** Of `stuckEnd`, departures still on stand (held there, out of everyone's way). */
  stuckAtStandEnd: number;
  meanStandHoldS: number;
  /** Segments locked per clearance (B, C, D). */
  meanClearanceSegs: number;
  meanTaxiArrS: number;
  meanTaxiDepS: number;
  meanWaitS: number;
  wrongWay: number;
  wrongWayShare: number;
  dRefusals: number;
  noStandHolds: number;
  wallMs: number;
}

/** Block states in a snapshot. */
const ST = { free: 0, moving: 1, waiting: 2, deadlocked: 3, reserved: 4, parked: 5 } as const;

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(net: Net, ops: Ops, prefIn: Int8Array, policy: Policy, o: RunOptions) {
  const wall0 = performance.now();
  const pref = policy === 'C' || policy === 'D' ? prefIn : new Int8Array(net.segs.length);
  const routeWeight = prefWeight(pref);
  const rand = rng(o.seed * 7919 + 13);
  const endS = o.hours * 3600;
  const PARKED = -2;
  const holder = new Int32Array(net.blocks.length).fill(-1);
  const lockDir = new Int8Array(net.segs.length);
  const users: Set<number>[] = net.segs.map(() => new Set());
  const departableAt = new Float64Array(net.stands.length).fill(Infinity);
  const active = new Map<number, Aircraft>();
  const runwayBlocks = net.runways.map((_, r) =>
    net.junctions.flatMap((j) => (j.runway === r ? [j.block] : [])),
  );
  const busy = net.runways.map(() => -Infinity);
  let lastLand = -Infinity;
  let lastDep = -Infinity;
  let nextId = 0;
  const m = {
    arrivals: 0,
    departures: 0,
    goArounds: 0,
    gridlocks: 0,
    firstGridlockS: null as number | null,
    wrongWay: 0,
    runs: 0,
    dRefusals: 0,
    noStandHolds: 0,
    taxiArr: [] as number[],
    standHold: [] as number[],
    clearances: 0,
    clearanceSegs: 0,
    taxiDep: [] as number[],
    waits: [] as number[],
  };
  const snaps: Snap[] = [];

  // Demand: Poisson arrivals and departure calls at half the level each; a share of the stands
  // starts with an aircraft ready to leave.
  const poisson = (ratePerH: number) => {
    const out: number[] = [];
    for (let t = 0; ;) {
      t += (-Math.log(1 - rand()) / ratePerH) * 3600;
      if (t >= endS) return out;
      out.push(t);
    }
  };
  const arrQ = poisson(o.levelPerH / 2);
  const depCalls = poisson(o.levelPerH / 2);
  const shuffled = [...ops.stands].sort(() => rand() - 0.5);
  for (const st of shuffled.slice(0, Math.round(shuffled.length * o.parkedShare))) {
    holder[net.stands[st]!.block] = PARKED;
    departableAt[st] = 0;
  }

  let t = 0;
  // Crossings close shortly before a landing, but only one that can land (a free stand waits).
  // An aircraft that has waited a minute at a crossing of the arrival runway gets a gap: no
  // landing for the next minute (at most one gap every three minutes).
  let landingSoon = false;
  let gapWanted = false;
  let gapUntil = -Infinity;
  const crossable = (r: number) => {
    if (t < busy[r]!) return false;
    return r !== ops.arrRunway || !landingSoon;
  };
  const runwayHeld = (r: number, except: number) =>
    runwayBlocks[r]!.some((b) => holder[b]! >= 0 && holder[b] !== except);
  const runwayHolders = (r: number, except: number) =>
    runwayBlocks[r]!.flatMap((b) => (holder[b]! >= 0 && holder[b] !== except ? [holder[b]!] : []));

  const isSafe = (s: number, d: number) =>
    ops.exitDir[s] === d || ((policy === 'C' || policy === 'D') && pref[s] === d);
  const chainFrom = (x: Aircraft, q: number) => {
    const out: [number, number][] = [];
    let i = q;
    const n = x.blocks.length;
    while (i < n) {
      const b = net.blocks[x.blocks[i]!]!;
      if (b.kind === 'stand') break;
      if (b.kind === 'j') {
        i++;
        continue;
      }
      const s = b.seg;
      const d = x.dirs[i]!;
      if (!x.locks.has(s)) out.push([s, d]);
      while (i < n && net.blocks[x.blocks[i]!]!.seg === s) i++;
      // A segment end is a safe place to wait unless the route goes on the wrong way: an
      // aircraft waiting there could face one coming the preferred way, so the wrong-way stretch
      // is cleared together with the segment before it.
      let next = i;
      while (next < n && net.blocks[x.blocks[next]!]!.kind === 'j') next++;
      const nb = next < n ? net.blocks[x.blocks[next]!]! : null;
      const wrongNext = nb !== null && nb.kind === 's' && pref[nb.seg] === -x.dirs[next]!;
      if (isSafe(s, d) && !wrongNext) break;
    }
    return out;
  };

  interface Plan {
    ok: boolean;
    blockers: number[];
    reserve: number;
    chain: [number, number][];
  }
  // Blocks that aircraft waiting longer want next, rebuilt every step (B, C, D): nobody else
  // takes one, so a block freed during a step goes to the longest waiter (first come), and a
  // pushback does not cut in, as a siding's starter signal stays red for an approaching movement.
  const wants = new Map<number, number>();
  let recording = false;
  const want = (b: number, x: Aircraft, p: number) => {
    if (recording && p === x.pos && !(wants.get(b)! <= x.waitSince)) wants.set(b, x.waitSince);
  };
  const wantedByOlder = (b: number, x: Aircraft) =>
    holder[b] !== x.id && wants.get(b)! < x.waitSince;
  /** Whether `x`, at route position `p`, may move to `p + 1`, and who stops it if not. */
  const check = (x: Aircraft, p: number): Plan => {
    const res: Plan = { ok: false, blockers: [], reserve: -1, chain: [] };
    const v = x.blocks[p + 1]!;
    const hv = holder[v]!;
    const signalled = policy !== 'A' && policy !== 'AD';
    if (hv !== -1 && hv !== x.id) {
      if (hv >= 0) res.blockers.push(hv);
      if (signalled) want(v, x, p);
      return res;
    }
    if (signalled && wantedByOlder(v, x)) return res;
    const bv = net.blocks[v]!;
    if (signalled && bv.kind === 's' && net.blocks[x.blocks[p]!]!.kind === 'stand') {
      // A pushback does not cut in ahead of an aircraft following along the segment, nor take
      // the segment's entry block from one waiting longer to enter it.
      const seg = net.segs[bv.seg]!;
      const k = seg.blocks.indexOf(v);
      const behind = seg.blocks[k - x.dirs[p + 1]!];
      if (behind !== undefined && holder[behind]! >= 0) {
        res.blockers.push(holder[behind]!);
        return res;
      }
    }
    const lineup = x.kind === 'dep' && p + 1 === x.blocks.length - 1;
    if (bv.kind === 'j') {
      const r = net.junctions[bv.junction]!.runway;
      if (r >= 0 && !lineup && !crossable(r)) {
        if (r === ops.arrRunway && p === x.pos && t - x.waitSince >= 60) gapWanted = true;
        return res;
      }
    }
    if (policy !== 'A' && policy !== 'AD') {
      let chainStart = -1;
      if (bv.kind === 'j' && p + 2 < x.blocks.length) {
        const w = x.blocks[p + 2]!;
        const hw = holder[w]!;
        if (hw !== -1 && hw !== x.id) {
          if (hw >= 0) res.blockers.push(hw);
          want(w, x, p);
          return res;
        }
        if (wantedByOlder(w, x)) return res;
        res.reserve = w;
        const bw = net.blocks[w]!;
        if (bw.kind === 's' && !x.locks.has(bw.seg)) chainStart = p + 2;
      } else if (bv.kind === 's' && !x.locks.has(bv.seg)) chainStart = p + 1;
      if (chainStart >= 0) {
        for (const [s, d] of chainFrom(x, chainStart)) {
          if (lockDir[s] !== 0 && lockDir[s] !== d) {
            for (const u of users[s]!) if (u !== x.id) res.blockers.push(u);
          } else res.chain.push([s, d]);
        }
        if (res.blockers.length) {
          res.chain = [];
          return res;
        }
      }
    }
    res.ok = true;
    return res;
  };
  /** The aircraft `y` waits for next, past the blocks it already holds. */
  const needBlockers = (y: Aircraft) => {
    let p = y.pos;
    while (p + 1 < y.blocks.length && holder[y.blocks[p + 1]!] === y.id) p++;
    if (p === y.blocks.length - 1)
      return y.kind === 'dep' ? runwayHolders(ops.depRunway, y.id) : [];
    return check(y, p).blockers;
  };
  const acquire = (x: Aircraft, s: number, d: number) => {
    lockDir[s] = d;
    users[s]!.add(x.id);
    x.locks.add(s);
  };
  const release = (x: Aircraft, s: number) => {
    if (!x.locks.delete(s)) return;
    users[s]!.delete(x.id);
    if (!users[s]!.size) lockDir[s] = 0;
  };
  /** Policy D: would this move close a circular wait? Applied tentatively and undone. */
  const closesCycle = (x: Aircraft, plan: Plan) => {
    const cur = x.blocks[x.pos]!;
    const v = x.blocks[x.pos + 1]!;
    const saved = [
      [cur, holder[cur]!],
      [v, holder[v]!],
    ];
    if (plan.reserve >= 0) saved.push([plan.reserve, holder[plan.reserve]!]);
    holder[cur] = -1;
    holder[v] = x.id;
    if (plan.reserve >= 0) holder[plan.reserve] = x.id;
    const lockSaved = plan.chain.map(([s]) => [s, lockDir[s]!, users[s]!.has(x.id) ? 1 : 0]);
    for (const [s, d] of plan.chain) {
      lockDir[s] = d;
      users[s]!.add(x.id);
    }
    x.pos++;
    const seen = new Set<number>();
    const stack = needBlockers(x);
    let cycle = false;
    while (stack.length && seen.size < 400) {
      const y = stack.pop()!;
      if (y === x.id) {
        cycle = true;
        break;
      }
      if (seen.has(y)) continue;
      seen.add(y);
      const ay = active.get(y);
      if (ay) stack.push(...needBlockers(ay));
    }
    x.pos--;
    for (const [s, dir, had] of lockSaved) {
      lockDir[s!] = dir!;
      if (!had) users[s!]!.delete(x.id);
    }
    for (let i = saved.length - 1; i >= 0; i--) holder[saved[i]![0]!] = saved[i]![1]!;
    return cycle;
  };
  const finish = (x: Aircraft) => {
    for (const s of [...x.locks]) release(x, s);
    const taxi = t - x.startT;
    (x.kind === 'arr' ? m.taxiArr : m.taxiDep).push(taxi);
    m.waits.push(Math.max(0, taxi - x.freeS));
    active.delete(x.id);
  };
  const apply = (x: Aircraft, plan: Plan) => {
    const cur = x.blocks[x.pos]!;
    const v = x.blocks[x.pos + 1]!;
    if (holder[cur] === x.id) holder[cur] = -1;
    const curSeg = net.blocks[cur]!.seg;
    const vSeg = net.blocks[v]!.seg;
    if (curSeg >= 0 && curSeg !== vSeg) release(x, curSeg);
    holder[v] = x.id;
    if (plan.reserve >= 0) holder[plan.reserve] = x.id;
    for (const [s, d] of plan.chain) acquire(x, s, d);
    if (plan.chain.length) {
      m.clearances++;
      m.clearanceSegs += plan.chain.length;
    }
    if (vSeg >= 0 && vSeg !== curSeg) {
      m.runs++;
      if (pref[vSeg] === -x.dirs[x.pos + 1]!) m.wrongWay++;
    }
    const pushback = net.blocks[cur]!.kind === 'stand';
    if (pushback) m.standHold.push(t - x.startT);
    x.pos++;
    x.remain = net.blocks[v]!.steps + (pushback ? Math.ceil(P.pushS / P.dtS) : 0);
    x.failed = false;
  };
  const freeTime = (blocks: number[], from: number, push: boolean) =>
    blocks.slice(from).reduce((s, b) => s + net.blocks[b]!.steps * P.dtS, 0) + (push ? P.pushS : 0);

  const snapshot = () => {
    const state = new Int8Array(net.blocks.length);
    for (let b = 0; b < net.blocks.length; b++) {
      const h = holder[b]!;
      if (h === PARKED) state[b] = ST.parked;
      else if (h >= 0) {
        const x = active.get(h)!;
        if (x.blocks[x.pos] !== b) state[b] = ST.reserved;
        else if (x.deadlocked) state[b] = ST.deadlocked;
        else if (x.failed && t - x.waitSince >= 30) state[b] = ST.waiting;
        else state[b] = ST.moving;
      }
    }
    snaps.push({ t, state });
  };

  /** Circular waits among aircraft that cannot move (Tarjan's strongly connected components). */
  const detectGridlock = () => {
    const waiting = [...active.values()].filter((x) => x.remain === 0 && x.failed);
    const ids = new Set(waiting.map((x) => x.id));
    const adj = new Map<number, number[]>();
    for (const x of waiting)
      adj.set(
        x.id,
        [...new Set(needBlockers(x))].filter((y) => ids.has(y)),
      );
    let index = 0;
    const idx = new Map<number, number>();
    const low = new Map<number, number>();
    const onStack = new Set<number>();
    const stack: number[] = [];
    const strong = (v: number) => {
      idx.set(v, index);
      low.set(v, index++);
      stack.push(v);
      onStack.add(v);
      for (const w of adj.get(v)!) {
        if (!idx.has(w)) {
          strong(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
      if (low.get(v) === idx.get(v)) {
        const comp: number[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        if (comp.length > 1) {
          const fresh = comp.every((id) => !active.get(id)!.deadlocked);
          for (const id of comp) active.get(id)!.deadlocked = true;
          if (fresh) {
            m.gridlocks++;
            m.firstGridlockS ??= t;
          }
        }
      }
    };
    for (const x of waiting) if (!idx.has(x.id)) strong(x.id);
  };

  const advance = (x: Aircraft) => {
    if (x.pos === x.blocks.length - 1) {
      if (x.kind === 'arr') {
        holder[x.blocks[x.pos]!] = PARKED;
        departableAt[x.stand] = t + (o.turnMin + rand() * (o.turnMax - o.turnMin)) * 60;
        finish(x);
      } else if (
        t >= lastDep + P.depSepS &&
        t >= busy[ops.depRunway]! &&
        !runwayHeld(ops.depRunway, x.id)
      ) {
        holder[x.blocks[x.pos]!] = -1;
        busy[ops.depRunway] = t + P.takeoffBusyS;
        lastDep = t;
        finish(x);
      } else x.failed = true;
      return;
    }
    const plan = check(x, x.pos);
    if (!plan.ok) {
      x.failed = true;
      return;
    }
    if ((policy === 'D' || policy === 'AD') && closesCycle(x, plan)) {
      m.dRefusals++;
      x.failed = true;
      return;
    }
    apply(x, plan);
  };

  const stepsPerMin = Math.round(60 / P.dtS);
  for (let step = 0; t < endS; step++, t = step * P.dtS) {
    // Landings, one runway slot at a time.
    if (gapWanted && t >= gapUntil + 120) gapUntil = t + 60;
    gapWanted = false;
    landingSoon =
      t >= gapUntil &&
      arrQ.length > 0 &&
      Math.max(arrQ[0]!, lastLand + P.arrSepS) <= t + P.landingLookS &&
      ops.stands.some((s) => holder[net.stands[s]!.block] === -1);
    if (
      arrQ.length &&
      arrQ[0]! <= t &&
      t >= lastLand + P.arrSepS &&
      t >= busy[ops.arrRunway]! &&
      t >= gapUntil
    ) {
      const goAround = () => {
        arrQ.shift();
        const again = t + P.goAroundS;
        if (again < endS) {
          const at = arrQ.findIndex((x) => x > again);
          arrQ.splice(at < 0 ? arrQ.length : at, 0, again);
        }
        m.goArounds++;
        lastLand = t;
      };
      const free = ops.stands.filter((s) => holder[net.stands[s]!.block] === -1);
      if (runwayHeld(ops.arrRunway, -1)) goAround();
      else if (!free.length) m.noStandHolds++;
      else {
        const stand = free[Math.floor(rand() * free.length)]!;
        const r = arrivalRoute(net, ops, stand, routeWeight)!;
        const x: Aircraft = {
          id: nextId++,
          kind: 'arr',
          blocks: r.blocks,
          dirs: r.dirs,
          pos: 0,
          remain: net.blocks[r.blocks[0]!]!.steps,
          startT: t,
          freeS: freeTime(r.blocks, 0, false),
          waitSince: t,
          failed: false,
          locks: new Set(),
          stand,
          deadlocked: false,
        };
        const first = r.blocks[0]!;
        let ok = holder[first] === -1;
        const chain =
          ok && policy !== 'A' && policy !== 'AD' && net.blocks[first]!.kind === 's'
            ? chainFrom(x, 0)
            : [];
        if (chain.some(([s, d]) => lockDir[s] !== 0 && lockDir[s] !== d)) ok = false;
        if (!ok) goAround();
        else {
          arrQ.shift();
          holder[first] = x.id;
          holder[net.stands[stand]!.block] = x.id;
          for (const [s, d] of chain) acquire(x, s, d);
          if (net.blocks[first]!.seg >= 0) {
            m.runs++;
            if (pref[net.blocks[first]!.seg] === -r.dirs[0]!) m.wrongWay++;
          }
          active.set(x.id, x);
          m.arrivals++;
          busy[ops.arrRunway] = t + P.landBusyS;
          lastLand = t;
        }
      }
    }
    // Departure calls: an aircraft whose turnaround is done becomes ready at its stand.
    while (depCalls.length && depCalls[0]! <= t) {
      depCalls.shift();
      const ready = ops.stands.filter(
        (s) => holder[net.stands[s]!.block] === PARKED && departableAt[s]! <= t,
      );
      if (!ready.length) continue;
      const stand = ready[Math.floor(rand() * ready.length)]!;
      const r = departureRoute(net, ops, stand, routeWeight)!;
      const x: Aircraft = {
        id: nextId++,
        kind: 'dep',
        blocks: r.blocks,
        dirs: r.dirs,
        pos: 0,
        remain: 0,
        startT: t,
        freeS: freeTime(r.blocks, 1, true),
        waitSince: t,
        failed: true,
        locks: new Set(),
        stand,
        deadlocked: false,
      };
      holder[net.stands[stand]!.block] = x.id;
      departableAt[stand] = Infinity;
      active.set(x.id, x);
      m.departures++;
    }
    // Movement, first come first served; a second pass gives blocks freed during the step to
    // the longest waiters.
    wants.clear();
    const ready: Aircraft[] = [];
    for (const x of active.values()) {
      if (x.remain > 0) {
        x.remain--;
        if (x.remain > 0) continue;
        x.waitSince = t;
      }
      ready.push(x);
    }
    ready.sort((a, b) => a.waitSince - b.waitSince || a.id - b.id);
    for (let pass = 0; pass < 2; pass++)
      for (const x of ready) {
        if (!active.has(x.id) || (pass === 1 && !x.failed) || x.remain > 0) continue;
        recording = true;
        advance(x);
        recording = false;
      }
    if (step % stepsPerMin === 0) detectGridlock();

    if (step % Math.round(o.snapEveryS / P.dtS) === 0) snapshot();
  }
  snapshot();
  if (process.env.BS_DEBUG)
    for (const x of active.values())
      if (x.failed && t - x.waitSince >= P.stuckS) {
        const b = net.blocks[x.blocks[x.pos]!]!;
        const nb = x.pos + 1 < x.blocks.length ? net.blocks[x.blocks[x.pos + 1]!]! : null;
        console.log(
          `stuck ${policy} #${x.id} ${x.kind} pos ${x.pos}/${x.blocks.length - 1} at ${b.kind}${b.seg >= 0 ? ' seg ' + b.seg : b.junction >= 0 ? ' j ' + b.junction : ''} next ${nb ? nb.kind + (nb.seg >= 0 ? ' seg ' + nb.seg + ' lock ' + lockDir[nb.seg] + ' users ' + [...users[nb.seg]!].join('/') : nb.junction >= 0 ? ' j ' + nb.junction + ' holder ' + holder[x.blocks[x.pos + 1]!] : '') : '-'} locks ${[...x.locks].join('/')} dir ${x.dirs[x.pos + 1]} blockers ${needBlockers(x).join('/')} waited ${Math.round((t - x.waitSince) / 60)} min`,
        );
      }

  if (process.env.BS_CHAIN) {
    const firstStuck = [...active.values()].find((x) => x.failed && t - x.waitSince >= P.stuckS);
    let y = firstStuck;
    const seen = new Set<number>();
    while (y && !seen.has(y.id)) {
      seen.add(y.id);
      const b = net.blocks[y.blocks[y.pos]!]!;
      const bl = needBlockers(y);
      const nxt = y.blocks[y.pos + 1];
      const nb = nxt === undefined ? null : net.blocks[nxt]!;
      console.log(
        `chain #${y.id} ${y.kind} pos ${y.pos}/${y.blocks.length - 1} remain ${y.remain} failed ${y.failed} waited ${Math.round((t - y.waitSince) / 60)} min at ${b.kind} ${b.seg}/${b.junction} next ${nb ? nb.kind + ' ' + nb.seg + '/' + nb.junction + ' runway ' + (nb.junction >= 0 ? net.junctions[nb.junction]!.runway : -1) : '-'} blockers ${bl.join('/')}`,
      );
      y = bl.length ? active.get(bl[0]!) : undefined;
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const completed = m.taxiArr.length + m.taxiDep.length;
  const metrics: Metrics = {
    completed,
    perHour: completed / o.hours,
    arrivals: m.arrivals,
    departures: m.departures,
    goArounds: m.goArounds,
    gridlocks: m.gridlocks,
    firstGridlockMin: m.firstGridlockS === null ? null : Math.round(m.firstGridlockS / 60),
    deadlockedEnd: [...active.values()].filter((x) => x.deadlocked).length,
    stuckEnd: [...active.values()].filter((x) => x.failed && t - x.waitSince >= P.stuckS).length,
    stuckAtStandEnd: [...active.values()].filter(
      (x) => x.failed && x.pos === 0 && x.kind === 'dep' && t - x.waitSince >= P.stuckS,
    ).length,
    meanStandHoldS: Math.round(mean(m.standHold)),
    meanClearanceSegs: m.clearances ? Number((m.clearanceSegs / m.clearances).toFixed(1)) : 0,
    meanTaxiArrS: Math.round(mean(m.taxiArr)),
    meanTaxiDepS: Math.round(mean(m.taxiDep)),
    meanWaitS: Math.round(mean(m.waits)),
    wrongWay: m.wrongWay,
    wrongWayShare: m.runs ? m.wrongWay / m.runs : 0,
    dRefusals: m.dRefusals,
    noStandHolds: m.noStandHolds,
    wallMs: Math.round(performance.now() - wall0),
  };
  return { metrics, snaps };
}

// ---------- diagrams ----------

const stateColour = ['#c9c9c9', '#2b7bd6', '#f39c12', '#d62728', '#9ecae1', '#6b6b6b'];

function renderSvg(
  net: Net,
  ops: Ops,
  title: string,
  panels: { title: string; lines: string[]; snap: Snap; pref: Int8Array | null }[],
) {
  // The taxi network sets the frame; runways are clipped to it.
  const pts: Vec[] = [...net.junctions.map((j) => j.pos), ...net.stands.map((s) => s.pos)];
  for (const seg of net.segs) pts.push(...seg.line);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const PW = 640;
  const head = 70;
  const sc = Math.min((PW - 30) / (maxX - minX || 1), 460 / (maxY - minY || 1));
  const PH = Math.round(head + (maxY - minY) * sc + 30);
  const cols = 2;
  const W = PW * cols;
  const H = 40 + PH * Math.ceil(panels.length / cols) + 40;
  const big = net.blocks.length > 800;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<text x="12" y="26" font-size="17" font-weight="600">${title}</text>`,
  ];
  panels.forEach((panel, pi) => {
    const ox = (pi % cols) * PW + 15;
    const oy = 40 + Math.floor(pi / cols) * PH;
    const X = (p: Vec) => (ox + (p.x - minX) * sc).toFixed(1);
    const Y = (p: Vec) => (oy + head + (maxY - p.y) * sc).toFixed(1);
    const path = (line: Vec[]) => line.map((p, i) => `${i ? 'L' : 'M'}${X(p)},${Y(p)}`).join('');
    out.push(
      `<clipPath id="c${pi}"><rect x="${ox - 10}" y="${oy + head - 10}" width="${PW - 10}" height="${PH - head + 2}"/></clipPath>`,
    );
    out.push(
      `<rect x="${ox - 10}" y="${oy}" width="${PW - 10}" height="${PH - 8}" fill="none" stroke="#ddd"/>`,
    );
    out.push(`<g clip-path="url(#c${pi})">`);
    net.runways.forEach((r, ri) => {
      const active = ri === ops.arrRunway || ri === ops.depRunway;
      out.push(
        `<path d="${path(r.line)}" stroke="${active ? '#333' : '#999'}" stroke-width="${big ? 4 : 7}" fill="none"/>`,
      );
    });
    const st = panel.snap.state;
    for (const seg of net.segs)
      for (const b of seg.blocks) {
        const s = st[b]!;
        const blk = net.blocks[b]!;
        out.push(
          `<path d="${path(subLine(seg.line, seg.cum, blk.s0, blk.s1))}" stroke="${stateColour[s]}" stroke-width="${s ? (big ? 3 : 5) : big ? 1 : 2}" fill="none"/>`,
        );
      }
    if (panel.pref)
      net.segs.forEach((seg, s) => {
        const d = panel.pref![s]!;
        if (!d || seg.len < (big ? 120 : 60)) return;
        const a = pointAt(seg.line, seg.cum, seg.len / 2 - 4 * d);
        const b = pointAt(seg.line, seg.cum, seg.len / 2 + 4 * d);
        const ang = Math.atan2(-(b.y - a.y), b.x - a.x);
        const cx = Number(X(pointAt(seg.line, seg.cum, seg.len / 2)));
        const cy = Number(Y(pointAt(seg.line, seg.cum, seg.len / 2)));
        const r = big ? 3.5 : 6;
        const tri = [0, 2.5, -2.5]
          .map((da, i) => {
            const rr = i ? r * 0.8 : r * 1.2;
            return `${(cx + Math.cos(ang + da) * rr).toFixed(1)},${(cy + Math.sin(ang + da) * rr).toFixed(1)}`;
          })
          .join(' ');
        out.push(`<polygon points="${tri}" fill="#7b3fa0" opacity="0.85"/>`);
      });
    net.junctions.forEach((j) => {
      const s = st[j.block]!;
      out.push(
        `<circle cx="${X(j.pos)}" cy="${Y(j.pos)}" r="${s ? (big ? 2.5 : 5) : big ? 0.8 : 2.5}" fill="${s ? stateColour[s] : j.runway >= 0 ? '#555' : '#999'}"/>`,
      );
    });
    net.stands.forEach((sd) => {
      const s = st[sd.block]!;
      const r = big ? 1.6 : 4;
      out.push(
        `<rect x="${(Number(X(sd.pos)) - r).toFixed(1)}" y="${(Number(Y(sd.pos)) - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="${s ? stateColour[s] : '#fff'}" stroke="#888" stroke-width="0.6"/>`,
      );
    });
    out.push(`</g>`);
    out.push(
      `<text x="${ox}" y="${oy + 20}" font-size="15" font-weight="600">${panel.title}</text>`,
    );
    panel.lines.forEach((l, i) =>
      out.push(`<text x="${ox}" y="${oy + 38 + i * 15}" font-size="12" fill="#333">${l}</text>`),
    );
  });
  const legend = [
    ['free block', 0],
    ['aircraft moving', 1],
    ['waiting 30 s+', 2],
    ['in a circular wait', 3],
    ['reserved (overlap)', 4],
    ['parked at stand', 5],
  ] as const;
  legend.forEach(([label, s], i) => {
    const x = 12 + i * 170;
    out.push(
      `<rect x="${x}" y="${H - 28}" width="14" height="14" fill="${stateColour[s]}"/><text x="${x + 20}" y="${H - 16}" font-size="12">${label}</text>`,
    );
  });
  out.push(
    `<polygon points="${12 + 6 * 170},${H - 28} ${12 + 6 * 170 + 14},${H - 21} ${12 + 6 * 170},${H - 14}" fill="#7b3fa0"/><text x="${12 + 6 * 170 + 20}" y="${H - 16}" font-size="12">preferred direction (C, D)</text>`,
  );
  out.push(`</svg>`);
  return out.join('\n');
}

// ---------- synthetic pilots ----------

function builder(name: string) {
  const nodes: { pos: Vec }[] = [];
  const names = new Map<string, number>();
  const edges: Layout['edges'] = [];
  const runways: Layout['runways'] = [];
  const stands: Layout['stands'] = [];
  const node = (id: string, x: number, y: number) => {
    names.set(id, nodes.length);
    nodes.push({ pos: { x, y } });
    return nodes.length - 1;
  };
  const id = (n: string) => {
    const v = names.get(n);
    if (v === undefined) throw new Error(`No node ${n}`);
    return v;
  };
  /** A chain of edges through the named nodes. */
  const path = (kind: string, ...through: string[]) => {
    for (let i = 1; i < through.length; i++) {
      const a = id(through[i - 1]!);
      const b = id(through[i]!);
      const line = [nodes[a]!.pos, nodes[b]!.pos];
      edges.push({ from: a, to: b, kind, line, lengthM: dist(line[0]!, line[1]!) });
    }
  };
  const runway = (ref: string, endA: string, endB: string, ...through: string[]) => {
    path('runway', ...through);
    const ns = through.map(id);
    const line = ns.map((v) => nodes[v]!.pos);
    const st = cumulative(line);
    runways.push({
      ref,
      ends: [
        { designator: endA, stationM: 0 },
        { designator: endB, stationM: st[st.length - 1]! },
      ],
      nodes: ns,
      stationsM: st,
      line,
    });
  };
  const stand = (root: string, x: number, y: number) =>
    stands.push({ root: id(root), pos: { x, y } });
  const layout = (): Layout => ({ name, nodes, edges, runways, stands });
  return { node, id, path, runway, stand, layout };
}

/** Pilot 1: an apron of two parallel lanes with stands, joined at both ends (Zurich's apron
 * lanes). Westerly: arrivals and departures both use the west end, so the lanes carry opposing
 * flows; easterly: arrivals come in from the east and leave west, so the lanes run one way. */
function pilotParallel() {
  const g = builder('Pilot 1: parallel apron lanes');
  g.node('RAw', -1500, 0);
  g.node('RAx1', -300, 0);
  g.node('RAx2', 1100, 0);
  g.node('RAe', 2300, 0);
  g.runway('09R/27L', '09R', '27L', 'RAw', 'RAx1', 'RAx2', 'RAe');
  g.node('W', -300, 550);
  g.node('E', 1100, 550);
  g.path('taxiway', 'RAx1', 'W');
  g.path('taxiway', 'RAx2', 'E');
  for (const [lane, y, sy] of [
    ['N', 650, 720],
    ['S', 450, 380],
  ] as const) {
    g.node(`${lane}w`, -200, y);
    g.node(`${lane}e`, 1000, y);
    const roots: string[] = [];
    for (let x = 0; x <= 900; x += 100) {
      g.node(`${lane}${x}`, x, y);
      g.stand(`${lane}${x}`, x, sy);
      roots.push(`${lane}${x}`);
    }
    g.path('taxilane', 'W', `${lane}w`, ...roots, `${lane}e`, 'E');
  }
  g.node('Tw', -300, 1100);
  g.node('T0', -1500, 1100);
  g.node('T1', 2300, 1100);
  g.node('RDw', -1500, 1200);
  g.node('RDe', 2300, 1200);
  g.path('taxiway', 'W', 'Tw');
  g.path('taxiway', 'RDw', 'T0', 'Tw', 'T1', 'RDe');
  g.runway('09L/27R', '09L', '27R', 'RDw', 'RDe');
  return {
    layout: g.layout(),
    configs: [
      { id: 'westerly', arrival: '27L', departure: '27R' },
      { id: 'easterly', arrival: '09R', departure: '09L' },
    ] as Config[],
  };
}

/** Pilot 2: a small central loop (Heathrow's central area): eight junctions on a 160 m ring,
 * three aprons each joined to the ring by two links with stands, arrivals entering at the south
 * and departures leaving at the south-west. */
function pilotLoop() {
  const g = builder('Pilot 2: central loop');
  const polar = (deg: number, r: number) => [
    r * Math.cos((deg * Math.PI) / 180),
    r * Math.sin((deg * Math.PI) / 180),
  ];
  for (let j = 0; j < 8; j++) {
    const [x, y] = polar(45 * j, 160);
    g.node(`R${j}`, x!, y!);
  }
  for (let j = 0; j < 8; j++) g.path('taxiway', `R${j}`, `R${(j + 1) % 8}`);
  [0, 90, 180].forEach((theta, a) => {
    const [ax, ay] = polar(theta, 540);
    g.node(`A${a}`, ax!, ay!);
    for (const side of [-1, 1]) {
      const ring = `R${(theta / 45 + side + 8) % 8}`;
      const names: string[] = [];
      for (const [k, [da, r]] of (
        [
          [33, 270],
          [24, 360],
          [14, 450],
        ] as const
      ).entries()) {
        const [x, y] = polar(theta + side * da, r);
        const [sx, sy] = polar(theta + side * (da + 6), r + 40);
        const nm = `A${a}${side}${k}`;
        g.node(nm, x!, y!);
        g.stand(nm, sx!, sy!);
        names.push(nm);
      }
      g.path('taxilane', ring, ...names, `A${a}`);
    }
  });
  g.node('RAw', -2000, -900);
  g.node('RAx', -400, -900);
  g.node('RAe', 2000, -900);
  g.runway('09R/27L', '09R', '27L', 'RAw', 'RAx', 'RAe');
  g.node('Xs', 0, -500);
  g.path('taxiway', 'RAx', 'Xs', 'R6');
  g.node('Xw', -600, -500);
  g.node('RDs', -1500, -500);
  g.node('RDn', -1500, 3000);
  g.path('taxiway', 'R5', 'Xw', 'RDs');
  g.runway('18/36', '36', '18', 'RDs', 'RDn');
  return {
    layout: g.layout(),
    configs: [{ id: 'westerly', arrival: '27L', departure: '36' }] as Config[],
  };
}

/** Pilot 3: a runway crossing (Boston): arrivals vacate south and cross the landing runway at
 * two crossings to reach the apron north of it; departures cross it the other way to the
 * departure runway south. */
function pilotCrossing() {
  const g = builder('Pilot 3: runway crossings');
  g.node('RA0', 0, 0);
  g.node('C1', 600, 0);
  g.node('X1', 1300, 0);
  g.node('C2', 1900, 0);
  g.node('RA3', 3000, 0);
  g.runway('09/27', '09', '27', 'RA0', 'C1', 'X1', 'C2', 'RA3');
  g.node('N1', 600, 200);
  g.node('N2', 1900, 200);
  const roots: string[] = [];
  for (let x = 700; x <= 1800; x += 100) {
    g.node(`N${x}`, x, 200);
    g.stand(`N${x}`, x, 280);
    roots.push(`N${x}`);
  }
  g.path('taxilane', 'C1', 'N1', ...roots, 'N2', 'C2');
  g.node('S1', 600, -200);
  g.node('Sx', 1300, -200);
  g.node('S2', 1900, -200);
  g.node('S3', 3000, -200);
  g.path('taxiway', 'C1', 'S1', 'Sx', 'S2', 'S3');
  g.path('taxiway', 'X1', 'Sx');
  g.path('taxiway', 'C2', 'S2');
  g.node('RDw', 0, -500);
  g.node('RDe', 3000, -500);
  g.path('taxiway', 'S3', 'RDe');
  g.runway('09L/27R', '09L', '27R', 'RDw', 'RDe');
  const layout = g.layout();
  return {
    layout,
    configs: [{ id: 'westerly', arrival: '27', departure: '27R', exits: [g.id('X1')] }] as Config[],
  };
}

/** Pilot 4: a loop lined with stands and reached by one two-way access taxiway (a stress case
 * for circulation: every route runs part of the loop, and arrivals and departures share the
 * access). */
function pilotLoopStands() {
  const g = builder('Pilot 4: stand loop, one access');
  const n = 8;
  for (let j = 0; j < n; j++) {
    const a = (2 * Math.PI * j) / n - Math.PI / 2;
    g.node(`R${j}`, 260 * Math.cos(a), 260 * Math.sin(a));
  }
  for (let j = 0; j < n; j++) {
    const a0 = (2 * Math.PI * j) / n - Math.PI / 2;
    const roots: string[] = [];
    for (const f of [0.33, 0.67]) {
      const a = a0 + (f * 2 * Math.PI) / n;
      const nm = `S${j}${f}`;
      g.node(nm, 258 * Math.cos(a), 258 * Math.sin(a));
      g.stand(nm, 330 * Math.cos(a), 330 * Math.sin(a));
      roots.push(nm);
    }
    g.path('taxilane', `R${j}`, ...roots, `R${(j + 1) % n}`);
  }
  g.node('H', 0, -700);
  g.path('taxiway', 'R0', 'H');
  g.node('RAw', -2000, -1000);
  g.node('RAx', -300, -1000);
  g.node('RAe', 2000, -1000);
  g.runway('09R/27L', '09R', '27L', 'RAw', 'RAx', 'RAe');
  g.path('taxiway', 'RAx', 'H');
  g.node('RDw', 1500, -400);
  g.node('RDe', 1500, 3000);
  g.node('Hd', 800, -700);
  g.path('taxiway', 'H', 'Hd', 'RDw');
  g.runway('18/36', '36', '18', 'RDw', 'RDe');
  return {
    layout: g.layout(),
    configs: [{ id: 'westerly', arrival: '27L', departure: '36' }] as Config[],
  };
}

// ---------- runner ----------

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args.splice(at, 2)[1]!;
};
const levels = flag('levels', '').split(',').filter(Boolean).map(Number);
const hours = Number(flag('hours', '3'));
const seeds = flag('seeds', '1,2,3').split(',').map(Number);
const policyList = flag('policies', 'A,B,C,D').split(',') as Policy[];
const figureLevelArg = flag('figure-level', '');
P.blockM = Number(flag('block', String(P.blockM)));
const [mode, ...rest] = args;

interface Case {
  layout: Layout;
  configs: Config[];
  levels: number[];
  turn: [number, number];
}
let cases: Case[];
let outDir: string;
if (mode === 'pilots') {
  outDir = rest[0]!;
  const lv = levels.length ? levels : [30, 60, 90];
  cases = [pilotParallel(), pilotLoop(), pilotCrossing(), pilotLoopStands()].map((c) => ({
    ...c,
    levels: lv,
    turn: [20, 40],
  }));
} else if (mode === 'airport') {
  const [projectPath, dir] = rest;
  outDir = dir!;
  const project = await openProject(readFileSync(projectPath!));
  if (!project.ok) throw new Error(`Cannot open ${projectPath}`);
  const city = project.project.city;
  const graph = compileAirside(city.airport!, city, {
    roads: [],
    lanes: [],
    movements: [],
    index: { road: new Map() },
  } as never);
  const configs = flag('configs', '')
    .split(',')
    .filter(Boolean)
    .map((c) => {
      const [id, arrival, departure] = c.split(':');
      return { id: id!, arrival: arrival!, departure: departure! };
    });
  cases = [
    {
      layout: { ...(graph as unknown as Layout), name: graph.name ?? graph.icao ?? 'airport' },
      configs,
      levels: levels.length ? levels : [60, 80, 95],
      turn: [60, 120],
    },
  ];
} else throw new Error('Expected `pilots OUTDIR` or `airport PROJECT OUTDIR --configs ...`');

mkdirSync(outDir, { recursive: true });
const results: unknown[] = [];
const prefs: Int8Array[] = [];
const fmt = (v: number | null) => (v === null ? '-' : String(v));
for (const c of cases) {
  const t0 = performance.now();
  const net = buildNet(c.layout);
  console.log(
    `\n## ${net.name}: ${net.junctions.length} junctions, ${net.segs.length} segments, ${net.blocks.length - net.stands.length - net.junctions.length} segment blocks, ${net.stands.length} stands (built in ${Math.round(performance.now() - t0)} ms)`,
  );
  for (const cfg of c.configs) {
    const ops = resolveOps(net, cfg);
    const orientT0 = performance.now();
    const pref = orient(net, ops);
    const orientMs = Math.round(performance.now() - orientT0);
    const oriented = [...pref].filter(Boolean).length;
    const first = prefs[0];
    const flipped = first ? pref.filter((d, s) => d !== 0 && first[s] === -d).length : 0;
    const both = first ? pref.filter((d, s) => d !== 0 && first[s] !== 0).length : 0;
    if (!c.configs.indexOf(cfg)) prefs.length = 0;
    prefs.push(pref);
    console.log(
      `\n### ${cfg.id} (arrivals ${cfg.arrival}, departures ${cfg.departure}): ${ops.exits.length} exits, ${ops.stands.length} usable stands, ${oriented}/${net.segs.length} segments oriented in ${orientMs} ms${first && c.configs.indexOf(cfg) ? `; ${flipped} of the ${both} oriented in both configurations point the other way than in ${c.configs[0]!.id}` : ''}`,
    );
    console.log(
      '| level/h | policy | done/h | gridlocks | first (min) | deadlocked end | stuck end (on stand) | taxi in (s) | taxi out (s) | stand hold (s) | wait (s) | segs/clearance | wrong-way | go-arounds | D refusals | wall (ms) |',
    );
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const figureLevel = Number(figureLevelArg) || c.levels[Math.floor(c.levels.length / 2)]!;
    const figure = new Map<Policy, { metrics: Metrics; snaps: Snap[] }>();
    for (const level of c.levels) {
      for (const policy of policyList) {
        const runs = seeds.map((seed) =>
          simulate(net, ops, pref, policy, {
            levelPerH: level,
            hours,
            seed,
            turnMin: c.turn[0],
            turnMax: c.turn[1],
            parkedShare: 0.6,
            snapEveryS: 300,
          }),
        );
        if (level === figureLevel) figure.set(policy, runs[0]!);
        const ms = runs.map((r) => r.metrics);
        const avg = (f: (x: Metrics) => number) => ms.reduce((s, x) => s + f(x), 0) / ms.length;
        const sum = (f: (x: Metrics) => number) => ms.reduce((s, x) => s + f(x), 0);
        const firsts = ms.map((x) => x.firstGridlockMin).filter((x) => x !== null);
        const row = {
          layout: net.name,
          config: cfg.id,
          level,
          policy,
          seeds,
          perHour: Number(avg((x) => x.perHour).toFixed(1)),
          gridlocks: sum((x) => x.gridlocks),
          firstGridlockMin: firsts.length ? Math.min(...firsts) : null,
          deadlockedEnd: Number(avg((x) => x.deadlockedEnd).toFixed(1)),
          stuckEnd: Number(avg((x) => x.stuckEnd).toFixed(1)),
          stuckAtStandEnd: Number(avg((x) => x.stuckAtStandEnd).toFixed(1)),
          standHoldS: Math.round(avg((x) => x.meanStandHoldS)),
          clearanceSegs: Number(avg((x) => x.meanClearanceSegs).toFixed(1)),
          taxiInS: Math.round(avg((x) => x.meanTaxiArrS)),
          taxiOutS: Math.round(avg((x) => x.meanTaxiDepS)),
          waitS: Math.round(avg((x) => x.meanWaitS)),
          wrongWayShare: Number(avg((x) => x.wrongWayShare).toFixed(3)),
          goArounds: Number(avg((x) => x.goArounds).toFixed(1)),
          dRefusals: Math.round(avg((x) => x.dRefusals)),
          wallMs: Math.round(avg((x) => x.wallMs)),
          runs: ms,
        };
        results.push(row);
        console.log(
          `| ${level} | ${policy} | ${row.perHour} | ${row.gridlocks} | ${fmt(row.firstGridlockMin)} | ${row.deadlockedEnd} | ${row.stuckEnd} (${row.stuckAtStandEnd}) | ${row.taxiInS} | ${row.taxiOutS} | ${row.standHoldS} | ${row.waitS} | ${row.clearanceSegs} | ${(row.wrongWayShare * 100).toFixed(1)}% | ${row.goArounds} | ${row.dRefusals} | ${row.wallMs} |`,
        );
      }
    }
    // One figure per case: every policy at the figure level, seed 1, when A first gridlocked
    // (plus ten minutes), else at the end of the run.
    const a = figure.get('A');
    const at =
      a?.metrics.firstGridlockMin !== null && a?.metrics.firstGridlockMin !== undefined
        ? Math.min(hours * 3600, (a.metrics.firstGridlockMin + 10) * 60)
        : hours * 3600;
    const panels = policyList.flatMap((p) => {
      const run = figure.get(p);
      if (!run) return [];
      const snap = run.snaps.reduce((b, s) => (Math.abs(s.t - at) < Math.abs(b.t - at) ? s : b));
      const x = run.metrics;
      const names = {
        AD: 'A + loop capacity only',
        A: 'A: claim the block ahead',
        B: 'B: block signalling',
        C: 'C: B + one-way preferences',
        D: 'D: C + loop capacity',
      };
      return [
        {
          title: `${names[p]} at ${Math.round(snap.t / 60)} min`,
          lines: [
            `seed ${seeds[0]}, ${figureLevel}/h demand: ${x.completed} done in ${hours} h (${x.perHour.toFixed(1)}/h), gridlocks ${x.gridlocks}${x.firstGridlockMin !== null ? ` (first ${x.firstGridlockMin} min)` : ''}`,
            `mean wait ${x.meanWaitS} s, wrong-way ${(x.wrongWayShare * 100).toFixed(1)}%, go-arounds ${x.goArounds}, stuck at end ${x.stuckEnd}`,
          ],
          snap,
          pref: p === 'C' || p === 'D' ? pref : null,
        },
      ];
    });
    const slug = `${net.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${cfg.id}`;
    writeFileSync(
      `${outDir}/${slug}.svg`,
      renderSvg(
        net,
        ops,
        `${net.name}, ${cfg.id} (arrivals ${cfg.arrival}, departures ${cfg.departure})`,
        panels,
      ),
    );
  }
}
writeFileSync(`${outDir}/${mode}-results.json`, JSON.stringify(results, null, 1));
