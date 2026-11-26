import {
  Box3,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Vector3,
  type DirectionalLight,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { treeDetailDistanceM } from './vegetation';
import { vehicleModelPixelsPerMetre } from './vehicle-detail';

const boxEdges = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];

/** Mesh bounds and the actual shadow, tree-distance and projected vehicle-detail limits. */
export class DebugRanges {
  readonly lines = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private readonly instances = new WeakMap<
    InstancedMesh,
    { count: number; version: number; box: Box3 }
  >();
  private readonly bounds = new Box3();
  private readonly corners = Array.from({ length: 8 }, () => new Vector3());

  constructor() {
    this.lines.frustumCulled = false;
  }

  update(
    scene: Scene,
    camera: PerspectiveCamera,
    sun: DirectionalLight,
    centre: Vector3,
    canvasHeight: number,
  ) {
    const positions: number[] = [],
      colours: number[] = [];
    let ink = new Color(0x798fab);
    const edge = (a: Vector3, b: Vector3) => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      colours.push(ink.r, ink.g, ink.b, ink.r, ink.g, ink.b);
    };
    const corners = this.corners;
    const box = () => {
      for (const [a, b] of boxEdges) edge(corners[a!]!, corners[b!]!);
    };
    scene.updateMatrixWorld();
    scene.traverseVisible((mesh) => {
      if (
        !(mesh instanceof Mesh) ||
        !mesh.layers.test(camera.layers) ||
        !mesh.geometry.attributes.position?.count
      )
        return;
      const geom = mesh.geometry;
      if (mesh instanceof InstancedMesh) {
        if (!mesh.count) return;
        let cached = this.instances.get(mesh);
        if (
          !cached ||
          cached.count !== mesh.count ||
          cached.version !== mesh.instanceMatrix.version
        ) {
          // Dynamic instances may have changed since Three last computed their bounds.
          mesh.computeBoundingBox();
          cached = {
            count: mesh.count,
            version: mesh.instanceMatrix.version,
            box: mesh.boundingBox!,
          };
          this.instances.set(mesh, cached);
        }
        this.bounds.copy(cached.box);
      } else {
        if (geom.boundingBox === null) geom.computeBoundingBox();
        this.bounds.copy(geom.boundingBox!);
      }
      if (this.bounds.isEmpty()) return;
      const { min, max } = this.bounds;
      for (let i = 0; i < 8; i++)
        corners[i]!.set(
          i & 1 ? max.x : min.x,
          i & 2 ? max.y : min.y,
          i & 4 ? max.z : min.z,
        ).applyMatrix4(mesh.matrixWorld);
      box();
    });
    ink.setHex(0xffb523);
    sun.shadow.updateMatrices(sun);
    for (let i = 0; i < 8; i++)
      corners[i]!.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).unproject(sun.shadow.camera);
    box();

    // The tree switch uses camera-to-target distance. Three great circles mark that sphere.
    ink.setHex(0x28ab72);
    const a = corners[0]!,
      b = corners[1]!;
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i <= 64; i++) {
        b.copy(centre);
        b.setComponent(
          axis,
          b.getComponent(axis) + treeDetailDistanceM * Math.cos((i * Math.PI) / 32),
        );
        const next = (axis + 1) % 3;
        b.setComponent(
          next,
          b.getComponent(next) + treeDetailDistanceM * Math.sin((i * Math.PI) / 32),
        );
        if (i) edge(a, b);
        a.copy(b);
      }
    }
    // Vehicles use camera depth (pixels per metre), so the boundary is a frustum slice.
    ink.setHex(0xf557a8);
    const scale = Math.tan((camera.fov * Math.PI) / 360);
    const depth = canvasHeight / (2 * scale * vehicleModelPixelsPerMetre);
    for (let i = 0; i < 4; i++)
      corners[i]!.set(
        (i & 1 ? 1 : -1) * scale * depth * camera.aspect,
        (i & 2 ? 1 : -1) * scale * depth,
        -depth,
      ).applyMatrix4(camera.matrixWorld);
    for (const [i, j] of [
      [0, 1],
      [1, 3],
      [3, 2],
      [2, 0],
    ])
      edge(corners[i!]!, corners[j!]!);
    const geom = this.lines.geometry;
    const count = positions.length / 3;
    if ((geom.getAttribute('position')?.count ?? 0) < count) {
      geom.dispose();
      const capacity = 2 ** Math.ceil(Math.log2(count));
      for (const name of ['position', 'color'])
        geom.setAttribute(
          name,
          new Float32BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage),
        );
    }
    for (const [name, values] of [
      ['position', positions],
      ['color', colours],
    ] as const) {
      const attr = geom.getAttribute(name) as Float32BufferAttribute;
      attr.array.set(values);
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, values.length);
      attr.needsUpdate = true;
    }
    geom.setDrawRange(0, count);
  }
  dispose() {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
