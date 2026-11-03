import { cumulativeLengths, offsetPolyline, polylineLength, trimPolyline } from '../geo/polyline';
import { laneId, type Road } from '../schema';
import type { CLane, CNode, CRoad, Diagnostic } from './types';

export function roadWidth(road: Road): number {
  return road.lanes.reduce((width, lane) => width + lane.widthM, 0);
}

export function layoutRoad(
  road: Road,
  compiled: CRoad,
  from: CNode,
  to: CNode,
  lanes: CLane[],
  diagnostics: Diagnostic[],
): void {
  const width = roadWidth(road);
  const leftEdge = road.lateralOffsetM - width / 2;
  const trim = from.radiusM + to.radiusM;
  let shortened = false;
  function trimToNodes(line: ReturnType<typeof offsetPolyline>) {
    const length = polylineLength(line);
    const scale = Math.min(1, Math.max(0, length - 5) / trim);
    if (scale < 1) shortened = true;
    return trimPolyline(line, from.radiusM * scale, to.radiusM * scale);
  }

  let edge = leftEdge;
  for (const [lane, spec] of road.lanes.entries()) {
    const polyline = trimToNodes(offsetPolyline(road.centerline, edge + spec.widthM / 2));
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

  compiled.surface = [
    ...trimToNodes(offsetPolyline(road.centerline, leftEdge)),
    ...trimToNodes(offsetPolyline(road.centerline, leftEdge + width)).reverse(),
  ];
  if (shortened || compiled.lengthM < trim + 5) {
    diagnostics.push({
      severity: 'warning',
      code: 'road_too_short',
      refs: [road.id],
      message: `Road ${road.id} is too short for full junction trimming`,
    });
  }
}
