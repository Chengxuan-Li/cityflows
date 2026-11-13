import {
  Matrix4,
  Raycaster,
  Vector2,
  Vector3,
  type InstancedMesh,
  type PerspectiveCamera,
} from 'three';
import { distance, nearestOnPolyline } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { gradeProfiles, profileHeightAt, roadStation } from '../network/heights';
import { style } from '../render/style';
import type { Pick } from '../render/types';

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

/** TASK-175: the lane drawn under a screen point in 3D. Each lane's centreline is projected at its
 * surface height (every 5 m on a ramp) and hit within half its projected width (at least 3 px);
 * where lanes overlap on screen the highest grade wins, as in the 2D picker. Lanes below ground
 * count only with "See below ground". */
export function pickLane3D(
  city: CompiledCity,
  screen: Vec2,
  project: (p: Vec2, heightM: number) => Vec2,
  belowGround = false,
): Pick | null {
  const profiles = gradeProfiles(city).roads;
  let hit: Pick | null = null,
    grade = -Infinity,
    best = Infinity;
  for (const lane of city.lanes) {
    if ((lane.grade < 0 && !belowGround) || lane.grade < grade) continue;
    const road = city.roads[lane.road]!,
      profile = profiles[road.idx]!;
    const flat = !profile.fromM && !profile.toM && !profile.deckM;
    const points: Vec2[] = [lane.polyline[0]!];
    for (let i = 1; i < lane.polyline.length; i++) {
      const a = lane.polyline[i - 1]!,
        b = lane.polyline[i]!,
        steps = flat ? 1 : Math.max(1, Math.ceil(distance(a, b) / 5));
      for (let j = 1; j <= steps; j++)
        points.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
    }
    const heights = points.map((p) => (flat ? 0 : profileHeightAt(profile, roadStation(road, p))));
    const line = points.map((p, i) => project(p, heights[i]!));
    const { along, away } = nearestOnPolyline(line, screen);
    let i = 1,
      at = 0;
    while (i < line.length - 1 && at + distance(line[i - 1]!, line[i]!) < along)
      at += distance(line[i - 1]!, line[i++]!);
    const a = points[i - 1]!,
      b = points[i]!,
      length = distance(a, b) || 1;
    const side = {
      x: a.x - ((b.y - a.y) / length) * (lane.widthM / 2),
      y: a.y + ((b.x - a.x) / length) * (lane.widthM / 2),
    };
    const half = Math.max(3, distance(line[i - 1]!, project(side, heights[i - 1]!)));
    if (away > half || (lane.grade === grade && away >= best)) continue;
    grade = lane.grade;
    best = away;
    hit = { kind: 'lane', lane: lane.idx, road: road.idx };
  }
  return hit;
}
