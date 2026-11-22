import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  Vector3,
  type ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hull, plainLivery, type AircraftLivery } from '../render/aircraft-livery';
import { aircraftLayout, type WingtipKind } from '../render/aircraft-outline';
import type { AircraftType } from '../schema/aircraft';

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
  /** Each returned group spins about its own local Y axis, irrespective of the mount orientation. */
  propellers: Group[];
  rotors: Group[];
  /** Passenger windows, grouped into one or two decks. */
  windowRows: Group[];
  lightMounts: AircraftLightMounts;
}

/** Bake rigid parts in the frame that moves them. Windows keep their compact pane instances,
 * and gear and rotors retain their own visibility and animation. */
export function batchAircraftMesh(mesh: AircraftMesh, outline: ShaderMaterial) {
  const { root, gear, propellers, rotors } = mesh;
  const frames = new Set([root, gear, ...propellers, ...rotors]);
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
    if (rim.length) {
      const contour = new Mesh(mergeGeometries(rim)!, outline);
      contour.userData.outline = true;
      contour.matrixAutoUpdate = false;
      frame.add(contour);
    }
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
  function strut(from: Point, to: Point, width: number) {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const direction = b.clone().sub(a);
    const mesh = new Mesh(new CylinderGeometry(width, width, direction.length(), 8), metal);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    gear.add(mesh);
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
    return gear;
  }
  const wheelR = radius * 0.21;
  const tyre = new CylinderGeometry(wheelR, wheelR, wheelR * 0.67, 12).rotateX(Math.PI / 2);
  function bogie(x: number, z: number, y: number, axles: number) {
    strut([x, wheelR, z], [x, y, z], wheelR * 0.27);
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
        gear.add(wheel);
      }
    }
  }
  const helicopter = category === 'helicopter';
  bogie(length * (helicopter ? 0.23 : 0.34), 0, bodyY - radius * 0.65, 1);
  const mainY = helicopter ? bodyY - radius * 0.42 : layout.wing[0]!.y;
  const axles = category === 'widebody' || category === 'double_decker' ? 2 : 1;
  for (const side of [-1, 1]) {
    bogie(-length * 0.08, side * (helicopter ? radius * 0.74 : span * 0.09), mainY, axles);
    if (category === 'double_decker') {
      bogie(-length * 0.147, side * radius * 0.54, bodyY - radius * 0.77, 2);
    }
  }
  return gear;
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
  const gear = landingGear(type, layout, metal, rubber);
  if (cockpit) root.add(cockpit);
  root.add(...rows, gear);
  return {
    root,
    gear,
    propellers,
    rotors,
    windowRows: rows,
    lightMounts: lightMounts(type, layout),
  };
}
