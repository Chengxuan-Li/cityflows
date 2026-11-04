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

export function drawNode(
  graphics: Graphics,
  city: CompiledCity,
  node: CNode,
  roads: CRoad[],
): void {
  const edges = roads.flatMap((road) => roadEndEdges(city, road, road.to === node.idx));
  // Join adjacent lane-block edges, rather than extending a radius beyond their curbs.
  edges.sort(
    (a, b) =>
      Math.atan2(a.y - node.pos.y, a.x - node.pos.x) -
      Math.atan2(b.y - node.pos.y, b.x - node.pos.x),
  );
  if (edges.length >= 3) graphics.poly(edges).fill(style.asphalt);
  const neighbors = new Set(roads.map((road) => (road.from === node.idx ? road.to : road.from)));
  if (neighbors.size === 2) {
    const width = Math.max(
      ...roads.flatMap((road) => road.lanes.map((lane) => city.lanes[lane]!.widthM)),
    );
    graphics.circle(node.pos.x, node.pos.y, width / 2).fill(style.asphalt);
  }
}

export function drawRoadJoins(graphics: Graphics, city: CompiledCity, road: CRoad): void {
  const { color, vergeM } = roadStyle(road);
  for (const atEnd of [false, true]) {
    const edges = roadEndEdges(city, road, atEnd);
    graphics.poly(edges, false).stroke({ color, width: vergeM * 2, cap: 'round' });
  }
}

export function drawMovementSurface(
  graphics: Graphics,
  city: CompiledCity,
  movement: CMovement,
): void {
  const width = Math.min(
    city.lanes[movement.fromLane]!.widthM,
    city.lanes[movement.toLane]!.widthM,
  );
  graphics.poly(movement.polyline, false).stroke({ width, color: style.asphalt, cap: 'butt' });
}
