import { Particle } from 'pixi.js';
import type { CompiledCity } from '../../network';
import { vehicleClasses } from '../../schema/city';
import { occupiedSpaces, parkedColour, pickParkedCar } from '../parked-cars';
import { style } from '../style';
import type { ParkedCarsSnapshot } from '../types';
import { createVehicleLayer, vehicleTextures } from './vehicles';
import type { Vec2 } from '../../geo/vec2';

export class ParkedCars {
  private readonly atlas = vehicleTextures();
  private city: CompiledCity | undefined;
  private layers: ReturnType<typeof createVehicleLayer>[] = [];
  private laneLayers: ReturnType<typeof createVehicleLayer>[] = [];
  private snapshot: ParkedCarsSnapshot | null = null;
  private spaces: number[] = [];
  private zoom = 1;
  private byClass = false;

  get count() {
    return this.spaces.length;
  }

  setGeometry(city: CompiledCity, layers: typeof this.layers, laneLayers: typeof this.layers) {
    this.city = city;
    this.layers = layers;
    this.laneLayers = laneLayers;
    this.setSnapshot(null);
  }

  setSnapshot(snapshot: ParkedCarsSnapshot | null) {
    this.snapshot = snapshot;
    this.spaces = occupiedSpaces(snapshot, this.city?.parkingSpaces?.length ?? 0);
    this.update();
  }

  setStyle(zoom: number, byClass: boolean) {
    if (
      this.byClass === byClass &&
      (this.zoom === zoom || (this.zoom >= style.detailZoom && zoom >= style.detailZoom))
    ) {
      this.zoom = zoom;
      return;
    }
    this.zoom = zoom;
    this.byClass = byClass;
    this.update();
  }

  private update() {
    for (const layer of this.layers) layer.count = 0;
    if (this.city && this.snapshot)
      for (const index of this.spaces) {
        const space = this.city.parkingSpaces![index]!;
        const layer = this.laneLayers[space.lane]!;
        const at = layer.count++;
        let particle = layer.pool[at];
        if (!particle) {
          particle = new Particle({ texture: this.atlas.textures.car, anchorX: 0.5, anchorY: 0.5 });
          layer.pool.push(particle);
        }
        const vehicleClass = vehicleClasses[this.snapshot.vclass[index]!]!;
        const dot = this.zoom < style.detailZoom;
        const texture = this.atlas.textures[dot ? 'dot' : vehicleClass];
        const dimensions = style.vehicleClasses[vehicleClass];
        particle.texture = texture;
        particle.x = space.position.x;
        particle.y = space.position.y;
        particle.rotation = space.heading;
        particle.tint = parkedColour(this.snapshot, index, this.byClass);
        const diameter = (2 * style.vehicleDotRadiusPx) / this.zoom;
        particle.scaleX = (dot ? diameter : dimensions.lengthM) / texture.width;
        particle.scaleY = (dot ? diameter : dimensions.widthM) / texture.height;
      }
    for (const layer of this.layers) {
      const children = layer.container.particleChildren;
      for (let i = 0; i < layer.count; i++) children[i] = layer.pool[i]!;
      children.length = layer.count;
      layer.container.update();
    }
  }

  pick(point: Vec2) {
    return this.city && this.snapshot
      ? pickParkedCar(this.city, this.spaces, this.snapshot, point, this.zoom)
      : null;
  }

  destroy() {
    for (const texture of Object.values(this.atlas.textures)) texture.destroy();
    this.atlas.atlas.destroy(true);
  }
}
