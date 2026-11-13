import type { CompiledCity } from '../network';
import { vehicleClasses, type TripRequest, type VehicleClass } from '../schema';
import type { FailReason, Metrics } from './types';
import type { createParking } from './parking';
import {
  COMPLETED,
  FAILED,
  QUEUED_ORIGIN,
  tripStates,
  type TripState,
  type Vehicles,
} from './vehicle';

export function createAccounting(
  compiled: CompiledCity,
  vehicles: Vehicles,
  parking: ReturnType<typeof createParking>,
  time?: () => number,
  /** TASK-113: the engine's trips, whose modes the mode choice sets as tours depart (TASK-173),
   * for the trip outcomes. */
  requests?: readonly TripRequest[],
) {
  const trips = {
    pending: vehicles.count,
    queuedOrigin: 0,
    driving: 0,
    queuedDestination: 0,
    completed: 0,
    failed: 0,
  };
  const failedByReason: Record<FailReason, number> = {
    no_route: 0,
    no_walk_route: 0,
    unsupported_mode: 0,
    destination_unreachable: 0,
    stranded: 0,
    no_origin_connector: 0,
    no_destination_connector: 0,
    gridlocked: 0,
    no_parking: 0,
  };
  let zoneStops = 0;
  let respawns = 0;
  let totalTravel = 0;
  let totalDelay = 0;
  const completedByClass: Record<VehicleClass, number> = { car: 0, van: 0, truck: 0, bus: 0 };
  let onComplete: ((id: number, timeS: number) => void) | undefined;
  let onFail: ((id: number, reason: FailReason) => void) | undefined;

  function transition(id: number, state: TripState) {
    trips[tripStates[vehicles.state[id] as TripState]]--;
    trips[tripStates[state]]++;
    vehicles.state[id] = state;
  }

  function metrics(timeS: number): Metrics {
    const roadSpeedRatio = new Float32Array(compiled.roads.length).fill(1);
    const speed = new Float64Array(compiled.roads.length);
    const count = new Uint32Array(compiled.roads.length);
    for (const lane of compiled.lanes) {
      for (let id = vehicles.first(lane.idx); id !== -1; id = vehicles.next[id]!) {
        speed[lane.road] = speed[lane.road]! + vehicles.speed[id]!;
        count[lane.road] = count[lane.road]! + 1;
      }
    }
    for (const road of compiled.roads) {
      const n = count[road.idx]!;
      if (n) roadSpeedRatio[road.idx] = speed[road.idx]! / (n * road.speedLimitMps);
    }
    return {
      timeS,
      parking: parking.metrics(failedByReason.no_parking, timeS),
      completedByClass: { ...completedByClass },
      trips: { ...trips },
      failedByReason: { ...failedByReason },
      meanTravelTimeS: trips.completed ? totalTravel / trips.completed : 0,
      meanDelayS: trips.completed ? totalDelay / trips.completed : 0,
      roadSpeedRatio,
      stepsPerSecond: 0,
      zoneStops,
      respawns,
      get tripOutcomes() {
        return Array.from({ length: vehicles.count }, (_, id) => ({
          ...parking.detail(id, timeS),
          departedS: Number.isNaN(vehicles.departed[id]) ? null : vehicles.departed[id]!,
          arrivedS: Number.isNaN(vehicles.arrived[id]) ? null : vehicles.arrived[id]!,
          freeFlowS: Number.isNaN(vehicles.departed[id]) ? null : vehicles.freeFlow[id]!,
          failReason: vehicles.failReason[id]!,
          respawns: vehicles.respawns[id]!,
          mode: requests?.[id]?.mode ?? 'car',
        }));
      },
    };
  }

  return {
    observe(complete: typeof onComplete, fail: typeof onFail) {
      onComplete = complete;
      onFail = fail;
    },
    // Foot trips have outcomes, but do not count as vehicle trips or class completions. TASK-173:
    // a tour that walks leaves its trips' vehicle states as late as its departure.
    excludeWalk(id: number) {
      trips[tripStates[vehicles.state[id] as TripState]]--;
      vehicles.state[id] = COMPLETED;
    },
    finishWalk(id: number, startedS: number, arrivedS: number | null, reason: FailReason | null) {
      vehicles.departed[id] = startedS;
      if (arrivedS !== null) vehicles.arrived[id] = arrivedS;
      vehicles.state[id] = reason ? FAILED : COMPLETED;
      vehicles.failReason[id] = reason;
      if (reason) failedByReason[reason]++;
    },
    patch(next: CompiledCity) {
      compiled = next;
    },
    trips,
    zoneStop() {
      zoneStops++;
    },
    /** A driving trip goes back to its origin queue (TASK-077). */
    respawn(id: number) {
      parking.release(id, time?.());
      transition(id, QUEUED_ORIGIN);
      vehicles.respawns[id]!++;
      respawns++;
    },
    transition,
    metrics,
    fail(id: number, reason: FailReason) {
      parking.release(id, time?.());
      transition(id, FAILED);
      vehicles.failReason[id] = reason;
      failedByReason[reason]++;
      onFail?.(id, reason);
    },
    complete(id: number, timeS: number) {
      parking.release(id, timeS);
      transition(id, COMPLETED);
      completedByClass[vehicleClasses[vehicles.vclass[id]!]!]++;
      vehicles.arrived[id] = timeS;
      const travel = timeS - vehicles.departed[id]!;
      totalTravel += travel;
      totalDelay += travel - vehicles.freeFlow[id]!;
      onComplete?.(id, timeS);
    },
  };
}
