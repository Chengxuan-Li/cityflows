import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import { lampColors } from '../render/lighting';
import { beamTexture } from './lights';
import type { CompiledCity } from '../network';
import { style } from '../render/style';
import { vehicleClasses } from '../schema/city';
import { VehiclePoses, type PresentationSnapshot } from '../render/vehicle-pose';
import {
  heightAt,
  heightSlopeAt,
  roadStation,
  terrainVehicleOffset,
  type cityHeights,
} from './heights';
import { VehicleDetailBatches, vehicleShadowLayer, type VehicleDetailView } from './vehicle-detail';
import { buildVehicleModel, vehicleModelIndex, vehicleModelNames } from './vehicle-models';

/** TASK-163: head- and tail-lamps painted on each body's front and rear faces, in the unit box
 * (front face at x = 0, rear at x = -1, z across, y up) before the instance's scale. */
function vehicleMaterial(lights: { value: number }) {
  const material = new MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.vehicleLights = lights;
    shader.vertexShader =
      '#ifdef VEHICLE_LIGHTS\nvarying vec3 vBox; varying vec3 vBoxNormal;\n#endif\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n#ifdef VEHICLE_LIGHTS\nvBox = position; vBoxNormal = normal;\n#endif',
      );
    shader.fragmentShader =
      '#ifdef VEHICLE_LIGHTS\nuniform float vehicleLights; varying vec3 vBox; varying vec3 vBoxNormal;\n#endif\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef VEHICLE_LIGHTS
          float across = abs(vBox.z);
          float head = step(0.5, vBoxNormal.x) * step(0.16, across) * step(across, 0.46)
            * step(0.22, vBox.y) * step(vBox.y, 0.46);
          float tail = step(0.5, -vBoxNormal.x) * step(0.18, across) * step(across, 0.48)
            * step(0.3, vBox.y) * step(vBox.y, 0.52);
          totalEmissiveRadiance += vehicleLights
            * (head * vec3(1.6, 1.5, 1.3) + tail * vec3(1.4, 0.06, 0.04));
        #endif`,
      );
  };
  return material;
}

export class Vehicles3D {
  readonly poses = new VehiclePoses();
  private readonly lights = { value: 0 };
  private readonly geometry = new BoxGeometry(1, 1, 1).translate(-0.5, 0.5, 0);
  private readonly material = vehicleMaterial(this.lights);
  readonly modelGeometries = vehicleModelNames.map((_, i) => buildVehicleModel(i));
  mesh = this.createMesh(1024);
  /** Headlight beams on the road ahead, drawn from the bodies' own instance matrices. */
  readonly beams = this.createBeams();
  readonly group = new Group();
  private readonly detail = new VehicleDetailBatches(
    this.mesh,
    this.modelGeometries,
    false,
    this.lights,
  );
  private model = new Uint8Array(1024);
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private colourByClass = false;

  constructor() {
    this.group.add(this.mesh, this.beams, this.detail.group);
  }

  private createMesh(capacity: number) {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  private createBeams() {
    const material = new MeshBasicMaterial({
      map: beamTexture(),
      color: lampColors.street,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    material.userData.lit = true;
    // Ahead of the bumper by 1.3 body lengths and 1.4 body widths across, 2 cm over the road.
    const geometry = new PlaneGeometry(1.3, 1.4).rotateX(-Math.PI / 2).translate(0.65, 0.015, 0);
    const beams = new InstancedMesh(geometry, material, 1);
    beams.instanceMatrix = this.mesh.instanceMatrix;
    beams.count = 0;
    beams.frustumCulled = false;
    beams.visible = false;
    beams.renderOrder = 5;
    beams.name = 'vehicle-beams';
    return beams;
  }

  /** 0 turns the lamps off (the Day shader); above 0 they glow with that strength. */
  setLights(level: number) {
    const on = level > 0;
    const material = this.material;
    if (on !== (material.defines?.VEHICLE_LIGHTS !== undefined)) {
      material.defines = on ? { VEHICLE_LIGHTS: '' } : {};
      material.needsUpdate = true;
    }
    this.lights.value = level;
    this.beams.visible = on;
    (this.beams.material as MeshBasicMaterial).opacity = 0.55 * level;
  }

  setGeometry(city: CompiledCity, durationS?: number) {
    this.poses.setGeometry(city, durationS);
  }

  clear() {
    this.poses.snapshot = null;
    this.mesh.count = this.beams.count = 0;
    this.detail.clear();
  }

  setSnapshot(snapshot: PresentationSnapshot) {
    this.poses.update(snapshot);
    if (snapshot.count > this.mesh.instanceMatrix.count) {
      const previous = this.mesh;
      this.mesh = this.createMesh(2 ** Math.ceil(Math.log2(snapshot.count)));
      this.group.add(this.mesh);
      previous.removeFromParent();
      previous.dispose();
      this.beams.instanceMatrix = this.mesh.instanceMatrix;
      this.model = new Uint8Array(this.mesh.instanceMatrix.count);
    }
    this.detail.reserve(snapshot.count, (i) => {
      const model = vehicleModelIndex(snapshot.vclass[i]!, snapshot.id[i]!);
      this.model[i] = model;
      return model;
    });
    this.mesh.count = this.beams.count = snapshot.count;
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

  animate(
    elapsedS: number,
    city: CompiledCity,
    heights: ReturnType<typeof cityHeights>,
    view: VehicleDetailView,
  ) {
    const snapshot = this.poses.snapshot;
    if (!snapshot) return;
    if (view.active) this.detail.clear();
    this.detail.group.visible = view.active;
    this.mesh.layers.set(view.active ? vehicleShadowLayer : 0);
    const terrain = heights.terrain.grid;
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
      if (terrain) z += terrainVehicleOffset(city, heights, lane, pose);
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
      if (view.active)
        this.detail.append(
          view,
          i,
          this.transform.matrix,
          this.model[i]!,
          this.mesh.instanceColor!,
        );
    }
    if (view.active) this.detail.flush();
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  destroy() {
    this.detail.dispose();
    for (const geometry of this.modelGeometries) geometry.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.beams.geometry.dispose();
    (this.beams.material as MeshBasicMaterial).map?.dispose();
    (this.beams.material as MeshBasicMaterial).dispose();
    this.beams.dispose();
  }
}
