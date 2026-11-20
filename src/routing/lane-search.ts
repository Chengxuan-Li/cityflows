import type { CConnector, CompiledCity } from '../network';
import { laneChangePenaltyS, type routeCosts } from './costs';
import type { RoadGraph } from './graph';
import type { Route, RouteRequest } from './index';
import { reachableLanes, resolveLanes } from './lanes';
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

/** Every lane's edges in compressed rows (TASK-243): lane `l`'s are `start[l]` to
 * `start[l + 1]`, in `laneEdges`' order. */
interface LaneEdgeRows {
  /** Each lane's road. */
  laneRoad: Int32Array;
  start: Int32Array;
  to: Int32Array;
  road: Int32Array;
  penaltyS: Float64Array;
  changeCostS: Float64Array;
  movement: Int32Array;
}

function laneEdgeRows(compiled: CompiledCity, graph: RoadGraph, changeDistanceM: number) {
  const lists = compiled.lanes.map((lane) =>
    laneEdges(
      compiled,
      graph,
      lane.idx,
      Math.max(0, compiled.roads[lane.road]!.lengthM - 10),
      changeDistanceM,
    ),
  );
  const count = lists.reduce((sum, list) => sum + list.length, 0);
  const rows: LaneEdgeRows = {
    laneRoad: Int32Array.from(compiled.lanes, (lane) => lane.road),
    start: new Int32Array(lists.length + 1),
    to: new Int32Array(count),
    road: new Int32Array(count),
    penaltyS: new Float64Array(count),
    changeCostS: new Float64Array(count),
    movement: new Int32Array(count),
  };
  let at = 0;
  lists.forEach((list, lane) => {
    rows.start[lane] = at;
    for (const edge of list) {
      rows.to[at] = edge.to;
      rows.road[at] = edge.road;
      rows.penaltyS[at] = edge.penaltyS;
      rows.changeCostS[at] = edge.changeCostS;
      rows.movement[at++] = edge.movement;
    }
  });
  rows.start[lists.length] = at;
  return rows;
}

export function createLaneSearch(changeDistanceM: number) {
  const shortestPath = createPathSearch();
  // Graph identity already includes compiled version and vehicle class. The
  // provider owns the lane-change distance, so none of these edges are request-dependent.
  const cache = new WeakMap<RoadGraph, LaneEdgeRows>();
  return (
    compiled: CompiledCity,
    graph: RoadGraph,
    costs: ReturnType<typeof routeCosts>,
    request: RouteRequest,
    destination: CConnector,
    permits: (road: number) => boolean,
  ): Route | null => {
    let rows = cache.get(graph);
    if (!rows) {
      rows = laneEdgeRows(compiled, graph, changeDistanceM);
      cache.set(graph, rows);
    }
    const { laneRoad, start, to, road, penaltyS, changeCostS, movement } = rows;
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
      const entry = node === origin ? request.fromLane : node;
      // Arrival stops at the connector, independently of the budget for leaving this road.
      if (laneRoad[entry] === destinationRoad)
        for (const { lane, changes } of reachableLanes(
          compiled,
          graph.allowed,
          entry,
          destination.positionM,
          changeDistanceM,
          node === origin ? request.fromPosM : 0,
        )) {
          if (lane === destination.lane) relax(goal, changes * laneChangePenaltyS);
        }
      // Fold a run of adjacent changes into the next movement. The shared budget
      // prevents consecutive lane changes from each spending the same road length.
      if (node === origin) {
        for (const edge of originEdges) {
          if (!permits(edge.road)) continue;
          relax(
            edge.to,
            edge.changeCostS + costs.transition(edge.road, edge.penaltyS),
            edge.movement,
          );
        }
        return;
      }
      for (let edge = start[node]!, end = start[node + 1]!; edge < end; edge++) {
        if (!permits(road[edge]!)) continue;
        relax(
          to[edge]!,
          changeCostS[edge]! + costs.transition(road[edge]!, penaltyS[edge]!),
          movement[edge],
        );
      }
    });
    if (!path) return null;

    const movements = path.via.slice(0, -1);
    const targetLanes = movements.map((idx) => [compiled.movements[idx]!.fromLane]);
    targetLanes.push([destination.lane]);
    const roads = targetLanes.map(([lane]) => compiled.lanes[lane!]!.road);
    const lanes = resolveLanes(
      compiled,
      graph,
      roads,
      request,
      destination,
      changeDistanceM,
      movements,
    );
    if (!lanes) throw new Error('Lane search returned an infeasible road chain');
    return { roads, movements, targetLanes: lanes.targetLanes, costS: path.costS };
  };
}
