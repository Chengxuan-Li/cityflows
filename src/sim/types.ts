import type { CompiledCity } from '../network';
import type { Route } from '../routing';
import type {
  PlaceId,
  Person,
  Scenario,
  SimParams,
  TripRequest,
  VehicleClass,
  VehiclePurpose,
} from '../schema';
import type { WalkerDetail, WalkerMetrics, WalkerSnapshot } from './walkers';
import type { PersonDetail, PersonMetrics } from './persons';
import type { RailSnapshot } from './rail-crossings';
export type { RailSnapshot } from './rail-crossings';
export { CROSSING_OPEN, CROSSING_WARNING, CROSSING_CLOSED } from './rail-crossings';
export type { PersonDetail, PersonMetrics, PersonLegDetail, PersonTripDetail } from './persons';

export type { WalkerDetail, WalkerMetrics, WalkerSnapshot } from './walkers';

export type VehicleState =
  'queued_origin' | 'driving' | 'queued_destination' | 'completed' | 'failed' | 'in_lot';
export type FailReason =
  | 'no_route'
  | 'no_walk_route'
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
    population?: Person[];
  }): void;
  patch(compiled: CompiledCity): PatchResult;
  step(n?: number): void;
  readonly timeS: number;
  snapshot(): VehicleSnapshot;
  metrics(): Metrics;
  inspect(vehicleId: number): VehicleDetail | null;
  /** TASK-111: a test pedestrian, by its snapshot id. */
  inspectWalker(walkerId: number): WalkerDetail | null;
  inspectPerson(personId: string): PersonDetail | null;
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

export interface ParkingClaimsSnapshot {
  /** Dense trip order, -1 for no claim. Soft garages do not need claims. */
  facility: Int32Array;
  space: Int32Array;
  sinceS: Float64Array;
}

export interface VehicleSnapshot {
  rail?: RailSnapshot;
  /** >=0: authoritative parking pose; value is its reference lane for height/layer. */
  poseLane?: Int32Array;
  parkedCars?: ParkedCarsSnapshot;
  parkingOccupancy?: Uint32Array;
  parkingClaims?: ParkingClaimsSnapshot;
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
    /** Arrivals with a later car trip that parked without a usable departure. */
    parkedWithoutExit: number;
    meanSearchTimeS: number;
    failed: number;
    claims?: {
      active: number;
      entryRejections: number;
      simultaneousStripChoices: number;
      rejectedEntries: { facility: string; kind: string; space: number | null; count: number }[];
      stripHeld: {
        count: number;
        totalS: number;
        meanS: number;
        p50S: number;
        p90S: number;
        p95S: number;
        p99S: number;
        maxS: number;
        longest: { vehicleId: number; facility: string; space: number; heldS: number }[];
      };
    };
    motion?: {
      meanEntryToParkS: number;
      meanLotDriveS: number;
      meanLotLeaveS: number;
      stripManoeuvresPerHour: number;
      meanStallChoiceRank: number;
    };
    /** TASK-129: household cars parking at their home, how far from it, and every car that
     * parked beyond `homeParkingRadiusM` with its reason. */
    home?: {
      arrivals: number;
      medianM: number;
      p90M: number;
      maxM: number;
      beyondRadius: { tripId: string; facility: string; distanceM: number; reason: string }[];
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
  persons?: PersonMetrics;
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
  parkingPhase?: 'drive_in' | 'park' | 'leave' | 'drive_out' | 'exit' | 'merge' | null;
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
