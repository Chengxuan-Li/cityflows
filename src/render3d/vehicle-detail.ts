import {
  DynamicDrawUsage,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Sphere,
  Vector3,
  type BufferGeometry,
  type MeshLambertMaterial,
  type PerspectiveCamera,
} from 'three';
import { vehicleModelMaterial } from './vehicle-models';

const modelPixelsPerMetre = 6;
// Keep the normal overview path cheap. Below half the model scale, even the near
// pavement at the bottom of the usual view has little room to show wheel detail.
export const vehicleDetailZoom = modelPixelsPerMetre / 2;
export const vehicleShadowLayer = 1;

export class VehicleDetailView {
  private readonly projection = new Matrix4();
  private readonly previous = new Matrix4();
  private readonly frustum = new Frustum();
  private readonly sphere = new Sphere();
  private depth = 0;
  private camera!: PerspectiveCamera;
  active = false;

  /** TASK-375: the camera depth within which cars are drawn as models, while active. */
  get depthM() {
    return this.depth;
  }

  update(camera: PerspectiveCamera, zoom: number, distance: number) {
    const active = zoom >= vehicleDetailZoom;
    const toggled = this.active !== active;
    this.active = active;
    if (!active) return toggled;
    this.camera = camera;
    this.depth = (distance * zoom) / modelPixelsPerMetre;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!toggled && this.previous.equals(this.projection)) return false;
    this.previous.copy(this.projection);
    this.frustum.setFromProjectionMatrix(this.projection);
    return true;
  }

  /** The bounding sphere encloses the old box and every detailed model. */
  level(matrix: Matrix4, centred: boolean) {
    const e = matrix.elements;
    const centre = this.sphere.center.set(e[12]!, e[13]!, e[14]!);
    if (!centred) centre.addScaledVector(this.sphereOffset.set(e[0]!, e[1]!, e[2]!), -0.5);
    centre.addScaledVector(this.sphereOffset.set(e[4]!, e[5]!, e[6]!), 0.5);
    this.sphere.radius =
      0.5 *
      Math.sqrt(
        e[0]! ** 2 +
          e[1]! ** 2 +
          e[2]! ** 2 +
          e[4]! ** 2 +
          e[5]! ** 2 +
          e[6]! ** 2 +
          e[8]! ** 2 +
          e[9]! ** 2 +
          e[10]! ** 2,
      );
    if (this.sphere.radius === 0 || !this.frustum.intersectsSphere(this.sphere)) return -1;
    const v = this.camera.matrixWorldInverse.elements;
    const depth = -(v[2]! * centre.x + v[6]! * centre.y + v[10]! * centre.z + v[14]!);
    return Number(depth <= this.depth);
  }

  private readonly sphereOffset = new Vector3();
}

/** One instanced draw per populated model, plus the cars still far enough to be boxes. */
export class VehicleDetailBatches {
  readonly group = new Group();
  private readonly models: InstancedMesh<BufferGeometry, MeshLambertMaterial>[];
  private readonly material: MeshLambertMaterial;
  private readonly capacities: Uint32Array;
  private readonly matrix = new Matrix4();
  private readonly receiveShadow: boolean;

  constructor(
    base: InstancedMesh<BufferGeometry, MeshLambertMaterial>,
    geometries: readonly BufferGeometry[],
    private readonly centred: boolean,
    kerbSide: { value: number },
    lights?: { value: number },
  ) {
    this.receiveShadow = base.receiveShadow;
    this.material = vehicleModelMaterial(kerbSide, lights);
    this.models = [
      ...geometries.map((geometry) => this.makeMesh(geometry, this.material, 0)),
      this.makeMesh(base.geometry, base.material, 0),
    ];
    this.capacities = new Uint32Array(this.models.length);
    this.group.add(...this.models);
    this.group.visible = false;
  }

  private makeMesh(geometry: BufferGeometry, material: MeshLambertMaterial, count: number) {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(
      DynamicDrawUsage,
    );
    mesh.frustumCulled = false;
    mesh.receiveShadow = this.receiveShadow;
    mesh.count = 0;
    return mesh;
  }

  reserve(count: number, classify: (i: number) => number) {
    const far = this.models.length - 1;
    this.capacities.fill(0);
    this.capacities[far] = count;
    for (let i = 0; i < count; i++) this.capacities[classify(i)]!++;
    for (let i = 0; i <= far; i++) {
      const old = this.models[i]!,
        needed = this.capacities[i]!;
      if (needed <= old.instanceMatrix.count) continue;
      const mesh = this.makeMesh(old.geometry, old.material, 2 ** Math.ceil(Math.log2(needed)));
      old.removeFromParent();
      old.dispose();
      this.group.add(mesh);
      this.models[i] = mesh;
    }
  }

  clear() {
    for (const mesh of this.models) mesh.count = 0;
  }

  append(
    view: VehicleDetailView,
    i: number,
    matrix: Matrix4,
    model: number,
    colours: InstancedBufferAttribute,
  ) {
    const level = view.level(matrix, this.centred);
    if (level < 0) return;
    const mesh = this.models[level ? model : this.models.length - 1]!;
    if (level && this.centred) {
      // The parking transform is centred in the space. Put the shared model's
      // front bumper half a length ahead of that point.
      this.matrix.copy(matrix);
      const e = this.matrix.elements;
      e[12]! += e[0]! / 2;
      e[13]! += e[1]! / 2;
      e[14]! += e[2]! / 2;
      matrix = this.matrix;
    }
    const instance = mesh.count++;
    mesh.setMatrixAt(instance, matrix);
    mesh.instanceColor!.copyAt(instance, colours, i);
  }

  flush() {
    for (const mesh of this.models) {
      mesh.visible = mesh.count > 0;
      if (!mesh.count) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  dispose() {
    for (const mesh of this.models) mesh.dispose();
    this.material.dispose();
  }
}
