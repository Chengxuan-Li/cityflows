import type { CompiledCity } from '../../src/network';
import type { TrafficEngine } from '../../src/sim/types';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { vehicleClasses } from '../../src/schema';

/** Front past the start and rear before the end: a car clamped exactly at the start is outside. */
export function sampleConflictZones(engine: TrafficEngine, compiled: CompiledCity) {
  const occupied = new Map<number, { position: number; length: number }[]>();
  const snapshot = engine.snapshot();
  for (let i = 0; i < snapshot.count; i++) {
    const field = snapshot.lane[i]!;
    if (field >= 0) continue;
    const idx = -field - 1;
    const positions = occupied.get(idx) ?? [];
    positions.push({
      position: engine.inspect(snapshot.id[i]!)!.positionM,
      length: DEFAULT_SIM_PARAMS.vehicleClasses[vehicleClasses[snapshot.vclass[i]!]!].lengthM,
    });
    occupied.set(idx, positions);
  }
  let contacts = 0;
  for (const [idx, positions] of occupied) {
    const path = compiled.movements[idx]!;
    path.conflicts.forEach((otherIdx, i) => {
      const [start, end] = path.conflictZones[i]!;
      if (!positions.some((p) => p.position > start && p.position < end + p.length)) return;
      contacts++;
      const otherPositions = occupied.get(otherIdx);
      if (!otherPositions) return;
      const other = compiled.movements[otherIdx]!;
      const [otherStart, otherEnd] = other.conflictZones[other.conflicts.indexOf(idx)]!;
      if (otherPositions.some((p) => p.position > otherStart && p.position < otherEnd + p.length)) {
        throw new Error(
          `Contact overlap at ${engine.timeS}s: ${path.id} ${positions} / ${other.id} ${otherPositions}`,
        );
      }
    });
  }
  return contacts;
}
