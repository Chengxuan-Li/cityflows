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

/** The line at a constant distance `offset` from `points` (positive to the right in the y-south
 * frame), joined like `offsetPolyline` (a mitre on the angle bisector, two points past 120
 * degrees) so it stays parallel to lanes and surfaces built by it. `offsetPolyline` throws a
 * vertex up to twice the offset off at a reversed millimetre step or a short segment between
 * two bends; here vertices closer than 0.1 m merge and a step under 1 m that turns back more
 * than 90 degrees (a cusp) is dropped before offsetting, and points that land nearer the line
 * than the offset (offset segments reversed inside a tight bend) are dropped after. */
export function parallelOffset(points: readonly Vec2[], offset: number): Vec2[] {
  const line: Vec2[] = [];
  for (const point of points) {
    if (!line.length || distance(point, line.at(-1)!) >= 0.1) line.push(point);
    else if (point === points.at(-1) && line.length > 1) line[line.length - 1] = point;
    while (line.length >= 3) {
      const [a, b, c] = line.slice(-3) as [Vec2, Vec2, Vec2];
      if (Math.min(distance(a, b), distance(b, c)) >= 1) break;
      if ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) break;
      line.splice(-2, 1);
    }
  }
  if (offset === 0 || line.length < 2) return line;
  const lengths = cumulativeLengths(line);
  const normals = line.slice(1).map((point, i) => {
    const prev = line[i]!;
    const len = distance(point, prev);
    return { x: (prev.y - point.y) / len, y: (point.x - prev.x) / len };
  });
  const out: { p: Vec2; at: number }[] = [];
  const push = (at: number, n: Vec2, scale = 1) =>
    out.push({
      p: { x: line[at]!.x + offset * scale * n.x, y: line[at]!.y + offset * scale * n.y },
      at,
    });
  push(0, normals[0]!);
  for (let i = 1; i < line.length - 1; i++) {
    const before = normals[i - 1]!,
      after = normals[i]!;
    const denominator = 1 + before.x * after.x + before.y * after.y;
    if (denominator < 0.5) {
      push(i, before);
      push(i, after);
    } else push(i, { x: before.x + after.x, y: before.y + after.y }, 1 / denominator);
  }
  push(line.length - 1, normals.at(-1)!);
  const reach = Math.abs(offset) * 4 + 1;
  const tooNear = (p: Vec2, j: number) =>
    segmentDistance(p, line[j - 1]!, line[j]!) < Math.abs(offset) - 1e-3;
  return out
    .filter(({ p, at }, k) => {
      if (k === 0 || k === out.length - 1) return true;
      for (let j = at; j > 0 && lengths[at]! - lengths[j]! < reach; j--)
        if (tooNear(p, j)) return false;
      for (let j = at + 1; j < line.length && lengths[j - 1]! - lengths[at]! < reach; j++)
        if (tooNear(p, j)) return false;
      return true;
    })
    .map(({ p }) => p);
}

/** Distance from `p` to the segment `a`-`b`. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
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
