import type { Vec2 } from '../geo/vec2';
import { style } from './style';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  private x = 0;
  private y = 0;
  private scale = 1;

  constructor(private readonly changed: () => void = () => {}) {}

  get zoom(): number {
    return this.scale;
  }

  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.changed();
  }

  zoomAt(pointer: Vec2, factor: number): void {
    const world = this.screenToWorld(pointer);
    this.scale = Math.min(style.maxZoom, Math.max(style.minZoom, this.scale * factor));
    this.x = pointer.x - world.x * this.scale;
    this.y = pointer.y - world.y * this.scale;
    this.changed();
  }

  /** Fits `bounds` (world) into `area` (screen pixels), centred, as large as it fits. */
  fitToBounds(bounds: Bounds, area: Bounds): void {
    const { minX, minY, maxX, maxY } = bounds;
    this.scale = Math.min(
      style.maxZoom,
      Math.max(1, area.maxX - area.minX) / Math.max(1, maxX - minX),
      Math.max(1, area.maxY - area.minY) / Math.max(1, maxY - minY),
    );
    this.x = (area.minX + area.maxX - (minX + maxX) * this.scale) / 2;
    this.y = (area.minY + area.maxY - (minY + maxY) * this.scale) / 2;
    this.changed();
  }

  worldToScreen({ x, y }: Vec2): Vec2 {
    return { x: x * this.scale + this.x, y: y * this.scale + this.y };
  }

  screenToWorld({ x, y }: Vec2): Vec2 {
    return { x: (x - this.x) / this.scale, y: (y - this.y) / this.scale };
  }
}

/** The bounds of a set of points. */
export function boundsOf(points: readonly Vec2[]): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { x, y } of points) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}

/** A view `frameView` can steer: where a world point shows, a zoom about the view's centre, and
 *  a pan of the whole view by screen pixels. */
export interface FramedView {
  worldToScreen(point: Vec2): Vec2;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
}

/** TASK-203: zooms and pans `view` until the points' screen bounds fill `area` (screen pixels) in
 *  one direction and are centred in it. In perspective the bounds change shape as the view zooms
 *  and pans, so the steps repeat until the zoom settles; an orthographic view settles at once. */
export function frameView(points: readonly Vec2[], area: Bounds, view: FramedView): void {
  const onScreen = () => boundsOf(points.map((p) => view.worldToScreen(p)));
  for (let i = 0; i < 32; i++) {
    let shown = onScreen();
    const factor = Math.min(
      (area.maxX - area.minX) / Math.max(1e-6, shown.maxX - shown.minX),
      (area.maxY - area.minY) / Math.max(1e-6, shown.maxY - shown.minY),
    );
    view.zoomBy(factor);
    shown = onScreen();
    view.panBy(
      (area.minX + area.maxX - shown.minX - shown.maxX) / 2,
      (area.minY + area.maxY - shown.minY - shown.maxY) / 2,
    );
    if (Math.abs(factor - 1) < 1e-4) return;
  }
}
