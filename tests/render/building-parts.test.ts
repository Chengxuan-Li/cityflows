import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type BufferGeometry,
} from 'three';
import { importContext } from '../../src/importers/osm/context';
import type { OsmData } from '../../src/importers/osm/parse';
import type { Diagnostic } from '../../src/network';
import { buildContext } from '../../src/render3d/context';
import { buildingPrisms } from '../../src/render3d/labels';
import type { ContextFeature } from '../../src/schema';
import { citySchema } from '../../src/schema';
import { grid5x5 } from '../../src/fixtures/grid5x5';

// TASK-201: `building:part` areas. A building with parts draws them in 3D, each from its own
// minimum height, instead of its outline extrusion; 2D, demand and picking keep the outline.

const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
  { x, y },
];

/** A 40 x 20 m church outline (way 1), a nave part (way 2), a tower part on its west end
 * (way 3) with a spire part above it (way 4), and a part outside every outline (way 5). */
const church: OsmData = {
  node: [],
  relation: [],
  way: [
    {
      id: 1,
      nd: [1, 2, 3, 4, 1],
      tag: { building: 'church', height: '116', 'roof:shape': 'gabled' },
    },
    {
      id: 2,
      nd: [5, 2, 3, 6, 5],
      tag: { 'building:part': 'yes', height: '30', 'roof:shape': 'gabled', 'roof:height': '12' },
    },
    { id: 3, nd: [1, 5, 6, 4, 1], tag: { 'building:part': 'tower', height: '70' } },
    {
      id: 4,
      nd: [1, 5, 6, 4, 1],
      tag: {
        'building:part': 'yes',
        'building:min_level': '20',
        height: '116',
        'roof:shape': 'pyramidal',
        'roof:height': '46',
      },
    },
    { id: 5, nd: [7, 8, 9, 10, 7], tag: { 'building:part': 'yes', min_height: '2' } },
  ],
};
const positions = new Map([
  [1, { x: 0, y: 0 }],
  [2, { x: 40, y: 0 }],
  [3, { x: 40, y: 20 }],
  [4, { x: 0, y: 20 }],
  [5, { x: 10, y: 0 }],
  [6, { x: 10, y: 20 }],
  [7, { x: 60, y: 0 }],
  [8, { x: 70, y: 0 }],
  [9, { x: 70, y: 10 }],
  [10, { x: 60, y: 10 }],
]);
const bounds = { min: { x: -1, y: -1 }, max: { x: 81, y: 21 } };

test('the importer hangs each part on the outline around it, with its own heights and roof', () => {
  const diagnostics: Diagnostic[] = [];
  const features = importContext(church, positions, bounds, diagnostics);
  const buildings = features.filter((f) => f.kind === 'area' && f.class === 'building');
  expect(buildings).toHaveLength(1);
  expect(buildings[0]).toMatchObject({
    sub: 'church',
    heightM: 116,
    rings: [ring(0, 0, 40, 20)],
    parts: [
      { sub: 'yes', heightM: 30, roof: { shape: 'gabled', heightM: 12 } },
      { sub: 'tower', heightM: 70, rings: [ring(0, 0, 10, 20)] },
      { sub: 'yes', heightM: 116, minHeightM: 60, roof: { shape: 'pyramidal', heightM: 46 } },
    ],
  });
  expect(diagnostics.map((d) => d.message)).toEqual([
    'Left out 1 building parts outside every building outline',
  ]);
  // A part is not a building: without an outline it adds nothing.
  expect(importContext({ ...church, way: church.way.slice(1) }, positions, bounds)).toEqual([]);
  // Parts survive the project boundary.
  const city = { ...grid5x5(), context: { features } };
  expect(citySchema.parse(city).context).toEqual(city.context);
});

function hits(geometry: BufferGeometry, x: number, y: number) {
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  const result = new Raycaster(new Vector3(x, 500, y), new Vector3(0, -1, 0))
    .intersectObject(mesh)
    .map((hit) => Math.round(hit.point.y * 10) / 10);
  mesh.material.dispose();
  return result;
}

test('3D draws the parts from their minimum heights and no outline extrusion', () => {
  const [church3d] = importContext(church, positions, bounds) as [
    Extract<ContextFeature, { kind: 'area' }>,
  ];
  const outline = { ...church3d, parts: undefined };
  const withParts = buildContext([church3d]);
  const without = buildContext([outline]);
  for (const geometry of [withParts.buildings, withParts.detailedBuildings]) {
    // The nave stands at 30 m to its ridge, not the outline's 116 m.
    expect(Math.max(...hits(geometry, 25, 10))).toBeLessThanOrEqual(30);
    // The spire stands on the tower: from 60 m (20 levels) up, so a ray through the gap
    // between the tower's 70 m top and the spire's foot meets both.
    expect(Math.max(...hits(geometry, 5, 10))).toBeGreaterThan(70);
  }
  // The spire's walls start at its minimum height: a horizontal ray at 50 m crosses only the
  // tower's walls; at 65 m the spire's and the tower's walls overlap.
  const facade = (h: number) => {
    const mesh = new Mesh(withParts.detailedBuildings, new MeshBasicMaterial({ side: DoubleSide }));
    const result = new Raycaster(new Vector3(3, h, -5), new Vector3(0, 0, 1), 0, 8).intersectObject(
      mesh,
    ).length;
    mesh.material.dispose();
    return result;
  };
  expect(facade(50)).toBe(1);
  expect(facade(65)).toBe(2);
  // The plain extrusion of the spire starts at 60 m too.
  expect(Math.min(...hits(withParts.buildings, 5, 10))).toBe(0);
  expect(hits(withParts.buildings, 5, 10)).toContain(60);
  // Without parts the outline stands as before: 116 m everywhere.
  expect(Math.max(...hits(without.buildings, 25, 10))).toBe(116);
  // One building either way; label occlusion follows the parts.
  expect(withParts.buildingCount).toBe(1);
  expect(without.buildingCount).toBe(1);
  const terrain = { grid: undefined } as unknown as Parameters<typeof buildingPrisms>[1];
  expect(buildingPrisms([church3d], terrain).map((p) => [p.bottom, p.top])).toEqual([
    [0, 30],
    [0, 70],
    [60, 116],
  ]);
  for (const context of [withParts, without]) {
    context.buildings.dispose();
    context.detailedBuildings.dispose();
    context.ground.dispose();
  }
});

test('a building without parts draws exactly as before', () => {
  const features: ContextFeature[] = [
    {
      kind: 'area',
      class: 'building',
      rings: [ring(0, 0, 20, 10)],
      heightM: 12,
      levels: 4,
      minHeightM: 3,
      roof: { shape: 'gabled', heightM: 2 },
    },
    { kind: 'area', class: 'building', sub: 'roof', rings: [ring(30, 0, 20, 10)] },
    { kind: 'area', class: 'building', rings: [ring(60, 0, 30, 30), ring(70, 10, 10, 10)] },
  ];
  const context = buildContext(features);
  const digest = createHash('sha256');
  for (const geometry of [context.buildings, context.detailedBuildings])
    for (const name of ['position', 'color', 'windowInfo'])
      digest.update(new Uint8Array(geometry.getAttribute(name).array.buffer));
  // The digest of main 6f04d8a's geometry for these buildings, before parts existed.
  expect(digest.digest('hex').slice(0, 16)).toBe('134e1029b2513a57');
  expect(context.buildingCount).toBe(3);
});
