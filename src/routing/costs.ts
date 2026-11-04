import { createRandom } from '../geo/random';
import type { CMovement, CompiledCity, Turn } from '../network';
import type { LinkCosts, Route, RouteRequest } from './index';

const turnPenaltyS: Record<Turn, number> = {
  through: 2,
  right: 4,
  left: 8,
  uturn: 15,
  merge: 3,
  diverge: 2,
};

export const laneChangePenaltyS = 3;

export function movementPenaltyS(compiled: CompiledCity, movement: CMovement): number {
  const control = compiled.nodes[movement.node]!.control;
  // The compiler encodes minor approaches with rank zero (priority = rank * 10 + turn rank).
  const minor = movement.priority < 10;
  const controlPenalty =
    control === 'signal'
      ? 10
      : minor && control === 'stop'
        ? 4
        : minor && control === 'yield'
          ? 2
          : 0;
  return turnPenaltyS[movement.turn] + controlPenalty;
}

export function freeFlowLinkCosts(compiled: CompiledCity): LinkCosts {
  return {
    roadTravelTimeS: Float64Array.from(compiled.roads, (road) => road.lengthM / road.speedLimitMps),
    version: 0,
  };
}

export function createCostCache() {
  const cache = new WeakMap<LinkCosts, LinkCosts>();
  return (costs: LinkCosts): LinkCosts => {
    let entry = cache.get(costs);
    if (entry?.version !== costs.version) {
      entry = { version: costs.version, roadTravelTimeS: costs.roadTravelTimeS.slice() };
      cache.set(costs, entry);
    }
    return entry;
  };
}

export function remainingRouteCost(
  compiled: CompiledCity,
  costs: LinkCosts,
  request: RouteRequest,
  route: Route,
  step: number,
) {
  const weights = routeCosts(compiled, costs, request);
  let costS = weights.originCost;
  for (let i = step; i < route.movements.length; i++) {
    costS += weights.transition(
      route.roads[i + 1]!,
      movementPenaltyS(compiled, compiled.movements[route.movements[i]!]!),
    );
  }
  return costS;
}

export function routeCosts(compiled: CompiledCity, costs: LinkCosts, request: RouteRequest) {
  const noise = request.noise;
  const random = createRandom(request.seed);
  const factors = noise === 0 ? null : new Float64Array(compiled.roads.length).fill(NaN);
  const factor = (road: number) => {
    if (!factors) return 1;
    if (Number.isNaN(factors[road])) factors[road] = 1 + noise * random.derive(road).uniform(-1, 1);
    return factors[road]!;
  };

  const origin = compiled.lanes[request.fromLane]!;
  const remainingFraction =
    (origin.lengthM - request.fromPosM) / compiled.roads[origin.road]!.lengthM;
  return {
    originCost: costs.roadTravelTimeS[origin.road]! * remainingFraction * factor(origin.road),
    transition: (toRoad: number, penaltyS: number) =>
      (costs.roadTravelTimeS[toRoad]! + penaltyS) * factor(toRoad),
  };
}
