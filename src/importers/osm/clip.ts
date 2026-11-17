import { pointInPolygon, polylineLength } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { City, RoadClass } from '../../schema';
import type { OsmWay } from './parse';
import type { OsmRoad } from './roads';

export interface Bounds {
  min: Vec2;
  max: Vec2;
  /** TASK-198: a polygon import's boundary, closed, in the local frame; `min` and `max` are its
   * bounding box. Everything kept lies inside both. */
  ring?: Vec2[];
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

export function contains({ min, max, ring }: Bounds, { x, y }: Vec2): boolean {
  return (
    x >= min.x &&
    x <= max.x &&
    y >= min.y &&
    y <= max.y &&
    (!ring || pointInPolygon({ x, y }, ring))
  );
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

// The parameter ranges of a segment inside the bounds: the box's range, cut where the segment
// crosses the polygon ring (a concave ring can leave several ranges).
function clipSpans(a: Vec2, b: Vec2, bounds: Bounds): [number, number][] {
  const span = clipEdge(a, b, bounds);
  if (!span || !bounds.ring) return span ? [span] : [];
  const ring = bounds.ring;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const cuts = [span[0], span[1]];
  for (let j = 1; j < ring.length; j++) {
    const c = ring[j - 1]!,
      d = ring[j]!;
    const ex = d.x - c.x,
      ey = d.y - c.y;
    const cross = dx * ey - dy * ex;
    if (cross === 0) continue;
    const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / cross;
    const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / cross;
    if (t > span[0] && t < span[1] && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((p, q) => p - q);
  const spans: [number, number][] = [];
  for (let i = 1; i < cuts.length; i++) {
    const enter = cuts[i - 1]!,
      exit = cuts[i]!;
    if (exit <= enter) continue;
    const t = (enter + exit) / 2;
    if (!pointInPolygon({ x: a.x + dx * t, y: a.y + dy * t }, ring, 0)) continue;
    const last = spans.at(-1);
    if (last && last[1] === enter) last[1] = exit;
    else spans.push([enter, exit]);
  }
  return spans;
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
    const spans = clipSpans(a.pos, b.pos, bounds);
    if (!spans.length) {
      if (current) current.cutEnd = true;
      current = undefined;
      continue;
    }
    for (const [enter, exit] of spans) {
      if (current && bounds.ring && enter > 0) {
        current.cutEnd = true;
        current = undefined;
      }
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
  }
  if (current && cutAtJunction(points.at(-1)!)) current.cutEnd = true;
  // A polygon ring can graze a way; a cut sliver under a metre long is not kept.
  return result.filter(({ points, cutStart, cutEnd }) => {
    const length = polylineLength(points.map(({ pos }) => pos));
    return length > 0 && !(bounds.ring && (cutStart || cutEnd) && length < 1);
  });
}

/** TASK-198: road classes a polygon import keeps where they cross the ring, as entries. */
export const entryClasses: ReadonlySet<RoadClass> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'ramp',
]);

/**
 * TASK-198: a polygon import keeps a road cut by the ring only where it is an entry (tertiary
 * class or above, or a link). A minor road cut by the ring is removed back to the junction it
 * leaves, and what the cut leaves apart from the largest connected network is dropped, so the
 * cut adds no dead end and no disconnected fragment. Returns the roads removed.
 */
export function prunePolygonCuts(city: City, roads: OsmRoad[]): OsmRoad[] {
  const incident = new Map<string, Set<OsmRoad>>();
  for (const road of roads)
    for (const id of [road.road.from, road.road.to]) {
      const set = incident.get(id) ?? new Set();
      set.add(road);
      incident.set(id, set);
    }
  const neighbours = (id: string) =>
    new Set([...incident.get(id)!].map(({ road }) => (road.from === id ? road.to : road.from)));
  const removed = new Set<OsmRoad>();
  const remove = (road: OsmRoad) => {
    removed.add(road);
    incident.get(road.road.from)!.delete(road);
    incident.get(road.road.to)!.delete(road);
  };
  const stack = roads.filter(
    ({ road, cutStart, cutEnd }) => (cutStart || cutEnd) && !entryClasses.has(road.roadClass),
  );
  while (stack.length) {
    const road = stack.pop()!;
    if (removed.has(road)) continue;
    const ends = [road.road.from, road.road.to];
    const before = ends.map((id) => neighbours(id).size);
    remove(road);
    // A node that joined this road to one other street now ends that street: remove it too.
    ends.forEach((id, i) => {
      if (before[i]! >= 2 && neighbours(id).size === 1) stack.push(...incident.get(id)!);
    });
  }
  const seen = new Set<string>();
  const components: OsmRoad[][] = [];
  for (const start of roads) {
    if (removed.has(start) || seen.has(start.road.from)) continue;
    const members = new Set<OsmRoad>();
    const queue = [start.road.from];
    seen.add(start.road.from);
    for (const id of queue)
      for (const road of incident.get(id)!) {
        members.add(road);
        for (const next of [road.road.from, road.road.to])
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
      }
    components.push([...members]);
  }
  components.sort((a, b) => b.length - a.length);
  for (const component of components.slice(1)) component.forEach(remove);
  for (const road of removed) delete city.roads[road.road.id];
  for (const [id, set] of incident) if (!set.size) delete city.nodes[id];
  return roads.filter((road) => removed.has(road));
}
