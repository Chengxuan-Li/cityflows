import { expect, test } from 'vitest';
import { Float32BufferAttribute, type BufferGeometry } from 'three';
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
  'round',
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

test.each<RoofShape>(['gabled', 'hipped', 'half-hipped', 'gambrel', 'mansard', 'round'])(
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
  // TASK-227 and 236: pitched courtyards come from the straight skeleton.
  const result = buildRoof(building('dome', { rings: [rectangle, courtyard] }));
  expect(result.shape).toBe('flat');
  expect(result.fallbackReason).toBe('courtyard');
  expect(result.wallHeightM).toBe(14);
  expect(result.roofHeightM).toBe(0);
  expect(heightAt(result.roof, 10, 5)).toBeUndefined();
  expect(projectedArea(result.roof)).toBeCloseTo(160, 4);
  const notch = buildRoof(
    building('onion', {
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
          { x: 12, y: 10 },
          { x: 10, y: 1 },
          { x: 8, y: 10 },
          { x: 0, y: 10 },
          { x: 0, y: 0 },
        ],
      ],
    }),
  );
  expect(notch.shape).toBe('flat');
  expect(notch.fallbackReason).toBe('irregular-footprint');
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

// TASK-210: round, dome and onion roofs.
type Ring = { x: number; y: number }[];
const polygon = (n: number, r: number, cx = 0, cy = 0, phase = 0): Ring => {
  const ring = Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos(phase + (2 * Math.PI * i) / n),
    y: cy + r * Math.sin(phase + (2 * Math.PI * i) / n),
  }));
  return [...ring, ring[0]!];
};
const box = (w: number, d: number): Ring => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: d },
  { x: 0, y: d },
  { x: 0, y: 0 },
];

function inside(ring: Ring, x: number, z: number) {
  const open = ring.slice(0, -1);
  const distance = (i: number) => {
    const p = open[i]!,
      q = open[(i + 1) % open.length]!;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - p.x) * (q.x - p.x) + (z - p.y) * (q.y - p.y)) / ((q.x - p.x) ** 2 + (q.y - p.y) ** 2),
      ),
    );
    return Math.hypot(x - p.x - t * (q.x - p.x), z - p.y - t * (q.y - p.y));
  };
  let crossings = 0;
  open.forEach((p, i) => {
    const q = open[(i + 1) % open.length]!;
    if (p.y > z !== q.y > z && x < p.x + ((z - p.y) * (q.x - p.x)) / (q.y - p.y)) crossings++;
  });
  return crossings % 2 === 1 || open.some((_, i) => distance(i) < 1e-4);
}

/** Every vertex over the outline and between the wall top and the total height; the surface
 * closed: each edge shared by two triangles in opposite directions (one outward winding), except
 * its rim, which is exactly the outline at the wall top. */
function expectClosedRoof(geometry: BufferGeometry, ring: Ring, wall: number, total: number) {
  const p = geometry.getAttribute('position');
  expect(p.count).toBeGreaterThan(0);
  const key = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(3)).join();
  const edges = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    expect(inside(ring, p.getX(i), p.getZ(i)), `vertex ${key(i)} over the outline`).toBe(true);
    expect(p.getY(i)).toBeGreaterThanOrEqual(wall - 1e-4);
    expect(p.getY(i)).toBeLessThanOrEqual(total + 1e-4);
  }
  for (let i = 0; i < p.count; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = key(i + j),
        b = key(i + ((j + 1) % 3));
      if (a !== b) edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
    }
  let rim = 0;
  for (const [edge, count] of edges) {
    expect(count, edge).toBe(1);
    const [a, b] = edge.split('|');
    if (edges.has(`${b}|${a}`)) continue;
    const [ax, ay, az] = a!.split(',').map(Number),
      [bx, by, bz] = b!.split(',').map(Number);
    expect(ay, `open edge ${edge} at the wall top`).toBeCloseTo(wall, 3);
    expect(by).toBeCloseTo(wall, 3);
    rim += Math.hypot(bx! - ax!, bz! - az!);
  }
  const open = ring.slice(0, -1);
  const perimeter = open.reduce((sum, q, i) => {
    const r = open[(i + 1) % open.length]!;
    return sum + Math.hypot(r.x - q.x, r.y - q.y);
  }, 0);
  expect(rim).toBeCloseTo(perimeter, 2);
}

const topY = (geometry: BufferGeometry) => {
  const p = geometry.getAttribute('position');
  let best = 0;
  for (let i = 1; i < p.count; i++) if (p.getY(i) > p.getY(best)) best = i;
  return { x: p.getX(best), y: p.getY(best), z: p.getZ(best) };
};

test.each([
  ['circular', polygon(32, 6, 10, 10)],
  ['square', box(12, 12)],
  ['rectangular', box(20, 10)],
] as const)('TASK-210 dome on a %s outline is a closed vault within the outline', (_, ring) => {
  const result = buildRoof(
    building('dome', { rings: [ring], heightM: 20, roof: { shape: 'dome', heightM: 5 } }),
  );
  expect(result.shape).toBe('dome');
  expect(result.fallbackReason).toBeUndefined();
  expect(result.wallHeightM).toBe(15);
  expectClosedRoof(result.roof, ring, 15, 20);
  expect(result.infill.getAttribute('position').count).toBe(0);
  const apex = topY(result.roof);
  expect(apex.y).toBeCloseTo(20, 5);
  const xs = ring.map((p) => p.x),
    zs = ring.map((p) => p.y);
  expect(apex.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 4);
  expect(apex.z).toBeCloseTo((Math.min(...zs) + Math.max(...zs)) / 2, 4);
});

test('TASK-210 a dome on a circle is a hemisphere at its radius and a spherical cap below it', () => {
  const ring = polygon(32, 6);
  for (const height of [6, 3]) {
    const result = buildRoof(
      building('dome', { rings: [ring], heightM: 20, roof: { shape: 'dome', heightM: height } }),
    );
    const sphere = (36 + height ** 2) / (2 * height);
    const centre = 20 - sphere;
    const p = result.roof.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      expect(Math.hypot(p.getX(i), p.getY(i) - centre, p.getZ(i))).toBeCloseTo(sphere, 3);
  }
  // Without roof:height a dome is a hemisphere, as far as half the building allows.
  const tall = buildRoof(building('dome', { rings: [ring], heightM: 20, roof: { shape: 'dome' } }));
  expect(tall.roofHeightM).toBeCloseTo(6, 6);
});

test.each([
  ['octagonal', polygon(8, 1.5, 5, 5, Math.PI / 8)],
  ['square', box(3, 3)],
] as const)(
  'TASK-210 onion on a %s outline bulges, narrows to a point and stays closed',
  (_, ring) => {
    const result = buildRoof(
      building('onion', { rings: [ring], heightM: 31, roof: { shape: 'onion', heightM: 4 } }),
    );
    expect(result.shape).toBe('onion');
    expectClosedRoof(result.roof, ring, 27, 31);
    const p = result.roof.getAttribute('position');
    const centre = { x: 1.5 + (ring[0]!.x > 4 ? 3.5 : 0), z: 1.5 + (ring[0]!.x > 4 ? 3.5 : 0) };
    // The widest section is above the neck: the bulb.
    const reach = (from: number, to: number) => {
      let best = 0;
      for (let i = 0; i < p.count; i++)
        if (p.getY(i) > from && p.getY(i) < to)
          best = Math.max(best, Math.hypot(p.getX(i) - centre.x, p.getZ(i) - centre.z));
      return best;
    };
    expect(reach(27.1, 28.6)).toBeGreaterThan(reach(27.01, 27.3) * 1.1);
    expect(reach(30, 31.01)).toBeLessThan(reach(27.1, 28.6) * 0.5);
    const apex = topY(result.roof);
    expect(Math.hypot(apex.x - centre.x, apex.z - centre.z)).toBeLessThan(1e-4);
    expect(apex.y).toBeCloseTo(31, 5);
  },
);

test('TASK-210 round on a circle is a barrel clipped to the outline, closed by its end walls', () => {
  const ring = polygon(24, 5);
  const result = buildRoof(
    building('round', { rings: [ring], heightM: 14, roof: { shape: 'round', heightM: 4 } }),
  );
  expect(result.shape).toBe('round');
  const p = result.roof.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    expect(inside(ring, p.getX(i), p.getZ(i))).toBe(true);
    expect(p.getY(i)).toBeGreaterThanOrEqual(10 - 1e-5);
    expect(p.getY(i)).toBeLessThanOrEqual(14 + 1e-5);
  }
  const open = ring.slice(0, -1);
  const area = open.reduce((sum, q, i) => {
    const r = open[(i + 1) % open.length]!;
    return sum + (q.x * r.y - r.x * q.y) / 2;
  }, 0);
  expect(projectedArea(result.roof)).toBeCloseTo(area, 3);
  expect(result.infill.getAttribute('position').count).toBeGreaterThan(0);
});

test('TASK-210 the barrel vault ends are closed to the wall top under its arc', () => {
  const { infill } = buildRoof(building('round'));
  const p = infill.getAttribute('position');
  let ends = 0;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i + 1) - p.getX(i),
      ay = p.getY(i + 1) - p.getY(i),
      az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i),
      by = p.getY(i + 2) - p.getY(i),
      bz = p.getZ(i + 2) - p.getZ(i);
    ends += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
  }
  // Two ends under a 12-segment half ellipse, 5 m across and 4 m high.
  expect(ends).toBeCloseTo(2 * 5 * 4 * 6 * Math.sin(Math.PI / 12), 3);
});

test('TASK-210 fallbacks: box shapes take convex outlines, domes need a star-shaped one', () => {
  const trapezoid = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 16, y: 10 },
    { x: 4, y: 10 },
    { x: 0, y: 0 },
  ];
  for (const shape of ['gabled', 'hipped', 'round'] as const) {
    const result = buildRoof(building(shape, { rings: [trapezoid] }));
    expect(result.shape).toBe(shape);
    expect(projectedArea(result.roof)).toBeCloseTo(160, 4);
  }
  const hook = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
    { x: 0, y: 17 },
    { x: 17, y: 17 },
    { x: 17, y: 3 },
    { x: 0, y: 3 },
    { x: 0, y: 0 },
  ];
  for (const shape of ['dome', 'onion'] as const) {
    const result = buildRoof(building(shape, { rings: [hook] }));
    expect(result.shape).toBe('flat');
    expect(result.fallbackReason).toBe('irregular-footprint');
  }
  const courtyard = polygon(6, 2, 10, 5);
  expect(buildRoof(building('dome', { rings: [rectangle, courtyard] })).fallbackReason).toBe(
    'courtyard',
  );
  // roof:levels=0: no storey in the roof, which still has its height.
  const noStorey = buildRoof(
    building('gabled', { heightM: undefined, levels: 4, roof: { shape: 'gabled', levels: 0 } }),
  );
  expect(noStorey.roofHeightM).toBeCloseTo(5 * Math.tan((35 * Math.PI) / 180), 6);
});

// TASK-227: pitched roofs on concave outlines and courtyards, from the straight skeleton.
const closed = (...xy: number[]): Ring => {
  const ring = Array.from({ length: xy.length / 2 }, (_, i) => ({
    x: xy[2 * i]!,
    y: xy[2 * i + 1]!,
  }));
  return [...ring, ring[0]!];
};
const outlines = {
  L: closed(0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20),
  T: closed(0, 0, 30, 0, 30, 8, 19, 8, 19, 25, 11, 25, 11, 8, 0, 8),
  U: closed(0, 0, 30, 0, 30, 20, 22, 20, 22, 8, 8, 8, 8, 20, 0, 20),
};
const ringArea = (ring: Ring) =>
  Math.abs(
    ring.slice(0, -1).reduce((sum, p, i) => sum + p.x * ring[i + 1]!.y - ring[i + 1]!.x * p.y, 0) /
      2,
  );

test.each(
  (['hipped', 'pyramidal', 'gabled'] as const).flatMap((shape) =>
    Object.entries(outlines).map(([name, ring]) => [shape, name, ring] as const),
  ),
)('TASK-227 %s on a concave %s outline covers it at one pitch', (shape, _, ring) => {
  const result = buildRoof(building(shape, { rings: [ring], roof: { shape, heightM: 4 } }));
  expect(result.shape).toBe(shape);
  expect(result.fallbackReason).toBeUndefined();
  expect(result.wallHeightM).toBe(10);
  expect(projectedArea(result.roof)).toBeCloseTo(ringArea(ring), 4);
  const xs = ring.map((p) => p.x),
    zs = ring.map((p) => p.y);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5)
      if (inside(ring, x, z)) expect(heightAt(result.roof, x, z), `${x},${z}`).toBeDefined();
  const p = result.roof.getAttribute('position'),
    n = result.roof.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    expect(inside(ring, p.getX(i), p.getZ(i))).toBe(true);
    expect(n.getY(i)).toBeGreaterThan(0);
  }
  // Every wing is 8 m wide: its ridge 4 m from the eaves, at the roof height, a 45 degree pitch.
  expect(Math.max(...Array.from({ length: p.count }, (_, i) => p.getY(i)))).toBeCloseTo(14, 6);
  expect(heightAt(result.roof, (ring[0]!.x + ring[1]!.x) / 2, 2)).toBeCloseTo(12, 6);
  if (shape === 'gabled') expect(result.infill.getAttribute('position').count).toBeGreaterThan(0);
  else expectClosedRoof(result.roof, ring, 10, 14);
  const again = buildRoof(building(shape, { rings: [ring], roof: { shape, heightM: 4 } }));
  expect(Array.from(again.roof.getAttribute('position').array)).toEqual(Array.from(p.array));
});

test('TASK-227 gabled: the short ends of the wings stand vertical, the corner stays hipped', () => {
  const ring = outlines.L;
  const result = buildRoof(
    building('gabled', { rings: [ring], roof: { shape: 'gabled', heightM: 4 } }),
  );
  const p = result.infill.getAttribute('position');
  expect(p.count).toBe(6);
  const tops: number[][] = [];
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) > 10) tops.push([p.getX(i), p.getY(i), p.getZ(i)]);
  expect(tops).toHaveLength(2);
  expect(tops).toContainEqual([20, 14, 4]);
  expect(tops).toContainEqual([4, 14, 20]);
  // Facing out of the building: east and south.
  const n = result.infill.getAttribute('normal');
  expect([n.getX(0), n.getZ(0)].map(Math.round)).toEqual([1, 0]);
  expect([n.getX(3), n.getZ(3)].map(Math.round)).toEqual([0, 1]);
  // The ridges run out to the gables; the outer corner and the valley keep their hips.
  expect(heightAt(result.roof, 19.9, 4)).toBeCloseTo(14, 6);
  expect(heightAt(result.roof, 1, 1)).toBeCloseTo(11, 6);
  expect(heightAt(result.roof, 7.5, 7.5)).toBeCloseTo(10.5, 6);
  // The hipped roof keeps its hipped ends.
  const hipped = buildRoof(
    building('hipped', { rings: [ring], roof: { shape: 'hipped', heightM: 4 } }),
  );
  expect(heightAt(hipped.roof, 19.9, 4)).toBeCloseTo(10.1, 6);
});

test('TASK-227 a courtyard roof slopes to the courtyard and leaves it open', () => {
  const outer = box(30, 20),
    court = closed(8, 6, 22, 6, 22, 14, 8, 14);
  const result = buildRoof(
    building('hipped', {
      rings: [outer, court],
      heightM: 13,
      roof: { shape: 'hipped', heightM: 3 },
    }),
  );
  expect(result.shape).toBe('hipped');
  expect(result.fallbackReason).toBeUndefined();
  expect(projectedArea(result.roof)).toBeCloseTo(600 - 112, 4);
  expect(heightAt(result.roof, 15, 10)).toBeUndefined();
  // The long sides are 6 m deep, ridge at 3 m from both walls; the corners rise to 4 m: the peak.
  expect(heightAt(result.roof, 15, 3)).toBeCloseTo(10 + 3 * (3 / 4), 6);
  expect(heightAt(result.roof, 4, 4)).toBeCloseTo(13, 6);
});

test('TASK-227 one pitch from the widest wing: the default height and the cap', () => {
  // Wings 8 m and 32 m wide. By default the widest wing's ridge is 35 degrees up, at most 8 m
  // and half the building; the 8 m wing then has the same pitch and a lower ridge.
  const ring = closed(0, 0, 60, 0, 60, 40, 28, 40, 28, 8, 0, 8);
  const result = buildRoof(
    building('hipped', { rings: [ring], heightM: 30, roof: { shape: 'hipped' } }),
  );
  expect(result.roofHeightM).toBe(8);
  expect(heightAt(result.roof, 5, 4)).toBeCloseTo(22 + 8 * (4 / 16), 6);
  const narrow = buildRoof(
    building('hipped', { rings: [outlines.L], heightM: 30, roof: { shape: 'hipped' } }),
  );
  expect(narrow.roofHeightM).toBeCloseTo(4 * Math.tan((35 * Math.PI) / 180), 9);
  // A box shape on a convex outline keeps TASK-210's geometry: the hipped rectangle's end.
  expect(heightAt(buildRoof(building('hipped')).roof, 19.9, 5)).toBeCloseTo(10.08, 6);
});

// TASK-236: the other pitched shapes on concave outlines, from the same skeleton.
function joined(...geometries: BufferGeometry[]) {
  const positions = geometries.flatMap((g) => Array.from(g.getAttribute('position').array));
  const result = geometries[0]!.clone();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return result;
}

test.each(
  (['half-hipped', 'gambrel', 'mansard', 'round', 'skillion'] as const).flatMap((shape) =>
    Object.entries(outlines).map(([name, ring]) => [shape, name, ring] as const),
  ),
)('TASK-236 %s on a concave %s outline covers it and closes with its walls', (shape, _, ring) => {
  const result = buildRoof(building(shape, { rings: [ring], roof: { shape, heightM: 4 } }));
  expect(result.shape).toBe(shape);
  expect(result.fallbackReason).toBeUndefined();
  expect(result.wallHeightM).toBe(10);
  expect(projectedArea(result.roof)).toBeCloseTo(ringArea(ring), 4);
  const xs = ring.map((p) => p.x),
    zs = ring.map((p) => p.y);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5)
      if (inside(ring, x, z)) expect(heightAt(result.roof, x, z), `${x},${z}`).toBeDefined();
  const p = result.roof.getAttribute('position'),
    n = result.roof.getAttribute('normal');
  for (let i = 0; i < p.count; i++) expect(n.getY(i)).toBeGreaterThan(0);
  expect(Math.max(...Array.from({ length: p.count }, (_, i) => p.getY(i)))).toBeCloseTo(14, 6);
  // Roof and standing ends together are closed, open only along the outline at the wall top.
  expectClosedRoof(joined(result.roof, result.infill), ring, 10, 14);
  const again = buildRoof(building(shape, { rings: [ring], roof: { shape, heightM: 4 } }));
  expect(Array.from(again.roof.getAttribute('position').array)).toEqual(Array.from(p.array));
  expect(Array.from(again.infill.getAttribute('position').array)).toEqual(
    Array.from(result.infill.getAttribute('position').array),
  );
});

const along = (shape: RoofShape, x: number, z: number, ring = outlines.L) =>
  heightAt(buildRoof(building(shape, { rings: [ring], roof: { shape, heightM: 4 } })).roof, x, z);

test('TASK-236 mansard and gambrel break where their box roofs do, at one section on every wing', () => {
  // The L's wings are 8 m wide: the ridge 4 m in, at the roof height.
  // Mansard: 75% of the height a quarter of the way in, then the upper pitch; hipped ends.
  expect(along('mansard', 10, 0.5)).toBeCloseTo(10 + 3 * 0.5, 6);
  expect(along('mansard', 10, 2.5)).toBeCloseTo(13 + 1.5 / 3, 6);
  expect(along('mansard', 0.5, 14)).toBeCloseTo(11.5, 6);
  const mansard = buildRoof(
    building('mansard', { rings: [outlines.L], roof: { shape: 'mansard', heightM: 4 } }),
  );
  expect(mansard.infill.getAttribute('position').count).toBe(0);
  expectClosedRoof(mansard.roof, outlines.L, 10, 14);
  // Gambrel: 72% of the height at 35% of the way in, and gable ends standing under both pitches.
  expect(along('gambrel', 10, 0.7)).toBeCloseTo(10 + 2.88 / 2, 6);
  expect(along('gambrel', 10, 3)).toBeCloseTo(12.88 + 1.12 * (1.6 / 2.6), 6);
  expect(along('gambrel', 19.9, 4)).toBeCloseTo(14, 6);
  const gambrel = buildRoof(
    building('gambrel', { rings: [outlines.L], roof: { shape: 'gambrel', heightM: 4 } }),
  );
  const p = gambrel.infill.getAttribute('position');
  // Each end a pentagon (edge, two breaks, the ridge), in three triangles.
  expect(p.count).toBe(18);
  const tops = new Set<string>();
  for (let i = 0; i < p.count; i++)
    if (p.getX(i) === 20 && p.getY(i) > 10) tops.add([p.getY(i), p.getZ(i)].join());
  expect([...tops].sort()).toEqual([
    '12.880000114440918,1.399999976158142',
    '12.880000114440918,6.599999904632568',
    '14,4',
  ]);
});

test('TASK-236 half-hipped: the wing ends stand to half the ridge, under a hip at the same pitch', () => {
  // On the east end the ridge stops 2 m short of the wall, which stands to 12 m (half the roof).
  expect(along('half-hipped', 19.9, 4)).toBeCloseTo(12.1, 6);
  expect(along('half-hipped', 17.9, 4)).toBeCloseTo(14, 6);
  expect(along('half-hipped', 19.9, 0.5)).toBeCloseTo(10.5, 6);
  // The corner and the valley keep their hips, as on the gabled roof.
  expect(along('half-hipped', 1, 1)).toBeCloseTo(11, 6);
  expect(along('half-hipped', 7.5, 7.5)).toBeCloseTo(10.5, 6);
  const { infill } = buildRoof(
    building('half-hipped', { rings: [outlines.L], roof: { shape: 'half-hipped', heightM: 4 } }),
  );
  const p = infill.getAttribute('position');
  expect(p.count).toBe(12);
  const tops: number[][] = [];
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) > 10) tops.push([p.getX(i), p.getY(i), p.getZ(i)]);
  for (const corner of [
    [20, 12, 2],
    [20, 12, 6],
    [2, 12, 20],
    [6, 12, 20],
  ])
    expect(tops).toContainEqual(corner);
  // Facing out of the building: the east end east, the south end south.
  const n = infill.getAttribute('normal');
  for (let i = 0; i < p.count; i += 3)
    expect([n.getX(i), n.getZ(i)].map((v) => Math.round(v) + 0)).toEqual(
      p.getX(i) === 20 ? [1, 0] : [0, 1],
    );
});

test('TASK-236 round: a semicircular vault along the ridges, closed by its ends; else hipped', () => {
  // Half the wing wide by default: the box barrel's semicircle on the 8 m wings.
  const vault = buildRoof(building('round', { rings: [outlines.L], roof: { shape: 'round' } }));
  expect(vault.shape).toBe('round');
  expect(vault.roofHeightM).toBeCloseTo(4, 9);
  for (const t of [0, 1, 2, 3, 4]) {
    const angle = Math.acos(1 - t / 4);
    const step = Math.PI / 12;
    // Within a step, the vault is the chord between the 12-step barrel's points.
    const k = Math.floor(angle / step + 1e-9);
    const [a0, a1] = [k * step, Math.min(Math.PI / 2, (k + 1) * step)];
    const [t0, t1] = [4 * (1 - Math.cos(a0)), 4 * (1 - Math.cos(a1))];
    const expected =
      t1 > t0
        ? 4 * Math.sin(a0) + ((t - t0) / (t1 - t0)) * 4 * (Math.sin(a1) - Math.sin(a0))
        : 4 * Math.sin(a0);
    expect(heightAt(vault.roof, 10, t), `${t}`).toBeCloseTo(10 + expected, 5);
  }
  // Each end: the arc in 12 steps, a fan of 11 triangles.
  expect(vault.infill.getAttribute('position').count).toBe(2 * 11 * 3);
  // The crown runs out to the end wall.
  expect(heightAt(vault.roof, 19.9, 4)).toBeCloseTo(14, 6);
  // A ring of wings round a courtyard has no end to stand: hipped.
  const ring = buildRoof(
    building('round', {
      rings: [box(30, 20), closed(8, 6, 22, 6, 22, 14, 8, 14)],
      roof: { shape: 'round', heightM: 3 },
    }),
  );
  expect(ring.shape).toBe('hipped');
  expect(heightAt(ring.roof, 15, 3)).toBeCloseTo(11 + 3 * (3 / 4), 6);
});

test('TASK-236 skillion: one plane over a concave outline or a courtyard, downhill as tagged', () => {
  const ring = outlines.L;
  const east = buildRoof(
    building('skillion', {
      rings: [ring],
      roof: { shape: 'skillion', heightM: 4, directionDeg: 90 },
    }),
  );
  expect(east.shape).toBe('skillion');
  expect(heightAt(east.roof, 0, 10)).toBeCloseTo(14, 6);
  expect(heightAt(east.roof, 20, 4)).toBeCloseTo(10, 6);
  expect(heightAt(east.roof, 8, 15)).toBeCloseTo(12.4, 6);
  // Untagged, it falls across the long axis of the outline's box, as on a rectangle.
  const untagged = buildRoof(
    building('skillion', { rings: [outlines.T], roof: { shape: 'skillion', heightM: 4 } }),
  );
  expect(heightAt(untagged.roof, 15, 0)).toBeCloseTo(14, 6);
  expect(heightAt(untagged.roof, 15, 25)).toBeCloseTo(10, 6);
  const court = buildRoof(
    building('skillion', {
      rings: [box(30, 20), closed(8, 6, 22, 6, 22, 14, 8, 14)],
      roof: { shape: 'skillion', heightM: 3 },
    }),
  );
  expect(court.shape).toBe('skillion');
  expect(projectedArea(court.roof)).toBeCloseTo(600 - 112, 4);
  expect(heightAt(court.roof, 15, 10)).toBeUndefined();
  expect(court.infill.getAttribute('position').count).toBeGreaterThan(0);
});

test('TASK-236 dome and onion stay flat on a concave outline; a failed skeleton stays flat', () => {
  for (const shape of ['dome', 'onion'] as const) {
    const result = buildRoof(building(shape, { rings: [outlines.U] }));
    expect(result.shape).toBe('flat');
    expect(result.fallbackReason).toBe('irregular-footprint');
  }
  const spike = closed(0, 0, 10, 0, 10, 10, 5, 10, 5, 20, 5, 10, 0, 10);
  for (const shape of ['half-hipped', 'gambrel', 'mansard', 'round'] as const) {
    const result = buildRoof(building(shape, { rings: [spike] }));
    expect(result.shape).toBe('flat');
    expect(result.fallbackReason).toBe('skeleton');
  }
});
