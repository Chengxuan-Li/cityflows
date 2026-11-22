import {
  Box3,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Raycaster,
  ShaderMaterial,
  Vector3,
} from 'three';
import { expect, it } from 'vitest';
import { aircraftLivery } from '../../src/render/aircraft-livery';
import {
  aircraftLayout,
  boardingDoor,
  bridgeable,
  buildAircraftOutline,
  modelSection,
  wingtipKind,
} from '../../src/render/aircraft-outline';
import { AircraftPoseTrack } from '../../src/render/aircraft-pose';
import { placeAircraft } from '../../src/render3d/aircraft-attitude';
import { batchAircraftMesh, buildAircraftMesh } from '../../src/render3d/aircraft-mesh';
import { aircraftTypes, type AircraftClass } from '../../src/schema/aircraft';
import { fixedWingGearStations } from '../../src/sim/aircraft-motion';

it.each(aircraftTypes)('$name has catalogue extents and the parts of its class', (type) => {
  const helicopter = type.class === 'helicopter';
  const propeller = type.class === 'propeller';
  const engineCount = type.engines.mount === 'none' ? 0 : type.engines.count;
  const outline = buildAircraftOutline(type);
  const points = outline.flatMap((part) => {
    if ('points' in part) return part.points;
    const {
      center: { x, y },
      radiusM: r,
    } = part;
    return [
      { x: x - r, y: y - r },
      { x: x + r, y: y + r },
    ];
  });
  for (const [axis, size] of [
    ['x', type.lengthM],
    ['y', type.spanM],
  ] as const) {
    expect(Math.min(...points.map((point) => point[axis]))).toBeCloseTo(-size / 2, 6);
    expect(Math.max(...points.map((point) => point[axis]))).toBeCloseTo(size / 2, 6);
  }
  expect(outline.filter((part) => part.kind === 'wing')).toHaveLength(helicopter ? 0 : 2);
  expect(outline.filter((part) => part.kind === 'tailplane')).toHaveLength(2);
  expect(outline.filter((part) => part.kind === 'engine')).toHaveLength(engineCount);
  expect(outline.filter((part) => part.kind === 'propeller')).toHaveLength(
    propeller ? engineCount : 0,
  );
  expect(outline.filter((part) => part.kind === 'rotor')).toHaveLength(helicopter ? 1 : 0);

  const { root, gear, propellers, rotors, windowRows, lightMounts } = buildAircraftMesh(type);
  const bounds = new Box3().setFromObject(root, true);
  expect(bounds.min.x).toBeCloseTo(-type.lengthM / 2, 5);
  expect(bounds.max.x).toBeCloseTo(type.lengthM / 2, 5);
  expect(bounds.min.z).toBeCloseTo(-type.spanM / 2, 5);
  expect(bounds.max.z).toBeCloseTo(type.spanM / 2, 5);
  expect(bounds.min.y).toBeCloseTo(0, 5);
  expect(root.getObjectByName('wings')?.children.length ?? 0).toBe(helicopter ? 0 : 2);
  expect(root.getObjectByName('tailplane')?.children).toHaveLength(2);
  const engines = root.children.filter(({ name }) => name === 'engine');
  expect(engines).toHaveLength(engineCount);
  expect(engines.filter(({ position }) => position.z < 0)).toHaveLength(engineCount / 2);
  expect(engines.filter(({ position }) => position.z > 0)).toHaveLength(engineCount / 2);
  if (type.engines.mount === 'rear') {
    expect(engines.every(({ position }) => position.x < 0)).toBe(true);
  }

  expect(gear.parent).toBe(root);
  expect(gear.children.length).toBeGreaterThan(0);
  expect(propellers).toHaveLength(propeller ? engineCount : 0);
  expect(rotors.map(({ name }) => name)).toEqual(helicopter ? ['main-rotor', 'tail-rotor'] : []);
  for (const [pivot, axis] of [
    ...propellers.map((pivot) => [pivot, [1, 0, 0]] as const),
    ...rotors.map((pivot, i) => [pivot, i === 0 ? [0, 1, 0] : [0, 0, 1]] as const),
  ]) {
    const direction = new Vector3(0, 1, 0).applyQuaternion(
      pivot.getWorldQuaternion(new Quaternion()),
    );
    expect(direction.distanceTo(new Vector3(...axis))).toBeLessThan(1e-8);
  }
  expect(windowRows).toHaveLength(type.class === 'double_decker' ? 2 : 1);
  expect(windowRows.every((row) => row.parent === root && row.children.length > 0)).toBe(true);

  const { navLeft, navRight, navTail, beacon, strobes, landing, taxi } = lightMounts;
  expect(navLeft[2]).toBeLessThan(0);
  expect(navRight[2]).toBe(-navLeft[2]);
  if (!helicopter) expect(navRight[2]).toBe(type.spanM / 2);
  expect(navTail[0]).toBe(-type.lengthM / 2);
  expect(beacon[1]).toBeGreaterThan(taxi[1]);
  expect(strobes.map((point) => point[2])).toEqual([navLeft[2], navRight[2]]);
  expect(landing).toHaveLength(helicopter ? 1 : 2);
});

it('changes the accent without recolouring the neutral fuselage', () => {
  const type = aircraftTypes[0]!;
  const first = buildAircraftMesh(type, 0xac3834);
  const second = buildAircraftMesh(type, 0x31657f);
  function colour(root: typeof first.root, part: string) {
    const mesh = root.getObjectByName(part) as Mesh<never, MeshLambertMaterial>;
    return mesh.material.color.getHex();
  }
  expect(colour(first.root, 'fin')).toBe(0xac3834);
  expect(colour(second.root, 'fin')).toBe(0x31657f);
  expect(colour(first.root, 'fuselage')).toBe(colour(second.root, 'fuselage'));
});

it.each(['A20N', 'AT76', 'EC45'])(
  'preserves %s silhouette and moving parts when batching',
  (id) => {
    const aircraft = buildAircraftMesh(aircraftTypes.find((type) => type.id === id)!);
    const { root, gear, noseGear, propellers, rotors } = aircraft;
    const countMeshes = () => {
      let count = 0;
      root.traverse((object) => {
        if (object instanceof Mesh) count++;
      });
      return count;
    };
    const count = countMeshes();
    const bounds = new Box3().setFromObject(root, true);
    const pivots = [gear, ...(noseGear ? [noseGear] : []), ...propellers, ...rotors];
    const axes = pivots.map((pivot) => pivot.getWorldQuaternion(new Quaternion()));
    let wingHeights: number[] = [];
    const sampleWings = () => {
      const wing = root.getObjectByName('wings');
      const halfSpan = (wing ? new Box3().setFromObject(wing).max.z : bounds.max.z) * 0.55;
      return [-halfSpan, halfSpan].map(
        (z) =>
          new Raycaster(new Vector3(-1, 30, z), new Vector3(0, -1, 0))
            .intersectObject(root)
            .find(({ object }) => !object.userData.outline)?.point.y ?? NaN,
      );
    };
    if (id === 'A20N') wingHeights = sampleWings();
    batchAircraftMesh(aircraft, new ShaderMaterial());
    const after = new Box3().setFromObject(root, true);
    expect(after.min.distanceTo(bounds.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(bounds.max)).toBeLessThan(1e-5);
    expect(countMeshes()).toBeLessThan(count / 2);
    for (const [i, pivot] of pivots.entries()) {
      expect(pivot.children.filter((part) => part instanceof Mesh)).toHaveLength(1);
      expect(pivot.getWorldQuaternion(new Quaternion()).angleTo(axes[i]!)).toBeCloseTo(0, 5);
    }
    if (id === 'A20N')
      sampleWings().forEach((height, i) => expect(height).toBeCloseTo(wingHeights[i]!, 5));
  },
);

// TASK-315: per-type parts and dimensions: doors, windscreen, wingtip devices, fan faces,
// flap-track and wing-to-body fairings, boarding-door sills, and the livery bands.
const sills: Record<AircraftClass, [number, number]> = {
  double_decker: [4.7, 5.6],
  widebody: [4.5, 5.6],
  narrowbody: [2.9, 3.8],
  regional_jet: [1.8, 2.8],
  propeller: [1.4, 2.6],
  private: [0.8, 1.8],
  helicopter: [1.1, 1.8],
};
it.each(aircraftTypes)('$name: doors, windscreen, tips, fans, fairings and sill', (type) => {
  const layout = aircraftLayout(type);
  const helicopter = type.class === 'helicopter';
  const jet = !helicopter && type.class !== 'propeller';
  const { root } = buildAircraftMesh(type, aircraftLivery('G-ABCD'));
  const parts = (name: string) => root.children.filter((c) => c.name === name);
  const fans = root.children
    .filter(({ name }) => name === 'engine')
    .flatMap((engine) => engine.children.filter(({ name }) => name === 'fan'));
  const twoSided = (jet && type.class !== 'private') || helicopter;
  expect(parts('door')).toHaveLength(layout.doors.length * (twoSided ? 2 : 1));
  expect(parts('windscreen')).toHaveLength(helicopter ? 0 : 4);
  expect(Boolean(root.getObjectByName('cockpit'))).toBe(helicopter);
  const engineCount = type.engines.mount === 'none' ? 0 : type.engines.count;
  expect(fans).toHaveLength(engineCount * (jet ? 3 : 1));
  const tracks = { double_decker: 5, widebody: 4, narrowbody: 3, regional_jet: 2 }[
    type.class as 'widebody'
  ];
  const lowWing = jet && layout.wing[0]!.y < layout.bodyY;
  expect(parts('fairing')).toHaveLength(
    (tracks ?? 0) * 2 + (lowWing ? 1 : 0) + (type.id === 'AT76' ? 2 : 0),
  );
  // Tip devices rise above the tip inside the published span; raked tips taper the planform.
  const tips = root.getObjectByName('winglets');
  const kind = wingtipKind(type);
  if (kind === 'none' || kind === 'raked') expect(tips).toBeUndefined();
  else {
    expect(tips!.children).toHaveLength(kind === 'fence' ? 4 : 2);
    const box = new Box3().setFromObject(tips!, true);
    expect(box.max.z).toBeLessThanOrEqual(type.spanM / 2 + 1e-9);
    expect(box.max.y).toBeGreaterThan(layout.wing.at(-1)!.y + type.spanM * 0.02);
  }
  if (kind === 'raked') expect(layout.wing.at(-1)!.chord).toBeLessThan(type.lengthM * 0.025);
  // The boarding door: ahead of the wing, on the port surface (the real model's where the type
  // has one, TASK-318), its sill at the class's height.
  const door = boardingDoor(type);
  expect(door.z).toBeLessThan(0);
  expect(-door.z).toBeLessThanOrEqual(modelSection(type, door.x)?.width ?? layout.radius);
  if (!helicopter) expect(door.x).toBeGreaterThan(layout.wing[0]!.x);
  const [low, high] = sills[type.class];
  expect(door.sillM).toBeGreaterThanOrEqual(low);
  expect(door.sillM).toBeLessThanOrEqual(high);
  expect(bridgeable(type)).toBe(
    type.class !== 'propeller' && type.class !== 'private' && !helicopter,
  );
});

it.each([
  ['tail', 0],
  ['cheatline', 2],
  ['belly', 1],
  ['tailcone', 1],
  ['crown', 1],
] as const)('paints the %s scheme in %i bands besides the belly', (style, bands) => {
  const livery = { style, tail: 0x1f3f78, trim: null, engines: 0x1f3f78, belly: 0xc9ced4 };
  const { root } = buildAircraftMesh(
    aircraftTypes.find((t) => t.id === 'A20N')!,
    livery,
  );
  const painted = root.children.filter((c) => c.name === 'livery') as Mesh<
    never,
    MeshLambertMaterial
  >[];
  expect(painted.filter((m) => m.material.color.getHex() === 0x1f3f78)).toHaveLength(bands);
  expect(painted.filter((m) => m.material.color.getHex() === 0xc9ced4)).toHaveLength(1);
  const engine = root.children.find((c) => c.name === 'engine')!.children[0] as Mesh<
    never,
    MeshLambertMaterial
  >;
  expect(engine.material.color.getHex()).toBe(0x1f3f78);
  expect(
    (root.getObjectByName('fin') as Mesh<never, MeshLambertMaterial>).material.color.getHex(),
  ).toBe(0x1f3f78);
});

it('gives every registration one of the schemes, the same each time', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const livery = aircraftLivery(`G-${i.toString(36).toUpperCase().padStart(4, 'A')}`);
    expect(aircraftLivery(`G-${i.toString(36).toUpperCase().padStart(4, 'A')}`)).toBe(livery);
    seen.add(JSON.stringify(livery));
  }
  expect(seen.size).toBe(10);
});

it('holds the main axle on the runway as the batched nose gear lifts and steers', () => {
  const type = aircraftTypes.find(({ id }) => id === 'E190')!;
  const aircraft = buildAircraftMesh(type);
  batchAircraftMesh(aircraft, new ShaderMaterial());
  const { mainX } = fixedWingGearStations(type.lengthM);
  const track = new AircraftPoseTrack(
    {
      id: 1,
      registration: 'G-TEST',
      typeId: type.id,
      x: 20,
      y: 60,
      heightM: 0,
      heading: Math.PI / 2,
      speedMps: 70,
      state: 'rotation',
      enginesRunning: true,
      onRunway: true,
      airborne: false,
      gearDown: true,
      stand: null,
      runwayEnd: null,
      route: [],
      visual: {
        x: 20,
        y: 60,
        heightM: 0,
        heading: Math.PI / 2,
        pitch: 0.1,
        roll: 0,
        steering: 0.25,
        gear: 1,
      },
    },
    5,
  );
  placeAircraft(aircraft, track.pose, 3, mainX, 2);
  aircraft.root.updateMatrixWorld(true);
  const main = aircraft.root.localToWorld(new Vector3(mainX, 0, 0));
  expect(main.distanceTo(new Vector3(20, 3, 60 + mainX))).toBeLessThan(1e-8);
  const nose = aircraft.noseGear!;
  expect(nose.getWorldPosition(new Vector3()).y).toBeGreaterThan(4);
  const steered = nose.localToWorld(new Vector3(1, 0, 0)).sub(nose.getWorldPosition(new Vector3()));
  expect(steered.x).toBeLessThan(-0.2);
  expect(nose.children.filter((part) => part instanceof Mesh)).toHaveLength(1);
  track.pose.visual.gear = 0.5;
  placeAircraft(aircraft, track.pose, 3, mainX, 2);
  expect(aircraft.gear.scale.y).toBe(0.5);
  expect(aircraft.gear.position.y).toBe(1);
  expect(aircraft.gear.visible).toBe(true);
  track.pose.visual.gear = 0;
  placeAircraft(aircraft, track.pose, 3, mainX, 2);
  expect(aircraft.gear.visible).toBe(false);
});
