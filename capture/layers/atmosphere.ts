import {
  BackSide,
  Color,
  DepthTexture,
  Fog,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type DirectionalLight,
  type Material,
  type HemisphereLight,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { hexToLinear, type SceneLight } from '../../src/render/lighting';

// Capture layer: finer rendering. Soft high-resolution sun shadows (`shadowMap` texels, the
// app's shadows must be on), a sky dome with the sun's glow, drifting clouds and stars after dark,
// distance haze, and ambient occlusion from the depth buffer. The occlusion pass is the frame's
// last, so it also carries exposure past `gainAbove` (the app's exposure stops there and the rest
// is a final gain).

export const params = {
  shadows: true,
  shadowMap: 8192,
  sky: true,
  occlusion: true,
  gainAbove: 1.5,
};

export interface Stage {
  scene: Scene;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  sun: DirectionalLight;
  light: SceneLight;
  sky: HemisphereLight;
}

function recompile(scene: Scene) {
  scene.traverse((o) => {
    const material = (o as Mesh).material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : [])
      m.needsUpdate = true;
  });
}

/** The cut uses a larger PCF map and a wider filter for sun shadows. */
export function softShadows({ scene, renderer, sun }: Stage, mapSize: number) {
  const size = sun.shadow.mapSize.clone(),
    type = renderer.shadowMap.type;
  const radius = sun.shadow.radius;
  const apply = (s: Vector2, t: typeof type, penumbra: number) => {
    sun.shadow.radius = penumbra;
    sun.shadow.mapSize.copy(s);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    renderer.shadowMap.type = t;
    renderer.shadowMap.needsUpdate = true;
    recompile(scene);
  };
  apply(new Vector2(mapSize, mapSize), PCFShadowMap, 2.2);
  return () => apply(size, type, radius);
}

// ---- sky
const skyVertex = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const skyFragment = `
uniform vec3 horizon;
uniform vec3 zenith;
uniform vec3 sunDirection;
uniform vec3 sunColour;
uniform float night;
uniform float time;
varying vec3 vDirection;
// Hash without sine (after Dave Hoskins): even at large cell coordinates, no rows or patterns.
float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(11.3, 7.1); a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDirection);
  float e = d.y;
  vec3 colour = mix(horizon, zenith, pow(clamp(e, 0.0, 1.0), 0.5));
  if (e < 0.0) colour = horizon * 0.92;
  float toward = max(dot(d, sunDirection), 0.0);
  float day = 1.0 - night;
  // The sun's glow, wide and warm near the horizon; its disc when it is up.
  colour += sunColour * (pow(toward, 6.0) * 0.18 + pow(toward, 48.0) * 0.45);
  colour += sunColour * smoothstep(0.99955, 0.99975, toward) * 12.0 * step(0.0, sunDirection.y);
  // Clouds on a layer 2 km up, drifting; lit from the sun's side, grey after dark.
  if (e > 0.0) {
    vec2 uv = d.xz / (e + 0.08) * 1.6 + vec2(time * 0.012, time * 0.004);
    float density = fbm(uv);
    // The cloud thins as night falls, opening the sky to the stars.
    float cover = smoothstep(0.42 + 0.14 * night, 0.72 + 0.1 * night, density) * smoothstep(0.0, 0.15, e);
    // Thicker cloud is darker underneath; the sun's side catches its light.
    float thick = smoothstep(0.55, 0.85, density);
    float lit = 0.4 + 0.6 * pow(toward, 2.0);
    vec3 cloud = horizon * (1.22 - 0.3 * thick) + sunColour * 0.5 * lit;
    cloud = mix(cloud, horizon * 0.7 + zenith * 0.15, night * 0.85);
    colour = mix(colour, cloud, cover * 0.9);
    // Stars after dark, where no cloud covers them, faint near the horizon.
    vec3 cell = floor(d * 420.0);
    float pick = hash3(cell);
    if (pick > 0.996) {
      vec3 centre = (cell + 0.5 + (vec3(hash3(cell + 1.1), hash3(cell + 2.3), hash3(cell + 3.7)) - 0.5) * 0.2) / 420.0;
      float star = smoothstep(0.0009, 0.00025, length(d - normalize(centre)));
      float twinkle = 0.75 + 0.25 * sin(time * 3.0 + pick * 900.0);
      colour += vec3(0.9, 0.93, 1.0) * star * twinkle * night * (1.0 - cover) * smoothstep(0.04, 0.25, e) * (0.35 + (pick - 0.996) * 600.0) * 2.2;
    }
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The sky's colours for the app's current light: horizon, a deeper zenith, the sun's (or after
 * dark the moon's) direction and colour, and how far into the night it is. */
export function skyColours(light: SceneLight) {
  const horizon = new Vector3().fromArray(hexToLinear(light.background));
  const sun = new Vector3().fromArray(light.sun).normalize();
  // Night as the app has it (lamps and windows on); after dark its "sun" is the moonlight.
  const night = Math.min(1, Math.max(0, light.artificial));
  const zenith = horizon
    .clone()
    .multiply(new Vector3(0.7, 0.8, 1.0))
    .multiplyScalar(1.0 - 0.3 * night);
  const sunColour = new Vector3()
    .fromArray(hexToLinear(light.sunColor))
    .multiplyScalar(Math.max(0, Math.min(1, (sun.y + 0.08) / 0.12)) * light.sunIntensity * 0.6);
  return { horizon, zenith, sun, sunColour, night };
}

/** A sky dome round the camera in place of the flat clear colour, with distance haze in the
 * horizon's colour over the city. */
export function skyAndHaze(stage: Stage) {
  const { scene } = stage;
  const uniforms = {
    horizon: { value: new Vector3() },
    zenith: { value: new Vector3() },
    sunDirection: { value: new Vector3(0, 1, 0) },
    sunColour: { value: new Vector3() },
    night: { value: 0 },
    time: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: BackSide,
    depthWrite: false,
  });
  material.userData.lit = true;
  const dome = new Mesh(new SphereGeometry(30000, 48, 24), material);
  dome.name = 'capture-sky';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  const fogColour = new Color();
  const fog = new Fog(fogColour, 650, 11500);
  const previousFog = scene.fog;
  scene.fog = fog;
  recompile(scene);
  dome.onBeforeRender = (_renderer, _scene, camera) => {
    dome.position.setFromMatrixPosition(camera.matrixWorld);
    // Inside the far plane, which the app sets to the view.
    dome.scale.setScalar(((camera as PerspectiveCamera).far * 0.92) / 30000);
    dome.updateMatrixWorld();
    const { horizon, zenith, sun, sunColour, night } = skyColours(stage.light);
    uniforms.horizon.value.copy(horizon);
    uniforms.zenith.value.copy(zenith);
    uniforms.sunDirection.value.copy(sun);
    uniforms.sunColour.value.copy(sunColour);
    uniforms.night.value = night;
    fog.color.setRGB(horizon.x, horizon.y, horizon.z).multiplyScalar(0.79);
    fog.near = 550 + night * 420;
    fog.far = 9900 + night * 4100;
  };
  scene.add(dome);
  return {
    setTime: (t: number) => {
      uniforms.time.value = t;
    },
    dispose: () => {
      dome.removeFromParent();
      dome.geometry.dispose();
      material.dispose();
      scene.fog = previousFog;
      recompile(scene);
    },
  };
}

// ---- ambient occlusion
const aoVertex = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const aoFragment = `
uniform sampler2D tColour;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform float dusk;
uniform mat4 projectionInverse;
uniform float focal;
uniform vec2 resolution;
uniform float gain;
varying vec2 vUv;
vec3 viewAt(vec2 uv) {
  float depth = texture2D(tDepth, uv).x;
  vec4 v = projectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
void main() {
  vec4 colour = texture2D(tColour, vUv);
  float depth = texture2D(tDepth, vUv).x;
  vec3 p = viewAt(vUv);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(n, p) > 0.0) n = -n;
  float occlusion = 0.0;
  // Two radii catch contact at sleepers and kerbs and a wider shadow around foundations.
  // Fixed sample directions avoid screen-space noise crawling across moving surfaces.
  float nearFade = (1.0-smoothstep(350.0,900.0,-p.z))*step(depth,0.999999);
  if (nearFade > 0.0) {
    const int N = 16;
    for (int i = 0; i < N; i++) {
      float angle = float(i)*2.39996;
      float farRing = step(7.5,float(i));
      float radius = mix(0.48,2.35,farRing);
      float pixels = clamp(radius*focal/-p.z,1.5,85.0);
      vec2 direction = vec2(cos(angle),sin(angle));
      vec3 q = viewAt(vUv+direction*pixels/resolution);
      vec3 v = q-p;
      float d = length(v);
      occlusion += max(0.0,dot(n,v)/max(d,1e-3)-0.10)
        * (1.0-smoothstep(radius*0.9,radius*2.0,d)) * mix(1.0,0.74,farRing);
    }
    occlusion /= float(N);
  }
  vec3 rgb = (colour.rgb*(1.0-min(0.60,occlusion*2.35)*nearFade)
    + texture2D(tBloom,vUv).rgb*dusk*0.22)*gain;
  // A neutral shoulder keeps the morning palette in the mids and rolls off fog, sunlit
  // whites and lamp cores. A small highlight desaturation avoids saturating warm lamps.
  float peak = max(rgb.r,max(rgb.g,rgb.b));
  float shoulder = max(peak-0.61,0.0);
  float mapped = min(peak,0.61) + 0.39*(1.0-exp(-shoulder/0.39));
  rgb *= mapped/max(peak,0.00001);
  rgb = mix(rgb, vec3(dot(rgb,vec3(0.2126,0.7152,0.0722))),smoothstep(0.66,1.7,peak)*0.13);
  gl_FragColor = vec4(rgb,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const bloomFragment = `
uniform sampler2D source;
uniform vec2 stepUV;
uniform bool extract;
varying vec2 vUv;
vec3 sampleBloom(vec2 uv) { return texture2D(source,uv).rgb; }
void main() {
  if (extract) {
    // Averages all sixteen supersamples in this quarter-resolution texel, so small
    // window highlights do not blink in and out as the camera moves across them.
    vec3 total = vec3(0.0);
    for (int y=-1; y<=1; y+=2) for (int x=-1; x<=1; x+=2) {
      vec3 c=sampleBloom(vUv+vec2(float(x),float(y))*stepUV);
      total += c*smoothstep(0.33,0.91,max(c.r,max(c.g,c.b)));
    }
    gl_FragColor = vec4(total*0.25,1.0);
    return;
  }
  vec3 rgb=0.227027*sampleBloom(vUv);
  rgb+=0.316216*(sampleBloom(vUv-1.384615*stepUV)+sampleBloom(vUv+1.384615*stepUV));
  rgb+=0.070270*(sampleBloom(vUv-3.230769*stepUV)+sampleBloom(vUv+3.230769*stepUV));
  gl_FragColor=vec4(rgb,1.0);
}`;

/** The scene drawn to a target with depth, then shaded by ambient occlusion onto the canvas:
 * creases, corners and the ground at walls and under parked vehicles darken softly. The pass
 * also carries the cut's exposure past the app's limit (`setGain`). */
export function ambientOcclusion(stage: Stage) {
  const { scene, renderer, camera, sky } = stage;
  const coolSky = new Color(0xacc6ef),
    warmGround = new Color(0xd6bd9e);
  const depthTexture = new DepthTexture(1, 1);
  // At twice the pixels the frame is already supersampled; below, the target multisamples.
  const target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    depthTexture,
    samples: renderer.getPixelRatio() >= 2 ? 0 : 4,
  });
  const bloomA = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  const bloomB = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  const bloom = new ShaderMaterial({
    uniforms: {
      source: { value: target.texture },
      stepUV: { value: new Vector2() },
      extract: { value: true },
    },
    vertexShader: aoVertex,
    fragmentShader: bloomFragment,
    depthTest: false,
    depthWrite: false,
  });
  const material = new ShaderMaterial({
    uniforms: {
      tBloom: { value: bloomA.texture },
      dusk: { value: 0 },
      tColour: { value: target.texture },
      tDepth: { value: depthTexture },
      projectionInverse: { value: camera.projectionMatrixInverse },
      focal: { value: 1 },
      resolution: { value: new Vector2() },
      gain: { value: 1 },
    },
    vertexShader: aoVertex,
    fragmentShader: aoFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const post = new Scene().add(quad);
  const screen = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new Vector2();
  const render = renderer.render;
  renderer.render = function (this: WebGLRenderer, s, c) {
    if (s !== scene || c !== camera || renderer.getRenderTarget() !== null)
      return render.call(renderer, s, c);
    renderer.getDrawingBufferSize(size);
    if (target.width !== size.x || target.height !== size.y) {
      target.setSize(size.x, size.y);
      const w = Math.max(1, Math.round(size.x / 4)),
        h = Math.max(1, Math.round(size.y / 4));
      bloomA.setSize(w, h);
      bloomB.setSize(w, h);
    }
    const light = stage.light;
    // Add cool sky to up-facing surfaces and warmer bounce to shaded undersides.
    sky.color.setHex(light.sky).lerp(coolSky, 0.13 * (1.0 - light.artificial));
    sky.groundColor.setHex(light.ground).lerp(warmGround, 0.08 * (1.0 - light.artificial));
    sky.intensity = light.skyIntensity * 1.06;
    renderer.setRenderTarget(target);
    render.call(renderer, s, c);
    const dusk = light.artificial ** 2;
    if (dusk > 0) {
      quad.material = bloom;
      bloom.uniforms.source!.value = target.texture;
      bloom.uniforms.stepUV!.value.set(1 / size.x, 1 / size.y);
      bloom.uniforms.extract!.value = true;
      renderer.setRenderTarget(bloomA);
      render.call(renderer, post, screen);
      bloom.uniforms.source!.value = bloomA.texture;
      bloom.uniforms.stepUV!.value.set(1.25 / bloomA.width, 0);
      bloom.uniforms.extract!.value = false;
      renderer.setRenderTarget(bloomB);
      render.call(renderer, post, screen);
      bloom.uniforms.source!.value = bloomB.texture;
      bloom.uniforms.stepUV!.value.set(0, 1.25 / bloomA.height);
      renderer.setRenderTarget(bloomA);
      render.call(renderer, post, screen);
      quad.material = material;
    }
    renderer.setRenderTarget(null);
    material.uniforms.dusk!.value = dusk;
    material.uniforms.resolution!.value.copy(size);
    material.uniforms.focal!.value = (camera.projectionMatrix.elements[5]! * size.y) / 2;
    render.call(renderer, post, screen);
  };
  const dispose = () => {
    renderer.render = render;
    target.dispose();
    depthTexture.dispose();
    bloomA.dispose();
    bloomB.dispose();
    bloom.dispose();
    quad.geometry.dispose();
    material.dispose();
    sky.color.setHex(stage.light.sky);
    sky.groundColor.setHex(stage.light.ground);
    sky.intensity = stage.light.skyIntensity;
  };
  return {
    dispose,
    /** Brightness past the app's own exposure range, as a final gain. */
    setGain: (gain: number) => {
      material.uniforms.gain!.value = gain;
    },
  };
}
