import { pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CConnector, CompiledCity } from '../network';
import type { Place } from '../schema';
import { style } from './style';
import { parkingRadiusM } from './parking';
import type { Pick } from './types';

function segmentDistanceSquared(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2;
}

function insideRing(point: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    if (segmentDistanceSquared(point, a, b) < 1e-16) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function connectorPosition(city: CompiledCity, connector: CConnector): Vec2 {
  const lane = city.lanes[connector.lane]!;
  return pointAtDistance(lane.polyline, lane.cumulative, connector.positionM);
}

export function createPicker(
  city: CompiledCity,
  shapes: readonly Place['shape'][],
  roadGrades: readonly number[],
) {
  const segments = city.lanes.flatMap((lane) =>
    lane.polyline.slice(1).map((end, i) => ({ lane, start: lane.polyline[i]!, end })),
  );
  const radius = city.lanes.reduce((max, lane) => Math.max(max, lane.widthM / 2), 0);
  const connectors = city.connectors.map((connector) => connectorPosition(city, connector));

  return (point: Vec2, zoom = 1): Pick | null => {
    const { x, y } = point;
    let grade = -Infinity;
    let closest = Infinity;
    let hit: Pick | null = null;
    for (const segment of city.laneSpatial.search(x - radius, y - radius, x + radius, y + radius)) {
      const { lane, start, end } = segments[segment]!;
      const distance = segmentDistanceSquared(point, start, end);
      const layer = roadGrades[lane.road]!;
      if (distance > (lane.widthM / 2) ** 2 || layer < grade) continue;
      if (layer > grade || distance < closest) {
        grade = layer;
        closest = distance;
        hit = { kind: 'lane', lane: lane.idx, road: lane.road };
      }
    }
    for (const { idx, lane } of city.connectors) {
      if (roadGrades[city.lanes[lane]!.road]! < grade) continue;
      const pos = connectors[idx]!;
      if ((pos.x - x) ** 2 + (pos.y - y) ** 2 <= style.connectorRadiusM ** 2) {
        return { kind: 'connector', connector: idx };
      }
    }
    if (hit) return hit;

    for (let place = shapes.length - 1; place >= 0; place--) {
      const shape = shapes[place]!;
      if (
        shape.kind === 'polygon'
          ? insideRing(point, shape.ring)
          : (shape.pos.x - x) ** 2 + (shape.pos.y - y) ** 2 <=
            Math.max(style.pointRadiusM, 8 / zoom) ** 2
      ) {
        return { kind: 'place', place };
      }
    }
    for (const { idx, pos, radiusM } of city.nodes) {
      if ((pos.x - x) ** 2 + (pos.y - y) ** 2 <= Math.max(1, radiusM) ** 2) {
        return { kind: 'node', node: idx };
      }
    }
    return null;
  };
}

export function pickVehicle(
  point: Vec2,
  zoom: number,
  ids: Uint32Array,
  x: Float32Array,
  y: Float32Array,
  count: number,
): Pick | null {
  let nearest = -1;
  let best = (style.vehiclePickRadiusPx / zoom) ** 2;
  for (let i = 0; i < count; i++) {
    const distance = (x[i]! - point.x) ** 2 + (y[i]! - point.y) ** 2;
    if (distance < best || (distance === best && nearest < 0)) {
      nearest = i;
      best = distance;
    }
  }
  return nearest < 0 ? null : { kind: 'vehicle', id: ids[nearest]! };
}

export function pickParking(city: CompiledCity, point: Vec2, zoom: number): Pick | null {
  const radius = Math.max(parkingRadiusM, 7 / zoom);
  for (let i = city.parking.length - 1; i >= 0; i--) {
    const facility = city.parking[i]!;
    if (
      Math.abs(point.x - facility.centroid.x) <= radius &&
      Math.abs(point.y - facility.centroid.y) <= radius
    )
      return { kind: 'parking', parking: facility.idx };
  }
  return null;
}
