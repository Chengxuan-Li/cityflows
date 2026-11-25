import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
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
  farGeometry,
  formationOf,
  gearGeometry,
  gearSlots,
  hidden,
  placedX,
} from './train-kit';
import { builtVariant, trainVariants, type TrainVariant } from './train-variants';
import { Trains3D } from './trains';

const variants = Object.values(trainVariants) as TrainVariant[];
/** The sim's car pose length for each variant's own service. */
const poseM = (v: TrainVariant) => {
  if (v.id === 'tram') return 8.3;
  return v.id === 'elizabeth' || v.id === 'intercity' ? 24.3 : 21.8;
};

describe.for(variants)('TASK-332 $id model', (v) => {
  const body = bodyGeometry(v),
    gear = gearGeometry(v);

  test('has every body part and gear slot, within the triangle budget', () => {
    const parts = new Set(body.getAttribute('aPart').array);
    const count = v.nose.buffers ? 11 : 9;
    expect([...parts].sort((a, b) => a - b)).toEqual(Object.values(bodyParts).slice(0, count));
    const slots = new Set(gear.getAttribute('aSlot').array);
    const expected = [
      0,
      1,
      2,
      ...(v.pantograph ? [3, 4] : []),
      ...(v.roofBox.heightM > 0 ? [5, 6] : []),
    ];
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
  const pickBox = new Matrix4();
  layer.pickMesh.getMatrixAt(0, pickBox);
  expect(new Vector3().setFromMatrixColumn(pickBox, 0).length()).toBeCloseTo(19);
  const lead = trains[0]!.cars[0]!;
  const heading = new Vector3(Math.cos(lead.heading), 0, Math.sin(lead.heading));
  const pickCentre = new Vector3().setFromMatrixPosition(pickBox);
  expect(
    pickCentre
      .clone()
      .sub(new Vector3(lead.x, 0, lead.y))
      .dot(heading),
  ).toBeCloseTo(-1.9);
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
    const point = pickCentre
      .clone()
      .add(new Vector3(0, 2, 0))
      .project(camera);
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
  expect(front.dot(heading)).toBeCloseTo(1, 3);
});

test.for([
  ['tube', 2, [-6.2, -2.35, 2.35, 6.2], 1.7],
  ['nyc', 4, [-5.75, -1.92, 1.92, 5.75], 1.92],
] as const)(
  'TASK-334 %s fills both pose sizes with close coupling and fixed door and window spacing',
  ([id, doubleDoors, doorCentres, paneM]) => {
    const v = builtVariant(id);
    expect(v.id).toBe(id);
    expect(v.windows.paneM).toBe(paneM);
    const f = formationOf(v);
    const car = new Float32Array(4),
      gear = new Float32Array(8);
    const body = bodyGeometry(v),
      far = farGeometry(v);
    expect(far.index!.count / 3).toBe(12);
    for (const length of [21.8, 24.3]) {
      carState(f, 3, 1, length, false, false, car, 0, gear, 0);
      const halfM = car[0]!,
        type = f.types[car[1]!]!,
        flags = car[2]!,
        gapM = car[3]!;
      expect(halfM * 2).toBeCloseTo(length, 5);
      expect(gapM * 2).toBeCloseTo(0.7, 5);
      expect(type.doors.map(([anchor, offset]) => anchor * halfM + offset)).toEqual(doorCentres);
      expect(type.doors.filter((door) => door[2] > 1.2)).toHaveLength(doubleDoors);
      expect(flags & (carFlags.coupledFront | carFlags.coupledRear)).toBe(
        carFlags.coupledFront | carFlags.coupledRear,
      );
      for (const geometry of [body, far]) {
        const detailFlags =
          geometry === far ? flags & ~(carFlags.cabFront | carFlags.cabRear) : flags;
        const position = geometry.getAttribute('position'),
          anchor = geometry.getAttribute('aAnchor'),
          part = geometry.getAttribute('aPart');
        const xs = Array.from({ length: position.count }, (_, i) =>
          part.getX(i) >= bodyParts.frontCoupler
            ? null
            : placedX(
                position.getX(i),
                anchor.getX(i),
                part.getX(i),
                halfM,
                detailFlags,
                v.nose.lengthM,
                gapM,
              ),
        ).filter((x) => x !== null);
        expect(Math.min(...xs)).toBeCloseTo(-length / 2, 5);
        expect(Math.max(...xs)).toBeCloseTo(length / 2, 5);
      }
      expect(placedX(1, 1, bodyParts.frontCoupler, halfM, flags, v.nose.lengthM, gapM)).toBeCloseTo(
        (length + 0.7) / 2 + 0.02,
        5,
      );
    }
  },
);

test('TASK-333 the locomotive and control car lead at opposite ends in push-pull operation', () => {
  const pushPull = builtVariant('intercity');
  expect(pushPull.id).toBe('intercity');
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
    expect(car[2]! & carFlags.headFront).toBeTruthy();
    expect(car[0]! * 2).toBeCloseTo(reversed ? 24.8 : 19);
    expect([...gear.slice(0, 2)].every((pos) => Math.abs(pos) < car[0]!)).toBe(true);
  }
  carState(f, 8, 2, 24.3, false, false, car, 0, gear, 0);
  expect(car[2]! & (carFlags.bellowsFront | carFlags.bellowsRear)).toBe(12);
});

test('TASK-333 the locomotive meets the first coach at the buffers in either direction', () => {
  const v = builtVariant('intercity');
  const f = formationOf(v);
  const car = new Float32Array(4),
    gear = new Float32Array(8);
  for (const reversed of [false, true]) {
    carState(f, 8, 0, 24.3, reversed, false, car, 0, gear, 0);
    const locoRear =
      placedX(-v.nose.lengthM, -1, bodyParts.rearNose, car[0]!, car[2]!, v.nose.lengthM, car[3]!)! +
      gear[7]!;
    const locoBuffers =
      placedX(-0.5, -1, bodyParts.rearBuffers, car[0]!, car[2]!, v.nose.lengthM, car[3]!)! +
      gear[7]!;
    carState(f, 8, 1, 24.3, reversed, false, car, 0, gear, 0);
    const coachFront = car[0]! - 25;
    const coachBuffers =
      placedX(0.5, 1, bodyParts.frontBuffers, car[0]!, car[2]!, v.nose.lengthM, car[3]!)! - 25;
    expect(locoRear - coachFront).toBeCloseTo(1);
    expect(locoBuffers).toBeCloseTo(coachBuffers);
    expect(car[2]! & carFlags.closedGangwayFront).toBeTruthy();
    expect(car[2]! & carFlags.bellowsRear).toBeTruthy();
    carState(f, 8, 7, 24.3, reversed, false, car, 0, gear, 0);
    expect(car[2]! & carFlags.closedGangwayFront).toBeFalsy();
  }
  const detached = formationOf({ ...v, formation: { ...v.formation, first: 'coach' } });
  carState(detached, 1, 0, 24.3, false, false, car, 0, gear, 0);
  const closed = carFlags.closedGangwayFront | carFlags.closedGangwayRear;
  expect(car[2]! & closed).toBe(closed);
});

test('TASK-333 DB bodies shorten with poses clipped at the extract edge', () => {
  const f = formationOf(builtVariant('intercity'));
  const car = new Float32Array(4),
    gear = new Float32Array(8);
  for (const j of [0, 1, 7]) {
    carState(f, 8, j, 12, false, false, car, 0, gear, 0, 24.3);
    expect(car[0]! * 2).toBe(12);
    expect(gear[7]).toBe(0);
    carState(f, 8, j, 2, false, false, car, 0, gear, 0, 24.3);
    expect(car[0]! * 2).toBe(2);
    expect([...gear.slice(0, gearSlots.count)].every((p) => p === hidden)).toBe(true);
  }
});

test('TASK-333 the DLR has three bogies per articulated unit and couples between units', () => {
  const v = builtVariant('dlr');
  expect(v.id).toBe('dlr');
  const f = formationOf(v);
  const car = new Float32Array(4),
    gear = new Float32Array(8);
  const states = Array.from({ length: 6 }, (_, j) => {
    carState(f, 6, j, 21.8, false, false, car, 0, gear, 0);
    expect([...gear.slice(3, 5)]).toEqual([hidden, hidden]);
    return { flags: car[2]!, bogies: [...gear.slice(0, 3)].filter((x) => x < 900).length };
  });
  expect(states.map(({ bogies }) => bogies)).toEqual([2, 1, 2, 1, 2, 1]);
  expect(states.map(({ flags }) => flags & 12)).toEqual([8, 8, 8, 8, 8, 8]);
  expect(states.map(({ flags }) => flags & carFlags.coupledFront)).toEqual([
    0, 512, 512, 512, 512, 0,
  ]);
});

test.for([6, 8])(
  'TASK-333 a %i-car Elizabeth line train has only end cabs and two pantographs',
  (n) => {
    const v = builtVariant('elizabeth');
    expect(v.id).toBe('elizabeth');
    const f = formationOf(v);
    const car = new Float32Array(4),
      gear = new Float32Array(8);
    const powered = [];
    for (let j = 0; j < n; j++) {
      carState(f, n, j, 24.3, false, false, car, 0, gear, 0);
      expect(car[2]! & 3).toBe(j === 0 || j === n - 1 ? carFlags.cabFront : 0);
      if (gear[gearSlots.pantographs]! < 900) powered.push(j);
      const type = f.types[car[1]!]!;
      expect(type.doors).toHaveLength(3);
      for (const door of type.doors) expect(door[2]).toBeGreaterThan(1.2);
    }
    expect(powered).toEqual([1, 3]);
  },
);

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
