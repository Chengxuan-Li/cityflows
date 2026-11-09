import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import type { CompiledCity } from '../network';
import { style } from '../render/style';
import { vehicleClasses } from '../schema/city';
import { VehiclePoses, type PresentationSnapshot } from '../render/vehicle-pose';
import { heightAt, heightSlopeAt, roadStation, type cityHeights } from './heights';

export class Vehicles3D {
  readonly poses = new VehiclePoses();
  mesh = this.createMesh(1024);
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private colourByClass = false;

  private createMesh(capacity: number) {
    const geometry = new BoxGeometry(1, 1, 1).translate(-0.5, 0.5, 0);
    const mesh = new InstancedMesh(geometry, new MeshLambertMaterial(), capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  setGeometry(city: CompiledCity, durationS?: number) {
    this.poses.setGeometry(city, durationS);
  }

  setSnapshot(snapshot: PresentationSnapshot) {
    this.poses.update(snapshot);
    if (snapshot.count > this.mesh.instanceMatrix.count) {
      const previous = this.mesh;
      this.mesh = this.createMesh(2 ** Math.ceil(Math.log2(snapshot.count)));
      previous.parent!.add(this.mesh);
      previous.removeFromParent();
      previous.geometry.dispose();
      previous.material.dispose();
      previous.dispose();
    }
    this.mesh.count = snapshot.count;
    this.recolour();
  }

  setColourByClass(enabled: boolean) {
    if (this.colourByClass === enabled) return;
    this.colourByClass = enabled;
    this.recolour();
  }

  private recolour() {
    const snapshot = this.poses.snapshot;
    if (!snapshot) return;
    for (let i = 0; i < snapshot.count; i++) {
      this.color.setHex(
        this.colourByClass
          ? style.vehicleClasses[vehicleClasses[snapshot.vclass[i]!]!].color
          : (snapshot.vehicleHues?.[snapshot.id[i]! - 1] ?? style.driving),
      );
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  animate(elapsedS: number, city: CompiledCity, heights: ReturnType<typeof cityHeights>) {
    const snapshot = this.poses.snapshot;
    if (!snapshot) return;
    for (let i = 0; i < snapshot.count; i++) {
      const pose = this.poses.at(i, elapsedS);
      const lane = (snapshot.poseLane?.[i] ?? -1) >= 0 ? snapshot.poseLane![i]! : snapshot.lane[i]!;
      let z: number,
        slope = 0;
      if (lane < 0) {
        const movement = city.movements[-lane - 1]!;
        z = heights.nodes[movement.node]!;
        const before = heights.roads[city.lanes[movement.fromLane]!.road]!;
        if (!city.nodes[movement.node]!.outline.length)
          slope = heightSlopeAt(before, before.lengthM);
      } else {
        const road = city.roads[city.lanes[lane]!.road]!;
        const height = heights.roads[road.idx]!;
        const s = roadStation(road, pose);
        z = heightAt(height, s);
        slope = heightSlopeAt(height, s);
      }
      this.transform.position.set(pose.x, z, pose.y);
      this.transform.rotation.set(0, -pose.heading, Math.atan(slope), 'YXZ');
      const dimensions = style.vehicleClasses[vehicleClasses[snapshot.vclass[i]!]!];
      const fade = snapshot.fade[i]!;
      this.transform.scale.set(
        dimensions.lengthM * fade,
        dimensions.heightM * fade,
        dimensions.widthM * fade,
      );
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(i, this.transform.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  destroy() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
