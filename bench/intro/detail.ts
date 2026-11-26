import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  LinearSRGBColorSpace,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  ShaderMaterial,
  ShapeUtils,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type DirectionalLight,
  type Material,
  type Object3D,
  type PerspectiveCamera as Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { hexToLinear, type SceneLight } from '../../src/render/lighting';
import { ambientOcclusion, skyAndHaze, softShadows, type Stage } from './atmosphere';
import {
  airportFence,
  excelMasts,
  fillParking,
  hartmannRoad,
  routeCars,
  glazedTowers,
  railFences,
  segmentClearance,
} from './props';
import { WATER_Y, cutFlat, cutGround, quayWalls, waterIndex } from './shore';
import { detailTrees } from './foliage';
import {
  dockDressing,
  inFactoryYard,
  inStaffFrontage,
  outsideStaffBeds,
  onYardPavement,
  longStayLampPools,
  staffFrontagePose,
  staffPlanting,
} from './dockyard';
import type { CompiledCity } from '../../src/network';
import type { LightPoint } from '../../src/render3d/lights';
import type { CityGeometry } from '../../src/render/types';
import { walkGeometry } from '../../src/render/walk-geometry';
import { dockVergeRuns, undergrowth } from './undergrowth';
import type { City } from '../../src/schema';
import { trackDetail, type IntroTrainView } from './tracks';
import type { Airport } from '../../src/schema/airport';
import { apronDressing } from './airfield';
import { surfaceTexture, type IntroSurfaces } from './surfaces';
import type { RailHeights } from '../../src/network/rail';

// Intro mock (not a product feature): extra detail for the intro cut only, added to the running
// app's 3D scene by bench/intro/render.ts and the tuner. It reaches into the scene's internals
// through the dev-only `window.cityflows.scene3D()`; nothing here ships.
//   - building windows stay drawn while they are a few pixels across (the app fades them by
//     distance), and fade to their average below that, without shimmer;
//   - trees get layered, open boughs (./foliage.ts);
//   - the ground, roads, roofs and walls take a procedural texture (./surfaces.ts);
//   - water is a planar mirror: the scene reflected, rippled by animated waves, with sun glints;
//   - King George V gets a canopy over its island platform and DLR roundels;
//   - a few cars drive Hartmann Road (./props.ts), which the simulated trips leave empty;
//   - finer rendering (./atmosphere.ts): soft shadows, sky, clouds, stars, haze, occlusion.

type Vec2 = { x: number; y: number };
interface Internals extends IntroSurfaces {
  scene: Scene;
  renderer: WebGLRenderer;
  camera: Camera;
  light: SceneLight;
  sun: DirectionalLight;
  rail?: { group: Group; paintCache: { mesh: Object3D }; heights: RailHeights };
  city?: CompiledCity;
  source?: CityGeometry;
  street?: { lampLights: { pool: LightPoint }[] };
  trains?: IntroTrainView;
  trainTimeS: number;
  parkedCars?: Parameters<typeof fillParking>[0];
  vehicles?: Parameters<typeof routeCars>[0];
  parkedSnapshot: Parameters<typeof fillParking>[2];
  vegetation?: {
    natural: Group;
    street: Group;
    update: (distance: number) => void;
  };
  invalidate(): void;
}
interface CityLike {
  context?: {
    features: {
      kind: string;
      class?: string;
      sub?: string;
      material?: string;
      rings?: Vec2[][];
      heightM?: number;
      levels?: number;
    }[];
  };
  roads: Record<string, { name?: string; centerline: Vec2[]; lanes: { widthM: number }[] }>;
  walk?: City['walk'];
  parking?: City['parking'];
  airport?: Airport;
  rail?: {
    platforms: Record<string, { station?: string; shape: { kind: string; ring?: Vec2[] } }>;
  };
}
export interface IntroDetail {
  /** Video time, for the water's waves. */
  setTime(t: number): void;
  setEnabled(on: boolean): void;
  /** Exposure past the app's 1.5, as a final gain. */
  setGain(gain: number): void;
}

// ---- windows
// Each axis of the window grid fades to its own average only once its cells shrink under about
// two pixels: far towers keep their floor bands after their columns merge, instead of the whole
// grid dimming into the wall as the app's distance fade does.
const rowsPerPixel = 'fwidth(vWindowInfo.y / vWindowInfo.z)',
  columnsPerPixel = 'fwidth(vWindowInfo.x / 2.8)';
function sharpenWindows(material: Material) {
  const original = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        /float band = smoothstep\(0\.28, 0\.33, level\)[^;]*;\s*band \*= smoothstep\(0\.16, 0\.21, along\)[^;]*;\s*band \*= 1\.0 - smoothstep\([^;]*length\(vViewPosition\)\);/,
        `float rows = smoothstep(0.28, 0.33, level) * (1.0 - smoothstep(0.72, 0.77, level));
          float cols = smoothstep(0.16, 0.21, along) * (1.0 - smoothstep(0.74, 0.79, along));
          rows = mix(rows, 0.45, smoothstep(0.32, 0.62, ${rowsPerPixel}));
          cols = mix(cols, 0.58, smoothstep(0.32, 0.62, ${columnsPerPixel}));
          float band = rows * cols;`,
      )
      .replace(
        /float far = smoothstep\([^;]*length\(vViewPosition\)\);/,
        `float far = smoothstep(0.32, 0.62, max(${rowsPerPixel}, ${columnsPerPixel}));`,
      )
      .replace(/band \* 0\.32\)/, 'band * 0.55)');
    if (!shader.fragmentShader.includes('float rows'))
      throw new Error('Intro detail: the window shader no longer matches');
  };
  material.needsUpdate = true;
  return original;
}

// ---- water: a planar mirror (after three's Reflector) with animated waves
const waterVertex = `
uniform mat4 textureMatrix;
varying vec4 vMirror;
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vMirror = textureMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const waterFragment = `
uniform sampler2D tMirror;
uniform vec2 mirrorSize;
uniform float time;
uniform vec3 sunDirection;
uniform vec3 sunColour;
uniform vec3 deep;
varying vec4 vMirror;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
// Ripples: drifting value-noise octaves, irregular so they never line up into stripes; each
// octave fades before it shrinks under a pixel.
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 noiseSlope(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  vec2 d = 6.0*f*(1.0-f);
  float a=hash2(i), b=hash2(i+vec2(1.0,0.0)), c=hash2(i+vec2(0.0,1.0)), e=hash2(i+1.0);
  return d*vec2(mix(b-a,e-c,u.y),mix(c-a,e-b,u.x));
}
vec2 slope(vec2 p,float footprint) {
  vec2 result=vec2(0.0);
  float amplitude=1.0, frequency=0.16;
  for(int i=0;i<5;i++) {
    float angle=float(i)*2.17+0.4;
    vec2 drift=vec2(cos(angle),sin(angle))*time*(0.27+0.13*float(i));
    float keep=1.0-smoothstep(0.15,0.52,footprint*frequency);
    result+=amplitude*frequency*keep*noiseSlope(p*frequency+drift+float(i)*13.7);
    amplitude*=0.46;
    frequency*=2.07;
  }
  return result;
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 view = toEye / dist;
  float fade = length(fwidth(vWorld.xz));
  vec2 s = slope(vWorld.xz, fade);
  vec3 n = normalize(vec3(-s.x*1.03,1.0,-s.y*1.03));
  vec2 clean = vMirror.xy/vMirror.w;
  vec2 uv = clean + n.xz*0.21/max(1.0,dist*0.009);
  float facing = max(dot(n,view),0.0);
  // The image is a rough reflection. Estimate the footprint from the smooth projection so
  // wave gradients bend the reflection without selecting wildly different mips every frame.
  vec2 dx=dFdx(clean)*mirrorSize, dy=dFdy(clean)*mirrorSize;
  float pixels=max(length(dx),length(dy));
  float roughness=mix(4.0,2.1,smoothstep(0.02,0.48,facing));
  vec3 mirrored=textureLod(tMirror,uv,clamp(log2(max(pixels,roughness)),1.0,7.0)).rgb;
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 colour = mix(deep, mirrored, clamp(0.05 + fresnel, 0.0, 0.95));
  vec3 r = reflect(-view, n);
  colour += sunColour * (pow(max(dot(r, sunDirection), 0.0), 500.0) * 4.5 + pow(max(dot(r, sunDirection), 0.0), 60.0) * 0.12);
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
function waterGeometry(city: CityLike, y: number) {
  const positions: number[] = [];
  for (const feature of city.context?.features ?? []) {
    if (feature.kind !== 'area' || feature.class !== 'water' || !feature.rings?.length) continue;
    const [outer, ...holes] = feature.rings.map((ring) => ring.map((p) => new Vector2(p.x, p.y)));
    if (!outer || outer.length < 3) continue;
    const all = [outer, ...holes].flat();
    for (const [a, b, c] of ShapeUtils.triangulateShape(outer, holes))
      for (const i of [a, c, b]) positions.push(all[i!]!.x, y, all[i!]!.y);
  }
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  );
  geometry.computeBoundingSphere();
  return geometry;
}
function detailWater(internals: Internals, city: CityLike) {
  const { renderer, scene } = internals;
  const y = WATER_Y;
  const target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
  });
  target.texture.colorSpace = LinearSRGBColorSpace;
  const uniforms = UniformsUtils.merge([
    UniformsLib.common,
    UniformsLib.fog,
    {
      tMirror: { value: null },
      mirrorSize: { value: new Vector2(1, 1) },
      textureMatrix: { value: new Matrix4() },
      time: { value: 0 },
      sunDirection: { value: new Vector3(0, 1, 0) },
      sunColour: { value: new Vector3() },
      deep: { value: new Vector3(0.01, 0.025, 0.04) },
    },
  ]);
  uniforms.tMirror!.value = target.texture;
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.userData.lit = true;
  const mirror = new Mesh(waterGeometry(city, y), material);
  mirror.name = 'intro-water';
  mirror.frustumCulled = false;
  const virtual = new PerspectiveCamera();
  const normal = new Vector3(0, 1, 0),
    planePoint = new Vector3(0, y, 0),
    cameraPosition = new Vector3(),
    lookAt = new Vector3(),
    view = new Vector3(),
    goal = new Vector3(),
    rotation = new Matrix4(),
    plane = new Plane(),
    clip = new Vector4(),
    q = new Vector4(),
    size = new Vector2(),
    clear = new Color();
  mirror.onBeforeRender = (_renderer, _scene, camera) => {
    const cam = camera as PerspectiveCamera;
    cameraPosition.setFromMatrixPosition(cam.matrixWorld);
    view.subVectors(planePoint, cameraPosition);
    if (view.dot(normal) > 0) return;
    renderer.getDrawingBufferSize(size);
    const w = Math.round(size.x * 0.6),
      h = Math.round(size.y * 0.6);
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    (uniforms.mirrorSize!.value as Vector2).set(w, h);
    view.reflect(normal).negate().add(planePoint);
    rotation.extractRotation(cam.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(cameraPosition);
    goal.subVectors(planePoint, lookAt).reflect(normal).negate().add(planePoint);
    virtual.position.copy(view);
    virtual.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    virtual.lookAt(goal);
    virtual.far = cam.far;
    virtual.near = cam.near;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(cam.projectionMatrix);
    const tm = uniforms.textureMatrix!.value as Matrix4;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(virtual.projectionMatrix)
      .multiply(virtual.matrixWorldInverse)
      .multiply(mirror.matrixWorld);
    // An oblique near plane on the water, so nothing below it shows in the reflection.
    plane
      .setFromNormalAndCoplanarPoint(normal, planePoint)
      .applyMatrix4(virtual.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = virtual.projectionMatrix.elements;
    q.set(
      (Math.sign(clip.x) + e[8]!) / e[0]!,
      (Math.sign(clip.y) + e[9]!) / e[5]!,
      -1,
      (1 + e[10]!) / e[14]!,
    );
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1 - 0.003;
    e[14] = clip.w;
    // Light: the deep water darkens with the sky, the glint follows the sun.
    const light = internals.light;
    renderer.getClearColor(clear);
    (uniforms.deep!.value as Vector3)
      .set(clear.r, clear.g, clear.b)
      .multiplyScalar(0.12)
      .add(new Vector3(0.006, 0.014, 0.022));
    (uniforms.sunDirection!.value as Vector3).fromArray(light.sun).normalize();
    (uniforms.sunColour!.value as Vector3)
      .fromArray(hexToLinear(light.sunColor))
      .multiplyScalar(light.sun[1] > 0 ? light.sunIntensity : 0);
    // Draw the reflection: the mirror and the cached screen-space rail paint stay out of it.
    const paint = internals.rail?.paintCache.mesh;
    const paintVisible = paint?.visible;
    if (paint) paint.visible = false;
    mirror.visible = false;
    const previous = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.state.buffers.depth.setMask(true);
    if (!renderer.autoClear) renderer.clear();
    renderer.render(scene, virtual);
    renderer.shadowMap.autoUpdate = shadows;
    renderer.setRenderTarget(previous);
    mirror.visible = true;
    if (paint) paint.visible = paintVisible!;
  };
  internals.content.add(mirror);
  return {
    setTime: (t: number) => {
      uniforms.time!.value = t;
    },
    mesh: mirror,
    dispose: () => {
      mirror.removeFromParent();
      mirror.geometry.dispose();
      material.dispose();
      target.dispose();
    },
  };
}

// ---- King George V: canopy and roundels
function roundelTexture(text: string) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 768 });
  const g = canvas.getContext('2d')!;
  const cx = 512,
    cy = 384;
  g.lineWidth = 110;
  g.strokeStyle = '#00a4a7';
  g.beginPath();
  g.arc(cx, cy, 255, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#10069f';
  const barH = 150,
    barW = 900;
  g.fillRect(cx - barW / 2, cy - barH / 2, barW, barH);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 104;
  do g.font = `600 ${size--}px Arimo, Arial, sans-serif`;
  while (g.measureText(text).width > barW - 70);
  g.fillText(text, cx, cy + 6);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
function surfaceY(internals: Internals, p: Vec2, below: number) {
  const ray = new Raycaster(new Vector3(p.x, 60, p.y), new Vector3(0, -1, 0));
  const hits = ray
    .intersectObject(internals.content, true)
    .filter((h) => h.point.y < below && (h.object as Mesh).isMesh);
  return hits[0]?.point.y ?? 0;
}
function detailStation(internals: Internals, city: CityLike) {
  const group = new Group();
  group.name = 'intro-station';
  const platforms = Object.values(city.rail?.platforms ?? {}).filter(
    (p) => p.station === 'p:2670' && p.shape.kind === 'polygon',
  );
  const points = platforms.flatMap((p) => p.shape.ring ?? []);
  if (points.length < 4) return { group, dispose: () => {} };
  // The island platform's centre line, from its west end to its east end.
  const west = points.filter((p) => p.x < 560),
    east = points.filter((p) => p.x > 600);
  const mean = (ps: Vec2[]) => ({
    x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
    y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  });
  const a = mean(west),
    b = mean(east);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
    n = { x: -d.y, y: d.x };
  const width = Math.min(
    ...[west, east].map((ps) => {
      const across = ps.map((p) => (p.x - a.x) * n.x + (p.y - a.y) * n.y);
      return Math.max(...across) - Math.min(...across);
    }),
  );
  const at = (s: number, across = 0) => ({
    x: a.x + d.x * s + n.x * across,
    y: a.y + d.y * s + n.y * across,
  });
  const heading = Math.atan2(-d.y, d.x);
  const deck = surfaceY(internals, at(length * 0.5, 0), 2.2);
  // Canopy: a shallow gabled roof over the middle of the platform on one row of columns.
  const s0 = 9,
    s1 = length - 14,
    roofY = deck + 3.7,
    roofW = width - 0.6;
  const metal = new MeshLambertMaterial({ color: 0xe1e5e7 });
  const steel = new MeshLambertMaterial({ color: 0x8e979c });
  const roofLength = s1 - s0;
  const mid = at((s0 + s1) / 2);
  for (const side of [-1, 1]) {
    const slab = new Mesh(new BoxGeometry(roofLength, 0.16, roofW / 2 + 0.05), metal);
    slab.position.set(
      mid.x + n.x * side * roofW * 0.25,
      roofY + 0.12,
      mid.y + n.y * side * roofW * 0.25,
    );
    slab.rotation.order = 'YXZ';
    slab.rotation.y = heading;
    slab.rotation.x = side * 0.07;
    group.add(slab);
    const fascia = new Mesh(new BoxGeometry(roofLength, 0.32, 0.08), steel);
    const edge = at((s0 + s1) / 2, side * (roofW / 2 + 0.02));
    fascia.position.set(edge.x, roofY - 0.02, edge.y);
    fascia.rotation.y = heading;
    group.add(fascia);
  }
  const spine = new Mesh(new BoxGeometry(roofLength, 0.4, 0.3), steel);
  spine.position.set(mid.x, roofY - 0.1, mid.y);
  spine.rotation.y = heading;
  group.add(spine);
  for (let s = s0 + 2; s <= s1 - 2; s += 7.5) {
    const p = at(s);
    const column = new Mesh(new CylinderGeometry(0.12, 0.14, roofY - deck, 10), steel);
    column.position.set(p.x, (roofY + deck) / 2, p.y);
    group.add(column);
    for (const side of [-1, 1]) {
      const arm = new Mesh(new BoxGeometry(0.1, 0.12, roofW / 2), steel);
      const q = at(s, (side * roofW) / 4);
      arm.position.set(q.x, roofY - 0.18, q.y);
      arm.rotation.y = heading;
      group.add(arm);
    }
  }
  // Roundels: on posts along both platform edges, facing the trains, and on the canopy's ends.
  const named = roundelTexture('King George V'),
    plain = roundelTexture('DLR');
  const sign = (texture: CanvasTexture, wide: number) => {
    const face = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.4,
      side: DoubleSide,
    });
    face.userData.lit = false;
    const board = new Mesh(new PlaneGeometry(wide, wide * 0.75), face);
    return board;
  };
  for (const s of [14, 34, 54, 74]) {
    if (s > length - 4) continue;
    for (const side of [-1, 1]) {
      const p = at(s, side * (width / 2 - 0.9));
      const board = sign(named, 1.5);
      board.position.set(p.x, deck + 2.35, p.y);
      // Face across the track; the double-sided face reads backwards from behind, so a second
      // board faces the other way.
      board.rotation.y = heading + (side > 0 ? 0 : Math.PI);
      group.add(board);
      const back = board.clone();
      back.rotation.y += Math.PI;
      back.position.add(new Vector3(-n.x * side * 0.02, 0, -n.y * side * 0.02));
      group.add(back);
      for (const off of [-0.45, 0.45]) {
        const q = at(s + off, side * (width / 2 - 0.9));
        const post = new Mesh(new CylinderGeometry(0.04, 0.04, 1.85, 6), steel);
        post.position.set(q.x, deck + 0.925, q.y);
        group.add(post);
      }
    }
  }
  for (const [s, turn] of [
    [s0 - 0.06, -Math.PI / 2],
    [s1 + 0.06, Math.PI / 2],
  ] as const) {
    const p = at(s);
    const board = sign(plain, 2.2);
    board.position.set(p.x, roofY - 0.9, p.y);
    board.rotation.y = heading + turn;
    group.add(board);
  }
  internals.content.add(group);
  return {
    group,
    dispose: () => {
      group.removeFromParent();
      group.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      named.dispose();
      plain.dispose();
    },
  };
}

export function install(scene3d: unknown, city: CityLike): IntroDetail {
  const internals = scene3d as Internals;
  let undo: (() => void)[] = [];
  let water: ReturnType<typeof detailWater> | undefined;
  let sky: ReturnType<typeof skyAndHaze> | undefined;
  let occlusion: ReturnType<typeof ambientOcclusion> | undefined;
  let gain = 1;
  const enable = () => {
    const windows: [Material, Material['onBeforeCompile']][] = [];
    internals.scene.traverse((o) => {
      const mesh = o as Mesh;
      const material = mesh.material as Material | undefined;
      if (!mesh.isMesh || !material || Array.isArray(material) || !material.userData.lights) return;
      if (windows.some(([m]) => m === material)) return;
      windows.push([material, sharpenWindows(material)]);
    });
    undo.push(() => {
      for (const [material, original] of windows) {
        material.onBeforeCompile = original;
        material.needsUpdate = true;
      }
    });
    const staff = city.parking?.['pk:3102']?.shape;
    const decorateDock = staff?.kind === 'polygon' && !!internals.vehicles?.modelGeometries;
    undo.push(detailTrees(internals.vegetation, decorateDock ? onYardPavement : undefined));
    water = detailWater(internals, city);
    undo.push(water.dispose);
    undo.push(detailStation(internals, city).dispose);
    const removeTrack = trackDetail(
      internals.rail?.group,
      internals.city?.rail,
      internals.geometry?.heights,
      internals.rail?.heights,
      () => 1 - internals.light.artificial,
      internals.trains,
    );
    internals.trainTimeS = NaN;
    undo.push(() => {
      removeTrack();
      internals.trainTimeS = NaN;
    });
    // The water below the land, with quay walls; then fences, ExCeL's masts, full car parks.
    const areas = (city.context?.features ?? [])
      .filter((f) => f.kind === 'area' && f.class === 'water' && f.rings?.length)
      .map((f) => f.rings!);
    const wet = waterIndex(areas);
    const roads = segmentClearance(
      Object.values(city.roads).map((r) => ({
        line: r.centerline,
        pad: r.lanes.reduce((sum, l) => sum + l.widthM, 0) / 2,
      })),
    );
    const boundary = railFences(internals.city?.rail, internals.rail?.heights, roads, wet.inside);
    const platforms = (internals.city?.rail?.platforms ?? []).flatMap((p) =>
      p.shape.kind === 'polygon' ? [p.shape.ring] : [],
    );
    const terrain = internals.geometry?.heights.terrain;
    const compiled = internals.city;
    const groundTracks = (compiled?.rail?.tracks ?? []).filter(
      (t) => t.kind !== 'tram' && internals.rail?.heights.grades[t.idx] === 'ground',
    );
    const railway = new Set(
      groundTracks.filter((t) => t.name === 'Docklands Light Railway').map((t) => t.idx),
    );
    const plantedBends = (compiled?.rail?.tracks ?? []).filter(
      (t) =>
        t.name === 'Docklands Light Railway' &&
        internals.rail?.heights.grades[t.idx] === 'bridge' &&
        t.line.some((p) => p.x > -314 && p.x < -197 && p.y > 131 && p.y < 205),
    );
    const walks = compiled
      ? walkGeometry(compiled, internals.source)
          .filter((w) => w.layer === 0)
          .flatMap((w) => w.polygons)
      : [];
    const longStay = city.parking?.['pk:3224']?.shape;
    const facilities = Object.values(city.parking ?? {}).flatMap((p) =>
      p.shape?.kind === 'polygon' ? [p.shape.ring] : [],
    );
    const spaces = (compiled?.parkingSpaces ?? [])
      .filter(({ position: p }) => p.x > -358 && p.x < 818 && p.y > 96 && p.y < 434)
      .map(({ position: p, heading, lengthM, widthM }) => {
        const a = lengthM / 2 + 0.24,
          b = widthM / 2 + 0.24,
          c = Math.cos(heading),
          s = Math.sin(heading);
        return [
          [-a, -b],
          [a, -b],
          [a, b],
          [-a, b],
        ].map(([u, v]) => ({
          x: p.x + c * u! - s * v!,
          y: p.y + s * u! + c * v!,
        }));
      });
    const runway = Object.values(city.airport?.runways ?? {})[0];
    const threshold = runway?.ends[0];
    const protectAirside = (p: Vec2) => {
      if (!threshold) return false;
      const dx = p.x - threshold.pos.x,
        dy = p.y - threshold.pos.y;
      const k = Math.cos(threshold.heading),
        s = Math.sin(threshold.heading);
      const u = k * dx + s * dy,
        v = k * dy - s * dx;
      // The apron, grass strips and runway occupy the airside side of Hartmann Road.
      // The wider airport boundary also encloses the car park and its roadside verges.
      return u > -305 && u < 1645 && v > -84 && v < 209;
    };
    const lowPlants = undergrowth({
      plots: (city.context?.features ?? []).filter(
        (f): f is typeof f & { rings: Vec2[][] } => f.kind === 'area' && !!f.rings?.length,
      ),
      noPlantPolygons: [
        ...platforms,
        ...facilities,
        ...spaces,
        ...walks,
        ...(compiled?.roads ?? []).filter((r) => r.grade === 0).map((r) => r.surface),
        ...(compiled?.nodes ?? []).filter((n) => n.grade === 0).map((n) => n.outline),
        ...(compiled?.strips ?? []).map((s) => s.polygon),
      ],
      fences: boundary.verges.filter((r) => railway.has(r.track)),
      tracks: groundTracks.map((t) => ({ line: t.line, pad: 0 })),
      runs: [
        ...dockVergeRuns(
          Object.values(city.roads),
          longStay?.kind === 'polygon' ? longStay.ring : undefined,
        ),
        ...(decorateDock ? staffPlanting : []),
        ...plantedBends.flatMap(({ line }) =>
          [-1, 1].map((side) => ({ line, side, offset: 5.1, width: 2.2, height: 1.75 })),
        ),
      ],
      lamps: [
        ...(internals.street?.lampLights ?? []).map((l) => l.pool),
        ...(decorateDock ? longStayLampPools : []),
      ],
      blocked: (p) =>
        wet.inside(p) ||
        protectAirside(p) ||
        (decorateDock && (inFactoryYard(p) || outsideStaffBeds(p))),
      hidden: decorateDock ? inStaffFrontage : undefined,
      heightAt: (x, z) => terrain?.groundAt(x, z) ?? 0,
      artificial: () => internals.light.artificial,
    });
    undo.push(lowPlants.dispose);
    // Identify the app's asphalt and airfield batches before cutting their geometry to the shore.
    const apron =
      city.airport && runway ? apronDressing(city.airport, runway, wet.edges) : undefined;
    if (apron) undo.push(apron.dispose);
    undo.push(
      surfaceTexture(
        internals,
        runway,
        lowPlants,
        apron,
        decorateDock ? staffFrontagePose : undefined,
      ),
    );
    undo.push(cutGround(internals.ground, wet, areas));
    const surroundings = internals.surroundings;
    if (surroundings) undo.push(cutFlat(surroundings, wet, undefined, false));
    const flats: Mesh[] = [];
    internals.content.traverse((o) => {
      const mesh = o as Mesh;
      const material = mesh.material as Material & { vertexColors?: boolean };
      if (!mesh.isMesh || mesh === surroundings || mesh === internals.ground) return;
      if (Array.isArray(material) || !material?.vertexColors || mesh.name.startsWith('intro'))
        return;
      const geometry = mesh.geometry;
      if (geometry.index || geometry.getAttribute('position').count > 900_000) return;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      if (box.max.y - box.min.y < 0.3 && Math.abs(box.min.y) < 0.2) flats.push(mesh);
    });
    for (const mesh of flats) undo.push(cutFlat(mesh, wet));
    undo.push(quayWalls(wet, internals.content));
    internals.content.add(lowPlants.group);
    if (decorateDock) {
      const dock = dockDressing(
        staff.ring,
        internals.buildings,
        internals.vehicles!.modelGeometries!,
        internals.city?.parkingSpaces ?? [],
        () => internals.light.artificial,
      );
      internals.content.add(dock.group);
      undo.push(dock.dispose);
    }
    const props = new Group();
    props.name = 'intro-props';
    props.add(
      boundary.group,
      airportFence(city.airport?.boundary, roads, wet.inside),
      excelMasts(city.context?.features ?? []),
      glazedTowers(
        (city.context?.features ?? []) as Parameters<typeof glazedTowers>[0],
        () => internals.light.artificial,
      ),
    );
    internals.content.add(props);
    undo.push(() => props.removeFromParent());
    undo.push(
      fillParking(
        internals.parkedCars,
        internals.city?.parkingSpaces?.length ?? 0,
        internals.parkedSnapshot,
      ),
    );
    undo.push(
      routeCars(
        internals.vehicles,
        internals.city as unknown as Parameters<typeof routeCars>[1],
        hartmannRoad,
        4,
      ),
    );
    const stage = internals as unknown as Stage;
    undo.push(softShadows(stage));
    sky = skyAndHaze(stage);
    undo.push(sky.dispose);
    occlusion = ambientOcclusion(stage);
    occlusion.setGain(gain);
    undo.push(occlusion.dispose);
    internals.invalidate();
  };
  enable();
  return {
    setTime: (t) => {
      water?.setTime(t);
      sky?.setTime(t);
      internals.invalidate();
    },
    setGain: (value) => {
      gain = value;
      occlusion?.setGain(value);
      internals.invalidate();
    },
    setEnabled: (on) => {
      if (on === undo.length > 0) return;
      if (on) enable();
      else {
        undo.reverse().forEach((u) => u());
        undo = [];
        water = undefined;
        sky = undefined;
        occlusion = undefined;
        internals.invalidate();
      }
    },
  };
}
