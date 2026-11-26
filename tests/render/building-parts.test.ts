import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type BufferGeometry,
} from 'three';
import { createGeoReference, lonLatToLocal } from '../../src/geo/projection';
import { pointInPolygon } from '../../src/geo/polyline';
import { importContext } from '../../src/importers/osm/context';
import { parseOsm, type OsmData } from '../../src/importers/osm/parse';
import type { Diagnostic } from '../../src/network';
import { buildContext } from '../../src/render3d/context';
import { buildingPrisms } from '../../src/render3d/labels';
import { buildingPieces } from '../../src/render3d/roofs';
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

test('a pyramidal roof on a convex octagon rises to a spire instead of falling back flat', () => {
  // The Münster's spire: an octagonal part from 37 m, walls to 70 m, a 46 m pyramid above.
  const octagon = Array.from({ length: 8 }, (_, i) => ({
    x: Math.round(6 * Math.cos((i * Math.PI) / 4) * 10) / 10,
    y: Math.round(6 * Math.sin((i * Math.PI) / 4) * 10) / 10,
  }));
  const spire: ContextFeature = {
    kind: 'area',
    class: 'building',
    rings: [[...octagon, octagon[0]!]],
    heightM: 116,
    minHeightM: 37,
    roof: { shape: 'pyramidal', heightM: 46 },
  };
  const context = buildContext([spire]);
  expect(context.roofStats).toEqual({ shapes: { pyramidal: 1 }, fallbacks: {} });
  expect(Math.max(...hits(context.detailedBuildings, 0.05, 0.05))).toBeGreaterThan(115);
  // Towards a corner the roof falls linearly from the apex to the 70 m eaves.
  expect(Math.max(...hits(context.detailedBuildings, 2.7, 0))).toBeCloseTo(
    70 + 46 * (1 - 2.7 / 6),
    0,
  );
  context.buildings.dispose();
  context.detailedBuildings.dispose();
  context.ground.dispose();
});

// TASK-272: an outline whose height is not its tallest part's (Simple 3D Buildings has the
// outline envelope its parts) is the building's body: the area no part covers stands with the
// outline's tags, and a part with no height or levels takes the outline's.

/** A 40 x 40 m courtyard building (relation 9: outer way 11, inner way 12) of 20 m, with an
 * untagged corner pavilion (way 13), a 60 m tower (way 14) and a strip part (way 15) that
 * stops 0.2 m short of the courtyard, as simplified seams leave it. */
const courtyard: OsmData = {
  node: [],
  relation: [
    {
      id: 9,
      member: [
        { type: 'way', ref: 11, role: 'outer' },
        { type: 'way', ref: 12, role: 'inner' },
      ],
      tag: { type: 'multipolygon', building: 'civic', height: '20' },
    },
  ],
  way: [
    { id: 11, nd: [21, 22, 23, 24, 21], tag: {} },
    { id: 12, nd: [25, 26, 27, 28, 25], tag: {} },
    {
      id: 13,
      nd: [21, 29, 30, 31, 21],
      tag: { 'building:part': 'yes', 'roof:shape': 'pyramidal' },
    },
    { id: 14, nd: [32, 33, 34, 35, 32], tag: { 'building:part': 'yes', height: '60' } },
    { id: 15, nd: [36, 37, 38, 39, 36], tag: { 'building:part': 'yes', height: '12' } },
  ],
};
const courtyardPositions = new Map([
  [21, { x: 0, y: 0 }],
  [22, { x: 40, y: 0 }],
  [23, { x: 40, y: 40 }],
  [24, { x: 0, y: 40 }],
  [25, { x: 12, y: 12 }],
  [26, { x: 28, y: 12 }],
  [27, { x: 28, y: 28 }],
  [28, { x: 12, y: 28 }],
  [29, { x: 8, y: 0 }],
  [30, { x: 8, y: 8 }],
  [31, { x: 0, y: 8 }],
  [32, { x: 30, y: 30 }],
  [33, { x: 38, y: 30 }],
  [34, { x: 38, y: 38 }],
  [35, { x: 30, y: 38 }],
  [36, { x: 12, y: 0 }],
  [37, { x: 28, y: 0 }],
  [38, { x: 28, y: 11.8 }],
  [39, { x: 12, y: 11.8 }],
]);

test('the outline stands where no part covers it, and an untagged part takes its height', () => {
  const [hall] = importContext(courtyard, courtyardPositions, {
    min: { x: -1, y: -1 },
    max: { x: 41, y: 41 },
  }) as [Extract<ContextFeature, { kind: 'area' }>];
  expect(hall.rings).toHaveLength(2);
  expect(hall.parts).toHaveLength(3);
  const context = buildContext([hall]);
  for (const geometry of [context.buildings, context.detailedBuildings]) {
    // The body west of the courtyard, which no part covers, at the outline's 20 m.
    expect(Math.max(...hits(geometry, 5, 20))).toBe(20);
    // The courtyard stays open.
    expect(hits(geometry, 20, 20)).toEqual([]);
    // The tower keeps its own height, the tagged strip its own 12 m; the 0.2 m seam between
    // the strip and the courtyard raises no sliver of the outline.
    expect(Math.max(...hits(geometry, 34, 34))).toBe(60);
    expect(Math.max(...hits(geometry, 20, 6))).toBe(12);
    expect(hits(geometry, 20, 11.9)).toEqual([]);
  }
  // The pavilion's pyramid rises to the outline's 20 m instead of the default 10 m.
  expect(Math.max(...hits(context.detailedBuildings, 4, 4))).toBeCloseTo(20, 0);
  expect(Math.max(...hits(context.detailedBuildings, 4, 4))).toBeLessThanOrEqual(20);
  const terrain = { grid: undefined } as unknown as Parameters<typeof buildingPrisms>[1];
  expect(buildingPrisms([hall], terrain).map((p) => p.top)).toEqual([20, 60, 12, 20]);
  context.buildings.dispose();
  context.detailedBuildings.dispose();
  context.ground.dispose();
});

test('an outline as tall as its tallest part only envelopes them: gaps stay open', () => {
  // The church without its nave part: the 116 m outline is the spire's height, so the nave's
  // ground stays empty rather than rising to 116 m, and the parts keep their own heights.
  const [church3d] = importContext(
    { ...church, way: church.way.filter((w) => w.id !== 2) },
    positions,
    bounds,
  ) as [Extract<ContextFeature, { kind: 'area' }>];
  const context = buildContext([church3d]);
  expect(hits(context.buildings, 25, 10)).toEqual([]);
  expect(Math.max(...hits(context.buildings, 5, 10))).toBe(116);
  context.buildings.dispose();
  context.detailedBuildings.dispose();
  context.ground.dispose();
});

test('Philadelphia City Hall stands as its 30 m body around its parts', () => {
  // TASK-259's D9: relation 4720912 (one outer, three inner rings, height 30) with 30 parts, 26
  // of them untagged; its parts cover 39% of it, so 3D showed low pavilions round an empty plaza.
  const data = parseOsm(readFileSync('tests/render/city-hall.osm', 'utf8')) as OsmData;
  const geo = createGeoReference({ lon: -75.1636, lat: 39.9524 });
  const local = new Map(data.node.map((n) => [n.id, lonLatToLocal(geo, n)]));
  const [hall] = importContext(data, local, {
    min: { x: -1000, y: -1000 },
    max: { x: 1000, y: 1000 },
  }) as [Extract<ContextFeature, { kind: 'area' }>];
  // 2D draws the outline with its three courtyards (it always did).
  expect(hall).toMatchObject({ sub: 'civic', heightM: 30, levels: 9 });
  expect(hall.rings).toHaveLength(4);
  expect(hall.parts).toHaveLength(30);
  const pieces = buildingPieces(hall);
  const body = pieces.slice(30);
  expect(body.length).toBeGreaterThan(0);
  expect(body.every((piece) => piece.heightM === 30 && !piece.parts)).toBe(true);
  expect(pieces.slice(0, 30).filter((piece) => piece.heightM === 30)).toHaveLength(26);
  // The tagged parts keep theirs: the tower's three stages and a part of 3 levels.
  expect(
    pieces.filter((piece) => piece.heightM !== 30).map((p) => p.heightM ?? `${p.levels} levels`),
  ).toEqual([137.77, 167, 155.8, '3 levels']);
  // A point of the body that no part covers, outside the courtyards, now meets the 30 m roof.
  const inBody = (p: { x: number; y: number }) =>
    pointInPolygon(p, hall.rings[0]!) &&
    !hall.rings.slice(1).some((r) => pointInPolygon(p, r)) &&
    !hall.parts!.some((part) => pointInPolygon(p, part.rings[0]!));
  const outer = hall.rings[0]!;
  const xs = outer.map((p) => p.x),
    ys = outer.map((p) => p.y);
  let probe: { x: number; y: number } | undefined;
  for (let x = Math.min(...xs); x < Math.max(...xs) && !probe; x += 2)
    for (let y = Math.min(...ys); y < Math.max(...ys) && !probe; y += 2)
      if ([0, 2].every((dx) => [0, 2].every((dy) => inBody({ x: x + dx - 1, y: y + dy - 1 }))))
        probe = { x, y };
  const context = buildContext([hall]);
  expect(Math.max(...hits(context.buildings, probe!.x, probe!.y))).toBe(30);
  // The courtyards stay open.
  const yard = hall.rings[1]!;
  const centre = {
    x: yard.slice(0, -1).reduce((s, p) => s + p.x, 0) / (yard.length - 1),
    y: yard.slice(0, -1).reduce((s, p) => s + p.y, 0) / (yard.length - 1),
  };
  expect(pointInPolygon(centre, yard)).toBe(true);
  expect(hits(context.buildings, centre.x, centre.y)).toEqual([]);
  context.buildings.dispose();
  context.detailedBuildings.dispose();
  context.ground.dispose();
});
