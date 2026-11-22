import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { pointInPolygon } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { AirsideGraph } from '../network/airside';
import {
  apronLayout,
  bridgeSize,
  cabBack,
  closed,
  JetBridgeStates,
  type BridgePose,
  type JetBridge,
} from '../render/apron';
import type { AircraftPose } from '../render/types';
import type { Airport } from '../schema/airport';
import type { City } from '../schema/city';

// TASK-315: jet bridges, floodlight masts, stand guidance boards and terminal glazing in 3D.
// Every box-shaped part shares one instanced mesh and every round one another (instance colours
// tell the parts apart), the boards' displays a third and the glazing one merged mesh: four
// draw calls for an airport's whole apron. Only bridges in motion rewrite their instances.

const colors = {
  tunnel: [0xc6cbd1, 0xbcc2c9, 0xb2b9c1],
  cab: 0x9aa3ad,
  bellows: 0x2b2f35,
  drive: 0x50575f,
  rotunda: 0xaeb5bd,
  link: 0xc6cbd1,
  mast: 0x8b939b,
  lamp: 0x3d444b,
  board: 0x23272c,
};
const tunnel = [
  { width: 2.6, height: 2.85 },
  { width: 2.8, height: 3.0 },
  { width: 3.0, height: 3.15 },
];
const CAB_HEIGHT_M = 3.1;
const DRUM_HEIGHT_M = 3.3;
/** Box instances per bridge: three tunnels, cab, bellows, two drive legs, the bogie, a link. */
const BRIDGE_BOXES = 9;
const POST_SPACING_M = 15;

/** Glass on each terminal building's facades, from just above the apron to below its roof. */
export function terminalGlazing(
  airport: Airport,
  context: City['context'],
  groundAt: (x: number, y: number) => number,
) {
  const terminals = Object.values(airport.terminals).map((t) => closed(t.rings[0]!));
  const positions: number[] = [];
  for (const feature of context?.features ?? []) {
    if (feature.kind !== 'area' || feature.class !== 'building') continue;
    const ring = feature.rings[0]!;
    // A terminal's building: most of its outline within half a metre of the terminal's.
    const within = (t: Vec2[]) =>
      ring.filter((p) => pointInPolygon(p, t, 0.5)).length >= ring.length * 0.8;
    if (!terminals.some(within)) continue;
    const heightM = feature.heightM ?? (feature.levels === undefined ? 10 : feature.levels * 3);
    if (heightM < 4) continue;
    const base = Math.min(...ring.map((p) => groundAt(p.x, p.y)));
    // Panes a storey high between floor slabs, mullions about every 2.2 m: the wall shows between.
    const storeys = Math.max(1, Math.round((heightM - 1.5) / 4));
    const storeyM = (heightM - 1.5 - 0.8) / storeys;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    // Out from the wall by the ring's winding (the shoelace sign), 12 cm.
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 3) continue;
      const nx = (sign * (b.y - a.y) * 0.12) / length,
        ny = (sign * -(b.x - a.x) * 0.12) / length;
      // Wound so the front face looks out: left of the edge as written when `area` < 0.
      const [p, q] = area > 0 ? [b, a] : [a, b];
      const panes = Math.max(1, Math.round(length / 2.2));
      for (let k = 0; k < panes; k++) {
        const t0 = (k + 0.04) / panes,
          t1 = (k + 0.96) / panes;
        const px = p.x + (q.x - p.x) * t0 + nx,
          py = p.y + (q.y - p.y) * t0 + ny;
        const qx = p.x + (q.x - p.x) * t1 + nx,
          qy = p.y + (q.y - p.y) * t1 + ny;
        for (let f = 0; f < storeys; f++) {
          const low = base + 0.8 + f * storeyM,
            high = low + storeyM - 0.35;
          positions.push(
            px,
            low,
            py,
            qx,
            low,
            qy,
            qx,
            high,
            qy,
            px,
            low,
            py,
            qx,
            high,
            qy,
            px,
            high,
            py,
          );
        }
      }
    }
  }
  if (!positions.length) return null;
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

export class Apron3D {
  readonly group = new Group();
  readonly states: JetBridgeStates;
  private readonly boxes: InstancedMesh;
  private readonly rounds: InstancedMesh;
  private readonly displays: InstancedMesh | null;
  private readonly glazing: Mesh<BufferGeometry, MeshLambertMaterial> | null;
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private readonly bridges: readonly JetBridge[];
  private readonly drawn: (BridgePose | null)[];
  private timeS = 0;
  private renderedS = NaN;
  private readonly elevationM: number;

  constructor(
    airport: Airport,
    graph: AirsideGraph,
    context: City['context'],
    elevationM: number,
    groundAt: (x: number, y: number) => number,
  ) {
    const glazing = terminalGlazing(airport, context, groundAt);
    this.elevationM = elevationM;
    this.group.name = 'apron';
    this.group.matrixAutoUpdate = false;
    const { bridges, masts, boards } = apronLayout(airport, graph, context);
    this.bridges = bridges;
    this.drawn = bridges.map(() => null);
    this.states = new JetBridgeStates(bridges, graph.stands);
    const posts = bridges.flatMap((b) => (b.link ? linkPosts(b.link, b.rotunda) : []));
    const box = new BoxGeometry(1, 1, 1);
    const round = new CylinderGeometry(1, 1, 1, 14);
    this.boxes = new InstancedMesh(
      box,
      new MeshLambertMaterial(),
      bridges.length * BRIDGE_BOXES + masts.length + boards.length,
    );
    this.boxes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rounds = new InstancedMesh(
      round,
      new MeshLambertMaterial(),
      bridges.length * 2 + posts.length + masts.length,
    );
    for (const mesh of [this.boxes, this.rounds]) {
      mesh.name = mesh === this.boxes ? 'apron-boxes' : 'apron-rounds';
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    // Static parts: rotundas, link posts, masts with their lamp heads, boards.
    const e = elevationM;
    let r = 0;
    for (const bridge of bridges) {
      const { x, y } = bridge.rotunda;
      this.place(this.rounds, r++, x, e + bridgeSize.floorM / 2, y, 1, bridgeSize.floorM, 1, 0);
      this.paint(this.rounds, r - 1, colors.drive);
      const radius = bridgeSize.rotundaRadiusM;
      this.place(
        this.rounds,
        r++,
        x,
        e + bridgeSize.floorM + DRUM_HEIGHT_M / 2,
        y,
        radius,
        DRUM_HEIGHT_M,
        radius,
        0,
      );
      this.paint(this.rounds, r - 1, colors.rotunda);
    }
    for (const p of posts) {
      this.place(
        this.rounds,
        r++,
        p.x,
        e + bridgeSize.floorM / 2,
        p.y,
        0.35,
        bridgeSize.floorM,
        0.35,
        0,
      );
      this.paint(this.rounds, r - 1, colors.drive);
    }
    let b = bridges.length * BRIDGE_BOXES;
    for (const mast of masts) {
      const top = mast.heightM - 0.4;
      this.place(this.rounds, r++, mast.pos.x, e + top / 2, mast.pos.y, 0.3, top, 0.3, 0);
      this.paint(this.rounds, r - 1, colors.mast);
      this.place(this.boxes, b++, mast.pos.x, e + top + 0.3, mast.pos.y, 0.9, 0.7, 2.6, 0);
      this.paint(this.boxes, b - 1, colors.lamp);
    }
    for (const board of boards) {
      const yaw = -board.facing;
      this.place(this.boxes, b++, board.pos.x, e + board.heightM, board.pos.y, 0.35, 1.3, 1.9, yaw);
      this.paint(this.boxes, b - 1, colors.board);
    }
    // Stand guidance displays: amber text panels, bright after dark.
    if (boards.length) {
      const material = new MeshLambertMaterial({ color: 0x1b1e22, emissive: 0xffb428 });
      material.userData.lit = true;
      this.displays = new InstancedMesh(box, material, boards.length);
      this.displays.name = 'apron-displays';
      this.displays.matrixAutoUpdate = false;
      this.displays.frustumCulled = false;
      for (const [i, board] of boards.entries()) {
        const fx = Math.cos(board.facing),
          fy = Math.sin(board.facing);
        this.place(
          this.displays,
          i,
          board.pos.x + fx * 0.19,
          e + board.heightM,
          board.pos.y + fy * 0.19,
          0.04,
          1.0,
          1.6,
          -board.facing,
        );
      }
      this.group.add(this.displays);
    } else this.displays = null;
    this.glazing = glazing
      ? new Mesh(glazing, new MeshLambertMaterial({ color: 0x7f97a7, emissive: 0xffe2b0 }))
      : null;
    if (this.glazing) {
      this.glazing.name = 'terminal-glazing';
      this.glazing.matrixAutoUpdate = false;
      this.group.add(this.glazing);
    }
    this.setLight(0);
  }

  private place(
    mesh: InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    pitch = 0,
  ) {
    const { transform } = this;
    transform.position.set(x, y, z);
    transform.rotation.set(0, yaw, pitch, 'YXZ');
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }

  private paint(mesh: InstancedMesh, index: number, hex: number) {
    mesh.setColorAt(index, this.color.setHex(hex));
  }

  /** Bridge parts for a cab pose: tunnels from the rotunda to the cab, the cab and its bellows,
   * the drive column under the last tunnel, and any fixed link. */
  private placeBridge(i: number, bridge: JetBridge, pose: BridgePose) {
    const e = this.elevationM;
    const base = i * BRIDGE_BOXES;
    const back = cabBack(pose);
    const dx = back.x - bridge.rotunda.x,
      dy = back.y - bridge.rotunda.y;
    const span = Math.hypot(dx, dy);
    const ux = dx / span,
      uy = dy / span;
    const length = span - bridgeSize.rotundaRadiusM;
    const start = {
      x: bridge.rotunda.x + ux * bridgeSize.rotundaRadiusM,
      y: bridge.rotunda.y + uy * bridgeSize.rotundaRadiusM,
    };
    const low = e + bridgeSize.floorM,
      high = e + pose.floorM;
    const slope = Math.atan2(high - low, length);
    const yaw = -Math.atan2(uy, ux);
    const segment = Math.min(bridge.segmentM, length);
    const floorAt = (along: number) => low + ((high - low) * along) / length;
    for (let k = 0; k < 3; k++) {
      const middle = (k * (length - segment)) / 2 + segment / 2;
      const { width, height } = tunnel[k]!;
      this.place(
        this.boxes,
        base + k,
        start.x + ux * middle,
        floorAt(middle) + height / 2,
        start.y + uy * middle,
        segment / Math.cos(slope),
        height,
        width,
        yaw,
        slope,
      );
      this.paint(this.boxes, base + k, colors.tunnel[k]!);
    }
    const fx = Math.cos(pose.facing),
      fy = Math.sin(pose.facing);
    const depth = bridgeSize.cabDepthM;
    this.place(
      this.boxes,
      base + 3,
      pose.cab.x - fx * 0.25,
      high + CAB_HEIGHT_M / 2,
      pose.cab.y - fy * 0.25,
      depth - 0.5,
      CAB_HEIGHT_M,
      bridgeSize.cabWidthM,
      -pose.facing,
    );
    this.paint(this.boxes, base + 3, colors.cab);
    this.place(
      this.boxes,
      base + 4,
      pose.cab.x + fx * (depth / 2 - 0.25),
      high + 1.4,
      pose.cab.y + fy * (depth / 2 - 0.25),
      0.5,
      2.7,
      3.3,
      -pose.facing,
    );
    this.paint(this.boxes, base + 4, colors.bellows);
    // The drive column three quarters along the outer tunnel, on two legs.
    const along = length - segment / 4;
    const at = { x: start.x + ux * along, y: start.y + uy * along };
    const legHeight = floorAt(along) - e;
    for (const [j, side] of [-1.1, 1.1].entries()) {
      this.place(
        this.boxes,
        base + 5 + j,
        at.x - uy * side,
        e + legHeight / 2,
        at.y + ux * side,
        0.35,
        legHeight,
        0.35,
        yaw,
      );
      this.paint(this.boxes, base + 5 + j, colors.drive);
    }
    this.place(this.boxes, base + 7, at.x, e + 0.45, at.y, 1.5, 0.9, 3.0, yaw);
    this.paint(this.boxes, base + 7, colors.bellows);
    if (bridge.link) {
      const lx = bridge.rotunda.x - bridge.link.x,
        ly = bridge.rotunda.y - bridge.link.y;
      const linkLength = Math.hypot(lx, ly);
      this.place(
        this.boxes,
        base + 8,
        bridge.link.x + lx / 2,
        low + 1.55,
        bridge.link.y + ly / 2,
        linkLength,
        3.1,
        3.0,
        -Math.atan2(ly, lx),
      );
    } else this.place(this.boxes, base + 8, 0, 0, 0, 0, 0, 0, 0);
    this.paint(this.boxes, base + 8, colors.link);
  }

  /** The aircraft snapshot at `timeS`: which bridges dock and which retract. */
  update(poses: readonly AircraftPose[], timeS: number) {
    this.states.update(poses, timeS);
    this.timeS = timeS;
    this.renderedS = NaN;
  }

  /** Places the bridges `ageS` simulated seconds after the snapshot; true if any moved. */
  animate(ageS: number) {
    const t = this.timeS + ageS;
    if (t === this.renderedS) return false;
    this.renderedS = t;
    let moved = false;
    for (const [i, bridge] of this.bridges.entries()) {
      const pose = this.states.poseAt(i, t);
      const last = this.drawn[i];
      if (
        last &&
        last.cab.x === pose.cab.x &&
        last.cab.y === pose.cab.y &&
        last.floorM === pose.floorM
      )
        continue;
      this.drawn[i] = pose;
      this.placeBridge(i, bridge, pose);
      moved = true;
    }
    if (moved) {
      this.boxes.instanceMatrix.needsUpdate = true;
      if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;
    }
    return moved;
  }

  private get drawnS() {
    return Number.isNaN(this.renderedS) ? this.timeS : this.renderedS;
  }

  /** Whether a bridge is between parked and docked, so the scene keeps drawing frames. */
  get moving() {
    return this.states.moving(this.drawnS);
  }

  setLight(on: number) {
    if (this.displays)
      (this.displays.material as MeshLambertMaterial).emissiveIntensity = 0.55 + 0.45 * on;
    if (this.glazing) this.glazing.material.emissiveIntensity = 0.42 * on;
  }

  counts() {
    return {
      ...this.states.counts(this.drawnS),
      links: this.bridges.filter((b) => b.link).length,
      glazing: Boolean(this.glazing),
      displays: this.displays?.count ?? 0,
    };
  }
}

function linkPosts(from: Vec2, to: Vec2) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const count = Math.max(1, Math.floor(length / POST_SPACING_M));
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 0.5) / count;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });
}
