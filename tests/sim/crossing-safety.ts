import type { CompiledCity } from '../../src/network';
import type { TrafficEngine } from '../../src/sim/types';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { vehicleClasses } from '../../src/schema';

/**
 * TASK-111 gate 4 at one step: a walker inside a lane's band on a crossing link, and a vehicle
 * body over that lane's span. A vehicle on a movement is measured on the lane it leaves (its rear
 * may still be there) and on the lane it enters. Returns the first violation, or null.
 */
export function sampleCrossings(engine: TrafficEngine, compiled: CompiledCity): string | null {
  const snapshot = engine.snapshot();
  const walkers = snapshot.walkers;
  if (!walkers) return null;
  const inside = new Map<number, { lo: number; hi: number; walker: number }[]>();
  for (let i = 0; i < walkers.count; i++) {
    if (walkers.state[i] !== 3) continue;
    const detail = engine.inspectWalker(walkers.id[i]!)!;
    for (const span of compiled.walk.links[detail.link]?.crossing?.spans ?? []) {
      if (Math.abs(detail.positionM - span.linkM) > span.linkHalfM) continue;
      const list = inside.get(span.lane) ?? [];
      list.push({ lo: span.atM - span.halfM, hi: span.atM + span.halfM, walker: detail.id });
      inside.set(span.lane, list);
    }
  }
  if (!inside.size) return null;
  for (let i = 0; i < snapshot.count; i++) {
    const field = snapshot.lane[i]!;
    const movement = field < 0 ? compiled.movements[-field - 1]! : undefined;
    const covered = movement ? [movement.fromLane, movement.toLane] : [field];
    if (!covered.some((lane) => inside.has(lane))) continue;
    const { positionM } = engine.inspect(snapshot.id[i]!)!;
    const length = DEFAULT_SIM_PARAMS.vehicleClasses[vehicleClasses[snapshot.vclass[i]!]!].lengthM;
    const fronts: [number, number][] = movement
      ? [
          [movement.fromLane, compiled.lanes[movement.fromLane]!.lengthM + positionM],
          [movement.toLane, positionM - movement.lengthM],
        ]
      : [[field, positionM]];
    for (const [lane, front] of fronts)
      for (const span of inside.get(lane) ?? [])
        if (front > span.lo && front - length < span.hi)
          return `${engine.timeS.toFixed(1)} s: walker ${span.walker} and vehicle ${snapshot.id[i]} on ${compiled.lanes[lane]!.id}`;
  }
  return null;
}
