import type { CompiledCity } from '../network';
import { vehicleClasses, type VehicleClass, type VehiclePurpose } from '../schema';
import { createCostCache, routeCosts } from './costs';
import { createGraphCache } from './graph';
import { createLaneSearch } from './lane-search';
import { resolveLanes } from './lanes';
import { createPathSearch } from './search';

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
  avoidApproachRoad?: number;
}

export interface Route {
  roads: number[];
  movements: number[];
  targetLanes: number[][];
  costS: number;
}

export type RouteFailure =
  'no_path' | 'destination_unreachable' | 'lane_infeasible' | 'class_forbidden';
export type RouteResult = { ok: true; route: Route } | { ok: false; reason: RouteFailure };

export interface LinkCosts {
  roadTravelTimeS: Float64Array;
  version: number;
}

export interface RouteProvider {
  route(compiled: CompiledCity, costs: LinkCosts, req: RouteRequest): RouteResult;
}

export interface RoutingParams {
  laneChangeDistanceM?: number;
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

export function createRouteProvider({
  laneChangeDistanceM = 30,
}: RoutingParams = {}): RouteProvider {
  const graphFor = createGraphCache();
  const costsFor = createCostCache();
  const searchLanes = createLaneSearch(laneChangeDistanceM);
  const shortestPath = createPathSearch();
  return {
    route(compiled, costs, request) {
      const destination = compiled.connectors[request.toConnector];
      if (!destination || destination.direction === 'out') {
        return { ok: false, reason: 'destination_unreachable' };
      }
      const graph = graphFor(compiled, request.vehicleClass);
      if (!graph.allowed[request.fromLane] || !graph.allowed[destination.lane]) {
        return { ok: false, reason: 'class_forbidden' };
      }
      const from = compiled.lanes[request.fromLane]!.road;
      const to = compiled.lanes[destination.lane]!.road;
      const permits = roadAccessFilter(compiled, request);
      if (!permits(from) || !permits(to)) return { ok: false, reason: 'class_forbidden' };
      const visits = (road: number) => road !== request.avoidApproachRoad && permits(road);
      const weights = routeCosts(compiled, costsFor(costs), request);
      const path = shortestPath(
        compiled.roads.length,
        from,
        to,
        weights.originCost,
        (road, relax) => {
          for (const edge of graph.roads[road]!)
            if (visits(edge.to)) relax(edge.to, weights.transition(edge.to, edge.penaltyS));
        },
      );
      if (!path) {
        const unrestricted = graphFor(compiled, null);
        const connected = shortestPath(compiled.roads.length, from, to, 0, (road, relax) => {
          for (const edge of unrestricted.roads[road]!)
            if (edge.to !== request.avoidApproachRoad) relax(edge.to, 1);
        });
        return { ok: false, reason: connected ? 'class_forbidden' : 'no_path' };
      }

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

      const route = searchLanes(compiled, graph, weights, request, destination, visits);
      if (route) return { ok: true, route };
      const withoutAccess = searchLanes(
        compiled,
        graphFor(compiled, null),
        weights,
        request,
        destination,
        (road) => road !== request.avoidApproachRoad,
      );
      return { ok: false, reason: withoutAccess ? 'class_forbidden' : 'lane_infeasible' };
    },
  };
}
export * from './walk';
