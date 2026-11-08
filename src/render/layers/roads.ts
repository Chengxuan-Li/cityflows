import type { Graphics } from 'pixi.js';
import type { CompiledCity, CRoad, CMovement } from '../../network';
import type { CrossingSource } from '../../network/crossings';
import { roadStyle, markingTheme } from '../style';
import {
  roadMarkingGeometry,
  gorePavement,
  movementMarkings,
  crossingStripes,
  type MarkingShape,
} from '../marking-geometry';
export { approachMarkings, markingClips, crossingStripes } from '../marking-geometry';
export {
  crossingArms,
  crossingDefault,
  crossingEnabled,
  crossingPlacement,
} from '../../network/crossings';
const zoomFades = new WeakMap<Graphics, { from: number; to: number }>();

export function fadeAtZoom(graphics: Graphics, from: number, to: number) {
  if (!zoomFades.has(graphics)) zoomFades.set(graphics, { from, to });
}

/** Apply before rendering: onRender changes otherwise need another frame to reach the GPU. */
export function updateZoomFade(graphics: Graphics, zoom: number) {
  const range = zoomFades.get(graphics);
  if (range)
    graphics.alpha = Math.max(0, Math.min(1, (zoom - range.from) / (range.to - range.from)));
}
export function drawMarkings(graphics: Graphics, shapes: readonly MarkingShape[]) {
  for (const shape of shapes) {
    const color = markingTheme.colors[shape.role];
    if (shape.kind === 'polygon') graphics.poly(shape.points).fill({ color, alpha: shape.alpha });
    else {
      if (shape.role === 'stop') graphics.poly(shape.points, false);
      else {
        graphics.moveTo(shape.points[0]!.x, shape.points[0]!.y);
        for (const point of shape.points.slice(1)) graphics.lineTo(point.x, point.y);
      }
      graphics.stroke({
        color,
        width: shape.widthM,
        alpha: shape.alpha,
        cap: 'butt',
        join: 'miter',
      });
    }
  }
}
export function drawRoad(
  surface: Graphics,
  markings: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
  controls: Graphics = markings,
  source?: CrossingSource,
): void {
  const { color, vergeM } = roadStyle(road, roadClasses);
  surface
    .poly(road.surface)
    .fill(color)
    .stroke({ color, width: vergeM * 2, join: 'round' });
  const geometry = roadMarkingGeometry(city, road, source);
  for (const ring of [...geometry.pavement, ...gorePavement(city, road)])
    surface.poly(ring).fill(color);
  fadeAtZoom(markings, 0.7, 2.2);
  drawMarkings(markings, geometry.below);
  drawMarkings(controls, geometry.above);
}
export function drawMovementArrow(graphics: Graphics, movement: CMovement): void {
  fadeAtZoom(graphics, 2.2, 4.2);
  drawMarkings(graphics, movementMarkings(movement));
}
export function drawCrossings(
  graphics: Graphics,
  city: CompiledCity,
  road: CRoad,
  source?: CrossingSource,
): void {
  fadeAtZoom(graphics, 0.7, 2.2);
  for (const atEnd of [false, true])
    for (const stripe of crossingStripes(city, road, atEnd, source))
      graphics.poly(stripe).fill(markingTheme.colors.stop);
}
