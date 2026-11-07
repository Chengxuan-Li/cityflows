import { Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity } from '../../network';
import { vehicleClasses, type VehicleClass } from '../../schema/city';
import { style } from '../style';
import { VehiclePoses, type PresentationSnapshot } from '../vehicle-pose';
export { advanceAlong, distanceAlong, laneChangePose } from '../vehicle-pose';

function vehicleTextures() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 5 * 64;
  const context = canvas.getContext('2d')!;
  const frames: Record<string, Rectangle> = {};
  for (const [index, vehicleClass] of vehicleClasses.entries()) {
    const { lengthM, widthM } = style.vehicleClasses[vehicleClass];
    const width = Math.round((lengthM / widthM) * 48);
    const y = index * 64 + 8;
    frames[vehicleClass] = new Rectangle(8, y, width, 48);
    context.fillStyle = '#ffffff';
    context.beginPath();
    if (vehicleClass === 'truck') {
      context.roundRect(8, y + 1, width * 0.73, 46, 3);
      context.roundRect(8 + width * 0.76, y + 3, width * 0.24, 42, 7);
    } else if (vehicleClass === 'van') {
      context.roundRect(8, y, width * 0.79, 48, 5);
      context.roundRect(8 + width * 0.74, y + 5, width * 0.26, 38, 8);
    } else context.roundRect(8, y, width, 48, vehicleClass === 'car' ? 24 : 9);
    context.fill();
    context.fillStyle = '#c1c9c8';
    context.beginPath();
    context.roundRect(8 + width * 0.79, y + 9, width * 0.08, 30, 3);
    if (vehicleClass === 'bus') {
      for (let window = 0; window < 6; window++) {
        context.roundRect(22 + window * 29, y + 4, 17, 5, 2);
        context.roundRect(22 + window * 29, y + 39, 17, 5, 2);
      }
    }
    context.fill();
  }
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(24, 288, 16, 0, Math.PI * 2);
  context.fill();
  frames.dot = new Rectangle(8, 272, 32, 32);
  const atlas = Texture.from(canvas);
  const textures = Object.fromEntries(
    Object.entries(frames).map(([key, frame]) => [
      key,
      new Texture({ source: atlas.source, frame }),
    ]),
  ) as Record<VehicleClass | 'dot', Texture>;
  return { atlas, textures };
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
  private readonly atlas = vehicleTextures();
  private readonly textures = this.atlas.textures;
  private readonly classes = new WeakMap<Particle, VehicleClass>();
  private colourByClass = false;
  private layers: VehicleLayer[] = [];
  private laneLayers: VehicleLayer[] = [];
  private movementLayers: VehicleLayer[] = [];
  private dot = false;
  private zoom = 1;
  private readonly poses = new VehiclePoses();
  private particles: Particle[] = [];
  get snapshot() {
    return this.poses.snapshot;
  }
  x = new Float32Array(0);
  y = new Float32Array(0);

  setGeometry(city: CompiledCity, laneChangeDurationS?: number): void {
    this.poses.setGeometry(city, laneChangeDurationS);
  }

  setLayers(
    layers: VehicleLayer[],
    laneLayers: VehicleLayer[],
    movementLayers: VehicleLayer[],
  ): void {
    this.layers = layers;
    this.laneLayers = laneLayers;
    this.movementLayers = movementLayers;
    this.poses.snapshot = null;
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

  setColourByClass(enabled: boolean): void {
    if (this.colourByClass === enabled) return;
    this.colourByClass = enabled;
    if (this.snapshot) this.update(this.snapshot);
  }

  update(snapshot: PresentationSnapshot): void {
    this.poses.update(snapshot);
    const { count, id, lane, fade, vehicleHues, vclass } = snapshot;
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
        layer.pool.push(particle);
      }
      const vehicleClass = vehicleClasses[vclass[i]!]!;
      if (this.classes.get(particle) !== vehicleClass) {
        this.classes.set(particle, vehicleClass);
        this.size(particle);
        layer.container.update();
      }
      this.particles[i] = particle;

      const tint = this.colourByClass
        ? style.vehicleClasses[vehicleClass].color
        : (vehicleHues?.[id[i]! - 1] ?? style.driving);
      if (particle.tint !== tint) particle.tint = tint;
      if (particle.alpha !== fade[i]) particle.alpha = fade[i]!;
    }
    this.particles.length = count;
    this.animate(0);
    for (const { count, container, pool } of this.layers) {
      const children = container.particleChildren;
      if (children.length === count) continue;
      for (let i = children.length; i < count; i++) children[i] = pool[i]!;
      children.length = count;
      container.update();
    }
  }

  animate(elapsedS: number): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    for (let i = 0; i < snapshot.count; i++) {
      const pose = this.poses.at(i, elapsedS);
      const particle = this.particles[i]!;
      particle.x = this.x[i] = pose.x;
      particle.y = this.y[i] = pose.y;
      particle.rotation = pose.heading;
    }
  }

  pickBody(point: Vec2): number | null {
    const snapshot = this.snapshot;
    if (this.dot || !snapshot) return null;
    for (let i = snapshot.count - 1; i >= 0; i--) {
      const particle = this.particles[i]!;
      const dx = point.x - particle.x;
      const dy = point.y - particle.y;
      const cos = Math.cos(particle.rotation);
      const sin = Math.sin(particle.rotation);
      const longitudinal = dx * cos + dy * sin;
      const lateral = -dx * sin + dy * cos;
      const length = particle.texture.width * particle.scaleX;
      const width = particle.texture.height * particle.scaleY;
      if (longitudinal >= -length && longitudinal <= 0 && Math.abs(lateral) <= width / 2)
        return snapshot.id[i]!;
    }
    return null;
  }

  private size(particle: Particle): void {
    const vehicleClass = this.classes.get(particle)!;
    const texture = this.dot ? this.textures.dot : this.textures[vehicleClass];
    const dimensions = style.vehicleClasses[vehicleClass];
    const diameter = (2 * style.vehicleDotRadiusPx) / this.zoom;
    particle.texture = texture;
    particle.anchorX = this.dot ? 0.5 : 1;
    particle.scaleX = (this.dot ? diameter : dimensions.lengthM) / texture.width;
    particle.scaleY = (this.dot ? diameter : dimensions.widthM) / texture.height;
  }

  destroy(): void {
    for (const texture of Object.values(this.textures)) texture.destroy();
    this.atlas.atlas.destroy(true);
  }
}
