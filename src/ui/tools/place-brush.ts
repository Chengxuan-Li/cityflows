import { nearestPointOnLine } from '../../editor/commands/topology';
import { distance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity } from '../../network';
import type { Connector } from '../../schema';

export const brushRadiusM = 18;
const cellM = 2;
const key = (x: number, y: number) => `${x},${y}`;

export function ringArea(ring: readonly Vec2[]) {
  return (
    Math.abs(
      ring.reduce((sum, a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        return sum + a.x * b.y - b.x * a.y;
      }, 0),
    ) / 2
  );
}

export function ringCenter(ring: readonly Vec2[]): Vec2 {
  const origin = ring[0]!;
  let area = 0,
    x = 0,
    y = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    const a = ring[i]!,
      b = ring[i + 1]!;
    const ax = a.x - origin.x,
      ay = a.y - origin.y;
    const bx = b.x - origin.x,
      by = b.y - origin.y;
    const cross = ax * by - ay * bx;
    area += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  return { x: origin.x + x / (3 * area), y: origin.y + y / (3 * area) };
}

export function insideRing(point: Vec2, ring: readonly Vec2[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    )
      inside = !inside;
  }
  return inside;
}

export function nearestPlaceLane(city: CompiledCity, point: Vec2, used: readonly Connector[] = []) {
  let best: { roadId: string; lane: number; positionM: number; distance: number } | null = null;
  for (const lane of city.lanes) {
    const roadId = city.roads[lane.road]!.id;
    if (
      !lane.allowed.includes('car') ||
      used.some((c) => c.roadId === roadId && c.lane === lane.lane)
    )
      continue;
    const snap = nearestPointOnLine(point, lane.polyline);
    if (snap.distance <= 60 && (!best || snap.distance < best.distance)) {
      best = { roadId, lane: lane.lane, positionM: snap.atM, distance: snap.distance };
    }
  }
  if (!best) return null;
  return { roadId: best.roadId, lane: best.lane, positionM: best.positionM };
}

function simplify(line: Vec2[], tolerance: number): Vec2[] {
  let farthest = tolerance;
  let split = -1;
  for (let i = 1; i < line.length - 1; i++) {
    const away = nearestPointOnLine(line[i]!, [line[0]!, line.at(-1)!]).distance;
    if (away > farthest) {
      farthest = away;
      split = i;
    }
  }
  if (split < 0) return [line[0]!, line.at(-1)!];
  return [
    ...simplify(line.slice(0, split + 1), tolerance).slice(0, -1),
    ...simplify(line.slice(split), tolerance),
  ];
}

/** Raster union at 2 m resolution. The canonical shape has one ring, so enclosed holes fill. */
export class PlaceBrush {
  private cells = new Set<string>();
  private previous: Vec2 | null = null;

  include(ring: readonly Vec2[]) {
    const xs = ring.map((p) => p.x / cellM);
    const ys = ring.map((p) => p.y / cellM);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (insideRing({ x: (x + 0.5) * cellM, y: (y + 0.5) * cellM }, ring))
          this.cells.add(key(x, y));
      }
    }
  }

  paint(point: Vec2) {
    const samples: Vec2[] = [];
    const from = this.previous ?? point;
    const steps = Math.max(1, Math.ceil(distance(from, point) / (brushRadiusM / 3)));
    for (let i = 1; i <= steps; i++) {
      const center = {
        x: from.x + ((point.x - from.x) * i) / steps,
        y: from.y + ((point.y - from.y) * i) / steps,
      };
      samples.push(center);
      for (
        let y = Math.floor((center.y - brushRadiusM) / cellM);
        y <= Math.ceil((center.y + brushRadiusM) / cellM);
        y++
      ) {
        for (
          let x = Math.floor((center.x - brushRadiusM) / cellM);
          x <= Math.ceil((center.x + brushRadiusM) / cellM);
          x++
        ) {
          if (distance(center, { x: (x + 0.5) * cellM, y: (y + 0.5) * cellM }) <= brushRadiusM)
            this.cells.add(key(x, y));
        }
      }
    }
    this.previous = point;
    return samples;
  }

  ring(): Vec2[] {
    const edges = new Map<string, string[]>();
    const add = (a: string, b: string) => edges.set(a, [...(edges.get(a) ?? []), b]);
    for (const cell of this.cells) {
      const [x, y] = cell.split(',').map(Number) as [number, number];
      if (!this.cells.has(key(x, y - 1))) add(key(x, y), key(x + 1, y));
      if (!this.cells.has(key(x + 1, y))) add(key(x + 1, y), key(x + 1, y + 1));
      if (!this.cells.has(key(x, y + 1))) add(key(x + 1, y + 1), key(x, y + 1));
      if (!this.cells.has(key(x - 1, y))) add(key(x, y + 1), key(x, y));
    }
    let outer: Vec2[] = [];
    while (edges.size) {
      const start = edges.keys().next().value!;
      let at = start;
      const ring: Vec2[] = [];
      do {
        const [x, y] = at.split(',').map(Number) as [number, number];
        ring.push({ x: x * cellM, y: y * cellM });
        const next = edges.get(at)!;
        const end = next.pop()!;
        if (!next.length) edges.delete(at);
        at = end;
      } while (at !== start);
      if (ringArea(ring) > ringArea(outer)) outer = ring;
    }
    if (!outer.length) return [];
    // Smooth the cell stair-steps before simplifying the circular brush contour.
    outer = outer.map((_, i) => {
      const weights = [1, 4, 6, 4, 1];
      return weights.reduce(
        (sum, weight, j) => {
          const point = outer[(i + j - 2 + outer.length) % outer.length]!;
          return { x: sum.x + (point.x * weight) / 16, y: sum.y + (point.y * weight) / 16 };
        },
        { x: 0, y: 0 },
      );
    });
    const middle = Math.floor(outer.length / 2);
    let ring: Vec2[];
    let tolerance = 0.75;
    do {
      ring = [
        ...simplify(outer.slice(0, middle + 1), tolerance).slice(0, -1),
        ...simplify([...outer.slice(middle), outer[0]!], tolerance).slice(0, -1),
      ];
      tolerance *= 1.5;
    } while (ring.length > 48);
    return ring;
  }
}
