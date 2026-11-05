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
  heading: number;
  offsetM: number;
  tapers: number[];
}

export interface RoadContinuity {
  start?: ContinuationEnd;
  end?: ContinuationEnd;
}

export function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
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
    const taper = Math.min(60, length / 2);
    const stations = new Set([...lengths]);
    for (const atEnd of [false, true]) {
      if (!(atEnd ? transition.end : transition.start)) continue;
      const count = Math.ceil(taper / 0.5);
      for (let i = 0; i <= count; i++) {
        const s = (taper * i) / count;
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
          if (!end || away > taper) continue;
          const t = away / taper;
          const f = smoothstep(t);
          const origin = atEnd ? centerline.at(-1)! : centerline[0]!;
          const targetS = atEnd ? total - taper : taper;
          const target = pointAtDistance(centerline, lengths, targetS);
          const targetHeading = headingAtDistance(centerline, lengths, targetS);
          const sign = atEnd ? -1 : 1;
          // A Hermite centerline leaves on the trunk tangent and meets the source road
          // tangentially. Its lateral lane-block correction uses the same smoothstep.
          const first = sign * taper * t * (1 - t) ** 2;
          const last = sign * taper * t * t * (t - 1);
          const lateral = value + end.offsetM * (1 - f);
          const normalX = -Math.sin(end.heading) * (1 - f) - Math.sin(targetHeading) * f;
          const normalY = Math.cos(end.heading) * (1 - f) + Math.cos(targetHeading) * f;
          result = {
            x:
              origin.x * (1 - f) +
              target.x * f +
              Math.cos(end.heading) * first +
              Math.cos(targetHeading) * last +
              normalX * lateral,
            y:
              origin.y * (1 - f) +
              target.y * f +
              Math.sin(end.heading) * first +
              Math.sin(targetHeading) * last +
              normalY * lateral,
          };
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
      taperStartM: transition.start?.tapers.includes(lane) ? Math.min(60, length / 2) : 0,
      taperEndM: transition.end?.tapers.includes(lane) ? Math.min(60, length / 2) : 0,
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
