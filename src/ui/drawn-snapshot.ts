import type { CompiledCity } from '../network';
import type { VehicleSnapshot } from '../render/types';
import { laneChangePose } from '../render/layers/vehicles';

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
