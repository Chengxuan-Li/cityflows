import type { CConnector, CompiledCity } from '../network';
import { laneChangePenaltyS, type routeCosts } from './costs';
import type { RoadGraph } from './graph';
import type { Route, RouteRequest } from './index';
import { reachableLanes } from './lanes';
import { createPathSearch } from './search';

interface LaneEdge {
  to: number;
  road: number;
  penaltyS: number;
  changeCostS: number;
  movement: number;
}

function laneEdges(
  compiled: CompiledCity,
  graph: RoadGraph,
  lane: number,
  endM: number,
  changeDistanceM: number,
  startM = 0,
): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (const reachable of reachableLanes(
    compiled,
    graph.allowed,
    lane,
    endM,
    changeDistanceM,
    startM,
  )) {
    for (const idx of graph.outgoing[reachable.lane]!) {
      const movement = compiled.movements[idx]!;
      edges.push({
        to: movement.toLane,
        road: compiled.lanes[movement.toLane]!.road,
        penaltyS: graph.penalties[idx]!,
        changeCostS: reachable.changes * laneChangePenaltyS,
        movement: idx,
      });
    }
  }
  return edges;
}

export function createLaneSearch(changeDistanceM: number) {
  const shortestPath = createPathSearch();
  // Graph identity already includes compiled version and vehicle class. The
  // provider owns the lane-change distance, so none of these edges are request-dependent.
  const cache = new WeakMap<RoadGraph, LaneEdge[][]>();
  return (
    compiled: CompiledCity,
    graph: RoadGraph,
    costs: ReturnType<typeof routeCosts>,
    request: RouteRequest,
    destination: CConnector,
    permits: (road: number) => boolean,
  ): Route | null => {
    let outgoing = cache.get(graph);
    if (!outgoing) {
      outgoing = compiled.lanes.map((lane) =>
        laneEdges(
          compiled,
          graph,
          lane.idx,
          Math.max(0, compiled.roads[lane.road]!.lengthM - 10),
          changeDistanceM,
        ),
      );
      cache.set(graph, outgoing);
    }
    // Distinguish the partial origin lane from later entries at the start of that lane.
    const origin = compiled.lanes.length;
    const goal = origin + 1;
    const originLane = compiled.lanes[request.fromLane]!;
    const originEdges = laneEdges(
      compiled,
      graph,
      originLane.idx,
      originLane.lengthM,
      changeDistanceM,
      request.fromPosM,
    );
    const destinationRoad = compiled.lanes[destination.lane]!.road;
    const path = shortestPath(goal + 1, origin, goal, costs.originCost, (node, relax) => {
      const entry = compiled.lanes[node === origin ? request.fromLane : node]!;
      const positionM = node === origin ? request.fromPosM : 0;
      // Arrival stops at the connector, independently of the budget for leaving this road.
      if (entry.road === destinationRoad)
        for (const { lane, changes } of reachableLanes(
          compiled,
          graph.allowed,
          entry.idx,
          destination.positionM,
          changeDistanceM,
          positionM,
        )) {
          if (lane === destination.lane) relax(goal, changes * laneChangePenaltyS);
        }
      // Fold a run of adjacent changes into the next movement. The shared budget
      // prevents consecutive lane changes from each spending the same road length.
      for (const edge of node === origin ? originEdges : outgoing[node]!) {
        if (!permits(edge.road)) continue;
        relax(
          edge.to,
          edge.changeCostS + costs.transition(edge.road, edge.penaltyS),
          edge.movement,
        );
      }
    });
    if (!path) return null;

    const movements = path.via.slice(0, -1);
    const targetLanes = movements.map((idx) => [compiled.movements[idx]!.fromLane]);
    targetLanes.push([destination.lane]);
    const roads = targetLanes.map(([lane]) => compiled.lanes[lane!]!.road);
    return { roads, movements, targetLanes, costS: path.costS };
  };
}
