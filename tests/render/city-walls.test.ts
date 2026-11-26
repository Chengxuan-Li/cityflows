// TASK-273: city walls and gate arches drawn in 3D (stone bodies, walkways, openings) and 2D (a band).
import type { Graphics } from 'pixi.js';
import { Color, type BufferGeometry } from 'three';
import { expect, test } from 'vitest';
import { drawContext } from '../../src/render/layers/context';
import { mapPalettes } from '../../src/render/style';
import { buildContext, wallPieces, wallSize } from '../../src/render3d/context';
import { footbridgeSize } from '../../src/render3d/footbridges';
import type { ContextFeature } from '../../src/schema';

type Line = Extract<ContextFeature, { kind: 'line' }>;
const line = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
];
const wall = (extra: Partial<Line> = {}): Line => ({
  kind: 'line',
  class: 'city_wall',
  line,
  ...extra,
});

/** Heights of the vertices of a geometry within a box on the ground plane. */
function heights(
  geometry: BufferGeometry,
  x0 = -Infinity,
  x1 = Infinity,
  y0 = -Infinity,
  y1 = Infinity,
) {
  const p = geometry.getAttribute('position');
  const result: number[] = [];
  for (let i = 0; i < p.count; i++)
    if (p.getX(i) >= x0 && p.getX(i) <= x1 && p.getZ(i) >= y0 && p.getZ(i) <= y1)
      result.push(p.getY(i));
  return result;
}
const range = (values: number[]) =>
  [Math.min(...values), Math.max(...values)].map((v) => Math.round(v * 1e4) / 1e4 + 0);
function extent(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

test('a wall is a stone body of its tagged height and width, 4 m by 2 m where untagged', () => {
  const [plain, ...rest] = wallPieces(wall(), mapPalettes.light);
  expect(rest).toEqual([]);
  expect(range(heights(plain!))).toEqual([0, wallSize.heightM]);
  const box = extent(plain!);
  expect(box.max.z - box.min.z).toBeCloseTo(wallSize.widthM);
  const [tagged] = wallPieces(wall({ heightM: 6, widthM: 3 }), mapPalettes.light);
  expect(range(heights(tagged!))).toEqual([0, 6]);
  const taggedBox = extent(tagged!);
  expect(taggedBox.max.z - taggedBox.min.z).toBeCloseTo(3);
});

test('a wall tagged bridge spans an opening below its lintel', () => {
  const [body] = wallPieces(wall({ bridge: true }), mapPalettes.light);
  expect(range(heights(body!))).toEqual([wallSize.heightM - wallSize.lintelM, wallSize.heightM]);
});

test('a walkway at grade is paved between two parapets; a raised one meets its walk deck', () => {
  const pieces = wallPieces(wall({ walkway: true }), mapPalettes.light);
  expect(pieces).toHaveLength(3);
  const [body, ...parapets] = pieces;
  expect(range(heights(body!))).toEqual([0, wallSize.heightM]);
  for (const parapet of parapets) {
    expect(range(heights(parapet))).toEqual([
      wallSize.heightM,
      wallSize.heightM + wallSize.parapetM,
    ]);
    const box = extent(parapet);
    expect(box.max.z - box.min.z).toBeCloseTo(wallSize.parapetWidthM);
    // At the wall's edge: one at each side.
    expect(Math.max(Math.abs(box.min.z), Math.abs(box.max.z))).toBeCloseTo(wallSize.widthM / 2);
  }
  // The paved top takes the footway's colour, the plain wall's top the coping's.
  const colourAtTop = (geometry: BufferGeometry, top: number) => {
    const p = geometry.getAttribute('position'),
      c = geometry.getAttribute('color');
    const caps = geometry.groups.find((group) => group.materialIndex === 0)!;
    for (let i = caps.start; i < caps.start + caps.count; i++)
      if (Math.abs(p.getY(i) - top) < 1e-6)
        return [c.getX(i), c.getY(i), c.getZ(i)].map((v) => Math.round(v * 255));
  };
  const hex = (n: number) => {
    const colour = new Color(n);
    return [colour.r, colour.g, colour.b].map((v) => Math.round(v * 255));
  };
  expect(colourAtTop(body!, wallSize.heightM)).toEqual(hex(mapPalettes.light.walk.footway));
  const [plain] = wallPieces(wall(), mapPalettes.light);
  expect(colourAtTop(plain!, wallSize.heightM)).toEqual(hex(mapPalettes.light.context.wallEdge));
  // On layer 1 the walk is a footbridge deck 5 m up (walk.ts): the wall carries it, no parapets.
  const raised = wallPieces(wall({ walkway: true, layer: 1, heightM: 3 }), mapPalettes.light);
  expect(raised).toHaveLength(1);
  expect(range(heights(raised[0]!))[1]).toBeCloseTo(5 + 0.14 - footbridgeSize.deckM);
});

test('a gate arch is two piers and a lintel over the clear opening', () => {
  const arch: Line = {
    kind: 'line',
    class: 'city_gate',
    line: [
      { x: 0, y: -6 },
      { x: 0, y: 6 },
    ],
  };
  const pieces = wallPieces(arch, mapPalettes.light);
  const { gate } = wallSize;
  // The piers stand full height at the ends; the lintel and its haunches leave the opening clear.
  const [pierA, pierB, lintel, ...haunches] = pieces;
  expect(range(heights(pierA!))).toEqual([0, gate.heightM]);
  expect(range(heights(pierB!))).toEqual([0, gate.heightM]);
  expect(range(heights(lintel!))).toEqual([gate.clearanceM, gate.heightM]);
  for (const haunch of haunches)
    expect(range(heights(haunch))).toEqual([gate.clearanceM - gate.haunchM, gate.clearanceM]);
  expect(range([extent(pierA!).min.z, extent(pierA!).max.z])).toEqual([-6, -6 + gate.pierM]);
  const box = extent(pieces[2]!);
  expect(box.max.x - box.min.x).toBeCloseTo(gate.depthM);
  const tall = wallPieces({ ...arch, heightM: 12, widthM: 4 }, mapPalettes.light);
  expect(Math.max(...tall.flatMap((piece) => heights(piece)))).toBe(12);
});

test('walls join the building meshes, never the ground, and count as neither', () => {
  const context = buildContext([
    wall({ walkway: true }),
    wall({
      line: [
        { x: 0, y: 20 },
        { x: 0, y: 60 },
      ],
    }),
  ]);
  expect(context.buildingCount + context.groundCount).toBe(0);
  expect(heights(context.ground)).toEqual([]);
  expect(Math.max(...heights(context.detailedBuildings))).toBe(
    wallSize.heightM + wallSize.parapetM,
  );
  expect(Math.max(...heights(context.buildings))).toBe(wallSize.heightM + wallSize.parapetM);
  expect(context.detailedBuildings.getAttribute('windowInfo')).toBeDefined();
});

test('2D draws a wall as an edged band of its width, a gate arch as a darker band', () => {
  // In their own layer, which the scene puts above the place tints.
  const layer = drawContext([wall({ widthM: 3 })]);
  expect((layer.container.children[0] as Graphics).getLocalBounds().height).toBe(0);
  expect(layer.walls.getLocalBounds().height).toBeCloseTo(3.5, 1);
  expect(layer.walls.containsPoint({ x: 20, y: 1.2 })).toBe(true);
  expect(layer.walls.containsPoint({ x: 20, y: 2 })).toBe(false);
  const untagged = drawContext([wall()]);
  expect(untagged.walls.getLocalBounds().height).toBeCloseTo(2.5, 1);
  const gate = drawContext([{ kind: 'line', class: 'city_gate', line }]);
  expect(gate.walls.getLocalBounds().height).toBeCloseTo(3.5, 1);
  for (const l of [layer, untagged, gate]) {
    l.container.destroy({ children: true, context: true });
    expect(l.walls.destroyed).toBe(true);
  }
});
