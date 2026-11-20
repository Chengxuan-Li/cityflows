import type { CompiledCity } from '../network';
import { vehicleClasses, type VehicleClass, type VehiclePurpose } from '../schema';
import { createCostCache, createNoiseMemo, routeCosts } from './costs';
import {
  ACCESS_DELIVERY,
  ACCESS_YES,
  ACCESS_ZONE,
  createGraphCache,
  type RoadGraph,
} from './graph';
import { createLaneSearch } from './lane-search';
import { resolveLanes } from './lanes';
import { createPathSearch } from './search';
import { parkingConnectorPermitted } from '../network/parking';

export { freeFlowLinkCosts, movementPenaltyS } from './costs';
export { reachableLanes } from './lanes';

export interface RouteRequest {
  fromLane: number;
  fromPosM: number;
  toConnector: number;
  vehicleClass: VehicleClass;
  purpose?: VehiclePurpose;
  desiredSpeedFactor: number;
  noise: number;
  seed: number;
}

export interface Route {
  roads: number[];
  movements: number[];
  targetLanes: number[][];
  costS: number;
}

export type RouteFailure =
  'no_path' | 'destination_unreachable' | 'lane_infeasible' | 'class_forbidden';
export type RouteResult =
  | { ok: true; route: Route }
  | { ok: false; reason: RouteFailure }
  /** TASK-251: only with `boundS`, when no route the request can return costs less. */
  | { ok: false; reason: 'above_bound' };

export interface LinkCosts {
  roadTravelTimeS: Float64Array;
  version: number;
}

export interface RouteProvider {
  /** `boundS` (TASK-251): the caller needs the route only if it costs less. When the road
   * search's cost, a lower bound for every route the request can return, is at or above it, the
   * provider may return `above_bound` instead of resolving lanes and searching them. */
  route(compiled: CompiledCity, costs: LinkCosts, req: RouteRequest, boundS?: number): RouteResult;
}

export interface RoutingParams {
  laneChangeDistanceM?: number;
  /** TASK-243: check each request's access filter and noise factors against their plain
   * computation and throw on a difference (the engine's `debugSkips`). */
  checkSkips?: boolean;
}

export function roadAccessFilter(compiled: CompiledCity, request: RouteRequest) {
  const kind = vehicleClasses.indexOf(request.vehicleClass);
  const from = compiled.lanes[request.fromLane]!.road;
  const to = compiled.lanes[compiled.connectors[request.toConnector]!.lane]!.road;
  const originZone = compiled.roads[from]!.zone[kind]!;
  const destinationZone = compiled.roads[to]!.zone[kind]!;
  return (idx: number) => {
    const road = compiled.roads[idx]!;
    const rule = road.access[kind]!;
    if (rule === 'delivery') return request.purpose === 'delivery';
    if (rule === 'destination' || rule === 'private')
      return road.zone[kind] === originZone || road.zone[kind] === destinationZone;
    return rule === 'yes';
  };
}

/** `roadAccessFilter` read from the class graph's access and zone arrays (TASK-243). */
function graphAccessFilter(graph: RoadGraph, request: RouteRequest, from: number, to: number) {
  const { access, zone } = graph;
  const delivery = request.purpose === 'delivery';
  const originZone = zone[from]!;
  const destinationZone = zone[to]!;
  return (idx: number) => {
    const rule = access[idx];
    if (rule === ACCESS_YES) return true;
    if (rule === ACCESS_ZONE) return zone[idx] === originZone || zone[idx] === destinationZone;
    return rule === ACCESS_DELIVERY && delivery;
  };
}

export function createRouteProvider({
  laneChangeDistanceM = 30,
  checkSkips = false,
}: RoutingParams = {}): RouteProvider {
  const graphFor = createGraphCache();
  const costsFor = createCostCache();
  const searchLanes = createLaneSearch(laneChangeDistanceM);
  const shortestPath = createPathSearch();
  const noise = createNoiseMemo();
  return {
    route(compiled, costs, request, boundS) {
      const destination = compiled.connectors[request.toConnector];
      if (!destination || destination.direction === 'out') {
        return { ok: false, reason: 'destination_unreachable' };
      }
      if (
        !parkingConnectorPermitted(
          compiled,
          destination.idx,
          request.vehicleClass,
          request.purpose,
          'in',
        )
      )
        return { ok: false, reason: 'class_forbidden' };
      const graph = graphFor(compiled, request.vehicleClass);
      if (!graph.allowed[request.fromLane] || !graph.allowed[destination.lane]) {
        return { ok: false, reason: 'class_forbidden' };
      }
      const from = compiled.lanes[request.fromLane]!.road;
      const to = compiled.lanes[destination.lane]!.road;
      const fast = graphAccessFilter(graph, request, from, to);
      const plain = checkSkips ? roadAccessFilter(compiled, request) : null;
      const permits = plain
        ? (idx: number) => {
            if (fast(idx) !== plain(idx))
              throw new Error(`Access filter differs on road ${idx} for ${request.vehicleClass}`);
            return plain(idx);
          }
        : fast;
      if (!permits(from) || !permits(to)) return { ok: false, reason: 'class_forbidden' };
      const weights = routeCosts(compiled, costsFor(costs), request, noise, checkSkips);
      const { edgeStart, edgeTo, edgePenalty } = graph;
      const path = shortestPath(
        compiled.roads.length,
        from,
        to,
        weights.originCost,
        (road, relax) => {
          for (let edge = edgeStart[road]!, end = edgeStart[road + 1]!; edge < end; edge++) {
            const next = edgeTo[edge]!;
            if (permits(next)) relax(next, weights.transition(next, edgePenalty[edge]!));
          }
        },
      );
      if (!path) {
        const unrestricted = graphFor(compiled, null);
        const connected = shortestPath(compiled.roads.length, from, to, 0, (road, relax) => {
          const end = unrestricted.edgeStart[road + 1]!;
          for (let edge = unrestricted.edgeStart[road]!; edge < end; edge++)
            relax(unrestricted.edgeTo[edge]!, 1);
        });
        return { ok: false, reason: connected ? 'class_forbidden' : 'no_path' };
      }

      // Every lane-search edge pays its road's cheapest movement or a dearer one, plus lane
      // changes, with the same weights and the same additions: never less than the road search.
      if (boundS !== undefined && path.costS >= boundS) return { ok: false, reason: 'above_bound' };

      const roads = path.nodes;
      const lanes = resolveLanes(compiled, graph, roads, request, destination, laneChangeDistanceM);
      // The road search is a lower bound. It is exact only when the chosen chain needs
      // no lane changes and uses the cheapest movements; otherwise search arrival lanes
      // so each expansion pays for the changes it can actually make on that road.
      if (lanes) {
        let entry = request.fromLane;
        let exactCost = weights.originCost;
        let unchanged = true;
        for (const idx of lanes.movements) {
          const movement = compiled.movements[idx]!;
          unchanged &&= entry === movement.fromLane;
          entry = movement.toLane;
          exactCost += weights.transition(compiled.lanes[entry]!.road, graph.penalties[idx]!);
        }
        if (unchanged && entry === destination.lane && exactCost === path.costS)
          return { ok: true, route: { roads, ...lanes, costS: path.costS } };
      }

      const route = searchLanes(compiled, graph, weights, request, destination, permits);
      if (checkSkips && route && route.costS < path.costS)
        throw new Error(
          `Lane search costs ${route.costS} s, below its road search's ${path.costS} s`,
        );
      if (route) return { ok: true, route };
      const withoutAccess = searchLanes(
        compiled,
        graphFor(compiled, null),
        weights,
        request,
        destination,
        () => true,
      );
      return { ok: false, reason: withoutAccess ? 'class_forbidden' : 'lane_infeasible' };
    },
  };
}
export * from './walk';
