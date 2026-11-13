import type { Graphics } from 'pixi.js';
import type { WalkShape } from '../walk-geometry';
import { style, type MapPalette } from '../style';

export function drawWalk(
  graphics: Graphics,
  shape: WalkShape,
  paving: MapPalette['walk'] = style.walk,
) {
  for (const ring of shape.polygons)
    graphics.poly(ring).fill(shape.sidewalk ? paving.sidewalk : paving.footway);
  for (const line of shape.hatches)
    graphics.poly(line, false).stroke({ color: paving.steps, width: 0.12 });
}
