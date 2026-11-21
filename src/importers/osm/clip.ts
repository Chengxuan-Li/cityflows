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
  /** TASK-270: circles the road clip keeps besides the ring, one round each roundabout the ring
   * cuts (`roundaboutBounds`); `min` and `max` then cover them too. */
  discs?: { centre: Vec2; radius: number }[];
  /** TASK-270: OSM nodes in those circles where the extract stops: the road goes on in ways
   * Overpass did not return (they do not touch the ring), so its end there is cut. */
  extractEnds?: Set<number>;
}

/** TASK-270: how far past a cut roundabout's farthest node its arms are kept, as entries. */
export const ROUNDABOUT_ARM_M = 30;

/**
 * TASK-270: a polygon ring must not halve a roundabout (Cambridge's ring cut the signalised
 * Newmarket Road roundabout, mapped `junction=circular`, leaving its inner half as a gateway no
 * route reached). Each set of joined `junction=roundabout` or `circular` ways with nodes both
 * inside and outside the ring gives a circle round its nodes, `ROUNDABOUT_ARM_M` wider, that the
 * road clip keeps whole: the roundabout stays entire and its arms are cut on the circle, where they
 * become entries like any road the ring cuts. A way end outside the ring in a circle that no other
 * way meets, or that traffic can only reach or only leave, goes on in ways the extract lacks
 * (Newmarket Road's gyratory continues in ways that do not touch the ring): it is cut too, so it
 * can be an entry.
 * Returns the road bounds: `bounds` with the circles, its box grown to hold them.
 */
export function roundaboutBounds(
  ways: OsmWay[],
  positions: Map<number, Vec2>,
  bounds: Bounds,
): Bounds {
  const ring = bounds.ring;
  if (!ring) return bounds;
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const rings = ways.filter(
    (way) => way.tag.junction === 'roundabout' || way.tag.junction === 'circular',
  );
  for (const { nd } of rings)
    for (const id of nd) {
      if (!parent.has(id)) parent.set(id, id);
      parent.set(find(id), find(nd[0]!));
    }
  const groups = new Map<number, Set<number>>();
  for (const id of parent.keys()) {
    const set = groups.get(find(id)) ?? new Set();
    set.add(id);
    groups.set(find(id), set);
  }
  const discs: NonNullable<Bounds['discs']> = [];
  for (const ids of groups.values()) {
    const points = [...ids].map((id) => positions.get(id)!);
    const inside = points.map((p) => pointInPolygon(p, ring));
    if (inside.every(Boolean) || !inside.some(Boolean)) continue;
    const centre = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    const radius =
      Math.max(...points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))) + ROUNDABOUT_ARM_M;
    discs.push({ centre, radius });
  }
  if (!discs.length) return bounds;
  const inDisc = (p: Vec2) =>
    discs.some(({ centre, radius }) => Math.hypot(p.x - centre.x, p.y - centre.y) < radius);
  const touching = new Map<
    number,
    { arrive: boolean; leave: boolean; through: boolean; ways: number }
  >();
  for (const { nd, tag } of ways) {
    const forward = tag.oneway !== '-1';
    const backward =
      tag.oneway === '-1' ||
      !(
        ['yes', '1', 'true'].includes(tag.oneway ?? '') ||
        (tag.oneway === undefined && (tag.highway === 'motorway' || tag.junction === 'roundabout'))
      );
    nd.forEach((id, i) => {
      const end = i === 0 ? 'start' : i === nd.length - 1 ? 'end' : null;
      const entry = touching.get(id) ?? { arrive: false, leave: false, through: false, ways: 0 };
      entry.ways++;
      if (!end) entry.through = true;
      else if (end === 'end') {
        entry.arrive ||= forward;
        entry.leave ||= backward;
      } else {
        entry.leave ||= forward;
        entry.arrive ||= backward;
      }
      touching.set(id, entry);
    });
  }
  const extractEnds = new Set<number>();
  for (const [id, { arrive, leave, through, ways: count }] of touching) {
    const pos = positions.get(id)!;
    if (
      !through &&
      (count === 1 || !(arrive && leave)) &&
      inDisc(pos) &&
      !pointInPolygon(pos, ring)
    )
      extractEnds.add(id);
  }
  return {
    ring,
    discs,
    extractEnds,
    min: {
      x: Math.min(bounds.min.x, ...discs.map((d) => d.centre.x - d.radius)),
      y: Math.min(bounds.min.y, ...discs.map((d) => d.centre.y - d.radius)),
    },
    max: {
      x: Math.max(bounds.max.x, ...discs.map((d) => d.centre.x + d.radius)),
      y: Math.max(bounds.max.y, ...discs.map((d) => d.centre.y + d.radius)),
    },
  };
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
  if (!bounds.discs) return spans;
  // The circles kept round cut roundabouts, joined with the ring's ranges.
  for (const { centre, radius } of bounds.discs) {
    const fx = a.x - centre.x,
      fy = a.y - centre.y;
    const qa = dx * dx + dy * dy,
      qb = 2 * (fx * dx + fy * dy),
      qc = fx * fx + fy * fy - radius * radius;
    const root = qb * qb - 4 * qa * qc;
    if (qa === 0 || root <= 0) continue;
    const enter = Math.max(span[0], (-qb - Math.sqrt(root)) / (2 * qa));
    const exit = Math.min(span[1], (-qb + Math.sqrt(root)) / (2 * qa));
    if (enter < exit) spans.push([enter, exit]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  const joined: [number, number][] = [];
  for (const [enter, exit] of spans) {
    const last = joined.at(-1);
    if (last && enter <= last[1]) last[1] = Math.max(last[1], exit);
    else joined.push([enter, exit]);
  }
  return joined;
}

export function clipPart(
  points: RoadPoint[],
  bounds: Bounds,
  key: string,
  boundaryCuts: ReadonlySet<number>,
): ClippedPart[] {
  const cutAtJunction = ({ osmId }: RoadPoint) =>
    osmId !== undefined && (boundaryCuts.has(osmId) || Boolean(bounds.extractEnds?.has(osmId)));
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
