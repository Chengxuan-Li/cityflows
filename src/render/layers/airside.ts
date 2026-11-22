import { Graphics } from 'pixi.js';
import type { AirsideArea } from '../airside-geometry';
import type { MarkingShape } from '../marking-geometry';
import { style } from '../style';
import { drawMarkings } from './roads';

/** TASK-295: the airside's paving, over the place tints (the aerodrome is a place) and under the
 * roads. */
export function drawAirside(areas: readonly AirsideArea[]) {
  const paving = new Graphics();
  paving.eventMode = 'none';
  for (const { kind, rings } of areas) {
    paving.poly(rings[0]!).fill(style.airside[kind]);
    for (const hole of rings.slice(1)) paving.poly(hole);
    if (rings.length > 1) paving.cut();
  }
  return paving;
}

export function drawAirsidePaint(shapes: readonly MarkingShape[]) {
  const paint = new Graphics();
  paint.eventMode = 'none';
  drawMarkings(paint, shapes);
  return paint;
}
