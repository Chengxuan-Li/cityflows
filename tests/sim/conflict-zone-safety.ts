import type { CompiledCity } from '../../src/network';
import type { TrafficEngine } from '../../src/sim/types';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';

/** Front past the start and rear before the end: a car clamped exactly at the start is outside. */
export function sampleConflictZones(engine: TrafficEngine, compiled: CompiledCity) {
  const occupied = new Map<number, number[]>();
  const snapshot = engine.snapshot();
  for (let i = 0; i < snapshot.count; i++) {
    const field = snapshot.lane[i]!;
    if (field >= 0) continue;
    const idx = -field - 1;
    const positions = occupied.get(idx) ?? [];
    positions.push(engine.inspect(snapshot.id[i]!)!.positionM);
    occupied.set(idx, positions);
  }
  let contacts = 0;
  for (const [idx, positions] of occupied) {
    const path = compiled.movements[idx]!;
    path.conflicts.forEach((otherIdx, i) => {
      const [start, end] = path.conflictZones[i]!;
      if (!positions.some((p) => p > start && p < end + DEFAULT_SIM_PARAMS.vehicleLengthM)) return;
      contacts++;
      const otherPositions = occupied.get(otherIdx);
      if (!otherPositions) return;
      const other = compiled.movements[otherIdx]!;
      const [otherStart, otherEnd] = other.conflictZones[other.conflicts.indexOf(idx)]!;
      if (
        otherPositions.some(
          (p) => p > otherStart && p < otherEnd + DEFAULT_SIM_PARAMS.vehicleLengthM,
        )
      ) {
        throw new Error(
          `Contact overlap at ${engine.timeS}s: ${path.id} ${positions} / ${other.id} ${otherPositions}`,
        );
      }
    });
  }
  return contacts;
}
