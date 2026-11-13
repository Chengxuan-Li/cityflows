import { Container, Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import type { CityGeometry } from '../types';
import { style } from '../style';

export function drawLots(
  city: CompiledCity,
  source?: CityGeometry,
  surfaceColor: number = style.context.parking,
) {
  const container = new Container();
  const surface = new Graphics();
  const stalls = new Graphics();
  for (const lot of Object.values(source?.parking ?? {})) {
    if (lot.kind !== 'lot' || lot.shape?.kind !== 'polygon') continue;
    surface.poly(lot.shape.ring.flatMap((p) => [p.x, p.y])).fill(surfaceColor);
    for (const hole of lot.exclusions ?? []) surface.poly(hole.flatMap((p) => [p.x, p.y])).cut();
  }
  for (const lot of city.lots ?? [])
    for (const stall of lot.stalls) {
      const [a, b, c, d] = stall.corners;
      // Open toward the aisle: three painted edges, shared geometry in both views.
      stalls.moveTo(a!.x, a!.y).lineTo(b!.x, b!.y).lineTo(c!.x, c!.y).lineTo(d!.x, d!.y);
    }
  stalls.stroke({ color: style.stall, width: 0.12, alpha: 0.8 });
  container.addChild(surface, stalls);
  return { container, stalls };
}
