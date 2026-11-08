import { expect, it } from 'vitest';
import { buildCity } from '../fixtures/build-city';
import { compile } from '../network';
import type { VehicleSnapshot } from '../render/types';
import { pickVehicle } from '../render/picking';
import { pausedSnapshot, remapParkedCars } from './drawn-snapshot';
import { allocateId } from '../schema';

it('exposes the paused rendered position during lane changes in both directions', () => {
  const { city, node, road } = buildCity('Lane change pick', 1);
  road(node(0, 0), node(100, 0), { lanes: 2 });
  const result = compile(city);
  if (!result.ok) throw new Error('City must compile');
  const width = result.compiled.lanes[0]!.widthM;
  const snapshot: VehicleSnapshot = {
    timeS: 1,
    count: 2,
    id: new Uint32Array([1, 2]),
    x: new Float32Array([10, 20]),
    y: new Float32Array([30, 40]),
    heading: new Float32Array([0, 0]),
    speed: new Float32Array(2),
    lateralM: new Float32Array([width / 4, -width / 4]),
    lane: new Int32Array([0, 1]),
    state: new Uint8Array([1, 1]),
    vclass: new Uint8Array([0, 2]),
    fade: new Float32Array([1, 1]),
  };
  const drawn = pausedSnapshot(snapshot, result.compiled, 2);
  expect(drawn.vclass).toEqual(snapshot.vclass);
  expect(drawn.x).toEqual(snapshot.x);
  // At 3/4 progress the smoothstep leaves 5/32 of the lane width on the source side.
  expect(drawn.y[0]).toBeCloseTo(30 + (width * 5) / 32, 5);
  expect(drawn.y[1]).toBeCloseTo(40 - (width * 5) / 32, 5);
  expect(snapshot.y).toEqual(new Float32Array([30, 40]));
  expect(pausedSnapshot(snapshot, result.compiled, 0).y).toEqual(snapshot.y);
  const renderedY = new Float32Array([30 + (width * 5) / 32, 40 - (width * 5) / 32]);
  expect(pickVehicle({ x: 10, y: 30 }, 32, snapshot.id, snapshot.x, renderedY, 2)).toBeNull();
  expect(
    pickVehicle({ x: drawn.x[0]!, y: drawn.y[0]! }, 32, snapshot.id, snapshot.x, renderedY, 2),
  ).toEqual({ kind: 'vehicle', id: 1 });
});

it('remaps parked stock by facility and local slot after an earlier facility is removed', () => {
  const { city, node, road } = buildCity('Parking edit presentation', 103);
  const street = road(node(0, 0), node(120, 0));
  city.parking = {};
  for (const side of ['left', 'right'] as const) {
    const id = allocateId(city, 'pk');
    city.parking[id] = {
      id,
      name: null,
      kind: 'roadside',
      capacity: 2,
      access: 'public',
      placeId: null,
      shape: null,
      connectors: [],
      provenance: { source: 'authored' },
      strip: { roadId: street.id, side, fromM: 20, toM: 31, layout: 'parallel' },
    };
  }
  const before = compile(city);
  if (!before.ok) throw new Error('before');
  const stock = {
    occupied: new Uint8Array([0b1101]),
    id: new Uint32Array([10, 0, 20, 21]),
    vclass: new Uint8Array([1, 0, 0, 1]),
    hues: new Uint32Array([1, 0, 2, 3]),
  };
  delete city.parking[Object.keys(city.parking)[0]!];
  const after = compile(city);
  if (!after.ok) throw new Error('after');
  const mapped = remapParkedCars(stock, before.compiled, after.compiled)!;
  expect([...mapped.occupied]).toEqual([3]);
  expect([...mapped.id]).toEqual([20, 21]);
  expect([...mapped.vclass]).toEqual([0, 1]);
  expect([...mapped.hues]).toEqual([2, 3]);
  expect(remapParkedCars(stock, before.compiled, before.compiled)).toBe(stock);
  expect(remapParkedCars(null, before.compiled, after.compiled)).toBeNull();
});
