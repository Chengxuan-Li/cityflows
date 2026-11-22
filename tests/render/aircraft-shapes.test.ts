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
import { buildAircraftOutline } from '../../src/render/aircraft-outline';
import { batchAircraftMesh, buildAircraftMesh } from '../../src/render3d/aircraft-mesh';
import { aircraftTypes } from '../../src/schema/aircraft';

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
    const { root, gear, propellers, rotors } = aircraft;
    const countMeshes = () => {
      let count = 0;
      root.traverse((object) => {
        if (object instanceof Mesh) count++;
      });
      return count;
    };
    const count = countMeshes();
    const bounds = new Box3().setFromObject(root, true);
    const pivots = [gear, ...propellers, ...rotors];
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
      expect(pivot.children).toHaveLength(1);
      expect(pivot.getWorldQuaternion(new Quaternion()).angleTo(axes[i]!)).toBeCloseTo(0, 5);
    }
    if (id === 'A20N')
      sampleWings().forEach((height, i) => expect(height).toBeCloseTo(wingHeights[i]!, 5));
  },
);
