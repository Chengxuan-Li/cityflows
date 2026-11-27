import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import models from '../../fixtures/aircraft/models.json';
import { hull, type AircraftLivery, type LiveryStyle } from '../render/aircraft-livery';
import { aircraftTypes } from '../schema/aircraft';
import { buildAircraftGear, type AircraftLightMounts } from './aircraft-mesh';

// TASK-318: real aircraft models, Flightradar24's fr24-3d-models (GPL-2.0, from the FlightGear
// FGMEMBERS hangar; NOTICE), prepared by `bench/aircraft-models.ts` into two levels of detail per
// catalogue type: LOD0 (about 15,000 triangles) for close views and LOD1 (about 1,500) for the
// middle distance. TASK-307's procedural mesh stays the far level and the fallback for types
// without a model. Each file is fetched only when an aircraft of its type first needs that level.
// The models carry flat part colours; the fuselage, fin and engines take the flight's livery here.

export type ModelLodIndex = 0 | 1;
export type SpinKind = 'propeller' | 'rotor' | 'tail-rotor';

export interface ModelInfo {
  source: string;
  lods: { file: string; triangles: number; bytes: number }[];
  scale: { x: number; body: number; wing: number };
  /** Fuselage sections along the length: [x, centre height, half height, half width]. */
  profile: [number, number, number, number][];
  lights: AircraftLightMounts;
}

const manifest = models as unknown as Record<string, ModelInfo>;

/** The prepared model of a catalogue type, or null where TASK-307's procedural mesh stands in. */
export const modelInfo = (typeId: string): ModelInfo | null => manifest[typeId] ?? null;

const urls = import.meta.glob<string>('../../fixtures/aircraft/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
});

async function fetchModelFile(file: string) {
  const url = urls[`../../fixtures/aircraft/${file}`];
  if (!url) throw new Error(`no aircraft model file ${file}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`aircraft model ${file}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

interface Part {
  name: string;
  geometry: BufferGeometry;
  color: Color;
}

interface Spinner {
  kind: SpinKind;
  /** The mount: the hub, turned so that the part spins about its local +y. */
  matrix: Matrix4;
  geometry: BufferGeometry;
  color: Color;
}

export interface ModelLod {
  parts: Part[];
  spinners: Spinner[];
  triangles: number;
}

export async function parseModelLod(data: ArrayBuffer): Promise<ModelLod> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const root = gltf.scene.children[0]!;
  const parts: Part[] = [];
  const spinners: Spinner[] = [];
  let triangles = 0;
  const count = (geometry: BufferGeometry) =>
    (geometry.index ?? geometry.getAttribute('position')).count / 3;
  for (const child of root.children) {
    if (child instanceof Mesh) {
      const geometry = child.geometry as BufferGeometry;
      parts.push({
        name: child.name,
        geometry,
        color: (child.material as MeshStandardMaterial).color.clone(),
      });
      triangles += count(geometry);
    } else {
      const blade = child.children[0] as Mesh<BufferGeometry, MeshStandardMaterial>;
      child.updateMatrix();
      spinners.push({
        // `mount-<kind>-<n>`: the loader suffixes repeated mesh names, so the mount names it.
        kind: child.name.replace(/^mount-|-\d+$/g, '') as SpinKind,
        matrix: child.matrix.clone(),
        geometry: blade.geometry,
        color: blade.material.color.clone(),
      });
      triangles += count(blade.geometry);
    }
  }
  return { parts, spinners, triangles };
}

/** TASK-359: the livery styles in the order of a body vertex's paint digits (`modelBody`). */
export const liveryStyles: readonly LiveryStyle[] = [
  'tail',
  'cheatline',
  'belly',
  'tailcone',
  'crown',
];

/** How a body vertex is painted in one style: its own colour, the livery's tail, trim, engine or
 * belly colour (the hull where the scheme has no belly), or not at all (a band the style or a
 * scheme without trim does not have). */
export const paintSlot = { own: 0, tail: 1, trim: 2, engines: 3, belly: 4, none: 5 } as const;
type PaintSlot = (typeof paintSlot)[keyof typeof paintSlot];

/** A fuselage triangle's paint in a style from its place along the length (a fraction, positive
 * forward) and its angle around the fuselage from the crown (0) to the keel (pi), after
 * TASK-315's procedural bands. The thin bands are strips of their own (`bandSlot`). */
export function liveryRegion(style: LiveryStyle, along: number, angle: number): PaintSlot {
  const inside = (from: number, to: number) => along >= from && along <= to;
  if (style === 'belly' && inside(-0.45, 0.47) && angle > 1.8) return paintSlot.tail;
  if (style === 'tailcone' && along < -0.27 && angle < 1.45) return paintSlot.tail;
  if (style === 'crown' && inside(-0.36, 0.395) && angle < 1.02) return paintSlot.tail;
  // The light belly lies under the scheme's own bands.
  return inside(-0.42, 0.43) && angle > 2.02 ? paintSlot.belly : paintSlot.own;
}

/** A thin band's paint in a style; `none` where the style has no such band. */
export function bandSlot(style: LiveryStyle, band: string): PaintSlot {
  switch (band) {
    case 'band-cheatline':
      return style === 'cheatline' ? paintSlot.tail : paintSlot.none;
    case 'band-cheatline-trim':
      return style === 'cheatline' ? paintSlot.trim : paintSlot.none;
    case 'band-belly-trim':
      return style === 'belly' ? paintSlot.trim : paintSlot.none;
    case 'band-tailcone-trim':
      return style === 'tailcone' ? paintSlot.trim : paintSlot.none;
  }
  throw new Error(`unknown livery band ${band}`);
}

/** The paint digit of `style` in a body vertex's `liveryCode`. */
export const paintOf = (code: number, style: LiveryStyle) =>
  Math.floor(code / 6 ** liveryStyles.indexOf(style)) % 6;

/** TASK-359: the per-aircraft values `liveryMaterial` paints with: the style's digit and whether
 * the scheme has trim, then the tail, trim, engine and belly colours (linear RGB). */
export function liveryValues(livery: AircraftLivery) {
  const rgb = (hex: number) => new Color(hex).toArray();
  return {
    liveryScheme: [liveryStyles.indexOf(livery.style), livery.trim === null ? 0 : 1],
    liveryTail: rgb(livery.tail),
    liveryTrim: rgb(livery.trim ?? hull),
    liveryEngines: rgb(livery.engines),
    liveryBelly: rgb(livery.belly ?? hull),
  };
}

/** The GLSL of `liveryMaterial`: a vertex's paint slot from its digits and its aircraft's scheme. */
const liverySlotGlsl = `
  attribute float liveryCode;
  attribute vec2 liveryScheme;
  int liverySlot() {
    int code = int(liveryCode + 0.5);
    for (int i = 0; i < int(liveryScheme.x + 0.5); i++) code /= 6;
    int slot = code - (code / 6) * 6;
    return slot == ${paintSlot.trim} && liveryScheme.y < 0.5 ? ${paintSlot.none} : slot;
  }`;
/** Moves an unpainted vertex outside the clip volume, so its triangle is not drawn. */
const liveryHideGlsl = `#include <project_vertex>
  if (liverySlot() == ${paintSlot.none}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`;

/** TASK-359: instanced real-model bodies of one type and level, each aircraft in its livery
 * (`liveryValues`, per instance); the same paint as one merged geometry per livery. */
export function liveryMaterial() {
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  material.customProgramCacheKey = () => 'aircraft-livery';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${liverySlotGlsl}
        attribute vec3 liveryTail;
        attribute vec3 liveryTrim;
        attribute vec3 liveryEngines;
        attribute vec3 liveryBelly;`,
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
        int paint = liverySlot();
        vColor.rgb *= paint == ${paintSlot.tail} ? liveryTail : paint == ${paintSlot.trim} ? liveryTrim
          : paint == ${paintSlot.engines} ? liveryEngines : paint == ${paintSlot.belly} ? liveryBelly : color;`,
      )
      .replace('#include <project_vertex>', liveryHideGlsl);
  };
  return material;
}

/** The shadow-map material of `liveryMaterial`'s batches: unpainted bands cast no shadow. */
export function liveryDepthMaterial() {
  const material = new MeshDepthMaterial();
  material.customProgramCacheKey = () => 'aircraft-livery-depth';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${liverySlotGlsl}`)
      .replace('#include <project_vertex>', liveryHideGlsl);
  };
  return material;
}

/** Adds the paint test to an outline drawn over a livery body (`liveryMaterial`). */
export function liveryOutline(vertexShader: string) {
  return vertexShader
    .replace('void main() {', `${liverySlotGlsl}\nvoid main() {`)
    .replace(
      /}\s*$/,
      `  if (liverySlot() == ${paintSlot.none}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n}`,
    );
}

export interface AircraftModel {
  typeId: string;
  info: ModelInfo;
  lengthM: number;
  lods: [ModelLod | null, ModelLod | null];
  /** Merged, painted body geometry per level, shared by every aircraft of the type. */
  bodies: Map<ModelLodIndex, BufferGeometry>;
  /** TASK-331: the type's landing gear per level, shared by every aircraft of the type. */
  gear: [ModelGear | null, ModelGear | null];
}

export interface ModelGear {
  main: BufferGeometry;
  nose: BufferGeometry;
  wheels: number;
  /** Each tyre's sides, and the gear's triangles. */
  sides: number;
  triangles: number;
}

const probe = new MeshBasicMaterial({ side: DoubleSide });

/** TASK-331: the type's landing gear for a level, built once (`buildAircraftGear`) with each
 * leg reaching up to the level's own underside, found by casting up from the ground. */
export function modelGear(model: AircraftModel, lod: ModelLodIndex) {
  const cached = model.gear[lod];
  if (cached) return cached;
  const type = aircraftTypes.find((t) => t.id === model.typeId)!;
  const meshes = model.lods[lod]!.parts.map((part) => new Mesh(part.geometry, probe));
  for (const mesh of meshes) mesh.updateMatrixWorld();
  const raycaster = new Raycaster();
  const up = new Vector3(0, 1, 0);
  const { profile } = model.info;
  const attachY = (x: number, z: number) => {
    raycaster.set(new Vector3(x, 0.05, z), up);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) return hit.point.y;
    // Nothing overhead: the fuselage's belly there.
    const f = Math.min(
      profile.length - 1,
      Math.max(0, (x / model.lengthM + 0.5) * (profile.length - 1)),
    );
    const [, y, height] = profile[Math.round(f)]!;
    return y - height;
  };
  const gear = buildAircraftGear(type, attachY, lod === 0 ? 'near' : 'middle');
  model.gear[lod] = gear;
  return gear;
}

/** TASK-359: one geometry per level, every part merged in order, each triangle with its own
 * colour and its paint in each livery style (`liveryCode`: a base-6 digit per style,
 * `liveryStyles`). Every livery band is included; a style without it leaves it unpainted. */
export function modelBody(model: AircraftModel, lod: ModelLodIndex) {
  let body = model.bodies.get(lod);
  if (body) return body;
  const { profile } = model.info;
  const length = model.lengthM;
  const color = new Color();
  const geometries = model.lods[lod]!.parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    const codes = new Float32Array(position.count);
    for (let t = 0; t < position.count; t += 3) {
      let slot: (style: LiveryStyle) => PaintSlot = () => paintSlot.own;
      if (part.name === 'hull') {
        const x = (position.getX(t) + position.getX(t + 1) + position.getX(t + 2)) / 3;
        const y = (position.getY(t) + position.getY(t + 1) + position.getY(t + 2)) / 3;
        const z = (position.getZ(t) + position.getZ(t + 1) + position.getZ(t + 2)) / 3;
        const f = Math.min(
          profile.length - 1,
          Math.max(0, (x / length + 0.5) * (profile.length - 1)),
        );
        const [, cy, height, width] = profile[Math.round(f)]!;
        const angle = Math.atan2(Math.abs(z) / width, (y - cy) / height);
        slot = (style) => liveryRegion(style, x / length, angle);
        color.setHex(hull);
      } else if (part.name.startsWith('band-')) slot = (style) => bandSlot(style, part.name);
      else if (part.name === 'tail') slot = () => paintSlot.tail;
      else if (part.name === 'engine') slot = () => paintSlot.engines;
      else color.copy(part.color);
      const code = liveryStyles.reduce((sum, style, i) => sum + slot(style) * 6 ** i, 0);
      for (let k = 0; k < 3; k++) {
        color.toArray(colors, (t + k) * 3);
        codes[t + k] = code;
      }
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('liveryCode', new Float32BufferAttribute(codes, 1));
    return geometry;
  });
  body = mergeGeometries(geometries)!;
  for (const geometry of geometries) geometry.dispose();
  body.computeBoundingSphere();
  model.bodies.set(lod, body);
  return body;
}

/** A level of one aircraft: its body and outline sharing the type's geometry, and spinners. */
export function modelLodObject(
  model: AircraftModel,
  lod: ModelLodIndex,
  material: Material,
  outline: Material,
) {
  const group = new Group();
  group.name = `model-lod${lod}`;
  group.matrixAutoUpdate = false;
  const geometry = modelBody(model, lod);
  const body = new Mesh(geometry, material);
  const contour = new Mesh(geometry, outline);
  contour.userData.outline = true;
  for (const mesh of [body, contour]) {
    mesh.userData.shared = true;
    mesh.matrixAutoUpdate = false;
  }
  group.add(body, contour);
  const spinners: Object3D[] = [];
  for (const spinner of model.lods[lod]!.spinners) {
    const mount = new Group();
    mount.matrixAutoUpdate = false;
    mount.matrix.copy(spinner.matrix);
    const blades = new Mesh(spinner.geometry, spinnerMaterial(spinner.color));
    blades.name = spinner.kind;
    blades.userData.shared = true;
    mount.add(blades);
    group.add(mount);
    spinners.push(blades);
  }
  return { group, body, contour, spinners };
}

const spinnerMaterials = new Map<number, MeshLambertMaterial>();
function spinnerMaterial(color: Color) {
  const key = color.getHex();
  let material = spinnerMaterials.get(key);
  if (!material) spinnerMaterials.set(key, (material = new MeshLambertMaterial({ color })));
  return material;
}

/** On-screen size, in pixels across the aircraft's length and span, at which a nearer level
 * takes over (`enter`) and gives way again (`leave`); the gap keeps a level from flickering. */
export const lodPixels = [
  { enter: 260, leave: 210 },
  { enter: 8, leave: 6 },
] as const;

/** The level to draw: 0 near, 1 middle, 2 far (the procedural mesh). */
export function selectLod(current: number, px: number) {
  const near = (i: 0 | 1) => px >= (current <= i ? lodPixels[i].leave : lodPixels[i].enter);
  return near(0) ? 0 : near(1) ? 1 : 2;
}

/** Fetches and parses model files on first use, one level at a time, and keeps them. */
export class AircraftModels {
  private readonly models = new Map<string, AircraftModel>();
  private readonly pending = new Map<string, Promise<AircraftModel>>();
  /** Files loaded, their bytes and the wall time from request to parsed. */
  readonly loads: { file: string; bytes: number; ms: number }[] = [];

  constructor(private readonly read: (file: string) => Promise<ArrayBuffer> = fetchModelFile) {}

  /** The model with its loaded levels, or null before its first level has loaded. */
  get(typeId: string) {
    return this.models.get(typeId) ?? null;
  }

  /** Starts loading a level unless it is loaded or loading; null for a type without a model. */
  load(typeId: string, lengthM: number, lod: ModelLodIndex): Promise<AircraftModel> | null {
    const info = modelInfo(typeId);
    if (!info) return null;
    const model = this.models.get(typeId);
    if (model?.lods[lod]) return Promise.resolve(model);
    const key = `${typeId}:${lod}`;
    let pending = this.pending.get(key);
    if (!pending) {
      const file = info.lods[lod]!.file;
      const start = performance.now();
      pending = this.read(file).then(async (data) => {
        const parsed = await parseModelLod(data);
        const entry = this.models.get(typeId) ?? {
          typeId,
          info,
          lengthM,
          lods: [null, null],
          bodies: new Map(),
          gear: [null, null],
        };
        entry.lods[lod] = parsed;
        this.models.set(typeId, entry);
        this.loads.push({ file, bytes: data.byteLength, ms: performance.now() - start });
        return entry;
      });
      this.pending.set(key, pending);
    }
    return pending;
  }
}
