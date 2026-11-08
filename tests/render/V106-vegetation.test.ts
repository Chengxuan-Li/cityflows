import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { buildCity } from '../../src/fixtures/build-city';
import { drawVegetation } from '../../src/render/layers/vegetation';
import { buildVegetation } from '../../src/render3d/vegetation';
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { town } from '../../src/fixtures/town';
import { compile, type CompiledCity } from '../../src/network';
import { pointInPolygon, nearestOnPolyline, distance } from '../../src/geo/polyline';
import { placeTrees } from '../../src/render/vegetation';
import { treeContext } from '../../src/render/street';
import type { City, ContextFeature } from '../../src/schema';
import { tierCities, unitTest } from '../tier';

const rectangle = (x: number, y: number, w: number, h = w) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
  { x, y },
];
function compiled(city: City): CompiledCity {
  const result = compile(city);
  if (!result.ok) throw new Error('Invalid test city');
  return result.compiled;
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value, (_, v: unknown) => (v instanceof Map ? [...v] : v)))
    .digest('hex');
// Compiled hashes from 56ffccd, updated at the TASK-100 merge: lanes also allow `van`; with
// `van` removed they hash as at 56ffccd. Updated again at the TASK-101 merge (access, zones and
// retained access-boundary junctions).
const baselines = {
  grid: 'a3f4b1fd03c65d0e380c56473b082f0d7dd67565fed7003c7239b8fe0f31bbb3',
  town: '7f5407b1088b1d219baedc5442270c618ff896125e57d615b67867b4318c15ec',
  'munich-donnersberger': '114894aea61446a784fca6707c1ef6601080ac8e03d374f0e66586be8b2f36fe',
  'sindelfingen-a81': '6796e26d82f456a43fd826489ab54f9285f4148ca82c0f3be1ed1a15d8027478',
};

unitTest(
  'V106 placement is repeatable, never mutates the city, and keeps full crowns clear of obstacles',
  () => {
    const city = grid5x5();
    city.context = {
      features: [
        { kind: 'area', class: 'green', sub: 'forest', rings: [rectangle(-40, -40, 220)] },
        { kind: 'area', class: 'building', rings: [rectangle(40, 40, 55)] },
        { kind: 'area', class: 'water', rings: [rectangle(140, 40, 55)] },
        { kind: 'point', class: 'tree', pos: { x: 70, y: 110 }, crownM: 4, heightM: 17 },
        // OSM trees on asphalt must also be hidden, rather than covering it.
        { kind: 'point', class: 'tree', pos: { x: 120, y: 120 }, crownM: 20 },
      ],
    };
    const network = compiled(city),
      before = JSON.stringify(city);
    const result = placeTrees(network, city);
    expect(placeTrees(network, city)).toEqual(result);
    expect(JSON.stringify(city)).toBe(before);
    expect(result.counts.street).toBeGreaterThan(0);
    expect(result.counts.osm).toBe(1);
    for (const tree of result.trees) {
      for (const node of network.nodes)
        expect(distance(node.pos, tree.pos)).toBeGreaterThanOrEqual(15 + tree.crownM / 2);
      for (const road of network.roads) {
        const closed = [...road.surface, road.surface[0]!];
        expect(pointInPolygon(tree.pos, closed)).toBe(false);
        expect(nearestOnPolyline(closed, tree.pos).away).toBeGreaterThanOrEqual(tree.crownM / 2);
      }
      for (const feature of city.context.features)
        if (feature.kind === 'area' && feature.class !== 'green') {
          expect(pointInPolygon(tree.pos, feature.rings[0]!)).toBe(false);
          expect(nearestOnPolyline(feature.rings[0]!, tree.pos).away).toBeGreaterThanOrEqual(
            tree.crownM / 2,
          );
        }
      if (tree.source === 'street')
        expect(distance(tree.pos, { x: 70, y: 110 })).toBeGreaterThanOrEqual(8);
    }
  },
);

unitTest.each([
  ['wood', 40],
  ['forest', 40],
  ['scrub', 60],
  ['park', 300],
] as const)(
  'V106 %s fills within 15%% of its density, preserves holes, and has separated irregular trees',
  (sub, density) => {
    const city = grid5x5();
    const rings = [rectangle(1000, 1000, 400), rectangle(1150, 1150, 100)];
    city.context = { features: [{ kind: 'area', class: 'green', sub, rings }] };
    const result = placeTrees(compiled(city), city);
    const trees = result.trees.filter((t) => t.source !== 'street');
    expect(trees.length).toBeGreaterThanOrEqual((150000 / density) * 0.85);
    expect(trees.length).toBeLessThanOrEqual((150000 / density) * 1.15);
    for (const tree of trees) expect(pointInPolygon(tree.pos, rings[1]!)).toBe(false);
    expect(new Set(trees.map((t) => t.heightM)).size).toBeGreaterThan(20);
    for (let i = 0; i < 30; i++)
      for (let j = i + 1; j < trees.length; j++)
        expect(distance(trees[i]!.pos, trees[j]!.pos)).toBeGreaterThanOrEqual(
          Math.sqrt(density) * 0.7,
        );
  },
);

unitTest(
  'V106 grass stays open, rows use tagged spacing, and generated trees stop at 60000',
  () => {
    const city = grid5x5();
    city.context = {
      features: [
        ...['grass', 'meadow', 'grassland'].map((sub): ContextFeature => ({
          kind: 'area',
          class: 'green',
          sub,
          rings: [rectangle(1000, 1000, 100)],
        })),
        {
          kind: 'line',
          class: 'tree_row',
          line: [
            { x: 1100, y: 900 },
            { x: 1124, y: 900 },
          ],
          spacingM: 12,
        },
      ],
    };
    let result = placeTrees(compiled(city), city);
    expect(result.counts.row).toBe(3);
    expect(result.counts.wood + result.counts.scrub + result.counts.park).toBe(0);
    city.context.features.push({
      kind: 'area',
      class: 'green',
      sub: 'forest',
      rings: [rectangle(2000, 2000, 2000)],
    });
    result = placeTrees(compiled(city), city);
    expect(result.trees.filter((t) => t.source !== 'osm')).toHaveLength(60000);
    expect(result.capped).toBe(true);
  },
);

test.each(tierCities(['grid', 'town', 'munich-donnersberger', 'sindelfingen-a81'] as const))(
  'V106 %s keeps main compiled hash and reports source counts and placement time',
  (name) => {
    let city: City;
    if (name === 'grid') city = grid5x5();
    else if (name === 'town') city = town();
    else {
      const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
        importerVersion: 'test',
      });
      if (!imported.ok) throw new Error('Import failed');
      city = imported.city;
    }
    expect(hash(compile(city))).toBe(baselines[name]);
    const expected =
      name === 'grid'
        ? { street: 559, wood: 0 }
        : name === 'town'
          ? { street: 7100, wood: 0 }
          : name === 'munich-donnersberger'
            ? { street: 1463, wood: 50 }
            : { street: 1844, wood: 32 };
    const start = performance.now();
    const result = placeTrees(compiled(city), treeContext(city));
    console.info('V106', name, {
      counts: result.counts,
      capped: result.capped,
      placementMs: performance.now() - start,
      importedTrees: city.context?.features.filter((f) => f.class === 'tree').length ?? 0,
      importedRows: city.context?.features.filter((f) => f.class === 'tree_row').length ?? 0,
    });
    for (const [key, count] of Object.entries(expected)) {
      const actual = result.counts[key as 'street' | 'wood'];
      expect(actual).toBeGreaterThanOrEqual(count * 0.9);
      expect(actual).toBeLessThanOrEqual(count * 1.1);
    }
    expect(
      city.context?.features.filter((f) => f.class === 'tree' || f.class === 'tree_row') ?? [],
    ).toHaveLength(0);
    expect(hash(compile(city))).toBe(baselines[name]);
  },
);

unitTest('V106 a divided corridor gets roadside trees but no trees in its wide median', () => {
  const b = buildCity('divided', 1);
  const a = b.node(0, 0),
    c = b.node(300, 0),
    d = b.node(0, 24),
    e = b.node(300, 24);
  b.road(a, c).corridorId = 'divided';
  b.road(e, d).corridorId = 'divided';
  const result = placeTrees(compiled(b.city), b.city);
  expect(result.counts.street).toBeGreaterThan(20);
  expect(result.trees.every((tree) => tree.pos.y < 0 || tree.pos.y > 24)).toBe(true);
});

unitTest(
  'V106 both renderers preserve shared positions and the 3D ground callback sets every tree base',
  () => {
    const city = grid5x5();
    const placed = placeTrees(compiled(city), city);
    const flat = drawVegetation(placed.trees);
    const three = buildVegetation(placed.trees, () => 23);
    for (const tree of placed.trees) expect(flat.street.containsPoint(tree.pos)).toBe(true);
    const matrix = new Matrix4(),
      pos = new Vector3(),
      scale = new Vector3();
    const bounds = placed.trees.map(() => ({ min: Infinity, max: -Infinity }));
    for (const child of three.street.children[0]!.children) {
      const mesh = child as InstancedMesh;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        pos.setFromMatrixPosition(matrix);
        scale.setFromMatrixScale(matrix);
        const index = placed.trees.findIndex(
          (t) => Math.abs(t.pos.x - pos.x) < 1e-3 && Math.abs(t.pos.y - pos.z) < 1e-3,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        bounds[index]!.min = Math.min(bounds[index]!.min, pos.y + box.min.y * scale.y);
        bounds[index]!.max = Math.max(bounds[index]!.max, pos.y + box.max.y * scale.y);
      }
    }
    bounds.forEach((box, i) => {
      expect(box.min).toBeCloseTo(23, 4);
      expect(box.max).toBeCloseTo(23 + placed.trees[i]!.heightM, 4);
    });
    three.update(2000);
    expect(three.street.children[0]!.visible).toBe(false);
    expect(three.street.children[1]!.visible).toBe(true);
    flat.container.destroy({ children: true, context: true });
    three.group.traverse((object) => {
      if (object instanceof InstancedMesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose();
        object.dispose();
      }
    });
  },
);
