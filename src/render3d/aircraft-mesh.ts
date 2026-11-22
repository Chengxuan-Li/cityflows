import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';
import { aircraftLayout } from '../render/aircraft-outline';
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

function ellipse(x: number, y: number, z: number, width: number, height: number): Point[] {
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI) / 8;
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
  const left = right.clone();
  left.scale.z = -1;
  pair.add(left, right);
  return pair;
}

function windowRows(type: AircraftType, layout: Layout, glass: MeshLambertMaterial) {
  const { lengthM: length, class: category, id } = type;
  const { body, radius } = layout;
  const helicopter = category === 'helicopter';
  function surface(x: number, angle: number) {
    const i = body.findIndex((station) => station.x >= x);
    const a = body[i - 1]!;
    const b = body[i]!;
    const fraction = (x - a.x) / (b.x - a.x);
    const lerp = (from: number, to: number) => from + (to - from) * fraction;
    return new Vector3(
      x,
      lerp(a.y, b.y) + Math.cos(angle) * lerp(a.height, b.height),
      Math.sin(angle) * lerp(a.width, b.width),
    );
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
    const panes = new InstancedMesh(pane, glass, count * 2);
    for (let j = 0; j < count; j++) {
      for (const side of [-1, 1]) {
        placePane(
          panes,
          j * 2 + (side === 1 ? 1 : 0),
          from + ((to - from) * j) / (count - 1),
          angle * side,
          helicopter ? length * 0.035 : Math.min(0.19, radius * 0.16),
          helicopter ? 0.28 * radius : Math.min(0.27, radius * 0.22),
        );
      }
    }
    row.add(panes);
    rows.push(row);
  }
  const cockpit = new InstancedMesh(pane, glass, 4);
  cockpit.name = 'cockpit';
  let index = 0;
  for (const side of [-1, 1]) {
    for (const [x, angle] of helicopter
      ? [
          [0.236, 1.03],
          [0.278, 0.62],
        ]
      : [
          [0.404, 0.95],
          [0.435, 0.56],
        ]) {
      placePane(
        cockpit,
        index++,
        x! * length,
        angle! * side,
        radius * 0.38,
        radius * (helicopter ? 0.48 : 0.22),
      );
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

/** A procedural model centred along its length, with +X forward and Y = 0 at ground level. */
export function buildAircraftMesh(type: AircraftType, accentColor = 0x31657f): AircraftMesh {
  const layout = aircraftLayout(type);
  const { body, radius, bodyY, wing, tailplane, fin, engines, rotorX, rotorY } = layout;
  const root = new Group();
  root.name = type.id;
  const hull = new MeshLambertMaterial({ color: 0xf0f1f3 });
  const metal = new MeshLambertMaterial({ color: 0xb8c1ca });
  const accent = new MeshLambertMaterial({ color: accentColor });
  const glass = new MeshLambertMaterial({ color: 0x233747 });
  const rubber = new MeshLambertMaterial({ color: 0x252b31 });
  const blades = new MeshLambertMaterial({ color: 0x4d5964 });

  const tip = ({ x, y }: Layout['body'][number]): Point => [x, y, 0];
  const fuselage = new Mesh(
    loft(
      body.slice(1, -1).map(({ x, y, width, height }) => ellipse(x, y, 0, width, height)),
      tip(body[0]!),
      tip(body.at(-1)!),
    ),
    hull,
  );
  fuselage.name = 'fuselage';
  root.add(fuselage);
  if (wing.length) {
    const wings = liftingSurface(wing, metal);
    wings.name = 'wings';
    root.add(wings);
  }
  const tail = liftingSurface(tailplane, metal);
  tail.name = 'tailplane';
  root.add(tail);
  const finRing = (x: number, y: number, chord: number, half: number): Point[] => [
    [x, y, 0],
    [x - chord * 0.24, y, -half],
    [x - chord, y, 0],
    [x - chord * 0.24, y, half],
  ];
  const verticalTail = new Mesh(
    loft(
      [
        finRing(fin.baseX, fin.baseY, fin.baseChord, radius * 0.16),
        finRing(fin.tipX, fin.tipY, fin.tipChord, radius * 0.034),
      ],
      [fin.baseX - fin.baseChord * 0.33, fin.baseY, 0],
      [fin.tipX - fin.tipChord * 0.33, fin.tipY, 0],
    ),
    accent,
  );
  verticalTail.name = 'fin';
  root.add(verticalTail);

  const propellers: Group[] = [];
  for (const engine of engines) {
    const { x, y, z, length, radius: r, propRadius } = engine;
    const half = length / 2;
    const nacelle = new Group();
    nacelle.name = 'engine';
    nacelle.position.set(x, y, z);
    const nacelleMesh = new Mesh(
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
      hull,
    );
    nacelle.add(nacelleMesh);
    const inlet = new Mesh(new CylinderGeometry(r * 0.72, r * 0.72, r * 0.08, 16), glass);
    inlet.rotation.z = -Math.PI / 2;
    inlet.position.x = half;
    nacelle.add(inlet);
    if (type.engines.mount === 'wing') {
      const pylon = new Mesh(new BoxGeometry(length * 0.48, r * 1.28, r * 0.4), metal);
      pylon.position.set(-half * 0.38, r * 0.76, 0);
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
  if (type.class === 'helicopter') {
    const mast = new Mesh(
      new CylinderGeometry(radius * 0.16, radius * 0.21, radius * 0.58, 10),
      metal,
    );
    mast.position.set(rotorX, rotorY - radius * 0.29, 0);
    const main = spinner(type.spanM / 2, 4, 0.065, blades);
    main.position.set(rotorX, rotorY, 0);
    main.name = 'main-rotor';
    const mount = new Group();
    mount.position.set(-type.lengthM * 0.448, bodyY + radius * 0.79, radius * 0.18);
    mount.rotation.x = Math.PI / 2;
    const tailRotor = spinner(radius * 0.48, 4, 0.13, blades);
    tailRotor.name = 'tail-rotor';
    mount.add(tailRotor);
    root.add(mast, main, mount);
    rotors.push(main, tailRotor);
  }

  const { rows, cockpit } = windowRows(type, layout, glass);
  const gear = landingGear(type, layout, metal, rubber);
  root.add(cockpit, ...rows, gear);
  return {
    root,
    gear,
    propellers,
    rotors,
    windowRows: rows,
    lightMounts: lightMounts(type, layout),
  };
}
