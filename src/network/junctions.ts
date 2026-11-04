import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  sampleArc,
  segmentIntersection,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Road } from '../schema';
import { roadWidth } from './lanes';
import type { CLane, CMovement, CNode, CRoad } from './types';

function outward(road: Road, node: CNode) {
  return road.from === node.id ? road.centerline : [...road.centerline].reverse();
}

/** Setback array follows incident road index order, independently of angular sorting. */
export function junctionSetbacks(node: CNode, roads: Road[]): number[] {
  const ends = roads.map((road, index) => {
    const line = outward(road, node);
    const lengths = cumulativeLengths(line);
    const heading = headingAtDistance(line, lengths, 0);
    const width = roadWidth(road);
    const offset = road.lateralOffsetM * (road.from === node.id ? 1 : -1);
    return {
      road,
      index,
      line,
      lengths,
      heading,
      width,
      edges: [-1, 1].map((side) => {
        const lateral = offset + (side * width) / 2;
        const start = {
          x: node.pos.x - Math.sin(heading) * lateral,
          y: node.pos.y + Math.cos(heading) * lateral,
        };
        return [
          start,
          {
            x: start.x + Math.cos(heading) * lengths.at(-1)!,
            y: start.y + Math.sin(heading) * lengths.at(-1)!,
          },
        ];
      }),
    };
  });
  // Opposite carriageways form one physical street end; splitting a two-way street
  // therefore still gives a through node with four directed roads.
  const groups = new Map<string, typeof ends>();
  for (const end of ends) {
    const other = end.road.from === node.id ? end.road.to : end.road.from;
    const key =
      end.road.streetGroupId === null ? end.road.id : `${end.road.streetGroupId}:${other}`;
    const group = groups.get(key) ?? [];
    group.push(end);
    groups.set(key, group);
  }
  const arms = [...groups.values()].sort((a, b) => a[0]!.heading - b[0]!.heading);
  if (arms.length === 2 && node.control === 'uncontrolled') {
    const a = arms[0]!,
      b = arms[1]!;
    if (
      a.length === b.length &&
      a.every((end) =>
        b.some(
          (other) =>
            (end.road.to === node.id) !== (other.road.to === node.id) &&
            end.road.name === other.road.name &&
            end.road.roadClass === other.road.roadClass &&
            end.road.lateralOffsetM === other.road.lateralOffsetM &&
            end.road.lanes.length === other.road.lanes.length &&
            end.road.lanes.every((lane, i) => lane.widthM === other.road.lanes[i]!.widthM) &&
            end.width === other.width &&
            Math.cos(end.heading - other.heading) < -Math.cos(Math.PI / 36),
        ),
      )
    )
      return roads.map(() => 0);
  }
  const setbacks = ends.map((end) => end.width / 2 + 1);
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    const neighbors =
      arms.length > 1
        ? [arms[(i + 1) % arms.length]!, arms[(i + arms.length - 1) % arms.length]!]
        : [];
    for (const end of arm) {
      for (const neighbor of new Set(neighbors))
        for (const other of neighbor) {
          if (Math.abs(Math.sin(end.heading - other.heading)) < Math.sin(Math.PI / 36)) continue;
          for (const edge of end.edges) {
            for (const otherEdge of other.edges) {
              for (let j = 1; j < edge.length; j++)
                for (let k = 1; k < otherEdge.length; k++) {
                  const hit = segmentIntersection(
                    edge[j - 1]!,
                    edge[j]!,
                    otherEdge[k - 1]!,
                    otherEdge[k]!,
                  );
                  if (hit) {
                    let nearest = Infinity,
                      along = 0;
                    for (let s = 1; s < end.line.length; s++) {
                      const a = end.line[s - 1]!,
                        b = end.line[s]!;
                      const dx = b.x - a.x,
                        dy = b.y - a.y;
                      const segment = Math.hypot(dx, dy);
                      if (segment === 0) continue;
                      const t = Math.max(
                        0,
                        Math.min(1, ((hit.x - a.x) * dx + (hit.y - a.y) * dy) / segment ** 2),
                      );
                      const away = Math.hypot(hit.x - a.x - t * dx, hit.y - a.y - t * dy);
                      if (away < nearest) {
                        nearest = away;
                        along = end.lengths[s - 1]! + t * segment;
                      }
                    }
                    setbacks[end.index] = Math.max(setbacks[end.index]!, along + 1);
                  }
                }
            }
          }
        }
    }
  }
  return setbacks;
}

function curb(a: Vec2, da: Vec2, b: Vec2, db: Vec2): Vec2[] {
  const cross = da.x * db.y - da.y * db.x;
  if (Math.abs(cross) < 1e-6) {
    if (
      da.x * db.x + da.y * db.y > 0.999 &&
      Math.abs((b.x - a.x) * da.x + (b.y - a.y) * da.y) < 1e-6 &&
      -(b.x - a.x) * da.y + (b.y - a.y) * da.x < -1e-6
    ) {
      const radius = Math.min(8, distance(a, b) / 2);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const start = Math.atan2(a.y - center.y, a.x - center.x);
      const sign = (b.x - a.x) * da.y - (b.y - a.y) * da.x > 0 ? 1 : -1;
      return [a, ...sampleArc(center, radius, start, sign * Math.PI), b];
    }
    return [a, b];
  }
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / cross;
  const u = ((b.x - a.x) * da.y - (b.y - a.y) * da.x) / cross;
  // Concave curb fillet: both tangencies must lie between the corner and road ends.
  if (t >= 0 || u >= 0) return [a, b];
  const angle = Math.acos(Math.max(-1, Math.min(1, da.x * db.x + da.y * db.y)));
  const radius = Math.min(8, distance(a, b) / 2);
  const tangent = radius / Math.tan(angle / 2);
  if (tangent > Math.min(-t, -u) + 1e-6) return [a, b];
  const corner = { x: a.x + da.x * t, y: a.y + da.y * t };
  const first = { x: corner.x + da.x * tangent, y: corner.y + da.y * tangent };
  const bisector = { x: da.x + db.x, y: da.y + db.y };
  const scale = radius / Math.sin(angle / 2) / Math.hypot(bisector.x, bisector.y);
  const center = { x: corner.x + bisector.x * scale, y: corner.y + bisector.y * scale };
  const last = { x: corner.x + db.x * tangent, y: corner.y + db.y * tangent };
  const start = Math.atan2(first.y - center.y, first.x - center.x);
  const end = Math.atan2(last.y - center.y, last.x - center.x);
  const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return [a, ...sampleArc(center, radius, start, sweep), b];
}

export function junctionOutline(node: CNode, roads: CRoad[], lanes: CLane[]): Vec2[] {
  if (node.setbacks.every((s) => s === 0)) return [];
  const ends = roads
    .map((road) => {
      const incoming = road.to === node.idx;
      const edges = [road.lanes[0]!, road.lanes.at(-1)!].map((index, side) => {
        const lane = lanes[index]!;
        const point = incoming ? lane.polyline.at(-1)! : lane.polyline[0]!;
        const heading = headingAtDistance(
          lane.polyline,
          lane.cumulative,
          incoming ? lane.lengthM : 0,
        );
        const offset = ((side === 0 ? -1 : 1) * lane.widthM) / 2;
        return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
      });
      const left = edges[incoming ? 1 : 0]!,
        right = edges[incoming ? 0 : 1]!;
      const width = distance(left, right);
      const direction = { x: (right.y - left.y) / width, y: (left.x - right.x) / width };
      return { left, right, direction, heading: Math.atan2(direction.y, direction.x) };
    })
    .sort(
      (a, b) =>
        Math.round(a.heading * 1e8) - Math.round(b.heading * 1e8) ||
        (b.left.x - a.left.x) * Math.sin(a.heading) + (a.left.y - b.left.y) * Math.cos(a.heading),
    );
  const outline: Vec2[] = [];
  for (let i = 0; i < ends.length; i++) {
    const end = ends[i]!,
      next = ends[(i + 1) % ends.length]!;
    outline.push(end.left, ...curb(end.right, end.direction, next.left, next.direction));
  }
  if (outline.length) outline.push(outline[0]!);
  return outline;
}

function inside(point: Vec2, ring: Vec2[]): boolean {
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
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) < 1e-6) return true;
    if (a.y > point.y !== b.y > point.y && point.x < a.x + (dx * (point.y - a.y)) / dy)
      contains = !contains;
  }
  return contains;
}

/** Unequal cuts and fixed Beziers can escape the curb boundary. Extend only those nodes
 * to the convex envelope of the curb and movement surfaces (architecture 5.1). */
export function containMovements(node: CNode, movements: CMovement[], lanes: CLane[]): void {
  if (!node.outline.length) return;
  const paths = node.movements.map((i) => movements[i]!);
  if (paths.every((m) => m.polyline.every((p) => inside(p, node.outline)))) return;
  const points = [...node.outline];
  for (const m of paths) {
    const halfWidth = Math.min(lanes[m.fromLane]!.widthM, lanes[m.toLane]!.widthM) / 2;
    for (let i = 0; i < m.polyline.length; i++) {
      const p = m.polyline[i]!;
      const angle = headingAtDistance(m.polyline, m.cumulative, m.cumulative[i]!);
      for (const side of [-1, 1])
        points.push({
          x: p.x - Math.sin(angle) * halfWidth * side,
          y: p.y + Math.cos(angle) * halfWidth * side,
        });
    }
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Vec2, b: Vec2, c: Vec2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  function half(list: Vec2[]) {
    const hull: Vec2[] = [];
    for (const p of list) {
      while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  }
  node.outline = [...half(points), ...half([...points].reverse())];
  node.outline.push(node.outline[0]!);
}
