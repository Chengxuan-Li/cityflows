import type { CLane, CMovement, CompiledCity } from '../network';
import type { SimParams } from '../schema';
import type { Vehicles } from './vehicle';

// TASK-298: road vehicles give way to aircraft where airside service roads cross the airside
// graph (owner, 2026-11-22). While the fleet marks a crossing closed, a driver on a lane leading
// to it stops at its stop (`AirsideCrossingC.stops`) if, when it first meets the closure, it can
// still stop there at its comfortable deceleration; one that cannot, or is past the stop, clears.
// Aircraft never stop for road vehicles.

const RANGE_M = 250;

export function createAirsideGiveWay(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  closed: Uint8Array,
) {
  // Per lane: stop position and crossing, in pairs.
  const blocks = new Map<number, number[]>();
  for (const crossing of compiled.airside!.crossings)
    for (const { lane, positionM } of crossing.stops) {
      const list = blocks.get(lane) ?? [];
      list.push(positionM, crossing.idx);
      blocks.set(lane, list);
    }
  const brakeMps2 = params.idm.bMps2;
  const crossings = compiled.airside!.crossings.length;
  // Each closure of a crossing is an episode; a driver decides once per episode whether it stops.
  const episode = new Int32Array(crossings);
  const wasClosed = new Uint8Array(crossings);
  const decided = new Map<number, number>();
  let vehicle = 0,
    position = 0,
    braking = 0,
    best = Infinity;
  function check(lane: number, offset: number) {
    const list = blocks.get(lane);
    if (!list) return;
    for (let i = 0; i < list.length; i += 2) {
      const crossing = list[i + 1]!;
      if (!closed[crossing]) continue;
      const at = offset + list[i]!;
      const d = at - position;
      if (d < 0 || at >= best) continue;
      const key = vehicle * crossings + crossing;
      let decision = decided.get(key);
      if (decision === undefined || decision >> 1 !== episode[crossing]) {
        decision = (episode[crossing]! << 1) | (braking > d ? 1 : 0);
        decided.set(key, decision);
      }
      if (decision & 1) continue;
      best = at;
    }
  }
  return {
    /** After the fleet's step: count the closures that began. */
    update() {
      for (let c = 0; c < crossings; c++) {
        if (closed[c] && !wasClosed[c]) episode[c]!++;
        wasClosed[c] = closed[c]!;
      }
    },
    /** The nearest closed crossing's stop ahead of a vehicle, in its segment's metres. */
    hold(id: number, lane: CLane | undefined, path: CMovement | null) {
      best = Infinity;
      if (!blocks.size) return best;
      vehicle = id;
      position = vehicles.position[id]!;
      const v = vehicles.speed[id]!;
      braking = (v * v) / (2 * brakeMps2);
      if (lane) {
        check(lane.idx, 0);
        const movement = vehicles.movement[id]!;
        if (movement !== -1 && lane.lengthM - position <= RANGE_M) {
          const m = compiled.movements[movement]!;
          check(m.toLane, lane.lengthM + m.lengthM);
        }
      } else check(path!.toLane, path!.lengthM);
      return best;
    },
  };
}
