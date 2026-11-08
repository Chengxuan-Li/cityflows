import type { Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import { parkingColor, parkingRadiusM } from '../parking';
import { style } from '../style';

export function drawParking(
  graphics: Graphics,
  city: CompiledCity,
  counts: ArrayLike<number> | null,
  zoom: number,
) {
  graphics.clear();
  const radius = Math.max(parkingRadiusM, 7 / zoom);
  for (const facility of city.parking) {
    const { x, y } = facility.centroid;
    graphics
      .roundRect(x - radius, y - radius, radius * 2, radius * 2, radius * 0.3)
      .fill(parkingColor(counts?.[facility.idx] ?? 0, facility.capacity))
      .stroke({ color: style.background, width: 1 / zoom });
  }
}
