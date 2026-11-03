import type { Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import type { Place } from '../../schema';
import { connectorPosition } from '../picking';
import { style } from '../style';
import type { Pick, RouteOverlay } from '../types';
import { placePath } from './places';

export function drawSelection(
  graphics: Graphics,
  city: CompiledCity,
  shapes: readonly Place['shape'][],
  selection: Pick | null,
): void {
  graphics.clear();
  if (!selection) return;
  const stroke = { color: style.selection, width: 0.4 };
  switch (selection.kind) {
    case 'lane': {
      const lane = city.lanes[selection.lane]!;
      graphics
        .poly(lane.polyline, false)
        .stroke({ width: lane.widthM, color: style.selection, alpha: 0.35 });
      break;
    }
    case 'node': {
      const { pos, radiusM } = city.nodes[selection.node]!;
      graphics.circle(pos.x, pos.y, Math.max(1, radiusM)).stroke(stroke);
      break;
    }
    case 'place':
      placePath(graphics, shapes[selection.place]!).stroke(stroke);
      break;
    case 'connector': {
      const point = connectorPosition(city, city.connectors[selection.connector]!);
      graphics.circle(point.x, point.y, style.connectorRadiusM + 0.45).stroke(stroke);
      break;
    }
  }
}

export function drawRoute(
  graphics: Graphics,
  city: CompiledCity,
  route: RouteOverlay | null,
): void {
  graphics.clear();
  if (!route) return;
  const stroke = { width: 0.75, color: style.route, alpha: 0.87 };
  for (const index of route.lanes) graphics.poly(city.lanes[index]!.polyline, false).stroke(stroke);
  for (const index of route.movements)
    graphics.poly(city.movements[index]!.polyline, false).stroke(stroke);
}

export function drawHeat(
  graphics: Graphics,
  city: CompiledCity,
  ratios: ArrayLike<number> | null,
): void {
  graphics.clear();
  if (!ratios) return;
  for (const { idx, surface } of city.roads) {
    const ratio = ratios[idx];
    if (ratio === undefined || !Number.isFinite(ratio)) continue;
    const t = Math.max(0, Math.min(1, ratio));
    const red = Math.round(234 - 131 * t);
    const green = Math.round(91 + 113 * t);
    graphics.poly(surface).fill({ color: (red << 16) | (green << 8) | 92, alpha: 0.46 });
  }
}
