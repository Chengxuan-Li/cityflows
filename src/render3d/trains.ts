import {
  BoxGeometry,
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Vector3,
} from 'three';
import type { RailGraph, RailHeights } from '../network/rail';
import {
  trainDefaults,
  serviceCarLengthM,
  type TrainPose,
  type TrainTrackPose,
  type TrainTimetable,
} from '../network/trains';
import { trainColors } from '../render/layers/trains';
import { style } from '../render/style';
import type { cityHeights } from './heights';
import { railElevation } from './rail';

/** TASK-163: lit passenger windows along both sides of every car, in the unit box before the
 * instance's scale (x along the car, y up, z across). */
function bodyMaterial(lights: { value: number }) {
  const material = new MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cabinLights = lights;
    shader.vertexShader =
      '#ifdef CABIN_LIGHTS\nvarying vec3 vBox; varying vec3 vBoxNormal;\n#endif\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n#ifdef CABIN_LIGHTS\nvBox = position; vBoxNormal = normal;\n#endif',
      );
    shader.fragmentShader =
      '#ifdef CABIN_LIGHTS\nuniform float cabinLights; varying vec3 vBox; varying vec3 vBoxNormal;\n#endif\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef CABIN_LIGHTS
          float pane = fract(vBox.x * 9.0 + 0.5);
          float window = step(0.5, abs(vBoxNormal.z)) * step(-0.08, vBox.y) * step(vBox.y, 0.3)
            * step(0.12, pane) * step(pane, 0.88) * step(abs(vBox.x), 0.46);
          totalEmissiveRadiance += cabinLights * window * vec3(1.15, 1.05, 0.85);
        #endif`,
      );
  };
  return material;
}

export class Trains3D {
  readonly group = new Group();
  body: InstancedMesh;
  roof: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private readonly rotation = new Euler(0, 0, 0, 'YXZ');
  private readonly roofOffset = new Vector3();
  private readonly color = new Color();
  private ids: { id: string; route: number }[] = [];
  private readonly lights = { value: 0 };
  constructor(
    private readonly rail: RailGraph,
    private readonly heights: ReturnType<typeof cityHeights>,
    private readonly railHeights: RailHeights,
    timetable: TrainTimetable,
  ) {
    const capacity = Math.max(
      1,
      timetable.departures.reduce((sum, d) => {
        const r = timetable.routes[d.route]!;
        return (
          sum +
          Math.ceil(r.durationS / timetable.periodS) *
            Math.ceil(trainDefaults[r.kind].lengthM / serviceCarLengthM(r.kind))
        );
      }, 0),
    );
    this.body = new InstancedMesh(new BoxGeometry(1, 1, 1), bodyMaterial(this.lights), capacity);
    this.roof = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: trainColors.roof }),
      capacity,
    );
    this.body.count = this.roof.count = 0;
    this.body.frustumCulled = this.roof.frustumCulled = false;
    this.group.add(this.body, this.roof);
  }
  update(trains: TrainPose[], below: boolean, selected: string | null) {
    const required = trains.reduce(
      (sum, train) =>
        sum +
        train.cars.filter((car) => below || this.railHeights.grades[car.track] !== 'tunnel').length,
      0,
    );
    if (required > this.body.instanceMatrix.count) {
      const capacity = Math.max(required, this.body.instanceMatrix.count * 2);
      const grow = (old: InstancedMesh) => {
        const mesh = new InstancedMesh(old.geometry, old.material, capacity);
        mesh.frustumCulled = false;
        this.group.remove(old);
        old.dispose();
        return mesh;
      };
      this.body = grow(this.body);
      this.roof = grow(this.roof);
      this.group.add(this.body, this.roof);
    }
    let count = 0;
    this.ids = [];
    for (const train of trains)
      for (const car of train.cars) {
        // TASK-132: only a tunnel hides a train; covered track stays at grade inside its building.
        if (!below && this.railHeights.grades[car.track] === 'tunnel') continue;
        const elevation = (p: TrainTrackPose) =>
          railElevation(this.heights, this.railHeights, this.rail.tracks[p.track]!, p.trackM, p);
        const y = elevation(car) + 1.5;
        const dx = car.front.x - car.rear.x,
          dy = car.front.y - car.rear.y;
        const direction = dx * Math.cos(car.heading) + dy * Math.sin(car.heading) < 0 ? -1 : 1;
        const pitch = Math.atan2(
          (elevation(car.front) - elevation(car.rear)) * direction,
          Math.hypot(dx, dy),
        );
        this.rotation.set(0, -car.heading, pitch, 'YXZ');
        this.matrix
          .makeRotationFromEuler(this.rotation)
          .scale(this.scale.set(car.lengthM, 2.8, train.kind === 'tram' ? 2.4 : 3))
          .setPosition(car.x, y, car.y);
        this.body.setMatrixAt(count, this.matrix);
        this.body.setColorAt(
          count,
          this.color.setHex(selected === train.id ? style.selection : trainColors[train.kind]),
        );
        this.matrix
          .makeRotationFromEuler(this.rotation)
          .scale(
            this.scale.set(Math.max(0, car.lengthM - 2), 0.15, train.kind === 'tram' ? 1.9 : 2.4),
          )
          .setPosition(
            this.roofOffset
              .set(0, 1.45, 0)
              .applyEuler(this.rotation)
              .add(new Vector3(car.x, y, car.y)),
          );
        this.roof.setMatrixAt(count, this.matrix);
        this.ids.push({ id: train.id, route: train.route });
        count++;
      }
    this.body.count = this.roof.count = count;
    this.body.instanceMatrix.needsUpdate = this.roof.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
  /** 0: the Day shader; above 0 the cabins glow with that strength. */
  setLights(level: number) {
    const material = this.body.material as MeshLambertMaterial;
    if (level > 0 !== (material.defines?.CABIN_LIGHTS !== undefined)) {
      material.defines = level > 0 ? { CABIN_LIGHTS: '' } : {};
      material.needsUpdate = true;
    }
    this.lights.value = level;
  }
  pick(index: number) {
    return { kind: 'train' as const, ...this.ids[index]! };
  }
}
