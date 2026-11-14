import { Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity } from '../../network';
import { vehicleClasses, type VehicleClass } from '../../schema/city';
import { style } from '../style';
import { VehiclePoses, type PresentationSnapshot } from '../vehicle-pose';
import { vehicleLightSprite } from './night';
export { advanceAlong, distanceAlong, laneChangePose } from '../vehicle-pose';

export function vehicleTextures() {
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
    // TASK-162: a rim at half the tint's brightness, so every system colour keeps an edge of at
    // least 4.5:1 on white and pale yellow streets.
    for (const [fill, d] of [
      ['#808080', 0],
      ['#ffffff', 4],
    ] as const) {
      const box = (x: number, top: number, w: number, h: number, r: number) =>
        context.roundRect(x + d, top + d, w - 2 * d, h - 2 * d, Math.max(0, r - d));
      context.fillStyle = fill;
      context.beginPath();
      if (vehicleClass === 'truck') {
        box(8, y + 1, width * 0.73, 46, 3);
        box(8 + width * 0.76, y + 3, width * 0.24, 42, 7);
      } else if (vehicleClass === 'van') {
        box(8, y, width * 0.79, 48, 5);
        box(8 + width * 0.74, y + 5, width * 0.26, 38, 8);
      } else box(8, y, width, 48, vehicleClass === 'car' ? 24 : 9);
      context.fill();
    }
    context.fillStyle = '#c7c7cc';
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
  for (const [fill, r] of [
    ['#808080', 16],
    ['#ffffff', 11],
  ] as const) {
    context.fillStyle = fill;
    context.beginPath();
    context.arc(24, 288, r, 0, Math.PI * 2);
    context.fill();
  }
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
  /** TASK-163: head- and tail-light sprites, one per vehicle, while the night layer draws.
   * TASK-184: `containers` runs parallel to `layers`, so a deck above covers the lights below. */
  private lights: { containers: ParticleContainer[]; vehicle: Texture; glow: Texture } | null =
    null;
  private lightParticles: Particle[] = [];
  private lightGroups: Particle[][] = [];
  private layerIndex = new Map<VehicleLayer, number>();
  private vehicleLayer: number[] = [];
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
    this.layerIndex = new Map(layers.map((layer, i) => [layer, i]));
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
    if (this.lights && this.snapshot) this.updateLights(this.snapshot);
  }

  /** Draw vehicle lights into `lights.containers`, or stop with null. */
  setLights(lights: { containers: ParticleContainer[]; vehicle: Texture; glow: Texture } | null) {
    if (lights === this.lights) return;
    for (const container of this.lights?.containers ?? []) {
      container.particleChildren = [];
      container.update();
    }
    this.lights = lights;
    if (lights && this.snapshot) this.updateLights(this.snapshot);
  }

  private updateLights(snapshot: PresentationSnapshot) {
    const lights = this.lights!;
    const { length, front, across } = vehicleLightSprite;
    const groups = lights.containers.map((_, i) => (this.lightGroups[i] ??= []));
    for (const group of groups) group.length = 0;
    for (let i = 0; i < snapshot.count; i++) {
      const particle = (this.lightParticles[i] ??= new Particle({ texture: lights.vehicle }));
      const dimensions = style.vehicleClasses[vehicleClasses[snapshot.vclass[i]!]!];
      if (this.dot) {
        // Overview dots: a soft glow around each.
        const size = (2.4 * 2 * style.vehicleDotRadiusPx) / this.zoom / lights.glow.width;
        particle.texture = lights.glow;
        particle.anchorX = particle.anchorY = 0.5;
        particle.scaleX = particle.scaleY = size;
      } else {
        particle.texture = lights.vehicle;
        particle.anchorX = front / length;
        particle.anchorY = 0.5;
        particle.scaleX = (dimensions.lengthM * length) / lights.vehicle.width;
        particle.scaleY = (dimensions.widthM * across) / lights.vehicle.height;
      }
      particle.alpha = snapshot.fade[i]!;
      groups[this.vehicleLayer[i]!]!.push(particle);
    }
    this.animateLights();
    for (const [i, container] of lights.containers.entries()) {
      container.particleChildren = groups[i]!.slice();
      container.texture = this.dot ? lights.glow : lights.vehicle;
      container.update();
    }
  }

  private animateLights() {
    const count = this.lights ? (this.snapshot?.count ?? 0) : 0;
    for (let i = 0; i < count; i++) {
      const particle = this.lightParticles[i]!,
        body = this.particles[i]!;
      particle.x = body.x;
      particle.y = body.y;
      particle.rotation = body.rotation;
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
      const laneIndex = (snapshot.poseLane?.[i] ?? -1) >= 0 ? snapshot.poseLane![i]! : lane[i]!;
      const layer = (
        laneIndex >= 0 ? this.laneLayers[laneIndex] : this.movementLayers[-laneIndex - 1]
      )!;
      this.vehicleLayer[i] = this.layerIndex.get(layer)!;
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
    // Lights first: animating places one light per vehicle, so there must be enough of them.
    if (this.lights) this.updateLights(snapshot);
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
    this.animateLights();
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
