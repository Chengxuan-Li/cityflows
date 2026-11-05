import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  offsetPolyline,
  polylineCrossings,
  polylineLength,
  preparePolygon,
  sampleArc,
  sampleCubic,
  segmentIntersection,
  segmentsIntersect,
  trimPolyline,
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

/** The TASK-061 rule (straight edges from the node, farthest crossing plus 1 m). The compiler
 * uses `roadEndSetbacks`; the importer's realignment (TASK-068) still sizes its straight mouth
 * with this rule, so imported geometry is unchanged by TASK-074. Setback array follows
 * incident road index order, independently of angular sorting. */
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

// TASK-074 junction shapes, adapted from SUMO netconvert's node-shape computation
// (NBNodeShapeComputer, see NOTICE): curb lines extrapolated toward the node, angular
// neighbours joined into one direction when their curbs never meet, each road end cut where
// its curb meets the neighbour's facing curb plus a radius term, and smooth corners built on
// the intersection of the extended curbs. The 10 m cap and the gore are CityFlows rules.

/** Curb radius of a concave corner (SUMO's junction radius). Its tangent length, clamped at
 * right-angle turns as SUMO clamps its default radius, is added to the setback of the road end
 * that owns the curb: 1 m at a right angle, as the TASK-061 margin, less at obtuse corners. A
 * larger radius costs approach lanes their queue storage (TASK-065 review): Munich at 0.15
 * completed 1 705 trips by 10:00 with 1.5 m and 1 901 with 1.2 m, against 2 008 on main. */
const CURB_RADIUS_M = 1;
/** A corner farther from the node than this is no corner: the two ends are one direction. */
const CORNER_REACH_M = 50;
/** Curb lines are extrapolated this far toward and past the node, so that every pair meets. */
const EXTEND_M = 50;
/** Angular neighbours closer than this whose curbs do not meet near the node form one
 * direction: SUMO joins within 20 degrees, and up to 60 degrees where the curbs never meet
 * (carriageways that run on top of each other, as realigned approaches can). */
const SAME_DIRECTION = (60 * Math.PI) / 180;
/** Two overlapping ends of one direction move their mouths out to where they part only when
 * that is this close to the node: farther, they stay two roads, their markings clipped where
 * they cross (architecture 11), rather than a long blank junction surface. */
const MOUTH_REACH_M = 2 * SETBACK_CAP_M;
/** Road ends within 3 degrees of each other run the same way: one can shadow the other. */
const COINCIDENT = Math.cos(Math.PI / 60);
/** Curbs within 5 degrees of parallel never form a corner (TASK-061 clarification). */
const PARALLEL = Math.sin(Math.PI / 36);
/** Curbs within 30 degrees of opposite never form a corner: the curb runs on through. */
const STRAIGHT = Math.cos(Math.PI / 6);
/** Handle lengths of a curb's cubic as a share of the distance to its corner, the first a
 * circular fillet when both cuts are equally far from the corner; containment tries the rest. */
const CORNER_HANDLES = [0.5523, 0.45, 0.35, 0.25, 0.15, 0.65, 0.8];
/** Handle lengths of an S-curve curb as a share of the distance between its two ends. */
const STEP_HANDLES = [0.4, 0.25, 0.55, 0.15, 0.7, 0.85, 1];

type Corner = { point: Vec2; a: number; b: number; da: Vec2; db: Vec2 };

function unit(from: Vec2, to: Vec2): Vec2 {
  const length = distance(from, to);
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;

/** An outward edge's direction at its start, over its first half meter: a restored corner
 * (compile keeps a continuation road's old corners) can sit a hair off the edge beyond it. */
function leaving(edge: Vec2[]): Vec2 {
  const ahead = edge.find((p, i) => i > 0 && distance(p, edge[0]!) >= 0.5) ?? edge.at(-1)!;
  return unit(edge[0]!, ahead);
}

/** An outward edge with a straight run of `EXTEND_M` prepended toward the node. */
function extended(edge: Vec2[]): Vec2[] {
  const d = leaving(edge);
  return [{ x: edge[0]!.x - d.x * EXTEND_M, y: edge[0]!.y - d.y * EXTEND_M }, ...edge];
}

/** Where two extended curbs first meet near the node; `a` and `b` are the distances past each
 * edge's start (negative on the extension) and `da`, `db` the outward edge directions there. */
function meet(a: Vec2[], b: Vec2[], origin: Vec2): Corner | undefined {
  let best: Corner | undefined;
  for (const hit of polylineCrossings(a, b)) {
    if (distance(hit.point, origin) > CORNER_REACH_M) continue;
    const corner = {
      point: hit.point,
      a: hit.alongA - EXTEND_M,
      b: hit.alongB - EXTEND_M,
      da: unit(a[hit.i - 1]!, a[hit.i]!),
      db: unit(b[hit.j - 1]!, b[hit.j]!),
    };
    if (Math.abs(cross(corner.da, corner.db)) < PARALLEL) continue;
    // Nearly opposite curbs (a bend or a lateral step in a through road) form no corner.
    if (corner.da.x * corner.db.x + corner.da.y * corner.db.y < -STRAIGHT) continue;
    if (!best || Math.max(corner.a, corner.b) < Math.max(best.a, best.b)) best = corner;
  }
  return best;
}

/** Group road ends into physical arms (opposite carriageways of a street are one arm), sort
 * them by heading, then join angular neighbours that are one direction. Ends inside a
 * direction are ordered left to right. */
type Sided = { arm: string; direction: Vec2; leftStart: Vec2; rightStart: Vec2 };

/** The end of a direction whose left (side -1) or right (side 1) edge is outermost. */
function outer<E extends Sided>(arm: E[], side: number, origin: Vec2): E {
  const dx = arm.reduce((s, e) => s + e.direction.x, 0),
    dy = arm.reduce((s, e) => s + e.direction.y, 0);
  const lateral = (e: E) => {
    const p = side < 0 ? e.leftStart : e.rightStart;
    return side * (-(p.x - origin.x) * dy + (p.y - origin.y) * dx);
  };
  return arm.reduce((best, e) => (lateral(e) > lateral(best) + 1e-9 ? e : best));
}

function directions<E extends Sided>(
  ends: E[],
  origin: Vec2,
  left: (end: E) => Vec2[],
  right: (end: E) => Vec2[],
): E[][] {
  const groups = new Map<string, E[]>();
  for (const end of ends) groups.set(end.arm, [...(groups.get(end.arm) ?? []), end]);
  const heading = (arm: E[]) => {
    const sum = arm.reduce((s, e) => ({ x: s.x + e.direction.x, y: s.y + e.direction.y }), {
      x: 0,
      y: 0,
    });
    return Math.atan2(sum.y, sum.x);
  };
  const order = (arm: E[]) => {
    const h = heading(arm);
    const lateral = (e: E) =>
      -(e.leftStart.x - origin.x) * Math.sin(h) + (e.leftStart.y - origin.y) * Math.cos(h);
    return arm.sort((a, b) => lateral(a) - lateral(b));
  };
  const arms = [...groups.values()].map(order).sort((a, b) => heading(a) - heading(b));
  for (let i = 0; arms.length > 1 && i < arms.length; i++) {
    const j = (i + 1) % arms.length;
    const gap = (heading(arms[j]!) - heading(arms[i]!) + 2 * Math.PI) % (2 * Math.PI);
    if (
      gap >= SAME_DIRECTION ||
      meet(right(outer(arms[i]!, 1, origin)), left(outer(arms[j]!, -1, origin)), origin)
    )
      continue;
    arms[i] = order([...arms[i]!, ...arms[j]!]);
    arms.splice(j, 1);
    i = -1;
  }
  return arms;
}

function throughArms(node: CNode, arms: { road: Road; heading: number; width: number }[][]) {
  if (arms.length !== 2 || node.control !== 'uncontrolled') return false;
  const a = arms[0]!,
    b = arms[1]!;
  return (
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
  );
}

/** Setbacks by incident road order (architecture 5.1, TASK-074). A road end is cut where its
 * curb meets the facing curb of its angular neighbour, plus the corner's tangent length; an
 * inner edge crossing a neighbour's curb keeps the 1 m margin; the floor and the cap stay. */
export function roadEndSetbacks(node: CNode, roads: Road[]): number[] {
  const ends = roads.map((road, index) => {
    // Corners are looked for within reach of the node only.
    const whole = outward(road, node);
    const line = trimPolyline(whole, 0, Math.max(0, polylineLength(whole) - CORNER_REACH_M - 10));
    const lengths = cumulativeLengths(line);
    const heading = headingAtDistance(line, lengths, 0);
    const width = roadWidth(road);
    const offset = road.lateralOffsetM * (road.from === node.id ? 1 : -1);
    const left = extended(offsetPolyline(line, offset - width / 2));
    const right = extended(offsetPolyline(line, offset + width / 2));
    return {
      road,
      index,
      line,
      lengths,
      heading,
      width,
      extent: Math.max(Math.abs(offset - width / 2), Math.abs(offset + width / 2)),
      left,
      right,
      direction: { x: Math.cos(heading), y: Math.sin(heading) },
      leftStart: left[1]!,
      rightStart: right[1]!,
      arm:
        road.streetGroupId === null
          ? road.id
          : `${road.streetGroupId}:${road.from === node.id ? road.to : road.from}`,
    };
  });
  const streets = new Map<string, typeof ends>();
  for (const end of ends) streets.set(end.arm, [...(streets.get(end.arm) ?? []), end]);
  if (throughArms(node, [...streets.values()])) return roads.map(() => 0);
  const arms = directions(
    ends,
    node.pos,
    (e) => e.left,
    (e) => e.right,
  );
  const along = (end: (typeof ends)[number], p: Vec2, station: number) => {
    if (station <= 0) return station;
    let nearest = Infinity,
      result = 0;
    for (let s = 1; s < end.line.length; s++) {
      const a = end.line[s - 1]!,
        b = end.line[s]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const segment = Math.hypot(dx, dy);
      if (segment === 0) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / segment ** 2));
      const away = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (away < nearest) {
        nearest = away;
        result = end.lengths[s - 1]! + t * segment;
      }
    }
    return result;
  };
  const setbacks = ends.map((end) => end.width / 2 + 1);
  // An end lying within another end of its direction and running the same way (a coincident
  // source carriageway) is shadowed by it: the other end's cut and the outline's mouth hold
  // it, not the neighbours.
  const hidden = new Set(
    arms.flatMap((arm) => {
      const dx = arm.reduce((s, e) => s + e.direction.x, 0),
        dy = arm.reduce((s, e) => s + e.direction.y, 0);
      const lateral = (p: Vec2) => -(p.x - node.pos.x) * dy + (p.y - node.pos.y) * dx;
      const scale = Math.hypot(dx, dy);
      return arm.filter((end, k) =>
        arm.some(
          (other, j) =>
            j !== k &&
            other.direction.x * end.direction.x + other.direction.y * end.direction.y >
              COINCIDENT &&
            (lateral(other.leftStart) - lateral(end.leftStart)) / scale <= 0.05 &&
            (lateral(end.rightStart) - lateral(other.rightStart)) / scale <= 0.05 &&
            (j < k ||
              (lateral(other.leftStart) - lateral(end.leftStart)) / scale < -0.05 ||
              (lateral(end.rightStart) - lateral(other.rightStart)) / scale < -0.05),
        ),
      );
    }),
  );
  arms.forEach((arm, i) => {
    const neighbors =
      arms.length > 1
        ? [
            { other: arms[(i + 1) % arms.length]!, side: 1 },
            { other: arms[(i + arms.length - 1) % arms.length]!, side: -1 },
          ]
        : [];
    for (const end of arm) {
      if (hidden.has(end)) continue;
      const cap = Math.max(
        end.width / 2 + 1,
        SETBACK_CAP_M,
        ...neighbors.flatMap(({ other }) => other.map((o) => o.extent + 1)),
      );
      for (const { other, side } of neighbors) {
        const facing = side > 0 ? outer(other, -1, node.pos).left : outer(other, 1, node.pos).right;
        for (const edge of [-1, 1]) {
          const hit = meet(edge < 0 ? end.left : end.right, facing, node.pos);
          // Only a concave corner on both ends' edges, in front of the node, holds a road end
          // back: a convex one is rounded off behind the cut, and a crossing on an extension
          // is no overlap of the two surfaces.
          if (!hit || side * cross(hit.da, hit.db) <= 0 || Math.min(hit.a, hit.b) < 0) continue;
          let extra = 1;
          if (edge === side && end === outer(arm, side, node.pos)) {
            const cosine = Math.max(-1, Math.min(1, hit.da.x * hit.db.x + hit.da.y * hit.db.y));
            const turn = Math.PI - Math.acos(cosine);
            extra = CURB_RADIUS_M * Math.tan(Math.min(Math.PI / 2, turn) / 2);
          }
          setbacks[end.index] = Math.min(
            cap,
            Math.max(setbacks[end.index]!, along(end, hit.point, hit.a) + extra),
          );
        }
      }
      // Ends of other streets joined into this direction keep the TASK-061 rule between them:
      // the farthest crossing of their edges, plus 1 m, within the cap.
      for (const other of arm) {
        if (other.arm === end.arm || hidden.has(other)) continue;
        for (const a of [end.left, end.right])
          for (const b of [other.left, other.right])
            for (const hit of polylineCrossings(a, b)) {
              const station = hit.alongA - EXTEND_M;
              if (station < 0 || hit.alongB < EXTEND_M) continue;
              if (distance(hit.point, node.pos) > CORNER_REACH_M) continue;
              setbacks[end.index] = Math.min(
                cap,
                Math.max(setbacks[end.index]!, along(end, hit.point, station) + 1),
              );
            }
      }
    }
  });
  return setbacks;
}

export interface CurbJoin {
  kind: 'fillet' | 'straight' | 'extended' | 'gore';
  points: Vec2[];
  radius: number;
  first?: Vec2;
  last?: Vec2;
  directions: [Vec2, Vec2];
  control?: Vec2;
  shape?: Curb;
  /** Between two ends of one direction, along their shared edge. */
  step?: boolean;
}

type Mouth = {
  roads: number[];
  arm: string;
  left: Vec2;
  right: Vec2;
  leftEdge: Vec2[];
  rightEdge: Vec2[];
  direction: Vec2;
  leftStart: Vec2;
  rightStart: Vec2;
  setback: number;
};

type Shape = { mouths: Mouth[]; armOf: number[]; single: boolean; origin: Vec2 };
const pendingJoins = new WeakMap<
  CNode,
  { shape: Shape; joins: CurbJoin[]; limit: number; roads: CRoad[] }
>();

function buildJoins({ mouths, armOf, single, origin }: Shape): CurbJoin[] {
  return mouths.map((mouth, k): CurbJoin => {
    const next = mouths[(k + 1) % mouths.length]!;
    const wraps = k === mouths.length - 1;
    if (mouths.length > 1 && armOf[k] === armOf[(k + 1) % mouths.length] && !(wraps && single))
      return {
        kind: 'straight',
        step: true,
        points: [mouth.right, next.left],
        radius: 0,
        directions: [mouth.direction, next.direction],
      };
    return curbJoin(mouth.rightEdge, next.leftEdge, origin, single);
  });
}

function closeOutline(points: Vec2[]): Vec2[] {
  const ring = points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) > 1e-6);
  if (ring.length) {
    if (distance(ring[0]!, ring.at(-1)!) <= 1e-6) ring.pop();
    ring.push(ring[0]!);
  }
  return ring;
}

/** The interior vertices of an outward edge closer to its start than `station`. */
function edgeUpTo(edge: Vec2[], station: number): Vec2[] {
  const lengths = cumulativeLengths(edge);
  return edge.filter((_, i) => i > 0 && lengths[i]! < station - 1e-6);
}

/** A circular arc with dense samples at both ends, so its end chords follow the tangents. */
function denseArc(center: Vec2, radius: number, start: number, sweep: number): Vec2[] {
  const arc = sampleArc(center, radius, start, sweep);
  const at = (t: number) => ({
    x: center.x + radius * Math.cos(start + sweep * t),
    y: center.y + radius * Math.sin(start + sweep * t),
  });
  const first = 1 / (arc.length - 1);
  const ends = [0.001, 0.004, 0.01, 0.02].filter((t) => t < first / 2);
  return [
    arc[0]!,
    ...ends.map(at),
    ...arc.slice(1, -1),
    ...ends.map((t) => at(1 - t)).reverse(),
    arc.at(-1)!,
  ];
}

/** The part of an outward edge beyond `station`. */
function edgeFrom(edge: Vec2[], station: number): Vec2[] {
  const lengths = cumulativeLengths(edge);
  const i = Math.max(
    1,
    lengths.findIndex((l) => l > station),
  );
  const a = edge[i - 1]!,
    b = edge[i]!;
  const t = Math.min(
    1,
    (station - lengths[i - 1]!) / Math.max(lengths[i]! - lengths[i - 1]!, 1e-12),
  );
  return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...edge.slice(i)];
}

/** The curb from one road end's right corner to the next end's left corner. */
function curbJoin(a: Vec2[], b: Vec2[], origin: Vec2, deadEnd: boolean): CurbJoin {
  const directions: [Vec2, Vec2] = [leaving(a), leaving(b)];
  const straight: CurbJoin = { kind: 'straight', points: [a[0]!, b[0]!], radius: 0, directions };
  if (deadEnd) {
    const center = { x: (a[0]!.x + b[0]!.x) / 2, y: (a[0]!.y + b[0]!.y) / 2 };
    const radius = distance(a[0]!, b[0]!) / 2;
    const start = Math.atan2(a[0]!.y - center.y, a[0]!.x - center.x);
    // The cap bulges back toward the node, away from the road.
    const half = start + Math.PI / 2;
    const sweep =
      Math.cos(half) * directions[0].x + Math.sin(half) * directions[0].y < 0 ? Math.PI : -Math.PI;
    return {
      ...straight,
      kind: 'fillet',
      radius,
      first: a[0],
      last: b[0],
      points: denseArc(center, radius, start, sweep),
    };
  }
  const hit = meet(extended(a), extended(b), origin);
  if (hit && cross(hit.da, hit.db) > 0 && (hit.a > 0.01 || hit.b > 0.01))
    return {
      ...straight,
      kind: 'gore',
      control: hit.point,
      points: [a[0]!, ...edgeUpTo(a, hit.a), hit.point, ...edgeUpTo(b, hit.b).reverse(), b[0]!],
    };
  // A corner behind both cuts takes a fillet toward it; curbs that never meet near the node
  // (a lateral step, opposite arms) take an S-curve along both edges.
  const span = distance(a[0]!, b[0]!);
  const shape: Curb =
    hit && hit.a < -0.05 && hit.b < -0.05
      ? {
          va: { x: hit.point.x - a[0]!.x, y: hit.point.y - a[0]!.y },
          vb: { x: hit.point.x - b[0]!.x, y: hit.point.y - b[0]!.y },
          handles: CORNER_HANDLES,
        }
      : {
          va: { x: -directions[0].x * span, y: -directions[0].y * span },
          vb: { x: -directions[1].x * span, y: -directions[1].y * span },
          handles: STEP_HANDLES,
        };
  if (span < 1e-6) return straight;
  return {
    ...straight,
    kind: 'fillet',
    control: hit?.point,
    shape,
    first: a[0],
    last: b[0],
    points: curbPoints(a[0]!, b[0]!, shape, shape.handles[0]!),
  };
}

type Curb = { va: Vec2; vb: Vec2; handles: number[] };

function curbPoints(a: Vec2, b: Vec2, shape: Curb, handle: number): Vec2[] {
  return sampleCubic(
    a,
    { x: a.x + shape.va.x * handle, y: a.y + shape.va.y * handle },
    { x: b.x + shape.vb.x * handle, y: b.y + shape.vb.y * handle },
    b,
  );
}

export function junctionOutline(node: CNode, roads: CRoad[], lanes: CLane[]): Vec2[] {
  if (node.setbacks.every((s) => s === 0)) return [];
  const reach = CORNER_REACH_M + 10;
  const near = (edge: Vec2[]) => {
    const beyond = edge.findIndex((p, i) => i > 1 && distance(p, node.pos) > reach);
    return beyond < 0 ? edge : edge.slice(0, beyond + 1);
  };
  const ends = roads.map((road, index): Mouth => {
    const ring = road.surface;
    const half = ring.length / 2;
    const incoming = road.to === node.idx;
    const travelLeft = ring.slice(0, half),
      travelRight = ring.slice(half).reverse();
    const leftEdge = near(incoming ? [...travelRight].reverse() : travelLeft);
    const rightEdge = near(incoming ? [...travelLeft].reverse() : travelRight);
    const left = leftEdge[0]!,
      right = rightEdge[0]!;
    const width = distance(left, right);
    return {
      roads: [road.idx],
      arm:
        road.streetGroupId === null
          ? road.id
          : `${road.streetGroupId}:${incoming ? road.from : road.to}`,
      left,
      right,
      leftEdge,
      rightEdge,
      direction: { x: (right.y - left.y) / width, y: (left.x - right.x) / width },
      leftStart: left,
      rightStart: right,
      setback: node.setbacks[index]!,
    };
  });
  const arms = directions(
    ends,
    node.pos,
    (e) => extended(e.leftEdge),
    (e) => extended(e.rightEdge),
  );
  // Two ends of one direction that overlap at their mouths and part further out: both mouths
  // move out to where their facing edges part, so the junction covers their overlap.
  for (const arm of arms)
    for (let k = 1; k < arm.length; k++) {
      const a = arm[k - 1]!,
        b = arm[k]!;
      const d = a.direction;
      if ((b.left.x - a.right.x) * -d.y + (b.left.y - a.right.y) * d.x > -0.05) continue;
      const hits = polylineCrossings(a.rightEdge, b.leftEdge).filter(
        (hit) => distance(hit.point, node.pos) <= CORNER_REACH_M,
      );
      if (!hits.length) continue;
      const hit = hits.reduce((x, y) =>
        Math.max(y.alongA, y.alongB) < Math.max(x.alongA, x.alongB) ? y : x,
      );
      for (const [end, out] of [
        [a, hit.alongA],
        [b, hit.alongB],
      ] as const) {
        if (out <= 0.01 || distance(hit.point, node.pos) > MOUTH_REACH_M) continue;
        end.leftEdge = edgeFrom(end.leftEdge, out);
        end.rightEdge = edgeFrom(end.rightEdge, out);
        end.left = end.leftEdge[0]!;
        end.right = end.rightEdge[0]!;
      }
    }
  // An end lying within another end of its direction (a coincident source carriageway, which
  // architecture 5.1 does not repair) has no mouth of its own; partly overlapping ends share one.
  const mouths: Mouth[] = [];
  const armOf: number[] = [];
  arms.forEach((arm, k) => {
    const d = arm.reduce((s, e) => ({ x: s.x + e.direction.x, y: s.y + e.direction.y }), {
      x: 0,
      y: 0,
    });
    const lateral = (p: Vec2) => -(p.x - node.pos.x) * d.y + (p.y - node.pos.y) * d.x;
    let last: Mouth | undefined;
    for (const end of arm) {
      if (!last || lateral(end.left) >= lateral(last.right) - 0.05) {
        last = { ...end, roads: [...end.roads] };
        mouths.push(last);
        armOf.push(k);
        continue;
      }
      const roads = [...last.roads, ...end.roads];
      const within = lateral(end.right) <= lateral(last.right) + 0.05;
      const around = lateral(end.left) <= lateral(last.left) + 0.05;
      // Of two coincident ends the one cut farther out is the mouth; the other lies under it.
      if (within && !(around && end.setback > last.setback)) last.roads = roads;
      else if (around) Object.assign(last, end, { roads });
      else {
        // Partly overlapping ends share one mouth, at the cut farther out.
        const along = (p: Vec2) => (p.x - node.pos.x) * d.x + (p.y - node.pos.y) * d.y;
        const scale = Math.hypot(d.x, d.y);
        const gap = (along(last.right) - along(end.right)) / scale;
        let rightEdge = end.rightEdge;
        if (gap > 0.01) rightEdge = edgeFrom(rightEdge, gap);
        else if (gap < -0.01) {
          last.leftEdge = edgeFrom(last.leftEdge, -gap);
          last.left = last.leftEdge[0]!;
        }
        Object.assign(last, { right: rightEdge[0]!, rightEdge, roads });
      }
    }
  });
  // A cut held short of its corner by the cap: the outline's mouth moves out to where the
  // uncapped cut would be, so the junction surface covers the capped pair's overlap (and the
  // road surface under it) while the lanes keep their storage (architecture 5.1, TASK-074).
  const extra = mouths.map(() => 0);
  mouths.forEach((mouth, k) => {
    const j = (k + 1) % mouths.length;
    if (mouths.length < 2 || armOf[k] === armOf[j]) return;
    const next = mouths[j]!;
    const hit = meet(extended(mouth.rightEdge), extended(next.leftEdge), node.pos);
    if (!hit || cross(hit.da, hit.db) <= 0) return;
    const cosine = Math.max(-1, Math.min(1, hit.da.x * hit.db.x + hit.da.y * hit.db.y));
    const t = CURB_RADIUS_M * Math.tan(Math.min(Math.PI / 2, Math.PI - Math.acos(cosine)) / 2);
    if (hit.a + t > 0.01) extra[k] = Math.max(extra[k]!, hit.a + t);
    if (hit.b + t > 0.01) extra[j] = Math.max(extra[j]!, hit.b + t);
  });
  mouths.forEach((mouth, k) => {
    const lengths = [mouth.leftEdge, mouth.rightEdge].map((e) => cumulativeLengths(e).at(-1)!);
    const out = Math.min(extra[k]!, ...lengths.map((l) => l / 2));
    if (out <= 0.01) return;
    mouth.leftEdge = edgeFrom(mouth.leftEdge, out);
    mouth.rightEdge = edgeFrom(mouth.rightEdge, out);
    mouth.left = mouth.leftEdge[0]!;
    mouth.right = mouth.rightEdge[0]!;
  });
  const shape = { mouths, armOf, single: arms.length === 1, origin: node.pos };
  const joins = buildJoins(shape);
  const laneEnds = roads.flatMap((road) =>
    road.lanes.map((index) => {
      const lane = lanes[index]!;
      return distance(node.pos, road.to === node.idx ? lane.polyline.at(-1)! : lane.polyline[0]!);
    }),
  );
  // The outline stays within 8 m of the lane ends, or reaches a gore tip or a moved mouth.
  const limit = Math.max(
    0,
    ...laneEnds.map((d) => d + 8),
    ...joins.filter((j) => j.kind === 'gore').map((j) => distance(node.pos, j.control!)),
    ...mouths.flatMap((m) => [m.left, m.right].map((p) => distance(node.pos, p) + 8)),
  );
  pendingJoins.set(node, { shape, joins, limit, roads });
  return assemble(mouths, joins);
}

function assemble(mouths: Mouth[], joins: CurbJoin[]): Vec2[] {
  return closeOutline(mouths.flatMap((mouth, k) => [mouth.left, ...joins[k]!.points]));
}

/** A movement's surface samples: centre and both edges at every vertex, across the curve's
 * tangent (the lanes' own directions at the two ends, where the movement meets them). */
export function movementSamples(m: CMovement, lanes: CLane[]): Vec2[] {
  const from = lanes[m.fromLane]!,
    to = lanes[m.toLane]!;
  const width = Math.min(from.widthM, to.widthM) / 2;
  const last = m.polyline.length - 1;
  const along = (heading: number) => ({ x: Math.cos(heading), y: Math.sin(heading) });
  return m.polyline.flatMap((p, k) => {
    const d =
      k === 0
        ? along(headingAtDistance(from.polyline, from.cumulative, from.lengthM))
        : k === last
          ? along(headingAtDistance(to.polyline, to.cumulative, 0))
          : unit(m.polyline[k - 1]!, m.polyline[k + 1]!);
    return [-1, 0, 1].map((side) => ({
      x: p.x - d.y * width * side,
      y: p.y + d.x * width * side,
    }));
  });
}

/** Samples of the node's movement surfaces that lie neither in `outline` nor on the surface of
 * the movement's own approach or exit road: a hairpin tighter than its half width sweeps back
 * over its own lanes behind the stop line, which is road, not junction (0.1 m tolerance). */
export function escapingSamples(
  node: CNode,
  movements: CMovement[],
  lanes: CLane[],
  roads: CRoad[],
  outline: Vec2[],
): Vec2[][] {
  const inside = preparePolygon(outline, 0.1);
  const surfaces = new Map(
    roads.map((road) => [road.idx, preparePolygon([...road.surface, road.surface[0]!], 0.1)]),
  );
  return node.movements.map((i) => {
    const m = movements[i]!;
    const own = [lanes[m.fromLane]!.road, lanes[m.toLane]!.road].map((r) => surfaces.get(r)!);
    return movementSamples(m, lanes).filter((p) => !inside(p) && !own.some((on) => on(p)));
  });
}

/** Both outer edges of every movement, slightly wider than its surface, along the movement's cubic
 * (architecture 5.2: control distance 0.4 chord along the lanes) sampled densely at its ends. */
function movementEdges(node: CNode, movements: CMovement[], lanes: CLane[]): Vec2[][] {
  return node.movements.flatMap((i) => {
    const m = movements[i]!;
    const from = lanes[m.fromLane]!,
      to = lanes[m.toLane]!;
    const start = m.polyline[0]!,
      end = m.polyline.at(-1)!;
    const h0 = headingAtDistance(from.polyline, from.cumulative, from.lengthM),
      h1 = headingAtDistance(to.polyline, to.cumulative, 0);
    const control = distance(start, end) * 0.4;
    if (control < 1e-6) return [];
    const curve = sampleCubic(
      start,
      { x: start.x + Math.cos(h0) * control, y: start.y + Math.sin(h0) * control },
      { x: end.x - Math.cos(h1) * control, y: end.y - Math.sin(h1) * control },
      end,
    );
    const width = Math.min(from.widthM, to.widthM) / 2;
    const lengths = cumulativeLengths(curve);
    return [-1, 1].map((side) =>
      curve.map((p, k) => {
        // 3 cm of margin in the middle, none at the ends, so the curb meets the corners tangent.
        const u = lengths[k]! / lengths.at(-1)!;
        const offset = (width + 0.12 * u * (1 - u)) * side;
        const d =
          k === 0
            ? { x: Math.cos(h0), y: Math.sin(h0) }
            : k === curve.length - 1
              ? { x: Math.cos(h1), y: Math.sin(h1) }
              : unit(curve[k - 1]!, curve[k + 1]!);
        return { x: p.x - d.y * offset, y: p.y + d.x * offset };
      }),
    );
  });
}

/** After movement generation: a fillet that leaves part of a movement surface outside takes
 * shorter handles, cutting deeper into the corner. Lane geometry and mouths never move. */
export function containMovements(node: CNode, movements: CMovement[], lanes: CLane[]) {
  const pending = pendingJoins.get(node);
  pendingJoins.delete(node);
  if (!pending) return { joins: [] as CurbJoin[], limit: 0, contained: true };
  const { shape, limit, roads } = pending;
  const { mouths } = shape;
  let joins = pending.joins;
  // Only samples off the movements' own roads can need more junction surface; that test is
  // made once per sample, and only for samples some candidate outline leaves out.
  const surfaces = new Map<number, (p: Vec2) => boolean>();
  const surface = (road: number) => {
    let inside = surfaces.get(road);
    if (!inside) {
      const ring = roads.find((r) => r.idx === road)!.surface;
      surfaces.set(road, (inside = preparePolygon([...ring, ring[0]!], 0.1)));
    }
    return inside;
  };
  const points = node.movements.flatMap((i) => {
    const m = movements[i]!;
    const own = [lanes[m.fromLane]!.road, lanes[m.toLane]!.road];
    return movementSamples(m, lanes).map((p) => ({
      p,
      own,
      road: undefined as boolean | undefined,
    }));
  });
  const off = (s: (typeof points)[number], inside: (p: Vec2) => boolean) => {
    if (inside(s.p)) return false;
    s.road ??= s.own.some((r) => surface(r)(s.p));
    return !s.road;
  };
  // Which samples the outline leaves out; a candidate changes one join, so only samples near
  // the old and new join can change.
  let flags = (() => {
    const inside = preparePolygon(node.outline, 0.1);
    return points.map((s) => off(s, inside));
  })();
  const listed = (f: boolean[]) => points.filter((_, i) => f[i]).map((s) => s.p);
  const trial = (ring: Vec2[], before: Vec2[], after: Vec2[]) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of [...before, ...after]) {
      minX = Math.min(minX, p.x - 0.2);
      minY = Math.min(minY, p.y - 0.2);
      maxX = Math.max(maxX, p.x + 0.2);
      maxY = Math.max(maxY, p.y + 0.2);
    }
    const inside = preparePolygon(ring, 0.1);
    return points.map((s, i) =>
      s.p.x < minX || s.p.x > maxX || s.p.y < minY || s.p.y > maxY ? flags[i]! : off(s, inside),
    );
  };
  const count = (f: boolean[]) => f.reduce((n, x) => n + (x ? 1 : 0), 0);
  let missing = listed(flags);
  for (let pass = 0; pass < 3 && missing.length; pass++) {
    if (pass > 0) {
      // Last resort: a mouth that a movement surface crosses moves out past it (as the TASK-063
      // surface cuts did), its road end then lying under the outline; lanes never move.
      const shift = mouths.map(() => 0);
      for (const p of missing) {
        let best = -1,
          nearest = Infinity;
        mouths.forEach((m, k) => {
          const away = distanceToLine(p, [m.left, m.right]);
          if (away < nearest) {
            nearest = away;
            best = k;
          }
        });
        const m = mouths[best]!;
        const depth = (p.x - m.left.x) * m.direction.x + (p.y - m.left.y) * m.direction.y;
        if (nearest < 2 && depth > 0) shift[best] = Math.max(shift[best]!, depth + 0.15);
      }
      if (shift.every((d) => d === 0)) break;
      const saved = mouths.map((m) => ({ ...m }));
      shift.forEach((out, k) => {
        const m = mouths[k]!;
        const room = Math.min(
          ...[m.leftEdge, m.rightEdge].map((e) => cumulativeLengths(e).at(-1)! / 2),
        );
        if (out <= 0 || out > room) return;
        m.leftEdge = edgeFrom(m.leftEdge, out);
        m.rightEdge = edgeFrom(m.rightEdge, out);
        m.left = m.leftEdge[0]!;
        m.right = m.rightEdge[0]!;
      });
      const rebuilt = buildJoins(shape);
      const ring = assemble(mouths, rebuilt);
      if (!simpleOutline(ring)) {
        saved.forEach((m, k) => Object.assign(mouths[k]!, m));
        break;
      }
      joins = rebuilt;
      node.outline = ring;
      const inside = preparePolygon(ring, 0.1);
      flags = points.map((s) => off(s, inside));
      missing = listed(flags);
    }
    for (let k = 0; k < joins.length && missing.length; k++) {
      const join = joins[k]!;
      const nearest = missing.filter(
        (p) =>
          distanceToLine(p, join.points) <=
          Math.min(...joins.map((j) => distanceToLine(p, j.points))) + 1e-6,
      );
      if (!nearest.length) continue;
      if (join.step) {
        // A movement crossing the shorter end's surface beside the step: a strip of that surface,
        // along the step and as wide as needed, joins the junction; both mouths stay whole.
        const next = mouths[(k + 1) % mouths.length]!,
          mouth = mouths[k]!;
        const [a, b] = join.points as [Vec2, Vec2];
        const d = mouth.direction;
        const nearer = (a.x - b.x) * d.x + (a.y - b.y) * d.y < 0;
        const corner = nearer ? a : b;
        const across = nearer ? unit(a, mouth.left) : unit(b, next.right);
        const depth = Math.max(
          ...nearest.map((p) => (p.x - corner.x) * across.x + (p.y - corner.y) * across.y),
        );
        if (!(depth > 0) || depth > distance(mouth.left, mouth.right)) continue;
        const shift = { x: across.x * (depth + 0.05), y: across.y * (depth + 0.05) };
        const moved = (p: Vec2) => ({ x: p.x + shift.x, y: p.y + shift.y });
        // The strip's side of the shorter mouth replaces its corner, so the mouth stays one line.
        const saved = next.left;
        joins[k] = { ...join, points: nearer ? [moved(a), moved(b), b] : [a, moved(a)] };
        if (!nearer) next.left = moved(b);
        const ring = assemble(mouths, joins);
        const result = trial(ring, [a, b], [moved(a), moved(b)]);
        if (count(result) < missing.length && simpleOutline(ring)) {
          node.outline = ring;
          flags = result;
          missing = listed(flags);
        } else {
          joins[k] = join;
          next.left = saved;
        }
        continue;
      }
      if (!join.shape) continue;
      let best = { join, ring: node.outline, flags, left: missing.length };
      const consider = (candidate: CurbJoin) => {
        joins[k] = candidate;
        const ring = assemble(mouths, joins);
        const result = trial(ring, join.points, candidate.points);
        const left = count(result);
        if (left < best.left && simpleOutline(ring))
          best = { join: candidate, ring, flags: result, left };
      };
      for (const handle of join.shape.handles.slice(1))
        consider({
          ...join,
          points: curbPoints(join.points[0]!, join.points.at(-1)!, join.shape, handle),
        });
      // Last, the curb follows the outer edge of a movement that runs from corner to corner.
      const a = join.points[0]!,
        b = join.points.at(-1)!;
      for (const line of best.left ? movementEdges(node, movements, lanes) : []) {
        const edge = distance(line[0]!, a) < distance(line.at(-1)!, a) ? line : [...line].reverse();
        if (distance(edge[0]!, a) > 0.15 || distance(edge.at(-1)!, b) > 0.15) continue;
        consider({ ...join, points: [a, ...edge.slice(1, -1), b] });
      }
      joins[k] = best.join;
      node.outline = best.ring;
      flags = best.flags;
      missing = listed(flags);
    }
  }
  return {
    joins,
    limit,
    get contained() {
      return !missing.length && simpleOutline(node.outline);
    },
  };
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
