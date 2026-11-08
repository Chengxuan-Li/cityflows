import type { Graphics } from 'pixi.js';
import type { CNode, CompiledCity } from '../../network';
import { nodeMarkingGeometry, junctionGuides } from '../marking-geometry';
import { drawMarkings, fadeAtZoom } from './roads';
export { junctionGuides, majorThroughs, splitLinedUp, type Guide } from '../marking-geometry';
export function drawJunctionMarkings(graphics: Graphics, city: CompiledCity, node: CNode): number {
  fadeAtZoom(graphics, 0.7, 2.2);
  drawMarkings(graphics, nodeMarkingGeometry(city, node));
  return junctionGuides(city, node).reduce((count, guide) => count + guide.dashes.length, 0);
}
