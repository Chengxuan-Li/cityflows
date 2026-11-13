import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
} from 'three';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { parkingColor, parkingRadiusM } from '../render/parking';
import { style } from '../render/style';

export class Parking3D {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly ring = new Mesh(
    new RingGeometry(1, 1.15, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: style.selection, depthTest: false, depthWrite: false }),
  );
  private lastZoom = NaN;
  private lastSelected: number | null = null;

  constructor(
    private readonly city: CompiledCity,
    private readonly heightAt: (p: Vec2) => number,
  ) {
    this.mesh = new InstancedMesh(
      new BoxGeometry(2, 0.08, 2),
      new MeshBasicMaterial({ depthTest: false, depthWrite: false }),
      city.parking.length,
    );
    this.mesh.renderOrder = 8;
    this.ring.renderOrder = 9;
    // TASK-163: map overlays keep their colours after dark.
    (this.mesh.material as MeshBasicMaterial).userData.lit = this.ring.material.userData.lit = true;
    this.ring.visible = false;
    this.group.add(this.mesh, this.ring);
    this.setCounts(null);
    this.update(1, null);
  }

  setCounts(counts: ArrayLike<number> | null) {
    const color = new Color();
    for (const facility of this.city.parking)
      this.mesh.setColorAt(
        facility.idx,
        color.setHex(parkingColor(counts?.[facility.idx] ?? 0, facility.capacity)),
      );
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(zoom: number, selected: number | null) {
    if (zoom === this.lastZoom && selected === this.lastSelected) return;
    this.lastZoom = zoom;
    this.lastSelected = selected;
    const radius = Math.max(parkingRadiusM, 7 / zoom);
    const transform = new Object3D();
    for (const facility of this.city.parking) {
      const p = facility.centroid;
      transform.position.set(p.x, this.heightAt(p) + 1, p.y);
      transform.scale.set(radius, 1, radius);
      transform.updateMatrix();
      this.mesh.setMatrixAt(facility.idx, transform.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    const facility = selected === null ? undefined : this.city.parking[selected];
    this.ring.visible = Boolean(facility);
    if (facility) {
      const p = facility.centroid;
      this.ring.position.set(p.x, this.heightAt(p) + 1.1, p.y);
      this.ring.scale.setScalar(radius + 2 / zoom);
    }
  }
}
