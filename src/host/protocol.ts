import type { CompiledCity } from '../network';
import type { Scenario, TripRequest } from '../schema';
import type { Metrics, PatchResult, VehicleSnapshot } from '../sim/types';

export interface HostPatchResult extends PatchResult {
  timeS: number;
}

export interface MetricsSample {
  timeS: number;
  driving: number;
  queued: number;
  completed: number;
  meanDelayS: number;
}

export interface TrajectoryStatus {
  enabled: boolean;
  count: number;
}

export interface HostSnapshot extends VehicleSnapshot {
  /** Included at most twice per wall second, alongside the matching vehicle positions. */
  roadSpeedRatio?: Float32Array;
}

export interface HeadlessResult {
  series: MetricsSample[];
  metrics: Metrics;
  travelTime: {
    travelTimesS: number[];
    delaysS: number[];
    meanS: number;
    meanDelayS: number;
    p90DelayS: number;
  };
  /** Unique vehicles observed on each road, keyed by canonical road ID. */
  roadVehicleCounts: Record<string, number>;
}

export type HostRequest =
  | { id: number; type: 'load'; compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario }
  | { id: number; type: 'patch'; compiled: CompiledCity }
  | { id: number; type: 'play' }
  | { id: number; type: 'pause' }
  | { id: number; type: 'setSpeed'; multiplier: number }
  | { id: number; type: 'step'; steps: number }
  | { id: number; type: 'restart' }
  | { id: number; type: 'snapshot' }
  | { id: number; type: 'metrics' }
  | { id: number; type: 'metricsSeries' }
  | { id: number; type: 'runHeadless' }
  | { id: number; type: 'tripRecords' }
  | { id: number; type: 'roadStats' }
  | { id: number; type: 'trajectories'; enabled?: boolean }
  | { id: number; type: 'trajectoryStatus' }
  | { id: number; type: 'inspect'; vehicleId: number }
  | { id: number; type: 'hash' };

export type HostReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export type HostEvent =
  | { type: 'headlessProgress'; timeS: number }
  | { type: 'tick'; timeS: number; achievedMultiplier: number; counts: Metrics['trips'] }
  | { type: 'finished'; timeS: number }
  | { type: 'error'; message: string };

// Flatbush instances contain constructors that structured clone cannot copy.
type LoadRequest = Extract<HostRequest, { type: 'load' | 'patch' }>;
type WireCity<Request> = Request extends LoadRequest
  ? Omit<Request, 'compiled'> & {
      compiled: Omit<CompiledCity, 'laneSpatial'> & {
        laneSpatial: Pick<CompiledCity['laneSpatial'], 'data' | 'byteOffset'>;
      };
    }
  : never;
export type HostWireRequest = Exclude<HostRequest, LoadRequest> | WireCity<LoadRequest>;
