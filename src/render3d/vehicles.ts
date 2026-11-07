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
import { VehiclePoses, type PresentationSnapshot } from '../render/vehicle-pose';
import { heightAt, roadStation, type cityHeights } from './heights';

export class Vehicles3D {
  readonly poses = new VehiclePoses();
  mesh = this.createMesh(1024);
  private readonly transform = new Object3D();
  private readonly color = new Color();

  private createMesh(capacity: number) {
    const geometry = new BoxGeometry(4.5, 1.5, 1.8).translate(0, 0.75, 0);
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
    for (let i = 0; i < snapshot.count; i++) {
      this.color.setHex(snapshot.vehicleHues?.[snapshot.id[i]! - 1] ?? style.driving);
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  animate(elapsedS: number, city: CompiledCity, heights: ReturnType<typeof cityHeights>) {
    const snapshot = this.poses.snapshot;
    if (!snapshot) return;
    for (let i = 0; i < snapshot.count; i++) {
      const pose = this.poses.at(i, elapsedS);
      const lane = snapshot.lane[i]!;
      let z: number,
        slope = 0;
      if (lane < 0) z = heights.nodes[city.movements[-lane - 1]!.node]!;
      else {
        const road = city.roads[city.lanes[lane]!.road]!;
        const height = heights.roads[road.idx]!;
        const s = roadStation(road, pose);
        z = heightAt(height, s);
        slope = (heightAt(height, s + 0.1) - heightAt(height, s - 0.1)) / 0.2;
      }
      this.transform.position.set(pose.x, z, pose.y);
      this.transform.rotation.set(0, -pose.heading, Math.atan(slope), 'YXZ');
      this.transform.scale.setScalar(snapshot.fade[i]!);
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
