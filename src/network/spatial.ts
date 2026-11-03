import Flatbush from 'flatbush';
import type { CLane } from './types';

// Flatbush requires at least one item, even when an authored city has no roads.
class EmptyLaneSpatial extends Flatbush {
  constructor() {
    super(1);
    this.add(Infinity, Infinity, Infinity, Infinity);
    this.finish();
  }

  override search(): number[] {
    return [];
  }

  override collides(): boolean {
    return false;
  }

  override neighbors(): number[] {
    return [];
  }
}

export function buildLaneSpatial(lanes: CLane[]): Flatbush {
  const count = lanes.reduce((sum, lane) => sum + lane.polyline.length - 1, 0);
  if (count === 0) return new EmptyLaneSpatial();
  const index = new Flatbush(count);
  // Search results are segment ordinals in lane order, then polyline order.
  for (const { polyline } of lanes) {
    for (let i = 1; i < polyline.length; i++) {
      const a = polyline[i - 1]!;
      const b = polyline[i]!;
      index.add(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
    }
  }
  index.finish();
  return index;
}
