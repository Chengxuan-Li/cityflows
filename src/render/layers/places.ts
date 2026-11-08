import { Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import type { Place } from '../../schema';
import { connectorPosition } from '../picking';
import { placeHue, style } from '../style';

export function placePath(
  graphics: Graphics,
  shape: Place['shape'],
  kind: Place['kind'],
  zoom = 1,
): Graphics {
  if (shape.kind === 'polygon') return graphics.poly(shape.ring);
  const { x, y } = shape.pos;
  const radius = Math.max(style.pointRadiusM, 8 / zoom);
  if (kind === 'residential') return graphics.circle(x, y, radius);
  const half = radius * 0.76;
  return graphics.roundRect(x - half, y - half, 2 * half, 2 * half, half * 0.3);
}

export function drawPlaces(
  graphics: Graphics,
  city: CompiledCity,
  shapes: readonly Place['shape'][],
  connectorGraphics: Graphics = graphics,
): (zoom: number) => void {
  for (const connector of city.connectors) {
    const { centroid } = city.places[connector.place]!;
    const end = connectorPosition(city, connector);
    connectorGraphics
      .moveTo(centroid.x, centroid.y)
      .lineTo(end.x, end.y)
      .stroke({ width: 0.32, color: style.connector, alpha: 0.55 });
    connectorGraphics.circle(end.x, end.y, style.connectorRadiusM).fill(style.connector);
  }
  const points: Graphics[] = [];
  for (const { idx, id, kind } of city.places) {
    const shape = shapes[idx]!;
    let target = graphics;
    let local = shape;
    if (shape.kind === 'point') {
      target = new Graphics();
      target.position.set(shape.pos.x, shape.pos.y);
      graphics.addChild(target);
      points.push(target);
      local = { kind: 'point', pos: { x: 0, y: 0 } };
    }
    // A parking area's place is its outline: the lot's aisles and stalls (TASK-104) lie inside.
    if (kind === 'parking' && local.kind === 'polygon')
      placePath(target, local, kind, Infinity).stroke({ color: placeHue(id), width: 1.2 });
    else
      placePath(target, local, kind, Infinity)
        .fill(placeHue(id))
        .stroke({ color: style.marking, width: 0.6 });
  }
  return (zoom) => {
    for (const point of points) point.scale.set(Math.max(1, 8 / (zoom * style.pointRadiusM)));
  };
}
