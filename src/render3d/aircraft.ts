import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  BackSide,
  type PerspectiveCamera,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { aircraftTypes, type AircraftType } from '../schema/aircraft';
import { buildAircraftOutline } from '../render/aircraft-outline';
import {
  aircraftAccent,
  aircraftFlash,
  aircraftLights,
  type AircraftLightState,
} from '../render/airfield-lights';
import type { AircraftPose, Pick } from '../render/types';
import { batchAircraftMesh, buildAircraftMesh, type AircraftMesh } from './aircraft-mesh';
import { beamTexture } from './lights';
import { pointHalos } from './airfield-lights';

// TASK-298: TASK-307's aircraft models placed from the sim's poses: on the airside, and on the
// approaches and climbs over the empty surround beyond the map. Heights are above the airfield's
// elevation; the attitude is a plain pitch by state.
// TASK-301: driven by the same poses: a per-flight accent colour, propellers and rotors spinning
// up while the engines run, gear by the sim, navigation, beacon, strobe, landing and taxi lights,
// and, to read against the near-white surround, a thin dark outline and, off the ground, a
// shadow straight below with a drop line. Positions run on between snapshots at the velocity
// of the last two, so a followed aircraft moves smoothly.

const pitchDeg: Partial<Record<string, number>> = {
  approach: 2,
  flare: 4,
  rotation: 6,
  climb: 8,
  'go-around': 8,
};

/** Spin rates at full power, rad/s: slow enough to read as turning at 60 frames a second. */
const SPIN = { propeller: 19, rotor: 11, tailRotor: 31 };
const lightColors = {
  red: 0xff2a1e,
  green: 0x2eff6e,
  white: 0xffffff,
  landing: 0xfff6e6,
} as const;

interface Model {
  mesh: AircraftMesh;
  type: AircraftType;
  radiusM: number;
  shadow: Mesh<ShapeGeometry, MeshBasicMaterial>;
  drop: Line<BufferGeometry, LineBasicMaterial>;
  discs: Mesh<CircleGeometry, MeshBasicMaterial>[];
  pose: AircraftPose;
  timeS: number;
  velocity: { x: number; y: number; h: number };
  lights: AircraftLightState;
  /** 0 to 1: how far the propellers and rotors have spun up. */
  spin: number;
}

/** A thin dark rim in screen pixels: the back faces pushed out along their normals. */
function outlineMaterial() {
  const material = new ShaderMaterial({
    uniforms: {
      pixelScale: { value: 0.001 },
      widthPx: { value: 1.1 },
      color: { value: new Color(0x2f3a46) },
    },
    vertexShader: `
      uniform float pixelScale;
      uniform float widthPx;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz += normalize(normalMatrix * normal) * widthPx * pixelScale * -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      void main() {
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
    side: BackSide,
  });
  material.userData.lit = true;
  return material;
}

export class Aircraft3D {
  readonly group = new Group();
  private readonly models = new Map<number, Model>();
  private readonly outline = outlineMaterial();
  private readonly halos = pointHalos(512, 1.6, 2);
  private readonly beams: InstancedMesh;
  private readonly shadowShapes = new Map<string, ShapeGeometry>();
  private readonly transform = new Object3D();
  private readonly point = new Vector3();
  private readonly color = new Color();
  private renderedAgeS = NaN;
  private clockS = 0;
  private on = 0;
  constructor(private readonly elevationM: number) {
    this.group.name = 'aircraft';
    this.halos.mesh.name = 'aircraft-lights';
    this.halos.centres.setUsage(DynamicDrawUsage);
    const beamMaterial = new MeshBasicMaterial({
      map: beamTexture(),
      color: lightColors.landing,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    beamMaterial.userData.lit = true;
    this.beams = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), beamMaterial, 32);
    this.beams.name = 'aircraft-beams';
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    this.beams.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.matrixAutoUpdate = false;
    this.beams.matrixAutoUpdate = false;
    this.group.add(this.halos.mesh, this.beams);
    this.setLight(0);
  }

  private shadowShape(type: AircraftType) {
    let geometry = this.shadowShapes.get(type.id);
    if (!geometry) {
      const shapes = buildAircraftOutline(type).flatMap((part) =>
        'points' in part
          ? [new ShapeGeometry(new Shape(part.points.map((p) => new Vector2(p.x, p.y))))]
          : [],
      );
      geometry = (mergeGeometries(shapes) as ShapeGeometry).rotateX(Math.PI / 2);
      for (const shape of shapes) shape.dispose();
      this.shadowShapes.set(type.id, geometry);
    }
    return geometry;
  }

  private build(pose: AircraftPose): Model {
    const type = aircraftTypes.find((t) => t.id === pose.typeId)!;
    const mesh = buildAircraftMesh(type, aircraftAccent(pose.registration));
    mesh.root.userData.aircraft = pose.id;
    const discs = [...mesh.propellers, ...mesh.rotors].map((spinner) => {
      let radius = 0;
      spinner.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.computeBoundingSphere();
          radius = Math.max(radius, o.geometry.boundingSphere!.radius);
        }
      });
      const disc = new Mesh(
        new CircleGeometry(radius, 24).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({
          color: 0x4d5964,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      disc.material.userData.lit = true;
      disc.position.copy(spinner.position);
      disc.visible = false;
      spinner.parent!.add(disc);
      return disc;
    });
    batchAircraftMesh(mesh, this.outline);
    const shadow = new Mesh(
      this.shadowShape(type),
      new MeshBasicMaterial({
        color: 0x1b2430,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      }),
    );
    shadow.material.userData.lit = true;
    shadow.renderOrder = 4;
    const drop = new Line(
      new BufferGeometry().setAttribute(
        'position',
        new Float32BufferAttribute(new Float32Array(6), 3),
      ),
      new LineBasicMaterial({ color: 0x1b2430, transparent: true, opacity: 0.35 }),
    );
    drop.material.userData.lit = true;
    drop.frustumCulled = false;
    this.group.add(mesh.root, shadow, drop);
    return {
      mesh,
      type,
      radiusM: Math.hypot(type.lengthM, type.spanM) / 2,
      shadow,
      drop,
      discs,
      pose,
      timeS: NaN,
      velocity: { x: 0, y: 0, h: 0 },
      lights: aircraftLights(pose),
      spin: pose.enginesRunning ? 1 : 0,
    };
  }

  update(poses: readonly AircraftPose[], timeS: number) {
    this.renderedAgeS = NaN;
    const seen = new Set<number>();
    for (const pose of poses) {
      seen.add(pose.id);
      let model = this.models.get(pose.id);
      if (!model) this.models.set(pose.id, (model = this.build(pose)));
      const dt = timeS - model.timeS;
      const previous = model.pose;
      if (dt !== 0) {
        model.velocity =
          dt > 0 && dt < 5
            ? {
                x: (pose.x - previous.x) / dt,
                y: (pose.y - previous.y) / dt,
                h: (pose.heightM - previous.heightM) / dt,
              }
            : { x: 0, y: 0, h: 0 };
        model.timeS = timeS;
      }
      model.pose = pose;
      model.lights = aircraftLights(pose);
      model.mesh.gear.visible = pose.gearDown;
    }
    for (const [id, model] of this.models)
      if (!seen.has(id)) {
        model.mesh.root.removeFromParent();
        model.shadow.removeFromParent();
        model.drop.removeFromParent();
        model.mesh.root.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.geometry.dispose();
          if (!object.userData.outline) (object.material as MeshLambertMaterial).dispose();
          if (object instanceof InstancedMesh) object.dispose();
        });
        model.shadow.material.dispose();
        model.drop.geometry.dispose();
        model.drop.material.dispose();
        this.models.delete(id);
      }
  }

  /** Places every aircraft `ageS` simulated seconds after its snapshot and advances spinning
   * parts and flashing lights by `dtS` wall seconds (0 while paused). */
  animate(ageS: number, dtS: number) {
    if (ageS === this.renderedAgeS && dtS === 0) return;
    this.renderedAgeS = ageS;
    this.clockS += dtS;
    const ahead = Math.min(ageS, 2);
    const { transform, point, color } = this;
    const { centres, tints, geometry } = this.halos;
    let halo = 0,
      beam = 0;
    const addHalo = (matrix: Matrix4, mount: readonly number[], radiusM: number, hex: number) => {
      if (halo >= centres.count) return;
      point.set(mount[0]!, mount[1]!, mount[2]!).applyMatrix4(matrix);
      centres.setXYZW(halo, point.x, point.y, point.z, 2 * radiusM);
      color.setHex(hex);
      tints.setXYZ(halo++, color.r, color.g, color.b);
    };
    for (const model of this.models.values()) {
      const { pose, velocity, mesh, lights } = model;
      const x = pose.x + velocity.x * ahead,
        y = pose.y + velocity.y * ahead,
        heightM = Math.max(0, pose.heightM + velocity.h * ahead);
      const root = mesh.root;
      root.position.set(x, this.elevationM + heightM, y);
      root.rotation.set(0, -pose.heading, ((pitchDeg[pose.state] ?? 0) * Math.PI) / 180, 'YXZ');
      root.updateMatrix();
      const matrix = root.matrix;
      // Shadow and drop line, off the ground: darker the lower it flies.
      const airborne = heightM > 1.5;
      model.shadow.visible = model.drop.visible = airborne;
      if (airborne) {
        model.shadow.position.set(x, this.elevationM + 0.15, y);
        model.shadow.rotation.set(0, -pose.heading, 0);
        model.shadow.material.opacity =
          0.34 * Math.max(0.35, 1 - heightM / 1200) * (1 - 0.6 * this.on);
        const line = model.drop.geometry.getAttribute('position') as Float32BufferAttribute;
        line.setXYZ(0, x, this.elevationM + 0.15, y);
        line.setXYZ(1, x, this.elevationM + heightM, y);
        line.needsUpdate = true;
      }
      // Spinning parts follow the engines, spooling up and down over a couple of seconds.
      model.spin += ((pose.enginesRunning ? 1 : 0) - model.spin) * Math.min(1, dtS / 1.5);
      for (const propeller of mesh.propellers)
        propeller.rotation.y += SPIN.propeller * model.spin * dtS;
      mesh.rotors.forEach((rotor, i) => {
        rotor.rotation.y += (i === 0 ? SPIN.rotor : SPIN.tailRotor) * model.spin * dtS;
      });
      for (const disc of model.discs) {
        disc.visible = model.spin > 0.3;
        disc.material.opacity = 0.2 * model.spin;
      }
      // Lights at TASK-307's mounts.
      const m = mesh.lightMounts;
      const flash = aircraftFlash(this.clockS, pose.id);
      if (lights.nav) {
        addHalo(matrix, m.navLeft, 0.7, lightColors.red);
        addHalo(matrix, m.navRight, 0.7, lightColors.green);
        addHalo(matrix, m.navTail, 0.6, lightColors.white);
      }
      if (lights.beacon && flash.beacon) addHalo(matrix, m.beacon, 1.3, lightColors.red);
      if (lights.strobes && flash.strobe)
        for (const s of m.strobes) addHalo(matrix, s, 2.8, lightColors.white);
      if (lights.landing) for (const l of m.landing) addHalo(matrix, l, 2.4, lightColors.landing);
      if (lights.taxi) addHalo(matrix, m.taxi, 1.1, lightColors.landing);
      // Beams on the ground ahead of the nose: taxi lights, and landing lights near the ground.
      const lit = (lights.taxi && heightM < 1) || (lights.landing && heightM < 30);
      if (this.on > 0 && lit && beam < this.beams.instanceMatrix.count) {
        const length = lights.landing ? 150 : 45,
          width = lights.landing ? 46 : 22;
        const c = Math.cos(pose.heading),
          s = Math.sin(pose.heading);
        const from = model.type.lengthM / 2;
        transform.position.set(
          x + c * (from + length / 2),
          this.elevationM + 0.2,
          y + s * (from + length / 2),
        );
        transform.rotation.set(0, -pose.heading, 0);
        transform.scale.set(length, 1, width);
        transform.updateMatrix();
        this.beams.setMatrixAt(beam++, transform.matrix);
      }
    }
    geometry.instanceCount = halo;
    if (halo) centres.needsUpdate = tints.needsUpdate = true;
    this.beams.count = beam;
    if (beam) this.beams.instanceMatrix.needsUpdate = true;
  }

  /** `on`: the scene's artificial light. Aircraft lights shine by day too, dimmer. */
  setLight(on: number) {
    if (this.on !== on) this.renderedAgeS = NaN;
    this.on = on;
    this.halos.material.uniforms.intensity!.value = 0.45 + 0.75 * on;
    (this.beams.material as MeshBasicMaterial).opacity = 0.45 * on;
  }

  setPixelScale(scale: number) {
    this.halos.material.uniforms.pixelScale!.value = scale;
    this.outline.uniforms.pixelScale!.value = scale;
  }

  /** Cabin panes are at most 54 cm across on fixed-wing aircraft. Omit the rows when
   * even the near side of the aircraft projects each pane to less than a tenth of a pixel. */
  setDetail(camera: PerspectiveCamera, scale: number) {
    const view = camera.matrixWorldInverse.elements;
    for (const { mesh, type, radiusM } of this.models.values()) {
      if (type.class === 'helicopter') continue;
      const { x, y, z } = mesh.root.position;
      const depth = -(view[2]! * x + view[6]! * y + view[10]! * z + view[14]!);
      const detailed = (depth - radiusM) * scale < 5.4;
      for (const row of mesh.windowRows) row.visible = detailed;
    }
  }

  /** Where an aircraft is drawn now, or null. */
  positionOf(id: number) {
    return this.models.get(id)?.mesh.root.position ?? null;
  }

  /** Whether anything moves or flashes, so the scene keeps drawing frames. */
  get animating() {
    return this.models.size > 0;
  }

  get count() {
    return this.models.size;
  }

  /** Lit aircraft lights by kind, and spinning parts, for tests and the canvas dataset. */
  report() {
    const lights = { nav: 0, beacon: 0, strobes: 0, landing: 0, taxi: 0 };
    let spinning = 0,
      gearDown = 0,
      shadows = 0;
    for (const model of this.models.values()) {
      for (const key of Object.keys(lights) as (keyof typeof lights)[])
        if (model.lights[key]) lights[key]++;
      if (model.spin > 0.3 && model.mesh.propellers.length + model.mesh.rotors.length) spinning++;
      if (model.mesh.gear.visible) gearDown++;
      if (model.shadow.visible) shadows++;
    }
    return { lights, spinning, gearDown, shadows };
  }

  pick(
    camera: PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Pick | null {
    if (!this.models.size) return null;
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2((2 * x) / width - 1, 1 - (2 * y) / height), camera);
    const roots = [...this.models.values()].map((m) => m.mesh.root);
    const hit = raycaster.intersectObjects(roots, true).find((h) => !h.object.userData.outline);
    for (let object: Object3D | null = hit?.object ?? null; object; object = object.parent)
      if (object.userData.aircraft !== undefined)
        return { kind: 'aircraft', id: object.userData.aircraft as number };
    // A distant aircraft is a few pixels across: the nearest within 12 px of the pointer.
    let best: Pick | null = null,
      bestPx = 12;
    const p = new Vector3();
    for (const [id, model] of this.models) {
      p.copy(model.mesh.root.position).project(camera);
      if (p.z > 1) continue;
      const px = Math.hypot(((p.x + 1) * width) / 2 - x, ((1 - p.y) * height) / 2 - y);
      if (px < bestPx) [best, bestPx] = [{ kind: 'aircraft', id }, px];
    }
    return best;
  }
}
