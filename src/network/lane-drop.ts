import type { CLane, CMovement, CompiledCity } from './types';

const continuing = (turn: CMovement['turn']) =>
  turn === 'through' || turn === 'merge' || turn === 'diverge';

/** The lane's through, merge or diverge movement into `nextRoad`, if it has one. */
function continuation(city: CompiledCity, lane: CLane, nextRoad: number) {
  for (const idx of lane.out) {
    const movement = city.movements[idx]!;
    if (continuing(movement.turn) && city.lanes[movement.toLane]!.road === nextRoad)
      return movement;
  }
  return undefined;
}

/**
 * Clamped/fallback movements remain compiled, but a narrowing requires an upstream merge.
 * A lane is dropped before a narrower `nextRoad` by its ordinal among the lanes of its road
 * that continue into it (through, merge or diverge), counted from the median for through and
 * from the curb for merge and diverge; lanes that only turn elsewhere do not count (TASK-076).
 */
export function isDroppedLane(city: CompiledCity, lane: CLane, nextRoad: number): boolean {
  const movement = continuation(city, lane, nextRoad);
  if (!movement) return false;
  const feeders = city.roads[lane.road]!.lanes.filter(
    (idx) => continuation(city, city.lanes[idx]!, nextRoad) !== undefined,
  );
  const width = city.roads[nextRoad]!.lanes.length;
  if (width >= feeders.length) return false;
  const fromLeft =
    movement.turn === 'through' ? city.drivingSide === 'right' : city.drivingSide === 'left';
  const rank = feeders.indexOf(lane.idx);
  return (fromLeft ? rank : feeders.length - 1 - rank) >= width;
}

export function isLaneDrop(city: CompiledCity, movement: CMovement): boolean {
  return (
    continuing(movement.turn) &&
    isDroppedLane(city, city.lanes[movement.fromLane]!, city.lanes[movement.toLane]!.road)
  );
}
