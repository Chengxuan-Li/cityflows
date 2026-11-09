import type { Route } from '../routing';
import { vehicleClasses, type SimParams } from '../schema';
import type { FailReason } from './types';

// State codes 1 and 2 are also the snapshot's visible states.
export const tripStates = [
  'pending',
  'driving',
  'queuedDestination',
  'queuedOrigin',
  'completed',
  'failed',
  'driving', // in_lot participates in the existing driving trip count, without a lane
] as const;
export const IN_LOT = 6;
export const OFF_LANE = -2147483648;
export const [PENDING, DRIVING, QUEUED_DESTINATION, QUEUED_ORIGIN, COMPLETED, FAILED] = [
  0, 1, 2, 3, 4, 5,
] as const;
export type TripState =
  | typeof PENDING
  | typeof DRIVING
  | typeof QUEUED_DESTINATION
  | typeof QUEUED_ORIGIN
  | typeof COMPLETED
  | typeof FAILED
  | typeof IN_LOT;

export function createVehicles(count: number, laneCount: number, movementCount: number) {
  const indices = () => new Int32Array(count).fill(-1);
  const numbers = () => new Float64Array(count);
  const lane = indices();
  const position = numbers();
  let head = new Int32Array(laneCount + movementCount).fill(-1);
  let tail = head.slice();
  const next = indices();
  const previous = indices();
  const segment = (laneField: number) => (laneField >= 0 ? laneField : laneCount - 1 - laneField);
  // Segments holding at least one vehicle, ascending, so per-step passes skip empty ones.
  const occupied: number[] = [];
  function rank(bucket: number) {
    let low = 0;
    let high = occupied.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (occupied[mid]! < bucket) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  // Lists are ordered front to back. Travel preserves that order within each segment.
  function insert(id: number, laneField: number, positionM: number) {
    const bucket = segment(laneField);
    lane[id] = laneField;
    position[id] = positionM;
    if (head[bucket] === -1) occupied.splice(rank(bucket), 0, bucket);
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
    if (head[bucket] === -1) occupied.splice(rank(bucket), 1);
  }

  return {
    count,
    lane,
    position,
    head,
    resetSegments(lanes: number, movements: number) {
      laneCount = lanes;
      head = new Int32Array(lanes + movements).fill(-1);
      this.head = head;
      tail = head.slice();
      next.fill(-1);
      previous.fill(-1);
      occupied.length = 0;
    },
    occupied: occupied as readonly number[],
    next,
    previous,
    insert,
    remove,
    first: (laneField: number) => head[segment(laneField)]!,
    last: (laneField: number) => tail[segment(laneField)]!,
    state: new Uint8Array(count),
    vclass: new Uint8Array(count),
    purpose: new Uint8Array(count),
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
    stopped: new Float64Array(count),
    // TASK-077: time standing still at the head of a jam, and respawns of the trip so far.
    jamS: numbers(),
    headDetourS: numbers(),
    respawns: new Uint8Array(count),
    freeFlow: numbers(),
    failReason: Array<FailReason | null>(count).fill(null),
  };
}

export type Vehicles = ReturnType<typeof createVehicles>;

/** Class-indexed, reused driving parameters; no allocations in per-vehicle step passes. */
export function createVehicleProfiles(params: SimParams) {
  return vehicleClasses.map((name) => {
    const profile = params.vehicleClasses[name];
    return {
      ...profile,
      idm: {
        ...params.idm,
        aMps2: params.idm.aMps2 * profile.accelFactor,
        bMps2: params.idm.bMps2 * profile.decelFactor,
      },
    };
  });
}
