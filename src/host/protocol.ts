import type { CompiledCity } from '../network';
import type { Scenario, TripRequest } from '../schema';
import type { Metrics } from '../sim/types';

export type HostRequest =
  | { id: number; type: 'load'; compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario }
  | { id: number; type: 'play' }
  | { id: number; type: 'pause' }
  | { id: number; type: 'setSpeed'; multiplier: number }
  | { id: number; type: 'step'; steps: number }
  | { id: number; type: 'restart' }
  | { id: number; type: 'snapshot' }
  | { id: number; type: 'metrics' }
  | { id: number; type: 'inspect'; vehicleId: number }
  | { id: number; type: 'hash' };

export type HostReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export type HostEvent =
  | { type: 'tick'; timeS: number; achievedMultiplier: number; counts: Metrics['trips'] }
  | { type: 'finished'; timeS: number }
  | { type: 'error'; message: string };

// Flatbush instances contain constructors that structured clone cannot copy.
type LoadRequest = Extract<HostRequest, { type: 'load' }>;
export type HostWireRequest =
  | Exclude<HostRequest, LoadRequest>
  | (Omit<LoadRequest, 'compiled'> & {
      compiled: Omit<CompiledCity, 'laneSpatial'> & {
        laneSpatial: Pick<CompiledCity['laneSpatial'], 'data' | 'byteOffset'>;
      };
    });
