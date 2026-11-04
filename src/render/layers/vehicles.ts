import { Particle, ParticleContainer, Texture } from 'pixi.js';
import { style } from '../style';
import type { VehicleSnapshot } from '../types';

function vehicleTexture(dot: boolean): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = dot ? 32 : 72;
  canvas.height = dot ? 32 : 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.beginPath();
  if (dot) context.arc(16, 16, 16, 0, Math.PI * 2);
  else context.roundRect(0, 0, 72, 32, 16);
  context.fill();
  if (!dot) {
    context.fillStyle = '#c1c9c8';
    context.beginPath();
    context.roundRect(47, 6, 10, 20, 4);
    context.fill();
  }
  return Texture.from(canvas);
}

export function createVehicleLayer() {
  return {
    container: new ParticleContainer({
      dynamicProperties: { position: true, rotation: true, color: true },
    }),
    pool: [] as Particle[],
    count: 0,
  };
}

type VehicleLayer = ReturnType<typeof createVehicleLayer>;

export class Vehicles {
  private readonly textures = { car: vehicleTexture(false), dot: vehicleTexture(true) };
  private layers: VehicleLayer[] = [];
  private laneLayers: VehicleLayer[] = [];
  private movementLayers: VehicleLayer[] = [];
  private dot = false;
  private zoom = 1;
  snapshot: VehicleSnapshot | null = null;
  x = new Float32Array(0);
  y = new Float32Array(0);

  setLayers(
    layers: VehicleLayer[],
    laneLayers: VehicleLayer[],
    movementLayers: VehicleLayer[],
  ): void {
    this.layers = layers;
    this.laneLayers = laneLayers;
    this.movementLayers = movementLayers;
    this.snapshot = null;
  }

  setZoom(zoom: number): void {
    const dot = zoom < style.detailZoom;
    const changed = this.dot !== dot || (dot && zoom !== this.zoom);
    this.dot = dot;
    this.zoom = zoom;
    if (!changed) return;
    for (const { pool, container } of this.layers) {
      for (const particle of pool) this.size(particle);
      container.texture = this.dot ? this.textures.dot : this.textures.car;
      container.update();
    }
  }

  update(snapshot: VehicleSnapshot & { vehicleHues?: Uint32Array }): void {
    this.snapshot = snapshot;
    const { count, id, lane, x, y, heading, lateralM, vehicleHues } = snapshot;
    if (this.x.length < count) {
      this.x = new Float32Array(count);
      this.y = new Float32Array(count);
    }

    for (const layer of this.layers) layer.count = 0;
    for (let i = 0; i < count; i++) {
      const laneIndex = lane[i]!;
      const layer = (
        laneIndex >= 0 ? this.laneLayers[laneIndex] : this.movementLayers[-laneIndex - 1]
      )!;
      const index = layer.count++;
      let particle = layer.pool[index];
      if (!particle) {
        particle = new Particle({ texture: this.textures.car, anchorX: 0.5, anchorY: 0.5 });
        this.size(particle);
        layer.pool.push(particle);
      }

      const angle = heading[i]!;
      const lateral = lateralM[i]!;
      particle.x = this.x[i] = lateral === 0 ? x[i]! : x[i]! - Math.sin(angle) * lateral;
      particle.y = this.y[i] = lateral === 0 ? y[i]! : y[i]! + Math.cos(angle) * lateral;
      particle.rotation = angle;
      const tint = vehicleHues?.[id[i]! - 1] ?? style.driving;
      if (particle.tint !== tint) particle.tint = tint;
    }
    for (const { count, container, pool } of this.layers) {
      const children = container.particleChildren;
      if (children.length === count) continue;
      for (let i = children.length; i < count; i++) children[i] = pool[i]!;
      children.length = count;
      container.update();
    }
  }

  private size(particle: Particle): void {
    const texture = this.dot ? this.textures.dot : this.textures.car;
    const diameter = (2 * style.vehicleDotRadiusPx) / this.zoom;
    particle.texture = texture;
    particle.scaleX = (this.dot ? diameter : style.vehicleLengthM) / texture.width;
    particle.scaleY = (this.dot ? diameter : style.vehicleWidthM) / texture.height;
  }

  destroy(): void {
    this.textures.car.destroy(true);
    this.textures.dot.destroy(true);
  }
}
