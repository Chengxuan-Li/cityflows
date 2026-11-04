import type { Graphics } from 'pixi.js';
import { headingAtDistance } from '../../geo/polyline';
import type { CMovement, CNode, CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

export function drawNode(graphics: Graphics, node: CNode): void {
  graphics.circle(node.pos.x, node.pos.y, Math.max(1, node.radiusM)).fill(style.asphalt);
}

export function drawRoadJoins(graphics: Graphics, city: CompiledCity, road: CRoad): void {
  const { color, vergeM } = roadStyle(road);
  for (const [nodeIndex, atEnd] of [
    [road.from, false],
    [road.to, true],
  ] as const) {
    const node = city.nodes[nodeIndex]!;
    const edges = [road.lanes[0]!, road.lanes.at(-1)!].map((index, side) => {
      const lane = city.lanes[index]!;
      const point = atEnd ? lane.polyline.at(-1)! : lane.polyline[0]!;
      const heading = headingAtDistance(lane.polyline, lane.cumulative, atEnd ? lane.lengthM : 0);
      const offset = ((side === 0 ? -1 : 1) * lane.widthM) / 2;
      return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
    });
    graphics
      .poly([node.pos, ...edges])
      .fill(color)
      .stroke({ color, width: vergeM * 2, join: 'round' });
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
  graphics.poly(movement.polyline, false).stroke({ width, color: style.asphalt, cap: 'round' });
}
