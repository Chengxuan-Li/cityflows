import { cumulativeLengths, offsetPolyline, polylineLength, trimPolyline } from '../geo/polyline';
import { laneId, type Road } from '../schema';
import type { Vec2 } from '../geo/vec2';
import type { CLane, CRoad, Diagnostic } from './types';

export function roadWidth(road: Road): number {
  return road.lanes.reduce((width, lane) => width + lane.widthM, 0);
}

export function layoutRoad(
  road: Road,
  compiled: CRoad,
  startSetback: number,
  endSetback: number,
  lanes: CLane[],
  diagnostics: Diagnostic[],
  continuation: { before?: Vec2; after?: Vec2 } = {},
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
    return line.slice(continuation.before ? 1 : 0, continuation.after ? -1 : undefined);
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
      widthM: spec.widthM,
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
  if (shortened || compiled.lengthM < trim + 5) {
    diagnostics.push({
      severity: 'warning',
      code: 'road_too_short',
      refs: [road.id],
      message: `Road ${road.id} is too short for setbacks ${startSetback.toFixed(2)} m + ${endSetback.toFixed(2)} m and 5 m of lane`,
    });
  }
}
