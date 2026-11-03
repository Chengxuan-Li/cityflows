import type { CConnector, CompiledCity } from '../network';
import { laneChangePenaltyS, type routeCosts } from './costs';
import type { RoadGraph } from './graph';
import type { Route, RouteRequest } from './index';
import { reachableLanes } from './lanes';
import { shortestPath } from './search';

export function searchLanes(
  compiled: CompiledCity,
  graph: RoadGraph,
  costs: ReturnType<typeof routeCosts>,
  request: RouteRequest,
  destination: CConnector,
  changeDistanceM: number,
): Route | null {
  // Distinguish the partial origin lane from later entries at the start of that lane.
  const origin = compiled.lanes.length;
  const goal = origin + 1;
  const path = shortestPath(goal + 1, origin, goal, costs.originCost, (node, relax) => {
    const entry = compiled.lanes[node === origin ? request.fromLane : node]!;
    const positionM = node === origin ? request.fromPosM : 0;
    // Fold a run of adjacent changes into the next movement. The shared budget
    // prevents consecutive lane changes from each spending the same road length.
    for (const { lane, changes } of reachableLanes(
      compiled,
      graph.allowed,
      entry.idx,
      entry.lengthM,
      changeDistanceM,
      positionM,
    )) {
      const changeCost = changes * laneChangePenaltyS;
      if (
        lane === destination.lane &&
        changes * changeDistanceM <= destination.positionM - positionM
      ) {
        relax(goal, changeCost);
      }
      for (const idx of graph.outgoing[lane]!) {
        const movement = compiled.movements[idx]!;
        const toRoad = compiled.lanes[movement.toLane]!.road;
        relax(movement.toLane, changeCost + costs.transition(toRoad, graph.penalties[idx]!), idx);
      }
    }
  });
  if (!path) return null;

  const movements = path.via.slice(0, -1);
  const targetLanes = movements.map((idx) => [compiled.movements[idx]!.fromLane]);
  targetLanes.push([destination.lane]);
  const roads = targetLanes.map(([lane]) => compiled.lanes[lane!]!.road);
  return { roads, movements, targetLanes, costS: path.costS };
}
