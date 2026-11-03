import { polylineLength } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { OsmWay } from './parse';

export interface Bounds {
  min: Vec2;
  max: Vec2;
}

export interface RoadPoint {
  key: string;
  osmId?: number;
  pos: Vec2;
}

export interface ClippedPart {
  points: RoadPoint[];
  cutStart: boolean;
  cutEnd: boolean;
}

export function contains({ min, max }: Bounds, { x, y }: Vec2): boolean {
  return x >= min.x && x <= max.x && y >= min.y && y <= max.y;
}

// Ways can end at a shared boundary node even when the street continues outside the bbox.
export function findBoundaryCuts(
  ways: OsmWay[],
  positions: Map<number, Vec2>,
  bounds: Bounds,
): Set<number> {
  const cuts = new Set<number>();
  const onBoundary = ({ x, y }: Vec2) =>
    contains(bounds, { x, y }) &&
    (x === bounds.min.x || x === bounds.max.x || y === bounds.min.y || y === bounds.max.y);
  for (const { nd } of ways) {
    for (let i = 1; i < nd.length; i++) {
      const start = nd[i - 1]!,
        end = nd[i]!;
      const a = positions.get(start)!,
        b = positions.get(end)!;
      if (onBoundary(a) && !contains(bounds, b)) cuts.add(start);
      if (onBoundary(b) && !contains(bounds, a)) cuts.add(end);
    }
  }
  return cuts;
}

// Intersect the parameter ranges imposed by the two coordinate axes.
function clipEdge(a: Vec2, b: Vec2, { min, max }: Bounds): [number, number] | undefined {
  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] < min[axis] || a[axis] > max[axis]) return undefined;
      continue;
    }
    const t0 = (min[axis] - a[axis]) / delta;
    const t1 = (max[axis] - a[axis]) / delta;
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
  }
  return enter < exit ? [enter, exit] : undefined;
}

export function clipPart(
  points: RoadPoint[],
  bounds: Bounds,
  key: string,
  boundaryCuts: ReadonlySet<number>,
): ClippedPart[] {
  const cutAtJunction = ({ osmId }: RoadPoint) => osmId !== undefined && boundaryCuts.has(osmId);
  const clamp = (value: number, axis: 'x' | 'y') =>
    Math.max(bounds.min[axis], Math.min(bounds.max[axis], value));
  const result: ClippedPart[] = [];
  let current: ClippedPart | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const span = clipEdge(a.pos, b.pos, bounds);
    if (!span) {
      if (current) current.cutEnd = true;
      current = undefined;
      continue;
    }
    const [enter, exit] = span;
    const cut = (t: number): RoadPoint => ({
      key: `${key}/${i}/${t}`,
      pos: {
        x: clamp(a.pos.x + (b.pos.x - a.pos.x) * t, 'x'),
        y: clamp(a.pos.y + (b.pos.y - a.pos.y) * t, 'y'),
      },
    });
    const first = enter === 0 ? a : cut(enter);
    const last = exit === 1 ? b : cut(exit);
    if (!current) {
      current = {
        points: [first],
        cutStart: enter > 0 || i > 1 || cutAtJunction(first),
        cutEnd: false,
      };
      result.push(current);
    }
    current.points.push(last);
    if (exit < 1) {
      current.cutEnd = true;
      current = undefined;
    }
  }
  if (current && cutAtJunction(points.at(-1)!)) current.cutEnd = true;
  return result.filter(({ points }) => polylineLength(points.map(({ pos }) => pos)) > 0);
}
