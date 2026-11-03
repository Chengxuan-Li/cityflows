import type { Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import type { Place } from '../../schema';
import { connectorPosition } from '../picking';
import { style } from '../style';

export function placePath(graphics: Graphics, shape: Place['shape']): Graphics {
  if (shape.kind === 'polygon') return graphics.poly(shape.ring);
  return graphics.circle(shape.pos.x, shape.pos.y, style.pointRadiusM);
}

export function drawPlaces(
  graphics: Graphics,
  city: CompiledCity,
  shapes: readonly Place['shape'][],
): void {
  for (const connector of city.connectors) {
    const { centroid } = city.places[connector.place]!;
    const end = connectorPosition(city, connector);
    graphics
      .moveTo(centroid.x, centroid.y)
      .lineTo(end.x, end.y)
      .stroke({ width: 0.32, color: style.connector, alpha: 0.55 });
    graphics.circle(end.x, end.y, style.connectorRadiusM).fill(style.connector);
  }
  for (const { idx, kind } of city.places) {
    const color = kind === 'residential' ? style.home : kind === 'work' ? style.work : style.place;
    placePath(graphics, shapes[idx]!).fill({ color, alpha: 0.64 }).stroke({ color, width: 0.3 });
  }
}
