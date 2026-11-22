import type { Graphics } from 'pixi.js';
import type { RailShape } from '../rail-geometry';

export function drawRail(graphics: Graphics, shape: RailShape) {
  if (!shape.polygons.length) return;
  for (const polygon of shape.polygons) graphics.poly(polygon);
  graphics.fill({ color: shape.color, alpha: shape.alpha });
}
