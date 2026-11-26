import {
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';

// TASK-359: aircraft parts that share a geometry are drawn together, one instanced draw per
// geometry and material instead of one draw per aircraft and part. Each part stays in its
// aircraft's tree, where it is placed, shown or hidden and picked as before, on a layer the
// cameras do not draw. Instances are not culled to the view: the batches are drawn whole.

/** The layer of the parts the batches draw: raycasts enable it, cameras and lights do not (layer 1
 * is `vehicleShadowLayer`, which the sun draws). */
export const batchedLayer = 2;

/** A part of an aircraft drawn by a batch: one instance per material in `materials`, with the
 * aircraft's per-instance attribute values (`values`, by attribute name, read every frame). Parts
 * of one geometry and first material share the rest of `materials` too. */
export interface BatchedPart {
  mesh: Mesh;
  materials: Material[];
  values?: Record<string, number[]>;
}

interface Batch {
  geometry: BufferGeometry;
  materials: Material[];
  meshes: InstancedMesh[];
  /** This frame's instances: their matrices in the batches' group, and parts. */
  matrices: Matrix4[];
  parts: BatchedPart[];
}

export class AircraftBatches {
  readonly group = new Group();
  private readonly batches = new Map<BufferGeometry, Map<Material, Batch>>();
  private readonly pool: Matrix4[] = [];
  private casting = false;

  constructor() {
    this.group.name = 'aircraft-batches';
    this.group.matrixAutoUpdate = false;
  }

  /** Collects the visible parts, in their aircraft's order, and fills the batches. The batches'
   * group sits in `frame`, the aircraft roots' parent, with an identity matrix. */
  draw(parts: Iterable<BatchedPart>, frame: Object3D) {
    for (const batch of this.all()) {
      for (const matrix of batch.matrices) this.pool.push(matrix);
      batch.matrices.length = batch.parts.length = 0;
    }
    for (const part of parts) {
      if (!shown(part.mesh, frame)) continue;
      const batch = this.batchOf(part);
      batch.matrices.push(place(part.mesh, frame, this.pool.pop() ?? new Matrix4()));
      batch.parts.push(part);
    }
    for (const batch of this.all()) this.fill(batch);
  }

  /** Whether the batches cast sun shadows, as the parts' own meshes did. */
  setCasting(casting: boolean) {
    this.casting = casting;
    for (const batch of this.all()) for (const mesh of batch.meshes) mesh.castShadow = casting;
  }

  private *all() {
    for (const byMaterial of this.batches.values()) yield* byMaterial.values();
  }

  private batchOf({ mesh, materials }: BatchedPart) {
    let byMaterial = this.batches.get(mesh.geometry);
    if (!byMaterial) this.batches.set(mesh.geometry, (byMaterial = new Map()));
    let batch = byMaterial.get(materials[0]!);
    if (!batch) {
      batch = { geometry: mesh.geometry, materials, meshes: [], matrices: [], parts: [] };
      byMaterial.set(materials[0]!, batch);
    }
    return batch;
  }

  private fill(batch: Batch) {
    const count = batch.matrices.length;
    let meshes = batch.meshes;
    if (!meshes[0] || meshes[0].instanceMatrix.count < count) {
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      const capacity = Math.max(4, 2 ** Math.ceil(Math.log2(count)));
      meshes = batch.meshes = batch.materials.map((material) => {
        const mesh = new InstancedMesh(batch.geometry, material, capacity);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = this.casting;
        if (material.userData.depth) mesh.customDepthMaterial = material.userData.depth;
        this.group.add(mesh);
        return mesh;
      });
      // The batch's meshes share one set of instances.
      for (const mesh of meshes) mesh.instanceMatrix = meshes[0]!.instanceMatrix;
      const values = batch.parts[0]?.values ?? {};
      for (const [name, value] of Object.entries(values))
        batch.geometry.setAttribute(
          name,
          new InstancedBufferAttribute(new Float32Array(capacity * value.length), value.length),
        );
    }
    const matrices = meshes[0]!.instanceMatrix;
    batch.matrices.forEach((matrix, i) => matrix.toArray(matrices.array, i * 16));
    batch.parts.forEach(({ values }, i) => {
      for (const name in values) {
        const attribute = batch.geometry.getAttribute(name) as InstancedBufferAttribute;
        (attribute.array as Float32Array).set(values[name]!, i * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    });
    if (count) matrices.needsUpdate = true;
    for (const mesh of meshes) {
      mesh.count = count;
      mesh.visible = count > 0;
    }
  }
}

/** Whether the part and every parent up to `frame` are shown. */
function shown(mesh: Mesh, frame: Object3D) {
  for (let object: Object3D = mesh; object !== frame; object = object.parent!)
    if (!object.visible) return false;
  return true;
}

/** The part's matrix in `frame`, bringing the local matrices of moving parents up to date. */
function place(mesh: Mesh, frame: Object3D, matrix: Matrix4) {
  matrix.copy(mesh.matrix);
  for (let object = mesh.parent!; object !== frame; object = object.parent!) {
    if (object.matrixAutoUpdate) object.updateMatrix();
    matrix.premultiply(object.matrix);
  }
  return matrix;
}
