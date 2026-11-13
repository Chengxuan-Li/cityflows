import type { Metrics, PersonDetail, VehicleDetail, WalkerDetail } from '../sim/types';
import type { CompiledCity } from '../network';
import type { RoadStats, TrajectoryRecord, TripRecord } from '../project/export-csv';
import type {
  HostEvent,
  HostReply,
  HostRequest,
  HostWireRequest,
  HostSnapshot,
  MetricsSample,
  HeadlessResult,
  TrajectoryStatus,
  HostPatchResult,
} from './protocol';

type LoadInput = Omit<Extract<HostRequest, { type: 'load' }>, 'id' | 'type'>;
type WithoutId<T> = T extends HostWireRequest ? Omit<T, 'id'> : never;

export interface EngineClient {
  load(input: LoadInput): Promise<void>;
  patch(compiled: CompiledCity): Promise<HostPatchResult>;
  play(): Promise<void>;
  pause(): Promise<void>;
  setSpeed(multiplier: number): Promise<void>;
  step(steps: number): Promise<void>;
  restart(): Promise<void>;
  snapshot(): Promise<HostSnapshot>;
  metrics(): Promise<Metrics>;
  metricsSeries(): Promise<MetricsSample[]>;
  runHeadless(): Promise<HeadlessResult>;
  tripRecords(): Promise<TripRecord[]>;
  roadStats(): Promise<RoadStats[]>;
  trajectories(): Promise<TrajectoryRecord[]>;
  setTrajectories(enabled: boolean): Promise<TrajectoryStatus>;
  trajectoryStatus(): Promise<TrajectoryStatus>;
  inspect(id: number): Promise<VehicleDetail | null>;
  inspectWalker(id: number): Promise<WalkerDetail | null>;
  inspectPerson(id: string): Promise<PersonDetail | null>;
  /** TASK-170: the run's demand-split phase greens, by junction group or node id. */
  signalTiming(): Promise<Record<string, number[]>>;
  hash(): Promise<number>;
  onEvent(listener: (event: HostEvent) => void): () => void;
  terminate(): void;
}

export function createEngineClient(worker: Worker): EngineClient {
  const pending = new Map<number, (reply: HostReply) => void>();
  const listeners = new Set<(event: HostEvent) => void>();
  let nextId = 1;
  let snapshotInFlight: Promise<HostSnapshot> | undefined;
  let closed: string | undefined;

  function emit(event: HostEvent) {
    for (const listener of listeners) listener(event);
  }

  function onMessage({ data }: MessageEvent<HostReply | HostEvent>) {
    if (!('id' in data)) {
      emit(data);
      return;
    }
    const match = pending.get(data.id);
    pending.delete(data.id);
    match?.(data);
  }

  function close(reason: string) {
    if (closed) return;
    closed = reason;
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.terminate();
    for (const [id, match] of pending) match({ id, ok: false, error: reason });
    pending.clear();
    listeners.clear();
  }

  function onError(event: ErrorEvent) {
    const message = event.message || 'Traffic worker failed';
    try {
      emit({ type: 'error', message });
    } finally {
      close(message);
    }
  }

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);

  function send<T>(request: WithoutId<HostWireRequest>): Promise<T> {
    if (closed) return Promise.reject(new Error(closed));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, (reply) => {
        if (reply.ok) resolve(reply.result as T);
        else reject(new Error(reply.error));
      });
      try {
        worker.postMessage({ id, ...request } satisfies HostWireRequest);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  return {
    patch(compiled) {
      const { data, byteOffset } = compiled.laneSpatial;
      return send({ type: 'patch', compiled: { ...compiled, laneSpatial: { data, byteOffset } } });
    },
    load({ compiled, trips, scenario, population }) {
      const { data, byteOffset } = compiled.laneSpatial;
      return send({
        type: 'load',
        compiled: { ...compiled, laneSpatial: { data, byteOffset } },
        trips,
        scenario,
        population,
      });
    },
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    setSpeed: (multiplier) => send({ type: 'setSpeed', multiplier }),
    step: (steps) => send({ type: 'step', steps }),
    restart: () => send({ type: 'restart' }),
    snapshot() {
      return (snapshotInFlight ??= send<HostSnapshot>({ type: 'snapshot' }).finally(() => {
        snapshotInFlight = undefined;
      }));
    },
    metrics: () => send({ type: 'metrics' }),
    metricsSeries: () => send({ type: 'metricsSeries' }),
    runHeadless: () => send({ type: 'runHeadless' }),
    tripRecords: () => send({ type: 'tripRecords' }),
    roadStats: () => send({ type: 'roadStats' }),
    trajectories: () => send({ type: 'trajectories' }),
    setTrajectories: (enabled) => send({ type: 'trajectories', enabled }),
    trajectoryStatus: () => send({ type: 'trajectoryStatus' }),
    inspect: (vehicleId) => send({ type: 'inspect', vehicleId }),
    inspectWalker: (walkerId) => send({ type: 'inspectWalker', walkerId }),
    inspectPerson: (personId) => send({ type: 'inspectPerson', personId }),
    signalTiming: () => send({ type: 'signalTiming' }),
    hash: () => send({ type: 'hash' }),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate: () => close('Traffic worker terminated'),
  };
}
