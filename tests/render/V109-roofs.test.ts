import { expect, test } from 'vitest';
import type { BufferGeometry } from 'three';
import type { ContextFeature, RoofShape } from '../../src/schema';
import { buildRoof } from '../../src/render3d/roofs';

type Building = Extract<ContextFeature, { kind: 'area' }>;
const rectangle = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
  { x: 0, y: 0 },
];
const building = (shape: RoofShape, extra: Partial<Building> = {}): Building => ({
  kind: 'area',
  class: 'building',
  rings: [rectangle],
  heightM: 14,
  roof: { shape, heightM: 4 },
  ...extra,
});

function heightAt(geometry: BufferGeometry, x: number, z: number) {
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i),
      az = p.getZ(i);
    const bx = p.getX(i + 1),
      bz = p.getZ(i + 1);
    const cx = p.getX(i + 2),
      cz = p.getZ(i + 2);
    const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(determinant) < 1e-9) continue;
    const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant;
    const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant;
    const c = 1 - a - b;
    if (Math.min(a, b, c) >= -1e-6) return a * p.getY(i) + b * p.getY(i + 1) + c * p.getY(i + 2);
  }
  return undefined;
}

function projectedArea(geometry: BufferGeometry) {
  const p = geometry.getAttribute('position');
  let area = 0;
  for (let i = 0; i < p.count; i += 3)
    area +=
      Math.abs(
        (p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
          (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i)),
      ) / 2;
  return area;
}

const pitched: RoofShape[] = [
  'gabled',
  'hipped',
  'half-hipped',
  'pyramidal',
  'skillion',
  'mansard',
  'gambrel',
];

test.each(pitched)(
  'V109 %s covers the footprint up to the specified total height deterministically',
  (shape) => {
    const result = buildRoof(building(shape));
    expect(result.shape).toBe(shape);
    expect(result.wallHeightM).toBe(10);
    expect(result.roofHeightM).toBe(4);
    expect(projectedArea(result.roof)).toBeCloseTo(200, 4);
    const p = result.roof.getAttribute('position');
    const heights = Array.from({ length: p.count }, (_, i) => p.getY(i));
    expect(Math.max(...heights)).toBeCloseTo(14, 5);
    expect(Math.min(...heights)).toBeCloseTo(10, 5);
    for (let x = 0; x <= 20; x += 0.5)
      for (let z = 0; z <= 10; z += 0.5)
        expect(heightAt(result.roof, x, z), `${shape} at ${x},${z}`).toBeDefined();
    for (let i = 0; i < p.count; i++)
      expect(result.roof.getAttribute('normal').getY(i)).toBeGreaterThan(0);
    const again = buildRoof(building(shape));
    expect(Array.from(p.array)).toEqual(Array.from(again.roof.getAttribute('position').array));
    expect(Array.from(result.infill.getAttribute('position').array)).toEqual(
      Array.from(again.infill.getAttribute('position').array),
    );
  },
);

test.each<RoofShape>(['gabled', 'hipped', 'half-hipped', 'gambrel', 'mansard'])(
  'V109 %s ridge follows the long side and across overrides it',
  (shape) => {
    for (const across of [false, true]) {
      const result = buildRoof(
        building(shape, { roof: { shape, heightM: 4, orientation: across ? 'across' : 'along' } }),
      );
      const p = result.roof.getAttribute('position');
      const xs: number[] = [],
        zs: number[] = [];
      for (let i = 0; i < p.count; i++)
        if (Math.abs(p.getY(i) - 14) < 1e-5) {
          xs.push(p.getX(i));
          zs.push(p.getZ(i));
        }
      const width = Math.max(...xs) - Math.min(...xs);
      const depth = Math.max(...zs) - Math.min(...zs);
      expect(across ? depth - width : width - depth).toBeGreaterThan(0.1);
    }
  },
);

test('V109 direction is downhill compass bearing and overrides orientation', () => {
  const skillion = buildRoof(
    building('skillion', { roof: { shape: 'skillion', heightM: 4, directionDeg: 90 } }),
  );
  expect(heightAt(skillion.roof, 0, 5)).toBeCloseTo(14);
  expect(heightAt(skillion.roof, 20, 5)).toBeCloseTo(10);
  const gabled = buildRoof(
    building('gabled', {
      roof: { shape: 'gabled', heightM: 4, directionDeg: 90, orientation: 'along' },
    }),
  );
  expect(heightAt(gabled.roof, 10, 0)).toBeCloseTo(14);
  expect(heightAt(gabled.roof, 10, 10)).toBeCloseTo(14);
  expect(heightAt(gabled.roof, 0, 5)).toBeCloseTo(10);
});

test('V109 gable infill closes both triangular ends above the wall', () => {
  const { infill } = buildRoof(building('gabled'));
  const p = infill.getAttribute('position');
  expect(p.count).toBeGreaterThan(0);
  const peaks = Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]).filter(
    ([, y]) => y === 14,
  );
  expect(peaks).toContainEqual([0, 14, 5]);
  expect(peaks).toContainEqual([20, 14, 5]);
  for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeGreaterThanOrEqual(10);
});

test('V109 near-rectangular roofs follow the exact notch, with no rectangle overhang', () => {
  const rings = [
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 11, y: 10 },
      { x: 11, y: 8 },
      { x: 9, y: 8 },
      { x: 9, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ],
  ];
  const result = buildRoof(building('hipped', { rings }));
  expect(result.shape).toBe('hipped');
  expect(projectedArea(result.roof)).toBeCloseTo(196, 4);
  expect(heightAt(result.roof, 10, 9)).toBeUndefined();
  expect(heightAt(result.roof, 10, 7.99)).toBeDefined();
});

test('V109 flat fallbacks retain courtyard holes and explain unsupported footprints', () => {
  const courtyard = [
    { x: 5, y: 3 },
    { x: 15, y: 3 },
    { x: 15, y: 7 },
    { x: 5, y: 7 },
    { x: 5, y: 3 },
  ];
  const result = buildRoof(building('hipped', { rings: [rectangle, courtyard] }));
  expect(result.shape).toBe('flat');
  expect(result.fallbackReason).toBe('courtyard');
  expect(result.wallHeightM).toBe(14);
  expect(result.roofHeightM).toBe(0);
  expect(heightAt(result.roof, 10, 5)).toBeUndefined();
  expect(projectedArea(result.roof)).toBeCloseTo(160, 4);
  const triangle = buildRoof(
    building('gabled', {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 0, y: 10 },
          { x: 0, y: 0 },
        ],
      ],
    }),
  );
  expect(triangle.shape).toBe('flat');
  expect(triangle.fallbackReason).toBe('irregular-footprint');
  expect(buildRoof(building('onion')).fallbackReason).toBe('unsupported-shape');
});

test('V109 roofs use height and level precedence, capped defaults, and leave untagged roofs flat', () => {
  const levels = buildRoof(
    building('gabled', { heightM: undefined, levels: 5, roof: { shape: 'gabled', levels: 2 } }),
  );
  expect(levels.wallHeightM).toBe(9);
  expect(levels.roofHeightM).toBe(6);
  const defaults = buildRoof(building('gabled', { heightM: undefined, roof: { shape: 'gabled' } }));
  expect(defaults.roofHeightM).toBeGreaterThan(0);
  expect(defaults.roofHeightM).toBeLessThanOrEqual(5);
  expect(defaults.wallHeightM + defaults.roofHeightM).toBe(10);
  const flat = buildRoof(building('flat', { roof: undefined }));
  expect(flat.shape).toBe('flat');
  expect(flat.fallbackReason).toBeUndefined();
  expect(flat.wallHeightM).toBe(14);
});
