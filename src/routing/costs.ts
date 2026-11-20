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
  let entry = compiled.lanes[request.fromLane]!;
  for (let i = step; i < route.movements.length; i++) {
    const movement = compiled.movements[route.movements[i]!]!;
    costS += Math.abs(entry.lane - compiled.lanes[movement.fromLane]!.lane) * laneChangePenaltyS;
    costS += weights.transition(route.roads[i + 1]!, movementPenaltyS(compiled, movement));
    entry = compiled.lanes[movement.toLane]!;
  }
  const destination = compiled.lanes[compiled.connectors[request.toConnector]!.lane]!;
  costS += Math.abs(entry.lane - destination.lane) * laneChangePenaltyS;
  return costS;
}

const FNV_PRIME = 0x01000193;
/** `number:`, the start of `derive`'s key for a number. */
const KEY_PREFIX = [110, 117, 109, 98, 101, 114, 58];
const digits = new Int32Array(10);

/** The hash `createRandom(seed).derive(road)` starts from, folded over the key's prefix. */
function noisePrefix(seed: number) {
  let hash = (seed >>> 0) ^ 0x811c9dc5;
  for (const code of KEY_PREFIX) hash = Math.imul(hash ^ code, FNV_PRIME);
  return hash;
}

/**
 * TASK-243: `createRandom(seed).derive(road).uniform(-1, 1)` from `noisePrefix(seed)`, without
 * building the key string or a generator: the same integer operations on the same numbers (the
 * key's decimal digits, then mulberry32's first draw), so the same value.
 */
function roadNoise(prefix: number, road: number) {
  // A road index is a non-negative integer below 2^31: its digits by integer division.
  let count = 0;
  let rest = road;
  do {
    digits[count++] = rest % 10;
    rest = (rest / 10) | 0;
  } while (rest > 0);
  let hash = prefix;
  while (count > 0) hash = Math.imul(hash ^ (48 + digits[--count]!), FNV_PRIME);
  let t = ((hash >>> 0) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return -1 + (1 - -1) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
}

/** Per-road noise factors of one request at a time, kept until the next request (TASK-243:
 * a stamp per road instead of a fresh array filled with NaN per request). */
export interface NoiseMemo {
  factors: Float64Array;
  stamps: Uint32Array;
  stamp: number;
}

export function createNoiseMemo(): NoiseMemo {
  return { factors: new Float64Array(0), stamps: new Uint32Array(0), stamp: 0 };
}

/**
 * The request's cost weights. With a memo, each road's noise factor is computed once for the
 * request (the memo serves one request at a time); without one it is computed at each use.
 * `check` compares every factor with the generator's own draw and throws on a difference.
 */
export function routeCosts(
  compiled: CompiledCity,
  costs: LinkCosts,
  request: RouteRequest,
  memo?: NoiseMemo,
  check = false,
) {
  const noise = request.noise;
  const prefix = noisePrefix(request.seed);
  let stamp = 0;
  if (memo && noise !== 0) {
    if (memo.stamps.length < compiled.roads.length) {
      memo.factors = new Float64Array(compiled.roads.length);
      memo.stamps = new Uint32Array(compiled.roads.length);
      memo.stamp = 0;
    }
    if (memo.stamp === 0xffffffff) {
      memo.stamps.fill(0);
      memo.stamp = 0;
    }
    stamp = ++memo.stamp;
  }
  const draw = (road: number) => {
    const value = roadNoise(prefix, road);
    if (check && value !== createRandom(request.seed).derive(road).uniform(-1, 1))
      throw new Error(
        `Route noise of road ${road} differs from its generator (seed ${request.seed})`,
      );
    return 1 + noise * value;
  };
  const factor = (road: number) => {
    if (noise === 0) return 1;
    if (!memo) return draw(road);
    if (memo.stamps[road] !== stamp) {
      memo.stamps[road] = stamp;
      memo.factors[road] = draw(road);
    }
    return memo.factors[road]!;
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
