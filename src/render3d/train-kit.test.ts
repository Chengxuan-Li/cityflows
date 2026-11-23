import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { buildCity } from '../fixtures/build-city';
import { compile, type CompiledCity } from '../network';
import { railHeights } from '../network/rail';
import { trainTimetable, trainsAt } from '../network/trains';
import { cityGrades } from '../render/grades';
import { pixelScale } from './airfield-lights';
import { cityHeights } from './heights';
import { pickVehicle3D } from './picking';
import {
  bodyGeometry,
  bodyParts,
  carFlags,
  carState,
  formationOf,
  gearGeometry,
  gearSlots,
  placedX,
} from './train-kit';
import { trainVariants, type TrainVariant } from './train-variants';
import { Trains3D } from './trains';

const variants = Object.values(trainVariants) as TrainVariant[];
/** The sim's car pose length for each variant's own service. */
const poseM = (v: TrainVariant) => (v.id === 'tram' ? 8.3 : 21.8);

describe.for(variants)('TASK-332 $id model', (v) => {
  const body = bodyGeometry(v),
    gear = gearGeometry(v);

  test('has every body part and gear slot, within the triangle budget', () => {
    const parts = new Set(body.getAttribute('aPart').array);
    expect([...parts].sort()).toEqual(Object.values(bodyParts));
    const slots = new Set(gear.getAttribute('aSlot').array);
    const expected = [0, 1, 2, ...(v.pantograph ? [3, 4] : []), 5, 6];
    expect([...slots].sort()).toEqual(expected);
    expect(gearSlots.count).toBe(7);
    // Every triangle counts, also those a car hides.
    expect((body.index!.count + gear.index!.count) / 3).toBeLessThanOrEqual(1500);
  });

  test('extents match the stated length, width and height within 2%', () => {
    const f = formationOf(v);
    for (const [name, type] of Object.entries(v.carTypes)) {
      const length = type.lengthM ?? poseM(v);
      const flags =
        type.cabs === 'none'
          ? 0
          : type.cabs === 'both'
            ? carFlags.cabFront | carFlags.cabRear
            : carFlags.cabFront;
      const position = body.getAttribute('position'),
        anchor = body.getAttribute('aAnchor'),
        part = body.getAttribute('aPart');
      let minX = Infinity,
        maxX = -Infinity,
        maxZ = 0,
        maxY = 0;
      for (let i = 0; i < position.count; i++) {
        const x = placedX(
          position.getX(i),
          anchor.getX(i),
          part.getX(i),
          length / 2,
          flags,
          v.nose.lengthM,
        );
        if (x === null) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, Math.abs(position.getZ(i)));
        maxY = Math.max(maxY, position.getY(i));
      }
      expect(maxX - minX, name).toBeCloseTo(length, 1);
      expect(Math.abs(2 * maxZ - v.widthM) / v.widthM, name).toBeLessThan(0.02);
      expect(Math.abs(maxY - v.heightM) / v.heightM, name).toBeLessThan(0.02);
      expect(f.types).toContain(type);
    }
  });

  test('cab ends and lamps face the direction of travel', () => {
    const f = formationOf(v),
      n = v.id === 'tram' ? 4 : 6;
    const car = new Float32Array(4),
      gear = new Float32Array(8);
    for (const reversed of [false, true])
      for (let i = 0; i < n; i++) {
        // i counts from the travelling front; j from the route's forward end.
        const j = reversed ? n - 1 - i : i;
        const turn = carState(f, n, j, poseM(v), reversed, false, car, 0, gear, 0);
        const flags = car[2]!;
        const ahead = turn ? 'Rear' : 'Front',
          behind = turn ? 'Front' : 'Rear';
        const has = (name: keyof typeof carFlags) => (flags & carFlags[name]) !== 0;
        if (i === 0) {
          expect(has(`cab${ahead}`), `${reversed} lead cab`).toBe(true);
          expect(has(`head${ahead}`), `${reversed} lead lamps`).toBe(true);
        } else expect(has(`head${ahead}`) || has(`head${behind}`)).toBe(false);
        if (i === n - 1) {
          expect(has(`cab${behind}`), `${reversed} tail cab`).toBe(true);
          expect(has(`tail${behind}`), `${reversed} tail lamps`).toBe(true);
        }
        // Bogies, pantographs and housings lie within the car or its joints.
        for (let s = 0; s < gearSlots.count; s++)
          if (gear[s]! < 900) expect(Math.abs(gear[s]!)).toBeLessThanOrEqual(poseM(v) / 2 + 0.36);
      }
  });
});

test('TASK-332 S-Bahn units of three cars meet cab to cab, with Jacobs bogies and bellows inside', () => {
  const f = formationOf(trainVariants.sbahn!);
  const car = new Float32Array(4),
    gear = new Float32Array(8);
  const states = Array.from({ length: 6 }, (_, j) => {
    carState(f, 6, j, 21.8, false, false, car, 0, gear, 0);
    return { flags: car[2]!, bogies: [...gear.slice(0, 3)].filter((x) => x < 900).length };
  });
  const cabs = states.map(({ flags }) => (flags & (carFlags.cabFront | carFlags.cabRear)) !== 0);
  expect(cabs).toEqual([true, false, true, true, false, true]);
  const bellows = states.map(
    ({ flags }) => (flags & (carFlags.bellowsFront | carFlags.bellowsRear)) !== 0,
  );
  expect(bellows).toEqual([true, true, true, true, true, true]);
  // Two end bogies and two joint bogies per unit.
  expect(states.reduce((sum, s) => sum + s.bogies, 0)).toBe(8);
});

function fixture() {
  const { city, node, road } = buildCity('Train kit', 1);
  road(node(-100, 30), node(1300, 30));
  city.rail = {
    nodes: {
      'rn:1': { id: 'rn:1', pos: { x: 0, y: 0 }, kind: 'plain', layer: 0 },
      'rn:2': { id: 'rn:2', pos: { x: 1200, y: 0 }, kind: 'plain', layer: 0 },
    },
    tracks: {
      'rt:1': {
        id: 'rt:1',
        from: 'rn:1',
        to: 'rn:2',
        line: [
          { x: 0, y: 0 },
          { x: 1200, y: 0 },
        ],
        kind: 'rail',
        layer: 0,
        preferredDirection: 'forward',
      },
    },
    platforms: {},
  };
  const result = compile(city);
  if (!result.ok) throw Error('compile');
  return { city, compiled: result.compiled as CompiledCity, rail: result.compiled.rail! };
}

test('TASK-332 picking returns the right train at both levels, with the head car facing ahead', () => {
  const { city, compiled, rail } = fixture();
  const { roadGrades, nodeGrades } = cityGrades(compiled);
  const table = trainTimetable(rail);
  let time = table.departures[0]!.timeS;
  while ((trainsAt(rail, table, time)[0]?.cars.length ?? 0) < 8) time += 1;
  const trains = trainsAt(rail, table, time);
  const layer = new Trains3D(
    rail,
    cityHeights(compiled, city),
    railHeights(compiled, roadGrades, nodeGrades),
    table,
    city.drivingSide,
  );
  layer.update(trains, false, null);
  layer.group.updateMatrixWorld(true);
  const lead = trains[0]!.cars[0]!;
  const camera = new PerspectiveCamera(45, 1, 0.5, 5000);
  for (const [distance, level] of [
    [40, 'near'],
    [900, 'far'],
  ] as const) {
    camera.position.set(lead.x, 0.6 * distance, lead.y + 0.8 * distance);
    camera.lookAt(lead.x, 2, lead.y);
    camera.updateMatrixWorld();
    layer.setDetail(camera, pixelScale(camera, 800));
    const counts = layer.counts()[0]!;
    expect(level === 'near' ? counts.near : counts.far, level).toBeGreaterThan(0);
    const point = new Vector3(lead.x, 2, lead.y).project(camera);
    const index = pickVehicle3D(
      layer.pickMesh,
      camera,
      ((point.x + 1) / 2) * 800,
      ((1 - point.y) / 2) * 800,
      800,
      800,
    );
    expect(index, level).not.toBeNull();
    expect(layer.pick(index!).id).toBe(trains[0]!.id);
  }
  // The lead car's front, where its cab and head lamps are, points along its heading.
  const { far } = layer.variants[0]!;
  const flags = far.geometry.getAttribute('aCar').getZ(0);
  expect(flags & carFlags.headFront).toBeTruthy();
  const matrix = far.instanceMatrix;
  const front = new Vector3(matrix.getX(0), 0, matrix.getZ(0)).normalize();
  expect(front.dot(new Vector3(Math.cos(lead.heading), 0, Math.sin(lead.heading)))).toBeCloseTo(
    1,
    3,
  );
});

// TASK-333 and TASK-334 add their variants as records only. These stand-ins, built from the
// S-Bahn's record, show the builder already draws what they need.
const base = trainVariants.sbahn!;
const plainCar = base.carTypes.middle!;
const dlrLike: TrainVariant = {
  ...base,
  id: 'dlr',
  // Two-section articulated units with plain ends (a large window, no windscreen), shoes.
  nose: { ...base.nose, lengthM: 0.6, rakeM: 0.1, cornerM: 0.3 },
  bogie: { ...base.bogie, shoes: true },
  pantograph: null,
  formation: { unitCars: 2, first: 'end', middle: [], last: 'end' },
  carTypes: { end: { ...plainCar, cabs: 'front', bogies: [[1, -2.5]], pantographs: [] } },
};
const pushPull: TrainVariant = {
  ...base,
  id: 'intercity',
  jacobs: false,
  formation: { unitCars: 0, first: 'loco', middle: ['coach'], last: 'control' },
  carTypes: {
    loco: {
      ...plainCar,
      lengthM: 19,
      cabs: 'both',
      bogies: [
        [1, -3.5],
        [-1, 3.5],
      ],
      pantographs: [
        [0, -4],
        [0, 4],
      ],
      doors: [],
      windows: false,
    },
    coach: {
      ...plainCar,
      bogies: [
        [1, -2.5],
        [-1, 2.5],
      ],
      pantographs: [],
    },
    control: {
      ...plainCar,
      cabs: 'front',
      bogies: [
        [1, -2.5],
        [-1, 2.5],
      ],
      pantographs: [],
    },
  },
};
const tubeLike: TrainVariant = {
  ...base,
  id: 'tube',
  widthM: 2.6,
  heightM: 2.9,
  floorM: 0.6,
  // The deep-tube profile: the roof follows the tunnel's circle, the doors cut into it.
  profile: {
    bottomM: 0.35,
    skirtInsetM: 0.05,
    waistM: 0.9,
    cantM: 1.7,
    cantInsetM: 0.05,
    roofSquareness: 2,
  },
  nose: { ...base.nose, lengthM: 0.4, rakeM: 0.05, rakeFromM: 1.2, cornerM: 0.2, couplerM: 0.7 },
  doorTopM: 2.4,
  bogie: { ...base.bogie, shoes: true },
  pantograph: null,
  bellows: false,
  jacobs: false,
  formation: { unitCars: 0, first: 'cab', middle: ['car'], last: 'cab' },
  carTypes: {
    cab: {
      ...plainCar,
      lengthM: 17,
      cabs: 'front',
      bogies: [
        [1, -2.5],
        [-1, 2.5],
      ],
      pantographs: [],
    },
    car: {
      ...plainCar,
      lengthM: 17,
      bogies: [
        [1, -2.5],
        [-1, 2.5],
      ],
      pantographs: [],
      doors: [
        [0, -5.5, 0.9],
        [0, -2.2, 1.4],
        [0, 2.2, 1.4],
        [0, 5.5, 0.9],
      ],
    },
  },
};

test.for([dlrLike, pushPull, tubeLike])(
  'TASK-332 the builder draws a $id-like record within the budget and at its stated size',
  (v) => {
    const body = bodyGeometry(v),
      gear = gearGeometry(v);
    expect((body.index!.count + gear.index!.count) / 3).toBeLessThanOrEqual(1500);
    const f = formationOf(v);
    const car = new Float32Array(4),
      slots = new Float32Array(8);
    const n = 6;
    for (let j = 0; j < n; j++) {
      carState(f, n, j, 24.3, false, false, car, 0, slots, 0);
      const type = f.types[car[1]!]!;
      // Drawn at the type's own length, centred in the pose, the rest left as gangway space.
      expect(car[0]! * 2).toBeCloseTo(type.lengthM ?? 24.3, 5);
      expect(car[3]!).toBeCloseTo((24.3 - car[0]! * 2) / 2 + 0.35, 5);
    }
  },
);

test('TASK-332 a push-pull make-up keeps its locomotive at one end whichever way it runs', () => {
  const f = formationOf(pushPull);
  const car = new Float32Array(4),
    gear = new Float32Array(8);
  const names = Object.keys(pushPull.carTypes);
  for (const reversed of [false, true]) {
    const types = Array.from({ length: 8 }, (_, j) => {
      carState(f, 8, j, 24.3, reversed, false, car, 0, gear, 0);
      return names[car[1]!];
    });
    expect(types).toEqual([
      'loco',
      'coach',
      'coach',
      'coach',
      'coach',
      'coach',
      'coach',
      'control',
    ]);
    // The leading end carries the head lamps: the locomotive forward, the control car reversed.
    carState(f, 8, reversed ? 7 : 0, 24.3, reversed, false, car, 0, gear, 0);
    expect(car[2]! & (carFlags.headFront | carFlags.headRear)).toBeTruthy();
  }
  // Locomotive and coach couple without bellows: a coupler bridges the gap.
  carState(f, 8, 0, 24.3, false, false, car, 0, gear, 0);
  expect(car[2]! & carFlags.coupledRear).toBeTruthy();
  expect(car[2]! & carFlags.bellowsRear).toBeFalsy();
});

test('TASK-332 coupled cab ends reach into the gap and a coupler meets the neighbour', () => {
  const v = trainVariants.sbahn!,
    body = bodyGeometry(v);
  const f = formationOf(v);
  const car = new Float32Array(4),
    gear = new Float32Array(8);
  carState(f, 6, 2, 21.8, false, false, car, 0, gear, 0);
  const flags = car[2]!;
  // The unit's last car, turned round: its cab faces the next unit at its local front.
  expect(flags & carFlags.cabFront && flags & carFlags.coupledFront).toBeTruthy();
  const position = body.getAttribute('position'),
    anchor = body.getAttribute('aAnchor'),
    part = body.getAttribute('aPart');
  let nose = -Infinity,
    coupler = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const x = placedX(
      position.getX(i),
      anchor.getX(i),
      part.getX(i),
      car[0]!,
      flags,
      v.nose.lengthM,
      car[3]!,
    );
    if (x === null) continue;
    if (part.getX(i) === bodyParts.frontNose) nose = Math.max(nose, x);
    if (part.getX(i) === bodyParts.frontCoupler) coupler = Math.max(coupler, x);
  }
  // Noses 0.3 m apart at their feet; couplers overlapping in the middle of the 0.7 m gap.
  expect(nose).toBeCloseTo(21.8 / 2 + 0.2, 5);
  expect(coupler).toBeCloseTo(21.8 / 2 + 0.37, 5);
});
