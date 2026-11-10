import type { Graphics } from 'pixi.js';
import type { RailShape } from '../rail-geometry';

export function drawRail(graphics: Graphics, shape: RailShape) {
  for (const triangle of shape.polygons)
    graphics.poly(triangle).fill({ color: shape.color, alpha: shape.alpha });
}
