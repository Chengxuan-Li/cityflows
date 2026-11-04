import { Container, Graphics } from 'pixi.js';
import type { CompiledCity } from '../../network';
import { style } from '../style';
import type { VehicleSnapshot } from '../types';

/** A single ramp from the plain road tone to dark teal: darker roads carry slower traffic. */
export function heatColor(ratio: number): number {
  const t = Math.max(0, Math.min(1, ratio));
  let color = 0;
  for (const shift of [16, 8, 0]) {
    const slow = (style.selection >> shift) & 255;
    const fast = (style.asphalt >> shift) & 255;
    color |= Math.round(slow + (fast - slow) * t) << shift;
  }
  return color;
}

export class HeatLayer {
  readonly roads = new Container();
  readonly queues = new Container();
  private roadShapes: Graphics[] = [];
  private queueShapes: Graphics[] = [];
  private counts = new Uint32Array(0);
  private ends: { x: number; y: number }[] = [];

  setCity(city: CompiledCity): void {
    for (const container of [this.roads, this.queues]) {
      for (const child of container.removeChildren()) child.destroy({ context: true });
    }
    this.roadShapes = city.roads.map(({ surface }) => {
      const shape = new Graphics().poly(surface).fill(0xffffff);
      shape.alpha = 0.7;
      shape.visible = false;
      this.roads.addChild(shape);
      return shape;
    });
    this.counts = new Uint32Array(city.lanes.length);
    this.ends = city.lanes.map(({ polyline }) => polyline.at(-1)!);
    this.queueShapes = this.ends.map(({ x, y }) => {
      const shape = new Graphics().circle(0, 0, 1).fill(style.selection);
      shape.position.set(x, y);
      shape.alpha = 0.85;
      shape.visible = false;
      this.queues.addChild(shape);
      return shape;
    });
  }

  setHeat(ratios: ArrayLike<number> | null): void {
    for (let i = 0; i < this.roadShapes.length; i++) {
      const shape = this.roadShapes[i]!;
      const ratio = ratios?.[i];
      shape.visible = ratio !== undefined && Number.isFinite(ratio);
      if (shape.visible) shape.tint = heatColor(ratio!);
    }
  }

  setQueues(snapshot: VehicleSnapshot): void {
    this.counts.fill(0);
    for (let i = 0; i < snapshot.count; i++) {
      const lane = snapshot.lane[i]!;
      if (lane < 0 || snapshot.speed[i]! >= 0.5) continue;
      const end = this.ends[lane]!;
      const dx = snapshot.x[i]! - end.x;
      const dy = snapshot.y[i]! - end.y;
      // Count stopped cars within 50 m of the lane end; exclude mid-block connector queues.
      if (dx * dx + dy * dy <= 2500) this.counts[lane] = this.counts[lane]! + 1;
    }
    for (let i = 0; i < this.queueShapes.length; i++) {
      const shape = this.queueShapes[i]!;
      const count = this.counts[i]!;
      shape.visible = count >= 2;
      if (shape.visible) shape.scale.set(1.5 + Math.sqrt(count));
    }
  }
}
