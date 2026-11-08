import type { City, LaneId, MovementId, RoadId } from './city';

export function allocateId(
  city: Pick<City, 'nextId'>,
  prefix: 'n' | 'r' | 'p' | 'c' | 'pk' | 'wn' | 'wl',
): string {
  return `${prefix}:${city.nextId++}`;
}

export function laneId(road: RoadId, lane: number): LaneId {
  return `${road}#${lane}`;
}

export function movementId(from: LaneId, to: LaneId): MovementId {
  return `${from}>${to}`;
}
