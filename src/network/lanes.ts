import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  offsetPolyline,
  polylineLength,
  trimPolyline,
} from '../geo/polyline';
import { laneId, type Road } from '../schema';
import type { Vec2 } from '../geo/vec2';
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
   * separate before the cut. */
  holdM: number;
  taperM: number;
  /** A shift to the right that the side-by-side block takes over the first `taperM`: a branch
   * that starts on a trunk lane it shares with its left neighbour moves off it. */
  splitM?: number;
  /** The line the side-by-side block follows, in travel direction, starting (start end) or
   * ending (end end) at the road's trimmed end: a ray along `heading` from a continuation node,
   * the branches' mean line elsewhere. */
  reference: Vec2[];
}

export interface RoadContinuity {
  start?: ContinuationEnd;
  end?: ContinuationEnd;
}

export function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** TASK-080 (B37): every taper is short and scaled by speed, at most half the road. */
export function taperLength(road: Road): number {
  const kmh = road.speedLimitMps * 3.6;
  return Math.min(polylineLength(road.centerline) / 2, Math.max(15, Math.min(40, 0.4 * kmh)));
}

/** A point `lateral` to the right of the end's reference line, `away` from the road's end. */
function referencePoint(end: ContinuationEnd, atEnd: boolean, away: number, lateral: number) {
  const lengths = cumulativeLengths(end.reference);
  const total = lengths.at(-1)!;
  const s = Math.max(0, Math.min(total, atEnd ? total - away : away));
  const origin = pointAtDistance(end.reference, lengths, s);
  const heading = headingAtDistance(end.reference, lengths, s);
  return {
    x: origin.x - Math.sin(heading) * lateral,
    y: origin.y + Math.cos(heading) * lateral,
  };
}

export function roadWidth(road: Road): number {
  return road.lanes.reduce((width, lane) => width + lane.widthM, 0);
}

/** Painted lane edges collapse onto the nearest surviving lane; driving polylines stay put. */
export function laneEdges(lane: CLane, roadLanes: CLane[]): { left: Vec2[]; right: Vec2[] } {
  const edges = (side: number) => {
    const line = offsetPolyline(lane.polyline, (lane.widthM / 2) * side);
    const lengths = cumulativeLengths(line);
    return line.map((point, i) => {
      const at = (lengths[i]! / lengths.at(-1)!) * lane.lengthM;
      let p = point;
      for (const start of [true, false]) {
        const taper = start ? lane.taperStartM : lane.taperEndM;
        const away = start ? at : lane.lengthM - at;
        if (!taper || away > taper) continue;
        const surviving = roadLanes.filter((l) => !(start ? l.taperStartM : l.taperEndM));
        const neighbor = surviving.reduce((a, b) =>
          Math.abs(a.lane - lane.lane) <= Math.abs(b.lane - lane.lane) ? a : b,
        );
        const s = (at / lane.lengthM) * neighbor.lengthM;
        const center = pointAtDistance(neighbor.polyline, neighbor.cumulative, s);
        const h = headingAtDistance(neighbor.polyline, neighbor.cumulative, s);
        const offset = (Math.sign(lane.lane - neighbor.lane) * neighbor.widthM) / 2;
        const f = smoothstep(away / taper);
        p = {
          x: p.x * f + (center.x - Math.sin(h) * offset) * (1 - f),
          y: p.y * f + (center.y + Math.cos(h) * offset) * (1 - f),
        };
      }
      return p;
    });
  };
  return { left: edges(-1), right: edges(1) };
}

export function layoutRoad(
  road: Road,
  compiled: CRoad,
  startSetback: number,
  endSetback: number,
  lanes: CLane[],
  diagnostics: Diagnostic[],
  continuation: { before?: Vec2; after?: Vec2 } = {},
  transition: RoadContinuity = {},
): void {
  const width = roadWidth(road);
  const leftEdge = road.lateralOffsetM - width / 2;
  const trim = startSetback + endSetback;
  const length = polylineLength(road.centerline);
  const scale = trim === 0 ? 1 : Math.min(1, Math.max(0, length - 5) / trim);
  const shortened = scale < 1;
  const centerline = trimPolyline(road.centerline, startSetback * scale, endSetback * scale);

  let edge = leftEdge;
  const extended = [
    ...(continuation.before ? [continuation.before] : []),
    ...centerline,
    ...(continuation.after ? [continuation.after] : []),
  ];
  const offset = (value: number) => {
    const line = offsetPolyline(extended, value);
    const original = line.slice(continuation.before ? 1 : 0, continuation.after ? -1 : undefined);
    if (!transition.start && !transition.end) return original;
    const lengths = cumulativeLengths(centerline);
    const total = lengths.at(-1)!;
    const stations = new Set([...lengths]);
    for (const atEnd of [false, true]) {
      const end = atEnd ? transition.end : transition.start;
      if (!end) continue;
      const span = Math.min(total, Math.max(0, end.holdM + end.taperM));
      const count = Math.ceil(span / 0.5);
      for (let i = 1; i <= count; i++) {
        const s = (span * i) / count;
        stations.add(atEnd ? total - s : s);
      }
    }
    return [...stations]
      .sort((a, b) => a - b)
      .map((s) => {
        // Sample each original offset segment by the corresponding centerline station.
        const p = pointAtDistance(centerline, lengths, s);
        const h = headingAtDistance(centerline, lengths, s);
        let result =
          original.length === centerline.length
            ? pointAtDistance(original, lengths, s)
            : { x: p.x - Math.sin(h) * value, y: p.y + Math.cos(h) * value };
        if (s === 0) result = original[0]!;
        if (s === total) result = original.at(-1)!;
        for (const atEnd of [false, true]) {
          const end = atEnd ? transition.end : transition.start;
          const away = atEnd ? total - s : s;
          if (!end || away >= end.holdM + end.taperM) continue;
          // Up to `holdM` the lane keeps its place in the side-by-side block along the reference
          // line; over the next `taperM` it eases onto its own offset. Both paths are smooth and
          // the smoothstep has zero slope at both ends, so the heading stays continuous.
          const f = smoothstep((away - end.holdM) / end.taperM);
          const split = (end.splitM ?? 0) * smoothstep(away / end.taperM);
          const side = referencePoint(end, atEnd, away, value + end.offsetM + split);
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
      polyline,
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
}
