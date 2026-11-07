import { writeFileSync } from 'node:fs';
import process from 'node:process';
import type { Graphics } from 'pixi.js';
import {
  cumulativeLengths,
  nearestOnPolyline,
  parallelOffset,
  pointAtDistance,
  polylineCrossings,
  preparePolygon,
  prepareRing,
  ringsOverlap,
  sampleCubic,
  segmentDistance,
  trimPolyline,
} from '../src/geo/polyline';
import type { Vec2 } from '../src/geo/vec2';
import { compile, type CLane, type CompiledCity, type CNode, type CRoad } from '../src/network';
import { MEDIAN_M } from '../src/importers/osm/corridors';
import { ATTACH_GAP_M, laneEdges, roadWidth, shiftAt } from '../src/network/lanes';

const hasShift = (road: CRoad) => road.startShift.length > 0 || road.endShift.length > 0;
import { drawRoad } from '../src/render/layers/roads';
import { style } from '../src/render/style';
import type { City, Road, RoadClass } from '../src/schema';
import { auditCities, loadAuditCity, markingLengths, type AuditCity } from './junction-audit';

// Geometry audit (TASK-081, docs/plan.md "Geometry rework"): eleven measures of how far the drawn
// roads, lanes and junctions are from the corridors their canonical centerlines describe, per
// city and per named case (the ninth, lane overlap, from TASK-087, by road end from TASK-095; the
// tenth, corner sharpness, from TASK-092; the eleventh, corridor voids, from TASK-095). Usage:
// npm run geometry-audit -- [out.json] [--relax-max-m <m>]
//
// Conventions: stations are arc lengths along a polyline; the right-hand normal of heading
// (dx, dy) is (-dy, dx) (y-south, architecture 5.1); a lateral offset is signed, positive to the
// right of travel. At a station the tangent is the chord from 1 m before to 1 m after it, so the
// millimetre back-steps of densely smoothed centerlines do not turn the normal. A ray is the
// line through the station point along that normal; the offset of another polyline there is
// the signed distance along the ray to where it crosses that polyline.

export const STEP_M = 0.5;
const CELL_M = 0.25;
// The junction audit's cell grid: offset so axis-aligned and shared edges miss cell centres.
const OFFSET_X = 0.0123,
  OFFSET_Y = 0.0371;
/** A lane deviating more than this from its nominal offset marks a transition (measure 1). */
const TRANSITION_M = 0.05;

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const closed = (ring: readonly Vec2[]) =>
  ring.length && (ring[0]!.x !== ring.at(-1)!.x || ring[0]!.y !== ring.at(-1)!.y)
    ? [...ring, ring[0]!]
    : [...ring];

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}

/** Point, unit tangent and right-hand normal at station `s` (chord tangent over ±1 m). */
export function frame(line: readonly Vec2[], lengths: Float64Array, s: number) {
  const total = lengths.at(-1)!;
  const p = pointAtDistance(line, lengths, s);
  const a = pointAtDistance(line, lengths, Math.max(0, s - 1));
  const b = pointAtDistance(line, lengths, Math.min(total, s + 1));
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  return { p, t, n: { x: -t.y, y: t.x } };
}

/** Signed distances along `n` from `p` at which the line through them crosses `line`. */
export function rayCrossings(p: Vec2, n: Vec2, line: readonly Vec2[], reach: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const ax = a.x - p.x,
      bx = b.x - p.x,
      ay = a.y - p.y,
      by = b.y - p.y;
    if ((ax > reach && bx > reach) || (ax < -reach && bx < -reach)) continue;
    if ((ay > reach && by > reach) || (ay < -reach && by < -reach)) continue;
    const fa = (a.x - p.x) * n.y - (a.y - p.y) * n.x,
      fb = (b.x - p.x) * n.y - (b.y - p.y) * n.x;
    if ((fa > 0 && fb > 0) || (fa < 0 && fb < 0) || fa === fb) continue;
    const u = fa / (fa - fb);
    const lambda = (a.x + (b.x - a.x) * u - p.x) * n.x + (a.y + (b.y - a.y) * u - p.y) * n.y;
    if (Math.abs(lambda) <= reach) out.push(lambda);
  }
  return out;
}

const nearestTo = (values: number[], target: number) =>
  values.reduce<number | null>(
    (best, v) => (best === null || Math.abs(v - target) < Math.abs(best - target) ? v : best),
    null,
  );

/** The surface ring split into its left and right edges, both in travel direction. */
export function surfaceEdges(road: CRoad): [Vec2[], Vec2[]] {
  const half = road.surface.length / 2;
  return [road.surface.slice(0, half), road.surface.slice(half).reverse()];
}

const median = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function curbRadius(roadClass: RoadClass): number {
  if (roadClass === 'service' || roadClass === 'residential') return 6;
  if (roadClass === 'tertiary' || roadClass === 'secondary') return 9;
  return 12;
}

function grade(city: City, road: Road): number {
  return road.layer ?? Math.min(city.nodes[road.from]!.layer ?? 0, city.nodes[road.to]!.layer ?? 0);
}

// ---------------------------------------------------------------------------------------------
// 1. Corridor width error

export interface RoadWidth {
  road: string;
  /** Largest |edge offset - expected offset| over both edges and all stations, m. */
  maxM: number;
  p95M: number;
  /** Station of the largest error along the canonical centerline, and its edge. */
  atM: number;
  side: 'left' | 'right' | '';
  samples: number;
  /** Edge samples whose ray crosses the edge nowhere within W + 2 m of its expected offset (at
   * sharp centerline corners, beside the mitre); their error is |distance from the station point
   * to the edge - |expected offset||. */
  missing: number;
  /** Centerline length left out as transition at the two ends, m. */
  excludedM: number;
  /** Transition lengths left out at the start and at the end, m (measure 2 uses them too). */
  zones: [number, number];
}

/** Measure 1. Stations every 0.5 m along the road's canonical centerline, from 0.5 m past the
 * projection of the surface's start cut to 0.5 m before its end cut. Expected edge offsets are
 * `lateralOffsetM - W/2` (left) and `lateralOffsetM + W/2` (right), W the sum of lane widths, plus
 * the converging shift there (TASK-089, `shiftAt` at the station's projection on the reference
 * line); the measured offset is the ray crossing of that surface edge nearest the expected one.
 * Transitions are left out: at a road end with an end offset (`startOffsetM`/`endOffsetM`) or a tapering
 * lane, the run of stations from the cut over which some lane polyline lies more than 0.05 m from
 * its nominal offset, or which lies within that end's taper length. */
export function roadWidthAudit(city: City, net: CompiledCity, road: CRoad) {
  const source = city.roads[road.id]!;
  const center = source.centerline;
  const lengths = cumulativeLengths(center);
  const width = roadWidth(source);
  const expected = {
    left: source.lateralOffsetM - width / 2,
    right: source.lateralOffsetM + width / 2,
  };
  const [left, right] = surfaceEdges(road);
  const s0 = nearestOnPolyline(center, median(left[0]!, right[0]!)).along;
  const s1 = nearestOnPolyline(center, median(left.at(-1)!, right.at(-1)!)).along;
  const stations: number[] = [];
  for (let k = 1; s0 + k * STEP_M <= s1 - STEP_M + 1e-9; k++) stations.push(s0 + k * STEP_M);
  const lanes = road.lanes.map((i) => net.lanes[i]!);
  const nominal: number[] = [];
  let edge = expected.left;
  for (const lane of source.lanes) {
    nominal.push(edge + lane.widthM / 2);
    edge += lane.widthM;
  }
  const frames = stations.map((s) => frame(center, lengths, s));
  // TASK-089: converging carriageways' lane blocks are shifted near their nodes, by station on
  // the road's reference line.
  const referenceLength = cumulativeLengths(road.reference).at(-1)!;
  const shifts = frames.map(({ p }) =>
    hasShift(road) ? shiftAt(road, nearestOnPolyline(road.reference, p).along, referenceLength) : 0,
  );
  const deviates = (k: number) =>
    lanes.some((lane, i) => {
      const { p, n } = frames[k]!;
      const target = nominal[i]! + shifts[k]!;
      const hit = nearestTo(rayCrossings(p, n, lane.polyline, width + 10), target);
      return hit === null || Math.abs(hit - target) > TRANSITION_M;
    });
  const zone = (atEnd: boolean) => {
    const offset = atEnd ? road.endOffsetM : road.startOffsetM;
    const taper = Math.max(0, ...lanes.map((l) => (atEnd ? l.taperEndM : l.taperStartM)));
    if (!offset && !taper) return 0;
    let reach = 0;
    for (let j = 0; j < stations.length; j++) {
      const k = atEnd ? stations.length - 1 - j : j;
      const away = atEnd ? s1 - stations[k]! : stations[k]! - s0;
      if (away > taper && !deviates(k)) break;
      reach = away;
    }
    return reach;
  };
  const zones: [number, number] = [zone(false), zone(true)];
  const errors: number[] = [];
  let worst = { error: 0, at: 0, side: '' as RoadWidth['side'] };
  let missing = 0;
  stations.forEach((s, k) => {
    if (s - s0 <= zones[0] || s1 - s <= zones[1]) return;
    const { p, n } = frames[k]!;
    for (const [side, line] of [
      ['left', left],
      ['right', right],
    ] as const) {
      const target = expected[side] + shifts[k]!;
      const hits = rayCrossings(p, n, line, Math.abs(target) + width + 2).filter(
        (l) => Math.abs(l - target) <= width + 2,
      );
      const hit = nearestTo(hits, target);
      const error =
        hit === null
          ? Math.abs(nearestOnPolyline(line, p).away - Math.abs(target))
          : Math.abs(hit - target);
      if (hit === null) missing++;
      errors.push(error);
      if (error > worst.error) worst = { error, at: s, side };
    }
  });
  const audit: RoadWidth = {
    road: road.id,
    maxM: round(worst.error),
    p95M: round(percentile(errors, 0.95)),
    atM: round(worst.at, 1),
    side: worst.side,
    samples: errors.length,
    missing,
    excludedM: round(Math.min(s1 - s0, zones[0] + zones[1]), 1),
    zones: [round(zones[0], 1), round(zones[1], 1)],
  };
  return { audit, errors };
}

// ---------------------------------------------------------------------------------------------
// 2. Centre-line gap

export interface PairGap {
  roads: string;
  kind: 'two-way' | 'one-line';
  /** Largest |gap| between the two directions' median-side lane edges, m. */
  maxM: number;
  /** The worst gap signed: positive apart, negative overlapping (B's edge inside A's lanes). */
  signedM: number;
  atM: number;
  samples: number;
}

/** The two directions of a street: roads with swapped endpoints that share a `streetGroupId`
 * (`two-way`), or that share none but whose canonical centerlines coincide, every 5 m of the
 * first within 0.5 m of the second (`one-line`: opposite carriageways drawn on one line). */
export function directionPairs(city: City, net: CompiledCity) {
  const byEnds = new Map<string, CRoad[]>();
  for (const road of net.roads) {
    const key = `${road.from}>${road.to}`;
    byEnds.set(key, [...(byEnds.get(key) ?? []), road]);
  }
  const pairs: { a: CRoad; b: CRoad; kind: PairGap['kind'] }[] = [];
  for (const a of net.roads)
    for (const b of byEnds.get(`${a.to}>${a.from}`) ?? []) {
      if (b.idx <= a.idx) continue;
      if (a.streetGroupId !== null && a.streetGroupId === b.streetGroupId) {
        pairs.push({ a, b, kind: 'two-way' });
        continue;
      }
      const ca = city.roads[a.id]!.centerline,
        cb = city.roads[b.id]!.centerline;
      const lengths = cumulativeLengths(ca);
      let coincide = true;
      for (let s = 0; s <= lengths.at(-1)! && coincide; s += 5)
        coincide = nearestOnPolyline(cb, pointAtDistance(ca, lengths, s)).away < 0.5;
      if (coincide) pairs.push({ a, b, kind: 'one-line' });
    }
  return pairs;
}

/** The median-side edge of a road's lane block as the centre line is drawn: `parallelOffset` of
 * the median lane (leftmost under right-hand traffic) by half its width toward the median. */
function medianEdge(net: CompiledCity, road: CRoad): Vec2[] {
  const right = net.drivingSide === 'left';
  const lane = net.lanes[right ? road.lanes.at(-1)! : road.lanes[0]!]!;
  return parallelOffset(lane.polyline, ((right ? 1 : -1) * lane.widthM) / 2);
}

/** Measure 2. Stations every 0.5 m along A's median edge, leaving out A's transition lengths
 * (measure 1) at both ends; the gap is the ray crossing of B's median edge nearest A's, signed
 * positive toward the median. Stations where the ray misses B (B trimmed shorter) are skipped. */
export function pairGapAudit(
  net: CompiledCity,
  a: CRoad,
  b: CRoad,
  kind: PairGap['kind'],
  zones: [number, number],
): PairGap {
  const lineA = medianEdge(net, a),
    lineB = medianEdge(net, b);
  const lengths = cumulativeLengths(lineA);
  const total = lengths.at(-1)!;
  const toward = net.drivingSide === 'left' ? 1 : -1;
  const reach =
    [a, b].reduce((sum, r) => sum + r.lanes.reduce((w, i) => w + net.lanes[i]!.widthM, 0), 0) + 2;
  let worst = { gap: 0, at: 0 },
    samples = 0;
  for (let s = STEP_M; s <= total - STEP_M + 1e-9; s += STEP_M) {
    if (s <= zones[0] || total - s <= zones[1]) continue;
    const { p, n } = frame(lineA, lengths, s);
    const hit = nearestTo(rayCrossings(p, n, lineB, reach), 0);
    if (hit === null) continue;
    samples++;
    const gap = hit * toward;
    if (Math.abs(gap) > Math.abs(worst.gap)) worst = { gap, at: s };
  }
  return {
    roads: `${a.id}/${b.id}`,
    kind,
    maxM: round(Math.abs(worst.gap)),
    signedM: round(worst.gap),
    atM: round(worst.at, 1),
    samples,
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Lane folds

export interface LaneFold {
  lane: string;
  /** Runs where the vertices' stations on the canonical centerline fall more than 0.01 m below
   * their running maximum, and the summed depth of those runs, m. */
  backSteps: number;
  backStepM: number;
  /** Proper crossings between non-adjacent segments. */
  crossings: number;
  /** Runs of cusps, where the heading turns more than 90 degrees within 1 m of polyline, and
   * the polyline length they span (1 m either side of each turn, merged), m. */
  cusps: number;
  cuspM: number;
}

function properCrossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < -1e-12 && side(c, d, a) * side(c, d, b) < -1e-12;
}

/** Proper crossings between non-adjacent segments of an open polyline (`ring`: closed, so the
 * first and last segments are adjacent too). */
export function polylineSelfCrossings(line: readonly Vec2[], ring = false): number {
  const boxes = line.slice(1).map((b, i) => {
    const a = line[i]!;
    return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  });
  let count = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 2; j < boxes.length; j++) {
      if (ring && i === 0 && j === boxes.length - 1) continue;
      const p = boxes[i]!,
        q = boxes[j]!;
      if (p[0]! > q[2]! || q[0]! > p[2]! || p[1]! > q[3]! || q[1]! > p[3]!) continue;
      if (properCrossing(line[i]!, line[i + 1]!, line[j]!, line[j + 1]!)) count++;
    }
  return count;
}

/** Stations of `points` on `center`, each searched within 30 m of the previous one's (the first
 * over the whole line), so a hairpin's other arm is never taken. */
function stationsOn(center: readonly Vec2[], lengths: Float64Array, points: readonly Vec2[]) {
  let hint = nearestOnPolyline(center, points[0]!).along;
  return points.map((p) => {
    let best = { away: Infinity, along: hint };
    for (let j = 1; j < center.length; j++) {
      if (lengths[j]! < hint - 30) continue;
      if (lengths[j - 1]! > hint + 30) break;
      const a = center[j - 1]!,
        b = center[j]!;
      const length = lengths[j]! - lengths[j - 1]!;
      const t =
        length === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length ** 2),
            );
      const away = Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
      if (away < best.away) best = { away, along: lengths[j - 1]! + t * length };
    }
    hint = best.along;
    return best.along;
  });
}

/** Measure 3 for one lane polyline against its road's canonical centerline. */
export function laneFoldAudit(city: City, net: CompiledCity, lane: CLane): LaneFold {
  const center = city.roads[net.roads[lane.road]!.id]!.centerline;
  const line = lane.polyline;
  const stations = stationsOn(center, cumulativeLengths(center), line);
  let backSteps = 0,
    backStepM = 0,
    high = -Infinity,
    low = Infinity;
  const close = () => {
    if (high - low > 0.01) {
      backSteps++;
      backStepM += high - low;
    }
    low = Infinity;
  };
  for (const s of stations) {
    if (s >= high) {
      if (low !== Infinity) close();
      high = s;
    } else low = Math.min(low, s);
  }
  if (low !== Infinity) close();
  const lengths = cumulativeLengths(line);
  const segments: { i: number; h: Vec2 }[] = [];
  for (let i = 1; i < line.length; i++) {
    const l = lengths[i]! - lengths[i - 1]!;
    if (l > 0)
      segments.push({
        i,
        h: { x: (line[i]!.x - line[i - 1]!.x) / l, y: (line[i]!.y - line[i - 1]!.y) / l },
      });
  }
  // A cusp: a segment a and a later segment b that begins less than 1 m after a ends and heads
  // more than 90 degrees away from a. Its span runs from 1 m before a's end (or a's start) to 1 m
  // after b's start (or b's end); overlapping spans merge into one run.
  const runs: [number, number][] = [];
  segments.forEach((a, k) => {
    for (let m = k + 1; m < segments.length; m++) {
      const b = segments[m]!;
      if (lengths[b.i - 1]! - lengths[a.i]! >= 1) break;
      if (a.h.x * b.h.x + a.h.y * b.h.y < 0) {
        const span: [number, number] = [
          Math.max(lengths[a.i - 1]!, lengths[a.i]! - 1),
          Math.min(lengths[b.i]!, lengths[b.i - 1]! + 1),
        ];
        const last = runs.at(-1);
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else runs.push(span);
      }
    }
  });
  return {
    lane: lane.id,
    backSteps,
    backStepM: round(backStepM),
    crossings: polylineSelfCrossings(line),
    cusps: runs.length,
    cuspM: round(runs.reduce((sum, [a, b]) => sum + b - a, 0)),
  };
}

// ---------------------------------------------------------------------------------------------
// 4. Through-road deviation

export interface ThroughDeviation {
  node: string;
  /** The incoming and outgoing road of the worst through pair. */
  pair: string;
  /** Largest |drawn edge - expected edge| on sides with no side road (the far edge), and on
   * sides with one, outside its mouth (the near edge), m. */
  farM: number;
  nearM: number;
  /** Worst value's signed deviation (positive: drawn beyond the expected edge, a bulge),
   * its side and its station relative to the node along the through alignment. */
  signedM: number;
  side: 'left' | 'right' | '';
  atM: number;
  /** Largest |lane polyline offset - nominal lane offset| from the through alignment within
   * `APPROACH_M` of the node, over the pairs' lanes (lanes dipping toward the node), m. */
  laneM: number;
  pairs: number;
  /** Pairs left out because one of their ends is a transition (end offset or taper). */
  skipped: number;
}

/** How far from the node a road end's direction and the through alignment are taken: past the
 * junction and past the importer's realigned approach (TASK-068), at most half the road. */
export const APPROACH_M = 20;

const reachOf = (total: number) => Math.min(APPROACH_M, total / 2);

/** Outward unit direction of a road end: the chord from the node to the canonical centerline's
 * point `APPROACH_M` in. */
function outward(city: City, road: CRoad, atEnd: boolean): Vec2 {
  const line = city.roads[road.id]!.centerline;
  const lengths = cumulativeLengths(line);
  const total = lengths.at(-1)!;
  const from = atEnd ? line.at(-1)! : line[0]!;
  const to = pointAtDistance(line, lengths, atEnd ? total - reachOf(total) : reachOf(total));
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

const OPPOSITE = Math.cos((150 * Math.PI) / 180);
const ALONG = Math.cos((30 * Math.PI) / 180);

interface Corridor {
  a: CRoad;
  b: CRoad;
  line: Vec2[];
  lengths: Float64Array;
  /** Station of the node on `line`. */
  at: number;
  /** Expected left and right edge offsets of a and of b. */
  edges: [[number, number], [number, number]];
}

/** The through alignment of a pair: a's canonical centerline up to `APPROACH_M` before the node,
 * a cubic Bezier tangent to both centerlines there (control points a third of the chord along the
 * tangents), and b's centerline from `APPROACH_M` after the node. */
function corridor(city: City, node: CNode, a: CRoad, b: CRoad): Corridor {
  const sa = city.roads[a.id]!,
    sb = city.roads[b.id]!;
  const la = cumulativeLengths(sa.centerline),
    lb = cumulativeLengths(sb.centerline);
  const da = reachOf(la.at(-1)!),
    db = reachOf(lb.at(-1)!);
  const start = frame(sa.centerline, la, la.at(-1)! - da),
    end = frame(sb.centerline, lb, db);
  const third = Math.hypot(end.p.x - start.p.x, end.p.y - start.p.y) / 3;
  const curve = sampleCubic(
    start.p,
    { x: start.p.x + start.t.x * third, y: start.p.y + start.t.y * third },
    { x: end.p.x - end.t.x * third, y: end.p.y - end.t.y * third },
    end.p,
  );
  const line = [
    ...trimPolyline(sa.centerline, 0, da),
    ...curve.slice(1, -1),
    ...trimPolyline(sb.centerline, db, 0),
  ];
  const lengths = cumulativeLengths(line);
  const at = nearestOnPolyline(line, node.pos).along;
  const edges = (r: Road): [number, number] => [
    r.lateralOffsetM - roadWidth(r) / 2,
    r.lateralOffsetM + roadWidth(r) / 2,
  ];
  const [ea, eb] = [edges(sa), edges(sb)];
  return { a, b, line, lengths, at, edges: [ea, eb] };
}

/** Through pairs at a node: an incoming and an outgoing road whose ends are within 30 degrees of
 * opposite, both of the node's highest `classRank`. */
export function throughPairs(city: City, net: CompiledCity, node: CNode) {
  const incident = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
  const top = Math.max(...incident.map((r) => r.classRank));
  const pairs: [CRoad, CRoad][] = [];
  for (const a of incident)
    for (const b of incident) {
      if (a.to !== node.idx || b.from !== node.idx || a === b) continue;
      if (a.classRank !== top || b.classRank !== top) continue;
      const da = outward(city, a, true),
        db = outward(city, b, false);
      if (da.x * db.x + da.y * db.y < OPPOSITE) pairs.push([a, b]);
    }
  return pairs;
}

/** Measure 4 at a junction: a node with a through pair and at least one side road end (an end
 * not within 30 degrees of either arm of a through pair). For each through pair (a, b), C is its
 * through alignment (`corridor`) and the expected edges are C offset by `lateralOffsetM ± W/2`
 * plus the road's converging shift (TASK-089) at the station:
 * a's up to the projection of a's cut onto C, b's from b's cut, linear between (they differ only
 * where the width or offset changes at the node). Stations every 0.5 m over the extent of the
 * node's outline and curbs projected onto C (±10 m around the node where it has none). The drawn
 * region D is the union of the incident roads' surfaces, the outline and the curbs; on each side
 * the drawn edge is the outer end of the run of the ray inside D that contains the point 0.25 m
 * inside the expected edge (or, when that point is outside D, the outer end of the nearest inside
 * run toward C), searched up to 12 m beyond the expected edge (capped there). A side is measured
 * only where its expected edge is an outer edge: the point 0.5 m beyond it is not within 1 m of
 * another incident road's expected band (so the shared edge of a two-way street's directions and
 * edges facing a coincident or adjacent carriageway are not). A side with a side road (whose
 * outward direction points to that side of C at the node) is the near side, the other the far
 * side. On either side a mouth is left out: stations whose ray, from the expected edge out to
 * 12 m beyond it, crosses a side road's surface, widened along C by that road's curb class radius
 * (6, 9 or 12 m). `laneM`: each lane of a and b against its nominal offset from C at stations
 * every 0.5 m out to `APPROACH_M` from the node, where the ray crosses the lane polyline within
 * the road's width of that offset. Pairs with an end offset or a tapering lane at the node are
 * skipped. */
export function throughAudit(city: City, net: CompiledCity, node: CNode): ThroughDeviation | null {
  const pairs = throughPairs(city, net, node);
  if (!pairs.length) return null;
  const incident = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
  const arms = pairs.flatMap(([a, b]) => [outward(city, a, true), outward(city, b, false)]);
  const junction = incident.some((road) =>
    [false, true].some((atEnd) => {
      if ((atEnd ? road.to : road.from) !== node.idx) return false;
      const d = outward(city, road, atEnd);
      return arms.every((arm) => arm.x * d.x + arm.y * d.y <= ALONG);
    }),
  );
  if (!junction) return null;
  const rings = [
    ...incident.map((r) => closed(r.surface)),
    ...(node.outline.length ? [closed(node.outline)] : []),
  ];
  const inside = rings.map((ring) => preparePolygon(ring, 0));
  const inD = (p: Vec2) => inside.some((test) => test(p));
  const corridors = pairs.map(([a, b]) => corridor(city, node, a, b));
  const extentPoints = node.outline;
  const result: ThroughDeviation = {
    node: node.id,
    pair: '',
    farM: 0,
    nearM: 0,
    signedM: 0,
    side: '',
    atM: 0,
    laneM: 0,
    pairs: pairs.length,
    skipped: 0,
  };
  let worst = 0;
  for (const c of corridors) {
    const transition =
      c.a.endOffsetM !== 0 ||
      c.b.startOffsetM !== 0 ||
      c.a.lanes.some((i) => net.lanes[i]!.taperEndM > 0) ||
      c.b.lanes.some((i) => net.lanes[i]!.taperStartM > 0);
    if (transition) {
      result.skipped++;
      continue;
    }
    const total = c.lengths.at(-1)!;
    const near = (p: Vec2) => {
      // Search the node's neighbourhood of C only (50 m), so a long road's far part never wins.
      let best = { along: c.at, away: Infinity, lateral: 0 };
      for (let j = 1; j < c.line.length; j++) {
        if (c.lengths[j]! < c.at - 50) continue;
        if (c.lengths[j - 1]! > c.at + 50) break;
        const a = c.line[j - 1]!,
          b = c.line[j]!;
        const length = c.lengths[j]! - c.lengths[j - 1]!;
        if (length === 0) continue;
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length ** 2),
        );
        const away = Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
        if (away < best.away) {
          const lateral = ((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / length;
          best = { along: c.lengths[j - 1]! + t * length, away, lateral };
        }
      }
      return best;
    };
    const extent = extentPoints.map((p) => near(p).along);
    const from = Math.max(0, extent.length ? Math.min(...extent) : c.at - 10);
    const to = Math.min(total, extent.length ? Math.max(...extent) : c.at + 10);
    // a's edges up to its cut, b's from its cut, linear between (a width or offset change).
    const [cutA, cutB] = [
      surfaceEdges(c.a).map((edge) => edge.at(-1)!),
      surfaceEdges(c.b).map((edge) => edge[0]!),
    ].map(([l, r]) => near(median(l!, r!)).along) as [number, number];
    // TASK-089: each road's converging shift, at the station's projection on its reference
    // line, up to its cut.
    const shiftOf = (road: CRoad, s: number) => {
      if (!hasShift(road)) return 0;
      const p = frame(c.line, c.lengths, s).p;
      const length = cumulativeLengths(road.reference).at(-1)!;
      return shiftAt(road, nearestOnPolyline(road.reference, p).along, length);
    };
    const band = (s: number): [number, number] => {
      const [ea, eb] = c.edges;
      const [sa, sb] = [shiftOf(c.a, Math.min(s, cutA)), shiftOf(c.b, Math.max(s, cutB))];
      const f =
        cutB > cutA ? Math.max(0, Math.min(1, (s - cutA) / (cutB - cutA))) : s < c.at ? 0 : 1;
      return [
        ea[0] + sa + (eb[0] + sb - ea[0] - sa) * f,
        ea[1] + sa + (eb[1] + sb - ea[1] - sa) * f,
      ];
    };
    // Side roads: incident roads with an end at the node not within 30 degrees of either arm.
    const arms = [outward(city, c.a, true), outward(city, c.b, false)];
    const sideRoads = incident.filter((road) =>
      [false, true].some((atEnd) => {
        if ((atEnd ? road.to : road.from) !== node.idx) return false;
        const d = outward(city, road, atEnd);
        return arms.every((arm) => arm.x * d.x + arm.y * d.y <= ALONG);
      }),
    );
    // A side road is on the side its outward direction points to, across C at the node.
    const across = frame(c.line, c.lengths, c.at).n;
    const sides = { left: false, right: false };
    for (const road of sideRoads)
      for (const atEnd of [false, true]) {
        if ((atEnd ? road.to : road.from) !== node.idx) continue;
        const d = outward(city, road, atEnd);
        sides[d.x * across.x + d.y * across.y < 0 ? 'left' : 'right'] = true;
      }
    const sideRings = sideRoads.map((road) => ({
      ring: closed(road.surface),
      radius: curbRadius(road.roadClass),
    }));
    // Every other incident road's expected band, in its own frame.
    const bands = incident
      .filter((r) => r !== c.a && r !== c.b)
      .map((r) => {
        const source = city.roads[r.id]!;
        const w = roadWidth(source);
        return {
          road: r,
          line: source.centerline,
          total: cumulativeLengths(source.centerline).at(-1)!,
          lo: source.lateralOffsetM - w / 2,
          hi: source.lateralOffsetM + w / 2,
        };
      });
    const inOtherBand = (q: Vec2) =>
      bands.some((o) => {
        const hit = nearestOnPolyline(o.line, q);
        // Past an end of the road by more than one station step: outside its band.
        const overshoot =
          (q.x - hit.point.x) * hit.direction.x + (q.y - hit.point.y) * hit.direction.y;
        if (hit.along <= 1e-9 && overshoot < -STEP_M) return false;
        if (hit.along >= o.total - 1e-9 && overshoot > STEP_M) return false;
        const lateral =
          (q.x - hit.point.x) * -hit.direction.y + (q.y - hit.point.y) * hit.direction.x;
        const shift = hasShift(o.road)
          ? shiftAt(
              o.road,
              nearestOnPolyline(o.road.reference, hit.point).along,
              cumulativeLengths(o.road.reference).at(-1)!,
            )
          : 0;
        return (
          lateral >= o.lo + shift - BAND_TOLERANCE_M && lateral <= o.hi + shift + BAND_TOLERANCE_M
        );
      });
    const stations: number[] = [];
    for (let k = 0; from + k * STEP_M <= to + 1e-9; k++) stations.push(from + k * STEP_M);
    const frames = stations.map((s) => frame(c.line, c.lengths, s));
    // A mouth: stations where the ray, from the expected edge out to SEARCH_M beyond it, crosses
    // a side road's surface, widened along C by that road's curb class radius.
    const mouth = { left: [] as [number, number][], right: [] as [number, number][] };
    stations.forEach((s, k) => {
      const { p, n } = frames[k]!;
      const [lo, hi] = band(s);
      for (const side of ['left', 'right'] as const) {
        const dir = side === 'left' ? -1 : 1;
        const expected = side === 'left' ? lo : hi;
        for (const { ring, radius } of sideRings) {
          const hits = rayCrossings(p, n, ring, Math.abs(expected) + SEARCH_M + 1);
          if (hits.some((l) => (l - expected) * dir >= 0 && (l - expected) * dir <= SEARCH_M))
            mouth[side].push([s - radius, s + radius]);
        }
      }
    });
    stations.forEach((s, k) => {
      const { p, n } = frames[k]!;
      const [lo, hi] = band(s);
      for (const side of ['left', 'right'] as const) {
        const dir = side === 'left' ? -1 : 1;
        const expected = side === 'left' ? lo : hi;
        const beyond = expected + dir * 0.5;
        if (inOtherBand({ x: p.x + n.x * beyond, y: p.y + n.y * beyond })) continue;
        if (mouth[side].some(([m0, m1]) => s >= m0 && s <= m1)) continue;
        const delta = drawnEdge(p, n, rings, inD, expected, dir, hi - lo);
        const error = Math.abs(delta);
        if (sides[side]) result.nearM = Math.max(result.nearM, error);
        else result.farM = Math.max(result.farM, error);
        if (error > worst) {
          worst = error;
          result.pair = `${c.a.id}>${c.b.id}`;
          result.signedM = delta;
          result.side = side;
          result.atM = s - c.at;
        }
      }
    });
    // Lanes: each lane of a and b against its nominal offset from C, within APPROACH_M of the
    // node, where the ray crosses the lane polyline within its road's width of that offset.
    for (const [road, before] of [
      [c.a, true],
      [c.b, false],
    ] as const) {
      const source = city.roads[road.id]!;
      let edge = source.lateralOffsetM - roadWidth(source) / 2;
      for (const [i, spec] of source.lanes.entries()) {
        const nominal = edge + spec.widthM / 2;
        edge += spec.widthM;
        const lane = net.lanes[road.lanes[i]!]!;
        for (let k = 1; k * STEP_M <= APPROACH_M; k++) {
          const s = c.at + (before ? -k : k) * STEP_M;
          if (s < 0 || s > total) break;
          const { p, n } = frame(c.line, c.lengths, s);
          const target = nominal + shiftOf(road, s);
          const hit = nearestTo(rayCrossings(p, n, lane.polyline, Math.abs(target) + 8), target);
          if (hit !== null && Math.abs(hit - target) <= roadWidth(source))
            result.laneM = Math.max(result.laneM, Math.abs(hit - target));
        }
      }
    }
  }
  result.laneM = round(result.laneM);
  result.farM = round(result.farM);
  result.nearM = round(result.nearM);
  result.signedM = round(result.signedM);
  result.atM = round(result.atM, 1);
  return result;
}

const SEARCH_M = 12;
/** An expected edge with another road's expected band within 0.5 + this is not an outer edge. */
const BAND_TOLERANCE_M = 1;

/** Signed distance, positive outward (`dir`), from the expected edge to the drawn edge on the ray
 * (see `throughAudit`); ±`SEARCH_M` when the search finds no edge. */
function drawnEdge(
  p: Vec2,
  n: Vec2,
  rings: Vec2[][],
  inD: (p: Vec2) => boolean,
  expected: number,
  dir: number,
  width: number,
): number {
  const reach = Math.abs(expected) + SEARCH_M + width;
  const cuts = [...new Set(rings.flatMap((ring) => rayCrossings(p, n, ring, reach)))].sort(
    (x, y) => x - y,
  );
  const bounds = [-reach, ...cuts, reach];
  const runs: [number, number][] = [];
  for (let k = 1; k < bounds.length; k++) {
    const a = bounds[k - 1]!,
      b = bounds[k]!;
    if (b - a < 1e-9) continue;
    const mid = (a + b) / 2;
    if (!inD({ x: p.x + n.x * mid, y: p.y + n.y * mid })) continue;
    const last = runs.at(-1);
    if (last && Math.abs(last[1] - a) < 1e-9) last[1] = b;
    else runs.push([a, b]);
  }
  const ref = expected - dir * 0.25;
  const outer = (run: [number, number]) => (dir > 0 ? run[1] : run[0]);
  const containing = runs.find(([a, b]) => ref >= a && ref <= b);
  let edge: number | null = containing ? outer(containing) : null;
  if (edge === null) {
    const inward = runs.filter((run) => (outer(run) - ref) * dir < 0);
    if (inward.length)
      edge = outer(inward.reduce((x, y) => (outer(y) * dir > outer(x) * dir ? y : x)));
  }
  if (edge === null) return -SEARCH_M;
  return Math.max(-SEARCH_M, Math.min(SEARCH_M, (edge - expected) * dir));
}

// ---------------------------------------------------------------------------------------------
// 5. Unrelated overlap

export interface UnrelatedOverlap {
  roads: string;
  areaM2: number;
}

/** Measure 5. Pairs of roads of one grade (`layer`, else the lower of their nodes' layers, as the
 * renderer groups them) that share no node and no `streetGroupId`, whose surfaces overlap by more
 * than 0.01 m (`ringsOverlap`); area of 0.25 m cells whose centres lie inside both surfaces. */
export function unrelatedOverlaps(city: City, net: CompiledCity): UnrelatedOverlap[] {
  const items = net.roads.map((road) => {
    const ring = closed(road.surface);
    const xs = ring.map((p) => p.x),
      ys = ring.map((p) => p.y);
    return {
      road,
      ring,
      grade: grade(city, city.roads[road.id]!),
      box: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      },
    };
  });
  const sorted = [...items].sort((a, b) => a.box.minX - b.box.minX);
  const overlaps: UnrelatedOverlap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length && sorted[j]!.box.minX <= a.box.maxX; j++) {
      const b = sorted[j]!;
      if (b.box.minY > a.box.maxY || a.box.minY > b.box.maxY || a.grade !== b.grade) continue;
      const ra = a.road,
        rb = b.road;
      if ([ra.from, ra.to].some((n) => n === rb.from || n === rb.to)) continue;
      if (ra.streetGroupId !== null && ra.streetGroupId === rb.streetGroupId) continue;
      if (!ringsOverlap(prepareRing(a.ring), prepareRing(b.ring), 0.01)) continue;
      const inA = preparePolygon(a.ring, 0),
        inB = preparePolygon(b.ring, 0);
      const minX = Math.max(a.box.minX, b.box.minX),
        maxX = Math.min(a.box.maxX, b.box.maxX),
        minY = Math.max(a.box.minY, b.box.minY),
        maxY = Math.min(a.box.maxY, b.box.maxY);
      let cells = 0;
      for (
        let x = Math.floor((minX - OFFSET_X) / CELL_M + 0.5) * CELL_M + OFFSET_X;
        x <= maxX;
        x += CELL_M
      )
        for (
          let y = Math.floor((minY - OFFSET_Y) / CELL_M + 0.5) * CELL_M + OFFSET_Y;
          y <= maxY;
          y += CELL_M
        )
          if (inA({ x, y }) && inB({ x, y })) cells++;
      const [first, second] = ra.idx < rb.idx ? [ra, rb] : [rb, ra];
      overlaps.push({
        roads: `${first.id}/${second.id}`,
        areaM2: round(cells * CELL_M * CELL_M, 2),
      });
    }
  }
  return overlaps.filter((o) => o.areaM2 > 0).sort((a, b) => (a.roads < b.roads ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// 6. Junction polygon validity and bulge

export interface JunctionShape {
  node: string;
  /** Proper self-crossings of the outline plus those of each curb ring. */
  selfIntersections: number;
  /** Area of outline and curbs farther than `radiusM` from the convex hull of the incident road
   * ends' trimmed corners, m² (0.25 m cells). */
  bulgeM2: number;
  /** The part of `bulgeM2` inside the outline; the rest is curbs only. */
  outlineBulgeM2: number;
  radiusM: number;
}

function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Vec2[]) => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The incident road ends of a node: road, whether it ends there, and its trimmed corners. */
function roadEnds(net: CompiledCity, node: CNode) {
  return net.roads.flatMap((road) =>
    [false, true]
      .filter((atEnd) => (atEnd ? road.to : road.from) === node.idx)
      .map((atEnd) => {
        const [l, r] = surfaceEdges(road);
        return { road, atEnd, corners: atEnd ? [l.at(-1)!, r.at(-1)!] : [l[0]!, r[0]!] };
      }),
  );
}

/** Measure 6 at a node with an outline (bulge 0 at a dead end, whose road ends all lie within
 * 30 degrees of one direction: its outline is a cap). The widening radius is the largest curb
 * class radius (6 m service and residential, 9 m tertiary and secondary, 12 m otherwise, by the
 * lower-ranked road of the pair) over pairs of angularly adjacent road ends 10 to 150 degrees
 * apart; road end directions as in measure 4 (`outward`). */
export function junctionShapeAudit(
  city: City,
  net: CompiledCity,
  node: CNode,
): JunctionShape | null {
  if (!node.outline.length) return null;
  const outline = closed(node.outline);
  // TASK-083: the curbs are part of the outline.
  const curbs: Vec2[][] = [];
  const ends = roadEnds(net, node).map((end) => {
    const d = outward(city, end.road, end.atEnd);
    return { ...end, angle: Math.atan2(d.y, d.x), d };
  });
  ends.sort((a, b) => a.angle - b.angle || a.road.idx - b.road.idx);
  let radius = 0;
  ends.forEach((end, k) => {
    const next = ends[(k + 1) % ends.length]!;
    if (next === end) return;
    const cos = end.d.x * next.d.x + end.d.y * next.d.y;
    if (cos > Math.cos(Math.PI / 18) || cos < OPPOSITE) return;
    const lower = end.road.classRank <= next.road.classRank ? end.road : next.road;
    radius = Math.max(radius, curbRadius(lower.roadClass));
  });
  const selfIntersections =
    polylineSelfCrossings(outline, true) +
    curbs.reduce((sum, ring) => sum + polylineSelfCrossings(ring, true), 0);
  // A dead end (every road end within 30 degrees of one direction) has a cap, not a junction.
  const first = ends[0]!.d;
  if (ends.every((e) => e.d.x * first.x + e.d.y * first.y > ALONG))
    return { node: node.id, selfIntersections, bulgeM2: 0, outlineBulgeM2: 0, radiusM: 0 };
  const hull = closed(convexHull(ends.flatMap((e) => e.corners)));
  const inHull = preparePolygon(hull, 0);
  const distanceToHull = (p: Vec2) => {
    if (inHull(p)) return 0;
    let best = Infinity;
    for (let i = 1; i < hull.length; i++)
      best = Math.min(best, segmentDistance(p, hull[i - 1]!, hull[i]!));
    return best;
  };
  const shapes = [outline, ...curbs].map((ring) => preparePolygon(ring, 0));
  const all = [outline, ...curbs].flat();
  const xs = all.map((p) => p.x),
    ys = all.map((p) => p.y);
  let cells = 0,
    outlineCells = 0;
  for (
    let x = Math.floor((Math.min(...xs) - OFFSET_X) / CELL_M + 0.5) * CELL_M + OFFSET_X;
    x <= Math.max(...xs);
    x += CELL_M
  )
    for (
      let y = Math.floor((Math.min(...ys) - OFFSET_Y) / CELL_M + 0.5) * CELL_M + OFFSET_Y;
      y <= Math.max(...ys);
      y += CELL_M
    ) {
      const p = { x, y };
      if (!shapes.some((test) => test(p)) || distanceToHull(p) <= radius) continue;
      cells++;
      if (shapes[0]!(p)) outlineCells++;
    }
  return {
    node: node.id,
    selfIntersections,
    bulgeM2: round(cells * CELL_M * CELL_M, 2),
    outlineBulgeM2: round(outlineCells * CELL_M * CELL_M, 2),
    radiusM: radius,
  };
}

// ---------------------------------------------------------------------------------------------
// 7. Discontinuities

export interface JoinGap {
  node: string;
  /** Largest distance between the edge points of a movement's two lane ends, m. */
  maxM: number;
  movement: string;
  joins: number;
  /** Joins with a gap over 0.05 m. */
  over: number;
}

function laneEndEdges(lane: CLane, atEnd: boolean): [Vec2, Vec2] {
  const s = atEnd ? lane.lengthM : 0;
  const { p, n } = frame(lane.polyline, lane.cumulative, s);
  const half = lane.widthM / 2;
  return [
    { x: p.x - n.x * half, y: p.y - n.y * half },
    { x: p.x + n.x * half, y: p.y + n.y * half },
  ];
}

/** Measure 7 at a node without an outline (through and continuation joins, where the lane ends
 * should coincide): for every through, merge and diverge movement whose lanes do not taper at the
 * node, the larger of the distances between the left edge points and between the right edge
 * points of its from-lane's end and its to-lane's start (lane end ± half its width along the
 * end's normal). */
export function joinAudit(net: CompiledCity, node: CNode): JoinGap | null {
  if (node.outline.length) return null;
  const result: JoinGap = { node: node.id, maxM: 0, movement: '', joins: 0, over: 0 };
  for (const index of node.movements) {
    const m = net.movements[index]!;
    if (!['through', 'merge', 'diverge'].includes(m.turn)) continue;
    const from = net.lanes[m.fromLane]!,
      to = net.lanes[m.toLane]!;
    if (from.taperEndM > 0 || to.taperStartM > 0) continue;
    const [a, b] = [laneEndEdges(from, true), laneEndEdges(to, false)];
    const gap = Math.max(
      Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y),
      Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y),
    );
    result.joins++;
    if (gap > 0.05) result.over++;
    if (gap > result.maxM) {
      result.maxM = gap;
      result.movement = m.id;
    }
  }
  if (!result.joins) return null;
  result.maxM = round(result.maxM);
  return result;
}

// ---------------------------------------------------------------------------------------------
// 8. Markings

export interface MarkingOffset {
  road: string;
  lines: number;
  /** Largest offset error of a divider or centre line from its lane (T32.3's measure), m. */
  maxM: number;
  /** Lines with an error of 0.05 m or more. */
  over: number;
}

/** Dividers and centre lines `drawRoad` strokes for a road (strokes of the divider width). */
export function markingLines(net: CompiledCity, road: CRoad): Vec2[][] {
  const lines: Vec2[][] = [];
  let pending: Vec2[][] = [];
  let previous = { x: 0, y: 0 };
  const graphics = {
    poly(points: Vec2[]) {
      pending = [points];
      return this;
    },
    fill() {
      pending = [];
      return this;
    },
    stroke({ width }: { width: number }) {
      if (width === style.dividerWidthM) lines.push(...pending);
      pending = [];
      return this;
    },
    moveTo(x: number, y: number) {
      previous = { x, y };
      return this;
    },
    lineTo(x: number, y: number) {
      pending.push([previous, { x, y }]);
      previous = { x, y };
      return this;
    },
  } as unknown as Graphics;
  const ignored = { ...graphics, stroke: () => ignored } as unknown as Graphics;
  drawRoad(ignored, graphics, net, road, false, graphics);
  return lines;
}

/** Station of the nearest point of a lane, and the signed distance to it (right positive). */
function projectOnLane(lane: CLane, p: Vec2) {
  let best = { s: 0, lateral: Infinity };
  for (let i = 1; i < lane.polyline.length; i++) {
    const a = lane.polyline[i - 1]!,
      b = lane.polyline[i]!;
    const d = segmentDistance(p, a, b);
    if (d >= Math.abs(best.lateral)) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(length, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
    best = { s: lane.cumulative[i - 1]! + t, lateral: cross < 0 ? -d : d };
  }
  return best;
}

/** T32.3: the largest |distance to the lane polyline - half the lane width| over a line's vertices
 * and segment midpoints, leaving out points nearest a lane corner (a turn over 25 degrees between
 * the chords 1 m before and after), where a line takes the mitre as lane edges and surfaces do. */
export function lineOffsetError(lane: CLane, line: Vec2[]): number {
  const offset = lane.widthM / 2;
  const at = (s: number) => pointAtDistance(lane.polyline, lane.cumulative, s);
  const corner = (s: number) => {
    const [a, b, c] = [at(s - 1), at(s), at(s + 1)];
    const turn = Math.atan2(
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x),
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y),
    );
    return Math.abs(turn) > (25 * Math.PI) / 180;
  };
  let error = 0;
  const points = line.flatMap((p, i) =>
    i ? [{ x: (p.x + line[i - 1]!.x) / 2, y: (p.y + line[i - 1]!.y) / 2 }, p] : [p],
  );
  for (const p of points) {
    const { s, lateral } = projectOnLane(lane, p);
    if (corner(s)) continue;
    error = Math.max(error, Math.abs(Math.abs(lateral) - offset));
  }
  return error;
}

/** Measure 8 for a road without tapering lanes (as T32.3): each divider and centre line against
 * the lane its first point lies half a lane width from. */
export function markingAudit(
  net: CompiledCity,
  road: CRoad,
  lines = markingLines(net, road),
): MarkingOffset | null {
  const lanes = road.lanes.map((i) => net.lanes[i]!);
  if (lanes.some((l) => l.taperStartM || l.taperEndM)) return null;
  const result: MarkingOffset = { road: road.id, lines: lines.length, maxM: 0, over: 0 };
  for (const line of lines) {
    const gap = (x: CLane) => Math.abs(Math.abs(projectOnLane(x, line[0]!).lateral) - x.widthM / 2);
    const lane = lanes.reduce((best, l) => (gap(l) < gap(best) ? l : best));
    const error = lineOffsetError(lane, line);
    if (error >= 0.05) result.over++;
    result.maxM = Math.max(result.maxM, error);
  }
  result.maxM = round(result.maxM);
  return result;
}

// ---------------------------------------------------------------------------------------------
// 9. Lane overlap (TASK-087)

export interface LaneOverlap {
  roads: string;
  areaM2: number;
  /** The two roads share a `corridorId` (the carriageways of one street). */
  corridor: boolean;
  /** The node nearest to the overlap and its distance from the nearest overlapping point. */
  node: string;
  nodeM: number;
}

/** Edges shared by two lane surfaces (side by side lanes, a lane seam) are not overlap. */
const LANE_TOUCH_M = 0.02;

/** x-intervals of a closed ring on the cell rows (y = OFFSET_Y + k * CELL_M) it spans, by row,
 * shrunk by `inset` at each end (even-odd rule). */
function rowIntervals(ring: readonly Vec2[], inset: number, out: Map<number, number[][]>) {
  const crossings = new Map<number, number[]>();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    if (a.y === b.y) continue;
    const [lo, hi] = a.y < b.y ? [a, b] : [b, a];
    for (let k = Math.ceil((lo.y - OFFSET_Y) / CELL_M); OFFSET_Y + k * CELL_M < hi.y; k++) {
      const y = OFFSET_Y + k * CELL_M;
      const x = lo.x + ((hi.x - lo.x) * (y - lo.y)) / (hi.y - lo.y);
      const row = crossings.get(k);
      if (row) row.push(x);
      else crossings.set(k, [x]);
    }
  }
  for (const [k, xs] of crossings) {
    xs.sort((x, y) => x - y);
    const row = out.get(k) ?? [];
    for (let i = 0; i + 1 < xs.length; i += 2)
      if (xs[i + 1]! - xs[i]! > 2 * inset) row.push([xs[i]! + inset, xs[i + 1]! - inset]);
    out.set(k, row);
  }
}

/** Sorted, merged union of intervals. */
function union(intervals: number[][]): number[][] {
  const sorted = [...intervals].sort((a, b) => a[0]! - b[0]!);
  const out: number[][] = [];
  for (const [x0, x1] of sorted) {
    const last = out.at(-1);
    if (last && x0! <= last[1]!) last[1] = Math.max(last[1]!, x1!);
    else out.push([x0!, x1!]);
  }
  return out;
}

/** The pieces of [x0, x1] outside the sorted, merged `holes`. */
function outside(x0: number, x1: number, holes: number[][]): number[][] {
  const pieces: number[][] = [];
  let from = x0;
  for (const [h0, h1] of holes) {
    if (h1! <= from) continue;
    if (h0! >= x1) break;
    if (h0! > from) pieces.push([from, h0!]);
    from = Math.max(from, h1!);
    if (from >= x1) break;
  }
  if (from < x1) pieces.push([from, x1]);
  return pieces;
}

/** Measure 9. The area where the drawn lane surfaces (`laneEdges`, tapers included, each shrunk
 * by `LANE_TOUCH_M`) of two different roads of one grade overlap outside every node outline,
 * per road pair, except a movement's own from and to roads (their lanes meet end to end) when
 * they are not of one corridor. A u-turn exempts nothing: its two roads run side by side.
 * Same corridor pairs are marked. With `outsideOutlines` false the node outlines are not left out (a
 * lane lying on another under a junction polygon, as zebra stripes there show). Integrated along the 0.25 m cell rows; the nearest
 * node is taken over the midpoints of the overlapping row pieces. */
export function laneOverlaps(city: City, net: CompiledCity, outsideOutlines = true): LaneOverlap[] {
  return [...overlapPieces(city, net, outsideOutlines).values()]
    .map(({ a, b, pieces }) => {
      const [ra, rb] = [net.roads[a]!, net.roads[b]!];
      let node = net.nodes[0]!,
        nodeM = Infinity;
      for (const [x0, x1, y] of pieces)
        for (const n of net.nodes) {
          const d = Math.hypot((x0! + x1!) / 2 - n.pos.x, y! - n.pos.y);
          if (d < nodeM) [node, nodeM] = [n, d];
        }
      return {
        roads: `${ra.id}/${rb.id}`,
        areaM2: round(pieceArea(pieces), 2),
        corridor: sameCorridor(net, a, b),
        node: node.id,
        nodeM: round(nodeM, 1),
      };
    })
    .filter((o) => o.areaM2 > 0)
    .sort((a, b) => (a.roads < b.roads ? -1 : 1));
}

const sameCorridor = (net: CompiledCity, a: number, b: number) =>
  net.roads[a]!.corridorId !== null && net.roads[a]!.corridorId === net.roads[b]!.corridorId;
const pieceArea = (pieces: number[][]) =>
  pieces.reduce((sum, [x0, x1]) => sum + (x1! - x0!) * CELL_M, 0);

/** Measure 9's overlapping row pieces [x0, x1, y] by road pair (compiled indices, a < b); with
 * `anyGrade`, of roads of any grade too. */
function overlapPieces(city: City, net: CompiledCity, outsideOutlines: boolean, anyGrade = false) {
  const lanes = new Map<number, number[][]>(); // row -> [x0, x1, road]
  for (const road of net.roads) {
    const roadLanes = road.lanes.map((i) => net.lanes[i]!);
    for (const lane of roadLanes) {
      const { left, right } = laneEdges(lane, roadLanes);
      const rows = new Map<number, number[][]>();
      rowIntervals([...left, ...right.reverse()], LANE_TOUCH_M, rows);
      for (const [k, intervals] of rows) {
        const row = lanes.get(k) ?? [];
        for (const [a, b] of intervals) row.push([a!, b!, road.idx]);
        lanes.set(k, row);
      }
    }
  }
  const outlines = new Map<number, number[][]>();
  if (outsideOutlines)
    for (const node of net.nodes)
      if (node.outline.length > 2) rowIntervals(node.outline, 0, outlines);
  const joined = new Set(
    net.movements.flatMap((m) => {
      if (m.turn === 'uturn') return [];
      const [a, b] = [net.lanes[m.fromLane]!.road, net.lanes[m.toLane]!.road];
      return [`${a}|${b}`, `${b}|${a}`];
    }),
  );
  const grades = net.roads.map((road) => grade(city, city.roads[road.id]!));
  const pairs = new Map<string, { a: number; b: number; pieces: number[][] }>();
  for (const [k, list] of lanes) {
    const y = OFFSET_Y + k * CELL_M;
    const holes = union(outlines.get(k) ?? []);
    const byRoad = new Map<number, number[][]>();
    for (const [x0, x1, road] of list) {
      const intervals = byRoad.get(road!) ?? [];
      intervals.push([x0!, x1!]);
      byRoad.set(road!, intervals);
    }
    const merged = [...byRoad].flatMap(([road, intervals]) =>
      union(intervals).map(([x0, x1]) => ({ x0: x0!, x1: x1!, road })),
    );
    merged.sort((p, q) => p.x0 - q.x0);
    for (let i = 0; i < merged.length; i++) {
      const p = merged[i]!;
      for (let j = i + 1; j < merged.length && merged[j]!.x0 < p.x1; j++) {
        const q = merged[j]!;
        if (q.road === p.road || (!anyGrade && grades[p.road] !== grades[q.road])) continue;
        if (joined.has(`${p.road}|${q.road}`) && !sameCorridor(net, p.road, q.road)) continue;
        const pieces = outside(q.x0, Math.min(p.x1, q.x1), holes);
        if (!pieces.length) continue;
        const [a, b] = p.road < q.road ? [p.road, q.road] : [q.road, p.road];
        const key = `${a}|${b}`;
        const entry = pairs.get(key) ?? { a, b, pieces: [] };
        for (const [x0, x1] of pieces) entry.pieces.push([x0!, x1!, y]);
        pairs.set(key, entry);
      }
    }
  }
  return pairs;
}

export interface EndOverlap {
  node: string;
  roads: string;
  angleDeg: number;
  /** Measure 9's overlap of the two roads within `END_REACH_M` of the node, outlines included,
   * m2. */
  areaM2: number;
  corridor: boolean;
}

/** TASK-095: road ends compared within this distance of their node and this angle. */
const END_REACH_M = 40;
const END_ANGLE = Math.cos((20 * Math.PI) / 180);

/** Measure 9, by road end (TASK-095, B55): for every two road ends at a node whose outward
 * directions (`outward`) lie within 20 degrees, not the two directions of one street, the area of
 * measure 9's overlap of the two roads within 40 m of the node (0 included), under the node
 * outlines too (a gore drawn over two overlapping lane blocks is the overlap B55 removes), of any
 * grade (the two meet at the node). */
export function endOverlaps(city: City, net: CompiledCity): EndOverlap[] {
  const pieces = overlapPieces(city, net, false, true);
  const out: EndOverlap[] = [];
  for (const node of net.nodes) {
    const ends = net.roads
      .filter((r) => (r.from === node.idx || r.to === node.idx) && r.from !== r.to)
      .map((road) => ({ road, d: outward(city, road, road.to === node.idx) }));
    for (const [i, a] of ends.entries())
      for (const b of ends.slice(i + 1)) {
        const cos = a.d.x * b.d.x + a.d.y * b.d.y;
        if (cos < END_ANGLE) continue;
        if (a.road.streetGroupId !== null && a.road.streetGroupId === b.road.streetGroupId)
          continue;
        const [lo, hi] = a.road.idx < b.road.idx ? [a.road, b.road] : [b.road, a.road];
        let area = 0;
        for (const [x0, x1, y] of pieces.get(`${lo.idx}|${hi.idx}`)?.pieces ?? []) {
          const dy = y! - node.pos.y;
          if (Math.abs(dy) >= END_REACH_M) continue;
          const half = Math.sqrt(END_REACH_M ** 2 - dy * dy);
          area += Math.max(0, Math.min(x1!, node.pos.x + half) - Math.max(x0!, node.pos.x - half));
        }
        out.push({
          node: node.id,
          roads: `${lo.id}/${hi.id}`,
          angleDeg: round((Math.acos(Math.min(1, cos)) * 180) / Math.PI, 1),
          areaM2: round(area * CELL_M, 2),
          corridor: sameCorridor(net, lo.idx, hi.idx),
        });
      }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 11. Corridor voids (TASK-095, B54)

export interface CorridorVoid {
  roads: string;
  /** Void beyond the median between the two carriageways where it is narrower than the gap
   * limit, m2; the widest such gap and the length it spans. */
  areaM2: number;
  maxM: number;
  lengthM: number;
}

/** Measure 11. For two opposite one-way carriageways of one corridor, stations every 0.5 m along
 * A's median-side lane edge (measure 2's `medianEdge`); the gap is the ray crossing of B's median
 * edge nearest A's, toward the median. A station counts where that gap is wider than the median
 * (by more than 0.1 m) and narrower than `ATTACH_GAP_M`, B's edge there runs within 20 degrees
 * of opposite, neither end of the ray lies under a node outline and no other road of the grade
 * crosses the ray (a road between them); its void is the gap less the median. */
export function corridorVoids(city: City, net: CompiledCity): CorridorVoid[] {
  const toward = net.drivingSide === 'left' ? 1 : -1;
  const outlines = net.nodes
    .filter((n) => n.outline.length > 2)
    .map((n) => preparePolygon(closed(n.outline), 0));
  const rings = net.roads.map((road) => {
    const ring = closed(road.surface);
    const xs = ring.map((p) => p.x),
      ys = ring.map((p) => p.y);
    return {
      road,
      ring,
      grade: grade(city, city.roads[road.id]!),
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const,
    };
  });
  const out: CorridorVoid[] = [];
  for (const a of net.roads)
    for (const b of net.roads) {
      if (b.idx <= a.idx || a.streetGroupId !== null || b.streetGroupId !== null) continue;
      if (a.corridorId === null || a.corridorId !== b.corridorId) continue;
      const lineA = medianEdge(net, a),
        lineB = medianEdge(net, b);
      const lengths = cumulativeLengths(lineA);
      const g = rings[a.idx]!.grade;
      let area = 0,
        widest = 0,
        length = 0;
      for (let s = STEP_M / 2; s < lengths.at(-1)!; s += STEP_M) {
        const { p, t, n } = frame(lineA, lengths, s);
        const hit = nearestTo(rayCrossings(p, n, lineB, ATTACH_GAP_M + 1), 0);
        if (hit === null) continue;
        const gap = hit * toward;
        if (gap <= MEDIAN_M + 0.1 || gap >= ATTACH_GAP_M) continue;
        const q = { x: p.x + n.x * hit, y: p.y + n.y * hit };
        const tb = nearestOnPolyline(lineB, q).direction;
        if (t.x * tb.x + t.y * tb.y > -END_ANGLE) continue;
        if (outlines.some((inside) => inside(p) || inside(q))) continue;
        const between = rings.some(
          ({ road, ring, grade: other, box }) =>
            road !== a &&
            road !== b &&
            other === g &&
            Math.max(p.x, q.x) >= box[0] &&
            Math.min(p.x, q.x) <= box[2] &&
            Math.max(p.y, q.y) >= box[1] &&
            Math.min(p.y, q.y) <= box[3] &&
            ring.some((c, i) => i > 0 && properCrossing(p, q, ring[i - 1]!, c)),
        );
        if (between) continue;
        area += (gap - MEDIAN_M) * STEP_M;
        widest = Math.max(widest, gap);
        length += STEP_M;
      }
      if (area > 0)
        out.push({
          roads: `${a.id}/${b.id}`,
          areaM2: round(area, 2),
          maxM: round(widest, 2),
          lengthM: round(length, 1),
        });
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 10. Corner sharpness (TASK-092)

export interface CornerSharpness {
  node: string;
  /** The road ends whose corners the curb joins, in outline order. */
  roads: string;
  /** A corner between two arms, a median nose between two ends running the same way, or the
   * edge joining two ends running into each other (a through road's far side, a step). */
  kind: 'corner' | 'nose' | 'through';
  /** Length of the outline between where it leaves the first road's edge and meets the second's. */
  curbM: number;
  /** Largest turn between consecutive samples of the drawn boundary (the first road's edge, the
   * curb, the second road's edge), degrees; 0.5 m samples, a sixth of the median at a nose. */
  turnDeg: number;
  /** Smallest radius through three samples two apart (1 m at 0.5 m samples), m. */
  radiusM: number;
  /** Corner and through: turns more than 30 degrees between samples, or a curb under 0.5 m where
   * the edges meet at more than 30 degrees. Nose: not rounded (the same turn rule). */
  sharp: boolean;
}

const CORNER_STEP_M = 0.5;
const CORNER_EDGE_M = 2;
const SHARP_DEG = 30;

function resample(line: readonly Vec2[], step: number): Vec2[] {
  const lengths = cumulativeLengths(line);
  const total = lengths.at(-1)!;
  const count = Math.max(1, Math.round(total / step));
  return Array.from({ length: count + 1 }, (_, i) =>
    pointAtDistance(line, lengths, (total * i) / count),
  );
}

function bends(points: readonly Vec2[]) {
  let turn = 0,
    radius = Infinity;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1]!,
      p = points[i]!,
      b = points[i + 1]!;
    const h1 = Math.atan2(p.y - a.y, p.x - a.x),
      h2 = Math.atan2(b.y - p.y, b.x - p.x);
    turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))));
  }
  // The radius through samples two apart: the polyline's chords put single samples millimetres
  // inside an arc, which at 0.5 m spacing reads a 6 m arc as 4.6 m.
  for (let i = 2; i + 2 < points.length; i++) {
    const a = points[i - 2]!,
      p = points[i]!,
      b = points[i + 2]!;
    const area2 = Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x));
    const sides =
      Math.hypot(p.x - a.x, p.y - a.y) *
      Math.hypot(b.x - p.x, b.y - p.y) *
      Math.hypot(b.x - a.x, b.y - a.y);
    if (area2 > 1e-9) radius = Math.min(radius, sides / (2 * area2));
  }
  return { turnDeg: (turn * 180) / Math.PI, radiusM: radius };
}

/** Measure 10 at a node with an outline. Walking the outline, every stretch between corners of two
 * different road ends is a curb: from where it leaves the first end's edge to where it meets the
 * second's (the outline runs out along a road edge to a curb's tangent point and back), with
 * `CORNER_EDGE_M` of each road edge beyond, as drawn. */
export function cornerAudit(city: City, net: CompiledCity, node: CNode): CornerSharpness[] {
  if (!node.outline.length) return [];
  // A dead end (every road end within 30 degrees of one direction, as measure 6) has a cap.
  const outwards = roadEnds(net, node).map((end) => outward(city, end.road, end.atEnd));
  if (outwards.every((d) => d.x * outwards[0]!.x + d.y * outwards[0]!.y > ALONG)) return [];
  const ring = closed(node.outline).slice(0, -1);
  const n = ring.length;
  const corners = roadEnds(net, node).flatMap((end) => {
    const [l, r] = surfaceEdges(end.road);
    const edges = end.atEnd ? [[...l].reverse(), [...r].reverse()] : [l, r];
    // Each corner's place on the outline: the corner, or where its edge comes out from under the
    // outline (a movement surface's end beyond the cut covering it).
    return edges.map((edge, side) => {
      const near = trimPolyline(edge, 0, Math.max(0, cumulativeLengths(edge).at(-1)! - 5));
      let k = -1,
        best = Infinity;
      ring.forEach((p, i) => {
        const hit = nearestOnPolyline(near, p);
        if (hit.away < 0.05 && hit.along < best) [k, best] = [i, hit.along];
      });
      return { end, side, edge, k };
    });
  });
  // Corners on the outline, grouped where they share a vertex (two ends side by side).
  const groups = new Map<number, typeof corners>();
  for (const c of corners) if (c.k >= 0) groups.set(c.k, [...(groups.get(c.k) ?? []), c]);
  const order = [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k)!);
  const surfaces = roadEnds(net, node).map((end) => preparePolygon(closed(end.road.surface), 0.01));
  const inOutline = preparePolygon(closed(node.outline), 0);
  const out: CornerSharpness[] = [];
  const direction = (edge: Vec2[], s: number) => {
    const lengths = cumulativeLengths(edge);
    const total = lengths.at(-1)!;
    const a = pointAtDistance(edge, lengths, Math.min(s, total)),
      b = pointAtDistance(edge, lengths, Math.min(s + 5, total));
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const m = order.length;
  order.forEach((g1, h) => {
    const g2 = order[(h + 1) % m]!;
    if (m < 2 || g1.some((a) => g2.some((b) => a.end === b.end))) return;
    // Of coincident corners, the one whose road end's cut closes in the neighbouring group.
    const pick = (group: typeof corners, other: typeof corners) =>
      group.find((c) => other.some((o) => o.end === c.end)) ?? group[0]!;
    const first = pick(g1, order[(h + m - 1) % m]!),
      second = pick(g2, order[(h + 2) % m]!);
    const path: Vec2[] = [];
    for (let i = first.k; ; i = (i + 1) % n) {
      path.push(ring[i]!);
      if (i === second.k) break;
    }
    const covered = (p: Vec2) => surfaces.some((inside) => inside(p));
    let e1: Vec2[], e2: Vec2[], s1: number, s2: number, curb: Vec2[];
    if (resample(path, 0.25).every(covered)) {
      // Along road surfaces only: the step between a street's two directions cut unequally (not
      // drawn), or a gore, whose tip is where the two edges cross beyond the cuts and drawn where
      // the notch beyond it is open (no road, this node's or another's, covers it).
      const hit = polylineCrossings(first.edge, second.edge)
        .filter((h) => h.alongA > 0.05 && h.alongB > 0.05)
        .sort((a, b) => Math.max(a.alongA, a.alongB) - Math.max(b.alongA, b.alongB))[0];
      if (!hit) return;
      const da = direction(first.edge, hit.alongA),
        db = direction(second.edge, hit.alongB);
      const bisector = { x: da.x + db.x, y: da.y + db.y };
      const l = Math.hypot(bisector.x, bisector.y) || 1;
      const beyond = {
        x: hit.point.x + (0.3 * bisector.x) / l,
        y: hit.point.y + (0.3 * bisector.y) / l,
      };
      if (
        inOutline(beyond) ||
        net.roads.some(
          (road) =>
            road.surface.some((p) => Math.hypot(p.x - beyond.x, p.y - beyond.y) < 200) &&
            preparePolygon(closed(road.surface), 0.01)(beyond),
        )
      )
        return;
      [e1, e2, s1, s2, curb] = [first.edge, second.edge, hit.alongA, hit.alongB, [hit.point]];
    } else {
      // The outline under a road surface (out along a road edge to a curb's tangent point, a
      // movement surface's end beyond a cut) is not drawn: the curb starts where it leaves them.
      let i = 0,
        j = path.length - 1;
      while (i + 1 < j && covered(path[i + 1]!)) i++;
      while (j - 1 > i && covered(path[j - 1]!)) j--;
      // The drawn boundary runs on along the road edge where the curb leaves the roads (usually
      // its corners' own, but a corner under another road is not on the outline).
      const edgeAt = (p: Vec2) =>
        corners.reduce((best, c) =>
          nearestOnPolyline(c.edge, p).away < nearestOnPolyline(best.edge, p).away ? c : best,
        ).edge;
      [e1, e2] = [edgeAt(path[i]!), edgeAt(path[j]!)];
      s1 = nearestOnPolyline(e1, path[i]!).along;
      s2 = nearestOnPolyline(e2, path[j]!).along;
      curb = path.slice(i, j + 1);
    }
    const along = (edge: Vec2[], s: number) => {
      const lengths = cumulativeLengths(edge);
      const to = Math.min(lengths.at(-1)!, s + CORNER_EDGE_M);
      return [
        pointAtDistance(edge, lengths, s),
        ...edge.filter((_, k) => lengths[k]! > s + 1e-6 && lengths[k]! < to - 1e-6),
        pointAtDistance(edge, lengths, to),
      ];
    };
    const drawn = [...along(e1, s1).reverse(), ...curb.slice(1, -1), ...along(e2, s2)];
    const d1 = direction(e1, s1),
      d2 = direction(e2, s2);
    const cos = d1.x * d2.x + d1.y * d2.y;
    const kind = cos > ALONG ? 'nose' : cos < -ALONG ? 'through' : 'corner';
    // Two ends side by side with no median between them (a street's two directions cut unequally,
    // the step under a movement surface's end): no nose.
    const across = (p: Vec2, q: Vec2, d = d1) => Math.abs(d.x * (q.y - p.y) - d.y * (q.x - p.x));
    if (kind === 'nose' && across(path[0]!, path.at(-1)!, direction(first.edge, 0)) < 0.1) return;
    const curbM = cumulativeLengths(curb).at(-1)!;
    // A nose's width: across the edges between where its curve leaves and meets them.
    const gap = across(curb[0]!, curb.at(-1)!);
    const step = kind === 'nose' ? Math.min(CORNER_STEP_M, Math.max(0.02, gap / 6)) : CORNER_STEP_M;
    const { turnDeg, radiusM } = bends(resample(drawn, step));
    // Deflection from the first edge, inward, to the second, outward.
    const deflection = (Math.acos(Math.max(-1, Math.min(1, -cos))) * 180) / Math.PI;
    out.push({
      node: node.id,
      roads: `${first.end.road.id}>${second.end.road.id}`,
      kind,
      curbM: round(curbM, 2),
      turnDeg: round(turnDeg, 1),
      radiusM: round(Math.min(radiusM, 999), 2),
      sharp: turnDeg > SHARP_DEG || (kind === 'corner' && curbM < 0.5 && deflection > SHARP_DEG),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The audit

export interface GeometryAudit {
  widths: RoadWidth[];
  gaps: PairGap[];
  folds: LaneFold[];
  through: ThroughDeviation[];
  overlaps: UnrelatedOverlap[];
  junctions: JunctionShape[];
  joins: JoinGap[];
  markings: MarkingOffset[];
  laneOverlaps: LaneOverlap[];
  endOverlaps: EndOverlap[];
  corners: CornerSharpness[];
  voids: CorridorVoid[];
  /** Marking lengths (TASK-074/079's measure) of the whole city; null for a case. */
  lengths: ReturnType<typeof markingLengths> | null;
  /** Every width sample's error, for percentiles over a set of roads (not written to JSON). */
  widthErrors: Map<string, number[]>;
}

export function auditGeometry(city: City, net: CompiledCity): GeometryAudit {
  const widthErrors = new Map<string, number[]>();
  const widths = net.roads.map((road) => {
    const { audit, errors } = roadWidthAudit(city, net, road);
    widthErrors.set(road.id, errors);
    return audit;
  });
  const zones = new Map(widths.map((w) => [w.road, w.zones]));
  return {
    widths,
    gaps: directionPairs(city, net).map(({ a, b, kind }) => {
      const [za, zb] = [zones.get(a.id)!, zones.get(b.id)!];
      // A's start meets B's end: leave out the longer transition at each end.
      return pairGapAudit(net, a, b, kind, [Math.max(za[0], zb[1]), Math.max(za[1], zb[0])]);
    }),
    folds: net.lanes.map((lane) => laneFoldAudit(city, net, lane)),
    through: net.nodes.flatMap((node) => throughAudit(city, net, node) ?? []),
    overlaps: unrelatedOverlaps(city, net),
    junctions: net.nodes.flatMap((node) => junctionShapeAudit(city, net, node) ?? []),
    joins: net.nodes.flatMap((node) => joinAudit(net, node) ?? []),
    markings: net.roads.flatMap((road) => markingAudit(net, road) ?? []),
    laneOverlaps: laneOverlaps(city, net),
    endOverlaps: endOverlaps(city, net),
    corners: net.nodes.flatMap((node) => cornerAudit(city, net, node)),
    voids: corridorVoids(city, net),
    lengths: markingLengths(net),
    widthErrors,
  };
}

const sum = <T>(items: T[], value: (item: T) => number) =>
  items.reduce((total, item) => total + value(item), 0);
const max = <T>(items: T[], value: (item: T) => number) => Math.max(0, ...items.map(value));

export function totals(audit: GeometryAudit, roads?: Set<string>) {
  const errors = [...audit.widthErrors]
    .filter(([id]) => !roads || roads.has(id))
    .flatMap(([, e]) => e);
  const { widths, gaps, folds, through, overlaps, junctions, joins, markings, laneOverlaps } =
    audit;
  const curbs = audit.corners.filter((c) => c.kind !== 'nose');
  const noses = audit.corners.filter((c) => c.kind === 'nose');
  const corridorLanes = laneOverlaps.filter((o) => o.corridor);
  return {
    widthMaxM: round(max(widths, (w) => w.maxM)),
    widthP95M: round(percentile(errors, 0.95)),
    widthRoadsOver5cm: widths.filter((w) => w.maxM > 0.05).length,
    widthExcludedM: round(
      sum(widths, (w) => w.excludedM),
      1,
    ),
    gapMaxM: round(max(gaps, (g) => g.maxM)),
    gapPairs: gaps.length,
    gapPairsOver2cm: gaps.filter((g) => g.maxM > 0.02).length,
    foldBackSteps: sum(folds, (f) => f.backSteps),
    foldBackStepM: round(
      sum(folds, (f) => f.backStepM),
      2,
    ),
    foldCrossings: sum(folds, (f) => f.crossings),
    foldCusps: sum(folds, (f) => f.cusps),
    throughFarM: round(max(through, (t) => t.farM)),
    throughNearM: round(max(through, (t) => t.nearM)),
    throughLaneM: round(max(through, (t) => t.laneM)),
    throughNodes: through.length,
    throughNodesOver10cm: through.filter((t) => Math.max(t.farM, t.nearM) > 0.1).length,
    overlapM2: round(
      sum(overlaps, (o) => o.areaM2),
      2,
    ),
    overlapPairs: overlaps.length,
    junctionSelfX: sum(junctions, (j) => j.selfIntersections),
    bulgeM2: round(
      sum(junctions, (j) => j.bulgeM2),
      2,
    ),
    outlineBulgeM2: round(
      sum(junctions, (j) => j.outlineBulgeM2),
      2,
    ),
    bulgeNodes: junctions.filter((j) => j.bulgeM2 > 0).length,
    joinGapMaxM: round(max(joins, (j) => j.maxM)),
    joinsOver5cm: sum(joins, (j) => j.over),
    markingMaxM: round(max(markings, (m) => m.maxM)),
    markingLinesOver5cm: sum(markings, (m) => m.over),
    laneOverlapM2: round(
      sum(laneOverlaps, (o) => o.areaM2),
      2,
    ),
    laneOverlapPairs: laneOverlaps.length,
    laneOverlapCorridorM2: round(
      sum(corridorLanes, (o) => o.areaM2),
      2,
    ),
    laneOverlapCorridorPairs: corridorLanes.length,
    endOverlapM2: round(
      sum(audit.endOverlaps, (o) => o.areaM2),
      2,
    ),
    endOverlapPairs: audit.endOverlaps.filter((o) => o.areaM2 > 0).length,
    voidM2: round(
      sum(audit.voids, (v) => v.areaM2),
      2,
    ),
    voidPairs: audit.voids.length,
    cornersSharp: curbs.filter((c) => c.sharp).length,
    // 0.5 m samples read a 2 m arc as 1.97 m.
    cornersUnder2m: curbs.filter((c) => c.kind === 'corner' && c.radiusM < 1.9).length,
    nosesSquare: noses.filter((c) => c.sharp).length,
    noses: noses.length,
    lineOutsideM: audit.lengths?.lineOutsideM ?? null,
    markingOutsideM: audit.lengths?.markingOutsideM ?? null,
  };
}

/** The 20 worst entities of each measure by its main value, ties by id: width and gap by `maxM`,
 * folds by back-step plus cusp length (then crossings), through deviation by the larger of far and
 * near, overlap by area, junctions by self-crossings then bulge, joins by `maxM`, markings by
 * `maxM`. */
export function worst(audit: GeometryAudit, count = 20) {
  const top = <T>(items: T[], value: (item: T) => number, id: (item: T) => string) =>
    items
      .filter((item) => value(item) > 0)
      .sort((a, b) => value(b) - value(a) || (id(a) < id(b) ? -1 : 1))
      .slice(0, count);
  return {
    width: top(
      audit.widths,
      (w) => w.maxM,
      (w) => w.road,
    ),
    gap: top(
      audit.gaps,
      (g) => g.maxM,
      (g) => g.roads,
    ),
    folds: top(
      audit.folds,
      (f) => f.backStepM + f.cuspM + f.crossings / 1e4,
      (f) => f.lane,
    ),
    through: top(
      audit.through,
      (t) => Math.max(t.farM, t.nearM),
      (t) => t.node,
    ),
    overlap: top(
      audit.overlaps,
      (o) => o.areaM2,
      (o) => o.roads,
    ),
    bulge: top(
      audit.junctions,
      (j) => j.bulgeM2 + 1000 * j.selfIntersections,
      (j) => j.node,
    ),
    joins: top(
      audit.joins,
      (j) => j.maxM,
      (j) => j.node,
    ),
    markings: top(
      audit.markings,
      (m) => m.maxM,
      (m) => m.road,
    ),
    laneOverlap: top(
      audit.laneOverlaps,
      (o) => o.areaM2,
      (o) => o.roads,
    ),
    corners: top(
      audit.corners.filter((c) => c.sharp),
      (c) => c.turnDeg,
      (c) => `${c.node} ${c.roads}`,
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Named cases (docs/plan.md "Geometry rework"; ids from the Munich and Sindelfingen imports with
// the junction audit's bboxes). A case's roads are its listed roads and every road at its listed
// nodes; its node measures are taken at its listed nodes only.

export interface GeometryCase {
  id: string;
  city: AuditCity;
  label: string;
  roads: string[];
  nodes: string[];
}

export const geometryCases: GeometryCase[] = [
  {
    id: 'G1',
    city: 'munich',
    label: 'hairpin service roads (round 4 shot 1; round 3 shot 2)',
    roads: ['r:917', 'r:921', 'r:1059', 'r:1060'],
    nodes: ['n:919'],
  },
  {
    id: 'G2',
    city: 'munich',
    label: 'Landsberger Straße T at service road r:777 and the crossing east (round 4 shot 2)',
    roads: [],
    nodes: ['n:774', 'n:719'],
  },
  {
    id: 'B38-munich',
    city: 'munich',
    label: 'folded lane polylines',
    roads: ['r:1025', 'r:1026', 'r:839', 'r:840', 'r:866', 'r:867'],
    nodes: [],
  },
  {
    id: 'B38-sindelfingen',
    city: 'sindelfingen',
    label: 'folded lane polylines',
    roads: ['r:1053', 'r:1054', 'r:1116', 'r:1117'],
    nodes: [],
  },
  {
    id: 'B39',
    city: 'munich',
    label: 'unmarked multi-lane splits and merges',
    roads: [],
    nodes: ['n:312', 'n:305', 'n:201', 'n:194'],
  },
  {
    id: 'Mars',
    city: 'munich',
    label: 'Marsstraße coincident carriageways',
    roads: ['r:368', 'r:480'],
    nodes: [],
  },
  {
    id: 'R3-1',
    city: 'munich',
    label: 'round 3 shot 1: T-junction curbs and markings (Landsberger Straße, Barthstraße)',
    roads: [],
    nodes: ['n:1181'],
  },
  {
    id: 'R3-3',
    city: 'munich',
    label: 'round 3 shot 3: widening step on Arnulfstraße (r:712 to r:953)',
    roads: [],
    nodes: ['n:711'],
  },
  {
    id: 'R3-4',
    city: 'munich',
    label: 'round 3 shot 4: Donnersbergerbrücke carriageway splits',
    roads: [],
    nodes: ['n:312', 'n:308', 'n:726'],
  },
  {
    id: 'R3-5',
    city: 'munich',
    label: 'round 3 shot 5: absorbing merge taper (Donnersbergerbrücke)',
    roads: [],
    nodes: ['n:305'],
  },
  {
    id: 'R3-6',
    city: 'munich',
    label: 'round 3 shot 6: crossing curbs (Arnulfstraße, Donnersbergerstraße, Richelstraße)',
    roads: [],
    nodes: ['n:138'],
  },
  {
    id: 'R3-7',
    city: 'munich',
    label: 'round 3 shot 7: signal curbs and arrows (Arnulfstraße, Marsstraße)',
    roads: [],
    nodes: ['n:949'],
  },
  {
    id: 'R3-8',
    city: 'munich',
    label: 'round 3 shot 8: Y-junction curbs (Marsstraße)',
    roads: [],
    nodes: ['n:823'],
  },
];

export function caseMembers(net: CompiledCity, c: GeometryCase) {
  const nodes = new Set(c.nodes);
  const roads = new Set(c.roads);
  for (const id of c.roads)
    if (net.index.road.get(id as never) === undefined)
      throw new Error(`case ${c.id}: no road ${id}`);
  for (const id of c.nodes) {
    const node = net.index.node.get(id as never);
    if (node === undefined) throw new Error(`case ${c.id}: no node ${id}`);
    for (const road of net.roads) if (road.from === node || road.to === node) roads.add(road.id);
  }
  return { roads, nodes };
}

/** The audit restricted to a case: road measures on its roads, pair measures where either road
 * is one of them, node measures at its nodes, lane measures on its roads' lanes. */
export function caseAudit(net: CompiledCity, audit: GeometryAudit, c: GeometryCase): GeometryAudit {
  const { roads, nodes } = caseMembers(net, c);
  const pair = (ids: string) => ids.split('/').some((id) => roads.has(id));
  return {
    widths: audit.widths.filter((w) => roads.has(w.road)),
    gaps: audit.gaps.filter((g) => pair(g.roads)),
    folds: audit.folds.filter((f) => roads.has(f.lane.split('#')[0]!)),
    through: audit.through.filter((t) => nodes.has(t.node)),
    overlaps: audit.overlaps.filter((o) => pair(o.roads)),
    junctions: audit.junctions.filter((j) => nodes.has(j.node)),
    joins: audit.joins.filter((j) => nodes.has(j.node)),
    markings: audit.markings.filter((m) => roads.has(m.road)),
    laneOverlaps: audit.laneOverlaps.filter((o) => pair(o.roads)),
    endOverlaps: audit.endOverlaps.filter((o) => nodes.has(o.node)),
    corners: audit.corners.filter((c) => nodes.has(c.node)),
    voids: audit.voids.filter((v) => pair(v.roads)),
    lengths: null,
    widthErrors: new Map([...audit.widthErrors].filter(([id]) => roads.has(id))),
  };
}

export function compileCity(name: AuditCity, relaxMaxM?: number) {
  const city = loadAuditCity(name, relaxMaxM);
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
  return { city, net: result.compiled };
}

/** The per-entity records of an audit, as written to JSON. */
function entities(audit: GeometryAudit) {
  const { widths, gaps, folds, through, overlaps, junctions, joins, markings, laneOverlaps } =
    audit;
  const corners = audit.corners.filter((c) => c.sharp || c.radiusM < 1.9);
  const endOverlaps = audit.endOverlaps.filter((o) => o.areaM2 > 0);
  const voids = audit.voids;
  return {
    widths,
    gaps,
    folds,
    through,
    overlaps,
    junctions,
    joins,
    markings,
    laneOverlaps,
    endOverlaps,
    corners,
    voids,
  };
}

function compact(list: object[], key: string, value: string): string {
  return list
    .map((item) => {
      const record = item as Record<string, unknown>;
      return `${String(record[key])} ${String(record[value])}`;
    })
    .join(', ');
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/geometry-audit.ts')) {
  // [out.json] [--relax-max-m <m>]: the second overrides the importer's relaxation cap (TASK-084).
  const args = process.argv.slice(2);
  const flag = args.indexOf('--relax-max-m');
  const relaxMaxM = flag < 0 ? undefined : Number(args[flag + 1]);
  const out = args.find((arg, i) => !arg.startsWith('--') && (flag < 0 || i !== flag + 1));
  const started = performance.now();
  const report: Record<string, unknown> = { cities: {}, cases: {} };
  const cityTotals: Record<string, ReturnType<typeof totals>> = {};
  const caseTotals: Record<string, ReturnType<typeof totals>> = {};
  const caseDetail: Record<string, unknown> = {};
  const lines: string[] = [];
  for (const name of auditCities) {
    const { city, net } = compileCity(name, relaxMaxM);
    const audit = auditGeometry(city, net);
    cityTotals[name] = totals(audit);
    const top = worst(audit);
    (report.cities as Record<string, unknown>)[name] = {
      totals: cityTotals[name],
      lengths: audit.lengths,
      worst: top,
      ...entities(audit),
    };
    lines.push(`${name} worst 20 (id value):`);
    lines.push(`  width maxM: ${compact(top.width, 'road', 'maxM')}`);
    lines.push(`  gap maxM: ${compact(top.gap, 'roads', 'maxM')}`);
    lines.push(
      `  folds backStepM/crossings/cusps/cuspM: ${top.folds.map((f) => `${f.lane} ${f.backStepM}/${f.crossings}/${f.cusps}/${f.cuspM}`).join(', ')}`,
    );
    lines.push(
      `  through far/near/lane: ${top.through.map((t) => `${t.node} ${t.farM}/${t.nearM}/${t.laneM}`).join(', ')}`,
    );
    lines.push(`  overlap m2: ${compact(top.overlap, 'roads', 'areaM2')}`);
    lines.push(
      `  bulge m2 (self-x): ${top.bulge.map((j) => `${j.node} ${j.bulgeM2}${j.selfIntersections ? ` (${j.selfIntersections})` : ''}`).join(', ')}`,
    );
    lines.push(`  joins maxM: ${compact(top.joins, 'node', 'maxM')}`);
    lines.push(`  markings maxM: ${compact(top.markings, 'road', 'maxM')}`);
    lines.push(
      `  lane overlap m2 (corridor *, nearest node m): ${top.laneOverlap.map((o) => `${o.roads}${o.corridor ? '*' : ''} ${o.areaM2} (${o.node} ${o.nodeM})`).join(', ')}`,
    );
    lines.push(
      `  end overlap m2 within 40 m (node, angle): ${audit.endOverlaps
        .filter((o) => o.areaM2 > 0)
        .sort((x, y) => y.areaM2 - x.areaM2)
        .map((o) => `${o.node} ${o.roads}${o.corridor ? '*' : ''} ${o.areaM2} (${o.angleDeg})`)
        .join(', ')}`,
    );
    lines.push(
      `  corridor voids m2 (max m, length m): ${audit.voids.map((v) => `${v.roads} ${v.areaM2} (${v.maxM}, ${v.lengthM})`).join(', ')}`,
    );
    lines.push(
      `  sharp corners turn deg/radius m: ${top.corners.map((c) => `${c.node} ${c.kind} ${c.roads} ${c.turnDeg}/${c.radiusM}`).join(', ')}`,
    );
    for (const c of geometryCases.filter((c) => c.city === name)) {
      const restricted = caseAudit(net, audit, c);
      caseTotals[c.id] = totals(restricted);
      caseDetail[c.id] = { ...c, totals: caseTotals[c.id], ...entities(restricted) };
    }
  }
  report.cases = caseDetail;
  const columns = Object.keys(Object.values(cityTotals)[0]!);
  const half = Math.ceil(columns.length / 2);
  for (const table of [cityTotals, caseTotals])
    for (const part of [columns.slice(0, half), columns.slice(half)])
      console.table(
        Object.fromEntries(
          Object.entries(table).map(([k, v]) => [
            k,
            Object.fromEntries(part.map((c) => [c, v[c as keyof typeof v]])),
          ]),
        ),
      );
  console.info(lines.join('\n'));
  console.info(`geometry audit: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
}
