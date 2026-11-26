import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  baggageCart,
  groundVehicleKinds,
  groundVehicleSizes,
  type GroundVehicleKind,
  type GroundVehiclePose,
} from '../sim/ground-vehicles';
import { GroundVehicleTracks, shownVehicle } from '../render/ground-vehicles';
import { style } from '../render/style';
import type { AircraftPose } from '../render/types';
import { pointHalos } from './airfield-lights';

// TASK-316: airside ground vehicles in 3D: one instanced mesh per kind (a few boxes each, vertex
// coloured) and one for baggage carts, so the whole fleet costs seven draw calls; amber beacons
// on the roofs as halos, brighter at night.

const CAPACITY = 256;
const BEACON = 0xffa21a;

type Part = [x: number, y: number, length: number, height: number, width: number, color: number];

/** Boxes in vehicle metres: +x forward, y up; the body sits on 0.4 m wheels. */
function parts(kind: GroundVehicleKind): Part[] {
  const { lengthM: l, widthM: w, heightM: h } = groundVehicleSizes[kind];
  const { body, accent } = style.groundVehicle[kind];
  const dark = 0x3a4550;
  switch (kind) {
    case 'tug':
      return [
        [0, 0.35, l, 0.7, w, dark],
        [0, 0.71, l, 0.45, w, body],
        [0.85, 1.15, 1.25, 0.62, 1.7, dark],
      ];
    case 'baggage':
      return [
        [0, 0.45, l, 0.6, w, body],
        [-0.4, 1.25, 1.2, 1, w - 0.1, accent],
      ];
    case 'fuel':
      return [
        [0, 0.55, l, 0.3, w, dark],
        [l / 2 - 1.1, 1.5, 2.2, 2, w, body],
        [-1.1, 1.75, l - 2.6, 1.9, w - 0.2, accent],
        [-1.1, 2.75, l - 2.8, 0.1, w - 0.4, body],
      ];
    case 'hydrant':
      return [
        [0, 0.6, l, 0.5, w, body],
        [l / 2 - 1, 1.5, 2, 1.4, w, body],
        [-1, 1.6, 2.6, 1.6, 1.6, accent],
        [-1, h - 0.1, 3.6, 0.2, w, dark],
      ];
    case 'catering':
      return [
        [0, 0.55, l, 0.3, w, dark],
        [l / 2 - 1.1, 1.45, 2.2, 1.9, w, accent],
        [-1.1, 2.15, l - 2.6, 2.5, w, body],
      ];
    case 'bus':
      return [
        [0, 0.65, l, 0.5, w, dark],
        [0, 1.95, l, 2.1, w, body],
        [0, 2.1, l - 0.3, 0.9, w + 0.02, accent],
        [l / 2 - 0.05, 2.1, 0.12, 1.4, w - 0.3, 0x1e2a35],
      ];
  }
}

function geometryOf(boxes: Part[]): BufferGeometry {
  const color = new Color();
  const pieces = boxes.map(([x, y, l, h, w, hex]) => {
    const box = new BoxGeometry(l, h, w).translate(x, y, 0);
    color.setHex(hex);
    const colors = new Float32Array(box.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    box.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return box;
  });
  const merged = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  return merged;
}

export class GroundVehicles3D {
  readonly group = new Group();
  private readonly tracks = new GroundVehicleTracks();
  private readonly meshes = new Map<GroundVehicleKind | 'cart', InstancedMesh>();
  private readonly beacons = pointHalos(CAPACITY, 1.2, 0.3);
  private readonly transform = new Object3D();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private aircraft = new Map<number, AircraftPose>();
  private clockS = 0;
  private renderedAgeS = NaN;
  constructor(private readonly elevationM: number) {
    this.group.name = 'ground-vehicles';
    this.group.matrixAutoUpdate = false;
    const cart: Part[] = [
      [0, 0.45, baggageCart.lengthM, 0.3, baggageCart.widthM, 0x5b6670],
      [
        0,
        1.15,
        baggageCart.lengthM - 0.2,
        1.1,
        baggageCart.widthM - 0.1,
        style.groundVehicle.cart.body,
      ],
    ];
    for (const kind of [...groundVehicleKinds, 'cart' as const]) {
      const mesh = new InstancedMesh(
        geometryOf(kind === 'cart' ? cart : parts(kind)),
        this.material,
        CAPACITY,
      );
      mesh.name = `ground-${kind}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
    this.beacons.mesh.name = 'ground-vehicle-beacons';
    this.beacons.centres.setUsage(DynamicDrawUsage);
    this.group.add(this.beacons.mesh);
    this.setLight(0);
  }

  update(
    poses: readonly GroundVehiclePose[],
    aircraft: readonly AircraftPose[],
    timeS: number,
    playbackSpeed = 0,
  ) {
    this.tracks.update(poses, timeS, playbackSpeed);
    this.aircraft = new Map(aircraft.map((a) => [a.id, a]));
    this.renderedAgeS = NaN;
  }

  /** Places the instances at `ageS` after the newest snapshot; beacons turn with `dtS`. */
  animate(ageS: number, dtS: number, playing: boolean) {
    const moved = this.tracks.sample(ageS, playing);
    this.clockS += dtS;
    if (!moved && ageS === this.renderedAgeS && dtS === 0) return false;
    this.renderedAgeS = ageS;
    const counts = new Map<string, number>();
    const { transform } = this;
    const put = (key: GroundVehicleKind | 'cart', x: number, y: number, heading: number) => {
      const mesh = this.meshes.get(key)!;
      const i = counts.get(key) ?? 0;
      if (i >= CAPACITY) return;
      transform.position.set(x, this.elevationM, y);
      transform.rotation.set(0, -heading, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      counts.set(key, i + 1);
    };
    const { centres, tints, geometry } = this.beacons;
    let beacon = 0;
    const amber = new Color(BEACON);
    for (const pose of this.tracks.poses) {
      if (!shownVehicle(pose, this.aircraft)) continue;
      put(pose.kind, pose.x, pose.y, pose.heading);
      for (const cart of pose.carts) put('cart', cart.x, cart.y, cart.heading);
      // A rotating beacon: on for most of each 0.8 s turn, phase by id.
      const on = (this.clockS + pose.id * 0.37) % 0.8 < 0.5;
      if (on && beacon < CAPACITY) {
        const size = groundVehicleSizes[pose.kind];
        centres.setXYZW(beacon, pose.x, this.elevationM + size.heightM + 0.25, pose.y, 0.7);
        tints.setXYZ(beacon++, amber.r, amber.g, amber.b);
      }
    }
    for (const [key, mesh] of this.meshes) {
      mesh.count = counts.get(key) ?? 0;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }
    geometry.instanceCount = beacon;
    if (beacon) centres.needsUpdate = tints.needsUpdate = true;
    return true;
  }

  get count() {
    return this.tracks.poses.length;
  }

  /** Whether beacons turn, so the scene keeps drawing frames. */
  get animating() {
    return this.tracks.poses.length > 0;
  }

  setLight(on: number) {
    this.beacons.material.uniforms.intensity!.value = 0.35 + 0.9 * on;
    this.renderedAgeS = NaN;
  }

  setPixelScale(scale: number) {
    this.beacons.material.uniforms.pixelScale!.value = scale;
  }

  /** Instances by kind, for tests and the canvas dataset. */
  report() {
    return Object.fromEntries([...this.meshes].map(([key, mesh]) => [key, mesh.count]));
  }
}
