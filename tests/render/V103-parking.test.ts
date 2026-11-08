import { expect, test } from 'vitest';
import { Matrix4 } from 'three';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { allocateId, type ParkingLayout } from '../../src/schema';
import { occupiedSpaces, parkedColour, pickParkedCar } from '../../src/render/parked-cars';
import { stripTicks } from '../../src/render/strip-geometry';
import { placeStreet, parkingBandEdge } from '../../src/render/street';
import { style } from '../../src/render/style';
import type { ParkedCarsSnapshot } from '../../src/render/types';
import { cityHeights } from '../../src/render3d/heights';
import { ParkedCars3D } from '../../src/render3d/parked-cars';
import { stripGeometry } from '../../src/render3d/strips';

function fixture(layout: ParkingLayout = 'parallel', side: 'left' | 'right' = 'right') {
  const b = buildCity('Visible parking', 103);
  const road = b.road(b.node(0, 0), b.node(150, 0));
  const id = allocateId(b.city, 'pk');
  b.city.parking = {
    [id]: {
      id,
      name: null,
      kind: 'roadside',
      capacity: 20,
      access: 'public',
      placeId: null,
      connectors: [],
      shape: null,
      provenance: { source: 'authored' },
      strip: { roadId: road.id, side, fromM: 20, toM: 130, layout },
    },
  };
  const result = compile(b.city);
  if (!result.ok) throw new Error('parking fixture');
  return { source: b.city, city: result.compiled, id };
}

function stock(count: number): ParkedCarsSnapshot {
  const occupied = new Uint8Array(Math.ceil(count / 8));
  occupied[0] = 1;
  occupied[1] = 2; // crosses the byte boundary: compiled space 9, not space 1
  const vclass = new Uint8Array(count);
  vclass[9] = 1;
  return {
    occupied,
    vclass,
    id: new Uint32Array(count),
    hues: new Uint32Array(count).fill(0x8ebbbb),
  };
}

test('V103 occupancy indexes, synthetic cars, class colours and body picking share slot poses', () => {
  const { city } = fixture();
  const snapshot = stock(city.parkingSpaces!.length);
  const spaces = occupiedSpaces(snapshot, city.parkingSpaces!.length);
  expect(spaces).toEqual([0, 9]);
  for (const index of spaces) {
    const space = city.parkingSpaces![index]!;
    expect(pickParkedCar(city, spaces, snapshot, space.position, 8)).toBe(index);
    expect(snapshot.id[index]).toBe(0);
  }
  expect(pickParkedCar(city, spaces, snapshot, city.parkingSpaces![1]!.position, 8)).toBeNull();
  expect(parkedColour(snapshot, 9, true)).not.toBe(parkedColour(snapshot, 0, true));
  expect(parkedColour(snapshot, 0, false)).toBeLessThan(snapshot.hues[0]!);
  const view = new ParkedCars3D(city, cityHeights(city, { nodes: {}, places: {} }));
  view.setStyle(8, false);
  view.setSnapshot(snapshot);
  expect(view.mesh.count).toBe(2);
  const matrix = new Matrix4();
  view.mesh.getMatrixAt(1, matrix);
  expect(matrix.elements[12]).toBeCloseTo(city.parkingSpaces![9]!.position.x);
  expect(matrix.elements[14]).toBeCloseTo(city.parkingSpaces![9]!.position.y);
  expect(matrix.elements[0]).toBeCloseTo(style.vehicleClasses.van.lengthM);
  expect(view.spaceAt(1)).toBe(9);
  view.setSnapshot(null);
  expect(view.mesh.count).toBe(0);
  view.mesh.geometry.dispose();
  view.mesh.material.dispose();
  view.mesh.dispose();
});

test('V103 overview parked-car tolerance leaves adjacent asphalt editable and preserves body picking', () => {
  const { city } = fixture();
  const snapshot = stock(city.parkingSpaces!.length);
  const space = city.parkingSpaces![0]!;
  const zoom = 0.25;
  expect(pickParkedCar(city, [0], snapshot, { x: space.position.x, y: 0 }, zoom)).toBeNull();
  expect(pickParkedCar(city, [0], snapshot, { x: space.position.x, y: 1.5 }, zoom)).toBeNull();
  expect(pickParkedCar(city, [0], snapshot, space.position, zoom)).toBe(0);
  expect(
    pickParkedCar(city, [0], snapshot, { x: space.position.x + 1, y: space.position.y }, 8),
  ).toBe(0);
  expect(
    pickParkedCar(city, [0], snapshot, { x: space.position.x, y: space.position.y + 2 }, zoom),
  ).toBe(0);
});

test.each(['parallel', 'angled', 'perpendicular'] as const)(
  'V103 %s bands draw on both sides, paint only mapped slots and move curbs outside them',
  (layout) => {
    for (const side of ['left', 'right'] as const) {
      const { city, source, id } = fixture(layout, side);
      const heights = cityHeights(city, source);
      const geometry = stripGeometry(city, source, heights);
      expect(geometry.surface.getAttribute('position').count).toBeGreaterThan(0);
      expect(geometry.paint.getAttribute('position').count).toBeGreaterThan(0);
      for (const buffer of Object.values(geometry)) {
        expect(Array.from(buffer.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        buffer.dispose();
      }
      expect(stripTicks(city, source)).toHaveLength(city.parkingSpaces!.length);
      source.parking![id]!.provenance.inferred = ['strip'];
      expect(stripTicks(city, source)).toEqual([]);
      const road = city.roads[0]!,
        half = road.surface.length / 2;
      const edge =
        side === 'left' ? road.surface.slice(0, half) : road.surface.slice(half).reverse();
      const outside = parkingBandEdge(city, road, side, edge);
      const middle = outside.find((p) => Math.abs(p.x - 75) < 1)!;
      expect(Math.abs(middle.y)).toBeCloseTo(1.5 + city.strips![0]!.widthM);
      const furniture = placeStreet(city, source, []);
      for (const curb of furniture.curbs)
        for (const p of curb.points)
          if (p.x > 25 && p.x < 125 && Math.sign(p.y) === (side === 'right' ? 1 : -1))
            expect(Math.abs(p.y)).toBeGreaterThan(1.5 + city.strips![0]!.widthM);
      if (side === 'right') {
        expect(furniture.lamps.length).toBeGreaterThan(0);
        for (const lamp of furniture.lamps)
          if (lamp.pos.x > 25 && lamp.pos.x < 125)
            expect(lamp.pos.y).toBeCloseTo(2 + city.strips![0]!.widthM);
      }
    }
  },
);

test('V103 a straight parking band follows a mid-road terrain fold', () => {
  const { city, source } = fixture();
  const samples = new Int16Array([0, 100, 0, 0, 100, 0]);
  source.terrain = {
    source: 'test',
    originM: { x: 0, y: -30 },
    cellM: 60,
    cols: 3,
    rows: 2,
    baseM: 0,
    heights: Buffer.from(samples.buffer).toString('base64'),
  };
  const geometry = stripGeometry(city, source, cityHeights(city, source));
  const positions = geometry.surface.getAttribute('position');
  expect(positions.count).toBeGreaterThan(100);
  expect(
    Array.from({ length: positions.count }, (_, i) => positions.getY(i)).some((y) => y > 9.9),
  ).toBe(true);
  geometry.surface.dispose();
  geometry.paint.dispose();
});
