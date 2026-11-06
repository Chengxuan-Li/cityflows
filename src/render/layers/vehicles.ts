import { Particle, ParticleContainer, Texture } from 'pixi.js';
import { headingAtDistance, pointAtDistance } from '../../geo/polyline';
import type { CLane, CMovement, CompiledCity } from '../../network';
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

type Segment = CLane | CMovement;

export function distanceAlong(segment: Segment, x: number, y: number): number {
  let nearest = Infinity;
  let distance = 0;
  for (let i = 1; i < segment.polyline.length; i++) {
    const a = segment.polyline[i - 1]!;
    const b = segment.polyline[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squared = dx * dx + dy * dy;
    if (!squared) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / squared));
    const error = (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
    if (error < nearest) {
      nearest = error;
      distance = segment.cumulative[i - 1]! + t * Math.sqrt(squared);
    }
  }
  return distance;
}

export function advanceAlong(segment: Segment, distance: number, speed: number, elapsedS: number) {
  const position = Math.min(segment.lengthM, distance + speed * elapsedS);
  return {
    ...pointAtDistance(segment.polyline, segment.cumulative, position),
    heading: headingAtDistance(segment.polyline, segment.cumulative, position),
  };
}

export function laneChangePose(
  lateralM: number,
  widthM: number,
  durationS: number,
  elapsedS: number,
) {
  if (lateralM === 0 || durationS === 0) return { lateral: 0, yaw: 0 };
  const progress = Math.min(1, Math.max(0, 1 - Math.abs(lateralM) / widthM + elapsedS / durationS));
  const smooth = progress * progress * (3 - 2 * progress);
  return {
    lateral: Math.sign(lateralM) * widthM * (1 - smooth),
    yaw: -Math.sign(lateralM) * 0.12 * 4 * progress * (1 - progress),
  };
}

export class Vehicles {
  private readonly textures = { car: vehicleTexture(false), dot: vehicleTexture(true) };
  private layers: VehicleLayer[] = [];
  private laneLayers: VehicleLayer[] = [];
  private movementLayers: VehicleLayer[] = [];
  private dot = false;
  private zoom = 1;
  private geometry: CompiledCity | undefined;
  private laneChangeDurationS = 0;
  private changeWidths = new Float32Array(0);
  private segments: Segment[] = [];
  private distances = new Float64Array(0);
  private particles: Particle[] = [];
  snapshot: VehicleSnapshot | null = null;
  x = new Float32Array(0);
  y = new Float32Array(0);

  setGeometry(city: CompiledCity, laneChangeDurationS = this.laneChangeDurationS): void {
    this.geometry = city;
    this.laneChangeDurationS = laneChangeDurationS;
  }

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

  update(snapshot: VehicleSnapshot & { vehicleHues?: Uint32Array; motionLane?: Int32Array }): void {
    this.snapshot = snapshot;
    const { count, id, lane, x, y, lateralM, fade, vehicleHues } = snapshot;
    if (this.x.length < count) {
      this.x = new Float32Array(count);
      this.y = new Float32Array(count);
      this.distances = new Float64Array(count);
      this.changeWidths = new Float32Array(count);
    }

    for (const layer of this.layers) layer.count = 0;
    for (let i = 0; i < count; i++) {
      const laneIndex = lane[i]!;
      const layer = (
        laneIndex >= 0 ? this.laneLayers[laneIndex] : this.movementLayers[-laneIndex - 1]
      )!;
      const index = layer.count++;
      const motionLane = snapshot.motionLane?.[i] ?? laneIndex;
      const segment =
        motionLane >= 0
          ? this.geometry!.lanes[motionLane]!
          : this.geometry!.movements[-motionLane - 1]!;
      this.segments[i] = segment;
      this.distances[i] = distanceAlong(segment, x[i]!, y[i]!);
      if (motionLane >= 0 && lateralM[i] !== 0) {
        const target = this.geometry!.lanes[motionLane]!;
        const source = this.geometry!.lanes[lateralM[i]! > 0 ? target.right : target.left]!;
        this.changeWidths[i] = (source.widthM + target.widthM) / 2;
      }
      let particle = layer.pool[index];
      if (!particle) {
        particle = new Particle({ texture: this.textures.car, anchorX: 0.5, anchorY: 0.5 });
        this.size(particle);
        layer.pool.push(particle);
      }
      this.particles[i] = particle;

      const tint = vehicleHues?.[id[i]! - 1] ?? style.driving;
      if (particle.tint !== tint) particle.tint = tint;
      if (particle.alpha !== fade[i]) particle.alpha = fade[i]!;
    }
    this.segments.length = this.particles.length = count;
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
      const pose =
        elapsedS > 0
          ? advanceAlong(this.segments[i]!, this.distances[i]!, snapshot.speed[i]!, elapsedS)
          : { x: snapshot.x[i]!, y: snapshot.y[i]!, heading: snapshot.heading[i]! };
      const { lateral, yaw } = laneChangePose(
        snapshot.lateralM[i]!,
        this.changeWidths[i]!,
        this.laneChangeDurationS,
        elapsedS,
      );
      const particle = this.particles[i]!;
      particle.x = this.x[i] = pose.x - Math.sin(pose.heading) * lateral;
      particle.y = this.y[i] = pose.y + Math.cos(pose.heading) * lateral;
      particle.rotation = pose.heading + yaw;
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
