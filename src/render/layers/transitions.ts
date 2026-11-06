import type { Graphics } from 'pixi.js';
import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  trimPolyline,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { laneEdges } from '../../network/lanes';
import type { CLane, CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

export function transitionGeometry(city: CompiledCity, road: CRoad) {
  const roadLanes = road.lanes.map((i) => city.lanes[i]!);
  const lanes = roadLanes.map((lane) => {
    const edges = laneEdges(lane, roadLanes);
    const chevrons: Vec2[][] = [];
    if (lane.taperEndM) {
      const neighbor = roadLanes
        .filter((l) => !l.taperEndM)
        .reduce((a, b) => (Math.abs(a.lane - lane.lane) <= Math.abs(b.lane - lane.lane) ? a : b));
      const side = Math.sign(neighbor.lane - lane.lane);
      for (const fraction of [0.25, 0.55]) {
        const s = lane.lengthM - lane.taperEndM * (1 - fraction);
        const h = headingAtDistance(lane.polyline, lane.cumulative, s);
        const left = pointAtDistance(
          edges.left,
          cumulativeLengths(edges.left),
          (s / lane.lengthM) * cumulativeLengths(edges.left).at(-1)!,
        );
        const right = pointAtDistance(
          edges.right,
          cumulativeLengths(edges.right),
          (s / lane.lengthM) * cumulativeLengths(edges.right).at(-1)!,
        );
        const center = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
        const width = Math.hypot(right.x - left.x, right.y - left.y);
        chevrons.push(
          [
            [-1, -side * width * 0.2],
            [1, side * width * 0.25],
            [0, -side * width * 0.2],
          ].map(([along, lateral]) => ({
            x: center.x + Math.cos(h) * along! - Math.sin(h) * lateral!,
            y: center.y + Math.sin(h) * along! + Math.cos(h) * lateral!,
          })),
        );
      }
    }
    return { lane: lane.idx, ...edges, chevrons };
  });
  // Dividers run to the lane's stop position, like every other road's (TASK-079), on the lane
  // edges, which keep their offset through curves (TASK-082).
  const dividers = roadLanes.slice(0, -1).map((lane, i) => toStop(lane, lanes[i]!.right));
  return { lanes, dividers };
}

/** The part of one of a lane's edges up to the lane's stop position. */
function toStop(lane: CLane, edge: Vec2[]): Vec2[] {
  const total = cumulativeLengths(edge).at(-1)!;
  return trimPolyline(edge, 0, total * (1 - lane.stopM / lane.lengthM));
}

const laneOfSegment = new WeakMap<CompiledCity, Int32Array>();

/** The lane each `laneSpatial` segment ordinal belongs to. */
function segmentLanes(city: CompiledCity): Int32Array {
  let lanes = laneOfSegment.get(city);
  if (lanes) return lanes;
  lanes = new Int32Array(city.lanes.reduce((sum, l) => sum + l.polyline.length - 1, 0));
  let k = 0;
  for (const lane of city.lanes)
    for (let i = 1; i < lane.polyline.length; i++) lanes[k++] = lane.idx;
  laneOfSegment.set(city, lanes);
  return lanes;
}

function lineDistance(p: Vec2, line: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

const seamCache = new WeakMap<CompiledCity, Map<number, Vec2[][]>>();

/** TASK-080: where a road's lanes run side by side with another road's in the same direction
 * (the branches of a split or merge drawn as one block, at a continuation or not), the seams
 * between the two along this road's right edge, up to where they part. */
export function seams(city: CompiledCity, road: CRoad): Vec2[][] {
  let cached = seamCache.get(city);
  if (!cached) seamCache.set(city, (cached = new Map()));
  const hit = cached.get(road.idx);
  if (hit) return hit;
  const roadLanes = road.lanes.map((i) => city.lanes[i]!);
  const edge = toStop(roadLanes.at(-1)!, laneEdges(roadLanes.at(-1)!, roadLanes).right);
  const lengths = cumulativeLengths(edge);
  const owner = segmentLanes(city);
  const candidates = new Set<number>();
  for (let s = 0; ; s = Math.min(lengths.at(-1)!, s + 4)) {
    const p = pointAtDistance(edge, lengths, s);
    for (const k of city.laneSpatial.search(p.x - 3, p.y - 3, p.x + 3, p.y + 3)) {
      const lane = city.lanes[owner[k]!]!;
      if (lane.road !== road.idx && lane.left < 0) candidates.add(lane.idx);
    }
    if (s === lengths.at(-1)!) break;
  }
  const found: Vec2[][] = [];
  for (const index of candidates) {
    const lane = city.lanes[index]!;
    const other = city.roads[lane.road]!;
    const left = laneEdges(
      lane,
      other.lanes.map((i) => city.lanes[i]!),
    ).left;
    let run: Vec2[] = [];
    const close = () => {
      if (run.length > 1 && cumulativeLengths(run).at(-1)! >= 1 && sameWay(run, left))
        found.push(run);
      run = [];
    };
    for (const q of edge) {
      const d = lineDistance(q, left);
      if (d <= (run.length ? 0.25 : 0.1)) run.push(q);
      else close();
    }
    close();
  }
  cached.set(road.idx, found);
  return found;
}

/** The run of this road's right edge heads the same way as the neighbour's left edge. */
function sameWay(run: Vec2[], left: Vec2[]): boolean {
  const a = run[0]!,
    b = run[1]!;
  let closest = 1;
  for (let i = 2; i < left.length; i++)
    if (
      lineDistance(a, [left[i - 1]!, left[i]!]) <
      lineDistance(a, [left[closest - 1]!, left[closest]!])
    )
      closest = i;
  const c = left[closest - 1]!,
    d = left[closest]!;
  return (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) > 0;
}

/** Dashes 2.7 m long every 5.8 m, the last one ending at the line's end (the stop position). */
function drawDashed(markings: Graphics, line: Vec2[]) {
  const total = cumulativeLengths(line).at(-1)!;
  for (let end = total; end > 0; end -= 5.8)
    markings
      .poly(trimPolyline(line, Math.max(0, end - 2.7), total - end), false)
      .stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.78 });
}

export function drawTransitions(
  surface: Graphics,
  markings: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
): void {
  for (const seam of seams(city, road)) drawDashed(markings, seam);
  if (!road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM)) return;
  const geometry = transitionGeometry(city, road);
  const { color } = roadStyle(road, roadClasses);
  for (const lane of geometry.lanes) {
    surface.poly([...lane.left, ...[...lane.right].reverse()]).fill(color);
    for (const chevron of lane.chevrons)
      markings.poly(chevron, false).stroke({ color: style.marking, width: 0.22, join: 'round' });
  }
  for (const divider of geometry.dividers) drawDashed(markings, divider);
}
