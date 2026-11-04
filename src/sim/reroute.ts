import type { CompiledCity } from '../network';
import type { LinkCosts, RouteProvider, RouteRequest } from '../routing';
import { remainingRouteCost } from '../routing/costs';
import type { SimParams } from '../schema';
import { DRIVING, type Vehicles } from './vehicle';

export function vehicleRouteRequest(
  vehicles: Vehicles,
  params: SimParams,
  id: number,
  lane: number,
  positionM: number,
): RouteRequest {
  return {
    fromLane: lane,
    fromPosM: positionM,
    toConnector: vehicles.destination[id]!,
    vehicleClass: 'car',
    desiredSpeedFactor: vehicles.speedFactor[id]!,
    noise: params.routeNoise,
    seed: vehicles.routeSeed[id]!,
  };
}

export function createRerouter(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  provider: RouteProvider,
  costs: LinkCosts,
) {
  const replans = new Uint32Array(vehicles.count);
  const nextCheck = new Float64Array(vehicles.count).fill(Infinity);
  return {
    start(id: number, timeS: number) {
      // Spread even adjacent vehicle ids across the interval, independently of the RNG stream.
      const phase = ((id + 1) * 0.6180339887498949) % 1;
      nextCheck[id] = timeS + params.rerouteIntervalS * phase;
    },
    update(timeS: number, switched: (id: number) => void) {
      for (let id = 0; id < vehicles.count; id++) {
        if (
          vehicles.state[id] !== DRIVING ||
          replans[id]! >= params.maxReplans ||
          timeS + 1e-9 < nextCheck[id]!
        )
          continue;
        nextCheck[id] = nextCheck[id]! + params.rerouteIntervalS;
        const lane = compiled.lanes[vehicles.lane[id]!];
        if (!lane || lane.lengthM - vehicles.position[id]! <= params.intersection.decisionDistanceM)
          continue;
        const route = vehicles.route[id]!;
        const step = vehicles.routeStep[id]!;
        const request = vehicleRouteRequest(vehicles, params, id, lane.idx, vehicles.position[id]!);
        const result = provider.route(compiled, costs, request);
        if (!result.ok) continue;
        const sameRoads =
          result.route.roads.length === route.roads.length - step &&
          result.route.roads.every((road, i) => road === route.roads[step + i]);
        if (
          sameRoads ||
          result.route.costS >=
            (1 - params.rerouteHysteresis) *
              remainingRouteCost(compiled, costs, request, route, step)
        )
          continue;
        vehicles.route[id] = result.route;
        vehicles.routeStep[id] = 0;
        replans[id] = replans[id]! + 1;
        switched(id);
      }
    },
  };
}
