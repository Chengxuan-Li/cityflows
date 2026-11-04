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
