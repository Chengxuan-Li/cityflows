import {
  boxOf,
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  segmentDistance,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Pick } from './types';

export interface DebugPoint extends Vec2 {
  /** Metres above the ground, including road grades or airborne altitude. */
  z?: number;
}

export interface DebugPrimitive {
  kind: 'line' | 'point' | 'label';
  points: readonly DebugPoint[];
  color: number;
  id?: string;
  pick?: Pick;
  text?: string;
  only3d?: boolean;
  fill?: boolean;
}

export const ink = {
  blue: 0x176ee5,
  cyan: 0x099caf,
  green: 0x22a569,
  mint: 0x63c991,
  amber: 0xf09b1b,
  red: 0xdc4144,
  purple: 0x9254d8,
  pink: 0xdb4892,
  slate: 0x586d81,
  dark: 0x273c52,
} as const;

export const elevated = (p: Vec2, z: number): DebugPoint => (z ? { x: p.x, y: p.y, z } : p);
export const closed = (ring: readonly Vec2[]) => [...ring, ring[0]!];
export function line(
  points: readonly DebugPoint[],
  color: number,
  id?: string,
  pick?: Pick,
): DebugPrimitive {
  return { kind: 'line', points, color, id, pick };
}
export function dot(at: DebugPoint, color: number, id?: string, pick?: Pick): DebugPrimitive {
  return { kind: 'point', points: [at], color, id, pick };
}
export function label(at: DebugPoint, text: string, color: number): DebugPrimitive {
  return { kind: 'label', points: [at], text, color };
}

/** A chevron at a station on the line, including its interpolated deck height. */
export function arrow(
  points: readonly DebugPoint[],
  color: number,
  sizeM: number,
  fraction = 0.57,
): DebugPrimitive {
  const lengths = cumulativeLengths(points);
  const length = lengths.at(-1)!;
  const station = length * fraction;
  const p = pointAtDistance(points, lengths, station);
  const i = Math.max(
    1,
    lengths.findIndex((s) => s >= station),
  );
  const a = points[i - 1]!,
    b = points[i]!;
  const t = (station - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1);
  const z = (a.z ?? 0) * (1 - t) + (b.z ?? 0) * t;
  const heading = headingAtDistance(points, lengths, station);
  const size = Math.min(length * 0.3, sizeM);
  const dx = Math.cos(heading) * size,
    dy = Math.sin(heading) * size;
  return line(
    [
      elevated({ x: p.x - dx + dy * 0.56, y: p.y - dy - dx * 0.56 }, z),
      elevated(p, z),
      elevated({ x: p.x - dx - dy * 0.56, y: p.y - dy + dx * 0.56 }, z),
    ],
    color,
  );
}

import Flatbush from 'flatbush';
const pickIndices = new WeakMap<
  readonly DebugPrimitive[],
  { index: Flatbush; items: DebugPrimitive[] }
>();

export function pickDebugGeometry(
  primitives: readonly DebugPrimitive[],
  point: Vec2,
  toleranceM: number,
): DebugPrimitive | undefined {
  let cached = pickIndices.get(primitives);
  if (!cached) {
    const items = primitives.filter((item) => item.id && item.kind !== 'label');
    const index = new Flatbush(Math.max(1, items.length));
    for (const item of items) {
      const box = boxOf(item.points);
      index.add(box.minX, box.minY, box.maxX, box.maxY);
    }
    if (!items.length) index.add(0, 0, 0, 0);
    index.finish();
    cached = { index, items };
    pickIndices.set(primitives, cached);
  }
  let nearest: DebugPrimitive | undefined,
    best = toleranceM;
  for (const i of cached.index.search(
    point.x - toleranceM,
    point.y - toleranceM,
    point.x + toleranceM,
    point.y + toleranceM,
  )) {
    const item = cached.items[i];
    if (!item) continue;
    const points = item.points;
    let distance = Math.hypot(points[0]!.x - point.x, points[0]!.y - point.y);
    for (let j = 1; j < points.length; j++)
      distance = Math.min(distance, segmentDistance(point, points[j - 1]!, points[j]!));
    // Nodes have a finite visible footprint even when exactly on an edge.
    if (item.kind === 'point') distance = Math.max(0, distance - toleranceM * 0.45);
    if (
      distance < best ||
      (distance === best && (nearest?.kind !== 'point' || item.kind === 'point'))
    ) {
      nearest = item;
      best = distance;
    }
  }
  return nearest;
}
