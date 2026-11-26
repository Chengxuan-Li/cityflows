import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Raycaster,
  ShapeUtils,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInPolygon } from '../../src/geo/polyline';
import { createRandom } from '../../src/geo/random';
import type { Vec2 } from '../../src/geo/vec2';
import type { CParkingSpace } from '../../src/network';
import { style } from '../../src/render/style';
import { buildHalos, buildPools, type LightPoint } from '../../src/render3d/lights';
import { vehicleModelIndex, vehicleModelMaterial } from '../../src/render3d/vehicle-models';
import { carColours } from './props';
import { yardPaving } from './surfaces';

type XY = readonly [number, number];
type Rect = readonly [u0: number, v0: number, u1: number, v1: number];
type PaintBounds = readonly [u: number, v: number, width: number, depth: number];
type Finish = Parameters<typeof yardPaving>[0];
type Space = Pick<CParkingSpace, 'position'>;
type Bay = { x: number; y: number; heading: number; height: number };
const paper = '#dedcd3',
  walkway = '#71978e';
const sill = 0.034;

function frame(origin: Vec2, bearing: number) {
  const c = Math.cos(bearing),
    s = Math.sin(bearing);
  return {
    bearing,
    world: (u: number, v: number): Vec2 => ({
      x: origin.x + c * u + s * v,
      y: origin.y + s * u - c * v,
    }),
    local: ({ x, y }: Vec2): XY => [
      c * (x - origin.x) + s * (y - origin.y),
      s * (x - origin.x) - c * (y - origin.y),
    ],
  };
}
type Frame = ReturnType<typeof frame>;

// The mapped shed and the empty ground between Hartmann Road and the quay. Site coordinates
// run along its long wall (u), and from the street to the dock (v), in metres.
const shed = frame({ x: 518.2, y: 219.8 }, Math.atan2(6.8, 67.2));
const hardstand: XY[] = [
  [-11, -7.1],
  [10, -6.15],
  [52, -4.13],
  [84, -2.75],
  [106, -2.1],
  [106, 28.4],
  [100.7, 29.3],
  [100.7, 35.5],
  [105, 36.2],
  [104, 40.6],
  [-11, 40.0],
];
const beds: Rect[] = [
  [6, -5.3, 24, -4.12],
  [32, -4.4, 53, -3.18],
  [58, -3.53, 66, -2.03],
  [68.8, 35.25, 76.3, 37.5],
  [96.6, 1.35, 102.7, 3.9],
  [83, 35.2, 91.8, 37.3],
];
const closed = (path: readonly XY[]) => [...path, path[0]!];
const rectangle = ([a, b, c, d]: Rect): XY[] => [
  [a, b],
  [c, b],
  [c, d],
  [a, d],
];
const yardRing = closed(hardstand).map(([u, v]) => shed.world(u, v));

export function inFactoryYard(p: Vec2) {
  return pointInPolygon(p, yardRing);
}

export const staffFrontagePose = { x: 392, y: 221.15, bearing: Math.atan2(3.75, 94) };
const frontage = frame(staffFrontagePose, staffFrontagePose.bearing);
const frontageOutline: XY[] = [
  [0, 0],
  [94, 0],
  [94, 7.2],
  [0, 14.5],
];
const frontageBeds: Rect[] = [9, 38, 64].map((u) => [u, 4.1, u + 12.5, 6.45]);
const frontageRing = closed(frontageOutline).map(([u, v]) => frontage.world(u, v));
// The old seed passes still reserve these positions, so removing them from the
// shot does not re-seed the shrub bands and open greens behind the building.
export const staffPlanting = frontageBeds.map(([a, b, c, d]) => ({
  line: [frontage.world(a + 0.65, (b + d) / 2), frontage.world(c - 0.65, (b + d) / 2)],
  side: 1,
  offset: 0,
  width: 1.8,
  height: 1.58,
}));

export function inStaffFrontage(p: Vec2) {
  return pointInPolygon(p, frontageRing);
}

export function outsideStaffBeds(p: Vec2) {
  if (!inStaffFrontage(p)) return false;
  const [u, v] = frontage.local(p);
  return !frontageBeds.some(
    ([a, b, c, d]) => u > a + 0.09 && u < c - 0.09 && v > b + 0.09 && v < d - 0.09,
  );
}

const longStayColumns = [81, 124, 167, 210, 247].map((x) =>
  frontage.local({
    x,
    y: 184.4 + (x - 48.4) * 0.11,
  }),
);
export const longStayLampPools: LightPoint[] = longStayColumns.map(([u, v]) => {
  const p = frontage.world(u, v + 2.7);
  return { ...p, z: 0, radiusM: 11.8, color: 0xffdda5 };
});

export function onYardPavement(p: Vec2) {
  if (!inFactoryYard(p)) return false;
  const [u, v] = shed.local(p);
  return !beds.some(([a, b, c, d]) => u > a && u < c && v > b && v < d);
}

class Site {
  readonly group = new Group();
  readonly lights: LightPoint[] = [];
  readonly halos: LightPoint[] = [];
  readonly bays: Bay[] = [];
  private readonly panels = new Map<Finish, { position: number[]; uv: number[] }>();
  private readonly pieces: BufferGeometry[] = [];
  private readonly glow: BufferGeometry[] = [];
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  constructor(
    readonly frame: Frame,
    readonly height: number,
    readonly bounds: PaintBounds,
  ) {
    const [x, y, width, depth] = bounds;
    this.canvas.width = 2048;
    this.canvas.height = 1024;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.setTransform(
      2048 / width,
      0,
      0,
      1024 / depth,
      (-x * 2048) / width,
      (-y * 1024) / depth,
    );
    this.ctx.lineCap = 'butt';
    this.ctx.lineJoin = 'round';
  }

  pave(path: readonly XY[], finish: Finish, up = 0) {
    let data = this.panels.get(finish);
    if (!data) {
      data = { position: [], uv: [] };
      this.panels.set(finish, data);
    }
    const triangles = ShapeUtils.triangulateShape(
      path.map(([u, v]) => new Vector2(u, v)),
      [],
    );
    for (const t of triangles) {
      const [a, b, c] = t.map((i) => path[i]!) as [XY, XY, XY];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      for (const [u, v] of cross < 0 ? [a, c, b] : [a, b, c]) {
        const p = this.frame.world(u, v);
        data.position.push(p.x, this.height + up, p.y);
        data.uv.push(u, v);
      }
    }
  }
  slab(rect: Rect, finish: Finish, up = 0) {
    this.pave(rectangle(rect), finish, up);
  }

  line(points: readonly XY[], width = 0.13, color = paper) {
    const g = this.ctx;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    points.forEach(([u, v], i) => (i ? g.lineTo(u, v) : g.moveTo(u, v)));
    g.stroke();
  }
  paint([a, b, c, d]: Rect, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(a, b, c - a, d - b);
  }
  arrow(u: number, v: number, dir: number) {
    this.line(
      [
        [u - dir * 1.45, v],
        [u + dir * 0.94, v],
      ],
      0.18,
    );
    this.line(
      [
        [u + dir * 0.33, v - 0.55],
        [u + dir * 0.94, v],
        [u + dir * 0.33, v + 0.55],
      ],
      0.18,
    );
  }
  label(text: string, u: number, v: number, angle = 0) {
    const g = this.ctx;
    g.save();
    g.translate(u, v);
    g.rotate(angle);
    // Local v points to the left of travel, opposite the canvas reading direction.
    g.scale(1, -1);
    g.fillStyle = paper;
    g.font = 'bold 1.15px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  }

  private part(
    shape: BufferGeometry,
    u: number,
    v: number,
    height: number,
    color: number,
    yaw = 0,
    lit = false,
  ) {
    const p = this.frame.world(u, v);
    shape.rotateY(-this.frame.bearing + yaw).translate(p.x, this.height + height, p.y);
    const c = new Color(color);
    const values = new Float32Array(shape.getAttribute('position').count * 3);
    for (let i = 0; i < values.length; i += 3) values.set([c.r, c.g, c.b], i);
    shape.setAttribute('color', new Float32BufferAttribute(values, 3));
    (lit ? this.glow : this.pieces).push(shape);
  }
  box(u: number, v: number, at: number, w: number, d: number, h: number, color: number, yaw = 0) {
    this.part(new BoxGeometry(w, h, d), u, v, at + h / 2, color, yaw);
  }
  kerb(u0: number, v0: number, u1: number, v1: number, h = 0.15) {
    const length = Math.hypot(u1 - u0, v1 - v0);
    this.box(
      (u0 + u1) / 2,
      (v0 + v1) / 2,
      0,
      length,
      0.18,
      h,
      0xb3aa99,
      Math.atan2(v1 - v0, u1 - u0),
    );
  }
  island([u0, v0, u1, v1]: Rect) {
    const cut = 0.38;
    const ring: XY[] = [
      [u0 + cut, v0],
      [u1 - cut, v0],
      [u1, v0 + cut],
      [u1, v1 - cut],
      [u1 - cut, v1],
      [u0 + cut, v1],
      [u0, v1 - cut],
      [u0, v0 + cut],
    ];
    this.pave(ring, 'planting', 0.125);
    closed(ring)
      .slice(1)
      .forEach(([u, v], i) => this.kerb(ring[i]![0], ring[i]![1], u, v));
  }
  bollard(u: number, v: number) {
    this.part(new CylinderGeometry(0.07, 0.085, 0.87, 7), u, v, 0.435, 0x586262);
    this.part(new CylinderGeometry(0.075, 0.075, 0.21, 7), u, v, 0.72, 0xc5a34e);
  }

  gully(u: number, v: number) {
    this.box(u, v, 0.006, 0.78, 0.37, 0.021, 0x333536);
    for (let i = -3; i <= 3; i++) this.box(u + i * 0.102, v, 0.028, 0.043, 0.32, 0.015, 0x737477);
  }

  lamp(u: number, v: number, side = -1) {
    const height = 6.4;
    this.part(new CylinderGeometry(0.064, 0.11, height, 8), u, v, height / 2, 0x68777d);
    this.box(u, v, 0, 0.31, 0.31, 0.16, 0x8e8f88);
    this.box(u, v + side * 0.38, height - 0.1, 0.09, 0.84, 0.11, 0x68777d);
    this.box(u, v + side * 0.88, height - 0.13, 0.32, 0.56, 0.13, 0xabb3b3);
    this.part(
      new BoxGeometry(0.23, 0.05, 0.41),
      u,
      v + side * 0.9,
      height - 0.137,
      0xd3d3c1,
      0,
      true,
    );
    const head = this.frame.world(u, v + side * 0.9);
    const pool = this.frame.world(u, v + side * 2.7);
    this.halos.push({
      x: head.x,
      y: head.y,
      z: this.height + height - 0.1,
      radiusM: 0.94,
      color: 0xffdfac,
    });
    this.lights.push({
      x: pool.x,
      y: pool.y,
      z: this.height + 0.095,
      radiusM: 11.8,
      color: 0xffdda5,
    });
  }

  bay(u: number, v: number, heading: number, width = 2.53, depth = 4.95) {
    const d: XY = [Math.cos(heading), Math.sin(heading)],
      h: XY = [-d[1], d[0]];
    const at = (along: number, across: number): XY => [
      u + d[0] * along + h[0] * across,
      v + d[1] * along + h[1] * across,
    ];
    this.line([
      at(-depth / 2, -width / 2),
      at(depth / 2, -width / 2),
      at(depth / 2, width / 2),
      at(-depth / 2, width / 2),
    ]);
    const p = this.frame.world(u, v);
    this.bays.push({ ...p, heading: this.frame.bearing - heading, height: this.height });
  }

  finish(night: () => number) {
    const dispose: (() => void)[] = [];
    const texture = new CanvasTexture(this.canvas);
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    dispose.push(() => texture.dispose());
    for (const [finish, data] of this.panels) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(data.position, 3));
      g.setAttribute('uv', new Float32BufferAttribute(data.uv, 2));
      g.computeVertexNormals();
      const m = yardPaving(finish, texture, this.bounds);
      const mesh = new Mesh(g, m);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      dispose.push(() => {
        g.dispose();
        m.dispose();
      });
    }
    for (const [parts, emissive] of [
      [this.pieces, false],
      [this.glow, true],
    ] as const) {
      if (!parts.length) continue;
      const g = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      const m = new MeshLambertMaterial({ vertexColors: true, emissive: emissive ? 0xffddab : 0 });
      const mesh = new Mesh(g, m);
      mesh.castShadow = !emissive;
      mesh.receiveShadow = true;
      if (emissive)
        mesh.onBeforeRender = () => {
          m.emissiveIntensity = 0.94 * night();
        };
      this.group.add(mesh);
      dispose.push(() => {
        g.dispose();
        m.dispose();
      });
    }
    const pools = buildPools(this.lights),
      halos = buildHalos(this.halos);
    pools.visible = halos.visible = true;
    pools.onBeforeRender = () => {
      pools.material.opacity = 0.71 * night();
    };
    halos.onBeforeRender = () => {
      halos.material.uniforms.intensity!.value = 0.91 * night();
    };
    this.group.add(pools, halos);
    dispose.push(() => {
      pools.material.map?.dispose();
      for (const m of [pools, halos]) {
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
    });
    return () => {
      this.group.removeFromParent();
      dispose.forEach((f) => f());
    };
  }
}

function dockside() {
  const site = new Site(shed, sill, [-12, -8, 120, 50]);
  site.pave(hardstand, 'asphalt');
  site.slab([67.51, 0.5, 78.5, 31.8], 'concrete', 0.018);
  site.slab([-10.8, 33.2, 100.2, 35.0], 'concrete', 0.016);
  site.slab([-10.8, 39.2, 103.9, 39.92], 'concrete', 0.016);
  for (const bed of beds) site.island(bed);

  for (let u = -6; u < 100; u += 7.1) {
    site.gully(u, 38.4);
    site.bollard(u + 0.97, 39.58);
  }
  for (const u of [1.1, 27, 53.5, 79.2, 99.3]) site.lamp(u, 37.6);
  // Two facing overflow rows keep their paved access aisle and bay lines.
  const rowV0 = 4.8,
    bayW = 2.63,
    baysPerRow = 10;
  site.slab([78.7, 4.1, 84.62, 32.3], 'concrete', 0.013);
  site.slab([90.5, 4.1, 96.4, 32.3], 'concrete', 0.013);
  site.pave(
    [
      [83.9, -4.66],
      [92.6, -4.36],
      [91.25, 4.6],
      [84.0, 4.6],
    ],
    'asphalt',
    0.008,
  );
  for (let i = 0; i < baysPerRow; i++) {
    const v = rowV0 + (i + 0.5) * bayW;
    site.bay(82, v, Math.PI, bayW);
    site.bay(93.1, v, 0, bayW);
  }
  for (const u of [78.7, 97.0]) for (const v of [4, 32]) site.bollard(u, v);
  site.lamp(100.6, 2.5, 1);
  site.lamp(76.8, 1.9, 1);
  return site;
}

function longStayLighting() {
  const site = new Site(frontage, sill, [-1, -1, 96, 21]);
  for (const [u, v] of longStayColumns) site.lamp(u, v, 1);
  return site;
}

function staffDeck(footprint: Vec2[], buildings: Mesh, mapped: readonly Space[]) {
  const a = footprint[1]!,
    b = footprint[0]!;
  const base = frame(a, Math.atan2(b.y - a.y, b.x - a.x));
  const ring = footprint.map(base.local);
  const world = base.world(48, 15);
  buildings.updateMatrixWorld(true);
  const hit = new Raycaster(
    new Vector3(world.x, 65, world.y),
    new Vector3(0, -1, 0),
  ).intersectObject(buildings)[0];
  if (!hit || hit.point.y < 2) return;
  const home = new Site(base, hit.point.y + 0.043, [-1, -1, 104, 40]);
  home.pave(ring, 'asphalt');
  const stands = closed(ring);
  for (let i = 1; i < stands.length; i++) {
    const [u, v] = stands[i - 1]!,
      [x, y] = stands[i]!;
    if (Math.hypot(u - x, v - y) > 0.001) home.kerb(u, v, x, y, 0.83);
  }
  const roof = [...footprint, footprint[0]!];
  const hasMappedBays = mapped.some((s) => pointInPolygon(s.position, roof));
  for (const [v, heading] of [
    [4.1, Math.PI / 2],
    [15.65, -Math.PI / 2],
    [22.1, Math.PI / 2],
    [33.0, -Math.PI / 2],
  ] as const) {
    // Clip the bays at the stepped edge of the mapped upper deck.
    for (let u = 9.0; u < 92.5; u += 2.54) {
      const corners = rectangle([u - 1.28, v - 2.48, u + 1.28, v + 2.48]).map(([x, y]) =>
        base.world(x, y),
      );
      if (hasMappedBays || !corners.every((p) => pointInPolygon(p, roof))) continue;
      home.bay(u, v, heading, 2.54);
    }
  }
  home.slab([7.5, 18.16, 93.0, 19.52], 'concrete', 0.012);
  home.paint([7.5, 18.18, 93.0, 19.5], walkway);
  for (const u of [5.4, 93.8]) {
    home.slab([u - 1.06, 2.7, u + 1.14, 27.8], 'concrete', 0.012);
    home.island([u - 1.06, 17.77, u + 1.14, 19.9]);
    for (const v of [9.0, 25.8])
      for (let i = -2; i <= 2; i++)
        home.paint([u - 0.88, v + i * 0.48, u + 0.92, v + i * 0.48 + 0.22], paper);
  }
  for (const u of [15, 35, 55, 75, 89]) {
    home.arrow(u, 10.6, -1);
    home.arrow(u, 26.7, 1);
    home.lamp(u, 19.0);
  }
  home.label('STAFF', 86.3, 26.78, Math.PI);
  home.label('SLOW', 14, 10.7, Math.PI);
  return home;
}

function parkedCars(
  models: readonly BufferGeometry[],
  bays: readonly Bay[],
  existing: readonly Space[],
) {
  const group = new Group();
  const random = createRandom(620);
  const cars = bays.flatMap((p, i) => {
    if (
      random.next() > 0.89 ||
      existing.some((s) => Math.hypot(p.x - s.position.x, p.y - s.position.y) < 2.7)
    )
      return [];
    const van = random.next() < 0.065;
    const dimensions = style.vehicleClasses[van ? 'van' : 'car'];
    return [
      {
        ...p,
        model: vehicleModelIndex(van ? 1 : 0, i + 811),
        length: Math.min(4.68, dimensions.lengthM) * random.uniform(0.91, 1.015),
        width: dimensions.widthM,
        heightM: dimensions.heightM,
        colour: random.pick(carColours),
        yaw: p.heading + (random.next() < 0.23 ? Math.PI : 0) + random.uniform(-0.027, 0.027),
        drift: random.uniform(-0.2, 0.21),
        nudge: random.uniform(-0.14, 0.14),
      },
    ];
  });
  if (!cars.length) return { group, count: 0, dispose: () => {} };
  const material = vehicleModelMaterial({ value: -1 });
  const transform = new Object3D(),
    colour = new Color();
  for (const index of new Set(cars.map((c) => c.model))) {
    const model = cars.filter((c) => c.model === index);
    const mesh = new InstancedMesh(models[index]!, material, model.length);
    mesh.receiveShadow = mesh.castShadow = true;
    model.forEach((p, i) => {
      const forward = p.length * 0.5 + p.drift;
      transform.position.set(
        p.x + forward * Math.cos(p.yaw) - p.nudge * Math.sin(p.yaw),
        p.height + 0.02,
        p.y + forward * Math.sin(p.yaw) + p.nudge * Math.cos(p.yaw),
      );
      transform.rotation.set(0, -p.yaw, 0);
      transform.scale.set(p.length, p.heightM, p.width);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, colour.setHex(p.colour));
    });
    group.add(mesh);
  }
  return {
    group,
    count: cars.length,
    dispose: () => {
      for (const mesh of group.children as InstancedMesh[]) mesh.dispose();
      material.dispose();
    },
  };
}

export function dockDressing(
  garage: Vec2[] | undefined,
  buildings: Mesh | undefined,
  models: readonly BufferGeometry[],
  existing: readonly Space[],
  night: () => number,
) {
  const group = new Group();
  group.name = 'intro-dock-yard';
  const ground = dockside();
  const deck = garage && buildings ? staffDeck(garage, buildings, existing) : undefined;
  const sites = deck ? [ground, longStayLighting(), deck] : [ground];
  const undo = sites.map((site) => {
    group.add(site.group);
    return site.finish(night);
  });
  const cars = parkedCars(
    models,
    sites.flatMap((site) => site.bays),
    existing,
  );
  group.add(cars.group);
  group.userData.bays = sites.reduce((n, s) => n + s.bays.length, 0);
  group.userData.occupied = cars.count;
  return {
    group,
    dispose: () => {
      group.removeFromParent();
      cars.dispose();
      undo.forEach((f) => f());
    },
  };
}
