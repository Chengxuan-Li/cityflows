import { createRouteProvider, type Route } from '../routing';
import { createEngine } from '../sim/engine';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import { createPlayLoop } from './loop';
import type { HeadlessResult } from './protocol';

const initialFreeFlow = Symbol('comparison free-flow seconds');
type MeasuredRoute = Route & { [initialFreeFlow]: number };
type Input = Pick<
  Parameters<ReturnType<typeof createEngine>['load']>[0],
  'compiled' | 'trips' | 'scenario'
>;

/** Uses a fresh engine; never pulls snapshots or emits interactive host events. */
export function runHeadless(
  input: Input,
  progress: (timeS: number) => void = () => {},
): HeadlessResult {
  const { compiled, scenario, trips } = input;
  const params = { ...DEFAULT_SIM_PARAMS, ...scenario.simParams };
  if (!Number.isFinite(params.dtS) || params.dtS <= 0)
    throw new Error('Simulation step must be positive');
  const provider = createRouteProvider({ laneChangeDistanceM: params.laneChangeDistanceM });
  const engine = createEngine();
  engine.load({
    ...input,
    routeProvider: {
      route(city, costs, request) {
        const result = provider.route(city, costs, request);
        if (!result.ok) return result;
        let position = request.fromPosM;
        let seconds = 0;
        for (const index of result.route.movements) {
          const movement = city.movements[index]!;
          const from = city.lanes[movement.fromLane]!;
          const to = city.lanes[movement.toLane]!;
          seconds += Math.max(0, from.lengthM - position) / from.speedLimitMps;
          seconds += movement.lengthM / Math.min(from.speedLimitMps, to.speedLimitMps);
          position = 0;
        }
        const destination = city.connectors[request.toConnector]!;
        seconds += (destination.positionM - position) / city.lanes[destination.lane]!.speedLimitMps;
        // Inspection preserves route metadata. Capture it at departure, before any rerouting.
        return {
          ok: true,
          route: { ...result.route, [initialFreeFlow]: seconds } as MeasuredRoute,
        };
      },
    },
  });
  const loop = createPlayLoop(engine, {
    dtS: params.dtS,
    endS: scenario.endS,
    now: () => 0,
    emit: () => {},
  });
  const pending = trips
    .map((trip, index) => ({ trip, id: index + 1 }))
    .filter(({ trip }) => trip.mode === 'car' && trip.departS <= scenario.endS)
    .sort((a, b) => a.trip.departS - b.trip.departS || a.id - b.id);
  let cursor = 0;
  const active = new Map<number, { freeFlow?: number; roads: Set<number> }>();
  const roadVehicleCounts: Record<string, number> = Object.fromEntries(
    compiled.roads.map(({ id }) => [id, 0]),
  );
  const travelTimesS: number[] = [];
  const delaysS: number[] = [];
  const steps = Math.max(0, Math.ceil((scenario.endS - scenario.startS) / params.dtS - 1e-8));
  progress(engine.timeS);
  for (let step = 0; step < steps; step++) {
    while (cursor < pending.length && pending[cursor]!.trip.departS <= engine.timeS + 1e-9) {
      active.set(pending[cursor++]!.id, { roads: new Set() });
    }
    loop.step(1);
    for (const [id, observed] of active) {
      const detail = engine.inspect(id);
      if (!detail) continue;
      if (detail.departedS !== null) {
        observed.freeFlow ??= (detail.route as MeasuredRoute)[initialFreeFlow];
        const road =
          detail.lane < 0
            ? compiled.lanes[compiled.movements[-detail.lane - 1]!.fromLane]!.road
            : compiled.lanes[detail.lane]!.road;
        if (!observed.roads.has(road)) {
          observed.roads.add(road);
          roadVehicleCounts[compiled.roads[road]!.id]!++;
        }
      }
      if (detail.state === 'completed') {
        const travel = detail.arrivedS! - detail.departedS!;
        travelTimesS.push(travel);
        delaysS.push(travel - observed.freeFlow!);
      }
      if (detail.state === 'completed' || detail.state === 'failed') active.delete(id);
    }
    if ((step + 1) % 600 === 0) progress(engine.timeS);
  }
  progress(engine.timeS);
  const sorted = delaysS.slice().sort((a, b) => a - b);
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    series: loop.metricsSeries(),
    metrics: engine.metrics(),
    roadVehicleCounts,
    travelTime: {
      travelTimesS,
      delaysS,
      meanS: mean(travelTimesS),
      meanDelayS: mean(delaysS),
      p90DelayS: sorted[Math.ceil(sorted.length * 0.9) - 1] ?? 0,
    },
  };
}
