import type { Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import type { Place } from '../../schema';
import { connectorPosition } from '../picking';
import { placeHue, style } from '../style';

export function placePath(
  graphics: Graphics,
  shape: Place['shape'],
  kind: Place['kind'],
): Graphics {
  if (shape.kind === 'polygon') return graphics.poly(shape.ring);
  const { x, y } = shape.pos;
  const radius = style.pointRadiusM;
  if (kind === 'residential') return graphics.circle(x, y, radius);
  const half = radius * 0.76;
  return graphics.roundRect(x - half, y - half, 2 * half, 2 * half, half * 0.3);
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
  for (const { idx, id, kind } of city.places) {
    placePath(graphics, shapes[idx]!, kind)
      .fill(placeHue(id))
      .stroke({ color: style.marking, width: 0.6 });
  }
}
