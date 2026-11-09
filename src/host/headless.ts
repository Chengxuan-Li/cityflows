import { createEngine } from '../sim/engine';
import { DEFAULT_SIM_PARAMS } from '../sim/params';
import { OFF_LANE } from '../sim/vehicle';
import { createPlayLoop } from './loop';
import type { HeadlessResult } from './protocol';

type Input = Pick<
  Parameters<ReturnType<typeof createEngine>['load']>[0],
  'compiled' | 'trips' | 'scenario'
>;

/** Uses a fresh engine; never pulls snapshots for rendering or emits interactive host events. */
export function runHeadless(
  input: Input,
  progress: (timeS: number) => void = () => {},
): HeadlessResult {
  const { compiled, scenario, trips } = input;
  const params = { ...DEFAULT_SIM_PARAMS, ...scenario.simParams };
  if (!Number.isFinite(params.dtS) || params.dtS <= 0)
    throw new Error('Simulation step must be positive');
  const engine = createEngine();
  engine.load(input);
  const loop = createPlayLoop(engine, {
    dtS: params.dtS,
    endS: scenario.endS,
    now: () => 0,
    emit: () => {},
  });
  const roadVehicleCounts: Record<string, number> = Object.fromEntries(
    compiled.roads.map(({ id }) => [id, 0]),
  );
  const visited = new Map<number, Set<number>>();
  function observe(id: number, laneField: number) {
    if (laneField === OFF_LANE) return;
    const road =
      laneField < 0
        ? compiled.lanes[compiled.movements[-laneField - 1]!.fromLane]!.road
        : compiled.lanes[laneField]!.road;
    let roads = visited.get(id);
    if (!roads) visited.set(id, (roads = new Set()));
    if (roads.has(road)) return;
    roads.add(road);
    roadVehicleCounts[compiled.roads[road]!.id]!++;
  }
  const steps = Math.max(0, Math.ceil((scenario.endS - scenario.startS) / params.dtS - 1e-8));
  progress(engine.timeS);
  for (let step = 0; step < steps; step++) {
    loop.step(1);
    // One snapshot per step covers every vehicle on the road; the lane a trip ended on is
    // read once below, so a road entered and left within one step still counts.
    const snapshot = engine.snapshot();
    for (let i = 0; i < snapshot.count; i++) observe(snapshot.id[i]!, snapshot.lane[i]!);
    if ((step + 1) % 600 === 0) progress(engine.timeS);
  }
  progress(engine.timeS);
  const outcomes = engine.metrics().tripOutcomes;
  if (!outcomes) throw new Error('Engine does not expose per-trip accounting');
  const completed: number[] = [];
  for (let id = 0; id < trips.length; id++) {
    const outcome = outcomes[id]!;
    if (outcome.departedS === null) continue;
    observe(id + 1, engine.inspect(id + 1)!.lane);
    if (outcome.arrivedS !== null) completed.push(id);
  }
  // Completion order, then departure order among trips that completed in the same step.
  completed.sort(
    (a, b) =>
      outcomes[a]!.arrivedS! - outcomes[b]!.arrivedS! ||
      trips[a]!.departS - trips[b]!.departS ||
      a - b,
  );
  const travelTimesS = completed.map((id) => outcomes[id]!.arrivedS! - outcomes[id]!.departedS!);
  const delaysS = completed.map((id, i) => travelTimesS[i]! - outcomes[id]!.freeFlowS!);
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
