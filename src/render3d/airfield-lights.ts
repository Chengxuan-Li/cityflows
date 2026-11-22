import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type PerspectiveCamera,
} from 'three';
import type { AirsideGraph } from '../network/airside';
import type { Airport } from '../schema/airport';
import {
  airfieldColors,
  airfieldLightColors,
  papiAngles,
  placeAirfieldLights,
  type AirfieldLight,
  type AirfieldLightKind,
} from '../render/airfield-lights';
import type { AircraftPose, AirfieldState } from '../render/types';
import { buildPools } from './lights';

/** Camera-facing glows sized in metres but never under `minPx` pixels across their radius, so a
 * runway's lights still read as rows of points from a city-wide view (TASK-301). */
export function pointHalos(capacity: number, minPx: number, liftM = 0) {
  const material = new ShaderMaterial({
    uniforms: {
      intensity: { value: 0 },
      pixelScale: { value: 0.001 },
      minPx: { value: minPx },
      liftM: { value: liftM },
    },
    vertexShader: `
      uniform float pixelScale;
      uniform float minPx;
      uniform float liftM;
      attribute vec4 centreSize;
      attribute vec3 tint;
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        vUv = uv;
        vTint = tint;
        if (dot(tint, tint) == 0.0) {
          gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
          return;
        }
        vec4 centre = modelViewMatrix * vec4(centreSize.xyz, 1.0);
        // Towards the camera by liftM, so a lamp on a surface is not hidden by that surface.
        centre.xyz += normalize(-centre.xyz) * liftM;
        float size = max(centreSize.w, 2.0 * minPx * pixelScale * -centre.z);
        centre.xy += position.xy * size;
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: `
      uniform float intensity;
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float glow = pow(max(0.0, 1.0 - d), 2.5) + 0.8 * pow(max(0.0, 1.0 - d * 2.5), 2.0);
        gl_FragColor = vec4(vTint * glow * intensity, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  material.userData.lit = true;
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(plane.index);
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.setAttribute('uv', plane.getAttribute('uv'));
  const centres = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const tints = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
    DynamicDrawUsage,
  );
  geometry.setAttribute('centreSize', centres);
  geometry.setAttribute('tint', tints);
  geometry.instanceCount = 0;
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, geometry, material, centres, tints };
}

/** World metres per pixel at unit depth, for `pointHalos`. */
export const pixelScale = (camera: PerspectiveCamera, heightPx: number) =>
  (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, heightPx);

const radiusM: Record<AirfieldLightKind, number> = {
  'runway-edge': 1.6,
  'runway-centreline': 1,
  threshold: 1.6,
  'runway-end': 1.6,
  approach: 1.8,
  papi: 2.6,
  'taxiway-centreline': 0.8,
  'taxiway-edge': 0.8,
  'stop-bar': 1.1,
  'intermediate-hold': 0.9,
  'apron-flood': 3,
};

/** TASK-301: the airfield's lights in 3D, after dark: one instanced glow per light, recoloured
 * from the sim's airfield state (ends in use, stop bars) and the approaching aircraft (PAPI), and
 * a floodlight pool over each stand. */
export class AirfieldLights3D {
  readonly group = new Group();
  readonly lights: AirfieldLight[];
  private readonly halos: ReturnType<typeof pointHalos>;
  private readonly pools: ReturnType<typeof buildPools>;
  private readonly color = new Color();
  private readonly byKind: Partial<Record<AirfieldLightKind, number>> = {};
  private colors: number[] = [];
  private on = 0;

  constructor(
    private readonly graph: AirsideGraph,
    approachAids: Airport['approachAids'] | undefined,
    groundAt: (x: number, y: number) => number,
  ) {
    this.group.name = 'airfield-lights';
    this.lights = placeAirfieldLights(graph, approachAids);
    this.halos = pointHalos(this.lights.length, 1.8);
    const { centres, geometry, mesh } = this.halos;
    this.lights.forEach((l, i) => {
      centres.setXYZW(i, l.x, groundAt(l.x, l.y) + l.heightM, l.y, 2 * radiusM[l.kind]);
    });
    geometry.instanceCount = this.lights.length;
    mesh.name = 'airfield-halos';
    this.pools = buildPools(
      // Over the aircraft standing behind the nose stop.
      graph.stands.map((stand) => ({
        x: stand.pos.x - Math.cos(stand.heading) * 20,
        y: stand.pos.y - Math.sin(stand.heading) * 20,
        z: groundAt(stand.pos.x, stand.pos.y) + 0.12,
        radiusM: 34,
        color: airfieldColors.flood,
      })),
    );
    this.pools.name = 'apron-floodlight-pools';
    this.pools.matrixAutoUpdate = false;
    this.group.matrixAutoUpdate = false;
    this.group.add(mesh, this.pools);
    this.setLight(0);
  }

  /** Recolours the lights for the sim's state; true when anything changed. */
  update(state: AirfieldState | undefined, poses: readonly AircraftPose[]) {
    const colors = airfieldLightColors(
      this.graph,
      this.lights,
      state,
      papiAngles(this.graph, this.lights, poses),
    );
    let changed = false;
    const { color, byKind } = this;
    const { tints } = this.halos;
    colors.forEach((c, i) => {
      if (this.colors[i] === c) return;
      const kind = this.lights[i]!.kind;
      if (Boolean(c) !== Boolean(this.colors[i])) {
        const count = (byKind[kind] ?? 0) + (c ? 1 : -1);
        if (count) byKind[kind] = count;
        else delete byKind[kind];
      }
      color.setHex(c);
      tints.setXYZ(i, color.r, color.g, color.b);
      changed = true;
    });
    this.colors = colors;
    if (changed) tints.needsUpdate = true;
    return changed;
  }

  /** `on`: the scene's artificial light, 0 by day. */
  setLight(on: number) {
    this.on = on;
    this.group.visible = on > 0;
    this.halos.material.uniforms.intensity!.value = 1.1 * on;
    (this.pools.material as MeshBasicMaterial).opacity = 0.3 * on;
    this.pools.visible = on > 0;
  }

  setPixelScale(scale: number) {
    this.halos.material.uniforms.pixelScale!.value = scale;
  }

  /** Lit lights by kind, for tests and the canvas dataset. */
  counts() {
    return { on: this.on > 0, ...this.byKind };
  }
}
