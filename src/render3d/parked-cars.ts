import { BoxGeometry, Color, InstancedMesh, MeshLambertMaterial, Object3D } from 'three';
import type { CompiledCity } from '../network';
import { occupiedSpaces, parkedColour } from '../render/parked-cars';
import { style } from '../render/style';
import type { ParkedCarsSnapshot } from '../render/types';
import { vehicleClasses } from '../schema/city';
import { heightAt, roadStation, terrainVehicleOffset, type cityHeights } from './heights';

export class ParkedCars3D {
  readonly mesh: InstancedMesh<BoxGeometry, MeshLambertMaterial>;
  private snapshot: ParkedCarsSnapshot | null = null;
  private spaces: number[] = [];
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private byClass = false;
  private zoom = 1;

  constructor(
    private readonly city: CompiledCity,
    private readonly heights: ReturnType<typeof cityHeights>,
  ) {
    this.mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshLambertMaterial(),
      city.parkingSpaces?.length ?? 0,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // Static parked stock does not enter the moving-car shadow pass.
    this.mesh.receiveShadow = true;
  }

  get count() {
    return this.spaces.length;
  }
  spaceAt(instance: number) {
    return this.spaces[instance]!;
  }
  instanceOf(space: number) {
    return this.spaces.indexOf(space);
  }

  setSnapshot(snapshot: ParkedCarsSnapshot | null) {
    this.snapshot = snapshot;
    this.spaces = occupiedSpaces(snapshot, this.city.parkingSpaces?.length ?? 0);
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
    this.mesh.count = this.spaces.length;
    if (!this.snapshot) return;
    for (const [instance, index] of this.spaces.entries()) {
      const space = this.city.parkingSpaces![index]!;
      const road = this.city.roads[this.city.lanes[space.lane]!.road]!;
      const z =
        heightAt(this.heights.roads[road.idx]!, roadStation(road, space.position)) +
        terrainVehicleOffset(this.city, this.heights, space.lane, space.position);
      this.transform.position.set(space.position.x, z + 0.015, space.position.y);
      this.transform.rotation.set(0, -space.heading, 0);
      const dimensions = style.vehicleClasses[vehicleClasses[this.snapshot.vclass[index]!]!];
      const dot = this.zoom < style.detailZoom;
      const diameter = (2 * style.vehicleDotRadiusPx) / this.zoom;
      this.transform.scale.set(
        dot ? diameter : dimensions.lengthM,
        dot ? 0.2 : dimensions.heightM,
        dot ? diameter : dimensions.widthM,
      );
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(instance, this.transform.matrix);
      this.color.setHex(parkedColour(this.snapshot, index, this.byClass));
      this.mesh.setColorAt(instance, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
