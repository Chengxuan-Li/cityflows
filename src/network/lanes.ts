import { cumulativeLengths, polylineLength, vertexNormals } from '../geo/polyline';
import { laneId, type Road } from '../schema';
import type { Vec2 } from '../geo/vec2';
import { jointReference, offsetLine, type Reference } from './corridor';
import type { CLane, CRoad, Diagnostic } from './types';

export interface ContinuationEnd {
  /** Travel heading of the reference line at the node. */
  heading: number;
  /** Lateral shift of the lane block from the road's own offsets to its place in the
   * side-by-side block, measured from the reference line. */
  offsetM: number;
  tapers: number[];
  /** Distance from the road's (trimmed) end over which the block follows the reference line
   * before it eases onto its own offsets over `taperM` (TASK-080). Negative when the branches
   * separate before the cut. Both 0 at an end that only marks that the transition of the
   * road's other end reaches it (that end is then not reset to the road's own offsets). */
  holdM: number;
  taperM: number;
  /** A shift to the right that the side-by-side block takes over the first `taperM`: a branch
   * that starts on a trunk lane it shares with its left neighbour moves off it. */
  splitM?: number;
  /** The line the side-by-side block follows, in travel direction, starting (start end) or
   * ending (end end) at the road's trimmed end: a ray along `heading` from a continuation node,
   * the branches' mean line elsewhere. */
  reference: Vec2[];
  /** Distance along `reference` from its node end to the road's end (TASK-214): the roads of a
   * side-by-side chain share one line, so their lanes meet on the same normals. */
  referenceFromM?: number;
  /** A transition carried through plain nodes (TASK-221): it eases by `smootherstep`, so where
   * its hold or taper ends near one of those nodes the lanes do not bend across the joint. */
  carried?: boolean;
}

export interface RoadContinuity {
  start?: ContinuationEnd;
  end?: ContinuationEnd;
}

export function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** TASK-221: the quintic ease, whose curvature is zero at both ends too. */
export function smootherstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * u * (u * (6 * u - 15) + 10);
}

/** TASK-080 (B37): every taper is short and scaled by speed, at most half the road. */
export function taperLength(road: Road): number {
  const kmh = road.speedLimitMps * 3.6;
  return Math.min(polylineLength(road.centerline) / 2, Math.max(15, Math.min(40, 0.4 * kmh)));
}

const endLines = new WeakMap<Vec2[], Reference>();

/** A point `lateral` to the right of the end's reference line, `away` from the road's end, on the
 * normal interpolated between the line's vertex normals (TASK-214, S4: on each segment's own
 * normal a lane well off a bending side-by-side line stepped back at every vertex, Munich r:728). */
function referencePoint(end: ContinuationEnd, atEnd: boolean, away: number, lateral: number) {
  let line = endLines.get(end.reference);
  if (!line) {
    line = {
      points: end.reference,
      lengths: cumulativeLengths(end.reference),
      normals: vertexNormals(end.reference),
      eased: [],
      needM: 0,
      reversed: false,
      source: -1,
    };
    endLines.set(end.reference, line);
  }
  const total = line.lengths.at(-1)!;
  const from = (end.referenceFromM ?? 0) + away;
  const s = Math.max(0, Math.min(total, atEnd ? total - from : from));
  return offsetLine(line, [s], lateral)[0]!;
}

/** Spacing of `CRoad.startShift` and `CRoad.endShift`. */
export const SHIFT_STEP_M = 0.5;

function profileAt(profile: ArrayLike<number>, d: number): number {
  const x = Math.max(0, d) / SHIFT_STEP_M;
  const i = Math.floor(x);
  if (i + 1 >= profile.length) return i < profile.length ? profile[i]! : 0;
  return profile[i]! + (profile[i + 1]! - profile[i]!) * (x - i);
}

/** A road's converging shift (TASK-089) at station `s` of a reference `total` long: the larger of
 * its two ends' shifts where they overlap (a pair converging at both its nodes). */
export function shiftAt(
  road: { startShift: ArrayLike<number>; endShift: ArrayLike<number> },
  s: number,
  total: number,
): number {
  const a = profileAt(road.startShift, s),
    b = profileAt(road.endShift, total - s);
  return Math.sign(a) === Math.sign(b) ? (Math.abs(a) > Math.abs(b) ? a : b) : a + b;
}

/** Length from the node over which a shift profile is non-zero. */
export const shiftLength = (profile: ArrayLike<number>) =>
  profile.length ? (profile.length - 1) * SHIFT_STEP_M : 0;

/** TASK-093 (B45): at a junction mouth (`continuity.ts`), a median between one street's
 * carriageways narrower than this that closes again farther out follows its shortfall. The
 * importer's attach rule uses `ATTACH_GAP_M` (TASK-095). */
export const MEDIAN_VOID_M = 3;

/** TASK-095 (B54; replaces `MEDIAN_VOID_M` in the importer): one street's carriageways running
 * between the same two nodes are attached at the 0.5 m median wherever the gap between them is
 * narrower than this, and part where it is wider or opens at more than 20 degrees. */
export const ATTACH_GAP_M = 15;

/** Carriageways converging at more than this angle are not set side by side. */
export const CONVERGING = Math.cos(Math.PI / 4);

/** Two one-way roads that can be carriageways of one street: one corridor, or one name and one
 * grade, or (unnamed) one class between the same two nodes, as the importer pairs them. */
export function sameStreet(a: Road, b: Road): boolean {
  if (a.streetGroupId !== null || b.streetGroupId !== null || a.layer !== b.layer) return false;
  if (a.corridorId && a.corridorId === b.corridorId) return true;
  if (a.name !== null) return a.name === b.name;
  return b.name === null && a.roadClass === b.roadClass && a.from === b.to && a.to === b.from;
}

export function roadWidth(road: Road): number {
  return road.lanes.reduce((width, lane) => width + lane.widthM, 0);
}

/** Painted lane edges collapse onto the nearest surviving lane; driving polylines stay put. Both
 * edges are `normalOffset`s of the lane polyline, so vertex `i` of an edge, of the lane and of
 * every other lane of the road lie on one normal of the road's reference line (TASK-082). */
export function laneEdges(
  lane: CLane,
  roadLanes: CLane[],
  paintAdjacentAdditions = false,
): { left: Vec2[]; right: Vec2[] } {
  if (!paintAdjacentAdditions) return paintedEdges(lane, roadLanes, false);
  const adjacentAddition = (l: CLane) =>
    Boolean(
      l.taperStartM && (roadLanes[l.lane - 1]?.taperStartM || roadLanes[l.lane + 1]?.taperStartM),
    );
  const edges = paintedEdges(lane, roadLanes, adjacentAddition(lane));
  if (!adjacentAddition(lane)) return edges;
  const tapering = (l: CLane, i: number) => l.cumulative[i]! < l.taperStartM;
  for (const side of [-1, 1]) {
    const neighbor = roadLanes[lane.lane + side];
    if (!neighbor) continue;
    const key = side < 0 ? 'left' : 'right';
    const other = paintedEdges(neighbor, roadLanes, adjacentAddition(neighbor))[
      side < 0 ? 'right' : 'left'
    ];
    // Adjacent additions share a boundary, rather than painting overlapping lane strips.
    edges[key] = edges[key].map((p, i) => {
      if (!tapering(lane, i)) return p;
      const q = other[i]!;
      return tapering(neighbor, i) ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : q;
    });
  }
  return edges;
}

function paintedEdges(
  lane: CLane,
  roadLanes: CLane[],
  growAddedWidth: boolean,
): { left: Vec2[]; right: Vec2[] } {
  const normals = laneNormals(lane, roadLanes);
  const tapers = [true, false].flatMap((start) => {
    const taper = start ? lane.taperStartM : lane.taperEndM;
    if (!taper) return [];
    const neighbor = roadLanes
      .filter((l) => !(start ? l.taperStartM : l.taperEndM))
      .reduce((a, b) => (Math.abs(a.lane - lane.lane) <= Math.abs(b.lane - lane.lane) ? a : b));
    const offset = (Math.sign(lane.lane - neighbor.lane) * neighbor.widthM) / 2;
    const across = laneNormals(neighbor, roadLanes);
    const line = neighbor.polyline.map((p, i) => ({
      x: p.x + across[i]!.x * offset,
      y: p.y + across[i]!.y * offset,
    }));
    return [{ start, taper, line }];
  });
  const edges = (side: number) =>
    lane.polyline.map((point, i) => {
      const half = (lane.widthM / 2) * side;
      let p = { x: point.x + normals[i]!.x * half, y: point.y + normals[i]!.y * half };
      for (const { start, taper, line } of tapers) {
        const away = start ? lane.cumulative[i]! : lane.lengthM - lane.cumulative[i]!;
        if (away > taper) continue;
        const f = smoothstep(away / taper);
        // Added lane centres already ease from the surviving edge in layoutRoad.
        // Only their width still needs to grow; easing the centre twice folds the paint.
        p =
          start && growAddedWidth
            ? { x: point.x + normals[i]!.x * half * f, y: point.y + normals[i]!.y * half * f }
            : { x: p.x * f + line[i]!.x * (1 - f), y: p.y * f + line[i]!.y * (1 - f) };
      }
      return p;
    });
  return { left: edges(-1), right: edges(1) };
}

/** A lane's normals: across its road's lane block where the outer lanes sit at their nominal
 * spacing (the reference line's normal there, the same for every lane, so neighbouring lanes'
 * edges coincide), else its own `vertexNormals`; a single lane's are the reference normals. */
function laneNormals(lane: CLane, roadLanes: CLane[]): Vec2[] {
  const own = vertexNormals(lane.polyline);
  const first = roadLanes[0]!,
    last = roadLanes.at(-1)!;
  // One lane: the reference normal, as its road's surface and a road beside it on one reference
  // line (a same-direction pair) are offset (TASK-089: its own normals shear off them where a
  // converging shift curves the lane).
  if (first === last) return lane.normals.length === own.length ? lane.normals : own;
  const spacing =
    roadLanes.reduce((sum, l) => sum + l.widthM, 0) - (first.widthM + last.widthM) / 2;
  return own.map((n, k) => {
    const a = first.polyline[k],
      b = last.polyline[k];
    if (!a || !b) return n;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy);
    return Math.abs(d - spacing) < 0.01 ? { x: dx / d, y: dy / d } : n;
  });
}

/** Stations closer than this to a cut are left out of the road's stations. */
const CUT_GAP_M = 0.05;
const MIN_STEP_M = 0.1;
const GRID_M = 0.5;

export function layoutRoad(
  road: Road,
  compiled: CRoad,
  reference: Reference,
  startSetback: number,
  endSetback: number,
  lanes: CLane[],
  diagnostics: Diagnostic[],
  continuation: { before?: Vec2; after?: Vec2 } = {},
  transition: RoadContinuity = {},
): { jointDeviationM: number } {
  const width = roadWidth(road);
  const leftEdge = road.lateralOffsetM - width / 2;
  const trim = startSetback + endSetback;
  const length = polylineLength(road.centerline);
  const scale = trim === 0 ? 1 : Math.min(1, Math.max(0, length - 5) / trim);
  const shortened = scale < 1;
  // The road's stations on its reference line: its two cuts, the reference's vertices between
  // them and, over each transition, one every half metre.
  const { line: joined, deviationM } = jointReference(
    reference,
    startSetback === 0 ? continuation.before : undefined,
    endSetback === 0 ? continuation.after : undefined,
  );
  const s0 = startSetback * scale;
  const s1 = Math.max(s0, joined.lengths.at(-1)! - endSetback * scale);
  const total = s1 - s0;
  // A transition gets a station every half metre of the reference, counted from its source
  // start, so the two directions of a street, whose cuts differ, still share them.
  const grid = [s0, s1];
  const windowEnds: number[] = [];
  const refLength = joined.lengths.at(-1)!;
  const phase = (s: number) => (joined.reversed ? refLength - s : s) / GRID_M;
  for (const atEnd of [false, true]) {
    const end = atEnd ? transition.end : transition.start;
    const shifted = shiftLength(atEnd ? compiled.endShift : compiled.startShift);
    if (!end && !shifted) continue;
    const span = Math.min(
      total,
      Math.max(0, end ? end.holdM + end.taperM : 0, shifted - (atEnd ? refLength - s1 : s0)),
    );
    grid.push(atEnd ? s1 - span : s0 + span);
    windowEnds.push(atEnd ? s1 - span : s0 + span);
    const [a, b] = [phase(atEnd ? s1 - span : s0), phase(atEnd ? s1 : s0 + span)].sort(
      (x, y) => x - y,
    ) as [number, number];
    for (let k = Math.ceil(a); k <= b; k++) {
      const s = joined.reversed ? refLength - k * GRID_M : k * GRID_M;
      if (s > s0 && s < s1) grid.push(s);
    }
  }
  grid.sort((a, b) => a - b);
  // Stations closer than `MIN_STEP_M` merge (the short chords between them turn the normals of
  // the lane polylines noisily): grid stations into their mean (a cut stays), and a reference
  // vertex near a grid station is left out. Both rules read the same from either end, so the
  // two directions of a street get the same stations.
  const merged: number[][] = [];
  for (const s of grid) {
    const last = merged.at(-1);
    if (last && s - last.at(-1)! < MIN_STEP_M) last.push(s);
    else merged.push([s]);
  }
  // A cut stays, then a window's end (where its ease is back on the road's offsets).
  const fixed = merged.map((group) =>
    group.includes(s0)
      ? s0
      : group.includes(s1)
        ? s1
        : (group.find((s) => windowEnds.includes(s)) ??
          group.reduce((a, b) => a + b) / group.length),
  );
  const unique = [
    ...fixed,
    ...[...joined.lengths].filter(
      (s) =>
        s > s0 + CUT_GAP_M &&
        s < s1 - CUT_GAP_M &&
        !fixed.some((g) => Math.abs(g - s) < MIN_STEP_M),
    ),
  ].sort((a, b) => a - b);
  compiled.reference = joined.points;
  compiled.stations = Float64Array.from(unique);

  // The road's own reference and unit normals at its stations.
  const base = offsetLine(joined, unique, 0);
  const normal = offsetLine(joined, unique, 1).map((p, k) => ({
    x: p.x - base[k]!.x,
    y: p.y - base[k]!.y,
  }));
  let edge = leftEdge;
  const shifts = unique.map((s) => shiftAt(compiled, s, refLength));
  const nodeShift = [shiftAt(compiled, 0, refLength), shiftAt(compiled, refLength, refLength)];
  // TASK-214 (S1, S3): where the two ends' windows meet, the road has no room to return to its
  // own offsets between them: the offsets its lanes ease onto go from the start's shift to the
  // end's instead (Freiburg r:580, a 4.6 m one-lane pinch between two-lane roads, swung 1.5 m
  // back to its own line and out again).
  const reach = (end: ContinuationEnd | undefined) => (end ? end.holdM + end.taperM : 0);
  const crowded =
    reach(transition.start) > 0 &&
    reach(transition.end) > 0 &&
    reach(transition.start) + reach(transition.end) >= total - 0.01;
  const sidePoint = (end: ContinuationEnd, atEnd: boolean, s: number, value: number) => {
    const away = atEnd ? s1 - s : s - s0;
    // TASK-221: on a road that carries the transition on, the split runs from the node.
    const ease = end.carried ? smootherstep : smoothstep;
    const split = (end.splitM ?? 0) * ease((away + (end.referenceFromM ?? 0)) / end.taperM);
    // A converging shift reaching the node (TASK-089) moves the side-by-side block with it.
    return referencePoint(
      end,
      atEnd,
      away,
      value + end.offsetM + split + nodeShift[atEnd ? 1 : 0]!,
    );
  };
  const offset = (value: number) => {
    // On a crowded road, the side-by-side place of each end across the road's own line there.
    const across = (end: ContinuationEnd, atEnd: boolean) => {
      const k = atEnd ? unique.length - 1 : 0;
      const side = sidePoint(end, atEnd, unique[k]!, value);
      return (
        (side.x - base[k]!.x) * normal[k]!.x +
        (side.y - base[k]!.y) * normal[k]!.y -
        value -
        shifts[k]!
      );
    };
    const [from, to] = crowded
      ? [across(transition.start!, false), across(transition.end!, true)]
      : [0, 0];
    const line = base.map((p, k) => {
      const lateral =
        value +
        shifts[k]! +
        from +
        (to - from) * smoothstep((unique[k]! - s0) / Math.max(total, 1e-6));
      return { x: p.x + normal[k]!.x * lateral, y: p.y + normal[k]!.y * lateral };
    });
    if (!transition.start && !transition.end) return line;
    return unique.map((s, k) => {
      let result = line[k]!;
      for (const atEnd of [false, true]) {
        const end = atEnd ? transition.end : transition.start;
        const away = atEnd ? s1 - s : s - s0;
        if (!end || away >= end.holdM + end.taperM) continue;
        // Up to `holdM` the lane keeps its place in the side-by-side block along the reference
        // line; over the next `taperM` it eases onto its own offset. Both paths are smooth and
        // the smoothstep has zero slope at both ends, so the heading stays continuous.
        const f = (end.carried ? smootherstep : smoothstep)((away - end.holdM) / end.taperM);
        const side = sidePoint(end, atEnd, s, value);
        result = { x: side.x * (1 - f) + result.x * f, y: side.y * (1 - f) + result.y * f };
      }
      return result;
    });
  };
  for (const [lane, spec] of road.lanes.entries()) {
    const polyline = offset(edge + spec.widthM / 2);
    const cumulative = cumulativeLengths(polyline);
    const idx = lanes.length;
    compiled.lanes.push(idx);
    lanes.push({
      idx,
      id: laneId(road.id, lane),
      road: compiled.idx,
      lane,
      grade: compiled.grade,
      polyline,
      normals: normal,
      cumulative,
      lengthM: cumulative.at(-1)!,
      stopM: cumulative.at(-1)!,
      widthM: spec.widthM,
      taperStartM: transition.start?.tapers.includes(lane) ? taperLength(road) : 0,
      taperEndM: transition.end?.tapers.includes(lane) ? taperLength(road) : 0,
      allowed: [...spec.allowed],
      speedLimitMps: road.speedLimitMps,
      left: lane === 0 ? -1 : idx - 1,
      right: lane === road.lanes.length - 1 ? -1 : idx + 1,
      in: [],
      out: [],
      connectors: [],
    });
    edge += spec.widthM;
  }

  compiled.surface = [...offset(leftEdge), ...offset(leftEdge + width).reverse()];
  const roadLanes = compiled.lanes.map((i) => lanes[i]!);
  for (const lane of roadLanes) {
    if (!lane.taperStartM) continue;
    const neighbor = roadLanes
      .filter((l) => !l.taperStartM)
      .reduce((a, b) => (Math.abs(a.lane - lane.lane) <= Math.abs(b.lane - lane.lane) ? a : b));
    const heading = transition.start!.heading;
    const lateral = (Math.sign(lane.lane - neighbor.lane) * neighbor.widthM) / 2;
    const dx = neighbor.polyline[0]!.x - Math.sin(heading) * lateral - lane.polyline[0]!.x;
    const dy = neighbor.polyline[0]!.y + Math.cos(heading) * lateral - lane.polyline[0]!.y;
    lane.polyline = lane.polyline.map((p, i) => {
      const weight = 1 - smoothstep(lane.cumulative[i]! / lane.taperStartM);
      return { x: p.x + dx * weight, y: p.y + dy * weight };
    });
    lane.cumulative = cumulativeLengths(lane.polyline);
    lane.lengthM = lane.cumulative.at(-1)!;
  }
  if (roadLanes.some((l) => l.taperStartM || l.taperEndM)) {
    // TASK-214: a station whose points close to under `MIN_STEP_M` on some lane (an added lane
    // easing in beside a jogging block, Freiburg r:1548: 0.09 m) leaves every lane of the road, so
    // the painted edges, which skip such points, keep one point per station.
    const close = new Set<number>();
    for (const lane of roadLanes)
      for (let i = 1; i < lane.polyline.length - 1; i++)
        if (lane.cumulative[i]! - lane.cumulative[i - 1]! < MIN_STEP_M) close.add(i);
    if (close.size) {
      const keep = (_: unknown, i: number) => !close.has(i);
      compiled.stations = compiled.stations.filter(keep);
      const normals = roadLanes[0]!.normals.filter(keep);
      for (const lane of roadLanes) {
        lane.polyline = lane.polyline.filter(keep);
        lane.normals = normals;
        lane.cumulative = cumulativeLengths(lane.polyline);
        lane.lengthM = lane.cumulative.at(-1)!;
      }
    }
    const first = laneEdges(roadLanes[0]!, roadLanes);
    const last = laneEdges(roadLanes.at(-1)!, roadLanes);
    compiled.surface = [...first.left, ...last.right.reverse()];
  }
  if (shortened || compiled.lengthM < trim + 5) {
    diagnostics.push({
      severity: 'warning',
      code: 'road_too_short',
      refs: [road.id],
      message: `Road ${road.id} is too short for setbacks ${startSetback.toFixed(2)} m + ${endSetback.toFixed(2)} m and 5 m of lane`,
    });
  }
  return { jointDeviationM: deviationM };
}
