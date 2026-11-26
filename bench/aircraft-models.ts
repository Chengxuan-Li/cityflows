// TASK-318: prepares the real aircraft models committed in fixtures/aircraft from Flightradar24's
// fr24-3d-models (GPL-2.0; models from the FlightGear FGMEMBERS hangar), read by path:
//   node --experimental-strip-types --import ./bench/register.ts bench/aircraft-models.ts <fr24 models dir>
// The sources are glTF 1.0 binaries, which three's GLTFLoader no longer reads (it accepts glTF 2.0
// only), so a small reader below turns them into triangles. The rest is three's own tooling: the
// meshoptimizer simplifier bundled with three (SimplifyModifier wraps it but takes neither locked
// vertices nor the sloppy mode, so it is called directly), BufferGeometryUtils for welding and
// creased normals, Raycaster for placing window panes and door panels, and GLTFExporter for
// glTF 2.0 output. Textures are dropped: every part gets a flat colour, and the fuselage, fin and engines are
// tinted per flight at run time with TASK-315's seeded liveries (`src/render3d/aircraft-models.ts`).
// Each type is turned to +x forward, +y up, +z starboard, scaled to its catalogue length and span
// (span by stretching the wings outside the fuselage only) and set on TASK-307's procedural gear
// height by its fuselage belly; its landing gear is drawn with it at run time (TASK-331's
// `buildAircraftGear`), since the Flightradar24 models carry none.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  Scene,
  Vector3,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// @ts-expect-error three ships no types for its bundled meshoptimizer build
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import {
  mergeGeometries,
  mergeVertices,
  toCreasedNormals,
} from 'three/addons/utils/BufferGeometryUtils.js';
import { aircraftLayout, cabinFloor } from '../src/render/aircraft-outline';
import { aircraftTypes, type AircraftType } from '../src/schema/aircraft';
import { fixedWingGearStations } from '../src/sim/aircraft-motion';

type SpinKind = 'propeller' | 'rotor' | 'tail-rotor';
interface Source {
  type: string;
  file: string;
  /** Node names of spinning parts; propellers split into one per side. */
  spin?: { kind: SpinKind; match: RegExp }[];
}

const sources: Source[] = [
  { type: 'A388', file: 'a380' },
  { type: 'B748', file: 'b748' },
  { type: 'B77W', file: 'b773' },
  { type: 'A359', file: 'a359' },
  { type: 'A333', file: 'a333' },
  { type: 'B789', file: 'b789' },
  { type: 'A20N', file: 'a320' },
  { type: 'B738', file: 'b738' },
  { type: 'A21N', file: 'a321' },
  { type: 'BCS3', file: 'cs300' },
  { type: 'E190', file: 'e190' },
  { type: 'E175', file: 'e170' },
  { type: 'CRJ9', file: 'crj900' },
  { type: 'AT76', file: 'atr42', spin: [{ kind: 'propeller', match: /^Prop\d/ }] },
  { type: 'DH8D', file: 'q400', spin: [{ kind: 'propeller', match: /^prop[LR]$/ }] },
  { type: 'C25C', file: 'citation' },
  ...['EC45', 'A139'].map((type) => ({
    type,
    file: 'heli',
    spin: [
      {
        kind: 'rotor' as const,
        match: /^(blade\d[a-d]?|Flexbeam|rotorcap|pitchlink\d|mastandswashplate|scissor)$/,
      },
      { kind: 'tail-rotor' as const, match: /^Tblade$/ },
    ],
  })),
];

/** Triangle budgets: LOD0 for close views, LOD1 for the middle distance. */
export const budgets = [15_000, 1_500] as const;

/** TASK-331: cabin windows per airliner: the pane's width and height and the window pitch along
 * the cabin, metres. Sizes are the published clear-view sizes in inches (737 10 x 14, 777 and
 * 747-8 10 x 15, 787 10.7 x 18.4, A220 11 x 16 per Airbus, A350 9.5 x 13.5, A320 family and A330
 * about 9 x 13); pitches the frame pitch, one window per frame (737 and 747 20 in, A320, A330
 * and A380 21 in, 787 24 in, 777 and A350 25 in). The regional jets' and turboprops' sizes are
 * approximate (no manufacturer figure at hand) and their pitches the spacing of the sources'
 * own window decals or glass (E-Jets, CRJ900, ATR, Q400). A double-decker's decks share them. */
export const cabinWindows: Record<string, { width: number; height: number; pitch: number }> = {
  A388: { width: 0.25, height: 0.36, pitch: 0.533 },
  B748: { width: 0.254, height: 0.381, pitch: 0.508 },
  B77W: { width: 0.254, height: 0.381, pitch: 0.635 },
  A359: { width: 0.241, height: 0.343, pitch: 0.635 },
  A333: { width: 0.23, height: 0.33, pitch: 0.533 },
  B789: { width: 0.272, height: 0.467, pitch: 0.61 },
  A20N: { width: 0.23, height: 0.33, pitch: 0.533 },
  B738: { width: 0.254, height: 0.356, pitch: 0.508 },
  A21N: { width: 0.23, height: 0.33, pitch: 0.533 },
  BCS3: { width: 0.279, height: 0.406, pitch: 0.508 },
  E190: { width: 0.27, height: 0.36, pitch: 0.8 },
  E175: { width: 0.27, height: 0.36, pitch: 0.8 },
  CRJ9: { width: 0.23, height: 0.3, pitch: 0.8 },
  AT76: { width: 0.26, height: 0.34, pitch: 0.7 },
  DH8D: { width: 0.25, height: 0.33, pitch: 0.53 },
};

/** The x range of the main-deck cabin between the first and last door (TASK-315's doors). */
export function cabinSpan(type: AircraftType) {
  const doors = aircraftLayout(type).doors.filter((d) => !d.upper);
  const front = doors.reduce((a, d) => (d.x > a.x ? d : a));
  const rear = doors.reduce((a, d) => (d.x < a.x ? d : a));
  return { from: rear.x - rear.widthM / 2, to: front.x + front.widthM / 2 };
}

/** Light-source dummies, halos, cabin interiors, wires and probes: not part of the airframe. */
const skipped =
  /light|lamp|lts$|lens|beacon|strobe|flash|fog|shadow|halo|interior|carpet|seat|stair|pitot|wire|blurred|rotor_disc|^emit|handle|wiper|sensor|antenna|cargohook|searchlight|wirecutter/i;
const glassNames = /glass|glas$|window|windshield|windscreen/i;
const engineNames =
  /eng|nacelle|intake|inlet|cowl|fan|nozzle|exhaust|casing|reverser|core|spinner|turbofan|bypass|shroud/i;

// ---- glTF 1.0 binary reader -------------------------------------------------------------------

interface SourceGroup {
  node: string;
  material: string;
  /** sRGB colour of an untextured material, or null for a textured one. */
  color: [number, number, number] | null;
}
interface Soup {
  position: number[];
  normal: number[];
  /** Per triangle: index into `groups`. */
  group: number[];
  groups: SourceGroup[];
}

const componentArrays: Record<number, { bytes: number; get: (v: DataView, at: number) => number }> =
  {
    5120: { bytes: 1, get: (v, at) => v.getInt8(at) },
    5121: { bytes: 1, get: (v, at) => v.getUint8(at) },
    5122: { bytes: 2, get: (v, at) => v.getInt16(at, true) },
    5123: { bytes: 2, get: (v, at) => v.getUint16(at, true) },
    5125: { bytes: 4, get: (v, at) => v.getUint32(at, true) },
    5126: { bytes: 4, get: (v, at) => v.getFloat32(at, true) },
  };
const componentCounts: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/* eslint-disable @typescript-eslint/no-explicit-any -- glTF 1.0 JSON is read as found */
function readGltf1(path: string): Soup {
  const file = readFileSync(path);
  if (file.toString('ascii', 0, 4) !== 'glTF' || file.readUInt32LE(4) !== 1)
    throw new Error(`${path}: not a glTF 1.0 binary`);
  const contentLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + contentLength).toString('utf8')) as any;
  const body = file.subarray(20 + contentLength);
  const buffers = new Map<string, Buffer>();
  for (const [id, buffer] of Object.entries<any>(json.buffers)) {
    if (id === 'binary_glTF') buffers.set(id, body);
    else if (typeof buffer.uri === 'string' && buffer.uri.startsWith('data:'))
      buffers.set(id, Buffer.from(buffer.uri.slice(buffer.uri.indexOf(',') + 1), 'base64'));
    else throw new Error(`${path}: external buffer ${id}`);
  }
  const read = (id: string) => {
    const accessor = json.accessors[id];
    const view = json.bufferViews[accessor.bufferView];
    const bytes = buffers.get(view.buffer)!;
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const { bytes: size, get } = componentArrays[accessor.componentType]!;
    const count = componentCounts[accessor.type]!;
    const stride = accessor.byteStride || size * count;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const out = new Float64Array(accessor.count * count);
    for (let i = 0; i < accessor.count; i++)
      for (let c = 0; c < count; c++) out[i * count + c] = get(data, start + i * stride + c * size);
    return { values: out, count };
  };
  const soup: Soup = { position: [], normal: [], group: [], groups: [] };
  const materialColor = (material: any): [number, number, number] | null => {
    const values = material?.values ?? material?.extensions?.KHR_materials_common?.values ?? {};
    const diffuse = values.diffuse;
    return Array.isArray(diffuse) ? [diffuse[0], diffuse[1], diffuse[2]] : null;
  };
  const p = new Vector3();
  const n = new Vector3();
  const visit = (id: string, parent: Matrix4) => {
    const node = json.nodes[id];
    const local = new Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else
      local.compose(
        new Vector3(...(node.translation ?? [0, 0, 0])),
        new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new Vector3(...(node.scale ?? [1, 1, 1])),
      );
    const world = parent.clone().multiply(local);
    const normalMatrix = new Matrix4().copy(world).invert().transpose();
    const name: string = node.name ?? id;
    for (const meshId of node.meshes ?? []) {
      for (const primitive of json.meshes[meshId].primitives) {
        if ((primitive.mode ?? 4) !== 4) continue;
        const material = json.materials?.[primitive.material];
        const materialName: string = material?.name ?? primitive.material ?? '';
        if (skipped.test(name) || skipped.test(materialName)) continue;
        const positions = read(primitive.attributes.POSITION).values;
        const normals = primitive.attributes.NORMAL
          ? read(primitive.attributes.NORMAL).values
          : null;
        const vertexCount = positions.length / 3;
        const indices = primitive.indices
          ? read(primitive.indices).values
          : Float64Array.from({ length: vertexCount }, (_, i) => i);
        const group =
          soup.groups.push({ node: name, material: materialName, color: materialColor(material) }) -
          1;
        for (let t = 0; t + 2 < indices.length; t += 3) {
          for (let k = 0; k < 3; k++) {
            const v = indices[t + k]!;
            p.set(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!).applyMatrix4(
              world,
            );
            soup.position.push(p.x, p.y, p.z);
            if (normals)
              n.set(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!)
                .transformDirection(normalMatrix)
                .normalize();
            else n.set(0, 0, 0);
            soup.normal.push(n.x, n.y, n.z);
          }
          soup.group.push(group);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const id of json.scenes[json.scene].nodes) visit(id, new Matrix4());
  return soup;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- orientation and scale --------------------------------------------------------------------

function extent(position: ArrayLike<number>, axis: number, filter?: (i: number) => boolean) {
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < position.length / 3; i++) {
    if (filter && !filter(i)) continue;
    const v = position[i * 3 + axis]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max] as const;
}

/** A rotation to +x forward, +y up, +z starboard: up is the shortest extent, and the fin (the
 * highest points) marks the tail end of the longer of the other two. */
function orientation(position: number[]) {
  const axes = [0, 1, 2].map((a) => extent(position, a));
  const size = axes.map(([a, b]) => b - a);
  const up = size.indexOf(Math.min(...size));
  const [a, b] = [0, 1, 2].filter((x) => x !== up) as [number, number];
  const top = axes[up]![1] - size[up]! * 0.12;
  const offset = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < position.length / 3; i++) {
    if (position[i * 3 + up]! < top) continue;
    count++;
    for (const axis of [a, b])
      offset[axis]! +=
        (position[i * 3 + axis]! - (axes[axis]![0] + axes[axis]![1]) / 2) / size[axis]!;
  }
  const along = Math.abs(offset[a]!) > Math.abs(offset[b]!) ? a : b;
  const forward = new Vector3().setComponent(along, offset[along]! / count > 0 ? -1 : 1);
  const upward = new Vector3().setComponent(up, 1);
  const starboard = forward.clone().cross(upward);
  return new Matrix4().set(
    forward.x,
    forward.y,
    forward.z,
    0,
    upward.x,
    upward.y,
    upward.z,
    0,
    starboard.x,
    starboard.y,
    starboard.z,
    0,
    0,
    0,
    0,
    1,
  );
}

/** Points where triangles cross the plane x = `at`, as [y, z] pairs. */
function slice(position: ArrayLike<number>, at: number, keep?: (t: number) => boolean) {
  const out: [number, number][] = [];
  for (let t = 0; t < position.length / 9; t++) {
    if (keep && !keep(t)) continue;
    const o = t * 9;
    for (let e = 0; e < 3; e++) {
      const i = o + e * 3,
        j = o + ((e + 1) % 3) * 3;
      const xa = position[i]! - at,
        xb = position[j]! - at;
      if (xa === xb || xa * xb > 0) continue;
      const f = xa / (xa - xb);
      out.push([
        position[i + 1]! + (position[j + 1]! - position[i + 1]!) * f,
        position[i + 2]! + (position[j + 2]! - position[i + 2]!) * f,
      ]);
    }
  }
  return out;
}

/** The fuselage section at `x`: centre height, half height and half width. `prior` bounds the
 * search near TASK-307's procedural body, which is drawn at the same catalogue size. */
function section(
  points: [number, number][],
  prior: { y: number; height: number; width: number },
): { y: number; height: number; width: number } | null {
  const near = points.filter(
    ([y, z]) =>
      Math.abs(z) < prior.width * 1.5 + 0.3 && Math.abs(y - prior.y) < prior.height * 1.5 + 0.3,
  );
  const axis = near.filter(([, z]) => Math.abs(z) < prior.width * 0.3 + 0.05);
  if (axis.length < 2) return null;
  const top = Math.max(...axis.map(([y]) => y));
  const bottom = Math.min(...axis.map(([y]) => y));
  const y = (top + bottom) / 2,
    height = (top - bottom) / 2;
  const band = near.filter(([py]) => Math.abs(py - y) < height * 0.35);
  const width = band.length ? Math.max(...band.map(([, z]) => Math.abs(z))) : prior.width;
  return { y, height, width };
}

/** A prior that leaves the height open, before the model is set on the gear. */
const anyHeight = { y: 0, height: 1e4 };

function priorAt(layout: ReturnType<typeof aircraftLayout>, x: number) {
  const body = layout.body;
  const i = Math.max(
    1,
    body.findIndex((s) => s.x >= x),
  );
  const a = body[i - 1]!,
    b = body[i] ?? a;
  const f = b.x === a.x ? 0 : Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
  const lerp = (u: number, v: number) => u + (v - u) * f;
  return {
    y: lerp(a.y, b.y),
    height: Math.max(0.2, lerp(a.height, b.height)),
    width: Math.max(0.2, lerp(a.width, b.width)),
  };
}

// ---- parts ------------------------------------------------------------------------------------

const wingGrey = [0.82, 0.84, 0.86] as const;
const glass = [0.137, 0.216, 0.278] as const;
/** TASK-315's thin livery bands: part name, fractions of the length and section angles. */
const liveryStrips = [
  ['band-cheatline', -0.44, 0.395, 1.45, 1.58],
  ['band-cheatline-trim', -0.42, 0.39, 1.62, 1.665],
  ['band-belly-trim', -0.43, 0.45, 1.7, 1.75],
  ['band-tailcone-trim', -0.27, 0.395, 1.5, 1.555],
] as const;
/** TASK-315's door seam colour. */
const doorPart = 'cd3d8dd';

/** Mid greys outside the fuselage are the sources' untextured wing and tail surfaces. */
const isGrey = (c: readonly number[]) =>
  luminance(c) > 0.3 && Math.max(...c) - Math.min(...c) < 0.06;
const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
const hex = (c: readonly number[]) =>
  c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as [number, number, number];

interface Prepared {
  type: AircraftType;
  /** Triangles in the final frame, wound outward by the sources' normals. */
  position: Float32Array;
  /** Per triangle: a part name ('hull', 'tail', 'engine', 'wing', 'glass', 'c<rrggbb>'). */
  part: string[];
  spinners: { kind: SpinKind; hub: Vector3; position: Float32Array }[];
  profile: [x: number, y: number, height: number, width: number][];
  /** Scale along the length, of the fuselage section, and of the wings outside it. */
  scale: { x: number; body: number; wing: number };
}

function prepare(source: Source, dir: string): Prepared {
  const type = aircraftTypes.find((t) => t.id === source.type)!;
  const soup = readGltf1(join(dir, `${source.file}.glb`));
  const helicopter = type.class === 'helicopter';
  const rotate = orientation(soup.position);
  const position = new Float32Array(soup.position.length);
  const normal = new Float32Array(soup.normal.length);
  const v = new Vector3();
  for (let i = 0; i < position.length; i += 3) {
    v.fromArray(soup.position, i).applyMatrix4(rotate).toArray(position, i);
    v.fromArray(soup.normal, i).applyMatrix4(rotate).toArray(normal, i);
  }
  const rotated = position.slice();
  const layout = aircraftLayout(type);
  const L = type.lengthM,
    halfSpan = type.spanM / 2;
  const spinOf = soup.group.map((g) => {
    const name = soup.groups[g]!.node;
    return source.spin?.find((s) => s.match.test(name))?.kind ?? null;
  });
  const vertexSpin = (i: number) => spinOf[Math.floor(i / 3)];
  const [x0, x1] = extent(position, 0);
  const [z0, z1] = extent(position, 2);
  const zMid = (z0 + z1) / 2;
  let sx: number, body: number, wing: number, xShift: number;
  const rotorHub = new Vector3();
  if (helicopter) {
    // Uniform scale to the rotor diameter; the fuselage stretched along x so that the tail and
    // the rotor disc's front reach the catalogue length.
    let radius = 0;
    const rotor = (i: number) => vertexSpin(i) === 'rotor';
    const [hx0, hx1] = extent(position, 0, rotor);
    const [hz0, hz1] = extent(position, 2, rotor);
    rotorHub.set((hx0 + hx1) / 2, 0, (hz0 + hz1) / 2);
    for (let i = 0; i < position.length / 3; i++)
      if (rotor(i))
        radius = Math.max(
          radius,
          Math.hypot(position[i * 3]! - rotorHub.x, position[i * 3 + 2]! - rotorHub.z),
        );
    body = wing = halfSpan / radius;
    const [tx0] = extent(position, 0, (i) => !vertexSpin(i));
    sx = (L - radius * body) / (rotorHub.x - tx0);
    xShift = -L / 2 - tx0 * sx;
  } else {
    sx = L / (x1 - x0);
    xShift = -L / 2 - x0 * sx;
    body = sx;
    wing = sx;
  }
  for (let i = 0; i < position.length; i += 3) {
    position[i] = position[i]! * sx + xShift;
    position[i + 1] = position[i + 1]! * body;
    position[i + 2] = (position[i + 2]! - zMid) * body;
  }
  if (!helicopter) {
    // Body scale: the length scale, or less where the source spans less than the catalogue
    // type (an ATR 42 drawn as an ATR 72 keeps its fuselage section); the wings outside the
    // fuselage stretch to the catalogue span.
    const probe = section(slice(position, 0.2 * L), { ...priorAt(layout, 0.2 * L), ...anyHeight })!;
    const [, zMax] = extent(position, 2);
    const ratio = Math.min(1, halfSpan / zMax);
    const r = probe.width;
    const k = (halfSpan - r * ratio) / (zMax - r);
    for (let i = 0; i < position.length; i += 3) {
      position[i + 1] = position[i + 1]! * ratio;
      const z = position[i + 2]!;
      position[i + 2] =
        Math.abs(z) <= r ? z * ratio : Math.sign(z) * (r * ratio + (Math.abs(z) - r) * k);
    }
    body *= ratio;
    wing *= k;
  }
  // Sit the belly on the procedural body's, which the procedural landing gear reaches.
  const at = helicopter ? 0.05 * L : 0.2 * L;
  const prior = priorAt(layout, at);
  const nonSpin = (t: number) => !spinOf[t];
  const probe = section(slice(position, at, nonSpin), { ...prior, ...anyHeight })!;
  const lift = prior.y - prior.height - (probe.y - probe.height);
  for (let i = 1; i < position.length; i += 3) position[i] = position[i]! + lift;

  // Fuselage profile.
  const profile: Prepared['profile'] = [];
  for (let i = 0; i <= 40; i++) {
    const x = L * (-0.5 + i / 40);
    const p = priorAt(layout, x);
    const s = section(slice(position, x, nonSpin), p);
    profile.push(
      s ? [x, s.y, s.height, s.width] : [x, p.y, Math.max(0.05, p.height), Math.max(0.05, p.width)],
    );
  }
  // Behind the wing the fuselage only narrows: the fin and tailplane roots that the sections
  // pick up there are clipped off by keeping the crown, keel and sides from growing rearward.
  if (!helicopter)
    for (let i = 13; i >= 0; i--) {
      const [x, y, height, width] = profile[i]!;
      const [, ny, nh, nw] = profile[i + 1]!;
      const top = Math.min(y + height, ny + nh);
      const bottom = Math.max(y - height, ny - nh);
      const h = Math.max(0.05, (top - bottom) / 2);
      profile[i] = [x, Math.min(top, bottom + 2 * h) - h, h, Math.min(width, nw)];
    }
  // Along the cabin, a median over five stations drops the wing box, sponsons and fairings
  // that the sections catch.
  const raw = profile.map((row) => [...row]);
  for (let i = 16; i <= 36; i++)
    for (const k of [1, 2, 3])
      profile[i]![k] = raw
        .slice(i - 2, i + 3)
        .map((row) => row[k]!)
        .sort((a, b) => a - b)[2]!;
  const profileAt = (x: number) => {
    const f = Math.min(40, Math.max(0, (x / L + 0.5) * 40));
    const a = profile[Math.floor(f)]!,
      b = profile[Math.min(40, Math.floor(f) + 1)]!;
    const t = f - Math.floor(f);
    return {
      y: a[1] + (b[1] - a[1]) * t,
      height: a[2] + (b[2] - a[2]) * t,
      width: a[3] + (b[3] - a[3]) * t,
    };
  };

  // Classify triangles.
  const triangles = soup.group.length;
  const tipY = (() => {
    let min = Infinity;
    for (let i = 0; i < position.length / 3; i++)
      if (Math.abs(position[i * 3 + 2]!) > halfSpan * 0.94)
        min = Math.min(min, position[i * 3 + 1]!);
    return min;
  })();
  const part: string[] = [];
  const face = new Vector3(),
    e1 = new Vector3(),
    e2 = new Vector3();
  const keepPosition: number[] = [];
  // TASK-331: an airliner's cabin windows are placed afresh (`windowPanes`); the source's cabin
  // glass and black window decals between the doors become skin, which also closes openings
  // the glass filled.
  const cabin = cabinWindows[type.id] ? cabinSpan(type) : null;
  const spinTriangles = new Map<
    string,
    { kind: SpinKind; position: number[]; rotated: number[] }
  >();
  for (let t = 0; t < triangles; t++) {
    const o = t * 9;
    const cx = (position[o]! + position[o + 3]! + position[o + 6]!) / 3;
    const cy = (position[o + 1]! + position[o + 4]! + position[o + 7]!) / 3;
    const cz = (position[o + 2]! + position[o + 5]! + position[o + 8]!) / 3;
    // Wind each triangle with its stored normals outward.
    e1.set(
      position[o + 3]! - position[o]!,
      position[o + 4]! - position[o + 1]!,
      position[o + 5]! - position[o + 2]!,
    );
    e2.set(
      position[o + 6]! - position[o]!,
      position[o + 7]! - position[o + 1]!,
      position[o + 8]! - position[o + 2]!,
    );
    face.crossVectors(e1, e2);
    const stored = new Vector3(
      normal[o]! + normal[o + 3]! + normal[o + 6]!,
      normal[o + 1]! + normal[o + 4]! + normal[o + 7]!,
      normal[o + 2]! + normal[o + 5]! + normal[o + 8]!,
    );
    const flip = stored.lengthSq() > 0 && face.dot(stored) < 0;
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    const vertices = order.flatMap((k) => [
      position[o + k * 3]!,
      position[o + k * 3 + 1]!,
      position[o + k * 3 + 2]!,
    ]);
    face.normalize();
    if (flip) face.negate();
    const spin = spinOf[t];
    if (spin) {
      const key = spin === 'propeller' ? `${spin}${cz < 0 ? 0 : 1}` : spin;
      const list = spinTriangles.get(key) ?? { kind: spin, position: [], rotated: [] };
      list.position.push(...vertices);
      list.rotated.push(...order.flatMap((k) => [0, 1, 2].map((a) => rotated[o + k * 3 + a]!)));
      spinTriangles.set(key, list);
      continue;
    }
    const group = soup.groups[soup.group[t]!]!;
    const names = `${group.node} ${group.material}`;
    const s = profileAt(cx);
    const inBody =
      Math.abs(cz) <= s.width * 1.12 + 0.05 && Math.abs(cy - s.y) <= s.height * 1.15 + 0.05;
    const light = !group.color || luminance(group.color) > 0.55;
    const inCabin = cabin !== null && cx > cabin.from - 0.5 && cx < cabin.to;
    let name: string;
    if (
      inCabin &&
      (glassNames.test(names) ||
        (inBody &&
          group.color !== null &&
          luminance(group.color) < 0.05 &&
          Math.abs(cz) > s.width * 0.6 &&
          Math.abs(cy - s.y) < s.height * 0.8))
    )
      name = 'hull';
    else if (glassNames.test(names)) name = 'glass';
    // A helicopter's skids and steps, below the cabin floor: bare metal.
    else if (helicopter && cy < s.y - s.height * 1.05) name = 'c8c939a';
    else if (
      !helicopter &&
      cx < -0.12 * L &&
      cy > s.y + s.height * 0.85 &&
      Math.abs(cz) < Math.max(0.35 * s.width, 0.6)
    )
      name = light
        ? 'tail'
        : `c${hex(group.color!)
            .map((c) => c.toString(16).padStart(2, '0'))
            .join('')}`;
    else if (
      !helicopter &&
      Math.abs(cz) > halfSpan * 0.88 &&
      Math.abs(face.y) < 0.6 &&
      cy > tipY + 0.2
    )
      name = 'tail';
    else if (engineNames.test(names) && light) name = 'engine';
    else if (light || (!inBody && isGrey(group.color!)))
      name = inBody || helicopter ? 'hull' : 'wing';
    else {
      // Fixed colours, rounded to eighths so that similar materials share a primitive.
      const c = group.color!.map((x) => Math.round(x * 8) / 8);
      name = `c${hex(c)
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('')}`;
    }
    part.push(name);
    keepPosition.push(...vertices);
  }
  // Spinning parts keep their shape: scaled uniformly by the body scale about their hub, which
  // goes where the airframe's mapping puts it.
  const centre = (p: ArrayLike<number>) =>
    new Vector3(
      ...[0, 1, 2].map((a) => {
        const [lo, hi] = extent(p, a);
        return (lo + hi) / 2;
      }),
    );
  const spinners = [...spinTriangles.values()].map(
    ({ kind, position: mapped, rotated: source }) => {
      const hub = centre(mapped);
      const from = centre(source);
      const p = Float32Array.from(source);
      for (let i = 0; i < p.length; i += 3)
        v.fromArray(p, i).sub(from).multiplyScalar(body).add(hub).toArray(p, i);
      return { kind, hub, position: p };
    },
  );
  console.log(`  ${type.id}: spinners ${spinners.map((s) => s.kind).join(', ') || 'none'}`);
  return {
    type,
    position: Float32Array.from(keepPosition),
    part,
    spinners,
    profile: profile.map(
      (row) => row.map((x) => Math.round(x * 1000) / 1000) as Prepared['profile'][number],
    ),
    scale: { x: sx, body, wing },
  };
}

// ---- window panes -----------------------------------------------------------------------------

/** Door panels (LOD0) and, on an airliner, one row of cabin windows per deck as dark panes on
 * the model's skin at TASK-307's row heights, at the real size and pitch (`cabinWindows`),
 * clear of TASK-315's doors (LOD1: one band per row and side). A business jet keeps its
 * source's glass. */
function windowPanes(prepared: Prepared, lod: number, surface: Mesh) {
  const { type, profile } = prepared;
  const panes = cabinWindows[type.id];
  const helicopter = type.class === 'helicopter';
  const doors: number[] = [];
  if (helicopter) return { glass: [], doors, bands: new Map<string, number[]>() };
  const mesh = surface;
  const raycaster = new Raycaster();
  const L = type.lengthM;
  const decks = type.class === 'double_decker' ? [1.72, 1.05] : [1.28];
  const out: number[] = [];
  const profileAt = (x: number) => {
    const f = Math.min(40, Math.max(0, (x / L + 0.5) * 40));
    const row = profile[Math.round(f)]!;
    return { y: row[1], height: row[2], width: row[3] };
  };
  const hit = (x: number, angle: number, side: number) => {
    const s = profileAt(x);
    const centre = new Vector3(x, s.y, 0);
    const out = new Vector3(0, Math.cos(angle) * s.height, side * Math.sin(angle) * s.width);
    raycaster.set(centre.clone().addScaledVector(out, 1.6), out.clone().normalize().negate());
    raycaster.far = out.length() * 1.6;
    const [first] = raycaster.intersectObject(mesh);
    if (!first?.face) return null;
    const n = first.face.normal.clone();
    if (n.dot(out) < 0) n.negate();
    return { point: first.point, normal: n };
  };
  /** `p` moved onto the skin along `normal` (outward) and lifted `lift` metres off it. */
  const onSkin = (p: Vector3, normal: Vector3, lift: number) => {
    raycaster.set(p.clone().addScaledVector(normal, 0.6), normal.clone().negate());
    raycaster.far = 1.2;
    const [first] = raycaster.intersectObject(mesh);
    if (!first?.face) return p.clone().addScaledVector(normal, lift);
    const n = first.face.normal.clone();
    if (n.dot(normal) < 0) n.negate();
    return first.point.clone().addScaledVector(n, lift);
  };
  const layout = aircraftLayout(type);
  // Door panels in TASK-315's places and colour, on both sides of an airliner and on the port
  // side of a turboprop or business jet, cast onto the model's side; near level only.
  const twoSided = type.class !== 'propeller' && type.class !== 'private';
  for (const door of lod === 0 ? layout.doors : []) {
    const at = profileAt(door.x);
    const sill = door.upper ? door.sillM : cabinFloor(type, at, false);
    for (const side of twoSided ? [-1, 1] : [-1]) {
      const grid: Vector3[][] = [];
      for (let v = 0; v <= 4; v++) {
        const row: Vector3[] = [];
        for (let u = 0; u <= 2; u++) {
          const x = door.x + (u / 2 - 0.5) * door.widthM;
          const y = sill + (v / 4) * door.heightM;
          const reach = at.width * 1.6 + 0.5;
          raycaster.set(new Vector3(x, y, side * reach), new Vector3(0, 0, -side));
          raycaster.far = reach;
          const [first] = raycaster.intersectObject(mesh);
          if (!first?.face) break;
          const n = first.face.normal.clone();
          if (n.z * side < 0) n.negate();
          row.push(first.point.clone().addScaledVector(n, 0.025));
        }
        if (row.length < 3) break;
        grid.push(row);
      }
      if (grid.length < 5) continue;
      for (let v = 0; v < 4; v++)
        for (let u = 0; u < 2; u++) {
          const [a, b, c, d] = [
            grid[v]![u]!,
            grid[v]![u + 1]!,
            grid[v + 1]![u + 1]!,
            grid[v + 1]![u]!,
          ];
          for (const p of side > 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d])
            doors.push(p.x, p.y, p.z);
        }
    }
  }
  // Thin livery bands (TASK-315's cheatline and pinstripes, fractions of the length and section
  // angles from the crown) as strips cast onto the skin: a colour per facet cannot draw a band
  // narrower than the model's facets. The flight's livery picks the strips it uses.
  const bands = new Map<string, number[]>();
  // TASK-331: an 80th of the length or half a metre at the near level, leaving a widebody's
  // budget room for its cabin panes.
  const step = lod === 0 ? Math.max(0.5, L / 80) : 2;
  for (const [name, x0, x1, a0, a1] of liveryStrips) {
    const strip: number[] = [];
    for (const side of [-1, 1]) {
      let previous: Vector3[] | null = null;
      for (let x = x0 * L; x <= x1 * L + 1e-6; x += step) {
        const top = hit(x, a0, side),
          bottom = hit(x, a1, side);
        const pair =
          top && bottom && top.point.distanceTo(bottom.point) < 1
            ? [top, bottom].map((h) => h.point.clone().addScaledVector(h.normal, 0.03))
            : null;
        if (previous && pair && previous[0]!.distanceTo(pair[0]!) < step * 1.6) {
          const [a, d] = previous as [Vector3, Vector3];
          const [b, c] = pair as [Vector3, Vector3];
          const centre = new Vector3(x, profileAt(x).y, 0);
          for (const [p, q, r] of [
            [a, b, c],
            [a, c, d],
          ] as const) {
            const outward = p.clone().sub(centre).setX(0);
            const n = q.clone().sub(p).cross(r.clone().sub(p));
            for (const v of n.dot(outward) < 0 ? [p, r, q] : [p, q, r]) strip.push(v.x, v.y, v.z);
          }
        }
        previous = pair;
      }
    }
    if (strip.length) bands.set(name, strip);
  }
  if (!panes) return { glass: [], doors, bands };
  const { width, height, pitch } = panes;
  // The skin under a pane's middle at the row's height, cast across from beside the fuselage:
  // the skin there, or where an opening of the source's lies there, the curve through the skin
  // just above and below it.
  const across = (x: number, y: number, side: number) => {
    const reach = profileAt(x).width + 1;
    raycaster.set(new Vector3(x, y, side * reach), new Vector3(0, 0, -side));
    raycaster.far = reach;
    const [first] = raycaster.intersectObject(mesh);
    if (!first?.face || Math.abs(first.point.z) < profileAt(x).width * 0.6) return null;
    const n = first.face.normal.clone();
    if (n.z * side < 0) n.negate();
    return { point: first.point, normal: n };
  };
  const paneHit = (x: number, y: number, side: number) => {
    const s = profileAt(x);
    const a = across(x, y + height, side),
      b = across(x, y - height, side);
    if (!a || !b) return null;
    const point = a.point.clone().add(b.point).multiplyScalar(0.5);
    const normal = a.normal.clone().add(b.normal).normalize();
    const centre = across(x, y, side);
    const sagitta = (height * height) / (2 * Math.min(s.width, s.height));
    const out = Math.max(sagitta, centre ? centre.point.clone().sub(point).dot(normal) : 0);
    // None where the skin turns away towards the nose or crown: a flat pane would sink into it.
    if (Math.abs(normal.z) < 0.75) return null;
    return { point: point.addScaledVector(normal, out), normal };
  };
  const cabin = cabinSpan(type);
  for (const [deck, angle] of decks.entries()) {
    const upper = type.class === 'double_decker' && deck === 1;
    // The 747's upper deck is the hump over the forward fuselage.
    const from = type.id === 'B748' && upper ? 0.235 * L : cabin.from;
    const to = cabin.to;
    // A straight row along the level cabin floor: the deck angle's height on the sections
    // along the row, their median.
    const heights: number[] = [];
    for (let x = from; x <= to; x += 1) {
      const s = profileAt(x);
      heights.push(s.y + Math.cos(angle) * s.height);
    }
    const rowY = heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)]!;
    for (const side of [-1, 1]) {
      if (lod === 1) {
        // One band per row and side.
        const points: { point: Vector3; normal: Vector3 }[] = [];
        for (let j = 0; j <= 12; j++) {
          const h = paneHit(from + 1 + ((to - from - 2) * j) / 12, rowY, side);
          if (h) points.push(h);
        }
        for (let j = 1; j < points.length; j++) {
          const a = points[j - 1]!,
            b = points[j]!;
          const corner = (p: { point: Vector3; normal: Vector3 }, up: number) => {
            const tangent = new Vector3(1, 0, 0).cross(p.normal).normalize().multiplyScalar(side);
            return onSkin(
              p.point.clone().addScaledVector(tangent, (up * height) / 2),
              p.normal,
              0.04,
            );
          };
          const quad = [corner(a, -1), corner(b, -1), corner(b, 1), corner(a, 1)];
          for (const [i, k, m] of side > 0
            ? [
                [0, 1, 2],
                [0, 2, 3],
              ]
            : [
                [0, 2, 1],
                [0, 3, 2],
              ])
            out.push(...quad[i!]!.toArray(), ...quad[k!]!.toArray(), ...quad[m!]!.toArray());
        }
        continue;
      }
      // One pane per frame from the front door aft, none over a door of the same deck.
      for (let x = to - pitch; x > from + pitch / 2; x -= pitch) {
        if (
          layout.doors.some(
            (d) => d.upper === upper && Math.abs(d.x - x) < d.widthM / 2 + width / 2 + 0.12,
          )
        )
          continue;
        const h = paneHit(x, rowY, side);
        if (!h) continue;
        const { point, normal } = h;
        const along = new Vector3(1, 0, 0);
        const up = along.clone().cross(normal).normalize().multiplyScalar(side);
        // A rounded rectangle (an octagon with cut corners), six triangles, flat and just clear
        // of the skin.
        const ring = [
          [-0.5, -0.32],
          [-0.32, -0.5],
          [0.32, -0.5],
          [0.5, -0.32],
          [0.5, 0.32],
          [0.32, 0.5],
          [-0.32, 0.5],
          [-0.5, 0.32],
        ].map(([u, w]) =>
          point
            .clone()
            .addScaledVector(normal, 0.025)
            .addScaledVector(along, u! * width)
            .addScaledVector(up, w! * height),
        );
        for (let k = 1; k < 7; k++) {
          const tri =
            side > 0 ? [ring[0]!, ring[k]!, ring[k + 1]!] : [ring[0]!, ring[k + 1]!, ring[k]!];
          for (const p of tri) out.push(p.x, p.y, p.z);
        }
      }
    }
  }
  return { glass: out, doors, bands };
}

// ---- simplification and export ----------------------------------------------------------------

function simplify(position: Float32Array, part: string[], target: number) {
  const names = [...new Set(part)];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  const partIds = new Float32Array(position.length / 3);
  part.forEach((name, t) => partIds.fill(names.indexOf(name), t * 3, t * 3 + 3));
  geometry.setAttribute('part', new Float32BufferAttribute(partIds, 1));
  const welded = mergeVertices(geometry, 1e-4);
  const index = Uint32Array.from(welded.index!.array);
  const tight = Float32Array.from(welded.getAttribute('position').array);
  let result: Uint32Array = index;
  // The outermost vertices (nose, tail, tips) stay put, so the extents keep the catalogue size.
  const extremes = new Uint8Array(tight.length / 3);
  for (const axis of [0, 1, 2]) {
    const [lo, hi] = extent(tight, axis);
    for (let i = 0; i < extremes.length; i++) {
      const c = tight[i * 3 + axis]!;
      if (c < lo + 0.02 || c > hi - 0.02) extremes[i] = 1;
    }
  }
  if (index.length / 3 > target) {
    // TASK-331: the smallest error bound (a share of the model's extent) that reaches the
    // budget: at 2% an A380's crown sank 0.9 m once its cabin panes took their share.
    for (const error of [0.01, 0.015, 0.02]) {
      [result] = MeshoptSimplifier.simplifyWithAttributes(
        index,
        tight,
        3,
        new Float32Array(0),
        0,
        [],
        extremes,
        target * 3,
        error,
        ['Prune'],
      ) as [Uint32Array, number];
      if (result.length / 3 <= target) break;
    }
    // Where open shells and seams stop the edge collapses short of the budget, the sloppy
    // simplifier (vertex clustering) takes over; it undershoots, so its target is raised until
    // the result comes within 80% of the budget.
    for (let ask = target; result.length / 3 > target * 1.15 || result.length / 3 < target * 0.8;) {
      [result] = MeshoptSimplifier.simplifySloppy(index, tight, 3, extremes, ask * 3, 1) as [
        Uint32Array,
        number,
      ];
      if (result.length / 3 >= target * 0.8 || ask * 3 >= index.length) break;
      ask = Math.min(index.length / 3, Math.round(ask * 1.25));
    }
  }
  welded.setIndex(Array.from(result));
  const flat = toCreasedNormals(welded, Math.PI / 5);
  const partOf = flat.getAttribute('part');
  const out = new Map<string, BufferGeometry>();
  for (const [id, name] of names.entries()) {
    const keep: number[] = [];
    for (let t = 0; t < partOf.count / 3; t++) if (partOf.getX(t * 3) === id) keep.push(t);
    if (!keep.length) continue;
    const g = new BufferGeometry();
    for (const attribute of ['position', 'normal']) {
      const source = flat.getAttribute(attribute);
      const values = new Float32Array(keep.length * 9);
      keep.forEach((t, i) => {
        for (let k = 0; k < 9; k++) values[i * 9 + k] = source.array[t * 9 + k]!;
      });
      g.setAttribute(attribute, new Float32BufferAttribute(values, 3));
    }
    out.set(name, mergeVertices(g, 1e-4));
  }
  return out;
}

function partColor(name: string): [number, number, number] {
  if (name === 'glass') return [...glass];
  if (name === 'wing') return [...wingGrey];
  if (name.startsWith('c'))
    return [1, 3, 5].map((i) => parseInt(name.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
  return [0.94, 0.945, 0.953];
}

class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}

/** Flat-shaded geometry for the window panes and door panels added after simplification. */
function detail(position: number[]) {
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(position, 3),
  );
  return mergeVertices(toCreasedNormals(geometry, Math.PI / 5), 1e-4);
}

async function exportLod(prepared: Prepared, lod: number) {
  // Panes and door panels are cast onto the simplified surface; the budget leaves room for
  // them (counted on a first pass) and for the spinning parts.
  const sourceTriangles = prepared.part.length;
  const spinTarget = lod === 0 ? 600 : 80;
  const pass = (reserve: number) => {
    const parts = simplify(
      prepared.position,
      prepared.part,
      budgets[lod]! - reserve - spinTarget * prepared.spinners.length,
    );
    const surface = new Mesh(
      mergeGeometries([...parts.values()].map((g) => g.clone().deleteAttribute('normal'))),
      new MeshStandardMaterial({ side: DoubleSide }),
    );
    return { parts, ...windowPanes(prepared, lod, surface) };
  };
  const first = pass(0);
  const reserve =
    (first.glass.length +
      first.doors.length +
      [...first.bands.values()].reduce((sum, b) => sum + b.length, 0)) /
    9;
  const {
    parts,
    glass: panes,
    doors,
    bands,
  } = prepared.part.length + reserve > budgets[lod]! - spinTarget * prepared.spinners.length
    ? pass(reserve)
    : first;
  for (const [name, position] of [['glass', panes], [doorPart, doors], ...bands] as [
    string,
    number[],
  ][]) {
    if (!position.length) continue;
    const geometry = detail(position);
    const existing = parts.get(name);
    parts.set(name, existing ? mergeGeometries([existing, geometry])! : geometry);
  }
  const scene = new Scene();
  const root = new Group();
  root.name = prepared.type.id;
  scene.add(root);
  let triangles = 0;
  for (const [name, geometry] of [...parts].sort(([a], [b]) => a.localeCompare(b))) {
    const color = partColor(name);
    const material = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
    material.color.setRGB(...color).convertSRGBToLinear();
    material.name = name;
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    triangles += geometry.index!.count / 3;
    root.add(mesh);
  }
  for (const [i, spinner] of prepared.spinners.entries()) {
    const target = spinTarget;
    const local = Float32Array.from(spinner.position);
    const mount = new Group();
    mount.name = `mount-${spinner.kind}-${i}`;
    mount.position.copy(spinner.hub);
    // Spinning parts turn about their local +y: propellers face forward, a tail rotor sideways.
    if (spinner.kind === 'propeller') mount.rotation.z = -Math.PI / 2;
    if (spinner.kind === 'tail-rotor') mount.rotation.x = Math.PI / 2;
    mount.updateMatrix();
    const inverse = mount.matrix.clone().invert();
    const v = new Vector3();
    for (let k = 0; k < local.length; k += 3)
      v.fromArray(local, k).applyMatrix4(inverse).toArray(local, k);
    const geometry = simplify(
      local,
      Array.from({ length: local.length / 9 }, () => 'spinner'),
      target,
    ).get('spinner')!;
    const material = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
    material.color.setRGB(0.302, 0.349, 0.392).convertSRGBToLinear();
    material.name = 'spinner';
    const mesh = new Mesh(geometry, material);
    mesh.name = spinner.kind;
    mount.add(mesh);
    root.add(mount);
    triangles += geometry.index!.count / 3;
  }
  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  const surface = mergeGeometries(
    [...parts.values()].map((g) => g.toNonIndexed().deleteAttribute('normal')),
  )!.getAttribute('position').array as Float32Array;
  return { glb: new Uint8Array(glb), triangles, sourceTriangles, surface };
}

// ---- light mounts and doors -------------------------------------------------------------------

/** Light mounts on the near level's surface (`position`, triangles). */
function mounts(prepared: Prepared, position: Float32Array) {
  const { type, profile } = prepared;
  const L = type.lengthM;
  const layout = aircraftLayout(type);
  const helicopter = type.class === 'helicopter';
  const round = (p: number[]) =>
    p.map((x) => Math.round(x * 100) / 100) as [number, number, number];
  const at = (x: number) => profile[Math.round(Math.min(40, Math.max(0, (x / L + 0.5) * 40)))]!;
  const surface = new Mesh(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(position, 3)),
    new MeshStandardMaterial({ side: DoubleSide }),
  );
  const cast = (from: Vector3, direction: Vector3) =>
    new Raycaster(from, direction).intersectObject(surface)[0]?.point ?? null;
  // Beacon on the crown above the wing box.
  const crownTop = cast(new Vector3(0, 50, 0), new Vector3(0, -1, 0))!;
  // Landing lights in the wing roots' leading edges, a tenth of the span out (TASK-307).
  const rootZ = type.spanM * 0.105;
  const leading = (side: number) => {
    const wingY = layout.wing[0] ? layout.wing[0].y : at(0)[1];
    return cast(new Vector3(L, wingY, side * rootZ), new Vector3(-1, 0, 0));
  };
  // Wing tips (helicopters: the stabiliser tips): the outermost few centimetres.
  const tipFilter = (i: number) => !helicopter || position[i * 3]! < -0.25 * L;
  const [, zMax] = extent(position, 2, tipFilter);
  const tip = (i: number) => tipFilter(i) && position[i * 3 + 2]! > zMax - 0.25;
  const [tx0, tx1] = extent(position, 0, tip);
  const [ty0, ty1] = extent(position, 1, tip);
  const chord = tx1 - tx0;
  const tipY = (ty0 + ty1) / 2;
  // The tail cone's end: the rearmost point near the plane of symmetry below the crown of the
  // rear fuselage (the fin rises above it).
  const crown = at(-0.33 * L);
  const tail = (i: number) =>
    Math.abs(position[i * 3 + 2]!) < 0.4 && position[i * 3 + 1]! < crown[1] + crown[2];
  const navZ = Math.round(zMax * 100) / 100;
  let tailIndex = -1;
  for (let i = 0; i < position.length / 3; i++)
    if (tail(i) && (tailIndex < 0 || position[i * 3]! < position[tailIndex * 3]!)) tailIndex = i;
  const tailX = position[tailIndex * 3]!,
    tailY = position[tailIndex * 3 + 1]!;
  const nose = at(0.34 * L);
  const { noseX } = fixedWingGearStations(L);
  const root = layout.wing[0];
  return {
    navLeft: round([tx1 - chord * 0.14, tipY, -zMax]).map((c, i) => (i === 2 ? -navZ : c)),
    navRight: round([tx1 - chord * 0.14, tipY, zMax]).map((c, i) => (i === 2 ? navZ : c)),
    navTail: round([tailX, tailY, 0]),
    beacon: round([0, crownTop.y + 0.08, 0]),
    strobes: [round([tx1 - chord * 0.68, tipY, -navZ]), round([tx1 - chord * 0.68, tipY, navZ])],
    landing: root
      ? [-1, 1].map((side) => {
          const edge = leading(side);
          return round(
            edge ? [edge.x - 0.1, edge.y, edge.z] : [root.x - L * 0.032, root.y, side * rootZ],
          );
        })
      : [round([L * 0.29, at(0.29 * L)[1] - at(0.29 * L)[2] - 0.05, 0])],
    taxi: helicopter
      ? round([L * 0.24, at(0.24 * L)[1] - at(0.24 * L)[2] - 0.05, 0])
      : round([noseX + 0.1, nose[1] - nose[2] * 0.6, 0]),
  };
}

// ---- main -------------------------------------------------------------------------------------

// Run by path only: the tests read `cabinWindows` from this module.
if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: bench/aircraft-models.ts <fr24-3d-models/models>');
  const outDir = 'fixtures/aircraft';
  mkdirSync(outDir, { recursive: true });
  await MeshoptSimplifier.ready;
  const manifest: Record<string, unknown> = {};
  for (const source of sources) {
    const prepared = prepare(source, dir);
    const lods = [];
    let surface: Float32Array = new Float32Array(0);
    for (const lod of [0, 1]) {
      const { glb, triangles, sourceTriangles, ...rest } = await exportLod(prepared, lod);
      if (lod === 0) surface = rest.surface;
      const file = `${source.type.toLowerCase()}-${lod}.glb`;
      writeFileSync(join(outDir, file), glb);
      lods.push({ file, triangles, bytes: glb.byteLength });
      if (lod === 0)
        console.log(`${source.type} from ${source.file}: ${sourceTriangles} source triangles`);
    }
    manifest[source.type] = {
      source: source.file,
      lods,
      scale: Object.fromEntries(
        Object.entries(prepared.scale).map(([k, x]) => [k, Math.round(x * 1e4) / 1e4]),
      ),
      profile: prepared.profile,
      lights: mounts(prepared, surface),
    };
    console.log(
      `  LOD0 ${lods[0]!.triangles} tris ${lods[0]!.bytes} B, LOD1 ${lods[1]!.triangles} tris ${lods[1]!.bytes} B`,
    );
  }
  writeFileSync(join(outDir, 'models.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = Object.values(manifest).reduce<number>(
    (sum, m) => sum + (m as { lods: { bytes: number }[] }).lods.reduce((s, l) => s + l.bytes, 0),
    0,
  );
  console.log(`total ${total} B (${statSync(join(outDir, 'models.json')).size} B manifest)`);
}
