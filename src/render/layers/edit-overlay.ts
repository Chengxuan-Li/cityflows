import type { Graphics } from 'pixi.js';
import type { Vec2 } from '../../geo/vec2';
import { style } from '../style';

export interface EditOverlay {
  polygon?: { ring: readonly Vec2[]; color: number };
  lines?: readonly (readonly Vec2[])[];
  vertices?: readonly Vec2[];
  snap?: { pos: Vec2; kind: 'node' | 'road' };
  handles?: readonly Vec2[];
}

export function drawEditOverlay(graphics: Graphics, overlay: EditOverlay | null, zoom: number) {
  graphics.clear();
  if (!overlay) return;
  if (overlay.polygon) {
    graphics
      .poly([...overlay.polygon.ring])
      .fill({ color: overlay.polygon.color, alpha: 0.45 })
      .stroke({ color: overlay.polygon.color, width: 5 / zoom, alpha: 0.25, join: 'round' });
  }
  for (const line of overlay.lines ?? []) {
    if (line.length < 2) continue;
    graphics
      .poly([...line], false)
      .stroke({ color: style.selection, width: 4 / zoom, alpha: 0.6, cap: 'round', join: 'round' });
  }
  for (const pos of overlay.vertices ?? [])
    graphics.circle(pos.x, pos.y, 3 / zoom).fill(style.selection);
  for (const pos of overlay.handles ?? [])
    graphics
      .circle(pos.x, pos.y, 6 / zoom)
      .fill(style.background)
      .stroke({ color: style.selection, width: 2 / zoom });
  if (overlay.snap) {
    const { pos, kind } = overlay.snap;
    if (kind === 'node') graphics.circle(pos.x, pos.y, 10 / zoom);
    else graphics.rect(pos.x - 7 / zoom, pos.y - 7 / zoom, 14 / zoom, 14 / zoom);
    graphics
      .fill({ color: style.selection, alpha: 0.15 })
      .stroke({ color: style.selection, width: 2 / zoom });
  }
}
