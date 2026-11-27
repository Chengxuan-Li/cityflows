import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  HalfFloatType,
  LinearSRGBColorSpace,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  ShaderMaterial,
  ShapeUtils,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Group,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { hexToLinear, type SceneLight } from '../../src/render/lighting';
import type { City } from '../../src/schema';

// Capture layer: water is a planar mirror (after three's Reflector): the scene reflected at
// `resolution` of the canvas, rippled by animated waves, with sun glints. It lies at the shore
// layer's level when that is on, else on the app's water.

export const params = { resolution: 0.6 };

interface Internals {
  scene: Scene;
  renderer: WebGLRenderer;
  content: Group;
  light: SceneLight;
  rail?: { paintCache: { mesh: Object3D } };
}

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
function waterGeometry(city: City, y: number) {
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
export function detailWater(internals: Internals, city: City, y: number, resolution: number) {
  const { renderer, scene } = internals;
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
  mirror.name = 'capture-water';
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
    const w = Math.round(size.x * resolution),
      h = Math.round(size.y * resolution);
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
