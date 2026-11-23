import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  MeshLambertMaterial,
  Vector3,
  Vector4,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { catenaryRule } from '../network/catenary';
import { style } from '../render/style';
import type { CarPosition, TrainVariant } from './train-variants';

/** TASK-332: the train model kit. Every variant is built from its record by the same code into
 * three instanced geometries, shared by all its cars:
 *
 * - `body`: the profile extruded along the car, both cab noses, end walls, bellows and couplers.
 *   Vertices carry an anchor (-1 the rear end, 0 the middle, 1 the front end) and an offset from
 *   it, so the vertex shader places them at any drawn length without stretching a nose, and a
 *   part number, so the shader hides the parts a car does not show (`carFlags`).
 * - `gear`: three bogies, two pantographs and two roof housings, each at x = 0; the shader moves
 *   each slot to the car's own position (`aGear`) or hides it.
 * - `far`: the body as one box, for the far level of detail.
 *
 * Windows, doors and their seams, livery bands, the windscreen, lamps and destination display are
 * painted by the body shader in the car's own metres, never modelled. Car frame: x forward
 * (towards the car's front), y up from the rail top, z across. */

/** Body parts, as the vertex attribute `aPart`. */
export const bodyParts = {
  shell: 0,
  frontWall: 1,
  rearWall: 2,
  frontBellows: 3,
  rearBellows: 4,
  frontNose: 5,
  rearNose: 6,
  frontCoupler: 7,
  rearCoupler: 8,
} as const;

/** Per-car flags (`aCar.z`), in the car's own frame. */
export const carFlags = {
  cabFront: 1,
  cabRear: 2,
  bellowsFront: 4,
  bellowsRear: 8,
  headFront: 16,
  tailFront: 32,
  headRear: 64,
  tailRear: 128,
  selected: 256,
  /** Coupled to a neighbour without bellows: a coupler bridges the gap, a cab reaches into it
   * by up to 0.2 m, and a far box's end wall shows. */
  coupledFront: 512,
  coupledRear: 1024,
} as const;

/** Gear slots: bogies 0-2, pantographs 3-4, roof housings 5-6. A slot at `hidden` is not drawn. */
export const gearSlots = { bogies: 0, pantographs: 3, roofBoxes: 5, count: 7 } as const;
export const hidden = 1000;
const maxCarTypes = 4,
  maxDoors = 6,
  bellowsM = 0.42,
  defaultCouplerMaxM = 0.6;
/** The sim leaves 0.7 m between car poses (`trainPoseAt`); a joint bogie sits in its middle. */
const jointM = 0.35;

type Vertex = { x: number; y: number; z: number; anchor: number };
type Mesh = {
  position: number[];
  normal: number[];
  anchor: number[];
  part: number[];
  index: number[];
};

const newMesh = (): Mesh => ({ position: [], normal: [], anchor: [], part: [], index: [] });

/** Adds a vertex; normals come from positions at a nominal 20 m half-length, so anchored
 * surfaces get the slopes they have on a real car. */
function vertex(mesh: Mesh, v: Vertex, n: Vector3, part: number) {
  mesh.position.push(v.x, v.y, v.z);
  mesh.normal.push(n.x, n.y, n.z);
  mesh.anchor.push(v.anchor);
  mesh.part.push(part);
  return mesh.position.length / 3 - 1;
}

const nominal = (v: Vertex) => new Vector3(v.x + v.anchor * 20, v.y, v.z);

/** A triangle wound so its face looks the way its vertex normals do. */
function triangle(mesh: Mesh, a: number, b: number, c: number) {
  const p = (i: number) =>
    new Vector3(
      mesh.position[i * 3]! + mesh.anchor[i]! * 20,
      mesh.position[i * 3 + 1]!,
      mesh.position[i * 3 + 2]!,
    );
  const n = (i: number) =>
    new Vector3(mesh.normal[i * 3]!, mesh.normal[i * 3 + 1]!, mesh.normal[i * 3 + 2]!);
  const face = p(b)
    .sub(p(a))
    .cross(p(c).sub(p(a)));
  if (face.dot(n(a).add(n(b)).add(n(c))) < 0) mesh.index.push(a, c, b);
  else mesh.index.push(a, b, c);
}

/** A smooth surface through rows of vertices (rows along the car, columns around it), its
 * normals from central differences and turned away from `inside`. */
function surface(mesh: Mesh, rows: Vertex[][], part: number, inside: (p: Vector3) => Vector3) {
  const ids = rows.map((row, i) =>
    row.map((v, j) => {
      const at = (r: number, c: number) =>
        nominal(
          rows[Math.max(0, Math.min(rows.length - 1, r))]![
            Math.max(0, Math.min(row.length - 1, c))
          ]!,
        );
      const along = at(i + 1, j).sub(at(i - 1, j)),
        around = at(i, j + 1).sub(at(i, j - 1));
      const n = along.cross(around).normalize();
      const p = nominal(v);
      if (n.dot(p.clone().sub(inside(p))) < 0) n.negate();
      return vertex(mesh, v, n, part);
    }),
  );
  for (let i = 1; i < ids.length; i++)
    for (let j = 1; j < ids[i]!.length; j++) {
      const a = ids[i - 1]![j - 1]!,
        b = ids[i]![j - 1]!,
        c = ids[i]![j]!,
        d = ids[i - 1]![j]!;
      triangle(mesh, a, b, c);
      triangle(mesh, a, c, d);
    }
}

/** A flat-shaded strip across the car through the right half of a ring (bottom to roof), mirrored:
 * an end wall, a nose's front face or an underside. */
function across(mesh: Mesh, half: Vertex[], normal: (v: Vertex) => Vector3, part: number) {
  for (let k = 1; k < half.length; k++) {
    const a = half[k - 1]!,
      b = half[k]!;
    const mirror = (v: Vertex) => ({ ...v, z: -v.z });
    const ids = [a, b, mirror(b), mirror(a)].map((v) => vertex(mesh, v, normal(v), part));
    triangle(mesh, ids[0]!, ids[1]!, ids[2]!);
    triangle(mesh, ids[0]!, ids[2]!, ids[3]!);
  }
}

/** The right half of the cross-section, from the skirt's bottom corner up to the roof's middle. */
export function profileHalf(v: TrainVariant): { y: number; z: number }[] {
  const { bottomM, skirtInsetM, waistM, cantM, cantInsetM, roofSquareness } = v.profile;
  const w = v.widthM / 2;
  const points: { y: number; z: number }[] = [];
  for (const t of [0, 0.4, 0.75]) {
    points.push({ y: bottomM + (waistM - bottomM) * t, z: w - skirtInsetM * (1 - t) ** 2 });
  }
  points.push({ y: waistM, z: w });
  for (const t of [0.55, 1])
    points.push({ y: waistM + (cantM - waistM) * t, z: w - cantInsetM * t * t });
  const a = w - cantInsetM,
    b = v.heightM - cantM,
    e = 2 / roofSquareness;
  for (const deg of [18, 36, 54, 72, 90]) {
    const phi = (deg * Math.PI) / 180;
    points.push({
      y: cantM + b * Math.sin(phi) ** e,
      z: deg === 90 ? 0 : a * Math.cos(phi) ** e,
    });
  }
  return points;
}

/** A closed section around the car from a right half (bottom to roof), mirrored. */
const ring = <P extends { z: number }>(half: P[]) => [
  ...half,
  ...half
    .slice(0, -1)
    .reverse()
    .map((p) => ({ ...p, z: -p.z })),
];

/** The front nose's rings, from its base (x = 0) to the front face (x = the nose's foot). */
function noseRings(v: TrainVariant, half: { y: number; z: number }[]) {
  const { lengthM, rakeM, rakeFromM, cornerM } = v.nose;
  const reach = (y: number) =>
    lengthM - rakeM * Math.min(1, Math.max(0, (y - rakeFromM) / (v.heightM - rakeFromM)));
  const rings = [half.map((p) => ({ x: 0, ...p }))];
  for (const deg of [0, 30, 60, 90]) {
    const theta = (deg * Math.PI) / 180;
    const narrow = 1 - (cornerM / (v.widthM / 2)) * (1 - Math.cos(theta));
    rings.push(
      half.map((p) => ({
        x: reach(p.y) - cornerM + cornerM * Math.sin(theta),
        y: p.y,
        z: p.z * narrow,
      })),
    );
  }
  return rings;
}

/** The body: shell, end walls, bellows and noses (see the file comment). */
export function bodyGeometry(v: TrainVariant) {
  const mesh = newMesh();
  const half = profileHalf(v);
  const around = ring(half);
  const middleY = (v.profile.bottomM + v.heightM) / 2;
  const axis = (p: Vector3) => new Vector3(p.x, middleY, 0);
  const at =
    (anchor: number, x = 0) =>
    (p: { y: number; z: number }) => ({ x, ...p, anchor });
  surface(mesh, [around.map(at(-1)), around.map(at(1))], bodyParts.shell, axis);
  const bottom = (anchor: number) => ({ x: 0, y: v.profile.bottomM, z: half[0]!.z, anchor });
  across(mesh, [bottom(-1), bottom(1)], () => new Vector3(0, -1, 0), bodyParts.shell);
  for (const [anchor, part] of [
    [1, bodyParts.frontWall],
    [-1, bodyParts.rearWall],
  ] as const)
    across(mesh, half.map(at(anchor)), () => new Vector3(anchor, 0, 0), part);
  // Bellows: a section inset within the body's, reaching into the gap, met by the neighbour's.
  const bellowsBottom = v.floorM - 0.1,
    bellowsTop = v.heightM - 0.35;
  const bellows = half.map((p) => ({
    y:
      bellowsBottom +
      ((p.y - v.profile.bottomM) / (v.heightM - v.profile.bottomM)) * (bellowsTop - bellowsBottom),
    z: p.z * 0.84,
  }));
  for (const [anchor, part] of [
    [1, bodyParts.frontBellows],
    [-1, bodyParts.rearBellows],
  ] as const)
    surface(
      mesh,
      [ring(bellows).map(at(anchor)), ring(bellows).map(at(anchor, anchor * bellowsM))],
      part,
      axis,
    );
  // Couplers: x 0 marks the end inside the body, 1 the end in the gap's middle (`aCar.w`),
  // subject to the variant's reach limit.
  const c = v.nose.couplerM;
  for (const [anchor, part] of [
    [1, bodyParts.frontCoupler],
    [-1, bodyParts.rearCoupler],
  ] as const) {
    const corner = (x: number, y: number, z: number): Vertex => ({ x, y, z, anchor });
    const box = [0, 1].map((x) =>
      [
        [-1, -1],
        [-1, 1],
        [1, 1],
        [1, -1],
      ].map(([dy, dz]) => corner(x, c + dy! * 0.12, dz! * 0.11)),
    );
    surface(
      mesh,
      [
        [...box[0]!, box[0]![0]!],
        [...box[1]!, box[1]![0]!],
      ],
      part,
      (p) => new Vector3(p.x, c, 0),
    );
  }
  // Noses: the front one, and the rear one turned round (x and z negated).
  const rings = noseRings(v, half);
  const slope = v.nose.rakeM / (v.heightM - v.nose.rakeFromM);
  for (const [sign, part] of [
    [1, bodyParts.frontNose],
    [-1, bodyParts.rearNose],
  ] as const) {
    const turn = (p: { x: number; y: number; z: number }): Vertex => ({
      x: sign * p.x,
      y: p.y,
      z: sign * p.z,
      anchor: sign,
    });
    surface(
      mesh,
      rings.map((r) => ring(r).map(turn)),
      part,
      (p) => new Vector3(p.x - sign, middleY, 0),
    );
    across(
      mesh,
      rings.at(-1)!.map(turn),
      (p) => new Vector3(sign, p.y > v.nose.rakeFromM ? slope : 0, 0).normalize(),
      part,
    );
    // The nose's underside, from its base to its front face.
    across(
      mesh,
      rings.map((r) => turn(r[0]!)),
      () => new Vector3(0, -1, 0),
      part,
    );
  }
  return finish(mesh);
}

function finish(mesh: Mesh) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(mesh.normal, 3));
  geometry.setAttribute('aAnchor', new Float32BufferAttribute(mesh.anchor, 1));
  geometry.setAttribute('aPart', new Float32BufferAttribute(mesh.part, 1));
  geometry.setIndex(mesh.index);
  return geometry;
}

/** The far level: the body as a box from the skirt to the roof, its ends end walls. */
export function farGeometry(v: TrainVariant) {
  const mesh = newMesh();
  const w = v.widthM / 2,
    { bottomM } = v.profile,
    top = v.heightM;
  const box = (anchor: number, y: number, z: number): Vertex => ({ x: 0, y, z, anchor });
  const quad = (corners: Vertex[], n: Vector3, part: number) => {
    const ids = corners.map((c) => vertex(mesh, c, n, part));
    triangle(mesh, ids[0]!, ids[1]!, ids[2]!);
    triangle(mesh, ids[0]!, ids[2]!, ids[3]!);
  };
  for (const side of [-1, 1])
    quad(
      [
        box(-1, bottomM, side * w),
        box(1, bottomM, side * w),
        box(1, top, side * w),
        box(-1, top, side * w),
      ],
      new Vector3(0, 0, side),
      bodyParts.shell,
    );
  quad(
    [box(-1, top, -w), box(1, top, -w), box(1, top, w), box(-1, top, w)],
    new Vector3(0, 1, 0),
    bodyParts.shell,
  );
  quad(
    [box(-1, bottomM, -w), box(1, bottomM, -w), box(1, bottomM, w), box(-1, bottomM, w)],
    new Vector3(0, -1, 0),
    bodyParts.shell,
  );
  for (const [anchor, part] of [
    [1, bodyParts.frontWall],
    [-1, bodyParts.rearWall],
  ] as const)
    quad(
      [
        box(anchor, bottomM, -w),
        box(anchor, top, -w),
        box(anchor, top, w),
        box(anchor, bottomM, w),
      ],
      new Vector3(anchor, 0, 0),
      part,
    );
  return finish(mesh);
}

/** Running gear and roof equipment, each slot built at x = 0 (see `gearSlots`). */
export function gearGeometry(v: TrainVariant) {
  const parts: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry, hex: number, slot: number) => {
    geometry.deleteAttribute('uv');
    const count = geometry.getAttribute('position').count;
    const { r, g, b } = new Color(hex);
    geometry.setAttribute(
      'color',
      new Float32BufferAttribute(Array.from({ length: count }, () => [r, g, b]).flat(), 3),
    );
    geometry.setAttribute('aSlot', new Float32BufferAttribute(new Array(count).fill(slot), 1));
    parts.push(geometry);
  };
  const box = (x: number, y: number, z: number, lx: number, ly: number, lz: number) =>
    new BoxGeometry(lx, ly, lz).translate(x, y, z);
  /** A thin bar from (x1, y1) to (x2, y2) in the car's middle plane. */
  const bar = (x1: number, y1: number, x2: number, y2: number, t: number) =>
    new BoxGeometry(Math.hypot(x2 - x1, y2 - y1), t, t)
      .rotateZ(Math.atan2(y2 - y1, x2 - x1))
      .translate((x1 + x2) / 2, (y1 + y2) / 2, 0);
  const { wheelbaseM, wheelDiameterM, shoes } = v.bogie;
  const r = wheelDiameterM / 2,
    frame = 0x2c2f33,
    wheel = 0x4d5054;
  for (let s = 0; s < 3; s++) {
    const slot = gearSlots.bogies + s;
    for (const z of [-1, 1]) {
      add(box(0, r + 0.02, z * 0.93, wheelbaseM + 0.9, 0.3, 0.16), frame, slot);
      for (const x of [-1, 1])
        add(
          new CylinderGeometry(r, r, 0.13, 8)
            .rotateX(Math.PI / 2)
            .translate((x * wheelbaseM) / 2, r, z * 0.76),
          wheel,
          slot,
        );
      if (shoes) add(box(0, 0.12, z * 1.32, 0.45, 0.07, 0.3), 0x7a7e82, slot);
    }
    add(box(0, r + 0.12, 0, 0.55, 0.26, 1.72), frame, slot);
  }
  const top = v.heightM,
    wire = catenaryRule.contactM;
  if (v.pantograph)
    for (let s = 0; s < 2; s++) {
      const slot = gearSlots.pantographs + s,
        base = top + 0.3,
        knee = base + 0.5 * (wire - base);
      add(box(0, top + 0.12, 0, 1.3, 0.24, 0.16), 0x9a8f80, slot);
      add(box(0, base, 0, 1.5, 0.1, v.pantograph.baseWidthM), 0x55595e, slot);
      add(bar(0.6, base + 0.05, -0.75, knee, 0.09), 0x6b7075, slot);
      add(bar(-0.75, knee, 0.05, wire - 0.08, 0.07), 0x6b7075, slot);
      add(box(0.05, wire - 0.04, 0, 0.3, 0.08, 1.9), 0x2d2f31, slot);
    }
  const roof = new Color(Object.values(v.carTypes)[0]!.livery.roof).multiplyScalar(0.9).getHex();
  for (let s = 0; s < 2; s++) {
    const { lengthM, widthM, heightM } = v.roofBox;
    add(
      box(0, top - 0.04 + heightM / 2, 0, lengthM, heightM, widthM),
      roof,
      gearSlots.roofBoxes + s,
    );
  }
  const merged = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return merged;
}

/** Body shader (TASK-332 detail, TASK-163 night lights): see the file comment. The far box uses
 * the same material, so both levels run one program. */
export function bodyMaterial(v: TrainVariant, lights: { value: number }) {
  const material = new MeshLambertMaterial();
  const types = Object.values(v.carTypes);
  const colours: Color[] = [],
    livery: Vector4[] = [],
    doors: Vector3[] = [];
  for (let t = 0; t < maxCarTypes; t++) {
    const type = types[t] ?? types[0]!,
      l = type.livery;
    for (const hex of [
      l.body,
      l.band,
      l.skirt,
      l.door,
      l.roof,
      l.front,
      l.windowBand ?? l.body,
      l.gangway,
    ])
      colours.push(new Color(hex));
    livery.push(
      new Vector4(l.skirtTopM, l.bandTopM, l.windowBand === null ? 0 : 1, type.windows ? 1 : 0),
    );
    for (let d = 0; d < maxDoors; d++) {
      const door = type.doors[d];
      doors.push(door ? new Vector3(door[0], door[1], door[2]) : new Vector3());
    }
  }
  const { glass, lamps, display } = v.nose;
  const uniforms = {
    cabinLights: lights,
    uColours: { value: colours },
    uLivery: { value: livery },
    uDoors: { value: doors },
    uWindows: {
      value: new Vector4(v.windows.sillM, v.windows.headM, v.windows.paneM, v.windows.pillarM),
    },
    uCar: { value: new Vector4(v.floorM, v.doorTopM, v.windows.endMarginM, v.nose.lengthM) },
    uCouplerMaxM: { value: v.nose.couplerMaxM ?? defaultCouplerMaxM },
    uGlass: { value: new Vector4(glass.bottomM, glass.topM, glass.halfWidthM, v.profile.cantM) },
    uLamps: { value: new Vector4(lamps.yM, lamps.zM, lamps.radiusM, 0) },
    uDisplay: {
      value: display
        ? new Vector4(display.bottomM, display.topM, display.halfWidthM, 1)
        : new Vector4(0, 0, 0, 0),
    },
    uSelection: { value: new Color(style.selection) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `attribute vec4 aCar; attribute float aAnchor; attribute float aPart; uniform vec4 uCar; uniform float uCouplerMaxM;
      varying vec3 vCar; varying vec3 vCarNormal;
      flat varying float vPart; flat varying float vType; flat varying float vFlags; flat varying float vHalf;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          int f = int(aCar.z + 0.5), part = int(aPart + 0.5);
          float cab = aAnchor > 0.5 ? float(f & 1) : aAnchor < -0.5 ? float((f >> 1) & 1) : 0.0;
          float coupled = aAnchor > 0.5 ? float((f >> 9) & 1) : aAnchor < -0.5 ? float((f >> 10) & 1) : 0.0;
          // A coupled cab reaches into the gap, leaving 0.12 m to its neighbour's middle.
          float reach = coupled * clamp(aCar.w - 0.12, 0.0, 0.2);
          if (part >= 7) transformed.x = aAnchor * (position.x > 0.5 ? aCar.x + min(aCar.w + 0.02, uCouplerMaxM) : aCar.x - 0.3);
          else transformed.x += aAnchor * (aCar.x - cab * (uCar.w - reach));
          bool shown = part < 3 || (part == 3 && (f & 4) != 0) || (part == 4 && (f & 8) != 0)
            || (part == 5 && (f & 1) != 0) || (part == 6 && (f & 2) != 0)
            || (part == 7 && (f & 512) != 0) || (part == 8 && (f & 1024) != 0);
          if (!shown) transformed = vec3(0.0);
          vCar = transformed; vCarNormal = objectNormal;
          vPart = aPart; vType = aCar.y; vFlags = aCar.z; vHalf = aCar.x;
        }`,
      );
    shader.fragmentShader =
      `uniform float cabinLights; uniform vec3 uColours[${maxCarTypes * 8}];
      uniform vec4 uLivery[${maxCarTypes}]; uniform vec3 uDoors[${maxCarTypes * maxDoors}];
      uniform vec4 uWindows; uniform vec4 uCar; uniform vec4 uGlass; uniform vec4 uLamps;
      uniform vec4 uDisplay; uniform vec3 uSelection;
      varying vec3 vCar; varying vec3 vCarNormal;
      flat varying float vPart; flat varying float vType; flat varying float vFlags; flat varying float vHalf;
      const vec3 glassDay = vec3(0.1, 0.13, 0.17);
      const vec3 cabinGlow = vec3(0.95, 0.87, 0.68);
      // A front: a nose's front face, or a far box's end without a neighbour.
      void trainFront(inout vec3 c, inout vec3 glow, int t, int f, bool front, bool selected) {
        vec3 p = vCar;
        float az = abs(p.z);
        if (p.y >= uLivery[t].x) c = selected ? uSelection : uColours[t * 8 + 5];
        if (p.y > uGlass.x && p.y < uGlass.y && az < uGlass.z) {
          c = glassDay + 0.06 * (p.y - uGlass.x) / (uGlass.y - uGlass.x);
          return;
        }
        bool head = (f & (front ? 16 : 64)) != 0, tail = (f & (front ? 32 : 128)) != 0;
        if (uDisplay.w > 0.5 && p.y > uDisplay.x && p.y < uDisplay.y && az < uDisplay.z) {
          c = vec3(0.03);
          if (head) glow += vec3(1.0, 0.5, 0.08) * 0.7;
          return;
        }
        float r = uLamps.z;
        float dHead = length(vec2(az - uLamps.y, p.y - uLamps.x));
        float dTail = length(vec2(az - uLamps.y + 2.6 * r, p.y - uLamps.x));
        if (dHead < r) {
          c = dHead > 0.8 * r ? vec3(0.15) : vec3(0.78, 0.8, 0.8);
          if (head) glow += vec3(2.4, 2.3, 2.0);
        } else if (dTail < 0.75 * r) {
          c = vec3(0.32, 0.03, 0.03);
          if (tail) glow += vec3(1.8, 0.06, 0.03);
        }
      }
      // Doors, windows and the window band along a side.
      void trainSide(inout vec3 c, inout vec3 glow, int t, int f, bool selected, int part) {
        vec3 p = vCar;
        float nearest = 1e3;
        for (int d = 0; d < ${maxDoors}; d++) {
          vec3 door = uDoors[t * ${maxDoors} + d];
          if (door.z <= 0.0) continue;
          float dx = abs(p.x - (door.x * vHalf + door.y)), w = 0.5 * door.z;
          nearest = min(nearest, dx - w);
          if (dx < w && p.y > uCar.x - 0.04 && p.y < uCar.y) {
            c = selected ? uSelection : uColours[t * 8 + 3];
            bool twin = door.z > 1.2;
            if (min(w - dx, uCar.y - p.y) < 0.035 || (twin && dx < 0.018)) c *= 0.35;
            else if ((twin ? dx > 0.1 && dx < w - 0.1 : dx < w - 0.12)
                && p.y > uCar.x + 0.95 && p.y < uCar.y - 0.2) {
              c = glassDay;
              glow += 0.8 * cabinGlow;
            }
            return;
          }
        }
        float sill = uWindows.x, head = uWindows.y;
        if (p.y <= sill || p.y >= head) return;
        bool nose = part >= 5;
        float noseM = uCar.w;
        if (nose) {
          // The cab's side window, in the nose's straight part.
          float along = part == 5 ? p.x - (vHalf - noseM) : -p.x - (vHalf - noseM);
          if (uLivery[t].z > 0.5) c = uColours[t * 8 + 6];
          if (along > 0.12 && along < 0.55 * noseM && p.y > sill + 0.05 && p.y < head - 0.05) c = glassDay;
          return;
        }
        if (uLivery[t].w < 0.5) return;
        if (uLivery[t].z > 0.5 && nearest > 0.0) c = uColours[t * 8 + 6];
        float front = vHalf - uCar.z - ((f & 1) != 0 ? noseM : 0.0);
        float rear = -vHalf + uCar.z + ((f & 2) != 0 ? noseM : 0.0);
        if (nearest < 0.22 || p.x > front || p.x < rear) return;
        float pane = fract(p.x / uWindows.z + 0.5), pillar = 0.5 * uWindows.w / uWindows.z;
        if (pane > pillar && pane < 1.0 - pillar && p.y > sill + 0.04 && p.y < head - 0.04) {
          c = glassDay + 0.05 * (p.y - sill) / (head - sill);
          glow += cabinGlow;
        }
      }
      vec3 trainPaint(out vec3 glow) {
        int t = int(vType + 0.5), f = int(vFlags + 0.5), part = int(vPart + 0.5);
        bool selected = (f & 256) != 0;
        vec3 p = vCar, n = normalize(vCarNormal);
        vec4 livery = uLivery[t];
        vec3 c = p.y < livery.x ? uColours[t * 8 + 2] : p.y < livery.y ? uColours[t * 8 + 1] : uColours[t * 8];
        if (selected && p.y >= livery.x) c = uSelection;
        glow = vec3(0.0);
        if (part == 3 || part == 4) return vec3(0.17) * (0.8 + 0.4 * step(0.5, fract(p.x * 14.0)));
        if (part >= 7) return vec3(0.14);
        if (part == 1 || part == 2) {
          bool front = part == 1;
          // A coupled end: the livery, with the gangway's opening (or end door) in the middle.
          if ((f & (front ? 516 : 1032)) != 0)
            return abs(p.z) < 0.55 && p.y > uCar.x && p.y < uCar.y ? uColours[t * 8 + 7] : c;
          trainFront(c, glow, t, f, front, selected);
          return c;
        }
        // Doors cut into a tube's roof curve stay doors.
        if (n.y > 0.55 && p.y > max(uGlass.w, uCar.y)) return uColours[t * 8 + 4];
        if ((part == 5 ? n.x : part == 6 ? -n.x : 0.0) > 0.5) {
          trainFront(c, glow, t, f, part == 5, selected);
          return c;
        }
        if (abs(n.z) > 0.35) trainSide(c, glow, t, f, selected, part);
        return c;
      }\n` +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nvec3 trainGlow;\ndiffuseColor.rgb = trainPaint(trainGlow);',
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef CABIN_LIGHTS\ntotalEmissiveRadiance += cabinLights * trainGlow;\n#endif',
        );
  };
  return material;
}

/** Vertex-coloured gear, each slot moved to its car's position (`aGear0`, `aGear1`). */
export function gearMaterial() {
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float aSlot; attribute vec4 aGear0; attribute vec4 aGear1;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          int s = int(aSlot + 0.5);
          float at = s < 4 ? aGear0[s] : aGear1[s - 4];
          transformed.x += at;
          if (at > 900.0) transformed = vec3(0.0);
        }`,
      );
  };
  return material;
}

/** A variant's formation with its car types as indices into `Object.values(carTypes)`. */
export function formationOf(v: TrainVariant) {
  const names = Object.keys(v.carTypes);
  const index = (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw Error(`${v.id}: no car type ${name}`);
    return i;
  };
  if (names.length > maxCarTypes) throw Error(`${v.id}: more than ${maxCarTypes} car types`);
  return {
    variant: v,
    types: Object.values(v.carTypes),
    unitCars: v.formation.unitCars,
    first: index(v.formation.first),
    middle: v.formation.middle.map(index),
    last: index(v.formation.last),
    /** Per train length, each car's layout (`layoutOf`), built once. */
    layouts: new Map<number, CarLayout[]>(),
  };
}
export type FormationOf = ReturnType<typeof formationOf>;

/** Car `j` of `n`, counted from the route's forward end: its type, whether it is turned round
 * (its front towards the route's rear end), and its cabs towards the route's front and rear. */
function carAt(f: FormationOf, n: number, j: number) {
  const size = f.unitCars || n,
    start = j - (j % size),
    m = Math.min(size, n - start),
    k = j - start;
  const type =
    m === 1 || k === 0 ? f.first : k === m - 1 ? f.last : f.middle[(k - 1) % f.middle.length]!;
  const cabs = f.types[type]!.cabs;
  const flip = m > 1 && k === m - 1;
  const local = {
    front: cabs !== 'none',
    rear: cabs === 'both' || (m === 1 && cabs !== 'none'),
  };
  return {
    type,
    flip,
    unitFront: k === 0,
    unitRear: k === m - 1,
    cabFront: flip ? local.rear : local.front,
    cabRear: flip ? local.front : local.rear,
  };
}

/** Writes car `j` of `n` (counted from the route's forward end): `aCar` (drawn half-length, car
 * type, `carFlags`, 0) at `car[c..c+3]` and the gear slots at `gear[g..g+7]`, all in the car's
 * own frame. `reversed`: the train runs towards the route's start (after a terminal's turn), so
 * its head lamps are at the route's rear end. Returns whether the car's front faces against the
 * direction of travel. */
/** Car `j`'s layout in a train of `n`: its type, whether it is turned round, its flags in its
 * own frame without lamps or selection, the lamp flags when the train runs forward and when it
 * runs reversed, and whether a Jacobs bogie sits under the joint behind it. */
interface CarLayout {
  type: number;
  flip: boolean;
  flags: number;
  lamps: number;
  lampsReversed: number;
  jacobs: boolean;
}

function layoutOf(f: FormationOf, n: number) {
  let layout = f.layouts.get(n);
  if (layout) return layout;
  const v = f.variant;
  layout = Array.from({ length: n }, (_, j) => {
    const self = carAt(f, n, j);
    const ahead = j > 0 ? carAt(f, n, j - 1) : null,
      behind = j < n - 1 ? carAt(f, n, j + 1) : null;
    // Towards the route's front (`fr`) and rear (`rr`).
    const bellowsFr = v.bellows && !self.unitFront && !self.cabFront && !ahead!.cabRear,
      bellowsRr = v.bellows && !self.unitRear && !self.cabRear && !behind!.cabFront;
    const coupledFr = ahead !== null && !bellowsFr,
      coupledRr = behind !== null && !bellowsRr;
    const [front, rear] = self.flip ? [1, 0] : [0, 1];
    const bits = (fr: boolean, rr: boolean, flag: readonly [number, number]) =>
      (fr ? flag[front]! : 0) | (rr ? flag[rear]! : 0);
    const lamps = (reversed: boolean) =>
      bits(!reversed && j === 0, reversed && j === n - 1, [carFlags.headFront, carFlags.headRear]) |
      bits(reversed && j === 0, !reversed && j === n - 1, [carFlags.tailFront, carFlags.tailRear]);
    return {
      type: self.type,
      flip: self.flip,
      flags:
        bits(self.cabFront, self.cabRear, [carFlags.cabFront, carFlags.cabRear]) |
        bits(bellowsFr, bellowsRr, [carFlags.bellowsFront, carFlags.bellowsRear]) |
        bits(coupledFr, coupledRr, [carFlags.coupledFront, carFlags.coupledRear]),
      lamps: lamps(false),
      lampsReversed: lamps(true),
      jacobs: v.jacobs && !self.unitRear,
    };
  });
  f.layouts.set(n, layout);
  return layout;
}

const position = (p: CarPosition, halfM: number) => p[0] * halfM + p[1];

/** Writes car `j` of `n` (counted from the route's forward end): `aCar` (drawn half-length, car
 * type, `carFlags`, distance from the drawn end to the middle of the gap) at `car[c..c+3]` and
 * the gear slots at `gear[g..g+7]`, all in the car's own frame. `reversed`: the train runs
 * towards the route's start (after a terminal's turn), so its head lamps are at the route's rear
 * end. Returns whether the car's front faces against the direction of travel. Allocates nothing
 * once a train length's layout is built. */
export function carState(
  f: FormationOf,
  n: number,
  j: number,
  poseLengthM: number,
  reversed: boolean,
  selected: boolean,
  car: Float32Array,
  c: number,
  gear: Float32Array,
  g: number,
  fullPoseLengthM = poseLengthM,
) {
  const slot = layoutOf(f, n)[j]!;
  const type = f.types[slot.type]!;
  const clipped = type.lengthM !== undefined && poseLengthM < fullPoseLengthM - 1e-6;
  const lengthM = type.lengthM ?? poseLengthM;
  const halfM = (clipped ? Math.min(lengthM, poseLengthM) : lengthM) / 2;
  car[c] = halfM;
  car[c + 1] = slot.type;
  car[c + 2] =
    slot.flags | (reversed ? slot.lampsReversed : slot.lamps) | (selected ? carFlags.selected : 0);
  car[c + 3] = poseLengthM / 2 - halfM + jointM;
  gear.fill(hidden, g, g + gearSlots.count);
  gear[g + 7] = 0;
  let s = gearSlots.bogies;
  for (let i = 0; i < type.bogies.length; i++) gear[g + s++] = position(type.bogies[i]!, halfM);
  // A Jacobs bogie under the joint behind, in the middle of the sim's gap between poses.
  if (slot.jacobs) gear[g + s++] = (slot.flip ? 1 : -1) * (poseLengthM / 2 + jointM);
  if (s > gearSlots.pantographs) throw Error(`${f.variant.id}: more than 3 bogies on a car`);
  for (let i = 0; i < type.pantographs.length; i++)
    gear[g + gearSlots.pantographs + i] = position(type.pantographs[i]!, halfM);
  for (let i = 0; i < type.roofBoxes.length; i++)
    gear[g + gearSlots.roofBoxes + i] = position(type.roofBoxes[i]!, halfM);
  if (clipped)
    for (let i = g; i < g + gearSlots.count; i++) if (Math.abs(gear[i]!) > halfM) gear[i] = hidden;
  return slot.flip !== reversed;
}

/** Where the body shader puts a vertex along the car (for tests): see `bodyMaterial`. */
export function placedX(
  x: number,
  anchor: number,
  part: number,
  halfM: number,
  flags: number,
  noseM: number,
  gapM = 0.35,
  couplerMaxM = defaultCouplerMaxM,
) {
  const cab = anchor > 0.5 ? flags & 1 : anchor < -0.5 ? (flags >> 1) & 1 : 0;
  const coupled = anchor > 0.5 ? (flags >> 9) & 1 : anchor < -0.5 ? (flags >> 10) & 1 : 0;
  const reach = coupled * Math.min(0.2, Math.max(0, gapM - 0.12));
  const shown =
    part < 3 ||
    (part === 3 && flags & 4) ||
    (part === 4 && flags & 8) ||
    (part === 5 && flags & 1) ||
    (part === 6 && flags & 2) ||
    (part === 7 && flags & 512) ||
    (part === 8 && flags & 1024);
  if (!shown) return null;
  if (part >= 7)
    return anchor * (x > 0.5 ? halfM + Math.min(gapM + 0.02, couplerMaxM) : halfM - 0.3);
  return x + anchor * (halfM - cab * (noseM - reach));
}
