import type { Graphics } from 'pixi.js';
import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  pointInPolygon,
  trimPolyline,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CMovement, CNode, CompiledCity } from '../../network';
import { defaultSlice, orderBranches } from '../../network/continuity';
import { style } from '../style';

export interface Guide {
  kind: 'divider' | 'centre' | 'edge';
  line: Vec2[];
  dashes: Vec2[][];
  /** A split junction's divider (TASK-088): the two lined-up movements it runs between. */
  between?: [CMovement, CMovement];
}

const SAMPLE_M = 0.5;
const PARALLEL = Math.cos(Math.PI / 6);

/**
 * The through groups of a node's major road (architecture section 11, TASK-075), one group
 * per approach, each sorted from the median to the curb. Empty when the node is signalized,
 * has no outline, or no approach's through movements outrank every movement of the others.
 */
export function majorThroughs(city: CompiledCity, node: CNode): CMovement[][] {
  if (node.control === 'signal' || !node.outline.length) return [];
  const movements = node.movements.map((i) => city.movements[i]!).filter((m) => !m.neverGreen);
  const roadOf = (m: CMovement) => city.lanes[m.fromLane]!.road;
  const throughs = movements.filter((m) => m.turn === 'through');
  if (!throughs.length) return [];
  const top = Math.max(...throughs.map((m) => m.priority));
  const approaches = [...new Set(throughs.filter((m) => m.priority === top).map(roadOf))].sort(
    (a, b) => a - b,
  );
  if (
    approaches.length > 2 ||
    movements.some((m) => !approaches.includes(roadOf(m)) && m.priority >= top)
  )
    return [];
  const key = (lane: number) => (city.drivingSide === 'right' ? 1 : -1) * city.lanes[lane]!.lane;
  const groups = approaches.map((road) =>
    throughs
      .filter((m) => roadOf(m) === road)
      .sort((a, b) => key(a.fromLane) - key(b.fromLane) || key(a.toLane) - key(b.toLane)),
  );
  // Two groups must be the two directions of one road, side by side: the other direction's
  // innermost path starts on the median side of this one's (imported carriageways with
  // coincident centerlines overlap instead). A lone group must be a one-way road, so no
  // other approach arrives against the direction it leaves in.
  const inner = groups[0]![0]!;
  const exit = endHeading(inner.polyline);
  const major =
    groups.length === 2
      ? opposed(exit, startHeading(groups[1]![0]!.polyline)) &&
        medianOffset(city, inner, groups[1]![0]!.polyline[0]!) >=
          (city.lanes[inner.toLane]!.widthM + city.lanes[groups[1]![0]!.fromLane]!.widthM) / 4
      : !city.roads.some(
          (road) =>
            road.to === node.idx &&
            road.idx !== approaches[0] &&
            opposed(exit, endHeading(city.lanes[road.lanes[0]!]!.polyline)),
        );
  return major ? groups : [];
}

const startHeading = (line: Vec2[]) => Math.atan2(line[1]!.y - line[0]!.y, line[1]!.x - line[0]!.x);
const endHeading = (line: Vec2[]) =>
  Math.atan2(line.at(-1)!.y - line.at(-2)!.y, line.at(-1)!.x - line.at(-2)!.x);
const opposed = (a: number, b: number) => Math.cos(a - b) <= -PARALLEL;

/** How far `point` lies to the median side of the end of `m`. */
function medianOffset(city: CompiledCity, m: CMovement, point: Vec2) {
  const end = m.polyline.at(-1)!;
  const heading = endHeading(m.polyline);
  const right = (point.x - end.x) * -Math.sin(heading) + (point.y - end.y) * Math.cos(heading);
  return city.drivingSide === 'right' ? -right : right;
}

function samples(m: CMovement) {
  const count = Math.max(1, Math.ceil(m.lengthM / SAMPLE_M));
  return Array.from({ length: count + 1 }, (_, i) => {
    const s = (m.lengthM * i) / count;
    return {
      s,
      point: pointAtDistance(m.polyline, m.cumulative, s),
      heading: headingAtDistance(m.polyline, m.cumulative, s),
    };
  });
}

function nearest(point: Vec2, line: Vec2[]) {
  let best = { point: line[0]!, heading: 0, distance: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(point.x - q.x, point.y - q.y);
    if (distance < best.distance) best = { point: q, heading: Math.atan2(dy, dx), distance };
  }
  return best;
}

/** Runs of midpoints between two paths, kept where they are within 30 degrees of parallel
 * (anti-parallel when `opposite`). Given `apart` (two paths that start and end side by side), only
 * where they are no farther apart, and the first and last midpoints are those of their ends. */
function midway(a: CMovement, b: CMovement, opposite: boolean, apart?: number): Vec2[][] {
  const runs: Vec2[][] = [[]];
  const all = samples(a);
  for (const [i, { point, heading }] of all.entries()) {
    const q = nearest(point, b.polyline);
    if (apart !== undefined && (i === 0 || i === all.length - 1))
      q.point = i ? b.polyline.at(-1)! : b.polyline[0]!;
    if (
      Math.cos(heading - q.heading) * (opposite ? -1 : 1) >= PARALLEL &&
      q.distance <= (apart ?? Infinity)
    )
      runs.at(-1)!.push({ x: (point.x + q.point.x) / 2, y: (point.y + q.point.y) / 2 });
    else if (runs.at(-1)!.length) runs.push([]);
  }
  return runs.filter((run) => run.length > 1);
}

/** The edge of a path on `side` (1 right, -1 left), its width blending from the entry to the
 * exit lane. */
function edge(city: CompiledCity, m: CMovement, side: number): Vec2[] {
  const from = city.lanes[m.fromLane]!.widthM;
  const to = city.lanes[m.toLane]!.widthM;
  return samples(m).map(({ s, point, heading }) => {
    const offset = (side * (from + ((to - from) * s) / m.lengthM)) / 2;
    return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
  });
}

/** True when a road outside the major road meets the node on `side` of `m`. */
function mouth(city: CompiledCity, node: CNode, m: CMovement, major: Set<number>, side: number) {
  const a = m.polyline[0]!;
  const b = m.polyline.at(-1)!;
  return city.roads.some((road) => {
    if (major.has(road.idx) || (road.from !== node.idx && road.to !== node.idx)) return false;
    const ends = [road.lanes[0]!, road.lanes.at(-1)!].map((i) => {
      const line = city.lanes[i]!.polyline;
      return road.to === node.idx ? line.at(-1)! : line[0]!;
    });
    const p = { x: (ends[0]!.x + ends[1]!.x) / 2, y: (ends[0]!.y + ends[1]!.y) / 2 };
    return side * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) > 0;
  });
}

function dashes(line: Vec2[]): Vec2[][] {
  const total = cumulativeLengths(line).at(-1)!;
  const period = style.guideDashM + style.guideGapM;
  const count = Math.floor((total + style.guideGapM) / period);
  const start = (total - count * period + style.guideGapM) / 2;
  return Array.from({ length: count }, (_, i) =>
    trimPolyline(line, start + i * period, total - start - i * period - style.guideDashM),
  );
}

const continuing = (m: CMovement) =>
  m.turn === 'through' || m.turn === 'merge' || m.turn === 'diverge';

/**
 * TASK-085's lined-up movements at a split junction, or null when the node is none: a split,
 * merge, narrowing or widening as TASK-071 classifies it (uncontrolled, every movement through,
 * merge or diverge, every road end within 30 degrees of one axis) that keeps a junction polygon.
 * The pairs are TASK-071's default slice (`continuity.ts`), the branches ordered by the headings
 * of their reference lines at the node, as `generateMovements` orders them by their centerlines.
 */
export function splitLinedUp(city: CompiledCity, node: CNode): CMovement[] | null {
  if (node.control !== 'uncontrolled' || !node.outline.length || !node.movements.length)
    return null;
  if (node.movements.some((i) => !continuing(city.movements[i]!))) return null;
  const headings: { start: number; end: number }[] = [];
  const ends = city.roads.flatMap((road) => {
    if (road.from !== node.idx && road.to !== node.idx) return [];
    const line = road.reference;
    headings[road.idx] = { start: startHeading(line), end: endHeading(line) };
    return [
      ...(road.to === node.idx ? [{ road, entering: true, heading: headings[road.idx]!.end }] : []),
      ...(road.from === node.idx
        ? [{ road, entering: false, heading: headings[road.idx]!.start }]
        : []),
    ];
  });
  if (ends.some((end) => Math.abs(Math.cos(end.heading - ends[0]!.heading)) < PARALLEL - 1e-9))
    return null;
  const lined: CMovement[] = [];
  let axis: number | undefined;
  for (const forward of [true, false]) {
    const group = ends.filter((end) => Math.cos(end.heading - ends[0]!.heading) > 0 === forward);
    const into = group.filter((end) => end.entering).map((end) => end.road);
    const out = group.filter((end) => !end.entering).map((end) => end.road);
    if (!into.length || !out.length || (into.length > 1 && out.length > 1)) continue;
    const split =
      into.length === 1 && (out.length > 1 || into[0]!.lanes.length >= out[0]!.lanes.length);
    const trunk = (split ? into : out)[0]!;
    const trunkHeading = headings[trunk.idx]![split ? 'end' : 'start'];
    axis ??= trunkHeading;
    const heading = axis + (Math.cos(trunkHeading - axis) < 0 ? Math.PI : 0);
    const ordered = orderBranches(split ? out : into, headings, heading, split);
    let cursor = 0;
    for (const [position, branch] of ordered.entries()) {
      const slice = defaultSlice(
        trunk.lanes.length,
        ordered.map((road) => road.lanes.length),
        position,
        cursor,
        city.drivingSide,
      );
      if (slice.length) cursor = slice.at(-1)![0] + 1;
      for (const [t, b] of slice) {
        const from = city.lanes[(split ? trunk : branch).lanes[split ? t : b]!]!;
        const to = (split ? branch : trunk).lanes[split ? b : t]!;
        const movement = from.out.map((i) => city.movements[i]!).find((m) => m.toLane === to);
        if (movement) lined.push(movement);
      }
    }
  }
  return lined;
}

/** How far two neighbouring paths may be from a lane width apart and still run side by side. */
const SIDE_BY_SIDE_M = 0.2;

/** TASK-088 (B44): the dividers across a split junction, between neighbouring lined-up
 * movements: two that leave and arrive side by side on the same side, a lane width apart (within
 * `SIDE_BY_SIDE_M`), in different lanes. The divider runs midway between them except where they
 * part by more than a lane width (a gore); paths into branches of different headings may pinch
 * closer in between (0.6 m at Munich n:312) and keep it. Paths converging into one lane get none.
 * Every road draws its lane dividers dashed, so these are dashed too. */
function splitDividers(city: CompiledCity, lined: CMovement[]): Omit<Guide, 'dashes'>[] {
  /** How far `to` lies to the right of `from`, across lane `index` at its node end. */
  const lateral = (from: Vec2, index: number, atEnd: boolean, to: Vec2) => {
    const lane = city.lanes[index]!;
    const h = headingAtDistance(lane.polyline, lane.cumulative, atEnd ? lane.lengthM : 0);
    return -(to.x - from.x) * Math.sin(h) + (to.y - from.y) * Math.cos(h);
  };
  const width = (a: number, b: number) => (city.lanes[a]!.widthM + city.lanes[b]!.widthM) / 2;
  const lines: Omit<Guide, 'dashes'>[] = [];
  for (const [i, a] of lined.entries())
    for (const b of lined.slice(i + 1)) {
      if (a.fromLane === b.fromLane || a.toLane === b.toLane) continue;
      const start = lateral(a.polyline[0]!, a.fromLane, true, b.polyline[0]!);
      const end = lateral(a.polyline.at(-1)!, a.toLane, false, b.polyline.at(-1)!);
      if (
        Math.sign(start) !== Math.sign(end) ||
        Math.abs(Math.abs(start) - width(a.fromLane, b.fromLane)) > SIDE_BY_SIDE_M ||
        Math.abs(Math.abs(end) - width(a.toLane, b.toLane)) > SIDE_BY_SIDE_M
      )
        continue;
      const apart = Math.max(width(a.fromLane, b.fromLane), width(a.toLane, b.toLane));
      for (const line of midway(a, b, false, apart + SIDE_BY_SIDE_M))
        lines.push({ kind: 'divider', line, between: [a, b] });
    }
  return lines;
}

export function junctionGuides(city: CompiledCity, node: CNode): Guide[] {
  const lined = splitLinedUp(city, node);
  const groups = majorThroughs(city, node);
  if (!groups.length && !lined) return [];
  const lines = lined ? splitDividers(city, lined) : [];
  const major = new Set(
    groups.flat().flatMap((m) => [city.lanes[m.fromLane]!.road, city.lanes[m.toLane]!.road]),
  );
  const curb = city.drivingSide === 'right' ? 1 : -1;
  for (const group of groups) {
    // At a split junction the dividers are the lined-up movements' (above).
    for (let i = 1; i < group.length && !lined; i++) {
      const [a, b] = [group[i - 1]!, group[i]!];
      if (a.fromLane === b.fromLane || a.toLane === b.toLane) continue;
      for (const line of midway(a, b, false)) lines.push({ kind: 'divider', line });
    }
    const outer = group.at(-1)!;
    if (mouth(city, node, outer, major, curb))
      lines.push({ kind: 'edge', line: edge(city, outer, curb) });
  }
  // A one-way road has a curb on its median side too.
  const inner = groups[0]?.[0];
  if (inner && groups.length === 1 && mouth(city, node, inner, major, -curb))
    lines.push({ kind: 'edge', line: edge(city, inner, -curb) });
  if (groups.length === 2)
    for (const line of midway(groups[0]![0]!, groups[1]![0]!, true))
      lines.push({ kind: 'centre', line });
  // The junction outline may stop short of a capped road end (TASK-074); keep only the parts
  // of each dash that lie on the junction or on one of its roads.
  const rings = [
    node.outline,
    ...city.roads
      .filter((road) => road.from === node.idx || road.to === node.idx)
      .map((road) => road.surface),
  ]
    .filter((ring) => ring.length > 2)
    .map((ring) => [...ring, ring[0]!]);
  const inside = (p: Vec2) => rings.some((ring) => pointInPolygon(p, ring, 0.05));
  return lines.map((guide) => ({
    ...guide,
    dashes: dashes(guide.line).flatMap((dash) => keepInside(dash, inside)),
  }));
}

/** The runs of a dash whose sampled points all lie inside; runs under 0.5 m are dropped. */
function keepInside(dash: Vec2[], inside: (p: Vec2) => boolean): Vec2[][] {
  if (dash.every(inside)) return [dash];
  const cumulative = cumulativeLengths(dash);
  const total = cumulative.at(-1)!;
  const step = 0.1;
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  for (let s = 0; s <= total + 1e-9; s += step) {
    const p = pointAtDistance(dash, cumulative, Math.min(s, total));
    if (inside(p)) run.push(p);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1 && (r.length - 1) * step >= 0.5);
}

function fadeAtZoom(graphics: Graphics, from: number, to: number) {
  graphics.onRender ??= () => {
    const zoom = graphics.parent!.worldTransform.a;
    graphics.alpha = Math.max(0, Math.min(1, (zoom - from) / (to - from)));
  };
}

/** Draws a node's guide lines as one stroke; returns the number of dashes. */
export function drawJunctionMarkings(graphics: Graphics, city: CompiledCity, node: CNode): number {
  fadeAtZoom(graphics, 0.7, 2.2);
  let count = 0;
  for (const guide of junctionGuides(city, node)) {
    for (const dash of guide.dashes) {
      graphics.moveTo(dash[0]!.x, dash[0]!.y);
      for (const point of dash.slice(1)) graphics.lineTo(point.x, point.y);
      count++;
    }
  }
  if (count)
    graphics.stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.78, cap: 'butt' });
  return count;
}
