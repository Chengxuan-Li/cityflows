import { booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  segmentDistance,
  vertexNormals,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Road } from '../schema';
import type { CRoad, Diagnostic } from './types';

// Corridors (TASK-082, docs/plan.md "Geometry rework" stage 2). The roads of one corridor that
// share a source centerline (a two-way street's two directions) share one reference line; every
// lane, lane edge, road edge and taper is a parallel offset of it by arc length: the point at
// station s on any of them lies on the reference line's normal at station s.

/** A stretch where the reference line leaves its source centerline by more than `EASED_NOTE_M`,
 * because an offset the corridor needs exceeds the radius on the inside of a bend. */
export interface Easing {
  fromM: number;
  toM: number;
  /** Largest distance of the source centerline from the reference line there, m. */
  deviationM: number;
  radiusM: number;
  /** The bend could not take the radius its offsets need within the road; its inside edge may
   * still fold. */
  limited: boolean;
}

/** A reference line in some road's travel direction, with the right-hand unit normal at every
 * vertex. */
export interface Reference {
  points: Vec2[];
  lengths: Float64Array;
  normals: Vec2[];
  eased: Easing[];
  /** The largest offset the corridor's lanes and edges take to either side, m. */
  needM: number;
  /** The line runs against the source centerline it was built from (a reverse direction). */
  reversed: boolean;
  /** Index of the road whose centerline the line was built from: roads sharing it have one. */
  source: number;
}

/** Source points closer than this to the previous kept point are dropped. */
const MERGE_M = 0.2;
/** A corner rounded within this distance of the source is resampling, not easing. */
const FILLET_TOLERANCE_M = 0.02;
/** A joint ease (`jointReference`) is at least this long and keeps at least this radius. */
const JOINT_LENGTH_M = 10;
const JOINT_RADIUS_M = 30;
/** Joints that turn more than this are corners, not continuations: no ease. */
const MAX_JOINT_TURN = Math.PI / 4;
/** The ease's shape, `u (1 - u)³ (1 + 3u)`: slope 1 and no curvature at the node (u = 0), back
 * on the line with slope and curvature 0 at u = 1; its largest curvature (at u = 0.24). */
const jointShape = (u: number) => u * (1 - u) ** 3 * (1 + 3 * u);
const JOINT_SHAPE_CURVATURE = 3.9403;
/** An easing that leaves the centerline by more than this is reported (`reference_eased`). */
export const EASED_NOTE_M = 0.05;
const CHORD_TOLERANCE_M = 0.01;
/** Most turning a vertex of the reference line keeps (normal offsets stay within millimetres). */
const MAX_TURN = (4 * Math.PI) / 180;
/** An eased bend's radius exceeds the offset on its inside by this much. */
const MARGIN_M = 0.25;
/** A rounded corner's by this much more, where its segments allow. */
const ROUNDING_MARGIN_M = 0.75;
const TIGHT_RADIUS_M = 30;
/** Spacing limits: where the radius is under `TIGHT_RADIUS_M`, and elsewhere. */
const TIGHT_SPACING_M = 1;
const SPACING_M = 5;
/** How far an eased bend may reach beyond its tight vertices, m. */
const REACH_M = 15;
/** Bends sharper than this cannot be eased by one fillet. */
const MAX_SWEEP = (170 * Math.PI) / 180;

const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const unit = (v: Vec2) => {
  const length = Math.hypot(v.x, v.y);
  return { x: v.x / length, y: v.y / length };
};
/** Signed turn at `b`, positive to the right of travel (clockwise in the y-south frame). */
const turnAt = (a: Vec2, b: Vec2, c: Vec2) => {
  const u = sub(b, a),
    v = sub(c, b);
  return Math.atan2(cross(u, v), dot(u, v));
};

/** Source points merged within `MERGE_M`, and steps under 1 m that turn back more than 90
 * degrees (the smoothing's millimetre back-steps) dropped; both ends kept exactly. */
function clean(source: readonly Vec2[]): Vec2[] {
  const line: Vec2[] = [source[0]!];
  for (let i = 1; i < source.length; i++) {
    const p = source[i]!;
    if (distance(p, line.at(-1)!) < MERGE_M) {
      if (i === source.length - 1) {
        if (line.length > 1) line[line.length - 1] = p;
        else line.push(p);
      }
      continue;
    }
    line.push(p);
    while (line.length >= 3) {
      const [a, b, c] = line.slice(-3) as [Vec2, Vec2, Vec2];
      if (Math.min(distance(a, b), distance(b, c)) >= 1) break;
      if (dot(sub(b, a), sub(c, b)) >= 0) break;
      line.splice(-2, 1);
    }
  }
  return line;
}

/** A circular arc from `entry` along unit `u`, turning by `sweep` (positive to the right) with
 * `radius`, sampled every `MAX_TURN` and at most 1 m, both ends included. */
function arc(entry: Vec2, u: Vec2, sweep: number, radius: number): Vec2[] {
  const sign = Math.sign(sweep);
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(sweep) / MAX_TURN, Math.abs(sweep) * radius)),
  );
  const cx = entry.x - sign * radius * u.y,
    cy = entry.y + sign * radius * u.x;
  const vx = entry.x - cx,
    vy = entry.y - cy;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (sweep * i) / steps;
    return {
      x: cx + vx * Math.cos(a) - vy * Math.sin(a),
      y: cy + vx * Math.sin(a) + vy * Math.cos(a),
    };
  });
}

function lineDistance(p: Vec2, line: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++)
    best = Math.min(best, segmentDistance(p, line[i - 1]!, line[i]!));
  return best;
}

interface Replacement {
  lo: number;
  hi: number;
  points: Vec2[];
  easing?: Omit<Easing, 'fromM' | 'toM'>;
}

/** Splices replacements (sorted, disjoint) into `line`; returns the new line and, for each
 * replacement with an easing, its first and last point. */
function splice(line: Vec2[], replacements: Replacement[]) {
  const out: Vec2[] = [];
  const spans: { first: Vec2; last: Vec2; easing: Omit<Easing, 'fromM' | 'toM'> }[] = [];
  let next = 0;
  for (const r of replacements) {
    out.push(...line.slice(next, r.lo));
    out.push(...r.points);
    if (r.easing) spans.push({ first: r.points[0]!, last: r.points.at(-1)!, easing: r.easing });
    next = r.hi + 1;
  }
  out.push(...line.slice(next));
  return { out, spans };
}

/** The reference line of a source centerline whose corridor needs offsets up to `needLeft` to
 * the left and `needRight` to the right: merged and cleaned, bends whose inside radius is below
 * the offset there eased to a circular arc of that offset plus `MARGIN_M` (bounded by the road's
 * vertices; each easing beyond `EASED_NOTE_M` recorded), other corners rounded within
 * `FILLET_TOLERANCE_M` (a metre wider where that stays within 5 cm), then resampled by curvature
 * (vertices turn at most `MAX_TURN`, chords within `CHORD_TOLERANCE_M`, spacing at most 1 m where
 * the radius is under 30 m and 5 m elsewhere, a longer straight source segment kept whole). Both
 * endpoints are kept exactly. */
export function referenceLine(source: readonly Vec2[], needLeft: number, needRight: number) {
  const need = (sweep: number) => (sweep > 0 ? needRight : needLeft) + MARGIN_M;
  let line = clean(source);
  const spans: ReturnType<typeof splice>['spans'] = [];

  // Pass 1: bends too tight for the corridor's offsets, as runs of vertices turning one way.
  if (line.length >= 3) {
    const n = line.length;
    const turn = line.map((p, i) =>
      i === 0 || i === n - 1 ? 0 : turnAt(line[i - 1]!, p, line[i + 1]!),
    );
    const tight = line.map((p, i) => {
      if (i === 0 || i === n - 1 || Math.abs(turn[i]!) < 1e-9) return false;
      const half = Math.min(distance(line[i - 1]!, p), distance(p, line[i + 1]!)) / 2;
      return half / Math.tan(Math.abs(turn[i]!) / 2) < need(turn[i]!) * 0.99;
    });
    const replacements: Replacement[] = [];
    let fixed = 0;
    for (let i = 1; i < n - 1; i++) {
      if (!tight[i] || i <= fixed) continue;
      const sign = Math.sign(turn[i]!);
      const target = need(turn[i]!);
      let lo = i,
        hi = i;
      while (hi + 1 < n - 1 && tight[hi + 1] && Math.sign(turn[hi + 1]!) === sign) hi++;
      const run = { lo, hi };
      // A run grows (over an S-bend's other half too) up to `REACH_M` beyond its tight vertices.
      const lengths = cumulativeLengths(line);
      const along = (j: number) =>
        lengths[Math.max(j, run.hi)]! - lengths[Math.min(j, run.lo)]! <= REACH_M;
      for (;;) {
        const p = line[lo - 1]!,
          r = line[hi + 1]!;
        const u = unit(sub(line[lo]!, p)),
          v = unit(sub(r, line[hi]!));
        const sweep = Math.atan2(cross(u, v), dot(u, v));
        const usable = Math.sign(sweep) === sign && Math.abs(sweep) < MAX_SWEEP;
        const w = sub(r, p);
        const tIn = usable ? cross(w, v) / cross(u, v) : -1,
          tOut = usable ? cross(u, w) / cross(u, v) : -1;
        const tanHalf = Math.tan(Math.abs(sweep) / 2);
        // An anchor that turns by more than `MAX_TURN` keeps enough of its segment for its own
        // rounding (pass 2) to stay wide enough, or joins the run.
        const room = (j: number) =>
          Math.abs(turn[j]!) > MAX_TURN ? 2 * need(turn[j]!) * Math.tan(Math.abs(turn[j]!) / 2) : 0;
        const tangent = target * tanHalf;
        const inOk = tIn >= tangent + room(lo - 1),
          outOk = tOut >= tangent + room(hi + 1);
        if (inOk && outOk) {
          replacements.push(fillet(lo, hi, p, u, sweep, tIn, target, false));
          break;
        }
        if ((!usable || !inOk) && lo - 1 > fixed && along(lo - 1)) lo--;
        else if ((!usable || !outOk) && hi + 1 < n - 1 && along(hi + 1)) hi++;
        else if (usable && tIn >= tangent && tOut >= tangent) {
          replacements.push(fillet(lo, hi, p, u, sweep, tIn, target, false));
          break;
        } else {
          const radius = usable ? Math.min(tIn, tOut) / tanHalf : 0;
          if (radius > 1e-3)
            replacements.push(fillet(lo, hi, p, u, sweep, tIn, radius, radius < target - MARGIN_M));
          else {
            ({ lo, hi } = run);
            replacements.push({
              lo,
              hi,
              points: line.slice(lo, hi + 1),
              easing: { deviationM: 0, radiusM: 0, limited: true },
            });
          }
          break;
        }
      }
      fixed = hi + 1;
    }
    const spliced = splice(line, replacements);
    line = spliced.out;
    spans.push(...spliced.spans);
  }

  function fillet(
    lo: number,
    hi: number,
    p: Vec2,
    u: Vec2,
    sweep: number,
    tIn: number,
    radius: number,
    limited: boolean,
  ): Replacement {
    const tangent = radius * Math.tan(Math.abs(sweep) / 2);
    const entry = { x: p.x + u.x * (tIn - tangent), y: p.y + u.y * (tIn - tangent) };
    const points = arc(entry, u, sweep, radius);
    const path = [p, ...points, line[hi + 1]!];
    const deviationM = Math.max(...line.slice(lo, hi + 1).map((q) => lineDistance(q, path)));
    const easing =
      limited || deviationM > EASED_NOTE_M ? { deviationM, radiusM: radius, limited } : undefined;
    return { lo, hi, points, easing };
  }

  line = dedupe(line, spans);
  // Pass 2: remaining corners turning more than `MAX_TURN`, each rounded within half of its
  // segments, by the largest radius within the tolerance and at least the offset it needs.
  {
    const replacements: Replacement[] = [];
    for (let i = 1; i < line.length - 1; i++) {
      const a = line[i - 1]!,
        b = line[i]!,
        c = line[i + 1]!;
      const sweep = turnAt(a, b, c);
      if (Math.abs(sweep) <= MAX_TURN) continue;
      const half = Math.abs(sweep) / 2;
      const fit = Math.min(distance(a, b), distance(b, c)) / 2 / Math.tan(half);
      const tolerance = FILLET_TOLERANCE_M / (1 / Math.cos(half) - 1);
      // Where that stays within 5 cm of the corner, the radius is a metre more than the inside
      // offset, so the inside edge does not curl around the centre of its arc.
      const roomy = need(sweep) + ROUNDING_MARGIN_M;
      const floor = roomy * (1 / Math.cos(half) - 1) <= 0.05 ? roomy : need(sweep);
      const radius = Math.min(fit, Math.max(tolerance, floor));
      const u = unit(sub(b, a));
      const tangent = radius * Math.tan(half);
      const points = arc({ x: b.x - u.x * tangent, y: b.y - u.y * tangent }, u, sweep, radius);
      const deviationM = radius * (1 / Math.cos(half) - 1);
      const limited = radius < need(sweep) - MARGIN_M - 1e-9;
      replacements.push({
        lo: i,
        hi: i,
        points,
        easing:
          deviationM > EASED_NOTE_M || limited
            ? { deviationM, radiusM: radius, limited }
            : undefined,
      });
    }
    const spliced = splice(line, replacements);
    line = spliced.out;
    spans.push(...spliced.spans);
  }

  line = dedupe(line, spans);

  // Pass 3: resampling by curvature, greedily keeping the farthest vertex the limits allow.
  const lengths = cumulativeLengths(line);
  const n = line.length;
  const turn = line.map((p, i) =>
    i === 0 || i === n - 1 ? 0 : Math.abs(turnAt(line[i - 1]!, p, line[i + 1]!)),
  );
  const radius = line.map((_, i) =>
    turn[i]! < 1e-9 ? Infinity : (lengths[i + 1]! - lengths[i - 1]!) / 2 / turn[i]!,
  );
  const kept = [0];
  for (let k = 0; k < n - 1;) {
    let best = k + 1;
    let turned = 0,
      tight = false;
    for (let j = k + 2; j < n; j++) {
      turned += turn[j - 1]!;
      tight ||= radius[j - 1]! < TIGHT_RADIUS_M || radius[j]! < TIGHT_RADIUS_M;
      if (turned > MAX_TURN) break;
      if (lengths[j]! - lengths[k]! > (tight ? TIGHT_SPACING_M : SPACING_M)) break;
      let within = true;
      for (let m = k + 1; m < j && within; m++)
        within = segmentDistance(line[m]!, line[k]!, line[j]!) <= CHORD_TOLERANCE_M;
      if (!within) break;
      best = j;
    }
    kept.push(best);
    k = best;
  }
  const points = kept.map((i) => line[i]!);
  const final = cumulativeLengths(points);
  // The station on the final line of a vertex of the pre-resampling line.
  const stationOf = (p: Vec2) => {
    const i = line.indexOf(p);
    let k = 0;
    while (k + 1 < kept.length && kept[k + 1]! <= i) k++;
    if (kept[k] === i || k + 1 >= kept.length) return final[k]!;
    const a = points[k]!,
      chord = unit(sub(points[k + 1]!, a));
    return final[k]! + Math.max(0, Math.min(final[k + 1]! - final[k]!, dot(sub(p, a), chord)));
  };
  // Each easing's deviation, measured against the cleaned source over its stretch.
  const nearest = source.map((q) => nearestOnPolyline(points, q));
  const eased = spans
    .filter(({ first, last }) => line.includes(first) && line.includes(last))
    .map(({ first, last, easing }) => {
      const fromM = stationOf(first),
        toM = stationOf(last);
      const deviationM = Math.max(
        easing.deviationM,
        ...nearest.filter((q) => q.along >= fromM && q.along <= toM).map((q) => q.away),
      );
      return { fromM, toM, ...easing, deviationM };
    });
  return { points, eased };
}

/** `line` without points within a millimetre of the point before, keeping both ends and the
 * first and last points of the easings. */
function dedupe(line: Vec2[], spans: { first: Vec2; last: Vec2 }[]): Vec2[] {
  const marked = new Set(spans.flatMap((s) => [s.first, s.last]));
  const out: Vec2[] = [];
  line.forEach((p, i) => {
    const last = out.at(-1);
    if (!last || distance(p, last) > 1e-3) out.push(p);
    else if ((i === line.length - 1 || marked.has(p)) && out.length > 1) out[out.length - 1] = p;
  });
  return out;
}

const samePoints = (a: readonly Vec2[], b: readonly Vec2[]) =>
  a.length === b.length && a.every((p, i) => distance(p, b[i]!) < 1e-6);

function reference(points: Vec2[], eased: Easing[], needM: number, source: number): Reference {
  return {
    points,
    lengths: cumulativeLengths(points),
    normals: vertexNormals(points),
    eased,
    needM,
    reversed: false,
    source,
  };
}

function reverse(ref: Reference): Reference {
  const total = ref.lengths.at(-1)!;
  return {
    ...ref,
    reversed: !ref.reversed,
    points: [...ref.points].reverse(),
    lengths: Float64Array.from(ref.lengths, (s) => total - s).reverse(),
    normals: ref.normals.map((n) => ({ x: -n.x, y: -n.y })).reverse(),
    eased: ref.eased.map((e) => ({ ...e, fromM: total - e.toM, toM: total - e.fromM })),
  };
}

/** The reference line of every road (by compiled index, `sources` sorted by id), in its travel
 * direction. Roads whose centerlines are equal or reversed share one: a two-way street's two
 * directions (one corridor), and opposite carriageways the source draws on one centerline
 * (which TASK-084 separates), so they stay as coincident as their source. Each easing is
 * reported as a `reference_eased` note. */
export function corridorReferences(sources: readonly Road[], diagnostics: Diagnostic[]) {
  const references: Reference[] = [];
  // Roads between the same two nodes are the candidates for sharing a centerline.
  const byEnds = new Map<string, number[]>();
  const endsKey = (road: Road) => [road.from, road.to].sort().join('|');
  sources.forEach((road, idx) =>
    byEnds.set(endsKey(road), [...(byEnds.get(endsKey(road)) ?? []), idx]),
  );
  sources.forEach((road, idx) => {
    if (references[idx]) return;
    const members = byEnds.get(endsKey(road))!.filter((other) => !references[other]);
    const same = members.filter((o) => samePoints(sources[o]!.centerline, road.centerline));
    const back = members.filter(
      (o) =>
        !same.includes(o) && samePoints([...sources[o]!.centerline].reverse(), road.centerline),
    );
    let needLeft = 0,
      needRight = 0;
    for (const o of [...same, ...back]) {
      const { lateralOffsetM, lanes } = sources[o]!;
      const width = lanes.reduce((sum, lane) => sum + lane.widthM, 0);
      const sign = same.includes(o) ? 1 : -1;
      const edges = [lateralOffsetM - width / 2, lateralOffsetM + width / 2].map((e) => e * sign);
      needLeft = Math.max(needLeft, ...edges.map((e) => -e));
      needRight = Math.max(needRight, ...edges);
    }
    const { points, eased } = referenceLine(road.centerline, needLeft, needRight);
    const forward = reference(points, eased, Math.max(needLeft, needRight), idx);
    for (const o of same) references[o] = forward;
    if (back.length) {
      const backward = reverse(forward);
      for (const o of back) references[o] = backward;
    }
    const ids = [...same, ...back].sort((a, b) => a - b).map((o) => sources[o]!.id);
    for (const e of eased)
      diagnostics.push({
        severity: 'info',
        code: 'reference_eased',
        refs: ids,
        message: e.limited
          ? `The bend of ${road.id} at ${e.fromM.toFixed(1)} to ${e.toM.toFixed(1)} m is too tight for its lanes even when eased to radius ${e.radiusM.toFixed(2)} m (up to ${e.deviationM.toFixed(2)} m off the centerline)`
          : `${road.id} is drawn eased to radius ${e.radiusM.toFixed(2)} m at ${e.fromM.toFixed(1)} to ${e.toM.toFixed(1)} m, up to ${e.deviationM.toFixed(2)} m off its centerline, so its lanes do not fold`,
      });
  });
  return references;
}

/** The road a road continues into (`atEnd`) or from at its node: of the candidates (the roads
 * leaving or entering there), not the road's own other direction (sharing its reference
 * reversed), the one whose reference turns least across the node. A road returning the other
 * way on a centerline of its own (a loop's other half) is a candidate like any other;
 * `jointReference` leaves joints that turn more than 45 degrees alone. */
export function continuingRoad<T extends { idx: number }>(
  references: readonly Reference[],
  road: T,
  candidates: readonly T[],
  atEnd: boolean,
): T | undefined {
  const own = references[road.idx]!;
  const heading = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
  let best: { road: T; turn: number } | undefined;
  for (const other of candidates) {
    if (other === road) continue;
    const ref = references[other.idx]!;
    if (ref.source === own.source && ref.reversed !== own.reversed) continue;
    const a = atEnd ? own : ref,
      b = atEnd ? ref : own;
    const turn = Math.abs(
      Math.atan2(
        Math.sin(heading(b.points[0]!, b.points[1]!) - heading(a.points.at(-2)!, a.points.at(-1)!)),
        Math.cos(heading(b.points[0]!, b.points[1]!) - heading(a.points.at(-2)!, a.points.at(-1)!)),
      ),
    );
    if (!best || turn < best.turn) best = { road: other, turn };
  }
  return best?.road;
}

/** `ref` joined at a through or continuation node to the next road, whose reference passes
 * through `before` (the point before this road's start) or `after` (after its end): the line is
 * eased over `blendM` from the end so that at the node it heads along the bisector of the two
 * roads' end segments (both roads compute the same), both roads' offsets meet there with one
 * normal and their lanes join without a kink or a step. The ease is `blendM` times the tangent
 * of half the turn times `jointShape(x / blendM)`, x the distance from the node; it has no
 * curvature at the node, so the lanes on both sides leave it straight. `blendM` is
 * `JOINT_LENGTH_M`, or what keeps the radius above `JOINT_RADIUS_M` (and the corridor's offsets
 * plus the margin), at most half the road. Joints turning more than 45 degrees are left alone.
 * The node point stays; the largest displacement is returned. */
export function jointReference(ref: Reference, before?: Vec2, after?: Vec2) {
  let line = ref;
  let deviationM = 0;
  for (const atEnd of [false, true]) {
    const outside = atEnd ? after : before;
    if (!outside) continue;
    const { points, lengths, normals } = line;
    const total = lengths.at(-1)!;
    const node = atEnd ? points.at(-1)! : points[0]!;
    // The turn and the end's normal come from `ref`, as the next road computes them, even when
    // this road's other end has been eased already.
    const inner = atEnd ? ref.points.at(-2)! : ref.points[1]!;
    if (distance(node, outside) < 1e-9 || distance(node, inner) < 1e-9) continue;
    // Both in travel direction: the turn from the first segment into the second.
    const turn = atEnd ? turnAt(inner, node, outside) : turnAt(outside, node, inner);
    if (Math.abs(turn) < 1e-6 || Math.abs(turn) > MAX_JOINT_TURN) continue;
    const t = Math.tan(turn / 2);
    // From the unblended line, so both directions of a street ease alike.
    const blendM = Math.min(
      ref.lengths.at(-1)! / 2,
      Math.max(
        JOINT_LENGTH_M,
        Math.abs(t) * JOINT_SHAPE_CURVATURE * Math.max(JOINT_RADIUS_M, ref.needM + MARGIN_M),
      ),
    );
    // Displacement to the right at distance x from the node, so that the line at the node turns
    // by half the joint's turn toward the other road.
    const delta = (x: number) => -t * blendM * jointShape(Math.min(1, x / blendM));
    const steps = Math.max(2, Math.ceil(blendM / Math.min(0.5, blendM / 8)));
    const zone = Array.from({ length: steps }, (_, i) => (blendM * i) / steps);
    const stations = (atEnd ? zone.map((x) => total - x).reverse() : zone).filter(
      (s) => s > 0 && s < total,
    );
    const right = offsetLine(line, stations, 1);
    const moved = offsetLine(line, stations, 0).map((p, i) => {
      const s = stations[i]!;
      const n = right[i]!;
      const d = delta(atEnd ? total - s : s);
      deviationM = Math.max(deviationM, Math.abs(d));
      return { x: p.x + (n.x - p.x) * d, y: p.y + (n.y - p.y) * d };
    });
    const keep = points.filter((_, i) =>
      atEnd ? lengths[i]! < total - blendM : lengths[i]! > blendM,
    );
    const next = atEnd ? [...keep, ...moved, node] : [node, ...moved, ...keep];
    const nextNormals = vertexNormals(next);
    // The other end keeps its normal (it may be a joint's already).
    if (atEnd) nextNormals[0] = normals[0]!;
    else nextNormals[nextNormals.length - 1] = normals.at(-1)!;
    const n = atEnd ? ref.normals.at(-1)! : ref.normals[0]!;
    // The node's normal turned by half the joint's turn (the bisector's normal).
    const half = (atEnd ? 1 : -1) * Math.atan(t);
    nextNormals[atEnd ? next.length - 1 : 0] = {
      x: n.x * Math.cos(half) - n.y * Math.sin(half),
      y: n.x * Math.sin(half) + n.y * Math.cos(half),
    };
    line = { ...line, points: next, lengths: cumulativeLengths(next), normals: nextNormals };
  }
  return { line, deviationM };
}

/** The points `lateral` to the right of `ref` at increasing `stations`: each on the normal at its
 * station, interpolated between the vertex normals (direction and length). */
export function offsetLine(ref: Reference, stations: readonly number[], lateral: number): Vec2[] {
  const { points, lengths, normals } = ref;
  let k = 0;
  return stations.map((s) => {
    while (k < lengths.length - 2 && lengths[k + 1]! < s) k++;
    const span = lengths[k + 1]! - lengths[k]!;
    const t = span > 0 ? Math.max(0, Math.min(1, (s - lengths[k]!) / span)) : 0;
    const a = points[k]!,
      b = points[k + 1]!,
      na = normals[k]!,
      nb = normals[k + 1]!;
    const nx = na.x + (nb.x - na.x) * t,
      ny = na.y + (nb.y - na.y) * t;
    const scale =
      (Math.hypot(na.x, na.y) * (1 - t) + Math.hypot(nb.x, nb.y) * t) / (Math.hypot(nx, ny) || 1);
    return {
      x: a.x + (b.x - a.x) * t + lateral * nx * scale,
      y: a.y + (b.y - a.y) * t + lateral * ny * scale,
    };
  });
}

/** `CRoad.corridorSurface`: the union of the surfaces of a corridor's roads (one road's own when
 * it has no corridor), cleaned by `clipper2-ts`, as outer rings and holes. */
export function corridorSurfaces(roads: CRoad[]): void {
  const groups = new Map<string, CRoad[]>();
  for (const road of roads) {
    const key = road.corridorId ?? `#${road.idx}`;
    groups.set(key, [...(groups.get(key) ?? []), road]);
  }
  for (const members of groups.values()) {
    const union = booleanOpD(
      ClipType.Union,
      members.map((road) => road.surface),
      null,
      FillRule.NonZero,
      3,
    ).map((ring) => ring.map(({ x, y }) => ({ x, y })));
    for (const road of members) road.corridorSurface = union;
  }
}
