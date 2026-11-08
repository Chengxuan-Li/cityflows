import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { pointInPolygon } from '../../src/geo/polyline';
import { walkGeometry } from '../../src/render/walk-geometry';
import { buildWalk } from '../../src/render3d/walk';
import { cityHeights } from '../../src/render3d/heights';

test('V110 sidewalk paving is clipped by buildings and the carriageway in shared render geometry', () => {
  const { city, node, street } = buildCity('Paving', 1);
  street(node(0, 0), node(120, 0));
  const ring = [
    { x: 40, y: 3 },
    { x: 60, y: 3 },
    { x: 60, y: 8 },
    { x: 40, y: 8 },
    { x: 40, y: 3 },
  ];
  city.context = { features: [{ kind: 'area', class: 'building', rings: [ring] }] };
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  const shapes = walkGeometry(r.compiled, city);
  expect(shapes.length).toBeGreaterThan(0);
  for (const shape of shapes)
    for (const tri of shape.polygons) {
      const p = {
        x: tri.reduce((s, v) => s + v.x, 0) / tri.length,
        y: tri.reduce((s, v) => s + v.y, 0) / tri.length,
      };
      expect(pointInPolygon(p, ring, 0)).toBe(false);
      expect(Math.abs(p.y)).toBeGreaterThanOrEqual(3);
    }
  city.context.features = [
    {
      kind: 'area',
      class: 'building',
      rings: [
        [
          { x: -10, y: -10 },
          { x: 130, y: -10 },
          { x: 130, y: 10 },
          { x: -10, y: 10 },
          { x: -10, y: -10 },
        ],
      ],
    },
  ];
  expect(walkGeometry(r.compiled, city)).toEqual([]);
});

test('V110 3D paving follows terrain folds at curb height', () => {
  const { city, node, street } = buildCity('Folded terrain', 1);
  street(node(0, 0), node(120, 0));
  const samples = new Int16Array([0, 100, 0, 0, 100, 0]);
  city.terrain = {
    source: 'test',
    originM: { x: 0, y: -30 },
    cellM: 60,
    cols: 3,
    rows: 2,
    baseM: 0,
    heights: Buffer.from(samples.buffer).toString('base64'),
  };
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  const h = cityHeights(r.compiled, city),
    mesh = buildWalk(r.compiled, city, h);
  const positions = mesh.sidewalks.getAttribute('position');
  expect(
    Array.from({ length: positions.count }, (_, i) => positions.getY(i)).some(
      (y) => Math.abs(y - 10.14) < 0.01,
    ),
  ).toBe(true);
  for (let i = 0; i < positions.count; i++)
    expect(positions.getY(i)).toBeCloseTo(
      h.terrain.groundAt(positions.getX(i), positions.getZ(i)) + 0.14,
      3,
    );
  for (const geometry of Object.values(mesh)) geometry.dispose();
});

test('V110 mapped steps join the ground to a bridge deck', () => {
  const { city } = buildCity('Bridge steps', 1);
  const a = { id: 'wn:1', pos: { x: 0, y: 0 }, layer: 0, provenance: { source: 'osm' as const } },
    b = { ...a, id: 'wn:2', pos: { x: 20, y: 0 }, layer: 1 };
  city.walk = {
    nodes: { [a.id]: a, [b.id]: b },
    links: {
      'wl:3': {
        id: 'wl:3',
        from: a.id,
        to: b.id,
        line: [a.pos, b.pos],
        kind: 'steps',
        layer: 1,
        widthM: 2,
        provenance: { source: 'osm' },
      },
    },
  };
  city.nextId = 4;
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  const meshes = buildWalk(r.compiled, city, cityHeights(r.compiled, city));
  const pos = meshes.footways.getAttribute('position'),
    ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i));
  expect(Math.min(...ys)).toBeLessThan(0.2);
  expect(Math.max(...ys)).toBeGreaterThan(5.1);
  for (const g of Object.values(meshes)) g.dispose();
});

test('V110 sidewalks on a straight bridge rise with the road profile', () => {
  const { city, node, street } = buildCity('Bridge paving', 1);
  const pair = street(node(0, 0), node(200, 0));
  for (const road of pair) road.layer = 1;
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  const meshes = buildWalk(r.compiled, city, cityHeights(r.compiled, city));
  const p = meshes.sidewalks.getAttribute('position');
  expect(Array.from({ length: p.count }, (_, i) => p.getY(i)).some((y) => y > 5.1)).toBe(true);
  for (const g of Object.values(meshes)) g.dispose();
});

test('V110 a mapped courtyard path remains visible inside the building hole', () => {
  const { city } = buildCity('Courtyard path', 1);
  const a = {
      id: 'wn:1',
      pos: { x: 4, y: 10 },
      layer: 0,
      provenance: { source: 'authored' as const },
    },
    b = { ...a, id: 'wn:2', pos: { x: 16, y: 10 } };
  city.walk = {
    nodes: { [a.id]: a, [b.id]: b },
    links: {
      'wl:3': {
        id: 'wl:3',
        from: a.id,
        to: b.id,
        line: [a.pos, b.pos],
        kind: 'footway',
        widthM: 1,
        provenance: { source: 'authored' },
      },
    },
  };
  city.nextId = 4;
  const ring = (lo: number, hi: number) => [
    { x: lo, y: lo },
    { x: hi, y: lo },
    { x: hi, y: hi },
    { x: lo, y: hi },
    { x: lo, y: lo },
  ];
  city.context = {
    features: [{ kind: 'area', class: 'building', rings: [ring(0, 20), ring(3, 17)] }],
  };
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  expect(walkGeometry(r.compiled, city).length).toBeGreaterThan(0);
});
