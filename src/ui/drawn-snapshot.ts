import type { CompiledCity } from '../network';
import type { VehicleSnapshot, ParkedCarsSnapshot } from '../render/types';
import { laneChangePose } from '../render/layers/vehicles';

/** A restart-required edit can leave the displayed city ahead of the loaded run. */
export function remapParkedCars(
  snapshot: ParkedCarsSnapshot | null,
  loaded: CompiledCity,
  displayed: CompiledCity,
): ParkedCarsSnapshot | null {
  if (!snapshot || loaded === displayed) return snapshot;
  const count = displayed.parkingSpaces?.length ?? 0;
  const result: ParkedCarsSnapshot = {
    occupied: new Uint8Array(Math.ceil(count / 8)),
    id: new Uint32Array(count),
    vclass: new Uint8Array(count),
    hues: new Uint32Array(count),
  };
  for (const facility of displayed.parking) {
    const old = loaded.index.parking.get(facility.id);
    if (old === undefined) continue;
    facility.spaces?.forEach((index, ordinal) => {
      const before = loaded.parking[old]!.spaces?.[ordinal];
      if (before === undefined || !(snapshot.occupied[before >> 3]! & (1 << (before & 7)))) return;
      result.occupied[index >> 3]! |= 1 << (index & 7);
      result.id[index] = snapshot.id[before]!;
      result.vclass[index] = snapshot.vclass[before]!;
      result.hues[index] = snapshot.hues[before]!;
    });
  }
  return result;
}

export function pausedSnapshot(
  snapshot: VehicleSnapshot,
  city: CompiledCity,
  laneChangeDurationS: number,
) {
  const x = snapshot.x.slice();
  const y = snapshot.y.slice();
  for (let i = 0; i < snapshot.count; i++) {
    const lateralM = snapshot.lateralM[i]!;
    if (lateralM === 0) continue;
    const lane = city.lanes[snapshot.lane[i]!]!;
    const source = city.lanes[lateralM > 0 ? lane.right : lane.left]!;
    const { lateral } = laneChangePose(
      lateralM,
      (lane.widthM + source.widthM) / 2,
      laneChangeDurationS,
      0,
    );
    x[i] = x[i]! - Math.sin(snapshot.heading[i]!) * lateral;
    y[i] = y[i]! + Math.cos(snapshot.heading[i]!) * lateral;
  }
  return { ...snapshot, x, y };
}
