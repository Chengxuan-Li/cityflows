import {
  BoxGeometry,
  BufferGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { RailGraph, RailHeights } from '../network/rail';
import {
  trainDefaults,
  serviceCarLengthM,
  type TrainPose,
  type TrainTrackPose,
  type TrainTimetable,
} from '../network/trains';
import type { DrivingSide } from '../schema/city';
import type { cityHeights } from './heights';
import { railElevation } from './rail';
import {
  bodyGeometry,
  bodyMaterial,
  carFlags,
  carState,
  farGeometry,
  formationOf,
  gearGeometry,
  gearMaterial,
  gearSlots,
  type FormationOf,
} from './train-kit';
import { builtVariant, trainVariantFor, type TrainVariant } from './train-variants';

/** TASK-332: a car is drawn as its full model from `enter` pixels along its length and back as
 * the far box below `leave`; the gap keeps a car from flickering between them. */
export const trainLodPixels = { enter: 60, leave: 48 } as const;
const near = 0,
  far = 1;

/** One variant's meshes, shared by all its trains: the near body and gear (sharing instance
 * matrices) and the far box. */
interface VariantMeshes {
  formation: FormationOf;
  material: MeshLambertMaterial;
  gearMaterial: MeshLambertMaterial;
  body: InstancedMesh;
  gear: InstancedMesh;
  far: InstancedMesh;
  capacity: number;
  /** Cars of this variant in the last update. */
  total: number;
}

/** Copies without the view `subarray` would allocate per car and frame. */
function copy(from: Float32Array, i: number, to: Float32Array, j: number, n: number) {
  for (let k = 0; k < n; k++) to[j + k] = from[i + k]!;
}

const carAttribute = (capacity: number) => {
  const attribute = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  attribute.setUsage(DynamicDrawUsage);
  return attribute;
};

/** TASK-332: trains drawn with the model kit, one set of meshes per variant in use. Picking uses
 * an undrawn box per car (`pickMesh`), the same at both levels. */
export class Trains3D {
  readonly group = new Group();
  /** Undrawn boxes over every shown car, for picking; its instances follow `pick`. */
  pickMesh: InstancedMesh;
  readonly variants: VariantMeshes[] = [];
  private readonly routeVariant: number[];
  private readonly lights = { value: 0 };
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private readonly rotation = new Euler(0, 0, 0, 'YXZ');
  /** Staged cars of the last update: matrix, `aCar`, gear slots, variant and level. */
  private count = 0;
  private stageCapacity = 0;
  private matrices = new Float32Array(0);
  private cars = new Float32Array(0);
  private gears = new Float32Array(0);
  private variantOf = new Uint8Array(0);
  private levelOf: Uint8Array[] = [];
  private levelAt = new Uint16Array(0);
  private picked: TrainPose[] = [];
  /** Per train, its cars' levels; dropped when the train is gone. */
  private readonly levels = new Map<string, { generation: number; levels: Uint8Array }>();
  private generation = 0;
  private readonly prune = (entry: { generation: number }, id: string) => {
    if (entry.generation !== this.generation) this.levels.delete(id);
  };

  constructor(
    private readonly rail: RailGraph,
    private readonly heights: ReturnType<typeof cityHeights>,
    private readonly railHeights: RailHeights,
    private readonly timetable: TrainTimetable,
    drivingSide: DrivingSide,
  ) {
    const used = new Map<TrainVariant, number>();
    this.routeVariant = timetable.routes.map((route) => {
      const variant = builtVariant(trainVariantFor(route, rail, drivingSide));
      if (!used.has(variant)) used.set(variant, used.size);
      return used.get(variant)!;
    });
    const capacities = new Array<number>(used.size).fill(0);
    for (const d of timetable.departures) {
      const r = timetable.routes[d.route]!;
      capacities[this.routeVariant[d.route]!]! +=
        Math.ceil(r.durationS / timetable.periodS) *
        Math.ceil(trainDefaults[r.kind].lengthM / serviceCarLengthM(r.kind));
    }
    for (const [variant, i] of used) {
      const material = bodyMaterial(variant, this.lights);
      const meshes: VariantMeshes = {
        formation: formationOf(variant),
        material,
        gearMaterial: gearMaterial(),
        body: new InstancedMesh(bodyGeometry(variant), material, 1),
        gear: new InstancedMesh(gearGeometry(variant), gearMaterial(), 1),
        far: new InstancedMesh(farGeometry(variant), material, 1),
        capacity: 0,
        total: 0,
      };
      meshes.gear.material = meshes.gearMaterial;
      this.variants.push(meshes);
      this.grow(meshes, Math.max(1, capacities[i]!));
    }
    this.pickMesh = this.pickBoxes(
      Math.max(
        1,
        capacities.reduce((a, b) => a + b, 0),
      ),
    );
    this.group.add(this.pickMesh);
  }

  private pickBoxes(capacity: number) {
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshBasicMaterial(),
      capacity,
    );
    mesh.visible = false;
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** (Re)creates a variant's meshes for `capacity` cars at each level. */
  private grow(m: VariantMeshes, capacity: number) {
    const make = (old: InstancedMesh, gear = false) => {
      const geometry = old.geometry as BufferGeometry;
      geometry.dispose();
      if (gear) {
        geometry.setAttribute('aGear0', carAttribute(capacity));
        geometry.setAttribute('aGear1', carAttribute(capacity));
      } else geometry.setAttribute('aCar', carAttribute(capacity));
      const mesh = new InstancedMesh(geometry, old.material, capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.remove(old);
      old.dispose();
      this.group.add(mesh);
      return mesh;
    };
    m.body = make(m.body);
    m.gear = make(m.gear, true);
    m.gear.instanceMatrix = m.body.instanceMatrix;
    m.far = make(m.far);
    m.capacity = capacity;
  }

  private stage(capacity: number) {
    const grow = <T extends Float32Array | Uint8Array | Uint16Array>(old: T, size: number) => {
      const next = new (old.constructor as new (n: number) => T)(capacity * size);
      next.set(old);
      return next;
    };
    this.matrices = grow(this.matrices, 16);
    this.cars = grow(this.cars, 4);
    this.gears = grow(this.gears, 8);
    this.variantOf = grow(this.variantOf, 1);
    this.levelAt = grow(this.levelAt, 1);
    this.stageCapacity = capacity;
  }

  update(trains: TrainPose[], below: boolean, selected: string | null) {
    this.generation++;
    this.count = 0;
    this.picked.length = 0;
    for (const m of this.variants) m.total = 0;
    for (const train of trains) {
      const route = this.timetable.routes[train.route]!,
        v = this.routeVariant[train.route]!,
        meshes = this.variants[v]!;
      const length = trainDefaults[route.kind].lengthM,
        n = Math.ceil(length / serviceCarLengthM(route.kind)),
        pitch = length / n,
        fullPoseLengthM = pitch - 0.7;
      const lead = train.cars[0];
      if (!lead) continue;
      // The sim turns a car's heading round after a terminal's turn; front and rear stay in the
      // route's direction.
      const reversed =
        (lead.front.x - lead.rear.x) * Math.cos(lead.heading) +
          (lead.front.y - lead.rear.y) * Math.sin(lead.heading) <
        0;
      // Cars clipped at the map's edge are missing from `cars`: find the first one shown, as
      // `trainPoseAt` decides it.
      let first = 0;
      if (train.cars.length < n)
        while (first < n) {
          const at = train.positionM + (reversed ? -1 : 1) * (length / 2 - pitch * (first + 0.5));
          if (Math.min(route.lengthM, at + pitch / 2) - Math.max(0, at - pitch / 2) > 0.7) break;
          first++;
        }
      let entry = this.levels.get(train.id);
      if (!entry || entry.levels.length < n) {
        entry = { generation: 0, levels: new Uint8Array(n).fill(far) };
        this.levels.set(train.id, entry);
      }
      entry.generation = this.generation;
      for (let k = 0; k < train.cars.length; k++) {
        const car = train.cars[k]!;
        // TASK-132: only a tunnel hides a train; covered track stays at grade inside its building.
        if (!below && this.railHeights.grades[car.track] === 'tunnel') continue;
        if (this.count === this.stageCapacity) this.stage(Math.max(64, this.stageCapacity * 2));
        const i = this.count++,
          travel = first + k,
          j = reversed ? n - 1 - travel : travel;
        const turn = carState(
          meshes.formation,
          n,
          j,
          car.lengthM,
          reversed,
          selected === train.id,
          this.cars,
          i * 4,
          this.gears,
          i * 8,
          fullPoseLengthM,
        );
        const y = this.elevation(car);
        const dx = car.front.x - car.rear.x,
          dy = car.front.y - car.rear.y;
        const direction = dx * Math.cos(car.heading) + dy * Math.sin(car.heading) < 0 ? -1 : 1;
        const pitchRad = Math.atan2(
          (this.elevation(car.front) - this.elevation(car.rear)) * direction,
          Math.hypot(dx, dy),
        );
        this.rotation.set(0, -car.heading - (turn ? Math.PI : 0), turn ? -pitchRad : pitchRad);
        this.matrix.makeRotationFromEuler(this.rotation).setPosition(car.x, y, car.y);
        const shift = this.gears[i * 8 + gearSlots.bodyOffset]!;
        if (shift !== 0) {
          // Shift along the drawn car's axis, including the track pitch, before staging and picking.
          const m = this.matrix.elements;
          this.matrix.setPosition(car.x + shift * m[0]!, y + shift * m[1]!, car.y + shift * m[2]!);
        }
        this.matrix.toArray(this.matrices, i * 16);
        const variant = meshes.formation.variant;
        this.matrix.scale(this.scale.set(this.cars[i * 4]! * 2, variant.heightM, variant.widthM));
        if (i >= this.pickMesh.instanceMatrix.count) {
          this.group.remove(this.pickMesh);
          this.pickMesh.dispose();
          this.pickMesh = this.pickBoxes(Math.max(this.stageCapacity, i + 1));
          this.group.add(this.pickMesh);
          for (let p = 0; p < i; p++) this.pickMatrix(p);
        }
        this.pickMesh.setMatrixAt(i, this.matrix);
        this.variantOf[i] = v;
        this.levelOf[i] = entry.levels;
        this.levelAt[i] = travel;
        this.picked.push(train);
        meshes.total++;
      }
    }
    this.levelOf.length = this.count;
    this.levels.forEach(this.prune);
    this.pickMesh.count = this.count;
    this.pickMesh.instanceMatrix.needsUpdate = true;
    this.assign();
  }

  private elevation(p: TrainTrackPose) {
    return railElevation(this.heights, this.railHeights, this.rail.tracks[p.track]!, p.trackM, p);
  }

  /** Restores a pick box from the staged matrix after the pick mesh grew. */
  private pickMatrix(i: number) {
    const v = this.variants[this.variantOf[i]!]!.formation.variant;
    this.matrix.fromArray(this.matrices, i * 16);
    this.matrix.scale(this.scale.set(this.cars[i * 4]! * 2, v.heightM, v.widthM));
    this.pickMesh.setMatrixAt(i, this.matrix);
  }

  /** Each car's level by its on-screen length (`scale`: metres per pixel at unit depth). */
  setDetail(camera: PerspectiveCamera, scale: number) {
    const view = camera.matrixWorldInverse.elements;
    let changed = false;
    for (let i = 0; i < this.count; i++) {
      const o = i * 16,
        x = this.matrices[o + 12]!,
        y = this.matrices[o + 13]! + 2,
        z = this.matrices[o + 14]!;
      const depth = -(view[2]! * x + view[6]! * y + view[10]! * z + view[14]!);
      // A car behind the camera is never seen near.
      const px = depth > 0 ? (2 * this.cars[i * 4]!) / (Math.max(depth, 1) * scale) : 0;
      const levels = this.levelOf[i]!,
        k = this.levelAt[i]!,
        current = levels[k]!;
      const level =
        px >= (current === near ? trainLodPixels.leave : trainLodPixels.enter) ? near : far;
      if (level !== current) {
        levels[k] = level;
        changed = true;
      }
    }
    if (changed) this.assign();
  }

  /** Copies the staged cars into each variant's near or far meshes. */
  private assign() {
    for (const m of this.variants) {
      if (m.total > m.capacity) this.grow(m, Math.max(m.total, m.capacity * 2));
      m.body.count = m.far.count = 0;
    }
    for (let i = 0; i < this.count; i++) {
      const m = this.variants[this.variantOf[i]!]!;
      const level = this.levelOf[i]![this.levelAt[i]!]!;
      const mesh = level === near ? m.body : m.far,
        at = mesh.count++;
      copy(this.matrices, i * 16, mesh.instanceMatrix.array as Float32Array, at * 16, 16);
      const car = mesh.geometry.getAttribute('aCar').array as Float32Array;
      copy(this.cars, i * 4, car, at * 4, 4);
      if (level === near) {
        const gear0 = m.gear.geometry.getAttribute('aGear0').array as Float32Array,
          gear1 = m.gear.geometry.getAttribute('aGear1').array as Float32Array;
        copy(this.gears, i * 8, gear0, at * 4, 4);
        copy(this.gears, i * 8 + 4, gear1, at * 4, 4);
      } else {
        // The far box has no noses: its ends are its fronts.
        car[at * 4 + 2] = car[at * 4 + 2]! & ~(carFlags.cabFront | carFlags.cabRear);
      }
    }
    for (const m of this.variants) {
      m.gear.count = m.body.count;
      m.body.visible = m.gear.visible = m.body.count > 0;
      m.far.visible = m.far.count > 0;
      m.body.instanceMatrix.needsUpdate = m.far.instanceMatrix.needsUpdate = true;
      m.body.geometry.getAttribute('aCar').needsUpdate = true;
      m.far.geometry.getAttribute('aCar').needsUpdate = true;
      m.gear.geometry.getAttribute('aGear0').needsUpdate = true;
      m.gear.geometry.getAttribute('aGear1').needsUpdate = true;
    }
  }

  /** Cars drawn at each level, per variant id. */
  counts() {
    return this.variants.map((m) => ({
      variant: m.formation.variant.id,
      near: m.body.count,
      far: m.far.count,
    }));
  }

  /** 0: the Day shader; above 0 the cabins and lamps glow with that strength. */
  setLights(level: number) {
    for (const { material } of this.variants)
      if (level > 0 !== (material.defines?.CABIN_LIGHTS !== undefined)) {
        material.defines = level > 0 ? { CABIN_LIGHTS: '' } : {};
        material.needsUpdate = true;
      }
    this.lights.value = level;
  }

  pick(index: number) {
    const train = this.picked[index]!;
    return { kind: 'train' as const, id: train.id, route: train.route };
  }
}
