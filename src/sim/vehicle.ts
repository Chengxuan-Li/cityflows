import type { Route } from '../routing';
import type { FailReason } from './types';

// State codes 1 and 2 are also the snapshot's visible states.
export const tripStates = [
  'pending',
  'driving',
  'queuedDestination',
  'queuedOrigin',
  'completed',
  'failed',
] as const;
export const [PENDING, DRIVING, QUEUED_DESTINATION, QUEUED_ORIGIN, COMPLETED, FAILED] = [
  0, 1, 2, 3, 4, 5,
] as const;
export type TripState =
  | typeof PENDING
  | typeof DRIVING
  | typeof QUEUED_DESTINATION
  | typeof QUEUED_ORIGIN
  | typeof COMPLETED
  | typeof FAILED;

export function createVehicles(count: number, laneCount: number, movementCount: number) {
  const indices = () => new Int32Array(count).fill(-1);
  const numbers = () => new Float64Array(count);
  const lane = indices();
  const position = numbers();
  const head = new Int32Array(laneCount + movementCount).fill(-1);
  const tail = head.slice();
  const next = indices();
  const previous = indices();
  const segment = (laneField: number) => (laneField >= 0 ? laneField : laneCount - 1 - laneField);

  // Lists are ordered front to back. Travel preserves that order within each segment.
  function insert(id: number, laneField: number, positionM: number) {
    const bucket = segment(laneField);
    lane[id] = laneField;
    position[id] = positionM;
    let behind = -1;
    let ahead = tail[bucket]!;
    while (ahead !== -1 && position[ahead]! < positionM) {
      behind = ahead;
      ahead = previous[ahead]!;
    }
    next[id] = behind;
    previous[id] = ahead;
    if (ahead === -1) head[bucket] = id;
    else next[ahead] = id;
    if (behind === -1) tail[bucket] = id;
    else previous[behind] = id;
  }

  function remove(id: number) {
    const bucket = segment(lane[id]!);
    const ahead = previous[id]!;
    const behind = next[id]!;
    if (ahead === -1) head[bucket] = behind;
    else next[ahead] = behind;
    if (behind === -1) tail[bucket] = ahead;
    else previous[behind] = ahead;
  }

  return {
    count,
    lane,
    position,
    head,
    next,
    previous,
    insert,
    remove,
    first: (laneField: number) => head[segment(laneField)]!,
    last: (laneField: number) => tail[segment(laneField)]!,
    state: new Uint8Array(count),
    speed: numbers(),
    speedFactor: numbers(),
    routeSeed: new Uint32Array(count),
    route: Array<Route | null>(count).fill(null),
    routeStep: new Uint32Array(count),
    missedTurn: new Uint8Array(count),
    attemptedFallbacks: Array<Set<number> | undefined>(count),
    movement: indices(),
    destination: indices(),
    departed: numbers().fill(NaN),
    arrived: numbers().fill(NaN),
    waiting: numbers(),
    junctionWaiting: numbers(),
    stopped: new Uint8Array(count),
    freeFlow: numbers(),
    failReason: Array<FailReason | null>(count).fill(null),
  };
}

export type Vehicles = ReturnType<typeof createVehicles>;
