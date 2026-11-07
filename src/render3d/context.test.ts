import type { BufferGeometry } from 'three';
import { expect, it } from 'vitest';
import type { Vec2 } from '../geo/vec2';
import type { ContextFeature } from '../schema';
import { buildContext } from './context';

const rectangle = (x: number, y: number, width = 10, depth = 10): Vec2[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + depth },
  { x, y: y + depth },
  { x, y },
];

function horizontalArea(geometry: BufferGeometry, height: number) {
  const p = geometry.getAttribute('position');
  let area = 0;
  for (let i = 0; i < p.count; i += 3) {
    if (![0, 1, 2].every((j) => Math.abs(p.getY(i + j) - height) < 1e-6)) continue;
    const ax = p.getX(i + 1) - p.getX(i),
      az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i),
      bz = p.getZ(i + 2) - p.getZ(i);
    area += Math.abs(ax * bz - az * bx) / 2;
  }
  return area;
}

it('extrudes flat-roof buildings with height, levels and 10m fallback in that order', () => {
  const context = buildContext([
    { kind: 'area', class: 'building', rings: [rectangle(0, 0)], heightM: 17, levels: 6 },
    { kind: 'area', class: 'building', rings: [rectangle(20, 0)], levels: 4 },
    { kind: 'area', class: 'building', rings: [rectangle(40, 0)] },
  ]);
  expect(context.buildingCount).toBe(3);
  expect(context.groundCount).toBe(0);
  const p = context.buildings.getAttribute('position');
  for (const [from, height] of [
    [0, 17],
    [20, 12],
    [40, 10],
  ] as const) {
    const heights = Array.from({ length: p.count }, (_, i) => i)
      .filter((i) => p.getX(i) >= from && p.getX(i) <= from + 10)
      .map((i) => p.getY(i));
    expect(Math.min(...heights)).toBeCloseTo(0);
    expect(Math.max(...heights)).toBe(height);
    expect(horizontalArea(context.buildings, height)).toBeCloseTo(100);
  }
  context.buildings.dispose();
  context.ground.dispose();
});

it('preserves courtyard roof holes and inner walls in either ring winding', () => {
  for (const reverse of [false, true]) {
    const rings = [rectangle(0, 0), rectangle(3, 3, 4, 4)];
    if (reverse) rings.forEach((ring) => ring.reverse());
    const context = buildContext([{ kind: 'area', class: 'building', rings, heightM: 7 }]);
    expect(horizontalArea(context.buildings, 7)).toBeCloseTo(84);
    const p = context.buildings.getAttribute('position');
    const n = context.buildings.getAttribute('normal');
    const innerWall = Array.from({ length: p.count }, (_, i) => i).filter(
      (i) => p.getX(i) === 3 && p.getZ(i) >= 3 && p.getZ(i) <= 7 && n.getX(i) > 0.9,
    );
    expect(innerWall.length).toBeGreaterThan(0);
    for (const attribute of Object.values(context.buildings.attributes))
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    context.buildings.dispose();
    context.ground.dispose();
  }
});

it('keeps ground areas flat with holes, and renders rail, tram and waterway widths', () => {
  const features: ContextFeature[] = [
    { kind: 'area', class: 'water', rings: [rectangle(0, 0), rectangle(3, 3, 4, 4)] },
    {
      kind: 'line',
      class: 'rail',
      line: [
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ],
    },
    {
      kind: 'line',
      class: 'tram',
      line: [
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
    },
    {
      kind: 'line',
      class: 'waterway',
      widthM: 3,
      line: [
        { x: 60, y: 0 },
        { x: 70, y: 0 },
      ],
    },
  ];
  const context = buildContext(features);
  expect(context.groundCount).toBe(4);
  expect(context.buildingCount).toBe(0);
  expect(horizontalArea(context.ground, -0.025)).toBeCloseTo(84 + 7 + 4.5 + 30);
  const p = context.ground.getAttribute('position');
  const n = context.ground.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    expect(p.getY(i)).toBeCloseTo(-0.025);
    expect(n.getY(i)).toBeCloseTo(1);
  }
  context.buildings.dispose();
  context.ground.dispose();
});

it('accepts an empty legacy city without context', () => {
  const context = buildContext([]);
  expect(context.buildingCount + context.groundCount).toBe(0);
  expect(context.buildings.getAttribute('position').count).toBe(0);
  expect(context.ground.getAttribute('position').count).toBe(0);
  context.buildings.dispose();
  context.ground.dispose();
});
