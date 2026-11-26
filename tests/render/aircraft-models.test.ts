import { readFile } from 'node:fs/promises';
import {
  Box3,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Triangle,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { aircraftLivery, type AircraftLivery } from '../../src/render/aircraft-livery';
import { boardingDoor, modelSection } from '../../src/render/aircraft-outline';
import type { AircraftPose } from '../../src/render/types';
import { Aircraft3D } from '../../src/render3d/aircraft';
import { gearBudget, gearLayout, tyreBands } from '../../src/render3d/aircraft-mesh';
import {
  AircraftModels,
  lodPixels,
  modelBody,
  modelGear,
  modelInfo,
  selectLod,
  type AircraftModel,
} from '../../src/render3d/aircraft-models';
import { aircraftTypes } from '../../src/schema/aircraft';
import { fixedWingGearStations } from '../../src/sim/aircraft-motion';
import { cabinSpan, cabinWindows } from '../../bench/aircraft-models';

// TASK-318: the real aircraft models, read from the committed files as the browser fetches them.

const readModel = async (file: string) => {
  const data = await readFile(`fixtures/aircraft/${file}`);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
};
const loader = new AircraftModels(readModel);
const mapped = aircraftTypes.filter((type) => modelInfo(type.id));

async function load(id: string) {
  const type = aircraftTypes.find((t) => t.id === id)!;
  await loader.load(id, type.lengthM, 1);
  return (await loader.load(id, type.lengthM, 0))!;
}

/** Every vertex of a level, its spinning parts placed on their mounts. */
function points(model: AircraftModel, lod: 0 | 1) {
  const out: Vector3[] = [];
  const level = model.lods[lod]!;
  for (const { geometry } of level.parts) {
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) out.push(new Vector3().fromBufferAttribute(p, i));
  }
  const spun: { kind: string; hub: Vector3; local: Vector3[] }[] = [];
  for (const { kind, matrix, geometry } of level.spinners) {
    const p = geometry.getAttribute('position');
    const local: Vector3[] = [];
    for (let i = 0; i < p.count; i++) {
      local.push(new Vector3().fromBufferAttribute(p, i));
      out.push(local.at(-1)!.clone().applyMatrix4(matrix));
    }
    spun.push({ kind, hub: new Vector3().setFromMatrixPosition(matrix), local });
  }
  return { all: out, spun };
}

function bodyMesh(model: AircraftModel) {
  const mesh = new Mesh(
    modelBody(model, 0, aircraftLivery('G-TEST')) as BufferGeometry,
    new MeshBasicMaterial({ side: DoubleSide }),
  );
  mesh.updateMatrixWorld();
  return mesh;
}

describe('the common types have real models', () => {
  it('maps the owner list and leaves the rest procedural', () => {
    expect(mapped.map((t) => t.id).sort()).toEqual(
      [
        'A139',
        'A20N',
        'A21N',
        'A333',
        'A359',
        'A388',
        'AT76',
        'B738',
        'B748',
        'B77W',
        'B789',
        'BCS3',
        'C25C',
        'CRJ9',
        'DH8D',
        'E175',
        'E190',
        'EC45',
      ].sort(),
    );
    for (const id of ['SF34', 'PC24', 'GLF6']) expect(modelInfo(id)).toBeNull();
  });

  it.each(mapped)(
    '$name loads both levels at its catalogue length and span',
    async (type) => {
      const model = await load(type.id);
      const [near, middle] = model.lods;
      expect(near!.triangles).toBeGreaterThan(10_000);
      expect(near!.triangles).toBeLessThanOrEqual(15_000);
      expect(middle!.triangles).toBeGreaterThan(1_000);
      expect(middle!.triangles).toBeLessThanOrEqual(2_000);
      for (const lod of [0, 1] as const) {
        const { all, spun } = points(model, lod);
        const box = new Box3().setFromPoints(all);
        if (type.class === 'helicopter') {
          // Length from the tail to the main rotor disc's front; span: the disc's diameter.
          const rotor = spun.find((s) => s.kind === 'rotor')!;
          const radius = Math.max(...rotor.local.map((p) => Math.hypot(p.x, p.z)));
          expect(2 * radius).toBeCloseTo(type.spanM, 0);
          expect(Math.abs(2 * radius - type.spanM) / type.spanM).toBeLessThan(0.02);
          const length = rotor.hub.x + radius - box.min.x;
          expect(Math.abs(length - type.lengthM) / type.lengthM).toBeLessThan(0.02);
          expect(spun.filter((s) => s.kind === 'tail-rotor')).toHaveLength(1);
        } else {
          expect(Math.abs(box.max.x - box.min.x - type.lengthM) / type.lengthM).toBeLessThan(0.02);
          expect(Math.abs(box.max.z - box.min.z - type.spanM) / type.spanM).toBeLessThan(0.02);
          // Centred along the length and on the plane of symmetry, nose forward.
          expect(Math.abs(box.max.x + box.min.x) / type.lengthM).toBeLessThan(0.02);
          expect(Math.abs(box.max.z + box.min.z) / type.spanM).toBeLessThan(0.02);
          expect(spun.filter((s) => s.kind === 'propeller')).toHaveLength(
            type.class === 'propeller' ? type.engines.count : 0,
          );
        }
        // Clear of the ground: the procedural landing gear carries it.
        expect(box.min.y).toBeGreaterThan(0);
      }
    },
    30_000,
  );

  it.each(mapped)('$name has its light mounts on the model', async (type) => {
    const model = await load(type.id);
    const { navLeft, navRight, navTail, beacon, strobes, taxi } = model.info.lights;
    expect(navLeft[2]).toBeLessThan(0);
    expect(navRight[2]).toBe(-navLeft[2]);
    if (type.class !== 'helicopter')
      expect(Math.abs(navRight[2] - type.spanM / 2) / type.spanM).toBeLessThan(0.02);
    expect(strobes.map((p) => p[2])).toEqual([navLeft[2], navRight[2]]);
    expect(navTail[0]).toBeLessThan(-0.4 * type.lengthM);
    expect(beacon[1]).toBeGreaterThan(taxi[1]);
    // On the surface: within 40 cm of the nearest triangle.
    const surface = modelBody(model, 0, aircraftLivery('G-TEST')).getAttribute('position');
    const triangle = new Triangle();
    const closest = new Vector3();
    for (const mount of [navRight, navTail, beacon]) {
      const at = new Vector3(...mount);
      let best = Infinity;
      for (let i = 0; i < surface.count; i += 3) {
        triangle.setFromAttributeAndIndices(surface, i, i + 1, i + 2);
        best = Math.min(best, triangle.closestPointToPoint(at, closest).distanceTo(at));
      }
      expect(best).toBeLessThan(0.4);
    }
  });
});

it('docks the jet bridge at the real fuselage side', async () => {
  for (const id of ['B738', 'A333', 'B77W']) {
    const type = aircraftTypes.find((t) => t.id === id)!;
    const model = await load(id);
    const door = boardingDoor(type);
    const hit = new Raycaster(
      new Vector3(door.x, door.sillM + 0.9, -20),
      new Vector3(0, 0, 1),
    ).intersectObject(bodyMesh(model))[0]!;
    expect(Math.abs(hit.point.z - door.z)).toBeLessThan(0.12);
  }
});

it('paints the livery onto the fuselage, fin and engines', async () => {
  const model = await load('B738');
  const key = (c: Color) => [c.r, c.g, c.b].map((v) => v.toFixed(3)).join();
  const schemes = new Map<string, AircraftLivery>();
  for (let i = 0; schemes.size < 5 && i < 200; i++) {
    const livery = aircraftLivery(`G-T${i}`);
    schemes.set(`${livery.style}:${livery.trim}`, livery);
  }
  for (const livery of schemes.values()) {
    const body = modelBody(model, 0, livery);
    expect(modelBody(model, 0, livery)).toBe(body);
    const colors = body.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < colors.count; i++)
      seen.add(key(new Color(colors.getX(i), colors.getY(i), colors.getZ(i))));
    expect(seen.has(key(new Color(livery.tail)))).toBe(true);
    // Pinstripes are cast strips, drawn only where the scheme has them.
    if (livery.trim !== null && livery.style !== 'crown' && livery.style !== 'tail')
      expect(seen.has(key(new Color(livery.trim)))).toBe(true);
    expect(model.lods[0]!.parts.some((p) => p.name === 'band-cheatline')).toBe(true);
  }
});

it('switches levels by on-screen size, with hysteresis', () => {
  const [near, middle] = lodPixels;
  expect(selectLod(2, middle.enter - 0.1)).toBe(2);
  expect(selectLod(2, middle.enter)).toBe(1);
  expect(selectLod(1, middle.leave)).toBe(1);
  expect(selectLod(1, middle.leave - 0.1)).toBe(2);
  expect(selectLod(1, near.enter - 0.1)).toBe(1);
  expect(selectLod(1, near.enter)).toBe(0);
  expect(selectLod(0, near.leave)).toBe(0);
  expect(selectLod(0, near.leave - 0.1)).toBe(1);
  expect(selectLod(0, middle.leave - 0.1)).toBe(2);
  expect(selectLod(2, near.enter)).toBe(0);
});

it('draws a mapped type by level as the camera moves and keeps the rest procedural', async () => {
  let loads = 0;
  const models = new AircraftModels(readModel);
  const aircraft = new Aircraft3D(0, models, () => loads++);
  const pose = (id: number, typeId: string, x: number): AircraftPose => ({
    id,
    registration: `G-T${id}`,
    typeId,
    x,
    y: 0,
    heightM: 0,
    heading: 0,
    speedMps: 0,
    state: 'parked',
    enginesRunning: false,
    onRunway: false,
    airborne: false,
    gearDown: true,
    stand: null,
    runwayEnd: null,
    route: [],
  });
  aircraft.update([pose(1, 'B738', 0), pose(2, 'SF34', 60)], 0);
  aircraft.animate(0, 0);
  const camera = new PerspectiveCamera(35, 1.6, 1, 20000);
  const scale = (2 * Math.tan((35 * Math.PI) / 360)) / 1000;
  const view = (distance: number) => {
    camera.position.set(0, distance, 0.01);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    aircraft.setDetail(camera, scale);
    return aircraft.levels();
  };
  // Far, some 8 px across: procedural, nothing loaded.
  expect(view(10_000)).toEqual({ near: 0, middle: 0, far: 2 });
  expect(models.get('B738')).toBeNull();
  // Middle distance: the middle level shows once loaded.
  expect(view(1_500)).toEqual({ near: 0, middle: 0, far: 2 });
  await models.load('B738', 39.5, 1);
  expect(view(1_500)).toEqual({ near: 0, middle: 1, far: 1 });
  // Close: the middle level stands in until the near one has loaded.
  expect(view(80)).toEqual({ near: 0, middle: 1, far: 1 });
  await models.load('B738', 39.5, 0);
  expect(view(80)).toEqual({ near: 1, middle: 0, far: 1 });
  expect(models.loads.map((l) => l.file).sort()).toEqual(['b738-0.glb', 'b738-1.glb']);
  expect(loads).toBe(2);
  // The SF34 has no model and never asks for one.
  expect(models.get('SF34')).toBeNull();
  // Real models share the type's geometry: removing the aircraft leaves it intact.
  const body = models.get('B738')!.bodies.values().next().value!;
  aircraft.update([], 1);
  expect(body.getAttribute('position').count).toBeGreaterThan(0);
  expect(aircraft.count).toBe(0);
});

// TASK-331: one row of cabin windows per deck at the real size, and the real landing gear.

describe('cabin windows', () => {
  const airliners = aircraftTypes.filter((type) => cabinWindows[type.id]);

  it.each(airliners)('$name has one row of real-size panes per deck and side', async (type) => {
    const model = await load(type.id);
    const glass = model.lods[0]!.parts.find((p) => p.name === 'glass')!.geometry;
    const position = glass.getAttribute('position');
    const index = glass.index!;
    // Panes: the glass's connected pieces.
    const parent = Array.from({ length: position.count }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let t = 0; t < index.count; t += 3)
      for (const k of [1, 2]) parent[find(index.getX(t + k))] = find(index.getX(t));
    const boxes = new Map<number, Box3>();
    for (let i = 0; i < position.count; i++) {
      const root = find(i);
      const box = boxes.get(root) ?? new Box3();
      boxes.set(root, box.expandByPoint(new Vector3().fromBufferAttribute(position, i)));
    }
    const { from, to } = cabinSpan(type);
    const { width, height } = cabinWindows[type.id]!;
    const decks = type.class === 'double_decker' ? 2 : 1;
    for (const side of [-1, 1]) {
      const panes = [...boxes.values()].filter((box) => {
        const c = box.getCenter(new Vector3());
        return c.z * side > 0 && c.x > from && c.x < to;
      });
      // Rows: the panes' heights above the fuselage's middle, split at gaps over 15 cm.
      const heights = panes
        .map((box) => {
          const c = box.getCenter(new Vector3());
          return c.y - modelSection(type, c.x)!.y;
        })
        .sort((a, b) => a - b);
      const rows = heights.filter((h, i) => i === 0 || h - heights[i - 1]! > 0.15).length;
      expect(rows).toBe(decks);
      expect(panes.length).toBeGreaterThan(type.lengthM * 0.6);
      for (const box of panes) {
        const size = box.getSize(new Vector3());
        expect(Math.abs(size.x - width) / width).toBeLessThan(0.1);
        expect(Math.abs(Math.hypot(size.y, size.z) - height) / height).toBeLessThan(0.1);
      }
    }
  });
});

describe('landing gear', () => {
  const geared = mapped.filter((type) => gearLayout(type));
  const wheelCounts: Record<string, number> = {
    A388: 22,
    B748: 18,
    B77W: 14,
    A359: 10,
    A333: 10,
    B789: 10,
    A20N: 6,
    A21N: 6,
    B738: 6,
    BCS3: 6,
    E190: 6,
    E175: 6,
    CRJ9: 6,
    AT76: 6,
    DH8D: 6,
    C25C: 3,
  };
  const tyre = new Color(0x22262a);

  it('covers every fixed-wing real model', () => {
    expect(geared.map((t) => t.id).sort()).toEqual(Object.keys(wheelCounts).sort());
  });

  it.each(geared)('$name stands on its stated wheels at the old contact stations', async (type) => {
    const model = await load(type.id);
    const gear = modelGear(model, 0);
    const { noseX, mainX } = fixedWingGearStations(type.lengthM);
    const stations = [
      noseX,
      mainX,
      ...(type.class === 'double_decker' ? [-0.147 * type.lengthM] : []),
    ];
    expect(gear.triangles).toBeLessThanOrEqual(gearBudget);
    let tyreVertices = 0;
    const contact = new Map<number, number[]>();
    for (const [geometry, dx] of [
      [gear.main, 0],
      [gear.nose, noseX],
    ] as const) {
      const p = geometry.getAttribute('position');
      const c = geometry.getAttribute('color');
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(c.getX(i) - tyre.r) > 1e-3 || Math.abs(c.getZ(i) - tyre.b) > 1e-3) continue;
        tyreVertices++;
        const y = p.getY(i);
        expect(y).toBeGreaterThan(-0.02);
        if (y > 0.02) continue;
        // Each touching point belongs to the nearest station.
        const x = p.getX(i) + dx;
        const station = stations.reduce((a, s) => (Math.abs(s - x) < Math.abs(a - x) ? s : a));
        contact.set(station, [...(contact.get(station) ?? []), x]);
      }
    }
    // A tyre: its sides by its profile's bands, two triangles each, three vertices apiece.
    expect(tyreVertices / (gear.sides * tyreBands * 6)).toBe(wheelCounts[type.id]);
    expect(gear.wheels).toBe(wheelCounts[type.id]);
    for (const station of stations) {
      const xs = contact.get(station)!;
      expect(Math.abs(xs.reduce((a, b) => a + b) / xs.length - station)).toBeLessThan(0.02);
    }
  });
});

it('folds the gear inboard, forward or as the type does, without scaling', async () => {
  for (const id of ['A20N', 'B77W', 'DH8D', 'AT76']) {
    const type = aircraftTypes.find((t) => t.id === id)!;
    const gear = modelGear(await load(id), 0);
    const pivot = gear.main.getAttribute('gearPivot');
    const turn = gear.main.getAttribute('gearTurn');
    const shift = gear.main.getAttribute('gearShift');
    for (let i = 0; i < pivot.count; i += 97) {
      // Main legs: a quarter turn inboard about x, aft about z (Q400) or a slide up (ATR).
      if (id === 'DH8D') expect(turn.getZ(i)).toBeCloseTo(-Math.PI / 2);
      else if (id === 'AT76') expect(shift.getY(i)).toBeGreaterThan(0.5);
      else expect(turn.getX(i) * Math.sign(pivot.getZ(i))).toBeCloseTo(Math.PI / 2);
    }
    const nose = gear.nose.getAttribute('gearTurn');
    const legs = Array.from({ length: nose.count }, (_, i) => nose.getZ(i)).filter((z) => z);
    expect(legs.every((z) => Math.abs(z - Math.PI / 2) < 1e-6)).toBe(true);
    expect(type.id).toBe(id);
  }
});
