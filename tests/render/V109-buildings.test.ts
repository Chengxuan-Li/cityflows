import { expect, test } from 'vitest';
import { Color, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { createTerrain, groundMesh } from '../../src/render3d/terrain';
import { buildContext, buildTerrainGround } from '../../src/render3d/context';
import type { ContextFeature } from '../../src/schema';

const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
  { x, y },
];

for (const kind of ['building', 'water', 'canopy'] as const)
  test(`V109 closes ${kind} floors and outer/inner banks in the ground without buildings`, () => {
    const bytes = Buffer.alloc(18);
    [0, 30, 50, 70, 160, 120, 140, 150, 190].forEach((h, i) => bytes.writeInt16LE(h, i * 2));
    const feature: ContextFeature = {
      kind: 'area',
      class: kind === 'water' ? 'water' : 'building',
      ...(kind === 'canopy' && { sub: 'roof' }),
      rings: [ring(2, 2, 16, 16), ring(7, 7, 6, 6)],
    };
    const terrain = createTerrain(
      {
        source: 'V109 fold',
        originM: { x: 0, y: 0 },
        cols: 3,
        rows: 3,
        cellM: 10,
        baseM: 0,
        heights: bytes.toString('base64'),
      },
      [feature],
    );
    const ground = groundMesh(terrain, { minX: 0, minY: 0, maxX: 20, maxY: 20 });
    const coloured = buildTerrainGround(ground, [feature]);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    for (const geometry of [ground, coloured.opaque]) {
      const mesh = new Mesh(geometry, material);
      for (let x = 1; x < 20; x += 0.7)
        for (let y = 1; y < 20; y += 0.7)
          expect(
            new Raycaster(new Vector3(x, 100, y), new Vector3(0, -1, 0)).intersectObject(mesh)
              .length,
            `vertical hole at ${x},${y}`,
          ).toBeGreaterThan(0);
      for (const boundary of feature.rings)
        for (let i = 1; i < boundary.length; i++) {
          const a = boundary[i - 1]!,
            b = boundary[i]!;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            length = Math.hypot(dx, dy);
          const normal = new Vector3(-dy / length, 0, dx / length);
          for (let d = 0.13; d < length; d += 0.47) {
            const x = a.x + (dx * d) / length,
              y = a.y + (dy * d) / length;
            const top = terrain.surfaceAt(x, y),
              floor = terrain.patches[0]!.level;
            for (let h = floor + 0.021; h < top - 0.01; h += 0.019) {
              const origin = new Vector3(x, h, y).addScaledVector(normal, -0.1);
              expect(
                new Raycaster(origin, normal, 0, 0.2).intersectObject(mesh).length,
                `open bank at ${x},${y},${h}`,
              ).toBeGreaterThan(0);
            }
          }
        }
    }
    material.dispose();
    ground.dispose();
    coloured.opaque.dispose();
    coloured.transparent.dispose();
  });

test('V109 details have tagged facade colours, level bands and clear canopy undersides', () => {
  const features: ContextFeature[] = [
    {
      kind: 'area',
      class: 'building',
      rings: [ring(0, 0, 20, 10)],
      heightM: 12,
      levels: 4,
      colour: '#ad806e',
      roof: { shape: 'gabled', heightM: 2, colour: '#997766' },
    },
    { kind: 'area', class: 'building', sub: 'roof', rings: [ring(30, 0, 20, 10)], minHeightM: 3 },
    {
      kind: 'area',
      class: 'building',
      sub: 'industrial',
      rings: [ring(60, 0, 20, 10)],
      heightM: 12,
    },
  ];
  const context = buildContext(features);
  const detailed = context.detailedBuildings;
  const mesh = new Mesh(detailed, new MeshBasicMaterial({ side: DoubleSide }));
  const facade = new Raycaster(new Vector3(10, 4, -2), new Vector3(0, 0, 1)).intersectObject(
    mesh,
  )[0]!;
  expect(facade).toBeDefined();
  const band = detailed.getAttribute('windowInfo');
  expect(band.getZ(facade.face!.a)).toBeCloseTo(2.5); // 10 m facade / 4 levels
  const colour = new Color('#e5e1d7').lerp(new Color('#ad806e'), 0.28),
    colors = detailed.getAttribute('color');
  expect(colors.getX(facade.face!.a)).toBeCloseTo(colour.r);
  expect(colors.getY(facade.face!.a)).toBeCloseTo(colour.g);
  expect(
    new Raycaster(new Vector3(40, 2, -2), new Vector3(0, 0, 1), 0, 15).intersectObject(mesh),
  ).toEqual([]);
  const canopy = new Raycaster(new Vector3(40, 20, 5), new Vector3(0, -1, 0)).intersectObject(
    mesh,
  )[0]!;
  expect(canopy.point.y).toBeCloseTo(3.2); // default 20 cm slab above its clearance
  const industrial = new Raycaster(new Vector3(70, 4, -2), new Vector3(0, 0, 1)).intersectObject(
    mesh,
  )[0]!;
  expect(band.getZ(industrial.face!.a)).toBe(0);
  expect(context.roofStats.shapes.gabled).toBe(1);
  expect(context.roofStats.shapes.flat).toBe(2);
  context.buildings.dispose();
  detailed.dispose();
  context.ground.dispose();
  mesh.material.dispose();
});

test('V109 unknown material names use finite palette fallbacks', () => {
  const context = buildContext([
    {
      kind: 'area',
      class: 'building',
      rings: [ring(0, 0, 20, 10)],
      material: '__proto__',
      roof: { shape: 'flat', material: 'constructor' },
    },
  ]);
  const plain = buildContext([
    { kind: 'area', class: 'building', rings: [ring(0, 0, 20, 10)], roof: { shape: 'flat' } },
  ]);
  expect(Array.from(context.detailedBuildings.getAttribute('color').array)).toEqual(
    Array.from(plain.detailedBuildings.getAttribute('color').array),
  );
  plain.buildings.dispose();
  plain.detailedBuildings.dispose();
  plain.ground.dispose();
  context.buildings.dispose();
  context.detailedBuildings.dispose();
  context.ground.dispose();
});

test('V109 roof clearance keeps pitched canopies and elevated buildings above their minimum', () => {
  const canopy = buildContext([
    {
      kind: 'area',
      class: 'building',
      sub: 'roof',
      rings: [ring(0, 0, 20, 10)],
      minHeightM: 3,
      heightM: 4,
      roof: { shape: 'gabled', heightM: 2 },
    },
  ]);
  const mesh = new Mesh(canopy.detailedBuildings, new MeshBasicMaterial({ side: DoubleSide }));
  expect(
    new Raycaster(new Vector3(-1, 2.5, 5), new Vector3(1, 0, 0), 0, 22).intersectObject(mesh),
  ).toEqual([]);
  // An open gable above the slab remains open, not a facade triangle.
  expect(
    new Raycaster(new Vector3(-1, 3.5, 5), new Vector3(1, 0, 0), 0, 1.1).intersectObject(mesh),
  ).toEqual([]);
  for (const part of [canopy.buildings, canopy.detailedBuildings, canopy.ground]) part.dispose();
  mesh.material.dispose();
  const elevated = buildContext([
    {
      kind: 'area',
      class: 'building',
      rings: [ring(0, 0, 20, 10)],
      minHeightM: 9,
      heightM: 12,
      roof: { shape: 'gabled', heightM: 4 },
    },
  ]);
  elevated.detailedBuildings.computeBoundingBox();
  expect(elevated.detailedBuildings.boundingBox!.min.y).toBeGreaterThanOrEqual(9);
  for (const part of [elevated.buildings, elevated.detailedBuildings, elevated.ground])
    part.dispose();
});
