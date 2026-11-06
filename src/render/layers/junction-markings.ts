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
import { style } from '../style';

export interface Guide {
  kind: 'divider' | 'centre' | 'edge';
  line: Vec2[];
  dashes: Vec2[][];
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
 * (anti-parallel when `opposite`). */
function midway(a: CMovement, b: CMovement, opposite: boolean): Vec2[][] {
  const runs: Vec2[][] = [[]];
  for (const { point, heading } of samples(a)) {
    const q = nearest(point, b.polyline);
    if (Math.cos(heading - q.heading) * (opposite ? -1 : 1) >= PARALLEL)
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

export function junctionGuides(city: CompiledCity, node: CNode): Guide[] {
  const groups = majorThroughs(city, node);
  if (!groups.length) return [];
  const major = new Set(
    groups.flat().flatMap((m) => [city.lanes[m.fromLane]!.road, city.lanes[m.toLane]!.road]),
  );
  const curb = city.drivingSide === 'right' ? 1 : -1;
  const lines: Omit<Guide, 'dashes'>[] = [];
  for (const group of groups) {
    for (let i = 1; i < group.length; i++) {
      const [a, b] = [group[i - 1]!, group[i]!];
      if (a.fromLane === b.fromLane || a.toLane === b.toLane) continue;
      for (const line of midway(a, b, false)) lines.push({ kind: 'divider', line });
    }
    const outer = group.at(-1)!;
    if (mouth(city, node, outer, major, curb))
      lines.push({ kind: 'edge', line: edge(city, outer, curb) });
  }
  // A one-way road has a curb on its median side too.
  const inner = groups[0]![0]!;
  if (groups.length === 1 && mouth(city, node, inner, major, -curb))
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
