import type { Graphics } from 'pixi.js';
import { headingAtDistance } from '../../geo/polyline';
import type { CMovement, CNode, CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

export function roadEndEdges(city: CompiledCity, road: CRoad, atEnd: boolean) {
  return [road.lanes[0]!, road.lanes.at(-1)!].map((index, side) => {
    const lane = city.lanes[index]!;
    const point = atEnd ? lane.polyline.at(-1)! : lane.polyline[0]!;
    const heading = headingAtDistance(lane.polyline, lane.cumulative, atEnd ? lane.lengthM : 0);
    const offset = ((side === 0 ? -1 : 1) * lane.widthM) / 2;
    return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
  });
}

export function nodeColor(city: CompiledCity, node: CNode, roadClasses = false): number {
  if (!roadClasses) return style.asphalt;
  const highest = city.roads
    .filter((r) => r.from === node.idx || r.to === node.idx)
    .reduce<CRoad | undefined>(
      (best, road) => (!best || road.classRank > best.classRank ? road : best),
      undefined,
    );
  return highest ? roadStyle(highest, true).color : style.asphalt;
}

export function drawNode(graphics: Graphics, node: CNode, color: number = style.asphalt): void {
  if (node.outline.length) graphics.poly(node.outline).fill(color);
}

export function drawRoadJoins(
  graphics: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
): void {
  const { color, vergeM } = roadStyle(road, roadClasses);
  for (const atEnd of [false, true]) {
    if (!city.nodes[atEnd ? road.to : road.from]!.outline.length) continue;
    const edges = roadEndEdges(city, road, atEnd);
    graphics.poly(edges, false).stroke({ color, width: vergeM * 2, cap: 'round' });
  }
}

export function drawMovementSurface(
  graphics: Graphics,
  city: CompiledCity,
  movement: CMovement,
  roadClasses = false,
): void {
  if (!city.nodes[movement.node]!.outline.length) return;
  const width = Math.min(
    city.lanes[movement.fromLane]!.widthM,
    city.lanes[movement.toLane]!.widthM,
  );
  graphics.poly(movement.polyline, false).stroke({
    width,
    color: nodeColor(city, city.nodes[movement.node]!, roadClasses),
    cap: 'butt',
  });
}
