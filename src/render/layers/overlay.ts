import type { Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import type { Place } from '../../schema';
import { connectorPosition } from '../picking';
import { style } from '../style';
import type { Pick, RouteOverlay } from '../types';
import { placePath } from './places';

export function drawMultiSelection(
  graphics: Graphics,
  city: CompiledCity,
  roads: readonly number[],
) {
  graphics.clear();
  for (const index of roads) {
    graphics.poly(city.roads[index]!.surface).stroke({
      color: style.selection,
      width: 1.4,
      alpha: 0.55,
      join: 'round',
    });
  }
}

export function drawSelection(
  graphics: Graphics,
  city: CompiledCity,
  shapes: readonly Place['shape'][],
  selection: Pick | null,
  zoom = 1,
): void {
  graphics.clear();
  if (!selection) return;
  const stroke = { color: style.selection, width: 1.4, alpha: 0.55 };
  switch (selection.kind) {
    case 'lane': {
      const lane = city.lanes[selection.lane]!;
      graphics
        .poly(lane.polyline, false)
        .stroke({ ...stroke, width: lane.widthM + 0.8, cap: 'round' });
      break;
    }
    case 'node': {
      const { pos, radiusM } = city.nodes[selection.node]!;
      graphics.circle(pos.x, pos.y, Math.max(1, radiusM) + 0.65).stroke(stroke);
      break;
    }
    case 'place':
      placePath(
        graphics,
        shapes[selection.place]!,
        city.places[selection.place]!.kind,
        zoom,
      ).stroke(stroke);
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
  const stroke = {
    width: 2.7,
    color: style.route,
    alpha: 0.54,
    cap: 'round',
    join: 'round',
  } as const;
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
