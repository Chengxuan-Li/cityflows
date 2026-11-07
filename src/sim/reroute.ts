import type { CompiledCity } from '../network';
import type { LinkCosts, RouteProvider, RouteRequest } from '../routing';
import { remainingRouteCost } from '../routing/costs';
import { vehicleClasses, vehiclePurposes, type SimParams } from '../schema';
import { COMPLETED, DRIVING, FAILED, type Vehicles } from './vehicle';

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
    vehicleClass: vehicleClasses[vehicles.vclass[id]!]!,
    purpose: vehiclePurposes[vehicles.purpose[id]!]!,
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
  // Min-heap of pending checks keyed by (nextCheck, id). A vehicle holds at most one entry
  // from `start` until it is popped; it is re-queued after each check while it may still
  // switch. Checks are independent within a step, so only due vehicles need a visit.
  const heapKey = new Float64Array(vehicles.count);
  const heapId = new Int32Array(vehicles.count);
  let heapSize = 0;
  // Popped while not driving: the check stays pending until the vehicle drives again, as the
  // scan did; finished vehicles are dropped.
  const deferred: number[] = [];
  const due: number[] = [];
  const edits = new Map<number, { dueS: number; invalid: boolean }>();

  function before(i: number, j: number) {
    return heapKey[i]! < heapKey[j]! || (heapKey[i] === heapKey[j] && heapId[i]! < heapId[j]!);
  }
  function swap(i: number, j: number) {
    const key = heapKey[i]!;
    const id = heapId[i]!;
    heapKey[i] = heapKey[j]!;
    heapId[i] = heapId[j]!;
    heapKey[j] = key;
    heapId[j] = id;
  }
  function push(id: number) {
    let i = heapSize++;
    heapKey[i] = nextCheck[id]!;
    heapId[i] = id;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(i, parent)) break;
      swap(i, parent);
      i = parent;
    }
  }
  function pop() {
    const id = heapId[0]!;
    heapSize--;
    if (heapSize > 0) {
      heapKey[0] = heapKey[heapSize]!;
      heapId[0] = heapId[heapSize]!;
      let i = 0;
      for (;;) {
        let smallest = i;
        const left = 2 * i + 1;
        const right = left + 1;
        if (left < heapSize && before(left, smallest)) smallest = left;
        if (right < heapSize && before(right, smallest)) smallest = right;
        if (smallest === i) break;
        swap(i, smallest);
        i = smallest;
      }
    }
    return id;
  }

  return {
    patch(next: CompiledCity) {
      compiled = next;
    },
    scheduleEdit(id: number, timeS: number, invalid: boolean, immediate: boolean) {
      const phase = ((id + 1) * 0.6180339887498949) % 1;
      const previous = edits.get(id);
      edits.set(id, {
        dueS: Math.min(
          previous?.dueS ?? Infinity,
          timeS + (immediate ? 0 : params.rerouteIntervalS * phase),
        ),
        invalid: invalid || !!previous?.invalid,
      });
    },
    updateEdits(timeS: number, checked: (id: number, failed: boolean) => void) {
      for (const [id, edit] of edits) {
        const state = vehicles.state[id];
        if (state === COMPLETED || state === FAILED) {
          edits.delete(id);
          continue;
        }
        const lane = compiled.lanes[vehicles.lane[id]!];
        if (state !== DRIVING || !lane) continue;
        const route = vehicles.route[id]!;
        const step = vehicles.routeStep[id]!;
        const brokenHere =
          route.roads[step] !== lane.road ||
          route.targetLanes[step]?.length === 0 ||
          route.movements[step] === -1 ||
          compiled.movements[route.movements[step] ?? -1]?.neverGreen;
        if (!brokenHere && timeS + 1e-9 < edit.dueS) continue;
        edits.delete(id);
        const request = vehicleRouteRequest(vehicles, params, id, lane.idx, vehicles.position[id]!);
        const result = provider.route(compiled, costs, request);
        if (!result.ok) {
          if (edit.invalid) checked(id, true);
          continue;
        }
        const sameRoads =
          result.route.roads.length === route.roads.length - step &&
          result.route.roads.every((road, i) => road === route.roads[step + i]);
        if (
          !edit.invalid &&
          (sameRoads ||
            result.route.costS >=
              (1 - params.rerouteHysteresis) *
                remainingRouteCost(compiled, costs, request, route, step))
        )
          continue;
        vehicles.route[id] = result.route;
        vehicles.routeStep[id] = 0;
        checked(id, false);
      }
    },
    start(id: number, timeS: number) {
      // Spread even adjacent vehicle ids across the interval, independently of the RNG stream.
      const phase = ((id + 1) * 0.6180339887498949) % 1;
      nextCheck[id] = timeS + params.rerouteIntervalS * phase;
      push(id);
    },
    update(timeS: number, switched: (id: number) => void) {
      due.length = 0;
      for (let i = 0; i < deferred.length;) {
        const id = deferred[i]!;
        const state = vehicles.state[id];
        if (state === DRIVING) due.push(id);
        if (state === DRIVING || state === COMPLETED || state === FAILED) {
          deferred[i] = deferred[deferred.length - 1]!;
          deferred.pop();
        } else i++;
      }
      while (heapSize > 0 && timeS + 1e-9 >= heapKey[0]!) {
        const id = pop();
        const state = vehicles.state[id];
        if (state === DRIVING) due.push(id);
        else if (state !== COMPLETED && state !== FAILED) deferred.push(id);
      }
      if (due.length > 1) due.sort((a, b) => a - b);
      for (const id of due) {
        if (replans[id]! >= params.maxReplans) continue;
        nextCheck[id] = nextCheck[id]! + params.rerouteIntervalS;
        push(id);
        if (edits.has(id)) continue;
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
