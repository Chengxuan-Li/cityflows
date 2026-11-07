import {
  areaD,
  booleanOpD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  type PathD,
} from 'clipper2-ts';
import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  polylineCrossings,
  preparePolygon,
  vertexNormals,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Road, RoadClass } from '../schema';
import { offsetLine, type Reference } from './corridor';
import { CONVERGING, roadWidth, sameStreet, shiftAt, smoothstep } from './lanes';
import type { CLane, CMovement, CNode, CRoad } from './types';

// Junction polygons (TASK-083, architecture 5.1), osm2streets-style on TASK-082's corridors. The
// road ends of one corridor approaching a node together form one approach; each road end is cut
// square to its own reference line where its edges cross a neighbouring approach's; a through
// road keeps its alignment across the node; the junction is the clipper union of the region
// between the cuts, the curb arcs between neighbouring approaches and every movement surface.

/** Longest setback at acute approaches beyond what clearing the widest neighbouring road end at
 * a right angle needs: past it the roads merge as one surface instead of stopping cars ever
 * farther from the junction (lead decision at the TASK-061 review); the polygon covers the
 * overlap beyond it (the TASK-063 gore). */
export const SETBACK_CAP_M = 10;

/** Curb radius of a corner by the lower-ranked road's class (TASK-078). */
export const CURB_RADIUS_M: Record<RoadClass, number> = {
  service: 6,
  residential: 6,
  tertiary: 9,
  secondary: 9,
  primary: 12,
  trunk: 12,
  motorway: 12,
  ramp: 12,
};

/** Radius whose tangent length is added to a cut beyond the crossing it clears: 1 m at a right
 * angle, the TASK-061 margin. A class radius there would cost every approach up to 11 m of queue
 * storage (T38.4); the class-radius curb instead runs on along the road edges beyond the cut. */
const MARGIN_RADIUS_M = 1;
/** Crossings and corners farther from the node than this are not the junction's. */
const REACH_M = 50;
/** How far out a road end's direction is taken for its angular place. */
const FACING_M = 5;
/** How far out a through road's alignment is taken on each side (the audit's `APPROACH_M`). */
const ALIGNMENT_M = 20;
/** A through road keeps its alignment where it passes the node within this distance: moving it
 * moves the side roads' cuts as much, and T38.4 allows no lane to lose more than 2 m. Farther
 * off (a Y, a node between two carriageways) it keeps it only where the side roads' cuts move
 * with it by no more than that (B43, `farThrough`); else the road keeps its centerline. */
export const MAX_SHIFT_M = 2;
/** Road ends of one corridor within this angle of each other approach the node together; two
 * carriageways farther apart are two approaches with a curb (or a gore) between them. */
const SAME_APPROACH = (20 * Math.PI) / 180;
/** Neighbours closer than this whose facing edges never meet are one direction (TASK-074). */
const SAME_DIRECTION = (60 * Math.PI) / 180;
/** Ends within 3 degrees of each other run the same way: one can shadow the other. */
const COINCIDENT = Math.cos(Math.PI / 60);
/** Ends within 5 degrees of parallel never cut each other (TASK-061 clarification). */
const PARALLEL = Math.sin(Math.PI / 36);
const OPPOSITE = Math.cos((150 * Math.PI) / 180);
const ALONG = Math.cos(Math.PI / 6);
/** A smaller curb is no curb: the corner stays the chord between the cuts. A curb's tangent
 * points lie within `FIT_M` of the road edges. */
const FIT_M = 0.25;
const MIN_CURB_M = 0.5;
/** A curb's tangent point lies within this share of its road, counted from the node: half, the
 * other end's curb taking the other half (TASK-092; 40 percent left short roads' corners sharp). */
const CURB_REACH = 0.5;
/** The radius rounding a gore's tip (TASK-092): a nose between two roads overlapping at an acute
 * angle, not a corner block, so it fills the notch no farther than this needs. */
const GORE_RADIUS_M = 2;
/** How far beyond the cut a median's nose may move to keep the movement surfaces off the median. */
const NOSE_REACH_M = 3;
/** The median between attached carriageways (TASK-099). */
const ATTACHED_M = 0.5;
/** Spacing of the samples of a through road's alignment and of curb arcs. */
const SAMPLE_M = 0.5;
const ARC_STEP = (3 * Math.PI) / 180;
/** clipper2-ts precision (decimal places). */
const PRECISION = 3;

const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const unit = (v: Vec2) => {
  const length = Math.hypot(v.x, v.y);
  return { x: v.x / length, y: v.y / length };
};
const reach = (total: number, m: number) => Math.min(m, total / 2);
const neg = (v: Vec2) => ({ x: -v.x, y: -v.y });
/** A road with a converging shift (TASK-089) at either end. */
const shifted = (road: CRoad) => road.startShift.length > 0 || road.endShift.length > 0;

// ---------------------------------------------------------------------------------------------
// Through nodes: two ends of one street, setback 0, no outline (TASK-061, unchanged).

function isThroughNode(node: CNode, roads: Road[]): boolean {
  if (node.control !== 'uncontrolled') return false;
  const arms = new Map<string, { road: Road; heading: number; width: number }[]>();
  for (const road of roads) {
    const outgoing = road.from === node.id;
    const line = outgoing ? road.centerline : [...road.centerline].reverse();
    const heading = Math.atan2(line[1]!.y - line[0]!.y, line[1]!.x - line[0]!.x);
    const other = outgoing ? road.to : road.from;
    const key = road.streetGroupId === null ? road.id : `${road.streetGroupId}:${other}`;
    arms.set(key, [...(arms.get(key) ?? []), { road, heading, width: roadWidth(road) }]);
  }
  if (arms.size !== 2) return false;
  const [a, b] = [...arms.values()] as [
    { road: Road; heading: number; width: number }[],
    { road: Road; heading: number; width: number }[],
  ];
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

// ---------------------------------------------------------------------------------------------
// Through roads keep their alignment.

/** An incoming and an outgoing road at a node whose reference lines meet at `at` with one
 * tangent: the through road runs on along its own line there. */
export interface ThroughPair {
  from: number;
  to: number;
  at: Vec2;
}

/** A replacement of the first (`start`) or last `lengthM` of a source reference line, in the
 * source's orientation, with the normal at its node end. */
interface Replacement {
  lengthM: number;
  points: Vec2[];
  normal: Vec2;
}

function cubicPoint(c: Vec2[], t: number): Vec2 {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: w[0]! * c[0]!.x + w[1]! * c[1]!.x + w[2]! * c[2]!.x + w[3]! * c[3]!.x,
    y: w[0]! * c[0]!.y + w[1]! * c[1]!.y + w[2]! * c[2]!.y + w[3]! * c[3]!.y,
  };
}

/** The two halves of a cubic split at `t` (de Casteljau). */
function splitCubic(c: Vec2[], t: number): [Vec2[], Vec2[]] {
  const mix = (a: Vec2, b: Vec2) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const [p0, p1, p2, p3] = c as [Vec2, Vec2, Vec2, Vec2];
  const a = mix(p0, p1),
    b = mix(p1, p2),
    d = mix(p2, p3);
  const e = mix(a, b),
    f = mix(b, d);
  const g = mix(e, f);
  return [
    [p0, a, e, g],
    [g, f, d, p3],
  ];
}

/** A cubic split where it passes `pos` most closely: the two halves, the split point and the
 * unit tangent there. */
function splitNearest(cubic: Vec2[], pos: Vec2) {
  let t = 0,
    best = Infinity;
  for (let i = 0; i <= 200; i++) {
    const d = distance(cubicPoint(cubic, i / 200), pos);
    if (d < best) [best, t] = [d, i / 200];
  }
  for (let step = 1 / 400; step > 1e-7; step /= 2)
    for (const next of [t - step, t + step])
      if (next > 0 && next < 1 && distance(cubicPoint(cubic, next), pos) < best)
        [best, t] = [distance(cubicPoint(cubic, next), pos), next];
  const [before, after] = splitCubic(cubic, t);
  const at = before[3]!;
  return { before, after, at, tangent: unit(sub(after[1]!, at)) };
}

function sampleHalf(c: Vec2[], minSteps = 2): Vec2[] {
  const length = distance(c[0]!, c[1]!) + distance(c[1]!, c[2]!) + distance(c[2]!, c[3]!);
  const steps = Math.max(minSteps, Math.ceil(length / SAMPLE_M));
  return Array.from({ length: steps + 1 }, (_, i) => cubicPoint(c, i / steps));
}

/** Point and unit tangent of a reference at station `s`, the tangent the chord over ±1 m. */
function frameAt(ref: Reference, s: number) {
  const total = ref.lengths.at(-1)!;
  const p = pointAtDistance(ref.points, ref.lengths, s);
  const a = pointAtDistance(ref.points, ref.lengths, Math.max(0, s - 1));
  const b = pointAtDistance(ref.points, ref.lengths, Math.min(total, s + 1));
  return { p, t: unit(sub(b, a)) };
}

/** Outward unit direction of a road end: the chord from the node to its reference's point `m`
 * out (at most half the road). */
function outwardChord(ref: Reference, incoming: boolean, m: number): Vec2 {
  const total = ref.lengths.at(-1)!;
  const node = incoming ? ref.points.at(-1)! : ref.points[0]!;
  const far = pointAtDistance(
    ref.points,
    ref.lengths,
    incoming ? total - reach(total, m) : reach(total, m),
  );
  return unit(sub(far, node));
}

function rebuilt(ref: Reference, points: Vec2[], normals: Vec2[]): Reference {
  return { ...ref, points, lengths: cumulativeLengths(points), normals, reversed: false };
}

function reversed(ref: Reference): Reference {
  const total = ref.lengths.at(-1)!;
  return {
    ...ref,
    reversed: !ref.reversed,
    points: [...ref.points].reverse(),
    lengths: Float64Array.from(ref.lengths, (s) => total - s).reverse(),
    normals: ref.normals.map((n) => ({ x: -n.x, y: -n.y })).reverse(),
    eased: ref.eased.map((e) => ({ ...e, fromM: total - e.toM, toM: total - e.fromM })),
  };
}

/** At every junction (a node with a side road end, not within 30 degrees of a through road), the
 * through roads keep their line: an incoming and an outgoing road end within 30 degrees of
 * opposite, both of the node's highest class (the audit's through pairs), each road end in at
 * most one pair, most nearly opposite first. Within `ALIGNMENT_M` of the node (at most half the
 * road) both reference lines are replaced by one cubic (handles a third of the chord) from the
 * incoming line `ALIGNMENT_M` before the node to the outgoing line as far after it, split where
 * it passes the node most closely, so the road no longer dips toward the node point; where that
 * is more than `maxShift` (by node, `MAX_SHIFT_M` by default) from the node the pair keeps its
 * lines. Mutates `references`; returns each node's pairs. */
export function throughAlignments(
  nodes: CNode[],
  incident: CRoad[][],
  sources: Road[],
  references: Reference[],
  maxShift: (node: CNode) => number = () => MAX_SHIFT_M,
  flows: [number, number][][] = [],
): ThroughPair[][] {
  const bySource = new Map<number, number[]>();
  references.forEach((ref, idx) =>
    bySource.set(ref.source, [...(bySource.get(ref.source) ?? []), idx]),
  );
  // The carriageways of a divided pair (TASK-084: a median between their lane blocks) may follow
  // different lines across a junction; the two directions of a street, side by side, may not.
  const divided = (source: number) =>
    bySource
      .get(source)!
      .every((r) => Math.abs(sources[r]!.lateralOffsetM) - roadWidth(sources[r]!) / 2 > 0.1);
  // The curve key each source line end at a node is replaced with.
  const claimed = new Map<string, string>();
  // Each pair's curve by its key, the two source line ends it replaces (a street's two
  // directions, sharing their reference lines, find the same curve), as the replacement of each.
  const curves = new Map<string, { at: Vec2; ends: Map<string, Replacement> }>();
  // Per road: the curve key and replacement of its source line's start and end.
  const replaced = new Map<
    number,
    { start?: [string, Replacement]; end?: [string, Replacement] }
  >();
  const result = nodes.map((node): ThroughPair[] => {
    const roads = incident[node.idx]!.filter((r) => r.from !== r.to);
    if (roads.length < 3) return [];
    const ends = roads.map((road) => {
      const incoming = road.to === node.idx;
      return { road, incoming, d: outwardChord(references[road.idx]!, incoming, ALIGNMENT_M) };
    });
    const top = Math.max(...roads.map((r) => r.classRank));
    const candidates = ends
      .flatMap((a) =>
        ends
          .filter((b) => a.incoming && !b.incoming && a.road !== b.road)
          .filter((b) => a.road.classRank === top && b.road.classRank === top)
          .map((b) => ({ a, b, cos: dot(a.d, b.d) })),
      )
      .filter((p) => p.cos < OPPOSITE)
      .sort((x, y) => x.cos - y.cos || x.a.road.idx - y.a.road.idx || x.b.road.idx - y.b.road.idx);
    // TASK-089: the flows of converging carriageways (`convergingFlows`) come first, whatever
    // their angle and distance from the node.
    const forced = (flows[node.idx] ?? []).flatMap(([from, to]) => {
      const a = ends.find((e) => e.road.idx === from && e.incoming),
        b = ends.find((e) => e.road.idx === to && !e.incoming);
      return a && b ? [{ a, b, cos: -Infinity }] : [];
    });
    candidates.unshift(...forced);
    const arms = candidates.flatMap((p) => [p.a.d, p.b.d]);
    if (!ends.some((e) => arms.every((arm) => dot(arm, e.d) <= ALONG))) return [];
    const used = new Set<CRoad>();
    const pairs: ThroughPair[] = [];
    for (const { a, b } of candidates) {
      if (used.has(a.road) || used.has(b.road)) continue;
      const ra = references[a.road.idx]!,
        rb = references[b.road.idx]!;
      const endA = ra.reversed ? 'start' : 'end',
        endB = rb.reversed ? 'end' : 'start';
      const ka = `${ra.source}:${endA}`,
        kb = `${rb.source}:${endB}`;
      const key = [ka, kb].sort().join('|');
      const taken = (k: string, source: number) =>
        claimed.has(k) && claimed.get(k) !== key && !divided(source);
      if (taken(ka, ra.source) || taken(kb, rb.source)) continue;
      let curve = curves.get(key);
      if (!curve) {
        const la = ra.lengths.at(-1)!,
          lb = rb.lengths.at(-1)!;
        const da = reach(la, ALIGNMENT_M),
          db = reach(lb, ALIGNMENT_M);
        const start = frameAt(ra, la - da),
          end = frameAt(rb, db);
        const handle = distance(start.p, end.p) / 3;
        const cubic = [
          start.p,
          { x: start.p.x + start.t.x * handle, y: start.p.y + start.t.y * handle },
          { x: end.p.x - end.t.x * handle, y: end.p.y - end.t.y * handle },
          end.p,
        ];
        const { before, after, at, tangent } = splitNearest(cubic, node.pos);
        const normal = { x: -tangent.y, y: tangent.x };
        // In the source line's orientation: a reversed reference runs against its source.
        const replacement = (ref: Reference, lengthM: number, points: Vec2[]): Replacement => ({
          lengthM,
          points: ref.reversed ? [...points].reverse() : points,
          normal: ref.reversed ? { x: -normal.x, y: -normal.y } : normal,
        });
        curve = {
          at,
          ends: new Map([
            [ka, replacement(ra, da, sampleHalf(before))],
            [kb, replacement(rb, db, sampleHalf(after))],
          ]),
        };
        curves.set(key, curve);
      }
      if (
        distance(curve.at, node.pos) >
        (forced.some((f) => f.a === a && f.b === b) ? Infinity : maxShift(node))
      )
        continue;
      claimed.set(ka, key);
      claimed.set(kb, key);
      used.add(a.road);
      used.add(b.road);
      for (const [road, end, k] of [
        [a.road, endA, ka],
        [b.road, endB, kb],
      ] as const)
        replaced.set(road.idx, { ...replaced.get(road.idx), [end]: [key, curve.ends.get(k)!] });
      pairs.push({ from: a.road.idx, to: b.road.idx, at: curve.at });
    }
    return pairs;
  });
  // Roads sharing a source line share the rebuilt line (a street's two directions, whichever of
  // them is paired); the carriageways of a divided pair paired otherwise (continuing into two
  // carriageways) each get their own near that node.
  for (const [source, members] of bySource) {
    const groups = new Map<string, number[]>();
    const merged: { start?: [string, Replacement]; end?: [string, Replacement] } = {};
    for (const idx of members) {
      const entry = replaced.get(idx);
      if (!entry) continue;
      const signature = `${entry.start?.[0] ?? ''}|${entry.end?.[0] ?? ''}`;
      groups.set(signature, [...(groups.get(signature) ?? []), idx]);
      merged.start ??= entry.start;
      merged.end ??= entry.end;
    }
    if (!groups.size) continue;
    if (!divided(source)) {
      groups.clear();
      groups.set('', members);
      for (const idx of members) replaced.set(idx, merged);
    }
    for (const group of groups.values()) {
      const { start, end } = replaced.get(group[0]!)!;
      const any = references[group[0]!]!;
      const forward = any.reversed ? reversed(any) : any;
      const total = forward.lengths.at(-1)!;
      const lo = start ? start[1].lengthM + 0.05 : -1,
        hi = end ? total - end[1].lengthM - 0.05 : total + 1;
      const points = [
        ...(start?.[1].points ?? []),
        ...forward.points.filter((_, i) => forward.lengths[i]! > lo && forward.lengths[i]! < hi),
        ...(end?.[1].points ?? []),
      ];
      const normals = vertexNormals(points);
      if (start) normals[0] = start[1].normal;
      if (end) normals[normals.length - 1] = end[1].normal;
      const line = rebuilt(forward, points, normals);
      const back = reversed(line);
      for (const idx of group) references[idx] = references[idx]!.reversed ? back : line;
    }
  }
  return result;
}

/** B43: the nodes whose through roads may keep their alignment farther than `MAX_SHIFT_M` from
 * the node: trying every through alignment, those whose road ends' cuts (as `junctionCuts`)
 * grow by no more than `storageM` against the alignments within `MAX_SHIFT_M`, except forks. */
export function farThrough(
  nodes: CNode[],
  incident: CRoad[][],
  sources: Road[],
  references: readonly Reference[],
  storageM: number,
): Set<number> {
  const near = [...references],
    far = [...references];
  const nearPairs = throughAlignments(nodes, incident, sources, near);
  const farPairs = throughAlignments(nodes, incident, sources, far, () => Infinity);
  const allowed = new Set<number>();
  for (const node of nodes) {
    if (farPairs[node.idx]!.length <= nearPairs[node.idx]!.length) continue;
    // Not at a fork, where a road continues into two ends nearly in line (a Y): the alignment
    // would follow one of them only.
    const ends = incident[node.idx]!.filter((r) => r.from !== r.to);
    const direction = (r: CRoad) =>
      outwardChord(references[r.idx]!, r.to === node.idx, ALIGNMENT_M);
    const fork = farPairs[node.idx]!.some((pair) =>
      [pair.from, pair.to].some((idx) => {
        const own = direction(ends.find((r) => r.idx === idx)!);
        return ends.some((e) => e.idx !== idx && dot(direction(e), own) > ALONG);
      }),
    );
    if (fork) continue;
    const before = junctionCuts(node, incident[node.idx]!, sources, near).setbacks;
    const after = junctionCuts(node, incident[node.idx]!, sources, far).setbacks;
    if (after.every((s, i) => s - before[i]! <= storageM)) allowed.add(node.idx);
  }
  return allowed;
}

/** A through movement on a through road follows the road's reference lines across the node,
 * offset by the lanes' lateral positions (eased by a smoothstep where they differ), from the
 * from-lane's end to the to-lane's start exactly. */
/** The reference lines of a through pair joined across the node, from the incoming road's cut to
 * the outgoing road's cut, with their normals and stations. */
function acrossNode(from: CRoad, to: CRoad) {
  const sa = from.stations.at(-1)!,
    sb = to.stations[0]!;
  const la = cumulativeLengths(from.reference),
    lb = cumulativeLengths(to.reference);
  const centre = [
    pointAtDistance(from.reference, la, sa),
    ...from.reference.filter((_, i) => la[i]! > sa + 0.05),
    ...to.reference.filter((_, i) => i > 0 && lb[i]! < sb - 0.05),
    pointAtDistance(to.reference, lb, sb),
  ];
  const lengths = cumulativeLengths(centre);
  return { centre, normals: vertexNormals(centre), lengths, total: lengths.at(-1)! };
}

export function throughPath(from: CRoad, to: CRoad, a: CLane, b: CLane): Vec2[] {
  const { centre, normals, lengths, total } = acrossNode(from, to);
  const start = a.polyline.at(-1)!,
    end = b.polyline[0]!;
  const latA = dot(sub(start, centre[0]!), normals[0]!),
    latB = dot(sub(end, centre.at(-1)!), normals.at(-1)!);
  const path = centre.map((p, k) => {
    const lateral = latA + (latB - latA) * smoothstep(total > 0 ? lengths[k]! / total : 1);
    return { x: p.x + normals[k]!.x * lateral, y: p.y + normals[k]!.y * lateral };
  });
  path[0] = start;
  path[path.length - 1] = end;
  return path;
}

// ---------------------------------------------------------------------------------------------
// Cuts.

interface CutEnd {
  index: number;
  road: CRoad;
  /** The reference line and the road's surface edges, outward from the node. */
  line: Vec2[];
  left: Vec2[];
  right: Vec2[];
  heading: number;
  /** The road's lane block `FACING_M` out: its middle and its left and right edges. */
  probe: Vec2;
  sides: [Vec2, Vec2];
  width: number;
  extent: number;
}

function cutEnd(node: CNode, road: CRoad, source: Road, ref: Reference, index: number): CutEnd {
  const incoming = road.to === node.idx;
  const total = ref.lengths.at(-1)!;
  const limit = Math.min(total, REACH_M + 10);
  const stations = incoming
    ? [total - limit, ...[...ref.lengths].filter((s) => s > total - limit && s < total), total]
    : [0, ...[...ref.lengths].filter((s) => s > 0 && s < limit), limit];
  const width = roadWidth(source);
  // The edges follow the converging shift (TASK-089).
  const shifts = stations.map((s) => shiftAt(road, s, total));
  const at = (lateral: number | number[]) => {
    const line = offsetLine(ref, stations, lateral);
    return incoming ? line.reverse() : line;
  };
  const edge = (side: number) =>
    at(shifts.map((shift) => source.lateralOffsetM + shift + (side * width) / 2));
  const travelLeft = edge(-1),
    travelRight = edge(1);
  const line = at(0);
  const lengths = cumulativeLengths(line);
  const s = reach(lengths.at(-1)!, FACING_M);
  const far = pointAtDistance(line, lengths, s);
  const left = incoming ? travelRight : travelLeft,
    right = incoming ? travelLeft : travelRight;
  const ll = cumulativeLengths(left),
    lr = cumulativeLengths(right);
  const pl = pointAtDistance(left, ll, Math.min(s, ll.at(-1)!)),
    pr = pointAtDistance(right, lr, Math.min(s, lr.at(-1)!));
  return {
    index,
    road,
    line,
    left,
    right,
    heading: Math.atan2(far.y - node.pos.y, far.x - node.pos.x),
    probe: { x: (pl.x + pr.x) / 2, y: (pl.y + pr.y) / 2 },
    sides: [pl, pr],
    width,
    // The setback cap clears the unshifted block: a converging shift would cut side roads farther.
    extent: Math.abs(source.lateralOffsetM) + width / 2,
  };
}

/** Road ends in angular order (increasing heading: each next one lies to the right), grouped into
 * approaches: consecutive ends of one corridor within 60 degrees of each other. Within an
 * approach the ends are ordered left to right. */
function approachesOf<E extends { road: CRoad; heading: number; probe: Vec2 }>(
  ends: E[],
  origin: Vec2,
  together: (a: E, b: E) => boolean = () => false,
): E[][] {
  const sorted = [...ends].sort((a, b) => a.heading - b.heading || a.road.idx - b.road.idx);
  const n = sorted.length;
  const joins = (a: E, b: E) => {
    const gap = (b.heading - a.heading + 2 * Math.PI) % (2 * Math.PI);
    return (
      (a.road.corridorId !== null &&
        a.road.corridorId === b.road.corridorId &&
        gap < SAME_APPROACH) ||
      (together(a, b) && gap < Math.acos(CONVERGING))
    );
  };
  const start = sorted.findIndex((e, i) => !joins(sorted[(i + n - 1) % n]!, e));
  const groups: E[][] = [];
  for (let k = 0; k < n; k++) {
    const i = (Math.max(0, start) + k) % n;
    if (k > 0 && joins(sorted[(i + n - 1) % n]!, sorted[i]!)) groups.at(-1)!.push(sorted[i]!);
    else groups.push([sorted[i]!]);
  }
  return groups.map((group) => {
    const d = group.reduce(
      (s, e) => ({ x: s.x + Math.cos(e.heading), y: s.y + Math.sin(e.heading) }),
      {
        x: 0,
        y: 0,
      },
    );
    const lateral = (e: E) => -(e.probe.x - origin.x) * d.y + (e.probe.y - origin.y) * d.x;
    const order = new Map(group.map((e, k) => [e, k]));
    return [...group].sort(
      (a, b) =>
        (Math.abs(lateral(a) - lateral(b)) > 0.05 ? lateral(a) - lateral(b) : 0) ||
        order.get(a)! - order.get(b)!,
    );
  });
}

/** Setbacks by incident road order and the node's approaches (incident indices, angular order,
 * each left to right). Each road end is cut square to its reference line where either of its
 * edges first meets the facing edge of a neighbouring approach (its right neighbour's leftmost
 * left edge, its left neighbour's rightmost right edge) at a concave corner, plus the tangent
 * length of a 1 m radius there (1 m for its far edge), with a floor of W/2 + 1 and the cap
 * (TASK-061 and TASK-074's rules on corridor approaches). Ends within 5 degrees of parallel, or
 * within 30 degrees of opposite, form no corner; the road ends of one approach do not cut each
 * other (the polygon covers the median between them). */
export function junctionCuts(
  node: CNode,
  incident: CRoad[],
  sources: Road[],
  references: Reference[],
): { setbacks: number[]; approaches: number[][]; hidden: number[] } {
  if (
    isThroughNode(
      node,
      incident.map((r) => sources[r.idx]!),
    )
  )
    return { setbacks: incident.map(() => 0), approaches: [], hidden: [] };
  const ends = incident.map((road, i) =>
    cutEnd(node, road, sources[road.idx]!, references[road.idx]!, i),
  );
  // TASK-089: the carriageways of one street set side by side here (both shifted) approach
  // together, so no curb fills the median between them.
  const shiftedHere = (r: CRoad) => (r.to === node.idx ? r.endShift : r.startShift).length > 0;
  const approaches = approachesOf(
    ends,
    node.pos,
    (a, b) =>
      shiftedHere(a.road) &&
      shiftedHere(b.road) &&
      sameStreet(sources[a.road.idx]!, sources[b.road.idx]!),
  );
  const setbacks = ends.map((e) => e.width / 2 + 1);
  // An end lying within another end running the same way (coincident source carriageways of two
  // corridors) is shadowed by it: it keeps the floor and faces no neighbour; the other end's cut
  // and the polygon hold it (TASK-074).
  const hidden = new Set(
    ends.filter((e) =>
      ends.some((o) => {
        if (o === e || Math.cos(o.heading - e.heading) < COINCIDENT) return false;
        const d = { x: Math.cos(o.heading), y: Math.sin(o.heading) };
        const lateral = (p: Vec2) => -(p.x - node.pos.x) * d.y + (p.y - node.pos.y) * d.x;
        const [el, er] = e.sides.map(lateral) as [number, number];
        const [ol, or] = o.sides.map(lateral) as [number, number];
        return (
          el >= ol - 0.05 &&
          er <= or + 0.05 &&
          (o.index < e.index || el > ol + 0.05 || er < or - 0.05)
        );
      }),
    ),
  );
  const facing = approaches.map((a) => a.filter((e) => !hidden.has(e))).filter((a) => a.length);
  facing.forEach((approach, i) => {
    const approaches = facing;
    const m = approaches.length;
    const sides =
      m > 1
        ? [
            { other: approaches[(i + 1) % m]!, side: 1 },
            { other: approaches[(i + m - 1) % m]!, side: -1 },
          ]
        : [];
    for (const end of approach) {
      const cap = Math.max(
        end.width / 2 + 1,
        SETBACK_CAP_M,
        ...sides.flatMap(({ other }) => other.map((o) => o.extent + 1)),
      );
      let s = setbacks[end.index]!;
      for (const { other, side } of sides) {
        const facingEnd = side > 0 ? other[0]! : other.at(-1)!;
        const facing = side > 0 ? facingEnd.left : facingEnd.right;
        const parallel = Math.abs(Math.sin(end.heading - facingEnd.heading)) < PARALLEL;
        for (const own of parallel ? [] : [end.left, end.right]) {
          const hit = polylineCrossings(own, facing)
            .filter((h) => distance(h.point, node.pos) <= REACH_M)
            .reduce<ReturnType<typeof polylineCrossings>[number] | undefined>(
              (best, h) =>
                !best || Math.max(h.alongA, h.alongB) < Math.max(best.alongA, best.alongB)
                  ? h
                  : best,
              undefined,
            );
          if (!hit) continue;
          const da = unit(sub(own[hit.i]!, own[hit.i - 1]!)),
            db = unit(sub(facing[hit.j]!, facing[hit.j - 1]!));
          if (side * cross(da, db) <= 0 || dot(da, db) < -ALONG) continue;
          const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, dot(da, db))));
          const margin =
            own === (side > 0 ? end.right : end.left)
              ? MARGIN_RADIUS_M * Math.tan(Math.min(Math.PI / 2, turn) / 2)
              : 1;
          s = Math.max(s, nearestOnPolyline(end.line, hit.point).along + margin);
        }
        // Neighbours within 60 degrees whose facing edges do not meet near the node (a merge,
        // carriageways at an acute angle) are one direction (TASK-074): the end is cut at the
        // farthest crossing of its edges with theirs, plus 1 m (TASK-061), within the cap.
        // As TASK-074 did, on the facing edges extended straight toward and past the node.
        const back = (edge: Vec2[]) => {
          const d = unit(sub(edge[1]!, edge[0]!));
          return [{ x: edge[0]!.x - d.x * REACH_M, y: edge[0]!.y - d.y * REACH_M }, ...edge];
        };
        const cornered = polylineCrossings(
          back(side > 0 ? end.right : end.left),
          back(facing),
        ).some((h) => distance(h.point, node.pos) <= REACH_M);
        const gap = Math.abs(
          Math.atan2(
            Math.sin(end.heading - facingEnd.heading),
            Math.cos(end.heading - facingEnd.heading),
          ),
        );
        if (cornered || gap >= SAME_DIRECTION) continue;
        for (const o of other)
          for (const a of [end.left, end.right])
            for (const b of [o.left, o.right])
              for (const hit of polylineCrossings(a, b))
                if (distance(hit.point, node.pos) <= REACH_M)
                  s = Math.max(s, nearestOnPolyline(end.line, hit.point).along + 1);
      }
      setbacks[end.index] = Math.min(cap, s);
    }
  });
  return {
    setbacks,
    approaches: approaches.map((a) => a.map((e) => e.index)),
    hidden: [...hidden].map((e) => e.index),
  };
}

// ---------------------------------------------------------------------------------------------
// The polygon.

interface PolygonEnd {
  road: CRoad;
  /** Cut corners and the surface edges outward from them. */
  left: Vec2[];
  right: Vec2[];
  setback: number;
  incoming: boolean;
  /** TASK-089: the end is shifted at this node (a split converging carriageway). */
  split: boolean;
}

function polygonEnd(node: CNode, road: CRoad, setback: number): PolygonEnd {
  const ring = road.surface;
  const half = ring.length / 2;
  const travelLeft = ring.slice(0, half),
    travelRight = ring.slice(half).reverse();
  const incoming = road.to === node.idx;
  const near = (edge: Vec2[]) => {
    const lengths = cumulativeLengths(edge);
    const beyond = edge.findIndex((_, i) => i > 1 && lengths[i]! > REACH_M);
    return beyond < 0 ? edge : edge.slice(0, beyond + 1);
  };
  return {
    road,
    left: near(incoming ? [...travelRight].reverse() : travelLeft),
    right: near(incoming ? [...travelLeft].reverse() : travelRight),
    setback,
    incoming,
    split: (incoming ? road.endShift : road.startShift).length > 0,
  };
}

/** An outward edge's direction at its start, over its first half metre. */
function leaving(edge: Vec2[]): Vec2 {
  const ahead = edge.find((p, i) => i > 0 && distance(p, edge[0]!) >= 0.5) ?? edge.at(-1)!;
  return unit(sub(ahead, edge[0]!));
}

/** The interior vertices of an outward edge closer to its start than `station`. */
function edgeUpTo(edge: Vec2[], station: number): Vec2[] {
  const lengths = cumulativeLengths(edge);
  return edge.filter((_, i) => i > 0 && lengths[i]! < station - 1e-6);
}

/** The interior points of the shorter arc of the circle (`o`, `radius`) from `a` to `b`, at most
 * 3 degrees and 1 m apart. */
function arcBetween(o: Vec2, radius: number, a: Vec2, b: Vec2): Vec2[] {
  const start = Math.atan2(a.y - o.y, a.x - o.x);
  let sweep = Math.atan2(b.y - o.y, b.x - o.x) - start;
  sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));
  const steps = Math.max(
    2,
    Math.ceil(Math.abs(sweep) / ARC_STEP),
    Math.ceil(Math.abs(sweep) * radius),
  );
  return Array.from({ length: steps - 1 }, (_, k) => {
    const angle = start + (sweep * (k + 1)) / steps;
    return { x: o.x + radius * Math.cos(angle), y: o.y + radius * Math.sin(angle) };
  });
}

/** A cubic from `a` to `b` leaving `a` along `leave` and arriving at `b` along `arrive`, its
 * handles a circular arc's for that turn and chord, sampled; past a quarter turn, two such cubics
 * meeting at the arc's middle (one cubic's curvature strays by a fifth there). */
function edgeCurve(a: Vec2, leave: Vec2, b: Vec2, arrive: Vec2): Vec2[] {
  const turn = Math.acos(Math.max(-1, Math.min(1, dot(leave, arrive))));
  const chordLength = distance(a, b);
  const across = cross(sub(b, a), leave);
  if (turn > Math.PI / 2 && chordLength > 1e-6 && Math.abs(across) > 1e-9) {
    // The arc bulges to the side `leave` points to off the chord; at its middle it runs along the
    // chord.
    const c = unit(sub(b, a));
    const n = unit({ x: leave.x - dot(leave, c) * c.x, y: leave.y - dot(leave, c) * c.y });
    const sagitta = (chordLength / 2) * Math.tan(turn / 4);
    const mid = { x: (a.x + b.x) / 2 + n.x * sagitta, y: (a.y + b.y) / 2 + n.y * sagitta };
    return [...edgeCurve(a, leave, mid, c).slice(0, -1), ...edgeCurve(mid, c, b, arrive)];
  }
  const handle =
    turn > 1e-6 ? (4 / 3) * Math.tan(turn / 4) * (chordLength / (2 * Math.sin(turn / 2))) : 0;
  // At most `ARC_STEP` of turn between samples, so a small nose is round too.
  return sampleHalf(
    [
      a,
      { x: a.x + leave.x * handle, y: a.y + leave.y * handle },
      { x: b.x - arrive.x * handle, y: b.y - arrive.y * handle },
      b,
    ],
    Math.ceil(turn / ARC_STEP),
  );
}

/** An outward edge's unit direction at station `s`, over the metre beyond it. */
function edgeDirection(edge: Vec2[], lengths: Float64Array, s: number): Vec2 {
  const total = lengths.at(-1)!;
  return unit(
    sub(pointAtDistance(edge, lengths, Math.min(total, s + 1)), pointAtDistance(edge, lengths, s)),
  );
}

/** The station of an outward edge where its points' projection on `u` reaches `target`. */
function stationAlong(edge: Vec2[], lengths: Float64Array, u: Vec2, target: number) {
  for (let i = 1; i < edge.length; i++) {
    const p = dot(edge[i - 1]!, u),
      q = dot(edge[i]!, u);
    if ((p - target) * (q - target) <= 0 && p !== q)
      return lengths[i - 1]! + ((target - p) / (q - p)) * (lengths[i]! - lengths[i - 1]!);
  }
  return undefined;
}

/** TASK-092 (B51): the median between two carriageways running side by side out of the junction
 * ends in a rounded nose, a half circle across the median tangent to both inner edges (`a`'s right,
 * `b`'s left), its tip at the cut line, where TASK-089 placed the median's end (at the farther cut
 * where the two are cut unequally), or as far beyond it as keeps every movement surface (a U-turn
 * folding into the median) on the junction's side of the nose. */
function nose(a: PolygonEnd, b: PolygonEnd, surface: Vec2[]): JunctionCorner | undefined {
  const ka = a.right[0]!,
    kb = b.left[0]!;
  const da = leaving(a.right),
    db = leaving(b.left);
  if (dot(da, db) <= Math.SQRT1_2) return undefined;
  const u = unit({ x: da.x + db.x, y: da.y + db.y });
  // Half the median's width across the edges (two directions of a street cut unequally have none).
  const radius = Math.abs(cross(u, sub(kb, ka))) / 2;
  if (radius < 0.05) return undefined;
  const la = cumulativeLengths(a.right),
    lb = cumulativeLengths(b.left);
  const base = Math.max(dot(ka, u), dot(kb, u)) + radius;
  for (let beyond = 0; beyond <= NOSE_REACH_M; beyond += 0.25) {
    const sa = stationAlong(a.right, la, u, base + beyond),
      sb = stationAlong(b.left, lb, u, base + beyond);
    if (sa === undefined || sb === undefined) return undefined;
    const pa = pointAtDistance(a.right, la, sa),
      pb = pointAtDistance(b.left, lb, sb);
    const outA = edgeDirection(a.right, la, sa),
      outB = edgeDirection(b.left, lb, sb);
    const curve = edgeCurve(pa, neg(outA), pb, outB);
    // The median beyond the nose is taken out of the polygon.
    const far = 4 * radius + 1;
    const cut = [
      ...curve,
      { x: pb.x + outB.x * far, y: pb.y + outB.y * far },
      { x: pa.x + outA.x * far, y: pa.y + outA.y * far },
    ];
    const inCut = preparePolygon([...cut, cut[0]!], 0);
    if (surface.some((p) => inCut(p))) continue;
    return {
      kind: 'nose',
      roads: [a.road.idx, b.road.idx],
      ring: [ka, ...edgeUpTo(a.right, sa), ...curve, ...edgeUpTo(b.left, sb).reverse(), kb],
      curve,
      cut,
      radius,
    };
  }
  return undefined;
}

/** TASK-099 (B54): two carriageways of a street that cross beyond their cuts (their blocks
 * overlap at the junction mouth, the node does not split them) and run attached beyond, their
 * edges twice `ATTACHED_M` apart at most for `NOSE_REACH_M` from where they first lie nearly the
 * median apart (within three times that of the crossing): the
 * gore covers the overlap and their median ends there in a nose across it, as a split pair's does
 * (TASK-092), instead of a fillet running along it. */
function attachedNose(
  a: PolygonEnd,
  b: PolygonEnd,
  crossing: number,
  roads: [number, number],
): JunctionCorner | undefined {
  if (
    a.road.streetGroupId !== null ||
    a.road.corridorId === null ||
    a.road.corridorId !== b.road.corridorId ||
    a.incoming === b.incoming
  )
    return undefined;
  const la = cumulativeLengths(a.right),
    lb = cumulativeLengths(b.left);
  const apart = (s: number) => nearestOnPolyline(b.left, pointAtDistance(a.right, la, s));
  let s = crossing;
  while (s < crossing + 3 * NOSE_REACH_M && apart(s).away < 0.8 * ATTACHED_M) s += 0.25;
  const at = apart(s);
  if (at.away < 0.8 * ATTACHED_M || s + NOSE_REACH_M > la.at(-1)!) return undefined;
  for (let d = 0; d <= NOSE_REACH_M; d += 0.5)
    if (apart(s + d).away > 2 * ATTACHED_M) return undefined;
  const pa = pointAtDistance(a.right, la, s);
  const outA = edgeDirection(a.right, la, s),
    outB = edgeDirection(b.left, lb, at.along);
  const curve = edgeCurve(pa, neg(outA), at.point, outB);
  const far = 2 * at.away + 1;
  return {
    kind: 'nose',
    roads,
    ring: [
      a.right[0]!,
      ...edgeUpTo(a.right, s),
      ...curve,
      ...edgeUpTo(b.left, at.along).reverse(),
      b.left[0]!,
    ],
    curve,
    cut: [
      ...curve,
      { x: at.point.x + outB.x * far, y: at.point.y + outB.y * far },
      { x: pa.x + outA.x * far, y: pa.y + outA.y * far },
    ],
    radius: at.away / 2,
  };
}

/** The corner between two neighbouring approaches (T38.3 reads the curbs). */
export interface JunctionCorner {
  kind: 'curb' | 'gore' | 'outer' | 'step' | 'nose';
  /** Compiled road indices: the road whose right edge (outward) and the road whose left edge
   * the corner joins. */
  roads: [number, number];
  ring: Vec2[];
  /** Curbs: what set the tangent length (the class radius; a cut farther from the corner than
   * the class tangent, the arc then meeting that cut's corner; the class radius beyond the
   * nearer cut, which keeps the curb from bulging past its road ends; the first half of a road; a
   * movement surface it would cut into; a road edge bending away from the arc), the class radius,
   * the radius used, the arc's centre and its tangent points. Noses: the half circle's radius. */
  limit?: 'class' | 'cut' | 'lobe' | 'road' | 'turn' | 'edge';
  /** Curbs and noses: the boundary, from the first road's edge to the second's, leaving and
   * meeting each along it; and the region beyond it, between the road edges, taken out of the
   * polygon. */
  curve?: Vec2[];
  cut?: Vec2[];
  classRadius?: number;
  radius?: number;
  centre?: Vec2;
  tangents?: [Vec2, Vec2];
  /** Gores: the fillet rounding the tip, in the notch beyond it (TASK-092). */
  fillet?: Vec2[];
}

/** The corner between one approach's right edge `a` and the next approach's left edge `b`: a
 * curb arc where the edges meet in front of the node behind both cuts (a concave corner), a gore
 * where they cross beyond a cut (a capped acute pair: the TASK-063 gore covers the overlap), a
 * rounded outer corner where the edges meet behind the node (a convex corner, more than 180
 * degrees between the approaches), an S-curve where the edges run on into each other, nothing
 * where they run parallel side by side. */
function corner(a: PolygonEnd, b: PolygonEnd, surface: Vec2[] = []): JunctionCorner | undefined {
  const ka = a.right[0]!,
    kb = b.left[0]!;
  let da = leaving(a.right),
    db = leaving(b.left);
  const roads: [number, number] = [a.road.idx, b.road.idx];
  // TASK-089 (owner's sketch): the median between a street's two carriageways split at the node
  // ends at the junction edge, the cut line between their cut corners; no curb runs it out. Its
  // nose is rounded (TASK-092, B51).
  if (a.split && b.split && a.incoming !== b.incoming && dot(da, db) > Math.SQRT1_2)
    return nose(a, b, surface);
  // Edges within 30 degrees of running on into each other (a road continuing into a narrower or
  // wider one, two ends side by side across the node): an S-curve tangent to both, which
  // replaces the chord between the cuts (`cutRegion`).
  if (dot(da, db) < -ALONG) {
    const length = distance(ka, kb);
    if (length < 1e-3) return undefined;
    const h = length / 3;
    const curve = sampleHalf([
      ka,
      { x: ka.x - da.x * h, y: ka.y - da.y * h },
      { x: kb.x - db.x * h, y: kb.y - db.y * h },
      kb,
    ]);
    return { kind: 'step', roads, ring: curve };
  }
  const c = cross(da, db);
  if (Math.abs(c) < 0.02) return undefined;
  // Where the lines through the cut corners along the edges meet; sa, sb: along each from its
  // corner (negative behind the cut).
  const w = sub(kb, ka);
  const sa = cross(w, db) / c,
    sb = cross(w, da) / c;
  // An outer corner (more than 180 degrees between the approaches) is rounded: an arc tangent to
  // both edges' lines at the nearer cut corner and as far from their meeting point on the other.
  if (c < 0) {
    if (sa >= 0 || sb >= 0 || -sa > REACH_M || -sb > REACH_M) return undefined;
    const apex = { x: ka.x + da.x * sa, y: ka.y + da.y * sa };
    const t = Math.min(-sa, -sb);
    const ta = { x: apex.x + da.x * t, y: apex.y + da.y * t },
      tb = { x: apex.x + db.x * t, y: apex.y + db.y * t };
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(da, db))));
    const radius = t * Math.tan(theta / 2);
    const bisector = unit({ x: da.x + db.x, y: da.y + db.y });
    const o = {
      x: apex.x + (bisector.x * radius) / Math.sin(theta / 2),
      y: apex.y + (bisector.y * radius) / Math.sin(theta / 2),
    };
    return { kind: 'outer', roads, ring: [ka, ta, ...arcBetween(o, radius, ta, tb), tb, kb] };
  }
  const lower =
    a.road.classRank < b.road.classRank
      ? [a.road]
      : b.road.classRank < a.road.classRank
        ? [b.road]
        : [a.road, b.road];
  const classRadius = Math.min(...lower.map((r) => CURB_RADIUS_M[r.roadClass]));
  const room = (edge: Vec2[], end: PolygonEnd, s: number) =>
    Math.min(CURB_REACH * end.road.lengthM - end.setback, cumulativeLengths(edge).at(-1)!) - s;
  // The edges' lines meeting beyond a cut: a gore where the edges cross there (a capped acute
  // pair's overlap); else the meeting point lies behind the other cut and a curb fits as below
  // (TASK-092: these were left without a corner, the sharp corners at n:262, n:291 and n:967).
  const hit =
    sa > 0.01 || sb > 0.01
      ? polylineCrossings(a.right, b.left)
          .filter((h) => distance(h.point, ka) <= REACH_M)
          .reduce<{ point: Vec2; alongA: number; alongB: number } | undefined>(
            (best, h) =>
              !best || Math.max(h.alongA, h.alongB) < Math.max(best.alongA, best.alongB) ? h : best,
            undefined,
          )
      : undefined;
  if (hit) {
    const attached = attachedNose(a, b, hit.alongA, roads);
    if (attached) return attached;
    // TASK-092: the gore's tip, where the edges cross, is rounded by a fillet of `GORE_RADIUS_M`
    // in the notch beyond it, tangent to both edges, its tangent points within the first half of
    // either road (the radius shrinks to fit).
    const la = cumulativeLengths(a.right),
      lb = cumulativeLengths(b.left);
    const theta = Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          dot(edgeDirection(a.right, la, hit.alongA), edgeDirection(b.left, lb, hit.alongB)),
        ),
      ),
    );
    const t = Math.min(
      Math.min(GORE_RADIUS_M, classRadius) / Math.tan(theta / 2),
      room(a.right, a, hit.alongA),
      room(b.left, b, hit.alongB),
    );
    const pa = pointAtDistance(a.right, la, hit.alongA + t),
      pb = pointAtDistance(b.left, lb, hit.alongB + t);
    const fillet =
      t * Math.tan(theta / 2) >= MIN_CURB_M
        ? [
            hit.point,
            ...edgeUpTo(a.right, hit.alongA + t).filter((_, i) => la[i + 1]! > hit.alongA),
            ...edgeCurve(
              pa,
              neg(edgeDirection(a.right, la, hit.alongA + t)),
              pb,
              edgeDirection(b.left, lb, hit.alongB + t),
            ),
            ...edgeUpTo(b.left, hit.alongB + t)
              .filter((_, i) => lb[i + 1]! > hit.alongB)
              .reverse(),
          ]
        : undefined;
    return {
      kind: 'gore',
      roads,
      ring: [
        ka,
        ...edgeUpTo(a.right, hit.alongA),
        hit.point,
        ...edgeUpTo(b.left, hit.alongB).reverse(),
        kb,
      ],
      ...(fillet ? { fillet } : {}),
    };
  }
  // Meeting beyond both cuts with no crossing near: no corner.
  if (sa > 0.01 && sb > 0.01) return undefined;
  // A curb arc of the class radius of the lower-ranked road, its tangent points on both road
  // edges at or beyond their cuts, at most the class radius beyond the nearer cut (no lobe) and
  // within the first half of either road; the radius follows. The edges' directions are
  // then taken as the chords from the cut corners to those tangent points and the arc is fitted
  // again, so on a curving road it still meets the edges.
  const fit = (da: Vec2, db: Vec2) => {
    const c = cross(da, db);
    const sa = cross(w, db) / c,
      sb = cross(w, da) / c;
    const p = { x: ka.x + da.x * sa, y: ka.y + da.y * sa };
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(da, db))));
    const perRadius = 1 / Math.tan(theta / 2);
    const lo = Math.max(0, -sa, -sb);
    const limits: [NonNullable<JunctionCorner['limit']>, number][] = [
      ['class', classRadius * perRadius],
      ['lobe', classRadius + Math.min(-sa, -sb)],
      ['road', Math.min(room(a.right, a, sa), room(b.left, b, sb))],
    ];
    const [binding, upper] = limits.reduce((x, y) => (y[1] < x[1] ? y : x));
    return {
      c,
      sa,
      sb,
      p,
      theta,
      perRadius,
      limit: lo > upper ? ('cut' as const) : binding,
      tangent: Math.max(lo, upper),
    };
  };
  const chord = (edge: Vec2[], s: number) => {
    const lengths = cumulativeLengths(edge);
    return unit(sub(pointAtDistance(edge, lengths, Math.max(1, s)), edge[0]!));
  };
  let best = fit(da, db);
  for (let pass = 0; pass < 4; pass++) {
    const [ra, rb] = [
      chord(a.right, best.sa + best.tangent),
      chord(b.left, best.sb + best.tangent),
    ];
    const next = fit(ra, rb);
    if (next.c <= 0.02 || (next.sa > 0.01 && next.sb > 0.01)) break;
    [best, da, db] = [next, ra, rb];
  }
  const { p, theta, perRadius } = best;
  let { limit, tangent } = best;
  const bisector = unit({ x: da.x + db.x, y: da.y + db.y });
  const centre = (t: number) => {
    const d = t / perRadius / Math.sin(theta / 2);
    return { x: p.x + bisector.x * d, y: p.y + bisector.y * d };
  };
  // No movement surface may reach into the curb's disc (beyond the arc, the corner block): the
  // arc shrinks (bisection on the tangent length) until none does.
  const intrudes = (t: number) => {
    const o = centre(t),
      r = t / perRadius;
    return surface.some((q) => distance(q, o) < r - 0.05);
  };
  if (intrudes(tangent)) {
    let low = 0,
      high = tangent;
    for (let k = 0; k < 10; k++) {
      const mid = (low + high) / 2;
      if (intrudes(mid)) high = mid;
      else low = mid;
    }
    [tangent, limit] = [low, 'turn'];
    if (tangent < Math.max(0, -best.sa, -best.sb) - 0.5) return undefined;
  }
  // An edge bending away within the curb's reach (a road turning right after the junction) takes
  // no arc there: the arc shrinks (bisection) until its tangent points lie on both edges, and none
  // fits where they would then lie behind a cut (TASK-092: it was dropped at the first misfit).
  const onEdge = (edge: Vec2[], t: Vec2, d: Vec2) =>
    nearestOnPolyline([{ x: edge[0]!.x - d.x, y: edge[0]!.y - d.y }, ...edge], t).away <= FIT_M;
  const at = (d: Vec2, t: number) => ({ x: p.x + d.x * t, y: p.y + d.y * t });
  const fits = (t: number) => onEdge(a.right, at(da, t), da) && onEdge(b.left, at(db, t), db);
  if (!fits(tangent)) {
    let low = Math.max(0, -best.sa, -best.sb),
      high = tangent;
    if (!fits(low)) return undefined;
    for (let k = 0; k < 10; k++) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    [tangent, limit] = [low, 'edge'];
  }
  const radius = tangent / perRadius;
  if (radius < MIN_CURB_M) return undefined;
  const ta = at(da, tangent),
    tb = at(db, tangent);
  const o = centre(tangent);
  // The corner block (TASK-089, B42): from the cut corners along the road edges to the points
  // nearest the tangent points, joined by a cubic that leaves and meets each edge along the edge
  // itself (a circular arc's handles for its turn and chord): a tangent point lies off its edge by
  // up to `FIT_M` (n:138's 0.18 m), and on an edge curving with a converging shift the fitted arc
  // meets the edge at an angle, which drew nubs and teeth at the curb's ends. The block follows
  // the edges rather than fanning from the corner (an apex far behind the cuts, edges nearly
  // parallel as where converging carriageways part, would reach over the roads); the region
  // beyond the curve, between the edges, is taken out of the polygon (`cut`).
  const na = nearestOnPolyline(a.right, ta),
    nb = nearestOnPolyline(b.left, tb);
  const leave = neg(na.direction),
    arrive = nb.direction;
  const chordLength = distance(na.point, nb.point);
  const curve = edgeCurve(na.point, leave, nb.point, arrive);
  const block = [
    ka,
    ...edgeUpTo(a.right, na.along),
    ...curve,
    ...edgeUpTo(b.left, nb.along).reverse(),
    kb,
  ];
  const far = 2 * (radius + chordLength) + 1;
  return {
    kind: 'curb',
    roads,
    ring: block,
    curve,
    cut: [
      ...curve,
      { x: nb.point.x + arrive.x * far, y: nb.point.y + arrive.y * far },
      { x: na.point.x - leave.x * far, y: na.point.y - leave.y * far },
    ],
    limit,
    classRadius,
    radius,
    centre: o,
    tangents: [ta, tb],
  };
}

/** Half a disc on the segment `a`-`b`, on the side away from `outward`. */
function cap(a: Vec2, b: Vec2, outward: Vec2): PathD {
  const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const radius = distance(a, b) / 2;
  const start = Math.atan2(a.y - centre.y, a.x - centre.x);
  const mid = start + Math.PI / 2;
  const sweep = Math.cos(mid) * outward.x + Math.sin(mid) * outward.y < 0 ? Math.PI : -Math.PI;
  const steps = Math.max(8, Math.ceil(Math.PI / ARC_STEP));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const angle = start + (sweep * k) / steps;
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
  });
}

/** A through road's surface across the node, between the two road ends' cuts. */
function throughStrip(from: CRoad, to: CRoad): PathD {
  const { centre, normals, lengths, total: length } = acrossNode(from, to);
  const half = (road: CRoad, atEnd: boolean) => {
    const ring = road.surface;
    const n = ring.length / 2;
    return atEnd ? [ring[n - 1]!, ring[n]!] : [ring[0]!, ring.at(-1)!];
  };
  const [al, ar] = half(from, true) as [Vec2, Vec2];
  const [bl, br] = half(to, false) as [Vec2, Vec2];
  const lateral = (p: Vec2, k: number) => dot(sub(p, centre[k]!), normals[k]!);
  const last = centre.length - 1;
  const total = length || 1;
  const edge = (a: number, b: number) =>
    centre.map((p, k) => {
      const lat = a + ((b - a) * lengths[k]!) / total;
      return { x: p.x + normals[k]!.x * lat, y: p.y + normals[k]!.y * lat };
    });
  const left = edge(lateral(al, 0), lateral(bl, last)),
    right = edge(lateral(ar, 0), lateral(br, last));
  left[0] = al;
  left[last] = bl;
  right[0] = ar;
  right[last] = br;
  return [...left, ...right.reverse()];
}

function nodeCentre(node: CNode, through: ThroughPair[]): Vec2 {
  return through.length
    ? {
        x: through.reduce((s, p) => s + p.at.x, 0) / through.length,
        y: through.reduce((s, p) => s + p.at.y, 0) / through.length,
      }
    : node.pos;
}

/** The region between a node's cuts as pieces: a fan from its centre (the node, or the mean of
 * where its through roads pass it) over the cut corners in angular order, each approach's corner
 * with the next (`corner`), or a cap when the node has one approach (a dead end). The far side of
 * a through road (two neighbouring approaches joined by a through pair) is left to its strip. */
function cutRegion(
  node: CNode,
  roads: CRoad[],
  approaches: number[][],
  hidden: number[],
  through: ThroughPair[],
  surface: Vec2[],
) {
  const ends = roads.map((road, i) => polygonEnd(node, road, node.setbacks[i]!));
  const groups = approaches.map((approach) => approach.map((i) => ends[i]!));
  const fan: PathD[] = [];
  const corners: JunctionCorner[] = [];
  const centre = nodeCentre(node, through);
  if (groups.length === 1) {
    const group = groups[0]!;
    const a = group[0]!.left[0]!,
      b = group.at(-1)!.right[0]!;
    if (distance(a, b) > 1e-6) fan.push(cap(a, b, leaving(group[0]!.left)));
    return { fan, corners };
  }
  // The far side of a through road: the two approaches' facing ends are a through pair, whose strip
  // runs along it (TASK-092: not where another end lies outside the pair, as a street's other
  // direction beside a through road continuing into a one-way, which needs its own corner).
  const far = (x: PolygonEnd[], y: PolygonEnd[]) => {
    const [a, b] = [x.at(-1)!.road.idx, y[0]!.road.idx];
    return through.some((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a));
  };
  groups.forEach((group, i) => {
    const next = groups[(i + 1) % groups.length]!;
    group.forEach((end, k) => {
      fan.push([centre, end.left[0]!, end.right[0]!]);
      if (k + 1 === group.length) return;
      fan.push([centre, end.right[0]!, group[k + 1]!.left[0]!]);
      // Two carriageways of the approach overlapping beyond their cuts and parting within the
      // junction zone (the cap and 5 m): the gore covers the overlap. Carriageways lying on each
      // other farther out are a source defect the polygon does not follow.
      const piece = corner(end, group[k + 1]!);
      if (
        piece?.kind === 'gore' &&
        piece.ring.every((p) => distance(p, node.pos) <= 2.5 * SETBACK_CAP_M)
      )
        corners.push(piece);
      // A median between them ends in a rounded nose (TASK-092).
      else if (piece?.kind !== 'gore') {
        const median = nose(end, group[k + 1]!, surface);
        if (median) corners.push(median);
      }
    });
    if (far(group, next)) return;
    const step = corner(group.at(-1)!, next[0]!);
    fan.push(
      step?.kind === 'step'
        ? [centre, ...step.ring]
        : [centre, group.at(-1)!.right[0]!, next[0]!.left[0]!],
    );
  });
  // Corners between the approaches' outer road ends; a shadowed end (`junctionCuts`) is not one.
  const shadowed = new Set(hidden.map((i) => ends[i]!));
  const facing = groups.map((g) => g.filter((e) => !shadowed.has(e))).filter((g) => g.length);
  if (facing.length > 1)
    facing.forEach((group, i) => {
      const next = facing[(i + 1) % facing.length]!;
      if (far(group, next)) return;
      const piece = corner(group.at(-1)!, next[0]!, surface);
      if (piece && piece.kind !== 'step') corners.push(piece);
    });
  return { fan, corners };
}

const cornersByNode = new WeakMap<CNode, JunctionCorner[]>();

/** The corners `junctionPolygon` built the node's outline with (curbs, gores, outer corners). */
export function junctionCorners(node: CNode): JunctionCorner[] {
  return cornersByNode.get(node) ?? [];
}

/** Whether a closed ring has a proper crossing between two of its edges (a sweep along x). */
function crossesItself(ring: PathD): boolean {
  const n = ring.length;
  const side = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const edges = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) =>
      Math.min(ring[i]!.x, ring[(i + 1) % n]!.x) - Math.min(ring[j]!.x, ring[(j + 1) % n]!.x),
  );
  const active: number[] = [];
  for (const i of edges) {
    const a = ring[i]!,
      b = ring[(i + 1) % n]!;
    const minX = Math.min(a.x, b.x);
    for (let k = active.length - 1; k >= 0; k--) {
      const j = active[k]!;
      if (Math.max(ring[j]!.x, ring[(j + 1) % n]!.x) < minX) active.splice(k, 1);
    }
    for (const j of active) {
      if (Math.abs(i - j) < 2 || Math.abs(i - j) === n - 1) continue;
      const c = ring[j]!,
        d = ring[(j + 1) % n]!;
      if (side(a, b, c) * side(a, b, d) < -1e-12 && side(c, d, a) * side(c, d, b) < -1e-12)
        return true;
    }
    active.push(i);
  }
  return false;
}

/** `CNode.outline` (architecture 5.1, TASK-083): the clipper union of the region between the road
 * ends' cuts (`cutRegion`), each through road's surface across the node and every movement
 * surface; the outer ring of the union, closed. Empty at through and continuation nodes. */
export function junctionPolygon(
  node: CNode,
  roads: CRoad[],
  approaches: number[][],
  hidden: number[],
  through: ThroughPair[],
  lanes: CLane[],
  movements: CMovement[],
): Vec2[] {
  if (node.setbacks.every((s) => s === 0)) return [];
  const surfaces: Vec2[][] = [];
  // Each movement's surface: both edges across the curve's tangent, and at its two ends along the
  // lanes' reference normal, so the surface ends on the cuts (also where a converging shift
  // curves the lanes there, TASK-089; a hairpin's inner edge folds: the union's non-zero fill
  // keeps both of its lobes).
  const across = (lane: CLane, atEnd: boolean, half: number) => {
    const n = atEnd ? lane.normals.at(-1) : lane.normals[0];
    const road = roads.find((r) => r.idx === lane.road);
    if (n && road && shifted(road) && lane.normals.length === lane.polyline.length) {
      const length = Math.hypot(n.x, n.y) || 1;
      return { x: (n.x / length) * half, y: (n.y / length) * half };
    }
    const h = headingAtDistance(lane.polyline, lane.cumulative, atEnd ? lane.lengthM : 0);
    return { x: -Math.sin(h) * half, y: Math.cos(h) * half };
  };
  for (const i of node.movements) {
    const m = movements[i]!;
    if (m.lengthM < 0.01) continue;
    const from = lanes[m.fromLane]!,
      to = lanes[m.toLane]!;
    const half = Math.min(from.widthM, to.widthM) / 2;
    const last = m.polyline.length - 1;
    const sides = m.polyline.map((p, k) => {
      const h = Math.atan2(
        m.polyline[Math.min(last, k + 1)]!.y - m.polyline[Math.max(0, k - 1)]!.y,
        m.polyline[Math.min(last, k + 1)]!.x - m.polyline[Math.max(0, k - 1)]!.x,
      );
      const n =
        k === 0
          ? across(from, true, half)
          : k === last
            ? across(to, false, half)
            : { x: -Math.sin(h) * half, y: Math.cos(h) * half };
      return [
        { x: p.x - n.x, y: p.y - n.y },
        { x: p.x + n.x, y: p.y + n.y },
      ] as const;
    });
    const ring = [...sides.map(([l]) => l), ...sides.map(([, r]) => r).reverse()];
    surfaces.push(ring);
  }
  // The surfaces' boundaries every half metre, which no curb may cut into.
  const samples = surfaces.flatMap((ring) =>
    ring.flatMap((q, k) => {
      const r = ring[(k + 1) % ring.length]!;
      const steps = Math.max(1, Math.ceil(distance(q, r) / SAMPLE_M));
      return Array.from({ length: steps }, (_, j) => ({
        x: q.x + ((r.x - q.x) * j) / steps,
        y: q.y + ((r.y - q.y) * j) / steps,
      }));
    }),
  );
  const { fan, corners } = cutRegion(node, roads, approaches, hidden, through, samples);
  cornersByNode.set(node, corners);
  // A curb or nose block is closed through the node's centre, as the fan is (TASK-092): closed by
  // the chord between its cut corners, an arc whose tangent points lie beyond the cuts crosses the
  // chord, and the ends cut off beyond it were dropped with the union's small rings (a kink where
  // the curb left the road edge). A curb never covers its two roads (TASK-089: where a converging
  // shift curves an edge, the curb curve can run on its road side near its ends).
  const centre = nodeCentre(node, through);
  const block = (c: JunctionCorner) =>
    c.kind === 'curb' || c.kind === 'nose' ? [...c.ring, centre] : c.ring;
  const curbs = corners.flatMap((c) =>
    c.kind === 'curb' && c.roads.some((r) => shifted(roads.find((road) => road.idx === r)!))
      ? booleanOpD(
          ClipType.Difference,
          [block(c)],
          c.roads.map((r) => roads.find((road) => road.idx === r)!.surface),
          FillRule.NonZero,
          PRECISION,
        )
      : [block(c)],
  );
  const fillets = corners.flatMap((c) => (c.fillet ? [c.fillet] : []));
  const pieces: PathD[] = [...fan, ...curbs, ...fillets, ...surfaces];
  for (const pair of through) {
    const from = roads.find((r) => r.idx === pair.from)!,
      to = roads.find((r) => r.idx === pair.to)!;
    pieces.push(throughStrip(from, to));
  }
  // A piece crossing itself (a hairpin's folded surface, a curb or strip on a sharply curving
  // edge) is cleaned on its own first, so none of its lobes is wound against another piece.
  const oriented = pieces
    .filter((p) => p.length >= 3)
    .flatMap((p) =>
      crossesItself(p) ? booleanOpD(ClipType.Union, [p], null, FillRule.NonZero, PRECISION) : [p],
    )
    .filter((p) => Math.abs(areaD(p)) > 1e-6)
    .map((p) => (areaD(p) < 0 ? [...p].reverse() : p));
  let union = booleanOpD(ClipType.Union, oriented, null, FillRule.NonZero, PRECISION);
  // Beyond a curb is the corner block: the fan's chord between deep cuts may reach into it, so
  // it is taken out (movement surfaces stay clear of the curb's disc, `corner`).
  const discs = corners.flatMap((c) => (c.cut ? [c.cut] : []));
  if (discs.length)
    union = booleanOpD(ClipType.Difference, union, discs, FillRule.NonZero, PRECISION);
  // Where pieces only touch, rounding can leave the ring crossing itself at a pinch: a closing by
  // 1 cm merges them.
  const grow = (paths: PathD[], by: number) =>
    inflatePathsD(paths, by, JoinType.Round, EndType.Polygon, 2, PRECISION, 0.002);
  const closing = (paths: PathD[]) => grow(grow(paths, 0.01), -0.01);
  // A gore's fillet touches the gore only at its tip (the roads' surfaces lie between): the closing
  // joins them there.
  if (union.some(crossesItself) || (fillets.length && union.length > 1)) union = closing(union);
  // The outer ring, its vertices within 2 mm merged, so a curb's cusp at its tangent point (the
  // boundary returns along the arc beside the road edge it came out on) touches itself instead of
  // crossing at rounding; a cusp still crossing gets the closing too, where that clears it.
  const outerRing = (paths: PathD[]) => {
    const outer = paths.reduce<PathD | undefined>(
      (best, ring) => (!best || Math.abs(areaD(ring)) > Math.abs(areaD(best)) ? ring : best),
      undefined,
    );
    if (!outer) return [];
    const ring: Vec2[] = [];
    for (const { x, y } of outer)
      if (!ring.length || distance(ring.at(-1)!, { x, y }) > 0.002) ring.push({ x, y });
    if (ring.length > 1 && distance(ring[0]!, ring.at(-1)!) <= 0.002) ring.pop();
    return ring;
  };
  // A needle (a curb's horn along an edge curving off its arc) is opened away by 1 cm.
  let ring = outerRing(union);
  for (const cleaned of [() => closing(union), () => closing(grow(grow(union, -0.01), 0.01))]) {
    if (!crossesItself(ring)) break;
    const next = outerRing(cleaned());
    if (!crossesItself(next)) ring = next;
  }
  if (!ring.length) return [];
  ring.push(ring[0]!);
  return ring;
}
