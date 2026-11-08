import type { Graphics } from 'pixi.js';
import type { CompiledCity, CRoad, CMovement } from '../../network';
import type { CrossingSource } from '../../network/crossings';
import { roadStyle, markingTheme as defaultTheme, type MarkingTheme } from '../style';
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
export function fadeAtZoom(graphics: Graphics, from: number, to: number) {
  graphics.onRender ??= () => {
    const zoom = graphics.parent!.worldTransform.a;
    graphics.alpha = Math.max(0, Math.min(1, (zoom - from) / (to - from)));
  };
}
export function drawMarkings(
  graphics: Graphics,
  shapes: readonly MarkingShape[],
  markingTheme: MarkingTheme = defaultTheme,
) {
  for (const shape of shapes) {
    const color = shape.color ?? markingTheme.colors[shape.role];
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
  markingTheme: MarkingTheme = defaultTheme,
): void {
  const { color, vergeM } = roadStyle(road, roadClasses);
  surface
    .poly(road.surface)
    .fill(color)
    .stroke({ color, width: vergeM * 2, join: 'round' });
  const geometry = roadMarkingGeometry(city, road, source, markingTheme);
  for (const ring of [...geometry.pavement, ...gorePavement(city, road)])
    surface.poly(ring).fill(color);
  fadeAtZoom(markings, 0.7, 2.2);
  drawMarkings(markings, geometry.below, markingTheme);
  drawMarkings(controls, geometry.above, markingTheme);
}
export function drawMovementArrow(
  graphics: Graphics,
  movement: CMovement,
  markingTheme: MarkingTheme = defaultTheme,
): void {
  fadeAtZoom(graphics, 2.2, 4.2);
  drawMarkings(graphics, movementMarkings(movement, markingTheme), markingTheme);
}
export function drawCrossings(
  graphics: Graphics,
  city: CompiledCity,
  road: CRoad,
  source?: CrossingSource,
  markingTheme: MarkingTheme = defaultTheme,
): void {
  fadeAtZoom(graphics, 0.7, 2.2);
  for (const atEnd of [false, true])
    for (const stripe of crossingStripes(city, road, atEnd, source))
      graphics.poly(stripe).fill(markingTheme.colors.stop);
}
