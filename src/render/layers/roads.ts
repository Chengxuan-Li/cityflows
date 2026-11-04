import type { Graphics } from 'pixi.js';
import { headingAtDistance, offsetPolyline, pointAtDistance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CMovement, CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

function fadeAtZoom(graphics: Graphics, from: number, to: number) {
  graphics.onRender ??= () => {
    const zoom = graphics.parent!.worldTransform.a;
    graphics.alpha = Math.max(0, Math.min(1, (zoom - from) / (to - from)));
  };
}

export function drawRoad(
  surface: Graphics,
  markings: Graphics,
  city: CompiledCity,
  road: CRoad,
): void {
  const { color, vergeM } = roadStyle(road);
  surface
    .poly(road.surface)
    .fill(color)
    .stroke({ color, width: vergeM * 2, join: 'round' });
  fadeAtZoom(markings, 0.7, 2.2);
  const medianOnRight = city.drivingSide === 'left';
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    if (lane.right >= 0) drawDashes(markings, offsetPolyline(lane.polyline, lane.widthM / 2));
    if (road.streetGroupId !== null && (medianOnRight ? lane.right : lane.left) < 0) {
      const offset = ((medianOnRight ? 1 : -1) * lane.widthM) / 2;
      markings
        .poly(offsetPolyline(lane.polyline, offset), false)
        .stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.85 });
    }
  }
}

function drawDashes(graphics: Graphics, line: Vec2[]): void {
  const dashM = 2.7;
  const gapM = 3.1;
  const period = dashM + gapM;
  let offset = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    for (let start = -offset; start < length; start += period) {
      const from = Math.max(0, start);
      const to = Math.min(length, start + dashM);
      if (to <= from) continue;
      graphics
        .moveTo(a.x + (dx * from) / length, a.y + (dy * from) / length)
        .lineTo(a.x + (dx * to) / length, a.y + (dy * to) / length);
    }
    offset = (offset + length) % period;
  }
  graphics.stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.78 });
}

export function drawMovementArrow(graphics: Graphics, movement: CMovement): void {
  fadeAtZoom(graphics, 2.2, 4.2);
  const { polyline, cumulative, lengthM } = movement;
  const start = lengthM * 0.13;
  const end = lengthM * 0.84;
  const tip = pointAtDistance(polyline, cumulative, end);
  const heading = headingAtDistance(polyline, cumulative, end);
  const root = pointAtDistance(polyline, cumulative, start);
  graphics.moveTo(root.x, root.y);
  for (let i = 1; i < polyline.length - 1; i++) {
    if (cumulative[i]! > start && cumulative[i]! < end)
      graphics.lineTo(polyline[i]!.x, polyline[i]!.y);
  }
  graphics.lineTo(tip.x, tip.y).stroke({ color: style.marking, width: 0.17, alpha: 0.56 });
  const size = Math.min(1.05, lengthM / 6);
  const dx = Math.cos(heading) * size;
  const dy = Math.sin(heading) * size;
  graphics
    .poly([
      tip.x,
      tip.y,
      tip.x - dx - dy * 0.55,
      tip.y - dy + dx * 0.55,
      tip.x - dx + dy * 0.55,
      tip.y - dy - dx * 0.55,
    ])
    .fill({ color: style.marking, alpha: 0.9 });
}
