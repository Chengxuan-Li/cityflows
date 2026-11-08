import type { Graphics } from 'pixi.js';
import type { WalkShape } from '../walk-geometry';
import { style } from '../style';

export function drawWalk(graphics: Graphics, shape: WalkShape) {
  for (const ring of shape.polygons)
    graphics.poly(ring).fill(shape.sidewalk ? style.walk.sidewalk : style.walk.footway);
  for (const line of shape.hatches)
    graphics.poly(line, false).stroke({ color: style.walk.steps, width: 0.12 });
}
