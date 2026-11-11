import { markingTheme as defaultTheme, type MarkingTheme } from '../style';
import type { Graphics } from 'pixi.js';
import type { CompiledCity, CRoad } from '../../network';
import { roadFill } from './nodes';
import { transitionGeometry, transitionMarkings } from '../marking-geometry';
import { drawMarkings } from './roads';
export { transitionGeometry, seams } from '../marking-geometry';
export function drawTransitions(
  surface: Graphics,
  markings: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
  markingTheme: MarkingTheme = defaultTheme,
): void {
  if (road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM)) {
    const color = roadFill(city, road, roadClasses);
    for (const lane of transitionGeometry(city, road).lanes)
      surface.poly([...lane.left, ...[...lane.right].reverse()]).fill(color);
  }
  drawMarkings(markings, transitionMarkings(city, road, markingTheme), markingTheme);
}
