import Flatbush from 'flatbush';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Raycaster,
  ShapeUtils,
  Uint8BufferAttribute,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { segmentDistance } from '../geo/polyline';
import type { DebugPoint, DebugPrimitive } from '../render/debug-geometry';
import type { Pick } from '../render/types';
import type { Terrain } from './terrain';

interface BatchData {
  positions: number[];
  colours: number[];
}
interface PickItem {
  id: string;
  pick?: Pick;
  point: boolean;
  first: number;
  end: number;
}
interface TextAnchor {
  at: Vector3;
  text: string;
  color: string;
}

const inks = new Map<number, number[]>();
function linearInk(hex: number) {
  let ink = inks.get(hex);
  if (!ink) {
    const c = new Color(hex);
    inks.set(hex, (ink = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]));
  }
  return ink;
}

function geometry(data: BatchData) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  g.setAttribute('color', new Uint8BufferAttribute(data.colours, 3, true));
  return g;
}

const projectedA = new Vector3(),
  projectedB = new Vector3(),
  from = new Vector2(),
  to = new Vector2();

/** Each enabled network costs at most one line, point and triangle submission. Picking uses
 * the same packed world vertices; the spatial index is built on first hover. */
export class DebugBatch {
  readonly group = new Group();
  readonly labels: TextAnchor[] = [];
  private readonly items: PickItem[] = [];
  private readonly paths: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly nodes: Points<BufferGeometry, PointsMaterial>;
  private readonly fills: Mesh<BufferGeometry, MeshBasicMaterial>;
  private index?: Flatbush;
  private minHeight = Infinity;
  private maxHeight = -Infinity;

  constructor(primitives: readonly DebugPrimitive[], terrain: Terrain) {
    const lines: BatchData = { positions: [], colours: [] },
      points: BatchData = { positions: [], colours: [] },
      faces: BatchData = { positions: [], colours: [] };
    for (const item of primitives) {
      const path = item.points;
      if (!path.length) continue;
      const at = path[0]!;
      const y = (p: DebugPoint) => terrain.groundAt(p.x, p.y) + (p.z ?? 0) + 0.12;
      if (item.kind === 'label') {
        if (item.text)
          this.labels.push({
            at: new Vector3(at.x, y(at), at.y),
            text: item.text,
            color: '#' + item.color.toString(16).padStart(6, '0'),
          });
        continue;
      }
      const isPoint = item.kind === 'point';
      const data = isPoint ? points : lines;
      const first = data.positions.length / 3;
      const ink = linearInk(item.color);
      const add = (to: BatchData, p: DebugPoint) => {
        to.positions.push(p.x, y(p), p.y);
        to.colours.push(ink[0]!, ink[1]!, ink[2]!);
      };
      if (isPoint) add(points, at);
      else if (item.fill) {
        const contour = path.map((p) => new Vector2(p.x, p.y));
        // Earcut triangulates concave junctions as well as bends in a road surface.
        for (const triangle of ShapeUtils.triangulateShape(contour, []))
          for (const i of triangle) add(faces, path[i]!);
      } else {
        for (let i = 1; i < path.length; i++) {
          add(lines, path[i - 1]!);
          add(lines, path[i]!);
        }
      }
      if (item.id && data.positions.length > first * 3)
        this.items.push({
          id: item.id,
          pick: item.pick,
          point: isPoint,
          first,
          end: data.positions.length / 3,
        });
    }
    this.paths = new LineSegments(
      geometry(lines),
      new LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }),
    );
    this.fills = new Mesh(
      geometry(faces),
      new MeshBasicMaterial({
        vertexColors: true,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.nodes = new Points(
      geometry(points),
      new PointsMaterial({
        vertexColors: true,
        size: 5,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    // Round, screen-sized nodes at every zoom.
    this.nodes.material.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif(length(gl_PointCoord - vec2(.5)) > .5) discard;',
      );
    };
    this.fills.renderOrder = -3;
    this.paths.renderOrder = 1;
    this.nodes.renderOrder = 2;
    for (const obj of [this.fills, this.paths, this.nodes])
      if (obj.geometry.getAttribute('position').count) this.group.add(obj);
  }

  private buildIndex() {
    const index = new Flatbush(this.items.length);
    for (const item of this.items) {
      const pos = (item.point ? this.nodes : this.paths).geometry.getAttribute('position');
      let x = Infinity,
        z = Infinity,
        x1 = -Infinity,
        z1 = -Infinity;
      for (let i = item.first; i < item.end; i++) {
        x = Math.min(x, pos.getX(i));
        z = Math.min(z, pos.getZ(i));
        x1 = Math.max(x1, pos.getX(i));
        z1 = Math.max(z1, pos.getZ(i));
        this.minHeight = Math.min(this.minHeight, pos.getY(i));
        this.maxHeight = Math.max(this.maxHeight, pos.getY(i));
      }
      index.add(x, z, x1, z1);
    }
    index.finish();
    return index;
  }

  hit(
    camera: PerspectiveCamera,
    ray: Raycaster,
    x: number,
    y: number,
    width: number,
    height: number,
    best: number,
  ) {
    if (!this.items.length) return;
    this.index ??= this.buildIndex();
    const { origin, direction } = ray.ray;
    // Intersect the pointer cone with the height slab, then project only nearby candidates.
    const t0 = (this.minHeight - origin.y) / direction.y,
      t1 = (this.maxHeight - origin.y) / direction.y;
    const near = Math.max(camera.near, Math.min(t0, t1));
    const far = Math.min(camera.far, Math.max(t0, t1));
    if (far < near || !Number.isFinite(far)) return;
    const a = ray.ray.at(near, projectedA),
      b = ray.ray.at(far, projectedB);
    const pad =
      (2 * best * Math.tan((camera.fov * Math.PI) / 360) * far) /
      (height * Math.max(0.01, Math.abs(direction.y)));
    const candidates = this.index.search(
      Math.min(a.x, b.x) - pad,
      Math.min(a.z, b.z) - pad,
      Math.max(a.x, b.x) + pad,
      Math.max(a.z, b.z) + pad,
    );
    let hit: PickItem | undefined;
    const project = (p: Vector3, screen: Vector2) => {
      p.project(camera);
      screen.set(((p.x + 1) * width) / 2, ((1 - p.y) * height) / 2);
    };
    const cursor = { x, y };
    for (const idx of candidates) {
      const item = this.items[idx]!;
      const pos = (item.point ? this.nodes : this.paths).geometry.getAttribute('position');
      for (let i = item.first; i < item.end; i += item.point ? 1 : 2) {
        projectedA.fromBufferAttribute(pos, i);
        project(projectedA, from);
        if (item.point && (projectedA.z < -1 || projectedA.z > 1)) continue;
        let d = Math.max(0, Math.hypot(from.x - x, from.y - y) - 2.5);
        if (!item.point) {
          projectedB.fromBufferAttribute(pos, i + 1);
          project(projectedB, to);
          if (Math.max(projectedA.z, projectedB.z) < -1 || Math.min(projectedA.z, projectedB.z) > 1)
            continue;
          d = segmentDistance(cursor, from, to);
        }
        if (d < best || (d === best && item.point)) {
          best = d;
          hit = item;
        }
      }
    }
    if (hit) return { id: hit.id, pick: hit.pick, distance: best };
  }

  dispose() {
    for (const o of [this.fills, this.paths, this.nodes]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.group.removeFromParent();
  }
}
