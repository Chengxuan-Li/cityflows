import { cumulativeLengths, distance, polylineCrossings } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { SETBACK_CAP_M } from '../../network/junctions';
import type { City, RoadClass } from '../../schema';
import type { OsmRoad } from './roads';

/** The import default of `ImportOptions.relaxMaxM`: off (owner, TASK-131 checkpoint 0; the
 * TASK-084 experiment chose 3 m). */
export const DEFAULT_RELAX_MAX_M = 0;
/** Around a node, within the setback cap plus 5 m, roads meet by design (TASK-084). */
export const JUNCTION_ZONE_M = SETBACK_CAP_M + 5;
/** Each road's capsule reaches this far beyond its lane block. */
export const CLEARANCE_M = 0.3;
/** Largest change of displacement per metre along a road (about 11 degrees). */
const SLOPE = 0.2;
/** Spacing of the points the constraints act on. */
const SPACING_M = 2;
/** Target spacing of the displacement's B-spline control points. */
const CONTROL_M = 6;
const ITERATIONS = 100;
const SWEEPS = 2;
/** Smoothing weight toward the neighbours (second differences of the control displacement). */
const SMOOTH = 0.5;
/** Pull back toward the original position per sweep. */
const SPRING = 0.01;
/** Interaction reach beyond the capsules: a road pushed sideways meets its new neighbours. */
const REACH_M = 10;
/** Segments searched on each side of a contact's initial nearest segment. */
const WINDOW = 12;
/** A road whose largest displacement stays under this is left exactly as it was. */
const MOVED_M = 0.01;

const rank: Record<RoadClass, number> = {
  motorway: 7,
  trunk: 6,
  primary: 5,
  secondary: 4,
  tertiary: 3,
  ramp: 2,
  residential: 1,
  service: 0,
};

/** The polyline with points inserted so no segment is longer than `spacing`. */
export function resample(line: readonly Vec2[], spacing = SPACING_M): Vec2[] {
  const out: Vec2[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const steps = Math.ceil(distance(a, b) / spacing);
    for (let k = 1; k < steps; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
    out.push(b);
  }
  return out;
}

/** Unit right-hand normals (y south: heading (dx, dy) has normal (-dy, dx)) at each vertex,
 * from the chord between its neighbours. */
export function vertexNormals(line: readonly Vec2[]): Vec2[] {
  return line.map((_, i) => {
    const a = line[Math.max(0, i - 1)]!,
      b = line[Math.min(line.length - 1, i + 1)]!;
    const length = distance(a, b) || 1;
    return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  });
}

interface Strand {
  /** Roads on one centerline (both directions of a street, a separated pair); the first gives
   * the direction. */
  sources: OsmRoad[];
  points: Vec2[];
  normals: Vec2[];
  /** The displacement along the normals is a uniform cubic B-spline over the stations: control
   * values, and per point the first control index and the four basis weights. */
  control: Float64Array;
  /** Knot spacing, m. */
  h: number;
  /** Control values held at zero: those reaching into the strand's own junction zones. */
  fixed: Uint8Array;
  first: Int32Array;
  weights: Float64Array;
  /** Points whose displacement is zero by construction (inside the own junction zones). */
  anchored: Uint8Array;
  ends: Vec2[];
  nodes: string[];
  corridors: string[];
  /** Capsule radii to each side of the centerline: lane blocks plus clearance. */
  left: number;
  right: number;
  mobility: number;
  layer: number;
}

/** A point of one strand near the other strand's segment `j` at the start. */
type Contact = { i: number; j: number };

const inZone = (p: Vec2, ends: Vec2[]) => ends.some((end) => distance(p, end) < JUNCTION_ZONE_M);

function offsetAt(strand: Strand, i: number): number {
  const k = strand.first[i]!;
  let s = 0;
  for (let j = 0; j < 4; j++) s += strand.control[k + j]! * strand.weights[4 * i + j]!;
  return s;
}

function at(strand: Strand, i: number): Vec2 {
  const s = offsetAt(strand, i);
  return {
    x: strand.points[i]!.x + strand.normals[i]!.x * s,
    y: strand.points[i]!.y + strand.normals[i]!.y * s,
  };
}

function strands(city: City, roads: OsmRoad[]): Strand[] {
  const groups = new Map<string, OsmRoad[]>();
  for (const source of roads) {
    const { road } = source;
    const forward = road.from < road.to;
    const line = forward ? road.centerline : [...road.centerline].reverse();
    const ends = forward ? `${road.from}|${road.to}` : `${road.to}|${road.from}`;
    const key = `${ends}|${line.map((p) => `${p.x},${p.y}`).join(';')}`;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  return [...groups.values()].map((sources) => {
    const lead = sources[0]!.road;
    const points = resample(lead.centerline);
    const stations = cumulativeLengths(points);
    const total = stations.at(-1)!;
    const ends = [city.nodes[lead.from]!.pos, city.nodes[lead.to]!.pos];
    // The own junction zones as station ranges from each end.
    let start = 0,
      end = total;
    for (const [i, p] of points.entries()) {
      if (distance(p, ends[0]!) < JUNCTION_ZONE_M && stations[i]! < total / 2)
        start = Math.max(start, stations[i]!);
      if (distance(p, ends[1]!) < JUNCTION_ZONE_M && stations[i]! >= total / 2)
        end = Math.min(end, stations[i]!);
    }
    // n control values with knot spacing h cover [-h, total + h]; value k reaches stations
    // [(k - 3) h, (k + 1) h).
    const n = Math.ceil(total / CONTROL_M) + 3;
    const h = total / (n - 3);
    const first = new Int32Array(points.length);
    const weights = new Float64Array(points.length * 4);
    for (let i = 0; i < points.length; i++) {
      const u = stations[i]! / h + 1;
      const k = Math.min(n - 3, Math.floor(u));
      const t = u - k;
      first[i] = k - 1;
      weights.set(
        [
          (1 - t) ** 3 / 6,
          (3 * t ** 3 - 6 * t ** 2 + 4) / 6,
          (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6,
          t ** 3 / 6,
        ],
        4 * i,
      );
    }
    let left = 0,
      right = 0;
    for (const { road } of sources) {
      const half = road.lanes.reduce((w, lane) => w + lane.widthM, 0) / 2;
      const offset = road.from === lead.from ? road.lateralOffsetM : -road.lateralOffsetM;
      right = Math.max(right, offset + half);
      left = Math.max(left, half - offset);
    }
    return {
      sources,
      points,
      normals: vertexNormals(points),
      control: new Float64Array(n),
      h,
      fixed: Uint8Array.from({ length: n }, (_, k) =>
        (k - 3) * h < start || (k + 1) * h > end ? 1 : 0,
      ),
      first,
      weights,
      anchored: Uint8Array.from(stations, (s) => (s <= start || s >= end ? 1 : 0)),
      ends,
      nodes: [lead.from, lead.to],
      corridors: sources.flatMap(({ road }) => road.corridorId ?? []),
      left: left + CLEARANCE_M,
      right: right + CLEARANCE_M,
      mobility: 1 / (1 + Math.max(...sources.map(({ road }) => rank[road.roadClass]))),
      layer: sources[0]!.layer,
    };
  });
}

/** The nearest point of `line` to `p` over segments `from` to `to` (segment `j` ends at
 * vertex `j`), with that segment's unit direction. */
function nearest(line: readonly Vec2[], p: Vec2, from: number, to: number) {
  let best = { d2: Infinity, q: p, j: from, tx: 0, ty: 0 };
  for (let j = Math.max(1, from); j <= Math.min(line.length - 1, to); j++) {
    const a = line[j - 1]!,
      b = line[j]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    if (d2 < best.d2) {
      const length = Math.sqrt(length2);
      best = { d2, q, j, tx: dx / length, ty: dy / length };
    }
  }
  return best;
}

/** Points of `x` (outside the junction zones) within reach of `y` at the start. */
function contacts(x: Strand, y: Strand, ends: Vec2[], reach: number): Contact[] {
  const out: Contact[] = [];
  const xs = y.points.map((p) => p.x),
    ys = y.points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  for (let i = 0; i < x.points.length; i++) {
    const p = x.points[i]!;
    if (p.x < minX - reach || p.x > maxX + reach || p.y < minY - reach || p.y > maxY + reach)
      continue;
    if (x.anchored[i] || inZone(p, ends)) continue;
    const hit = nearest(y.points, p, 1, y.points.length - 1);
    if (hit.d2 < reach * reach) out.push({ i, j: hit.j });
  }
  return out;
}

/** Pushes contact points of `x` out of `y`'s capsule by `x`'s share of the penetration, along
 * their normals; points whose nearest point lies within a junction zone are exempt. Each free
 * control value moves by the mean of its contact points' corrections weighted by its basis
 * weights (a Jacobi position-based projection through the B-spline), which does not amplify
 * corrections next to the fixed values. */
function push(x: Strand, y: Strand, list: Contact[], share: number, ends: Vec2[]) {
  const line = y.points.map((_, j) => at(y, j));
  const sum = new Float64Array(x.control.length),
    weight = new Float64Array(x.control.length);
  for (const { i, j } of list) {
    const p = at(x, i);
    const hit = nearest(line, p, j - WINDOW, j + WINDOW);
    if (inZone(hit.q, ends)) continue;
    const n = x.normals[i]!;
    const d = Math.sqrt(hit.d2);
    // Which side of each centerline the other lies on picks the capsule radii that meet.
    const toward = (hit.q.x - p.x) * n.x + (hit.q.y - p.y) * n.y;
    const away = (p.x - hit.q.x) * -hit.ty + (p.y - hit.q.y) * hit.tx;
    const required = (toward >= 0 ? x.right : x.left) + (away >= 0 ? y.right : y.left);
    if (d >= required) continue;
    const u = d > 1e-9 ? { x: (p.x - hit.q.x) / d, y: (p.y - hit.q.y) / d } : n;
    const delta = share * (required - d) * (u.x * n.x + u.y * n.y);
    for (let k = 0; k < 4; k++) {
      const w = x.weights[4 * i + k]!;
      sum[x.first[i]! + k] = sum[x.first[i]! + k]! + w * delta;
      weight[x.first[i]! + k] = weight[x.first[i]! + k]! + w;
    }
  }
  for (let k = 0; k < x.control.length; k++)
    if (!x.fixed[k] && weight[k]! > 0) x.control[k] = x.control[k]! + sum[k]! / weight[k]!;
}

/** One Jacobi sweep of the control values toward their neighbours' mean (second differences),
 * with a weak pull back to zero. */
function smooth({ control, fixed }: Strand) {
  const next = Float64Array.from(control);
  for (let k = 1; k < control.length - 1; k++)
    if (!fixed[k])
      next[k] =
        control[k]! +
        SMOOTH * ((control[k - 1]! + control[k + 1]!) / 2 - control[k]!) -
        SPRING * control[k]!;
  control.set(next);
}

/** Clamps the control values to `maxM` and to the largest values under them whose slope is at
 * most `SLOPE` (each side of zero separately, two passes); the B-spline keeps both bounds. */
function limit({ control, fixed, h }: Strand, maxM: number) {
  for (const sign of [1, -1]) {
    const part = Float64Array.from(control, (c, k) =>
      fixed[k] ? 0 : Math.min(maxM, Math.max(0, sign * c)),
    );
    for (let k = 1; k < part.length; k++) part[k] = Math.min(part[k]!, part[k - 1]! + SLOPE * h);
    for (let k = part.length - 2; k >= 0; k--)
      part[k] = Math.min(part[k]!, part[k + 1]! + SLOPE * h);
    for (let k = 0; k < part.length; k++) if (sign * control[k]! >= 0) control[k] = sign * part[k]!;
  }
}

/**
 * Relaxation of overlapping roads (TASK-084, after smoothing, realignment and separation). Each
 * strand (the roads on one centerline) is a capsule: its centerline, its lane blocks plus
 * `CLEARANCE_M`. Pairs of one grade that share no node, belong to no common corridor and do not
 * cross are pushed apart where their capsules overlap outside the junction zones of their end
 * nodes, by position-based constraints on interior points every 2 m, along their normals, the
 * lower class taking the larger share (mobility 1 / (1 + class rank)). The displacement is a
 * cubic B-spline over control values about 6 m apart, so it is smooth by construction; those
 * reaching into a strand's own junction zones stay at zero, so nodes and road mouths do not
 * move. Each iteration applies the constraints in strand order, smooths the control values
 * (second differences, a weak pull to zero) and clamps them to `maxM` and their slope to
 * `SLOPE`. A fixed iteration count and order make it deterministic. Moved roads get the
 * resampled, displaced centerline and `relaxed:<largest displacement>`.
 */
export function relaxRoads(city: City, roads: OsmRoad[], maxM: number): void {
  if (!(maxM > 0)) return;
  const all = strands(city, roads);
  const margin = 2 * Math.min(maxM, REACH_M);
  const boxes = all.map((strand) => {
    const xs = strand.points.map((p) => p.x),
      ys = strand.points.map((p) => p.y);
    const grow = strand.left + strand.right + margin;
    return {
      minX: Math.min(...xs) - grow,
      minY: Math.min(...ys) - grow,
      maxX: Math.max(...xs) + grow,
      maxY: Math.max(...ys) + grow,
    };
  });
  const pairs: { a: Strand; b: Strand; ab: Contact[]; ba: Contact[]; ends: Vec2[] }[] = [];
  for (const [i, a] of all.entries())
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!;
      const [boxA, boxB] = [boxes[i]!, boxes[j]!];
      if (
        boxA.minX > boxB.maxX ||
        boxB.minX > boxA.maxX ||
        boxA.minY > boxB.maxY ||
        boxB.minY > boxA.maxY
      )
        continue;
      if (a.layer !== b.layer || a.nodes.some((n) => b.nodes.includes(n))) continue;
      if (a.corridors.some((c) => b.corridors.includes(c))) continue;
      const ends = [...a.ends, ...b.ends];
      const reach = Math.max(a.left, a.right) + Math.max(b.left, b.right) + margin;
      const ab = contacts(a, b, ends, reach),
        ba = contacts(b, a, ends, reach);
      if (!ab.length && !ba.length) continue;
      // Roads crossing at one grade without a node are a data error that pushing cannot fix.
      if (polylineCrossings(a.points, b.points).some(({ point }) => !inZone(point, ends))) continue;
      pairs.push({ a, b, ab, ba, ends });
    }
  const active = [...new Set(pairs.flatMap(({ a, b }) => [a, b]))];
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (const { a, b, ab, ba, ends } of pairs) {
      const share = a.mobility / (a.mobility + b.mobility);
      push(a, b, ab, share, ends);
      push(b, a, ba, 1 - share, ends);
    }
    for (const strand of active) {
      for (let k = 0; k < SWEEPS; k++) smooth(strand);
      limit(strand, maxM);
    }
  }
  for (const strand of active) {
    const offsets = strand.points.map((_, i) => offsetAt(strand, i));
    const largest = Math.max(...offsets.map(Math.abs));
    if (largest < MOVED_M) continue;
    const line = strand.points.map((_, i) => at(strand, i));
    line[0] = strand.ends[0]!;
    line[line.length - 1] = strand.ends[1]!;
    for (const { road } of strand.sources) {
      road.centerline = road.from === strand.nodes[0] ? line : [...line].reverse();
      road.provenance = {
        ...road.provenance,
        inferred: [...road.provenance.inferred!, `relaxed:${largest.toFixed(2)}`],
      };
    }
  }
}
