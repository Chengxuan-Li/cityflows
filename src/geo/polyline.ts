import type { Vec2 } from './vec2';

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function cumulativeLengths(points: readonly Vec2[]): Float64Array {
  const lengths = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    lengths[i] = lengths[i - 1]! + distance(points[i - 1]!, points[i]!);
  }
  return lengths;
}

export function polylineLength(points: readonly Vec2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distance(points[i - 1]!, points[i]!);
  return length;
}

function segmentAtDistance(lengths: Float64Array, position: number): number {
  let start = 0;
  let end = lengths.length - 1;
  while (end - start > 1) {
    const mid = Math.floor((start + end) / 2);
    if (lengths[mid]! <= position) start = mid;
    else end = mid;
  }
  while (start > 0 && lengths[start] === lengths[start + 1]) start--;
  return start;
}

export function pointAtDistance(
  points: readonly Vec2[],
  lengths: Float64Array,
  position: number,
): Vec2 {
  if (position <= 0) return points[0]!;
  if (position >= lengths.at(-1)!) return points.at(-1)!;
  const i = segmentAtDistance(lengths, position);
  const fraction = (position - lengths[i]!) / (lengths[i + 1]! - lengths[i]!);
  const a = points[i]!;
  const b = points[i + 1]!;
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

export function headingAtDistance(
  points: readonly Vec2[],
  lengths: Float64Array,
  position: number,
): number {
  const i = segmentAtDistance(lengths, Math.max(0, position));
  const a = points[i]!;
  const b = points[i + 1]!;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function offsetPolyline(points: readonly Vec2[], offset: number): Vec2[] {
  const line = points.filter((point, i) => i === 0 || distance(point, points[i - 1]!) > 0);
  if (offset === 0 || line.length < 2) return line;
  const normals = line.slice(1).map((point, i) => {
    const prev = line[i]!;
    const len = distance(point, prev);
    return { x: (prev.y - point.y) / len, y: (point.x - prev.x) / len };
  });
  const shifted = (p: Vec2, n: Vec2) => ({ x: p.x + offset * n.x, y: p.y + offset * n.y });
  return line.flatMap((point, i) => {
    if (i === 0) return [shifted(point, normals[0]!)];
    const before = normals[i - 1]!;
    const after = normals[i];
    if (!after) return [shifted(point, before)];
    const denominator = 1 + before.x * after.x + before.y * after.y;
    // The squared miter-to-offset ratio is 2 / denominator.
    if (denominator < 0.5) return [shifted(point, before), shifted(point, after)];
    return [
      shifted(point, {
        x: (before.x + after.x) / denominator,
        y: (before.y + after.y) / denominator,
      }),
    ];
  });
}

export function trimPolyline(points: readonly Vec2[], startM: number, endM: number): Vec2[] {
  const lengths = cumulativeLengths(points);
  const stop = lengths.at(-1)! - endM;
  return [
    pointAtDistance(points, lengths, startM),
    ...points.filter((_, i) => lengths[i]! > startM && lengths[i]! < stop),
    pointAtDistance(points, lengths, stop),
  ];
}

export function sampleBezier(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2[] {
  const segments = Math.max(3, Math.ceil(distance(a, b) + distance(b, c) + distance(c, d)));
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
  });
}

function side(a: Vec2, b: Vec2, p: Vec2): number {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return Math.abs(cross) < 1e-9 ? 0 : Math.sign(cross);
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false;
  return side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0;
}

/** Unique intersection of two closed segments; parallel/collinear segments have none. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const ax = b.x - a.x,
    ay = b.y - a.y;
  const bx = d.x - c.x,
    by = d.y - c.y;
  const cross = ax * by - ay * bx;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((c.x - a.x) * by - (c.y - a.y) * bx) / cross;
  const u = ((c.x - a.x) * ay - (c.y - a.y) * ax) / cross;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + t * ax, y: a.y + t * ay };
}

/** Circular arc including both ends, with at most one meter between samples. */
export function sampleArc(center: Vec2, radius: number, start: number, sweep: number): Vec2[] {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) * radius));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = start + (sweep * i) / steps;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

/** A tangent circular fillet for a noncollinear corner, with a sample at its midpoint. */
export function circularFillet(a: Vec2, b: Vec2, c: Vec2, targetRadius: number, minimumRadius = 0) {
  const before = distance(a, b);
  const after = distance(b, c);
  if (before === 0 || after === 0) return;
  const ux = (b.x - a.x) / before;
  const uy = (b.y - a.y) / before;
  const vx = (c.x - b.x) / after;
  const vy = (c.y - b.y) / after;
  const cross = ux * vy - uy * vx;
  // Straight segments need no fillet, and a reversal has no unique tangent circle.
  if (Math.abs(cross) < 1e-9) return;
  const sweep = Math.atan2(cross, ux * vx + uy * vy);
  const half = Math.abs(sweep) / 2;
  const tangentPerRadius = Math.tan(half);
  // The corner's nearest point on the arc is on the bisector: R * (sec(half) - 1).
  const deviationPerRadius = (2 * Math.sin(half / 2) ** 2) / Math.cos(half);
  const radius = Math.min(
    targetRadius,
    Math.min(before, after) / (2 * tangentPerRadius),
    2 / deviationPerRadius,
  );
  // A fillet tighter than the road is wide would fold its inner lanes; keep the corner.
  if (radius < minimumRadius) return;
  const tangent = radius * tangentPerRadius;
  const entry = { x: b.x - tangent * ux, y: b.y - tangent * uy };
  const exit = { x: b.x + tangent * vx, y: b.y + tangent * vy };
  const sign = Math.sign(sweep);
  // One-degree steps also keep the sampled headings continuous at the joins.
  const steps = 2 * Math.ceil(Math.max((radius * half) / 2, (half * 180) / Math.PI));
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (sweep * i) / steps;
    const along = radius * sign * Math.sin(angle);
    const across = radius * sign * 2 * Math.sin(angle / 2) ** 2;
    return {
      x: entry.x + along * ux - across * uy,
      y: entry.y + along * uy + across * ux,
    };
  });
  points[steps] = exit;
  return { points, radius };
}

/** `pointInPolygon` for many points against one ring: edges are bucketed by y, so a query
 * tests only the edges that can span or touch its y. Same expressions, same answers. */
export function preparePolygon(ring: readonly Vec2[], tolerance = 1e-6) {
  let minY = Infinity,
    maxY = -Infinity;
  for (const p of ring) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const count = Math.max(1, Math.min(256, ring.length));
  const size = Math.max((maxY - minY + 2 * tolerance) / count, 1e-9);
  const base = minY - tolerance;
  const buckets: number[][] = Array.from({ length: count }, () => []);
  const bucket = (y: number) => Math.min(count - 1, Math.max(0, Math.floor((y - base) / size)));
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!,
      b = ring[i]!;
    const low = bucket(Math.min(a.y, b.y) - tolerance),
      high = bucket(Math.max(a.y, b.y) + tolerance);
    for (let k = low; k <= high; k++) buckets[k]!.push(i);
  }
  return (point: Vec2): boolean => {
    if (point.y < minY - tolerance || point.y > maxY + tolerance) return false;
    let contains = false;
    for (const i of buckets[bucket(point.y)]!) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      const t =
        length2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
      if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance) return true;
      if (a.y > point.y !== b.y > point.y && point.x < a.x + (dx * (point.y - a.y)) / dy)
        contains = !contains;
    }
    return contains;
  };
}

export function pointInPolygon(point: Vec2, ring: readonly Vec2[], tolerance = 1e-6): boolean {
  let contains = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!,
      b = ring[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance) return true;
    if (a.y > point.y !== b.y > point.y && point.x < a.x + (dx * (point.y - a.y)) / dy)
      contains = !contains;
  }
  return contains;
}

/** Every crossing of two polylines: the point, the distance along each from its start, and
 * the index of the crossing segment's end vertex in each. */
export function polylineCrossings(a: readonly Vec2[], b: readonly Vec2[]) {
  const lengthsA = cumulativeLengths(a),
    lengthsB = cumulativeLengths(b);
  const crossings: { point: Vec2; alongA: number; alongB: number; i: number; j: number }[] = [];
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!,
      q = a[i]!;
    for (let j = 1; j < b.length; j++) {
      const r = b[j - 1]!,
        s = b[j]!;
      if (
        Math.max(p.x, q.x) < Math.min(r.x, s.x) ||
        Math.max(r.x, s.x) < Math.min(p.x, q.x) ||
        Math.max(p.y, q.y) < Math.min(r.y, s.y) ||
        Math.max(r.y, s.y) < Math.min(p.y, q.y)
      )
        continue;
      const point = segmentIntersection(p, q, r, s);
      if (point)
        crossings.push({
          point,
          alongA: lengthsA[i - 1]! + distance(p, point),
          alongB: lengthsB[j - 1]! + distance(r, point),
          i,
          j,
        });
    }
  }
  return crossings;
}

/** Cubic Bezier from `a` to `d` with controls `b`, `c`, about one sample per meter plus dense
 * samples at both ends, so its first and last chords follow the end tangents to a degree. */
export function sampleCubic(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2[] {
  const steps = Math.max(4, Math.ceil(distance(a, b) + distance(b, c) + distance(c, d)));
  const ends = [0.001, 0.004, 0.01, 0.02].filter((t) => t < 0.5 / steps);
  const ts = [
    0,
    ...ends,
    ...Array.from({ length: steps - 1 }, (_, i) => (i + 1) / steps),
    ...ends.map((t) => 1 - t).reverse(),
    1,
  ];
  return ts.map((t) => {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return {
      x: w[0]! * a.x + w[1]! * b.x + w[2]! * c.x + w[3]! * d.x,
      y: w[0]! * a.y + w[1]! * b.y + w[2]! * c.y + w[3]! * d.y,
    };
  });
}

/** The parts of `line` that are not deeper than `margin` inside any closed ring; a part lying
 * on or near a ring's boundary is kept. */
export function clipOutside(line: readonly Vec2[], rings: readonly Vec2[][], margin: number) {
  const boxes = rings.map((ring) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  });
  const deep = (p: Vec2) =>
    rings.some((ring, k) => {
      const box = boxes[k]!;
      if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) return false;
      return deepInside(p, ring, margin);
    });
  const pieces: Vec2[][] = [];
  let current: Vec2[] = [];
  const keep = (p: Vec2) => {
    const last = current.at(-1);
    if (!last || distance(last, p) > 1e-9) current.push(p);
  };
  const flush = () => {
    if (current.length > 1) pieces.push(current);
    current = [];
  };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const ts = [0, 1];
    rings.forEach((ring, k) => {
      const box = boxes[k]!;
      if (
        Math.max(a.x, b.x) < box.minX ||
        Math.min(a.x, b.x) > box.maxX ||
        Math.max(a.y, b.y) < box.minY ||
        Math.min(a.y, b.y) > box.maxY
      )
        return;
      for (let j = 1; j < ring.length; j++) {
        const hit = segmentIntersection(a, b, ring[j - 1]!, ring[j]!);
        if (hit) ts.push(distance(a, hit) / Math.max(distance(a, b), 1e-12));
      }
    });
    ts.sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1]!,
        t1 = ts[k]!;
      if (t1 - t0 < 1e-9) continue;
      const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      if (deep(at((t0 + t1) / 2))) {
        flush();
        continue;
      }
      keep(at(t0));
      keep(at(t1));
    }
  }
  flush();
  return pieces;
}

/** Inside a closed ring and farther than `margin` from its boundary. */
export function deepInside(p: Vec2, ring: readonly Vec2[], margin: number): boolean {
  return pointInPolygon(p, ring, 0) && !nearBoundary(p, ring, margin);
}

function nearBoundary(p: Vec2, ring: readonly Vec2[], margin: number): boolean {
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!,
      b = ring[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= margin) return true;
  }
  return false;
}

/** The point of a polyline nearest to `p`, its distance along the polyline, and the direction
 * of the segment it lies on (at a vertex, the segment ending there). */
export function nearestOnPolyline(points: readonly Vec2[], p: Vec2) {
  let best = { point: points[0]!, along: 0, away: Infinity, direction: { x: 1, y: 0 } };
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const t =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length ** 2));
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const away = distance(p, point);
    if (away < best.away && length > 0)
      best = {
        point,
        along: run + t * length,
        away,
        direction: { x: dx / length, y: dy / length },
      };
    run += length;
  }
  return best;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boxOf(points: readonly Vec2[], from = 0, to = points.length): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = from; i < to; i++) {
    const p = points[i]!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

const boxesMeet = (a: Box, b: Box) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** A closed ring with its bounding box and the boxes of runs of 32 edges (edge `i` runs from
 * vertex `i - 1` to `i`), for `ringsOverlap`. */
export function prepareRing(ring: Vec2[]) {
  const runs: { from: number; to: number; box: Box }[] = [];
  for (let from = 1; from < ring.length; from += 32) {
    const to = Math.min(ring.length, from + 32);
    runs.push({ from, to, box: boxOf(ring, from - 1, to) });
  }
  return { ring, box: boxOf(ring), runs };
}
export type PreparedRing = ReturnType<typeof prepareRing>;

/** Even-odd test along a ray toward +x, over the runs the ray can cross. */
function insideRing({ ring, runs }: PreparedRing, p: Vec2): boolean {
  let inside = false;
  for (const run of runs) {
    if (run.box.maxX < p.x || run.box.minY > p.y || run.box.maxY < p.y) continue;
    for (let i = run.from; i < run.to; i++) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y))
        inside = !inside;
    }
  }
  return inside;
}

/** Whether two closed rings overlap: part of either boundary lies inside the other ring and
 * farther than `margin` from its boundary. Rings that touch or share an edge do not. */
export function ringsOverlap(a: PreparedRing, b: PreparedRing, margin: number): boolean {
  return deepBoundary(a, b, margin) || deepBoundary(b, a, margin);
}

/** The edges of a prepared ring whose boxes meet `box`. */
function edgesNear({ ring, runs }: PreparedRing, box: Box): number[] {
  const edges: number[] = [];
  for (const run of runs) {
    if (!boxesMeet(run.box, box)) continue;
    for (let i = run.from; i < run.to; i++)
      if (boxesMeet(boxOf(ring, i - 1, i + 1), box)) edges.push(i);
  }
  return edges;
}

function deepBoundary(of: PreparedRing, within: PreparedRing, margin: number): boolean {
  const line = of.ring,
    ring = within.ring;
  const inside = (p: Vec2) => insideRing(within, p);
  const grown = (b: Box) => ({
    minX: b.minX - margin,
    minY: b.minY - margin,
    maxX: b.maxX + margin,
    maxY: b.maxY + margin,
  });
  const outer = grown(within.box);
  // Only ring edges near the line can be within the margin of a point on it.
  const near = edgesNear(within, grown(of.box));
  // No ring edge near the line: the whole line lies on one side of the ring, beyond the margin.
  if (!near.length) return inside(line[0]!);
  const deep = (p: Vec2) => {
    if (p.x < outer.minX || p.x > outer.maxX || p.y < outer.minY || p.y > outer.maxY) return false;
    if (!inside(p)) return false;
    for (const i of near) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      const t =
        length2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
      if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= margin) return false;
    }
    return true;
  };
  for (const k of edgesNear(of, outer)) {
    const p = line[k - 1]!,
      q = line[k]!;
    const ts = [0, 1];
    for (const i of near) {
      const hit = segmentIntersection(p, q, ring[i - 1]!, ring[i]!);
      if (hit) ts.push(distance(p, hit) / Math.max(distance(p, q), 1e-12));
    }
    ts.sort((x, y) => x - y);
    const at = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    if (deep(p)) return true;
    for (let j = 1; j < ts.length; j++)
      if (ts[j]! - ts[j - 1]! > 1e-9 && deep(at((ts[j - 1]! + ts[j]!) / 2))) return true;
  }
  return false;
}
