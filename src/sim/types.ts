import type { CompiledCity } from '../network';
import type { Route } from '../routing';
import type { PlaceId, Scenario, SimParams, TripRequest } from '../schema';

export type VehicleState =
  'queued_origin' | 'driving' | 'queued_destination' | 'completed' | 'failed';
export type FailReason =
  | 'no_route'
  | 'unsupported_mode'
  | 'destination_unreachable'
  | 'stranded'
  | 'no_origin_connector'
  | 'no_destination_connector';

export interface TrafficEngine {
  load(input: {
    compiled: CompiledCity;
    trips: TripRequest[];
    scenario: Scenario;
    params?: Partial<SimParams>;
  }): void;
  step(n?: number): void;
  readonly timeS: number;
  snapshot(): VehicleSnapshot;
  metrics(): Metrics;
  inspect(vehicleId: number): VehicleDetail | null;
  stateHash(): number;
}

export interface VehicleSnapshot {
  timeS: number;
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
  lateralM: Float32Array;
  lane: Int32Array;
  state: Uint8Array;
}

export interface Metrics {
  timeS: number;
  trips: {
    pending: number;
    queuedOrigin: number;
    driving: number;
    queuedDestination: number;
    completed: number;
    failed: number;
  };
  failedByReason: Record<FailReason, number>;
  meanTravelTimeS: number;
  meanDelayS: number;
  roadSpeedRatio: Float32Array;
  stepsPerSecond: number;
  /** Per loaded trip, in input order; materialized only when requested. */
  readonly tripOutcomes?: TripOutcome[];
}

export interface TripOutcome {
  departedS: number | null;
  arrivedS: number | null;
  freeFlowS: number | null;
  failReason: FailReason | null;
}

export interface VehicleDetail {
  id: number;
  tripId: string;
  personId: string | null;
  originPlace: PlaceId;
  destinationPlace: PlaceId;
  state: VehicleState;
  lane: number;
  positionM: number;
  speedMps: number;
  route: Route | null;
  routeReason: 'initial' | 'missed_turn' | 'congestion';
  waitingS: number;
  departedS: number | null;
  arrivedS: number | null;
  failReason: FailReason | null;
}
