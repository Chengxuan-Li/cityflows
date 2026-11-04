import type { CMovement, CompiledCity } from './types';

/** Clamped/fallback movements remain compiled, but a narrowing requires an upstream merge. */
export function isLaneDrop(city: CompiledCity, movement: CMovement): boolean {
  const lane = city.lanes[movement.fromLane]!;
  const from = city.roads[lane.road]!;
  const to = city.roads[city.lanes[movement.toLane]!.road]!;
  if (
    to.lanes.length >= from.lanes.length ||
    !['through', 'merge', 'diverge'].includes(movement.turn)
  )
    return false;
  const fromLeft =
    movement.turn === 'through' ? city.drivingSide === 'right' : city.drivingSide === 'left';
  const ordinal = fromLeft ? lane.lane : from.lanes.length - 1 - lane.lane;
  return ordinal >= to.lanes.length;
}
