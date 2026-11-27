import {
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  Raycaster,
  Vector2,
  Vector3,
  type DirectionalLight,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import { pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { gradeHeightM } from '../network/heights';
import { railHeightAt, railHeights } from '../network/rail';
import type { DebugProjector } from '../render/debug-canvas';
import type { DebugHeights, DebugItem, P3 } from '../render/debug-geometry';
import { heightAt, type cityHeights } from './heights';

type Heights = ReturnType<typeof cityHeights>;

/** TASK-381: the 3D scene's surface heights for the debug overlays, by the compiled city's
 * indices (the scene's painted city keeps them). */
export function sceneHeights(city: CompiledCity, heights: Heights): DebugHeights {
  const { roads, nodes, terrain } = heights;
  const ground = (p: Vec2) => terrain.groundAt(p.x, p.y);
  const rail = city.rail
    ? railHeights(
        city,
        city.roads.map((r) => r.grade),
        city.nodes.map((n) => n.grade),
      )
    : undefined;
  return {
    lane(index, vertex) {
      const road = city.roads[city.lanes[index]!.road]!;
      return heightAt(roads[road.idx]!, road.stations[vertex]! - road.stations[0]!);
    },
    node: (node) => nodes[node]!,
    level: (p, grade) => ground(p) + grade * gradeHeightM,
    rail(index, s) {
      const track = city.rail!.tracks[index]!;
      return (
        ground(pointAtDistance(track.line, track.cumulative, s)) + railHeightAt(rail!, track, s)
      );
    },
    ground,
  };
}

const ray = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();

/** World metres (x east, y south, z up) to the canvas's CSS pixels, for the overlay canvas. */
export function projector3D(
  camera: PerspectiveCamera,
  target: Vector3,
  width: number,
  height: number,
): DebugProjector {
  const m = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  ).elements;
  const distance = camera.position.distanceTo(target);
  // The ground the view shows: where rays through the screen's edges meet the target's level,
  // no farther than four times the camera's distance (toward the horizon: beyond, the overlays
  // are too small to read).
  const reach = distance * 4;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  };
  add(camera.position.x, camera.position.z);
  for (const u of [-1, 0, 1])
    for (const v of [-1, 0, 1]) {
      ray.setFromCamera(ndc.set(u, v), camera);
      const { origin, direction } = ray.ray;
      const t = direction.y < -1e-6 ? (target.y - origin.y) / direction.y : Infinity;
      if (t < reach) {
        hit.copy(origin).addScaledVector(direction, t);
        add(hit.x, hit.z);
      } else {
        const flat = Math.hypot(direction.x, direction.z) || 1;
        add(origin.x + (direction.x / flat) * reach, origin.z + (direction.z / flat) * reach);
      }
    }
  return {
    key: `${m.map((v) => v.toFixed(5)).join(',')},${width},${height}`,
    width,
    height,
    scale: height / (2 * Math.tan((camera.fov * Math.PI) / 360) * distance),
    bounds: box,
    project(x, y, z, out) {
      // Three's axes: x east, y up, z south.
      const w = m[3]! * x + m[7]! * z + m[11]! * y + m[15]!;
      if (w <= 1e-3) return false;
      out[0] = (((m[0]! * x + m[4]! * z + m[8]! * y + m[12]!) / w + 1) * width) / 2;
      out[1] = ((1 - (m[1]! * x + m[5]! * z + m[9]! * y + m[13]!) / w) * height) / 2;
      return true;
    },
  };
}

const box = new Box3();
const toP3 = (v: Vector3): P3 => ({ x: v.x, y: v.z, z: v.y });

/** TASK-381 Detail ranges: the shadow map's ground coverage (TASK-341's shading range), the
 * tree and car-model detail distances, and the bounding box of every drawn mesh. */
export function detailRanges({
  content,
  sun,
  target,
  cameraDistance,
  treeDetailM,
  carModels,
}: {
  content: Object3D;
  sun: DirectionalLight;
  target: Vector3;
  cameraDistance: number;
  treeDetailM: number;
  /** The camera depth within which cars are models, or null below their zoom. */
  carModels: { depthM: number; camera: Vector3 } | null;
}): DebugItem[] {
  const items: DebugItem[] = [];
  const shadow = sun.shadow.camera;
  shadow.updateMatrixWorld();
  const toward = new Vector3().subVectors(sun.position, sun.target.position).normalize();
  const reach = sun.position.distanceTo(sun.target.position);
  const corners = [
    [shadow.left, shadow.bottom],
    [shadow.right, shadow.bottom],
    [shadow.right, shadow.top],
    [shadow.left, shadow.top],
    [shadow.left, shadow.bottom],
  ].map(([x, y]) => {
    // A corner of the light's frustum where it passes the target, along the light to the ground.
    const p = new Vector3(x, y, -reach).applyMatrix4(shadow.matrixWorld);
    if (Math.abs(toward.y) > 1e-3) p.addScaledVector(toward, (target.y - p.y) / toward.y);
    return toP3(p);
  });
  items.push(
    {
      kind: 'line',
      points: corners,
      ink: 'amber',
      width: 2,
      dash: true,
      target: { label: `Shadow map: ${(shadow.right - shadow.left).toFixed(0)} m across` },
    },
    { kind: 'text', at: corners[3]!, text: 'Shadow map', ink: 'amber' },
  );
  const centre = toP3(target);
  items.push({
    kind: 'text',
    at: centre,
    text: `Trees ${cameraDistance < treeDetailM ? 'detailed' : 'simple'}: camera ${cameraDistance.toFixed(0)} m, detail within ${treeDetailM} m`,
    ink: 'green',
  });
  if (carModels) {
    const ring: P3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * 2 * Math.PI;
      ring.push({
        x: carModels.camera.x + carModels.depthM * Math.cos(a),
        y: carModels.camera.z + carModels.depthM * Math.sin(a),
        z: target.y,
      });
    }
    items.push({
      kind: 'line',
      points: ring,
      ink: 'teal',
      width: 2,
      target: { label: `Car models within ${carModels.depthM.toFixed(0)} m of the camera` },
    });
  } else
    items.push({
      kind: 'text',
      at: { ...centre, z: centre.z + 1 },
      text: 'Car models: boxes at this zoom',
      ink: 'teal',
    });
  content.traverseVisible((object) => {
    if (!(object instanceof Mesh) || !object.geometry) return;
    if (object instanceof InstancedMesh) {
      if (!object.count) return;
      if (!object.boundingBox) object.computeBoundingBox();
      box.copy(object.boundingBox!).applyMatrix4(object.matrixWorld);
    } else {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      box.copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld);
    }
    // City-wide merged meshes (ground, roads, buildings) span the view and tell nothing.
    if (
      box.isEmpty() ||
      Math.max(box.max.x - box.min.x, box.max.z - box.min.z) > 3 * cameraDistance
    )
      return;
    const { min, max } = box;
    const p = (x: number, y: number, z: number): P3 => ({ x, y: z, z: y });
    const bottom = [
      p(min.x, min.y, min.z),
      p(max.x, min.y, min.z),
      p(max.x, min.y, max.z),
      p(min.x, min.y, max.z),
    ];
    const top = bottom.map((q) => ({ ...q, z: max.y }));
    const triangles =
      (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
    const name = object.name || object.geometry.type;
    items.push({
      kind: 'line',
      points: [...bottom, bottom[0]!],
      ink: 'grey',
      width: 1,
      target: {
        label: `${name}: ${Math.round(triangles)} triangles${object instanceof InstancedMesh ? ` × ${object.count}` : ''}`,
      },
    });
    items.push({ kind: 'line', points: [...top, top[0]!], ink: 'grey', width: 1 });
    for (let i = 0; i < 4; i++)
      items.push({ kind: 'line', points: [bottom[i]!, top[i]!], ink: 'grey', width: 1 });
  });
  return items;
}
