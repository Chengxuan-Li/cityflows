import { Container, Graphics } from 'pixi.js';
import { headingAtDistance } from '../../geo/polyline';
import type { CNode, CompiledCity } from '../../network';

/** One curb-side sign per controlled approach; compiled priority includes explicit minors. */
export function drawSigns(
  city: CompiledCity,
  node: CNode,
  container: Container,
  zoom: () => number,
) {
  if (node.control !== 'stop' && node.control !== 'yield') return;
  const roads = new Set(
    node.movements
      .filter((i) => city.movements[i]!.priority < 10)
      .map((i) => city.lanes[city.movements[i]!.fromLane]!.road),
  );
  const signs = container.addChild(new Graphics());
  for (const index of roads) {
    const road = city.roads[index]!;
    const lane = city.lanes[city.drivingSide === 'right' ? road.lanes.at(-1)! : road.lanes[0]!]!;
    const heading = headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM);
    const end = lane.polyline.at(-1)!;
    const curb = (city.drivingSide === 'right' ? 1 : -1) * (lane.widthM / 2 + 2.2);
    const x = end.x - Math.sin(heading) * curb;
    const y = end.y + Math.cos(heading) * curb;
    const count = node.control === 'stop' ? 8 : 3;
    const offset = node.control === 'stop' ? Math.PI / 8 : Math.PI / 2;
    signs
      .poly(
        Array.from({ length: count }, (_, i) => ({
          x: x + 2.1 * Math.cos(offset + (i * Math.PI * 2) / count),
          y: y + 2.1 * Math.sin(offset + (i * Math.PI * 2) / count),
        })),
      )
      .fill(node.control === 'stop' ? 0xb95750 : 0xfffcf1)
      .stroke({ width: 0.45, color: node.control === 'stop' ? 0xfffcf1 : 0xb95750 });
    if (node.control === 'stop')
      signs
        .moveTo(x - 0.9, y)
        .lineTo(x + 0.9, y)
        .stroke({ width: 0.35, color: 0xfffcf1 });
  }
  signs.onRender = () => {
    signs.alpha = Math.max(0, Math.min(1, (zoom() - 0.45) / 0.65));
  };
}
