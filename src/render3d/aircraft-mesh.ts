import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Shape,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hull, plainLivery, type AircraftLivery } from '../render/aircraft-livery';
import { aircraftLayout, type WingtipKind } from '../render/aircraft-outline';
import type { AircraftType } from '../schema/aircraft';
import { fixedWingGearStations } from '../sim/aircraft-motion';

type Point = [x: number, y: number, z: number];
type Layout = ReturnType<typeof aircraftLayout>;

/** Mount positions in metres, in the same local frame as the mesh. */
export interface AircraftLightMounts {
  navLeft: Point;
  navRight: Point;
  navTail: Point;
  beacon: Point;
  strobes: [left: Point, right: Point];
  landing: Point[];
  taxi: Point;
}

export interface AircraftMesh {
  root: Group;
  gear: Group;
  noseGear: Group | null;
  /** Each returned group spins about its own local Y axis, irrespective of the mount orientation. */
  propellers: Group[];
  rotors: Group[];
  /** Passenger windows, grouped into one or two decks. */
  windowRows: Group[];
  lightMounts: AircraftLightMounts;
}

/** Bake rigid parts in the frame that moves them. Windows keep their compact pane instances,
 * and gear and rotors retain their own visibility and animation. Returns each frame's batch and
 * outline. */
export function batchAircraftMesh(mesh: AircraftMesh, outline: ShaderMaterial) {
  const { root, gear, noseGear, propellers, rotors } = mesh;
  const frames = new Set([root, gear, ...(noseGear ? [noseGear] : []), ...propellers, ...rotors]);
  const rigid = new Map<Group, Mesh<BufferGeometry, MeshLambertMaterial>[]>();
  const outlined = new Set(['fuselage', 'wings', 'winglets', 'tailplane', 'fin', 'engine']);
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object instanceof Mesh && !(object instanceof InstancedMesh)) {
      if (!(object.material instanceof MeshLambertMaterial)) return;
      let frame = object.parent as Group;
      while (!frames.has(frame)) frame = frame.parent as Group;
      const parts = rigid.get(frame) ?? [];
      parts.push(object);
      rigid.set(frame, parts);
    } else if (!frames.has(object as Group)) object.matrixAutoUpdate = false;
  });
  const material = new MeshLambertMaterial({ vertexColors: true });
  const local = new Matrix4();
  const geometries = new Set<BufferGeometry>();
  const batches: { frame: Group; batch: Mesh; contour: Mesh | null }[] = [];
  for (const [frame, parts] of rigid) {
    const inverse = frame.matrixWorld.clone().invert();
    const body: BufferGeometry[] = [];
    const rim: BufferGeometry[] = [];
    for (const part of parts) {
      const source = part.geometry;
      geometries.add(source);
      local.multiplyMatrices(inverse, part.matrixWorld);
      const geometry = new BufferGeometry()
        .setAttribute('position', source.getAttribute('position').clone())
        .setAttribute('normal', source.getAttribute('normal').clone())
        .applyMatrix4(local);
      const count = geometry.getAttribute('position').count;
      const index = source.index
        ? Array.from(source.index.array)
        : Array.from({ length: count }, (_, i) => i);
      // Three reverses front faces for reflected meshes. Bake the same winding for a mirrored wing.
      if (local.determinant() < 0)
        for (let i = 0; i < index.length; i += 3) {
          const first = index[i]!;
          index[i] = index[i + 1]!;
          index[i + 1] = first;
        }
      geometry.setIndex(index);
      if (outlined.has(part.name || part.parent!.name)) rim.push(geometry.clone());
      const { r, g, b } = part.material.color;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = r;
        colors[i + 1] = g;
        colors[i + 2] = b;
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      body.push(geometry);
      part.removeFromParent();
    }
    const batch = new Mesh(mergeGeometries(body)!, material);
    batch.matrixAutoUpdate = false;
    frame.add(batch);
    let contour: Mesh | null = null;
    if (rim.length) {
      contour = new Mesh(mergeGeometries(rim)!, outline);
      contour.userData.outline = true;
      contour.matrixAutoUpdate = false;
      frame.add(contour);
    }
    batches.push({ frame, batch, contour });
    for (const geometry of [...body, ...rim]) geometry.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  const empty: Object3D[] = [];
  root.traverse((object) => {
    if (object instanceof Group && !frames.has(object) && !object.children.length)
      empty.push(object);
  });
  for (const object of empty) object.removeFromParent();
  root.updateMatrixWorld(true);
  root.matrixAutoUpdate = false;
  return batches;
}

/** Adjacent rings share vertices for smooth normals. Endpoints cap the rings or form a cone. */
function loft(rings: Point[][], start: Point, end: Point) {
  const count = rings[0]!.length;
  const positions = rings.flat();
  const indices: number[] = [];
  const first = positions.push(start) - 1;
  const last = positions.push(end) - 1;
  const endRing = (rings.length - 1) * count;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(first, next, i, last, endRing + i, endRing + next);
    for (let offset = 0; offset < endRing; offset += count) {
      const a = offset + i;
      const b = offset + next;
      indices.push(a, b, b + count, a, b + count, a + count);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions.flat(), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ellipse(x: number, y: number, z: number, width: number, height: number, sides = 16) {
  return Array.from({ length: sides }, (_, i): Point => {
    const angle = (i * 2 * Math.PI) / sides;
    return [x, y + height * Math.cos(angle), z + width * Math.sin(angle)];
  });
}

function liftingSurface(sections: Layout['wing'], material: MeshLambertMaterial) {
  const rings = sections.map(({ x, y, z, chord, thickness }): Point[] => [
    [x, y, z],
    [x - chord * 0.32, y + thickness, z],
    [x - chord, y, z],
    [x - chord * 0.38, y - thickness * 0.57, z],
  ]);
  const cap = ({ x, y, z, chord }: Layout['wing'][number]): Point => [x - chord * 0.4, y, z];
  const pair = new Group();
  const right = new Mesh(loft(rings, cap(sections[0]!), cap(sections.at(-1)!)), material);
  pair.add(mirrored(right), right);
  return pair;
}

function mirrored(mesh: Mesh) {
  const left = mesh.clone();
  left.scale.z = -1;
  return left;
}

/** A patch of the fuselage skin between `x0` and `x1` and section angles `a0` to `a1` (0 on
 * top, positive to starboard), lifted by `lift` of the section radii: livery bands, doors and
 * the windscreen. Wrapping past +-pi joins under the belly. Samples fall on the fuselage's own
 * stations and section vertices, so each facet lies just outside the facet below it. */
function skin(layout: Layout, x0: number, x1: number, a0: number, a1: number, lift: number) {
  const xs = [x0, ...layout.body.map((s) => s.x).filter((x) => x > x0 && x < x1), x1];
  const step = Math.PI / 8;
  const angles = [a0];
  for (let k = Math.floor(a0 / step) + 1; k * step < a1; k++) angles.push(k * step);
  angles.push(a1);
  const n = angles.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [i, x] of xs.entries()) {
    const { y, width, height } = layout.bodyAt(x);
    for (const [j, angle] of angles.entries()) {
      positions.push(x, y + height * lift * Math.cos(angle), width * lift * Math.sin(angle));
      if (i && j) {
        const b = i * n + j;
        const a = b - n;
        indices.push(a - 1, a, b, a - 1, b, b - 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The section angles of the heights `low` to `high` on the starboard side at `x`. */
function arcOf(layout: Layout, x: number, low: number, high: number) {
  const { y, height } = layout.bodyAt(x);
  const angle = (h: number) => Math.acos(Math.min(1, Math.max(-1, (h - y) / height)));
  return [angle(high), angle(low)] as const;
}

/** Bands of the scheme on a white fuselage; fractions of the length from the tail. */
function liveryBands(
  layout: Layout,
  length: number,
  livery: AircraftLivery,
  paint: (color: number) => MeshLambertMaterial,
) {
  const bands: Mesh[] = [];
  const L = (f: number) => f * length;
  // The light belly lies under the scheme's own bands where they overlap.
  const band = (x0: number, x1: number, a0: number, a1: number, color: number, both = true) => {
    const lift = color === livery.belly ? 1.008 : 1.012;
    const right = new Mesh(skin(layout, L(x0), L(x1), a0, a1, lift), paint(color));
    right.name = 'livery';
    bands.push(right);
    if (both) {
      const left = mirrored(right);
      left.name = 'livery';
      bands.push(left);
    }
  };
  const around = (x0: number, x1: number, a: number, color: number, top: boolean) =>
    band(x0, x1, top ? -a : a, top ? a : 2 * Math.PI - a, color, false);
  if (livery.belly !== null) around(-0.42, 0.43, 2.02, livery.belly, false);
  switch (livery.style) {
    case 'cheatline':
      band(-0.44, 0.395, 1.45, 1.58, livery.tail);
      if (livery.trim !== null) band(-0.42, 0.39, 1.62, 1.665, livery.trim);
      break;
    case 'belly':
      around(-0.45, 0.47, 1.8, livery.tail, false);
      if (livery.trim !== null) band(-0.43, 0.45, 1.7, 1.75, livery.trim);
      break;
    case 'tailcone':
      around(-0.5, -0.27, 1.45, livery.tail, true);
      if (livery.trim !== null) band(-0.27, 0.395, 1.5, 1.555, livery.trim);
      break;
    case 'crown':
      around(-0.36, 0.395, 1.02, livery.tail, true);
      break;
    case 'tail':
      break;
  }
  return bands;
}

/** Interpolates the wing planform at `z` metres from the centreline. */
function wingAt(wing: Layout['wing'], z: number) {
  const i = Math.max(
    1,
    wing.findIndex((s) => s.z >= z),
  );
  const a = wing[i - 1]!;
  const b = wing[i]!;
  const t = (z - a.z) / (b.z - a.z);
  const lerp = (from: number, to: number) => from + (to - from) * t;
  return {
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    chord: lerp(a.chord, b.chord),
    thickness: lerp(a.thickness, b.thickness),
  };
}

const wingtipHeight: Record<WingtipKind, number> = {
  none: 0,
  raked: 0,
  sharklet: 0.13,
  blended: 0.14,
  winglet: 0.09,
  fence: 0.045,
};

/** Upturned tip devices inside the span, on the starboard tip (mirrored for the port one). */
function wingtip(kind: WingtipKind, layout: Layout, halfSpan: number) {
  const tip = layout.wing.at(-1)!;
  const { x, y, chord } = tip;
  const t = Math.max(0.025, chord * 0.06);
  const ring = (dx: number, dy: number, c: number, inset: number): Point[] => {
    const z = halfSpan - 0.6 * t - inset;
    return [
      [x - dx, y + dy, z],
      [x - dx - c * 0.32, y + dy, z - t],
      [x - dx - c, y + dy, z],
      [x - dx - c * 0.38, y + dy, z + t * 0.57],
    ];
  };
  const foil = (rings: Point[][]) => {
    const cap = (r: Point[]): Point => [(r[0]![0] + r[2]![0]) / 2, r[0]![1], r[0]![2]];
    return loft(rings, cap(rings[0]!), cap(rings.at(-1)!));
  };
  const h = halfSpan * wingtipHeight[kind];
  if (kind === 'fence')
    return [
      foil([ring(0, -h * 0.75, chord, 0), ring(-chord * 0.15, 0, chord * 1.15, 0)]),
      foil([ring(-chord * 0.15, 0, chord * 1.15, 0), ring(chord * 0.2, h, chord * 0.55, t)]),
    ];
  const curve = kind === 'winglet' ? 0 : 0.18;
  return [
    foil([
      ring(0, 0, chord * 0.96, 0),
      ...(curve ? [ring(chord * 0.12, h * curve, chord * 0.82, h * 0.03)] : []),
      ring(chord * 0.62, h, chord * 0.36, h * (curve ? 0.11 : 0.06)),
    ]),
  ];
}

function windowRows(type: AircraftType, layout: Layout, glass: MeshLambertMaterial) {
  const { lengthM: length, class: category, id } = type;
  const { radius, doors } = layout;
  const helicopter = category === 'helicopter';
  function surface(x: number, angle: number) {
    const at = layout.bodyAt(x);
    return new Vector3(x, at.y + Math.cos(angle) * at.height, Math.sin(angle) * at.width);
  }
  const pane = new SphereGeometry(1, 8, 6);
  const transform = new Object3D();
  function placePane(
    batch: InstancedMesh,
    index: number,
    x: number,
    angle: number,
    width: number,
    height: number,
  ) {
    transform.position.copy(surface(x, angle));
    transform.rotation.x = angle - Math.PI / 2;
    transform.scale.set(width, height, radius * 0.075);
    transform.updateMatrix();
    batch.setMatrixAt(index, transform.matrix);
  }
  const rows: Group[] = [];
  const decks = category === 'double_decker' ? [1.64, 0.94] : [helicopter ? 1.32 : 1.28];
  for (const [i, angle] of decks.entries()) {
    const row = new Group();
    row.name = `window-row-${i + 1}`;
    const from = (helicopter ? -0.027 : id === 'B748' && i === 1 ? 0.235 : -0.33) * length;
    const to = (helicopter ? 0.16 : 0.37) * length;
    const count = helicopter ? 3 : Math.ceil((to - from) / 0.87);
    const width = helicopter ? length * 0.035 : Math.min(0.19, radius * 0.16);
    // No pane over a door of the same deck.
    const upper = i === 1;
    const xs = Array.from(
      { length: count },
      (_, j) => from + ((to - from) * j) / (count - 1),
    ).filter(
      (x) =>
        helicopter ||
        !doors.some((d) => d.upper === upper && Math.abs(d.x - x) < d.widthM / 2 + width + 0.1),
    );
    const panes = new InstancedMesh(pane, glass, xs.length * 2);
    for (const [j, x] of xs.entries())
      for (const side of [-1, 1])
        placePane(
          panes,
          j * 2 + (side === 1 ? 1 : 0),
          x,
          angle * side,
          width,
          helicopter ? 0.28 * radius : Math.min(0.27, radius * 0.22),
        );
    row.add(panes);
    rows.push(row);
  }
  if (!helicopter) return { rows, cockpit: null };
  const cockpit = new InstancedMesh(pane, glass, 4);
  cockpit.name = 'cockpit';
  let index = 0;
  for (const side of [-1, 1]) {
    for (const [x, angle] of [
      [0.236, 1.03],
      [0.278, 0.62],
    ]) {
      placePane(cockpit, index++, x! * length, angle! * side, radius * 0.38, radius * 0.48);
    }
  }
  return { rows, cockpit };
}

function spinner(radius: number, count: number, chord: number, material: MeshLambertMaterial) {
  const disk = new Group();
  const profile = new Shape();
  profile.moveTo(radius * 0.08, -radius * chord * 0.28);
  profile.lineTo(radius * 0.9, -radius * chord * 0.55);
  profile.lineTo(radius, 0);
  profile.lineTo(radius * 0.92, radius * chord * 0.45);
  profile.lineTo(radius * 0.08, radius * chord * 0.28);
  profile.closePath();
  const blade = new ExtrudeGeometry(profile, {
    depth: radius * 0.009,
    bevelEnabled: false,
  }).rotateX(Math.PI / 2);
  for (let i = 0; i < count; i++) {
    const mesh = new Mesh(blade, material);
    mesh.rotation.y = (i * 2 * Math.PI) / count;
    disk.add(mesh);
  }
  disk.add(new Mesh(new SphereGeometry(radius * 0.093, 10, 8), material));
  return disk;
}
function landingGear(
  type: AircraftType,
  layout: Layout,
  metal: MeshLambertMaterial,
  rubber: MeshLambertMaterial,
) {
  const { lengthM: length, spanM: span, class: category } = type;
  const { bodyY, radius } = layout;
  const gear = new Group();
  gear.name = 'landing-gear';
  const up = new Vector3(0, 1, 0);
  function strut(from: Point, to: Point, width: number, frame = gear) {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const direction = b.clone().sub(a);
    const mesh = new Mesh(new CylinderGeometry(width, width, direction.length(), 8), metal);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    frame.add(mesh);
  }
  if (type.id === 'EC45') {
    for (const z of [-radius * 1.15, radius * 1.15]) {
      const y = radius * 0.08;
      strut([-length * 0.15, y, z], [length * 0.22, y, z], y);
      strut([length * 0.22, y, z], [length * 0.265, y * 3, z], y);
      for (const x of [-length * 0.07, length * 0.13]) {
        strut([x, y, z], [x, bodyY - radius * 0.68, z * 0.62], y * 0.75);
      }
    }
    return { gear, noseGear: null };
  }
  const wheelR = radius * 0.21;
  const tyre = new CylinderGeometry(wheelR, wheelR, wheelR * 0.67, 12).rotateX(Math.PI / 2);
  function bogie(x: number, z: number, y: number, axles: number, frame = gear) {
    strut([x, wheelR, z], [x, y, z], wheelR * 0.27, frame);
    if (axles > 1)
      strut([x - wheelR * 1.3, wheelR, z], [x + wheelR * 1.3, wheelR, z], wheelR * 0.25);
    for (let i = 0; i < axles; i++) {
      for (const side of [-1, 1]) {
        const wheel = new Mesh(tyre, rubber);
        wheel.position.set(
          x + (i - (axles - 1) / 2) * wheelR * 2.4,
          wheelR,
          z + side * wheelR * 0.5,
        );
        frame.add(wheel);
      }
    }
  }
  const helicopter = category === 'helicopter';
  const { noseX, mainX } = fixedWingGearStations(length);
  const noseGear = helicopter ? null : new Group();
  if (noseGear) {
    noseGear.name = 'nose-gear';
    noseGear.position.x = noseX;
    bogie(0, 0, bodyY - radius * 0.65, 1, noseGear);
    gear.add(noseGear);
  } else {
    bogie(length * 0.23, 0, bodyY - radius * 0.65, 1);
  }
  const mainY = helicopter ? bodyY - radius * 0.42 : layout.wing[0]!.y;
  const axles = category === 'widebody' || category === 'double_decker' ? 2 : 1;
  for (const side of [-1, 1]) {
    bogie(mainX, side * (helicopter ? radius * 0.74 : span * 0.09), mainY, axles);
    if (category === 'double_decker') {
      bogie(-length * 0.147, side * radius * 0.54, bodyY - radius * 0.77, 2);
    }
  }
  return { gear, noseGear };
}

// ---- TASK-331: landing gear after the real aircraft --------------------------------------------

/** A main gear leg pair, port and starboard, or the nose leg. Metres. */
interface GearLeg {
  /** The bogie's middle along the length: TASK-307's contact stations. */
  x: number;
  /** Between the port and starboard legs' wheel middles; 0 for the nose leg. */
  track: number;
  axles: number;
  wheelsPerAxle: 1 | 2;
  /** Tyre diameter and width. */
  tyre: [diameter: number, width: number];
  /** Between a twin pair's wheel middles. */
  pair: number;
  /** Between a bogie's axles. */
  axleSpacing: number;
}

type LegSpec = Omit<GearLeg, 'x'> & { at: 'main' | 'body' };
const twin = (track: number, d: number, w: number, pair: number): LegSpec => ({
  at: 'main',
  track,
  axles: 1,
  wheelsPerAxle: 2,
  tyre: [d, w],
  pair,
  axleSpacing: 0,
});
const bogie = (
  at: 'main' | 'body',
  track: number,
  axles: number,
  d: number,
  w: number,
  pair: number,
  axleSpacing: number,
): LegSpec => ({ at, track, axles, wheelsPerAxle: 2, tyre: [d, w], pair, axleSpacing });

/** TASK-331: each type's landing gear: nose wheels and tyre (diameter, width), main legs with
 * their track, wheels, tyre and spacings, and whether the legs carry doors. Tracks, bogie
 * layouts and spacings from the manufacturers' airport planning documents (Airbus "Aircraft
 * Characteristics - Airport and Maintenance Planning", Boeing "Airplane Characteristics for
 * Airport Planning", Embraer, Bombardier, ATR and De Havilland airport planning manuals); tyre
 * sizes the published ones (A320neo main 46x17R20, nose 30x8.8R15; A321neo main 49x19R22;
 * 737-800 main H44.5x16.5-21, nose 27x7.75R15; 777-300ER main 52x21R22, nose 43x17.5R17;
 * 787-9 main 54x21R23, nose 40x16R16; A330 main 50x20R22, A330 and A350 nose 1050x395R16;
 * A350 and A380 main 1400x530R23, A380 nose 1270x455R22; 747-8 main 52x21R22, nose 49x17;
 * ATR 72 main 32x8.8R16, nose 450x190-5; Q400 main 34x10.75-16, nose 22x6.5-10); 777 bogie
 * 55 in between wheels, 57 in between axles; 747 44 and 58 in. The A220, E-Jets, CRJ900 and
 * Citation tracks and tyres are approximate (rounded from photos against their spans). Stations
 * along the length stay TASK-307's (`fixedWingGearStations`, the A380 and 747 body gear at
 * 0.147 of the length aft of the middle), so the sim's contact points are unchanged.
 * Retraction (`gearFoldMaterial`): the main legs, with their doors, turn a quarter turn inboard
 * about their tops into the wheel wells (A320 family, 737, A220, E-Jets, CRJ900, A330, A350,
 * 777, 787, Citation; the A380's and 747's body gear the same way as their wing gear); the
 * Q400's fold aft into the nacelles and the ATR's slide up into the side fairings. Every type's
 * nose leg folds forward into its well (all of these types retract it forward); the nose well
 * doors close over the last third. */
const gearTable: Record<
  string,
  {
    nose: [wheels: 1 | 2, diameter: number, width: number];
    legs: LegSpec[];
    doors: boolean;
    /** How the main legs retract: sideways inboard into the wells unless stated. */
    fold?: 'aft' | 'up';
  }
> = {
  A388: {
    nose: [2, 1.27, 0.455],
    legs: [
      bogie('main', 12.46, 2, 1.4, 0.53, 1.53, 1.8),
      bogie('body', 5.26, 3, 1.4, 0.53, 1.53, 1.75),
    ],
    doors: true,
  },
  B748: {
    nose: [2, 1.24, 0.43],
    legs: [
      bogie('main', 11.0, 2, 1.32, 0.53, 1.12, 1.47),
      bogie('body', 3.84, 2, 1.32, 0.53, 1.12, 1.47),
    ],
    doors: true,
  },
  B77W: {
    nose: [2, 1.09, 0.44],
    legs: [bogie('main', 10.97, 3, 1.32, 0.53, 1.4, 1.45)],
    doors: true,
  },
  A359: {
    nose: [2, 1.05, 0.395],
    legs: [bogie('main', 10.6, 2, 1.4, 0.53, 1.4, 2.0)],
    doors: true,
  },
  A333: {
    nose: [2, 1.05, 0.395],
    legs: [bogie('main', 10.68, 2, 1.27, 0.51, 1.4, 1.98)],
    doors: true,
  },
  B789: {
    nose: [2, 1.02, 0.41],
    legs: [bogie('main', 9.83, 2, 1.37, 0.53, 1.3, 1.47)],
    doors: true,
  },
  A20N: { nose: [2, 0.76, 0.22], legs: [twin(7.59, 1.17, 0.43, 0.93)], doors: true },
  A21N: { nose: [2, 0.76, 0.22], legs: [twin(7.59, 1.24, 0.48, 0.93)], doors: true },
  B738: { nose: [2, 0.69, 0.2], legs: [twin(5.72, 1.13, 0.42, 0.86)], doors: true },
  BCS3: { nose: [2, 0.62, 0.19], legs: [twin(6.7, 1.02, 0.37, 0.75)], doors: true },
  E190: { nose: [2, 0.61, 0.2], legs: [twin(5.94, 1.06, 0.38, 0.75)], doors: true },
  E175: { nose: [2, 0.61, 0.2], legs: [twin(5.2, 0.99, 0.33, 0.7)], doors: true },
  CRJ9: { nose: [2, 0.53, 0.17], legs: [twin(4.04, 0.89, 0.3, 0.62)], doors: true },
  // Main gear in the fuselage side fairings.
  AT76: { nose: [2, 0.45, 0.19], legs: [twin(4.1, 0.81, 0.22, 0.52)], doors: false, fold: 'up' },
  // Main gear in the inner engine nacelles.
  DH8D: {
    nose: [2, 0.56, 0.17],
    legs: [twin(8.79, 0.86, 0.27, 0.58)],
    doors: true,
    fold: 'aft',
  },
  C25C: {
    nose: [1, 0.46, 0.15],
    legs: [{ ...twin(3.3, 0.56, 0.19, 0), axles: 1, wheelsPerAxle: 1 }],
    doors: false,
  },
};

/** A type's gear legs placed at TASK-307's stations, nose leg first; null for a type drawn with
 * TASK-307's gear at every level (helicopters, types without a real model). */
export function gearLayout(type: AircraftType): GearLeg[] | null {
  const spec = gearTable[type.id];
  if (!spec) return null;
  const { noseX, mainX } = fixedWingGearStations(type.lengthM);
  const [wheels, d, w] = spec.nose;
  return [
    {
      x: noseX,
      track: 0,
      axles: 1,
      wheelsPerAxle: wheels,
      tyre: [d, w],
      pair: wheels === 2 ? w + d * 0.2 + 0.1 : 0,
      axleSpacing: 0,
    },
    ...spec.legs.map(({ at, ...leg }) => ({
      ...leg,
      x: at === 'main' ? mainX : -0.147 * type.lengthM,
    })),
  ];
}

export const gearWheels = (legs: readonly GearLeg[]) =>
  legs.reduce((sum, leg) => sum + leg.axles * leg.wheelsPerAxle * (leg.track ? 2 : 1), 0);

const gearColors = {
  strut: 0xc4c9ce,
  piston: 0xf2f4f6,
  link: 0x7d868f,
  tyre: 0x22262a,
  hub: 0x9aa2aa,
  door: 0xdfe3e7,
};

/** A retraction: a turn (axis times angle, radians) about `pivot` and a shift (metres), over
 * the last `1 - start` of the way from down to stowed; a bogie first tilts by `tilt` (radians,
 * front up) about its middle, `tiltPivot`, over the first 30%. */
interface GearFold {
  pivot: Vector3;
  turn: Vector3;
  shift: Vector3;
  start: number;
  tiltPivot: Vector3;
  tilt: number;
}
const noFold: GearFold = {
  pivot: new Vector3(),
  turn: new Vector3(),
  shift: new Vector3(),
  start: 0,
  tiltPivot: new Vector3(),
  tilt: 0,
};

/** TASK-331: the material of the landing gear batches. Each vertex folds by its own retraction
 * (`GearFold`, as vertex attributes) as the aircraft's `gearExtension` (TASK-359: per instance)
 * goes from 1 (down) to 0 (stowed), turning rigidly about its leg's pivot: no part is scaled.
 * Geometry without the attributes (TASK-307's gear) does not move. */
export function gearFoldMaterial() {
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.customProgramCacheKey = () => 'gear-fold';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 gearPivot;
        attribute vec3 gearTurn;
        attribute vec3 gearShift;
        attribute vec2 gearMove;
        attribute vec3 gearTiltPivot;
        attribute float gearExtension;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float gearT = clamp((1.0 - gearExtension - gearMove.x) / max(1e-4, 1.0 - gearMove.x), 0.0, 1.0);
        float gearTilt = gearMove.y * clamp((1.0 - gearExtension) / 0.3, 0.0, 1.0);
        float gearTc = cos(gearTilt), gearTs = sin(gearTilt);
        objectNormal.xy = vec2(objectNormal.x * gearTc - objectNormal.y * gearTs, objectNormal.x * gearTs + objectNormal.y * gearTc);
        vec3 gearR = gearTurn * gearT;
        float gearA = length(gearR);
        vec3 gearK = gearA > 1e-5 ? gearR / gearA : vec3(1.0, 0.0, 0.0);
        float gearC = cos(gearA), gearS = sin(gearA);
        objectNormal = objectNormal * gearC + cross(gearK, objectNormal) * gearS
          + gearK * dot(gearK, objectNormal) * (1.0 - gearC);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 gearQ = transformed.xy - gearTiltPivot.xy;
        transformed.xy = gearTiltPivot.xy + vec2(gearQ.x * gearTc - gearQ.y * gearTs, gearQ.x * gearTs + gearQ.y * gearTc);
        vec3 gearP = transformed - gearPivot;
        transformed = gearPivot + gearP * gearC + cross(gearK, gearP) * gearS
          + gearK * dot(gearK, gearP) * (1.0 - gearC);
        transformed += gearShift * gearT;`,
      );
  };
  return material;
}

/** Coloured, non-indexed pieces merged into one geometry. */
class GearPieces {
  readonly list: BufferGeometry[] = [];
  private readonly color = new Color();
  /** How the pieces added next retract (`gearFoldMaterial`). */
  fold: GearFold = noFold;
  add(geometry: BufferGeometry, color: number, matrix?: Matrix4) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    if (matrix) flat.applyMatrix4(matrix);
    this.color.setHex(color);
    const count = flat.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.color.toArray(colors, i * 3);
    flat.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const { pivot, turn, shift, start, tiltPivot, tilt } = this.fold;
    const repeat = (values: number[]) =>
      new Float32BufferAttribute(Array.from({ length: count }, () => values).flat(), values.length);
    flat.setAttribute('gearPivot', repeat([pivot.x, pivot.y, pivot.z]));
    flat.setAttribute('gearTurn', repeat([turn.x, turn.y, turn.z]));
    flat.setAttribute('gearShift', repeat([shift.x, shift.y, shift.z]));
    flat.setAttribute('gearMove', repeat([start, tilt]));
    flat.setAttribute('gearTiltPivot', repeat([tiltPivot.x, tiltPivot.y, tiltPivot.z]));
    this.list.push(flat);
  }
  /** A round bar from `a` to `b`, open-ended. */
  bar(a: Vector3, b: Vector3, radius: number, color: number, sides = 8) {
    const direction = b.clone().sub(a);
    const matrix = new Matrix4().compose(
      a.clone().lerp(b, 0.5),
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()),
      new Vector3(1, 1, 1),
    );
    this.add(
      new CylinderGeometry(radius, radius, direction.length(), sides, 1, true),
      color,
      matrix,
    );
  }
  /** A box between corners `a` and `b`, square to the axes. */
  box(a: Vector3, b: Vector3, color: number) {
    const size = b.clone().sub(a);
    const centre = a.clone().lerp(b, 0.5);
    this.add(
      new BoxGeometry(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)).translate(
        centre.x,
        centre.y,
        centre.z,
      ),
      color,
    );
  }
  merge() {
    const geometry = mergeGeometries(this.list)!;
    for (const piece of this.list) piece.dispose();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** A tyre turned about its axle (along z) with `sides` sides, its lowest point on the ground:
 * sidewalls, a flat tread with rounded shoulders, and on its outward face (`out`, +-1) a hub
 * recessed into the rim. */
function wheel(
  pieces: GearPieces,
  x: number,
  z: number,
  [d, w]: [number, number],
  out: number,
  sides: number,
) {
  const r = d / 2;
  const hub = r * 0.6;
  const profile = [
    new Vector2(hub, -w * 0.47),
    new Vector2(r * 0.92, -w * 0.5),
    new Vector2(r * 0.995, -w * 0.3),
    new Vector2(r * 0.995, w * 0.3),
    new Vector2(r * 0.92, w * 0.5),
    new Vector2(hub, w * 0.47),
    // The rim's inner wall, down to the hub.
    new Vector2(hub, w * 0.2),
  ];
  // A vertex at phi = 0 turns to the bottom: the lowest point is exactly on the ground.
  const tyre = new LatheGeometry(profile, sides).rotateX(Math.PI / 2);
  if (out < 0) tyre.rotateY(Math.PI);
  pieces.add(tyre.translate(x, r, z), gearColors.tyre);
  // The disc meets the rim wall vertex for vertex.
  const disc = new CircleGeometry(hub, sides, -Math.PI / 2).translate(0, 0, w * 0.2);
  if (out < 0) disc.rotateY(Math.PI);
  pieces.add(disc.translate(x, r, z), gearColors.hub);
}

/** Tyre sides by detail: as many as the near level's budget (`gearBudget`) leaves room for. */
const tyreSides = [24, 20, 18, 16, 14, 12];
/** The near level's triangles per type, at most. */
export const gearBudget = 4000;
/** Bands of a tyre's turned profile (`wheel`). */
export const tyreBands = 6;

/** TASK-331: one type's landing gear in the aircraft's frame: the main legs (`main`) and the nose
 * leg in its steering frame at the nose station (`nose`), each one coloured geometry. `attachY`
 * gives the airframe's underside above a point (the leg's top). Near: oleo struts with a bright
 * piston under a thicker cylinder (real proportions: about 0.21 of the main tyre's diameter
 * across on a twin-wheel leg, 0.3 on a bogie leg, 0.2 of the nose tyre's), torque links, side or
 * drag braces, axles or bogie beams, tyres with recessed hubs and open gear doors, tyres with as
 * many sides as `gearBudget` allows; middle: struts and wheel blocks. */
export function buildAircraftGear(
  type: AircraftType,
  attachY: (x: number, z: number) => number,
  detail: 'near' | 'middle',
) {
  const legs = gearLayout(type)!;
  for (const sides of detail === 'near' ? tyreSides : [0]) {
    const gear = gearPieces(type, legs, attachY, detail === 'near', sides);
    const triangles =
      (gear.main.getAttribute('position').count + gear.nose.getAttribute('position').count) / 3;
    if (triangles <= gearBudget || sides === tyreSides.at(-1)) return { ...gear, sides, triangles };
    gear.main.dispose();
    gear.nose.dispose();
  }
  throw new Error(`no gear for ${type.id}`);
}

function gearPieces(
  type: AircraftType,
  legs: GearLeg[],
  attachY: (x: number, z: number) => number,
  near: boolean,
  sides: number,
) {
  const spec = gearTable[type.id]!;
  const main = new GearPieces();
  const nose = new GearPieces();
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  for (const [i, leg] of legs.entries()) {
    const pieces = i === 0 ? nose : main;
    const [d, w] = leg.tyre;
    const r = d / 2;
    // The nose leg is built about its own station (it steers about it).
    const x = i === 0 ? 0 : leg.x;
    // The upper cylinder's radius.
    const oleo = (d * (i === 0 ? 0.2 : leg.axles > 1 ? 0.3 : 0.21)) / 2;
    for (const side of leg.track ? [-1, 1] : [0]) {
      const z = (side * leg.track) / 2;
      const top = attachY(leg.x, Math.abs(z)) + 0.15;
      const span = top - r;
      const length = (leg.axles - 1) * leg.axleSpacing;
      const quarter = Math.PI / 2;
      const wheelZ = leg.wheelsPerAxle === 2 ? [-leg.pair / 2, leg.pair / 2] : [0];
      // A single wheel sits beside its leg, outboard.
      const offset = leg.wheelsPerAxle === 1 ? (side || 1) * (w / 2 + oleo * 1.4) : 0;
      // Folding inboard stands each axle's wheels one above the other; the folded leg then
      // shifts in under the fuselage, its lowest tyre just above the belly a third of the way
      // in from its station. A leg folding fore or aft rises by a tyre radius into its well.
      const pivot = v(x, top - 0.15, z);
      let turn = v(0, 0, quarter),
        shift = v(0, r + 0.1, 0);
      if (i > 0 && spec.fold === 'aft') turn = v(0, 0, -quarter);
      else if (i > 0 && spec.fold === 'up') [turn, shift] = [v(0, 0, 0), v(0, span, 0)];
      else if (i > 0) {
        turn = v(side * quarter, 0, 0);
        const stack = Math.max(...wheelZ.map((wz) => Math.abs(offset + wz))) + w / 2 + 0.1;
        const foldedZ = z - side * (pivot.y - r);
        const stowZ = z * 0.3;
        shift = v(0, attachY(leg.x, Math.abs(stowZ)) + stack - pivot.y, stowZ - foldedZ);
      }
      pieces.fold = { ...noFold, pivot, turn, shift };
      if (!near) {
        pieces.box(v(x - oleo, r, z - oleo), v(x + oleo, top, z + oleo), gearColors.strut);
        for (let a = 0; a < leg.axles; a++) {
          const ax = x + (a - (leg.axles - 1) / 2) * leg.axleSpacing;
          pieces.box(
            v(ax - r * 0.92, 0.02, z + offset + wheelZ[0]! - w / 2),
            v(ax + r * 0.92, d, z + offset + wheelZ.at(-1)! + w / 2),
            gearColors.tyre,
          );
        }
        continue;
      }
      // Oleo: the thicker outer cylinder above, the bright piston below, down to the axle or
      // beam.
      const knee = r + span * 0.42;
      pieces.bar(v(x, knee, z), v(x, top, z), oleo, gearColors.strut, 10);
      pieces.bar(v(x, r, z), v(x, knee + oleo, z), oleo * 0.64, gearColors.piston, 10);
      // Torque links: a V ahead of the oleo (behind it on the nose leg) between the cylinder's
      // foot and the piston's.
      const ahead = i === 0 ? -1 : 1;
      const elbow = v(x + ahead * oleo * 2.6, (knee + r) / 2 + oleo * 0.5, z);
      const link = Math.max(0.03, oleo * 0.32);
      pieces.bar(v(x + ahead * oleo * 0.8, knee - oleo * 0.3, z), elbow, link, gearColors.link, 4);
      pieces.bar(elbow, v(x + ahead * oleo * 0.6, r + oleo * 0.9, z), link, gearColors.link, 4);
      const brace = Math.max(0.04, oleo * 0.5);
      if (i === 0) {
        // Drag brace forward to the nose well.
        pieces.bar(
          v(x, knee + span * 0.15, z),
          v(x + span * 0.55, top, z),
          brace,
          gearColors.link,
          8,
        );
      } else {
        // Side brace inboard to the wing or fuselage.
        const inboard = -Math.sign(side) * span * 0.45;
        pieces.bar(v(x, knee + span * 0.2, z), v(x, top, z + inboard), brace, gearColors.link, 6);
      }
      // Axles across, and a bogie's beam along the length; a bogie tilts, front up, before it
      // folds.
      const strut = pieces.fold;
      if (leg.axles > 1) pieces.fold = { ...strut, tiltPivot: v(x, r, z), tilt: 0.26 };
      if (leg.axles > 1)
        pieces.bar(
          v(x - length / 2 - oleo, r, z),
          v(x + length / 2 + oleo, r, z),
          oleo * 0.62,
          gearColors.link,
          6,
        );
      for (let a = 0; a < leg.axles; a++) {
        const ax = x + (a - (leg.axles - 1) / 2) * leg.axleSpacing;
        const ends = wheelZ.map((wz) => z + offset + wz);
        pieces.bar(
          v(ax, r, Math.min(z, ...ends) - (leg.wheelsPerAxle === 2 ? w * 0.3 : 0)),
          v(ax, r, Math.max(z, ...ends) + (leg.wheelsPerAxle === 2 ? w * 0.3 : 0)),
          oleo * 0.4,
          gearColors.link,
          4,
        );
        for (const wz of ends) wheel(pieces, ax, wz, leg.tyre, Math.sign(wz - z) || 1, sides);
      }
      pieces.fold = strut;
      if (!spec.doors) continue;
      if (i === 0) {
        // Nose doors open either side of the well; they close inward over the last third.
        for (const s of [-1, 1]) {
          const dz = s * (leg.pair / 2 + w + 0.12);
          pieces.fold = {
            ...noFold,
            pivot: v(x, top - 0.15, dz),
            turn: v(s * quarter, 0, 0),
            start: 0.67,
          };
          pieces.box(
            v(x - d * 0.2, top - 0.15 - Math.min(span * 0.4, d * 0.75), dz - 0.015),
            v(x + d * 1.4, top, dz + 0.015),
            gearColors.door,
          );
        }
      } else {
        // A door on the leg's outboard face, over the upper oleo.
        const dz = z + Math.sign(side) * (oleo + 0.05);
        pieces.box(
          v(x - d * 0.32, top - 0.15 - span * 0.45, dz - 0.015),
          v(x + d * 0.32, top, dz + 0.015),
          gearColors.door,
        );
      }
    }
  }
  return { main: main.merge(), nose: nose.merge(), wheels: gearWheels(legs) };
}

function lightMounts(type: AircraftType, layout: Layout): AircraftLightMounts {
  const { wing, tailplane, body, radius, bodyY } = layout;
  const helicopter = type.class === 'helicopter';
  const tip = (helicopter ? tailplane : wing).at(-1)!;
  const tail = body[0]!;
  const root = wing[0];
  const navX = tip.x - tip.chord * 0.14;
  return {
    navLeft: [navX, tip.y, -tip.z],
    navRight: [navX, tip.y, tip.z],
    navTail: [tail.x, tail.y, 0],
    beacon: [0, bodyY + radius * (type.class === 'double_decker' ? 1.26 : 1), 0],
    strobes: [
      [tip.x - tip.chord * 0.68, tip.y, -tip.z],
      [tip.x - tip.chord * 0.68, tip.y, tip.z],
    ],
    landing: root
      ? [-1, 1].map((side) => [root.x - type.lengthM * 0.032, root.y, side * type.spanM * 0.105])
      : [[type.lengthM * 0.29, bodyY - radius * 0.72, 0]],
    taxi: [type.lengthM * (helicopter ? 0.24 : 0.34) + radius * 0.1, radius * 0.62, 0],
  };
}

/** A procedural model centred along its length, with +X forward and Y = 0 at ground level. A
 * number paints the plain scheme of that tail colour. The model has no pose: callers place and
 * tilt `root` (TASK-314 owns the attitude). */
export function buildAircraftMesh(
  type: AircraftType,
  scheme: AircraftLivery | number = 0x31657f,
): AircraftMesh {
  const livery = typeof scheme === 'number' ? plainLivery(scheme) : scheme;
  const layout = aircraftLayout(type);
  const { body, radius, bodyY, wing, tailplane, fin, engines, rotorX, rotorY } = layout;
  const { lengthM: length, spanM: span, class: category } = type;
  const helicopter = category === 'helicopter';
  const jet = !helicopter && category !== 'propeller';
  const root = new Group();
  root.name = type.id;
  const paints = new Map<number, MeshLambertMaterial>();
  const paint = (color: number) => {
    let material = paints.get(color);
    if (!material) paints.set(color, (material = new MeshLambertMaterial({ color })));
    return material;
  };
  const metal = paint(0xb8c1ca);
  const glass = paint(0x233747);
  const rubber = paint(0x252b31);
  const blades = paint(0x4d5964);
  const fan = paint(0x2f353c);
  const exhaust = paint(0x6c757e);
  const seam = paint(0xd3d8dd);
  const named = <T extends Object3D>(object: T, name: string) => {
    object.name = name;
    return object;
  };

  const tip = ({ x, y }: Layout['body'][number]): Point => [x, y, 0];
  root.add(
    named(
      new Mesh(
        loft(
          body.slice(1, -1).map(({ x, y, width, height }) => ellipse(x, y, 0, width, height)),
          tip(body[0]!),
          tip(body.at(-1)!),
        ),
        paint(hull),
      ),
      'fuselage',
    ),
  );
  for (const band of liveryBands(layout, length, livery, paint)) root.add(band);
  if (wing.length) {
    root.add(named(liftingSurface(wing, metal), 'wings'));
    if (layout.tip !== 'none' && layout.tip !== 'raked') {
      const tips = new Group();
      for (const geometry of wingtip(layout.tip, layout, span / 2)) {
        const right = new Mesh(geometry, paint(livery.tail));
        tips.add(mirrored(right), right);
      }
      root.add(named(tips, 'winglets'));
    }
  }
  root.add(named(liftingSurface(tailplane, metal), 'tailplane'));
  const finRing = (x: number, y: number, chord: number, half: number): Point[] => [
    [x, y, 0],
    [x - chord * 0.24, y, -half],
    [x - chord, y, 0],
    [x - chord * 0.24, y, half],
  ];
  root.add(
    named(
      new Mesh(
        loft(
          [
            finRing(fin.baseX, fin.baseY, fin.baseChord, radius * 0.16),
            finRing(fin.tipX, fin.tipY, fin.tipChord, radius * 0.034),
          ],
          [fin.baseX - fin.baseChord * 0.33, fin.baseY, 0],
          [fin.tipX - fin.tipChord * 0.33, fin.tipY, 0],
        ),
        paint(livery.tail),
      ),
      'fin',
    ),
  );

  // Doors: on both sides of an airliner (service doors to starboard), the port side alone of a
  // turboprop or business jet; helicopters slide theirs open on either side.
  const twoSided = jet && category !== 'private';
  for (const door of layout.doors) {
    const [a0, a1] = arcOf(layout, door.x, door.sillM, door.sillM + door.heightM);
    const panel = new Mesh(
      skin(layout, door.x - door.widthM / 2, door.x + door.widthM / 2, a0, a1, 1.017),
      seam,
    );
    const port = named(mirrored(panel), 'door');
    root.add(port);
    if (twoSided || helicopter) root.add(named(panel, 'door'));
  }
  if (!helicopter) {
    // Windscreen: two forward panes over the nose, the side windows behind them.
    for (const [x0, x1, a0, a1] of [
      [0.428, 0.446, 0.12, 0.58],
      [0.405, 0.427, 0.72, 1.05],
    ] as const) {
      const pane = new Mesh(skin(layout, x0 * length, x1 * length, a0, a1, 1.01), glass);
      root.add(named(pane, 'windscreen'), named(mirrored(pane), 'windscreen'));
    }
  }

  // Flap-track fairings under the trailing edge of an airliner's wing.
  const tracks = { double_decker: 5, widebody: 4, narrowbody: 3, regional_jet: 2 }[
    category as 'widebody'
  ];
  if (tracks)
    for (let i = 0; i < tracks; i++) {
      const at = wingAt(wing, (span / 2) * (0.2 + (0.5 * i) / Math.max(1, tracks - 1)));
      const te = at.x - at.chord;
      const w = at.chord * 0.05,
        y = at.y - at.thickness * 0.35 - w;
      const fairing = new Mesh(
        loft(
          [
            ellipse(te + at.chord * 0.25, y + w * 0.4, 0, w * 0.6, w * 0.5, 8),
            ellipse(te, y, 0, w, w, 8),
            ellipse(te - at.chord * 0.3, y + w * 0.2, 0, w * 0.6, w * 0.6, 8),
          ],
          [te + at.chord * 0.35, y + w * 0.6, 0],
          [te - at.chord * 0.42, y + w * 0.4, 0],
        ),
        metal,
      );
      fairing.position.z = (span / 2) * (0.2 + (0.5 * i) / Math.max(1, tracks - 1));
      root.add(named(fairing, 'fairing'), named(mirrored(fairing), 'fairing'));
    }
  // The wing-to-body fairing under a low wing; the ATR carries its main gear in side sponsons.
  const belly = paint(livery.belly ?? hull);
  if (jet && wing.length && wing[0]!.y < bodyY) {
    const { x, chord } = wing[0]!;
    const y = bodyY - radius * 0.5;
    root.add(
      named(
        new Mesh(
          loft(
            [
              ellipse(x - chord * 0.02, y, 0, radius * 0.7, radius * 0.4),
              ellipse(x - chord * 0.2, y, 0, radius * 1.04, radius * 0.6),
              ellipse(x - chord * 0.8, y, 0, radius * 1.04, radius * 0.6),
              ellipse(x - chord * 1.02, y, 0, radius * 0.7, radius * 0.35),
            ],
            [x + chord * 0.05, y, 0],
            [x - chord * 1.1, y, 0],
          ),
          belly,
        ),
        'fairing',
      ),
    );
  }
  if (type.id === 'AT76') {
    const sponson = new Mesh(
      loft(
        [
          ellipse(length * 0.06, 0, 0, radius * 0.25, radius * 0.25, 10),
          ellipse(length * -0.04, 0, 0, radius * 0.34, radius * 0.32, 10),
          ellipse(length * -0.14, 0, 0, radius * 0.22, radius * 0.22, 10),
        ],
        [length * 0.09, 0, 0],
        [length * -0.18, 0, 0],
      ),
      belly,
    );
    sponson.position.set(0, bodyY - radius * 0.62, radius * 0.78);
    root.add(named(sponson, 'fairing'), named(mirrored(sponson), 'fairing'));
  }

  const propellers: Group[] = [];
  for (const engine of engines) {
    const { x, y, z, length, radius: r, propRadius } = engine;
    const half = length / 2;
    const nacelle = new Group();
    nacelle.name = 'engine';
    nacelle.position.set(x, y, z);
    nacelle.add(
      new Mesh(
        loft(
          [
            ellipse(-half, 0, 0, r * 0.54, r * 0.53),
            ellipse(-half * 0.46, 0, 0, r * 0.83, r * 0.8),
            ellipse(half * 0.61, 0, 0, r, r * 0.97),
            ellipse(half, 0, 0, r * 0.91, r * 0.9),
          ],
          [-half, 0, 0],
          [half, 0, 0],
        ),
        paint(livery.engines),
      ),
    );
    if (propRadius) {
      const inlet = new Mesh(new CylinderGeometry(r * 0.72, r * 0.72, r * 0.08, 16), fan);
      inlet.rotation.z = -Math.PI / 2;
      inlet.position.x = half;
      nacelle.add(named(inlet, 'fan'));
    } else {
      // The fan face inside the intake lip, its spinner, and the exhaust plug.
      const face = new Mesh(new CylinderGeometry(r * 0.84, r * 0.84, r * 0.04, 18), fan);
      face.rotation.z = -Math.PI / 2;
      face.position.x = half + r * 0.01;
      const cone = new Mesh(new ConeGeometry(r * 0.24, r * 0.34, 12), metal);
      cone.rotation.z = -Math.PI / 2;
      cone.position.x = half + r * 0.2;
      const plug = new Mesh(new ConeGeometry(r * 0.36, r * 0.6, 12), exhaust);
      plug.rotation.z = Math.PI / 2;
      plug.position.x = -half - r * 0.28;
      nacelle.add(named(face, 'fan'), named(cone, 'fan'), named(plug, 'fan'));
    }
    if (type.engines.mount === 'wing') {
      const pylon = new Mesh(new BoxGeometry(length * 0.62, r * 1.28, r * 0.3), metal);
      pylon.position.set(-half * 0.3, r * 0.76, 0);
      nacelle.add(pylon);
    } else if (type.engines.mount === 'rear') {
      const pylon = new Mesh(new BoxGeometry(length * 0.5, r * 0.3, r * 0.9), metal);
      pylon.position.set(-half * 0.1, 0, -Math.sign(z) * r * 0.9);
      nacelle.add(pylon);
    }
    if (propRadius) {
      const mount = new Group();
      mount.position.x = half + r * 0.16;
      mount.rotation.z = -Math.PI / 2;
      const propeller = spinner(propRadius, 4, 0.13, blades);
      propeller.name = 'propeller';
      propellers.push(propeller);
      mount.add(propeller);
      nacelle.add(mount);
    }
    root.add(nacelle);
  }

  const rotors: Group[] = [];
  if (helicopter) {
    const mast = new Mesh(
      new CylinderGeometry(radius * 0.16, radius * 0.21, radius * 0.58, 10),
      metal,
    );
    mast.position.set(rotorX, rotorY - radius * 0.29, 0);
    const main = spinner(span / 2, 4, 0.065, blades);
    main.position.set(rotorX, rotorY, 0);
    main.name = 'main-rotor';
    const mount = new Group();
    mount.position.set(-length * 0.448, bodyY + radius * 0.79, radius * 0.18);
    mount.rotation.x = Math.PI / 2;
    const tailRotor = spinner(radius * 0.48, 4, 0.13, blades);
    tailRotor.name = 'tail-rotor';
    mount.add(tailRotor);
    root.add(mast, main, mount);
    rotors.push(main, tailRotor);
  }

  const { rows, cockpit } = windowRows(type, layout, glass);
  const { gear, noseGear } = landingGear(type, layout, metal, rubber);
  if (cockpit) root.add(cockpit);
  root.add(...rows, gear);
  return {
    root,
    gear,
    noseGear,
    propellers,
    rotors,
    windowRows: rows,
    lightMounts: lightMounts(type, layout),
  };
}
