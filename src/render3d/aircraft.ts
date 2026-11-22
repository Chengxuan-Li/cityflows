import { Group, Mesh, Raycaster, Vector2, type Object3D, type PerspectiveCamera } from 'three';
import { aircraftTypes } from '../schema/aircraft';
import type { AircraftPose, Pick } from '../render/types';
import { buildAircraftMesh, type AircraftMesh } from './aircraft-mesh';

// TASK-298: TASK-307's aircraft models placed from the sim's poses: on the airside, and on the
// approaches and climbs over the empty surround beyond the map. Heights are above the airfield's
// elevation; the attitude is a plain pitch by state (TASK-301 drives gear, spinning parts and
// lights from the same poses).

const pitchDeg: Partial<Record<string, number>> = {
  approach: 2,
  flare: 4,
  rotation: 6,
  climb: 8,
  'go-around': 8,
};

export class Aircraft3D {
  readonly group = new Group();
  private readonly models = new Map<number, AircraftMesh>();
  constructor(private readonly elevationM: number) {
    this.group.name = 'aircraft';
  }

  update(poses: readonly AircraftPose[]) {
    const seen = new Set<number>();
    for (const pose of poses) {
      seen.add(pose.id);
      let model = this.models.get(pose.id);
      if (!model) {
        model = buildAircraftMesh(aircraftTypes.find((t) => t.id === pose.typeId)!);
        model.root.userData.aircraft = pose.id;
        this.models.set(pose.id, model);
        this.group.add(model.root);
      }
      model.root.position.set(pose.x, this.elevationM + pose.heightM, pose.y);
      model.root.rotation.set(
        0,
        -pose.heading,
        ((pitchDeg[pose.state] ?? 0) * Math.PI) / 180,
        'YXZ',
      );
      model.gear.visible = pose.gearDown;
    }
    for (const [id, model] of this.models)
      if (!seen.has(id)) {
        model.root.removeFromParent();
        model.root.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.geometry.dispose();
          for (const material of [object.material].flat()) material.dispose();
        });
        this.models.delete(id);
      }
  }

  get count() {
    return this.models.size;
  }

  pick(
    camera: PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Pick | null {
    if (!this.models.size) return null;
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2((2 * x) / width - 1, 1 - (2 * y) / height), camera);
    const hit = raycaster.intersectObject(this.group, true)[0];
    for (let object: Object3D | null = hit?.object ?? null; object; object = object.parent)
      if (object.userData.aircraft !== undefined)
        return { kind: 'aircraft', id: object.userData.aircraft as number };
    return null;
  }
}
