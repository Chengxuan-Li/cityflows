import type { CompiledCity } from '../network';
import type { Route } from '../routing';
import type {
  PlaceId,
  Scenario,
  SimParams,
  TripRequest,
  VehicleClass,
  VehiclePurpose,
} from '../schema';
import type { WalkerDetail, WalkerMetrics, WalkerSnapshot } from './walkers';

export type { WalkerDetail, WalkerMetrics, WalkerSnapshot } from './walkers';

export type VehicleState =
  'queued_origin' | 'driving' | 'queued_destination' | 'completed' | 'failed' | 'in_lot';
export type FailReason =
  | 'no_route'
  | 'unsupported_mode'
  | 'destination_unreachable'
  | 'stranded'
  | 'no_origin_connector'
  | 'no_destination_connector'
  | 'gridlocked'
  | 'no_parking';

export interface TrafficEngine {
  load(input: {
    compiled: CompiledCity;
    trips: TripRequest[];
    scenario: Scenario;
    params?: Partial<SimParams>;
  }): void;
  patch(compiled: CompiledCity): PatchResult;
  step(n?: number): void;
  readonly timeS: number;
  snapshot(): VehicleSnapshot;
  metrics(): Metrics;
  inspect(vehicleId: number): VehicleDetail | null;
  /** TASK-111: a test pedestrian, by its snapshot id. */
  inspectWalker(walkerId: number): WalkerDetail | null;
  stateHash(): number;
}

export interface PatchResult {
  version: number;
  relocated: number;
  stranded: number;
  rerouted: number;
}

export interface ParkedCarsSnapshot {
  revision?: number;
  occupied: Uint8Array;
  vclass: Uint8Array;
  id: Uint32Array;
  hues: Uint32Array;
}

export interface VehicleSnapshot {
  /** >=0: authoritative parking pose; value is its reference lane for height/layer. */
  poseLane?: Int32Array;
  parkedCars?: ParkedCarsSnapshot;
  parkingOccupancy?: Uint32Array;
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
  vclass: Uint8Array;
  /** TASK-077: 1, or falling to 0 over the last `gridlock.fadeS` before a respawn. */
  fade: Float32Array;
  /** TASK-111: walkers on the way, present when the scenario has test pedestrians. */
  walkers?: WalkerSnapshot;
}

export interface Metrics {
  parking: {
    facilities: { id: string; occupied: number; capacity: number }[];
    parked: number;
    arrivals: number;
    meanSearchTimeS: number;
    failed: number;
    motion?: {
      meanEntryToParkS: number;
      meanLotDriveS: number;
      meanLotLeaveS: number;
      stripManoeuvresPerHour: number;
      meanStallChoiceRank: number;
    };
  };
  completedByClass: Record<VehicleClass, number>;
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
  /** Committed displacements clamped at occupied conflict-zone starts. */
  zoneStops: number;
  /** TASK-077: respawns over all trips. */
  respawns: number;
  /** TASK-111: present when the scenario has test pedestrians. */
  walkers?: WalkerMetrics;
  /** Per loaded trip, in input order; materialized only when requested. */
  readonly tripOutcomes?: TripOutcome[];
}

export interface TripOutcome {
  parkingFacility: string | null;
  walkingDistanceM: number;
  parkingSearchTimeS: number;
  departedS: number | null;
  arrivedS: number | null;
  freeFlowS: number | null;
  failReason: FailReason | null;
  respawns: number;
}

export interface VehicleDetail {
  parkingPhase?: 'drive_in' | 'park' | 'leave' | 'drive_out' | 'exit' | null;
  parkingSpace?: number | null;
  stallChoice?: { rank: number; scoreM: number; bestScoreM: number } | null;
  parkingFacility: string | null;
  walkingDistanceM: number;
  parkingSearchTimeS: number;
  vehicleClass: VehicleClass;
  purpose: VehiclePurpose;
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
  routeReason: 'initial' | 'missed_turn' | 'congestion' | 'edit' | 'respawn' | 'parking';
  waitingS: number;
  departedS: number | null;
  arrivedS: number | null;
  failReason: FailReason | null;
  respawns: number;
}
