import {
  Matrix4,
  Raycaster,
  Vector2,
  Vector3,
  type InstancedMesh,
  type PerspectiveCamera,
} from 'three';
import { style } from '../render/style';

export function vehicleScreenPoint(
  mesh: InstancedMesh,
  index: number,
  camera: PerspectiveCamera,
  width: number,
  height: number,
) {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  const point = new Vector3(0, 0.75, 0)
    .applyMatrix4(matrix)
    .applyMatrix4(mesh.matrixWorld)
    .project(camera);
  return { x: ((point.x + 1) * width) / 2, y: ((1 - point.y) * height) / 2, depth: point.z };
}

export function pickVehicle3D(
  mesh: InstancedMesh,
  camera: PerspectiveCamera,
  x: number,
  y: number,
  width: number,
  height: number,
): number | null {
  mesh.computeBoundingSphere();
  const raycaster = new Raycaster();
  const cast = (x: number, y: number) => {
    raycaster.setFromCamera(new Vector2((2 * x) / width - 1, 1 - (2 * y) / height), camera);
    return raycaster.intersectObject(mesh)[0]?.instanceId;
  };
  const hit = cast(x, y);
  if (hit !== undefined) return hit;
  // At overview scale a literal box can be less than a pixel wide. Match 2D's
  // CSS-pixel tolerance, then raycast the candidate's actual elevated centre.
  let nearest: number = style.vehiclePickRadiusPx,
    candidate: ReturnType<typeof vehicleScreenPoint> | undefined;
  for (let i = 0; i < mesh.count; i++) {
    const point = vehicleScreenPoint(mesh, i, camera, width, height);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (point.depth >= -1 && point.depth <= 1 && distance < nearest) {
      nearest = distance;
      candidate = point;
    }
  }
  return candidate ? (cast(candidate.x, candidate.y) ?? null) : null;
}
