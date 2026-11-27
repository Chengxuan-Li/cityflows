import type { Metrics, PersonDetail, VehicleDetail, WalkerDetail } from '../sim/types';
import type { FlightBoard } from '../sim/flight-operations';
import type { AirportWind } from '../sim/runway-configuration';
import type { DebugRequest } from '../sim/debug-snapshot';
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
  /** `debug` (TASK-381): also the debug views' sim state; it changes nothing in the run. */
  snapshot(debug?: DebugRequest): Promise<HostSnapshot>;
  metrics(): Promise<Metrics>;
  flightBoard(): Promise<FlightBoard | null>;
  /** TASK-300: sets the airport's wind; a change past the runway limits reconfigures. */
  setWind(wind: AirportWind): Promise<void>;
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
  /** Refuses new requests and terminates once the requests already sent have their replies: the
   *  engine of a project being replaced answers what it was asked (TASK-200). */
  retire(): void;
}

export function createEngineClient(worker: Worker): EngineClient {
  const pending = new Map<number, (reply: HostReply) => void>();
  const listeners = new Set<(event: HostEvent) => void>();
  let nextId = 1;
  // Concurrent requests asking for the same debug state share one reply.
  const snapshotsInFlight = new Map<string, Promise<HostSnapshot>>();
  let closed: string | undefined;
  let retired = false;

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
    if (retired && !pending.size) close('Traffic worker terminated');
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
    if (closed || retired) return Promise.reject(new Error(closed ?? 'Traffic worker retired'));
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
    snapshot(debug) {
      const wanted = debug && (debug.vehicles || debug.aircraft || debug.gridlock) ? debug : null;
      const key = wanted ? JSON.stringify(wanted) : '';
      let reply = snapshotsInFlight.get(key);
      if (!reply) {
        reply = send<HostSnapshot>({ type: 'snapshot', ...(wanted && { debug: wanted }) }).finally(
          () => snapshotsInFlight.delete(key),
        );
        snapshotsInFlight.set(key, reply);
      }
      return reply;
    },
    metrics: () => send({ type: 'metrics' }),
    flightBoard: () => send({ type: 'flightBoard' }),
    setWind: (wind) => send({ type: 'setWind', wind }),
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
    retire() {
      retired = true;
      listeners.clear();
      if (!pending.size) close('Traffic worker terminated');
    },
  };
}
