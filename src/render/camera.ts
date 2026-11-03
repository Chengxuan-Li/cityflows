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

  fitToBounds(bounds: Bounds, width: number, height: number, padding = 32): void {
    const { minX, minY, maxX, maxY } = bounds;
    this.scale = Math.min(
      style.maxZoom,
      Math.max(1, width - 2 * padding) / Math.max(1, maxX - minX),
      Math.max(1, height - 2 * padding) / Math.max(1, maxY - minY),
    );
    this.x = (width - (minX + maxX) * this.scale) / 2;
    this.y = (height - (minY + maxY) * this.scale) / 2;
    this.changed();
  }

  worldToScreen({ x, y }: Vec2): Vec2 {
    return { x: x * this.scale + this.x, y: y * this.scale + this.y };
  }

  screenToWorld({ x, y }: Vec2): Vec2 {
    return { x: (x - this.x) / this.scale, y: (y - this.y) / this.scale };
  }
}
