import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
import { hull, type AircraftLivery } from '../render/aircraft-livery';
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

/** A fuselage triangle's livery colour (sRGB hex) from its place along the length (a fraction,
 * positive forward) and its angle around the fuselage from the crown (0) to the keel (pi), after
 * TASK-315's procedural bands. The thin bands are strips of their own (`bandColor`). */
export function liveryAt(livery: AircraftLivery, along: number, angle: number) {
  const inside = (from: number, to: number) => along >= from && along <= to;
  if (livery.style === 'belly' && inside(-0.45, 0.47) && angle > 1.8) return livery.tail;
  if (livery.style === 'tailcone' && along < -0.27 && angle < 1.45) return livery.tail;
  if (livery.style === 'crown' && inside(-0.36, 0.395) && angle < 1.02) return livery.tail;
  // The light belly lies under the scheme's own bands.
  return livery.belly !== null && inside(-0.42, 0.43) && angle > 2.02 ? livery.belly : hull;
}

/** A thin band's colour in this livery, or null where the scheme has no such band. */
export function bandColor(livery: AircraftLivery, band: string): number | null {
  switch (band) {
    case 'band-cheatline':
      return livery.style === 'cheatline' ? livery.tail : null;
    case 'band-cheatline-trim':
      return livery.style === 'cheatline' ? livery.trim : null;
    case 'band-belly-trim':
      return livery.style === 'belly' ? livery.trim : null;
    case 'band-tailcone-trim':
      return livery.style === 'tailcone' ? livery.trim : null;
  }
  throw new Error(`unknown livery band ${band}`);
}

export interface AircraftModel {
  typeId: string;
  info: ModelInfo;
  lengthM: number;
  lods: [ModelLod | null, ModelLod | null];
  /** Merged, coloured body geometry per level and livery, shared by every aircraft wearing it. */
  bodies: Map<string, BufferGeometry>;
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

/** One geometry per level and livery: every part merged and coloured per triangle. */
export function modelBody(model: AircraftModel, lod: ModelLodIndex, livery: AircraftLivery) {
  const key = `${lod}:${livery.style}:${livery.tail}:${livery.trim}:${livery.engines}:${livery.belly}`;
  let body = model.bodies.get(key);
  if (body) return body;
  const { profile } = model.info;
  const length = model.lengthM;
  const color = new Color();
  const parts = model.lods[lod]!.parts.filter(
    (part) => !part.name.startsWith('band-') || bandColor(livery, part.name) !== null,
  );
  const geometries = parts.map((part) => {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let t = 0; t < position.count; t += 3) {
      if (part.name === 'hull') {
        const x = (position.getX(t) + position.getX(t + 1) + position.getX(t + 2)) / 3;
        const y = (position.getY(t) + position.getY(t + 1) + position.getY(t + 2)) / 3;
        const z = (position.getZ(t) + position.getZ(t + 1) + position.getZ(t + 2)) / 3;
        const f = Math.min(
          profile.length - 1,
          Math.max(0, (x / length + 0.5) * (profile.length - 1)),
        );
        const [, cy, height, width] = profile[Math.round(f)]!;
        color.setHex(
          liveryAt(livery, x / length, Math.atan2(Math.abs(z) / width, (y - cy) / height)),
        );
      } else if (part.name.startsWith('band-')) color.setHex(bandColor(livery, part.name)!);
      else if (part.name === 'tail') color.setHex(livery.tail);
      else if (part.name === 'engine') color.setHex(livery.engines);
      else color.copy(part.color);
      for (let k = 0; k < 9; k += 3) {
        colors[t * 3 + k] = color.r;
        colors[t * 3 + k + 1] = color.g;
        colors[t * 3 + k + 2] = color.b;
      }
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
  });
  body = mergeGeometries(geometries)!;
  for (const geometry of geometries) geometry.dispose();
  body.computeBoundingSphere();
  model.bodies.set(key, body);
  return body;
}

/** A level of one aircraft: its body and outline sharing the type's geometry, and spinners. */
export function modelLodObject(
  model: AircraftModel,
  lod: ModelLodIndex,
  livery: AircraftLivery,
  material: Material,
  outline: Material,
) {
  const group = new Group();
  group.name = `model-lod${lod}`;
  group.matrixAutoUpdate = false;
  const geometry = modelBody(model, lod, livery);
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
  return { group, spinners };
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
