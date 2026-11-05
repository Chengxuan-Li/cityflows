import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  pointInPolygon,
  segmentIntersection,
  segmentsIntersect,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Road } from '../schema';
import { roadWidth } from './lanes';
import type { CLane, CMovement, CNode, CRoad } from './types';

function outward(road: Road, node: CNode) {
  return road.from === node.id ? road.centerline : [...road.centerline].reverse();
}

/** Longest setback at acute approaches beyond what clearing the widest neighbouring road
 * end at a right angle needs: past it the roads merge as one surface instead of stopping
 * cars ever farther from the junction (lead decision at the TASK-061 review). */
export const SETBACK_CAP_M = 10;

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
      extent: Math.max(Math.abs(offset - width / 2), Math.abs(offset + width / 2)),
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
      const cap = Math.max(
        end.width / 2 + 1,
        SETBACK_CAP_M,
        ...neighbors.flatMap((neighbor) => neighbor.map((other) => other.extent + 1)),
      );
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
                    setbacks[end.index] = Math.min(cap, Math.max(setbacks[end.index]!, along + 1));
                  }
                }
            }
          }
        }
    }
  }
  return setbacks;
}

export interface CurbJoin {
  kind: 'fillet' | 'straight' | 'extended' | 'gore';
  points: Vec2[];
  radius: number;
  first?: Vec2;
  last?: Vec2;
  directions: [Vec2, Vec2];
}

function curb(a: Vec2, da: Vec2, b: Vec2, db: Vec2, radiusLimit = 8): CurbJoin {
  const straight: CurbJoin = { kind: 'straight', points: [a, b], radius: 0, directions: [da, db] };
  if (radiusLimit === 0) return straight;
  const cross = da.x * db.y - da.y * db.x;
  const dot = da.x * db.x + da.y * db.y;
  const lateral = -(b.x - a.x) * da.y + (b.y - a.y) * da.x;
  if (Math.abs(cross) < 1e-6) {
    if (dot < 0 || lateral >= -1e-6 || radiusLimit === 0) return straight;
    const radius = -lateral / 2;
    if (radius > radiusLimit) return straight;
    const along = (b.x - a.x) * da.x + (b.y - a.y) * da.y;
    const first = { x: a.x + da.x * Math.min(0, along), y: a.y + da.y * Math.min(0, along) };
    const center = { x: first.x + da.y * radius, y: first.y - da.x * radius };
    const start = Math.atan2(first.y - center.y, first.x - center.x);
    return {
      ...straight,
      kind: 'fillet',
      radius,
      first,
      last: { x: first.x + da.y * radius * 2, y: first.y - da.x * radius * 2 },
      points: [a, ...fineArc(center, radius, start, Math.PI), b],
    };
  }
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / cross;
  const u = ((b.x - a.x) * da.y - (b.y - a.y) * da.x) / cross;
  const corner = { x: a.x + da.x * t, y: a.y + da.y * t };
  if (t > 1e-6 && u > 1e-6 && cross > 0)
    return { ...straight, kind: 'gore', points: [a, corner, b] };
  if (radiusLimit === 0) return straight;
  const delta = Math.atan2(cross, dot);
  const sweep = delta > 0 ? delta - Math.PI : delta + Math.PI;
  const sign = Math.sign(sweep);
  const na = { x: da.y * sign, y: -da.x * sign };
  const nb = { x: -db.y * sign, y: db.x * sign };
  const dt = ((nb.x - na.x) * db.y - (nb.y - na.y) * db.x) / cross;
  const du = ((nb.x - na.x) * da.y - (nb.y - na.y) * da.x) / cross;
  let low = 0,
    high = radiusLimit;
  for (const [offset, slope] of [
    [t, dt],
    [u, du],
  ] as const) {
    if (Math.abs(slope) < 1e-9) {
      if (offset > 1e-6) return straight;
    } else if (slope > 0) high = Math.min(high, -offset / slope);
    else low = Math.max(low, -offset / slope);
  }
  if (high < Math.max(1e-6, low)) return straight;
  const radius = high;
  const first = { x: a.x + da.x * (t + dt * radius), y: a.y + da.y * (t + dt * radius) };
  const last = { x: b.x + db.x * (u + du * radius), y: b.y + db.y * (u + du * radius) };
  // A nearly parallel pair must not send the tangencies off to a distant line intersection.
  if (distance(a, first) > distance(a, b) + 8 || distance(b, last) > distance(a, b) + 8)
    return straight;
  const center = { x: first.x + na.x * radius, y: first.y + na.y * radius };
  const start = Math.atan2(first.y - center.y, first.x - center.x);
  return {
    kind: 'fillet',
    radius,
    first,
    last,
    directions: [da, db],
    points: [a, ...fineArc(center, radius, start, sweep), b],
  };
}

function fineArc(center: Vec2, radius: number, start: number, sweep: number): Vec2[] {
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) * radius));
  const tip = Math.min(Math.abs(sweep) / 4, Math.PI / 90) * Math.sign(sweep);
  const angles = [
    0,
    tip,
    ...Array.from({ length: steps - 1 }, (_, i) => (sweep * (i + 1)) / steps),
    sweep - tip,
    sweep,
  ];
  return angles.map((angle) => ({
    x: center.x + radius * Math.cos(start + angle),
    y: center.y + radius * Math.sin(start + angle),
  }));
}

type RoadEnd = {
  left: Vec2;
  right: Vec2;
  direction: Vec2;
  heading: number;
  roads: number[];
  arm: string;
  leftDirection?: Vec2;
  rightDirection?: Vec2;
  goreTip?: Vec2;
  goreNext?: string;
  capped: boolean;
};
const pendingEnds = new WeakMap<CNode, { ends: RoadEnd[]; limit: number }>();

function closeOutline(points: Vec2[]): Vec2[] {
  const ring = points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) > 1e-6);
  if (ring.length) {
    if (distance(ring[0]!, ring.at(-1)!) <= 1e-6) ring.pop();
    ring.push(ring[0]!);
  }
  return ring;
}

function mergeEnds(ends: RoadEnd[]): RoadEnd[] {
  const merged: RoadEnd[] = [];
  for (const end of ends) {
    const d = end.direction;
    const side = (p: Vec2) => -p.x * d.y + p.y * d.x;
    const along = (p: Vec2) => p.x * d.x + p.y * d.y;
    const previous = merged.find(
      (other) =>
        other.direction.x * d.x + other.direction.y * d.y > Math.cos(Math.PI / 36) &&
        Math.min(side(other.right), side(end.right)) >=
          Math.max(side(other.left), side(end.left)) - 1e-6,
    );
    if (!previous) {
      merged.push(end);
      continue;
    }
    const cut = Math.max(
      along(previous.left),
      along(previous.right),
      along(end.left),
      along(end.right),
    );
    const left = side(previous.left) < side(end.left) ? previous.left : end.left;
    const right = side(previous.right) > side(end.right) ? previous.right : end.right;
    previous.leftDirection =
      left === previous.left
        ? (previous.leftDirection ?? previous.direction)
        : (end.leftDirection ?? end.direction);
    previous.rightDirection =
      right === previous.right
        ? (previous.rightDirection ?? previous.direction)
        : (end.rightDirection ?? end.direction);
    previous.left = left;
    previous.right = right;
    previous.direction = d;
    previous.heading = end.heading;
    extendCut(previous, cut);
    previous.roads.push(...end.roads);
    previous.capped ||= end.capped;
  }
  return merged;
}

function extendCut(end: RoadEnd, along: number, bounds?: { pos: Vec2; limit: number }): void {
  const d = end.direction;
  for (const side of ['left', 'right'] as const) {
    const edge = side === 'left' ? (end.leftDirection ?? d) : (end.rightDirection ?? d);
    const point = end[side];
    let extension = Math.max(
      0,
      (along - point.x * d.x - point.y * d.y) / (edge.x * d.x + edge.y * d.y),
    );
    if (bounds) {
      const x = point.x - bounds.pos.x,
        y = point.y - bounds.pos.y;
      const projected = x * edge.x + y * edge.y;
      const maximum =
        -projected +
        Math.sqrt(Math.max(0, projected * projected + bounds.limit ** 2 - x * x - y * y));
      extension = Math.min(extension, Math.max(0, maximum));
    }
    end[side] = { x: point.x + edge.x * extension, y: point.y + edge.y * extension };
  }
}

export function junctionOutline(node: CNode, roads: CRoad[], lanes: CLane[]): Vec2[] {
  if (node.setbacks.every((s) => s === 0)) return [];
  const ends = mergeEnds(
    roads.map((road, index) => {
      const incoming = road.to === node.idx;
      const firstLane = lanes[road.lanes[0]!]!,
        lastLane = lanes[road.lanes.at(-1)!]!;
      const first = incoming ? firstLane.polyline.at(-1)! : firstLane.polyline[0]!;
      const last = incoming ? lastLane.polyline.at(-1)! : lastLane.polyline[0]!;
      const center = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
      const ring = road.surface;
      let cut = ring.length - 1;
      if (incoming) {
        let nearest = Infinity;
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i]!,
            b = ring[i + 1]!;
          const away = distance(center, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          if (away < nearest) {
            nearest = away;
            cut = i;
          }
        }
      }
      const left = ring[(cut + 1) % ring.length]!,
        right = ring[cut]!;
      const width = distance(left, right);
      const direction = { x: (right.y - left.y) / width, y: (left.x - right.x) / width };
      return {
        left,
        right,
        direction,
        heading: Math.atan2(direction.y, direction.x),
        roads: [road.idx],
        capped: node.setbacks[index]! >= SETBACK_CAP_M - 1e-6,
        arm:
          road.streetGroupId === null
            ? road.id
            : `${road.streetGroupId}:${incoming ? road.from : road.to}`,
      };
    }),
  );
  const arms = new Map<string, RoadEnd[]>();
  for (const end of ends) {
    const group = arms.get(end.arm) ?? [];
    group.push(end);
    arms.set(end.arm, group);
  }
  const grouped = [...arms.values()]
    .map((group) => {
      const direction = group.reduce(
        (d, e) => ({ x: d.x + e.direction.x, y: d.y + e.direction.y }),
        { x: 0, y: 0 },
      );
      const heading = Math.atan2(direction.y, direction.x);
      group.sort(
        (a, b) =>
          -(a.left.x - b.left.x) * Math.sin(heading) + (a.left.y - b.left.y) * Math.cos(heading),
      );
      return { group, heading };
    })
    .sort((a, b) => a.heading - b.heading);
  ends.splice(
    0,
    ends.length,
    ...grouped.map(({ group, heading }) => {
      const first = group[0]!,
        last = group.at(-1)!;
      const end: RoadEnd = {
        ...first,
        right: last.right,
        heading,
        direction: { x: Math.cos(heading), y: Math.sin(heading) },
        leftDirection: first.leftDirection ?? first.direction,
        rightDirection: last.rightDirection ?? last.direction,
        roads: group.flatMap((e) => e.roads),
        capped: group.some((e) => e.capped),
      };
      extendCut(
        end,
        Math.max(
          ...group
            .flatMap((e) => [e.left, e.right])
            .map((p) => p.x * end.direction.x + p.y * end.direction.y),
        ),
      );
      return end;
    }),
  );
  // A narrower coincident approach has no exposed curb at this mouth. Keep its
  // roads in the wider mouth instead of introducing an internal gore boundary.
  for (let i = ends.length - 1; i >= 0; i--) {
    const end = ends[i]!;
    const enclosing = ends.find((other, j) => {
      if (
        i === j ||
        distance(other.left, other.right) <= distance(end.left, end.right) + 1e-6 ||
        other.direction.x * end.direction.x + other.direction.y * end.direction.y <
          Math.cos(Math.PI / 12)
      )
        return false;
      const side = (p: Vec2) =>
        -(p.x - other.left.x) * other.direction.y + (p.y - other.left.y) * other.direction.x;
      return [end.left, end.right].every(
        (p) => side(p) >= -1e-6 && side(p) <= distance(other.left, other.right) + 1e-6,
      );
    });
    if (enclosing) {
      enclosing.roads.push(...end.roads);
      ends.splice(i, 1);
    }
  }
  // A capped pair's cuts can cross before its gore. Extend the surface cuts of
  // the physical arms to the tip; the compiled lane ends remain untouched.
  let limit = Math.max(
    0,
    ...roads.flatMap((road) =>
      road.lanes.map((index) => {
        const lane = lanes[index]!;
        return distance(node.pos, road.to === node.idx ? lane.polyline.at(-1)! : lane.polyline[0]!);
      }),
    ),
  );
  const extensions = new Map<string, number>();
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i]!,
      b = ends[(i + 1) % ends.length]!;
    if (
      a.arm === b.arm ||
      !(a.capped || b.capped) ||
      Math.abs(a.direction.x * b.direction.y - a.direction.y * b.direction.x) <
        Math.sin(Math.PI / 36)
    )
      continue;
    const join = curb(
      a.right,
      a.rightDirection ?? a.direction,
      b.left,
      b.leftDirection ?? b.direction,
    );
    if (join.kind !== 'gore') continue;
    const tip = join.points[1]!;
    a.goreTip = tip;
    a.goreNext = b.arm;
    limit = Math.max(limit, distance(node.pos, tip));
    for (const end of [a, b]) {
      const along = (tip.x - node.pos.x) * end.direction.x + (tip.y - node.pos.y) * end.direction.y;
      extensions.set(end.arm, Math.max(extensions.get(end.arm) ?? 0, along));
    }
  }
  for (const end of ends) {
    const along = extensions.get(end.arm);
    if (along !== undefined)
      extendCut(end, along + node.pos.x * end.direction.x + node.pos.y * end.direction.y, {
        pos: node.pos,
        limit: limit + 8,
      });
  }
  pendingEnds.set(node, { ends, limit: limit + 8 });
  const outline: Vec2[] = [];
  for (let i = 0; i < ends.length; i++) {
    const end = ends[i]!,
      next = ends[(i + 1) % ends.length]!;
    outline.push(
      end.left,
      ...curb(
        end.right,
        end.rightDirection ?? end.direction,
        next.left,
        next.leftDirection ?? next.direction,
        end.arm === next.arm && i < ends.length - 1 ? 0 : 8,
      ).points,
    );
  }
  return closeOutline(outline);
}

/** Rebuild only the surface after movement generation; lane geometry is immutable here. */
export function containMovements(node: CNode, movements: CMovement[], lanes: CLane[]) {
  const pending = pendingEnds.get(node);
  pendingEnds.delete(node);
  if (!pending) return { joins: [] as CurbJoin[], limit: 0, contained: true };
  const { ends, limit } = pending;
  const points = node.movements.flatMap((i) => {
    const m = movements[i]!;
    return m.polyline.flatMap((p, k) => {
      const heading = headingAtDistance(m.polyline, m.cumulative, m.cumulative[k]!);
      const width = Math.min(lanes[m.fromLane]!.widthM, lanes[m.toLane]!.widthM) / 2;
      return [-1, 0, 1].map((side) => ({
        x: p.x - Math.sin(heading) * width * side,
        y: p.y + Math.cos(heading) * width * side,
      }));
    });
  });
  for (const end of ends) {
    const d = end.direction;
    const side = (p: Vec2) => -(p.x - end.left.x) * d.y + (p.y - end.left.y) * d.x;
    const width = distance(end.left, end.right);
    const support = points.filter((p) => side(p) >= -1e-6 && side(p) <= width + 1e-6);
    extendCut(
      end,
      Math.max(end.left.x * d.x + end.left.y * d.y, ...support.map((p) => p.x * d.x + p.y * d.y)),
      { pos: node.pos, limit },
    );
  }
  const solve = () => {
    const joins = ends.map((end, i) => {
      const next = ends[(i + 1) % ends.length]!;
      if (end.goreTip && end.goreNext === next.arm)
        return {
          kind: 'gore' as const,
          points: [end.right, end.goreTip, next.left],
          radius: 0,
          directions: [
            end.rightDirection ?? end.direction,
            next.leftDirection ?? next.direction,
          ] as [Vec2, Vec2],
        };
      const join = curb(
        end.right,
        end.rightDirection ?? end.direction,
        next.left,
        next.leftDirection ?? next.direction,
      );
      return join.kind === 'gore'
        ? curb(end.right, end.direction, next.left, next.direction, 0)
        : join;
    });
    const outline = () => closeOutline(ends.flatMap((end, i) => [end.left, ...joins[i]!.points]));
    node.outline = outline();
    for (let i = 0; i < joins.length; i++) {
      const end = ends[i]!,
        next = ends[(i + 1) % ends.length]!;
      const da = end.rightDirection ?? end.direction,
        db = next.leftDirection ?? next.direction;
      const a = end.right,
        b = next.left;
      const outside = points.filter((p) => !pointInPolygon(p, node.outline, 0.1));
      if (!outside.length) break;
      const outsideSet = new Set(outside);
      const contained = points.filter((p) => !outsideSet.has(p));
      const needed = outside.filter(
        (p) =>
          distanceToLine(p, joins[i]!.points) <=
          Math.min(...joins.map((j) => distanceToLine(p, j.points))) + 1e-6,
      );
      if (!needed.length) continue;
      const previous = joins[i]!;
      if (previous.kind === 'gore') continue;
      const accept = (candidate: CurbJoin) => {
        joins[i] = candidate;
        const ring = outline();
        if (
          ring.every((p) => distance(p, node.pos) <= limit + 1e-6) &&
          needed.every((p) => pointInPolygon(p, ring, 0.1)) &&
          contained.every((p) => pointInPolygon(p, ring, 0.1)) &&
          simpleOutline(ring)
        ) {
          node.outline = ring;
          return true;
        }
        joins[i] = previous;
        return false;
      };
      let found = false;
      // Convex caps can grow as their radius decreases; choose the largest feasible
      // radius, then refine the first successful interval to a millimeter.
      for (
        let radius = previous.kind === 'fillet' ? previous.radius : 8;
        radius > 0 && da.x * db.y - da.y * db.x < -1e-6;
        radius -= 0.1
      ) {
        const candidate = curb(a, da, b, db, radius);
        if (candidate.kind !== 'fillet' || !accept(candidate)) continue;
        let low = radius,
          high = Math.min(8, radius + 0.1);
        while (high - low > 0.001) {
          const middle = (low + high) / 2;
          if (accept(curb(a, da, b, db, middle))) low = middle;
          else high = middle;
        }
        accept(curb(a, da, b, db, low));
        found = true;
        break;
      }
      if (found || accept(curb(a, da, b, db, 0))) continue;
      const cross = da.x * db.y - da.y * db.x;
      if (Math.abs(cross) > 1e-9) {
        const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / cross;
        const corner = { x: a.x + da.x * t, y: a.y + da.y * t };
        if (accept({ kind: 'extended', points: [a, corner, b], radius: 0, directions: [da, db] }))
          continue;
      }
      for (let extension = 0.5; extension <= 8 && !found; extension += 0.5) {
        for (const [first, last] of [
          [extension, 0],
          [0, extension],
          [extension, extension],
        ]) {
          const candidate = [
            a,
            { x: a.x - da.x * first!, y: a.y - da.y * first! },
            { x: b.x - db.x * last!, y: b.y - db.y * last! },
            b,
          ];
          if (accept({ kind: 'extended', points: candidate, radius: 0, directions: [da, db] })) {
            found = true;
            break;
          }
        }
      }
    }
    return { joins, limit };
  };
  const result = solve();
  const missing = () => points.filter((p) => !pointInPolygon(p, node.outline, 0.1));
  let outside = missing();
  if (!outside.length && simpleOutline(node.outline)) return { ...result, contained: true };
  // Fixed Beziers can need an exterior wedge beyond a surface cut. Adjust the
  // whole mouth, then rebuild both neighboring curbs; never move lane geometry.
  const score = () => {
    let error = simpleOutline(node.outline) ? 0 : 1e6;
    for (const p of points)
      if (!pointInPolygon(p, node.outline, 0.1)) error += 1 + distanceToLine(p, node.outline);
    return error;
  };
  const initialCuts = ends.map(
    (end) => end.left.x * end.direction.x + end.left.y * end.direction.y,
  );
  let best = {
    ends: ends.map((end) => ({ ...end })),
    outline: node.outline,
    result,
    error: score(),
  };
  for (let pass = 0; pass < ends.length; pass++) {
    const saved = best;
    const order = ends
      .map((end, index) => ({
        index,
        distance: Math.min(...outside.map((p) => distanceToLine(p, [end.left, end.right]))),
      }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index);
    for (const { index } of order) {
      for (let shift = 0.5; shift <= 8; shift += 0.5) {
        ends.splice(0, ends.length, ...saved.ends.map((end) => ({ ...end })));
        const end = ends[index]!;
        const current = end.left.x * end.direction.x + end.left.y * end.direction.y;
        if (initialCuts[index]! + shift <= current + 1e-6) continue;
        extendCut(end, initialCuts[index]! + shift, { pos: node.pos, limit });
        const candidate = solve();
        const error = score();
        if (error < best.error - 1e-6)
          best = {
            ends: ends.map((end) => ({ ...end })),
            outline: node.outline,
            result: candidate,
            error,
          };
        if (error === 0) return { ...candidate, contained: true };
      }
    }
    ends.splice(0, ends.length, ...best.ends.map((end) => ({ ...end })));
    node.outline = best.outline;
    outside = missing();
    if (best.error >= saved.error - 1e-6) break;
  }
  node.outline = best.outline;
  return { ...best.result, contained: best.error === 0 };
}

function simpleOutline(ring: Vec2[]): boolean {
  for (let i = 1; i < ring.length; i++)
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 1 && j === ring.length - 1) continue;
      if (segmentsIntersect(ring[i - 1]!, ring[i]!, ring[j - 1]!, ring[j]!)) return false;
    }
  return true;
}

function distanceToLine(p: Vec2, points: Vec2[]): number {
  let closest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    closest = Math.min(closest, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return closest;
}
