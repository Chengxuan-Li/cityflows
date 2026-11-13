import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { catenary, catenaryRule, type Catenary } from '../network/catenary';
import { cityGrades } from '../render/grades';
import { catenaryColors, catenaryZooms } from '../render/layers/catenary';
import type { cityHeights } from './heights';

/** Sizes in metres: mast and beam sections, the portal beam's clearance over the messenger. */
const size = {
  mast: 0.32,
  tramMast: 0.24,
  portalDepth: 0.5,
  portalWidth: 0.3,
  arm: 0.1,
  /** Portal beam underside and cantilever arm above the messenger wire. */
  beamGapM: 0.5,
  armGapM: 0.3,
};
/** The messenger's sag at the middle of a 60 m span; the contact wire runs straight. */
const sag = { messengerM: 0.8, spanM: 60 };

interface Box {
  x: number;
  y: number;
  z0: number;
  z1: number;
  /** Horizontal axis of `length` (unit), and the section across it. */
  ux: number;
  uy: number;
  length: number;
  width: number;
}

/**
 * TASK-134: masts, portal beams and arms as two instanced box meshes, and the contact and
 * messenger wires as line segments (open track, and tunnel track shown only with "See below
 * ground"): four draw calls.
 */
export function buildCatenary(city: CompiledCity, heights: ReturnType<typeof cityHeights>) {
  const group = new Group();
  const { roadGrades, nodeGrades } = cityGrades(city);
  const lines: Catenary | undefined = city.rail
    ? catenary(city, roadGrades, nodeGrades)
    : undefined;
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const { contactM, messengerM } = catenaryRule;
  const masts: Box[] = [],
    beams: Box[] = [],
    hangers: number[] = [];
  const vertical = (p: Vec2, z0: number, z1: number, width: number): Box => ({
    x: p.x,
    y: p.y,
    z0,
    z1,
    ux: 1,
    uy: 0,
    length: width,
    width,
  });
  const horizontal = (a: Vec2, b: Vec2, z0: number, z1: number, width: number): Box => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || width;
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z0,
      z1,
      ux: (b.x - a.x) / length || 1,
      uy: (b.y - a.y) / length,
      length,
      width,
    };
  };
  for (const s of lines?.supports ?? []) {
    // Heights from the highest rail the support spans, so every wire passes under its beam.
    const base = Math.max(...s.drops.map((d) => ground(d.pos) + d.h));
    const messenger = base + contactM + messengerM;
    const portal = s.kind === 'portal';
    const beamZ = messenger + (portal ? size.beamGapM : size.armGapM);
    const beamTop = beamZ + (portal ? size.portalDepth : size.arm);
    for (const m of s.masts)
      masts.push(
        vertical(
          m.pos,
          ground(m.pos) + m.h,
          beamTop + (portal ? 0 : 0.3),
          s.tram ? size.tramMast : size.mast,
        ),
      );
    beams.push(
      horizontal(s.beam[0], s.beam[1], beamZ, beamTop, portal ? size.portalWidth : size.arm),
    );
    if (!portal) {
      // The registration arm at the contact wire, from the mast to the farthest drop.
      const z = base + contactM + 0.15;
      beams.push(horizontal(s.beam[0], s.beam[1], z, z + size.arm, size.arm));
    }
    // Hangers from the beam or arm to the wire at each drop, drawn with the wires as lines.
    for (const d of s.drops) {
      const z = ground(d.pos) + d.h + contactM + (portal ? messengerM : 0);
      hangers.push(d.pos.x, z, d.pos.y, d.pos.x, beamZ, d.pos.y);
    }
  }
  // A unit box standing on its base, without the base's two triangles (never seen).
  const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const faces = box.getIndex()!.array;
  box.setIndex([...faces.slice(0, 18), ...faces.slice(24)]);
  const matrix = new Matrix4(),
    rotation = new Quaternion(),
    up = new Vector3(0, 1, 0);
  const instanced = (boxes: Box[], color: number, name: string) => {
    const mesh = new InstancedMesh(
      box.clone(),
      new MeshLambertMaterial({ color }),
      Math.max(1, boxes.length),
    );
    mesh.count = boxes.length;
    boxes.forEach((b, i) => {
      rotation.setFromAxisAngle(up, -Math.atan2(b.uy, b.ux));
      matrix.compose(
        new Vector3(b.x, b.z0, b.y),
        rotation,
        new Vector3(b.length, Math.max(0.01, b.z1 - b.z0), b.width),
      );
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  const supports = [
    instanced(masts, catenaryColors.mast, 'catenary-masts'),
    instanced(beams, catenaryColors.beam, 'catenary-beams'),
  ];
  box.dispose();
  // Wires: the contact wire straight between its points, the messenger sagging in up to 4 pieces.
  const wires = (hidden: boolean, name: string) => {
    const positions: number[] = hidden ? [] : hangers;
    for (const w of lines?.wires ?? []) {
      if (w.hidden !== hidden) continue;
      for (let k = 1; k < w.points.length; k++) {
        const a = w.points[k - 1]!,
          b = w.points[k]!;
        const length = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
        const za = ground(a.pos) + a.h + contactM,
          zb = ground(b.pos) + b.h + contactM;
        const k2 = Math.min(1, (length / sag.spanM) ** 2);
        const pieces = Math.max(1, Math.min(4, Math.ceil(length / 15)));
        const point = (f: number, lift: number, drop: number) => [
          a.pos.x + (b.pos.x - a.pos.x) * f,
          za + (zb - za) * f + lift - drop * k2 * 4 * f * (1 - f),
          a.pos.y + (b.pos.y - a.pos.y) * f,
        ];
        positions.push(...point(0, 0, 0), ...point(1, 0, 0));
        for (let j = 0; j < pieces; j++) {
          const f0 = j / pieces,
            f1 = (j + 1) / pieces;
          positions.push(
            ...point(f0, messengerM, sag.messengerM),
            ...point(f1, messengerM, sag.messengerM),
          );
        }
      }
    }
    const mesh = new LineSegments(
      new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)),
      new LineBasicMaterial({ color: catenaryColors.wire }),
    );
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  const open = wires(false, 'catenary-wires');
  const tunnel = wires(true, 'catenary-tunnel-wires');
  // As in 2D, supports show from `catenaryZooms.supports` px/m and wires from `.wires`: further
  // out they are sub-pixel clutter that costs frame time.
  let belowGround = false,
    zoom = Infinity;
  const update = () => {
    for (const mesh of supports) mesh.visible = zoom >= catenaryZooms.supports;
    open.visible = zoom >= catenaryZooms.wires;
    tunnel.visible = belowGround && open.visible;
  };
  const setBelowGround = (enabled: boolean) => {
    belowGround = enabled;
    update();
  };
  /** Pixels per metre at the camera's target. */
  const setZoom = (next: number) => {
    zoom = next;
    update();
  };
  update();
  return {
    group,
    setBelowGround,
    setZoom,
    counts: {
      supports: lines?.supports.length ?? 0,
      masts: masts.length,
      wires: lines?.wires.filter((w) => !w.hidden).length ?? 0,
    },
  };
}
