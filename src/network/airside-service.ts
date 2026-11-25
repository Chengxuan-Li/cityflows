import { MinHeap } from '../geo/heap';
import {
  cumulativeLengths,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  segmentDistance,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { aircraftCodes, codeSpanLimitM } from '../schema/aircraft';
import type { AirsideGraph } from './airside';
import type { CompiledCity } from './types';

// TASK-316: the lanes airside ground vehicles drive, read from the compiled city alone (the
// engine has no City). Airside service roads are the mapped `highway=service` roads closed to
// cars (`access=no` or `private`) that run within 150 m of the taxi network and keep out of every
// runway strip. Their lanes, the compiled movements between them and a turn at each end of a
// two-way road (an apron is wide enough to turn on; the compiled city has no U-turn at a dead
// end) form a directed graph, of which the largest strongly connected part is kept, so a vehicle
// that reaches a stand can always return.
//
// A zone is a stretch of a path inside an aircraft's corridor: within half the span an airside
// edge admits (capped at the airport's largest stand) plus 4 m of its centreline. Vehicles enter
// a zone only when no aircraft comes and they can clear it; they never stop in one.

export interface ServiceZone {
  fromM: number;
  toM: number;
  /** The airside edges whose corridors the stretch lies in, ascending. */
  edges: number[];
}

export interface ServicePoint {
  lane: number;
  positionM: number;
  pos: Vec2;
}

/** A way from one network lane's end to another's start: a compiled movement, or a turn. */
export interface ServiceLink {
  idx: number;
  from: number;
  to: number;
  /** The compiled movement, or -1 for a turn at a road's end. */
  movement: number;
  /** The junction it crosses: one vehicle at a time. */
  node: number;
  polyline: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
  zones: ServiceZone[];
}

export type ServiceStep =
  { kind: 'lane'; lane: number; fromM: number; toM: number } | { kind: 'link'; link: number };

export interface ServiceNetwork {
  /** Compiled lane indices, ascending. */
  lanes: number[];
  onNetwork: Uint8Array;
  laneZones: Map<number, ServiceZone[]>;
  links: ServiceLink[];
  /** Per compiled lane, its outgoing links. */
  out: Map<number, number[]>;
  /** Per airside stand, where its vehicles leave the lanes; null: no service lane near. */
  stands: (ServicePoint | null)[];
  /** The lane of the same road the other way, by lane: where a vehicle can turn round. */
  reverse: Map<number, number>;
  /** Where vehicles join and leave the lanes: the equipment bases. */
  depots: ServicePoint[];
}

const SAMPLE_M = 2;
const REACH_M = 150;
const STAND_REACH_M = 200;
const STRIP_EXTRA_M = 45;
const CORRIDOR_MARGIN_M = 4;
const CELL_M = 50;
const AHEAD_M = 25;
/** An access point needs this much lane before it (the entry) and after it (the exit merge). */
export const ACCESS_BEFORE_M = 8;
export const ACCESS_AFTER_M = 22;

const corridorHalf = (graph: AirsideGraph, code: number) =>
  Math.min(codeSpanLimitM[aircraftCodes[code]!], graph.maxSpanM || 80) / 2 + CORRIDOR_MARGIN_M;

const cellKey = (i: number, j: number) => i * 100_003 + j;

/** A grid of the airside edges' segments by their corridors (`runway`: runway strips instead):
 * `inside(p)` lists the edges whose corridor holds `p`, ascending. */
function corridorGrid(graph: AirsideGraph, runway: boolean) {
  const cells = new Map<number, number[]>();
  const halves = new Float64Array(graph.edges.length);
  for (const edge of graph.edges) {
    if ((edge.kind === 'runway') !== runway) continue;
    if (runway)
      halves[edge.idx] = (graph.runways[edge.runway]?.widthM ?? edge.widthM) / 2 + STRIP_EXTRA_M;
    else if (edge.maxCode >= 0) halves[edge.idx] = corridorHalf(graph, edge.maxCode);
    else continue;
    const half = halves[edge.idx]!;
    for (let s = 1; s < edge.line.length; s++) {
      const a = edge.line[s - 1]!,
        b = edge.line[s]!;
      const i0 = Math.floor((Math.min(a.x, b.x) - half) / CELL_M);
      const i1 = Math.floor((Math.max(a.x, b.x) + half) / CELL_M);
      const j0 = Math.floor((Math.min(a.y, b.y) - half) / CELL_M);
      const j1 = Math.floor((Math.max(a.y, b.y) + half) / CELL_M);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const list = cells.get(cellKey(i, j));
          if (list) list.push(edge.idx, s);
          else cells.set(cellKey(i, j), [edge.idx, s]);
        }
    }
  }
  return (p: Vec2): number[] => {
    const list = cells.get(cellKey(Math.floor(p.x / CELL_M), Math.floor(p.y / CELL_M)));
    const found: number[] = [];
    if (!list) return found;
    for (let k = 0; k < list.length; k += 2) {
      const e = list[k]!;
      if (found.includes(e)) continue;
      const line = graph.edges[e]!.line;
      if (segmentDistance(p, line[list[k + 1]! - 1]!, line[list[k + 1]!]!) <= halves[e]!)
        found.push(e);
    }
    return found.sort((a, b) => a - b);
  };
}

/** Whether a point lies within 150 m of the taxi network (its points every 10 m). */
function nearTaxi(graph: AirsideGraph) {
  const cells = new Map<number, Vec2[]>();
  for (const edge of graph.edges) {
    if (edge.kind === 'runway' || edge.maxCode < 0) continue;
    for (let at = 0; at <= edge.lengthM + 10; at += 10) {
      const p = pointAtDistance(edge.line, edge.cumulative, at);
      const key = cellKey(Math.floor(p.x / REACH_M), Math.floor(p.y / REACH_M));
      const list = cells.get(key);
      if (list) list.push(p);
      else cells.set(key, [p]);
    }
  }
  return (p: Vec2) => {
    const i = Math.floor(p.x / REACH_M),
      j = Math.floor(p.y / REACH_M);
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const q of cells.get(cellKey(i + di, j + dj)) ?? [])
          if (Math.hypot(q.x - p.x, q.y - p.y) <= REACH_M) return true;
    return false;
  };
}

const corridorCache = new WeakMap<AirsideGraph, ReturnType<typeof corridorGrid>>();
function corridorsOf(graph: AirsideGraph) {
  let grid = corridorCache.get(graph);
  if (!grid) corridorCache.set(graph, (grid = corridorGrid(graph, false)));
  return grid;
}

/** The zones of a polyline: its stretches inside aircraft corridors, edges for which `skip` holds
 * left out (a vehicle's own stand). */
export function corridorZones(
  graph: AirsideGraph,
  points: readonly Vec2[],
  cumulative: Float64Array,
  skip: (edge: number) => boolean = () => false,
): ServiceZone[] {
  const inside = corridorsOf(graph);
  const lengthM = cumulative.at(-1)!;
  const zones: ServiceZone[] = [];
  let open: ServiceZone | null = null;
  const steps = Math.max(1, Math.ceil(lengthM / SAMPLE_M));
  for (let i = 0; i <= steps; i++) {
    const at = (lengthM * i) / steps;
    const edges = inside(pointAtDistance(points, cumulative, at)).filter((e) => !skip(e));
    if (edges.length) {
      if (!open) zones.push((open = { fromM: Math.max(0, at - SAMPLE_M / 2), toM: at, edges: [] }));
      open.toM = Math.min(lengthM, at + SAMPLE_M / 2);
      for (const e of edges) if (!open.edges.includes(e)) open.edges.push(e);
    } else open = null;
  }
  for (const zone of zones) zone.edges.sort((a, b) => a - b);
  return zones;
}

const networks = new WeakMap<CompiledCity, ServiceNetwork | null>();

/** The airside service network of a compiled city with an airport, or null when it has no
 * airside service roads. */
export function serviceNetwork(compiled: CompiledCity): ServiceNetwork | null {
  if (!networks.has(compiled)) networks.set(compiled, buildServiceNetwork(compiled));
  return networks.get(compiled)!;
}

function buildServiceNetwork(compiled: CompiledCity): ServiceNetwork | null {
  const graph = compiled.airside;
  if (!graph) return null;
  const strips = corridorGrid(graph, true);
  const near = nearTaxi(graph);
  const candidate = new Uint8Array(compiled.lanes.length);
  for (const road of compiled.roads) {
    const car = road.access[0];
    if (road.roadClass !== 'service' || (car !== 'no' && car !== 'private')) continue;
    const lane = compiled.lanes[road.lanes[0]!]!;
    let ok = near(lane.polyline.at(-1)!) && !strips(lane.polyline.at(-1)!).length;
    for (let at = 0; ok && at <= lane.lengthM; at += 10) {
      const p = pointAtDistance(lane.polyline, lane.cumulative, at);
      ok = near(p) && strips(p).length === 0;
    }
    if (ok) for (const l of road.lanes) candidate[l] = 1;
  }

  // Links: compiled movements between candidate lanes, and a turn from each candidate lane
  // onto its road's reverse at the end where no movement leads on to it.
  const all: Omit<ServiceLink, 'idx' | 'zones'>[] = [];
  const byEnds = new Map<string, number>();
  for (const road of compiled.roads)
    if (candidate[road.lanes.at(-1)!]) byEnds.set(`${road.from}>${road.to}`, road.idx);
  for (const lane of compiled.lanes) {
    if (!candidate[lane.idx]) continue;
    const road = compiled.roads[lane.road]!;
    for (const m of lane.out) {
      const movement = compiled.movements[m]!;
      if (!candidate[movement.toLane]) continue;
      all.push({
        from: lane.idx,
        to: movement.toLane,
        movement: m,
        node: movement.node,
        polyline: movement.polyline,
        cumulative: movement.cumulative,
        lengthM: movement.lengthM,
      });
    }
    const reverseIdx = byEnds.get(`${road.to}>${road.from}`);
    if (reverseIdx === undefined) continue;
    const reverse = compiled.roads[reverseIdx]!;
    const to = reverse.lanes.at(-1)!;
    if (lane.out.some((m) => compiled.movements[m]!.toLane === to)) continue;
    const end = lane.polyline.at(-1)!;
    const start = compiled.lanes[to]!.polyline[0]!;
    const n = lane.polyline.length;
    const before = lane.polyline[n - 2]!;
    const dx = end.x - before.x,
      dy = end.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const ahead = Math.max(3, Math.hypot(start.x - end.x, start.y - end.y) / 2);
    const tip = { x: end.x + (dx / length) * ahead, y: end.y + (dy / length) * ahead };
    const mid = { x: (end.x + start.x) / 2, y: (end.y + start.y) / 2 };
    const polyline = [
      end,
      {
        x: (end.x + tip.x) / 2 + (mid.x - end.x) * 0.3,
        y: (end.y + tip.y) / 2 + (mid.y - end.y) * 0.3,
      },
      { x: tip.x + (mid.x - end.x), y: tip.y + (mid.y - end.y) },
      start,
    ];
    const cumulative = cumulativeLengths(polyline);
    all.push({
      from: lane.idx,
      to,
      movement: -1,
      node: road.to,
      polyline,
      cumulative,
      lengthM: cumulative.at(-1)!,
    });
  }
  const lanes = largestStronglyConnected(compiled.lanes.length, candidate, all);
  if (!lanes.length) return null;
  const onNetwork = new Uint8Array(compiled.lanes.length);
  for (const l of lanes) onNetwork[l] = 1;
  const links: ServiceLink[] = all
    .filter((link) => onNetwork[link.from] && onNetwork[link.to])
    .map((link, idx) => ({
      ...link,
      idx,
      zones: corridorZones(graph, link.polyline, link.cumulative),
    }));
  const out = new Map<number, number[]>();
  for (const link of links) {
    const list = out.get(link.from);
    if (list) list.push(link.idx);
    else out.set(link.from, [link.idx]);
  }
  const laneZones = new Map<number, ServiceZone[]>();
  for (const l of lanes) {
    const lane = compiled.lanes[l]!;
    const found = corridorZones(graph, lane.polyline, lane.cumulative);
    if (found.length) laneZones.set(l, found);
  }

  // Access points every 4 m along the network's lanes, with room to leave the lane at the point
  // and to merge back after it.
  const points: ServicePoint[] = [];
  for (const l of lanes) {
    const lane = compiled.lanes[l]!;
    for (let at = ACCESS_BEFORE_M; at <= lane.lengthM - ACCESS_AFTER_M; at += 4)
      points.push({
        lane: l,
        positionM: at,
        pos: pointAtDistance(lane.polyline, lane.cumulative, at),
      });
  }
  const nearestPoint = (p: Vec2, maxM: number, admit: (q: Vec2) => boolean = () => true) => {
    let best: ServicePoint | null = null,
      bestM = maxM;
    for (const point of points) {
      const d = Math.hypot(point.pos.x - p.x, point.pos.y - p.y);
      if (d < bestM && admit(point.pos)) [best, bestM] = [point, d];
    }
    return best;
  };
  // A stand's access is the point nearest its aircraft's middle, at most 25 m ahead of the nose:
  // a terminal stands ahead of a contact stand, and the lanes beyond it are on its far side.
  const stands = graph.stands.map((stand) => {
    if (stand.maxCode < 0) return null;
    const half = (codeSpanLimitM[aircraftCodes[stand.maxCode]!] * 0.9) / 2;
    const fx = Math.cos(stand.heading),
      fy = Math.sin(stand.heading);
    const centre = { x: stand.pos.x - fx * half, y: stand.pos.y - fy * half };
    return nearestPoint(
      centre,
      STAND_REACH_M,
      (q) => (q.x - stand.pos.x) * fx + (q.y - stand.pos.y) * fy <= AHEAD_M,
    );
  });

  // Bases: one by each group of served stands (300 m apart at most), on the lane nearest the
  // group's middle, and one by each hangar.
  const depots: ServicePoint[] = [];
  const add = (point: ServicePoint | null) => {
    if (point && !depots.some((d) => Math.hypot(d.pos.x - point.pos.x, d.pos.y - point.pos.y) < 60))
      depots.push(point);
  };
  const groups: number[][] = [];
  for (const stand of graph.stands) {
    if (!stands[stand.idx]) continue;
    const joined = groups.filter((group) =>
      group.some((s) => {
        const other = graph.stands[s]!.pos;
        return Math.hypot(other.x - stand.pos.x, other.y - stand.pos.y) < 300;
      }),
    );
    for (const group of joined) groups.splice(groups.indexOf(group), 1);
    groups.push([stand.idx, ...joined.flat()].sort((a, b) => a - b));
  }
  for (const group of groups.sort((a, b) => a[0]! - b[0]!)) {
    const mean = { x: 0, y: 0 };
    for (const s of group) {
      mean.x += graph.stands[s]!.pos.x / group.length;
      mean.y += graph.stands[s]!.pos.y / group.length;
    }
    add(nearestPoint(mean, Infinity));
  }
  for (const hangar of graph.hangars) add(nearestPoint(hangar.pos, 300));
  const reverse = new Map<number, number>();
  for (const l of lanes) {
    const road = compiled.roads[compiled.lanes[l]!.road]!;
    const other = byEnds.get(`${road.to}>${road.from}`);
    const lane = other === undefined ? undefined : compiled.roads[other]!.lanes.at(-1)!;
    if (lane !== undefined && onNetwork[lane]) reverse.set(l, lane);
  }
  return { lanes, onNetwork, laneZones, links, out, stands, depots, reverse };
}

/** The candidate lanes in the largest strongly connected part (by count) of the graph the links
 * form; Tarjan's algorithm, iterative. */
function largestStronglyConnected(
  n: number,
  candidate: Uint8Array,
  links: readonly Pick<ServiceLink, 'from' | 'to'>[],
): number[] {
  const next: number[][] = Array.from({ length: n }, () => []);
  for (const link of links) next[link.from]!.push(link.to);
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  let counter = 0;
  let best: number[] = [];
  for (let root = 0; root < n; root++) {
    if (!candidate[root] || index[root] !== -1) continue;
    const work: { lane: number; i: number }[] = [];
    const open = (lane: number) => {
      index[lane] = low[lane] = counter++;
      stack.push(lane);
      onStack[lane] = 1;
      work.push({ lane, i: 0 });
    };
    open(root);
    while (work.length) {
      const top = work.at(-1)!;
      const out = next[top.lane]!;
      if (top.i < out.length) {
        const to = out[top.i++]!;
        if (index[to] === -1) open(to);
        else if (onStack[to]) low[top.lane] = Math.min(low[top.lane]!, index[to]!);
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent) low[parent.lane] = Math.min(low[parent.lane]!, low[top.lane]!);
      if (low[top.lane] !== index[top.lane]) continue;
      const part: number[] = [];
      let lane: number;
      do {
        lane = stack.pop()!;
        onStack[lane] = 0;
        part.push(lane);
      } while (lane !== top.lane);
      if (part.length > best.length) best = part;
    }
  }
  return best.sort((a, b) => a - b);
}

/** The nearest point within 9 m on a network lane running the other way: where a vehicle can
 * turn round off the lane. */
export function turnedPoint(
  compiled: CompiledCity,
  network: ServiceNetwork,
  point: ServicePoint,
): ServicePoint | null {
  const own = compiled.lanes[point.lane]!;
  const h = headingAtDistance(
    own.polyline,
    own.cumulative,
    Math.min(point.positionM, own.lengthM - 1e-3),
  );
  let best: ServicePoint | null = null,
    bestM = 9;
  for (const l of network.lanes) {
    if (l === point.lane) continue;
    const lane = compiled.lanes[l]!;
    const hit = nearestOnPolyline(lane.polyline, point.pos);
    if (hit.away >= bestM) continue;
    if (hit.direction.x * Math.cos(h) + hit.direction.y * Math.sin(h) > -0.7) continue;
    [best, bestM] = [{ lane: l, positionM: hit.along, pos: hit.point }, hit.away];
  }
  return best;
}

/** Length of a route. */
export const routeLength = (network: ServiceNetwork, steps: readonly ServiceStep[]) =>
  steps.reduce(
    (sum, s) => sum + (s.kind === 'lane' ? s.toM - s.fromM : network.links[s.link]!.lengthM),
    0,
  );

/** The shortest way over the network from one point to another, lane stretches and the links
 * between them; null when there is none. */
export function serviceRoute(
  compiled: CompiledCity,
  network: ServiceNetwork,
  from: ServicePoint,
  to: ServicePoint,
): ServiceStep[] | null {
  if (from.lane === to.lane && to.positionM >= from.positionM)
    return [{ kind: 'lane', lane: from.lane, fromM: from.positionM, toM: to.positionM }];
  // Costs at each lane's start; the first lane is entered at `from.positionM`.
  const cost = new Map<number, number>();
  const via = new Map<number, number>();
  const heap = new MinHeap();
  const relax = (laneEndCost: number, lane: number) => {
    for (const l of network.out.get(lane) ?? []) {
      const link = network.links[l]!;
      const c = laneEndCost + link.lengthM;
      if (c < (cost.get(link.to) ?? Infinity)) {
        cost.set(link.to, c);
        via.set(link.to, l);
        heap.push(link.to, c);
      }
    }
  };
  relax(compiled.lanes[from.lane]!.lengthM - from.positionM, from.lane);
  for (let lane = heap.pop(); lane !== undefined; lane = heap.pop()) {
    if (heap.cost > cost.get(lane)!) continue;
    if (lane === to.lane) break;
    relax(heap.cost + compiled.lanes[lane]!.lengthM, lane);
  }
  if (!via.has(to.lane)) return null;
  const steps: ServiceStep[] = [{ kind: 'lane', lane: to.lane, fromM: 0, toM: to.positionM }];
  let lane = to.lane;
  for (;;) {
    const l = via.get(lane)!;
    steps.unshift({ kind: 'link', link: l });
    lane = network.links[l]!.from;
    if (lane === from.lane) {
      steps.unshift({
        kind: 'lane',
        lane,
        fromM: from.positionM,
        toM: compiled.lanes[lane]!.lengthM,
      });
      return steps;
    }
    steps.unshift({ kind: 'lane', lane, fromM: 0, toM: compiled.lanes[lane]!.lengthM });
  }
}
