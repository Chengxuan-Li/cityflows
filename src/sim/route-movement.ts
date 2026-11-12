import type { CConnector, CompiledCity } from '../network';
import { movementPenaltyS, reachableLanes, type Route } from '../routing';

/** Resolve the route's next road from the lane the driver actually occupies. */
export function routeMovement(
  city: CompiledCity,
  route: Route,
  step: number,
  lane: number,
  allowed: boolean[],
  destination: CConnector,
  laneChangeDistanceM: number,
  permits: (road: number) => boolean,
) {
  const planned = city.movements[route.movements[step] ?? -1];
  if (planned?.fromLane === lane && allowed[planned.toLane]) return planned.idx;
  let penalty = Infinity,
    alternate = -1;
  for (const idx of city.lanes[lane]!.out) {
    const movement = city.movements[idx]!,
      next = city.lanes[movement.toLane]!;
    if (
      movement.neverGreen ||
      !allowed[movement.toLane] ||
      !permits(next.road) ||
      next.road !== route.roads[step + 1] ||
      !route.targetLanes[step]?.includes(lane)
    )
      continue;
    const cost = movementPenaltyS(city, movement);
    if (cost > penalty || (cost === penalty && idx > alternate)) continue;
    const finalRoad = step + 1 === route.roads.length - 1;
    const targets = finalRoad ? [destination.lane] : route.targetLanes[step + 1]!;
    // Compact junction links can be shorter than the usual 10 m lane-change margin.
    const cutoff = finalRoad
      ? destination.positionM
      : Math.max(0, city.roads[next.road]!.lengthM - 10);
    for (const candidate of reachableLanes(city, allowed, next.idx, cutoff, laneChangeDistanceM)) {
      if (!targets.includes(candidate.lane)) continue;
      penalty = cost;
      alternate = idx;
      break;
    }
  }
  return alternate;
}
