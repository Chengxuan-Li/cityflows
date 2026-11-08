import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Color, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { buildCity } from '../../src/fixtures/build-city';
import { cumulativeLengths, pointAtDistance } from '../../src/geo/polyline';
import { cityGrades } from '../../src/render/grades';
import { compile } from '../../src/network';
import { citySchema } from '../../src/schema/city.schema';
import {
  cityHeights,
  heightAt,
  roadStation,
  terrainVehicleOffset,
} from '../../src/render3d/heights';
import { Vehicles3D } from '../../src/render3d/vehicles';
import { createTerrain, groundMesh } from '../../src/render3d/terrain';
import { buildContext, buildTerrainGround } from '../../src/render3d/context';
import { style } from '../../src/render/style';
import { buildGeometry } from '../../src/render3d/geometry';
import { importOsmCached } from '../../bench/city-cache';
import { tierCities, unitTest } from '../tier';

export const slopeGrid = {
  source: 'Test elevations',
  originM: { x: 0, y: 0 },
  cellM: 10,
  cols: 2,
  rows: 2,
  baseM: 100,
  heights: Buffer.from([0, 0, 100, 0, 200, 0, 44, 1]).toString('base64'),
};

unitTest('V105 coplanar ground cells share faces without changing heights or basemap UVs', () => {
  const bytes = Buffer.alloc(9 * 9 * 2);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) bytes.writeInt16LE((c + 2 * r) * 10, (r * 9 + c) * 2);
  const terrain = createTerrain({
    ...slopeGrid,
    cols: 9,
    rows: 9,
    heights: bytes.toString('base64'),
  });
  const geometry = groundMesh(terrain, { minX: 0, minY: 0, maxX: 80, maxY: 80 });
  expect((geometry.index?.count ?? geometry.getAttribute('position').count) / 3).toBe(2);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const hit = new Raycaster(new Vector3(15, 200, 37), new Vector3(0, -1, 0)).intersectObject(
    new Mesh(geometry, material),
  )[0]!;
  expect(hit.point.y).toBeCloseTo(terrain.surfaceAt(15, 37), 4);
  expect(hit.uv!.x).toBeCloseTo(15 / 80, 5);
  expect(hit.uv!.y).toBeCloseTo(1 - 37 / 80, 5);
  geometry.dispose();
  material.dispose();
});

unitTest('V105 merged planes keep shared edge vertices to prevent ground cracks', () => {
  const bytes = Buffer.alloc(9 * 9 * 2);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      bytes.writeInt16LE((c + 2 * r + (c === 8 ? (r % 2 ? 5 : 10) : 0)) * 10, (r * 9 + c) * 2);
  const terrain = createTerrain({
    ...slopeGrid,
    cols: 9,
    rows: 9,
    heights: bytes.toString('base64'),
  });
  const mesh = groundMesh(terrain, { minX: 0, minY: 0, maxX: 80, maxY: 80 });
  const p = mesh.getAttribute('position');
  const points = Array.from(
    { length: p.count },
    (_, i) => new Vector3(p.getX(i), p.getY(i), p.getZ(i)),
  );
  let junctions = 0;
  const count = mesh.index?.count ?? p.count;
  for (let i = 0; i < count; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = points[mesh.index?.getX(i + j) ?? i + j]!;
      const b = points[mesh.index?.getX(i + ((j + 1) % 3)) ?? i + ((j + 1) % 3)]!;
      const edge = b.clone().sub(a),
        length = edge.lengthSq();
      for (const v of points) {
        const t = v.clone().sub(a).dot(edge) / length;
        if (
          t > 1e-5 &&
          t < 1 - 1e-5 &&
          a.clone().addScaledVector(edge, t).distanceToSquared(v) < 1e-8
        )
          junctions++;
      }
    }
  expect(junctions).toBe(0);
  mesh.dispose();
});

unitTest('V105 paint keeps its planar footprint on grid folds and linear decks', () => {
  for (const layer of [0, 1]) {
    const b = buildCity('Paint across a grid fold', 105);
    const road = b.road(b.node(0, 5, layer), b.node(30, 5, layer), {
      lanes: 2,
      via: layer
        ? []
        : [
            { x: 10, y: 6 },
            { x: 20, y: 4 },
          ],
    });
    road.layer = layer;
    const result = compile(b.city);
    if (!result.ok) throw new Error('Compile failed');
    const plain = buildGeometry(result.compiled, b.city);
    const terrain = {
      ...slopeGrid,
      heights: Buffer.from([0, 0, 100, 0, 200, 0, 88, 2]).toString('base64'),
    };
    const relief = buildGeometry(result.compiled, { ...b.city, terrain });
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(relief.markings, material);
    const p = plain.markings.getAttribute('position');
    expect(p.count).toBeGreaterThan(0);
    for (let i = 0; i < p.count; i += 21) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const y = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const hit = new Raycaster(new Vector3(x, 1000, y), new Vector3(0, -1, 0)).intersectObject(
        mesh,
      )[0];
      expect(hit, 'Missing paint at ' + x + ',' + y).toBeDefined();
      const h = layer
        ? heightAt(relief.heights.roads[0]!, roadStation(result.compiled.roads[0]!, { x, y }))
        : relief.heights.terrain.surfaceAt(x, y);
      // TASK-108's 3D paint clearance is 0.025 m (merge with TASK-105).
      expect(hit!.point.y).toBeCloseTo(h + 0.025, 3);
    }
    material.dispose();
    for (const g of [plain, relief])
      for (const part of [
        g.surfaces,
        g.slabs,
        g.markings,
        g.crossings,
        g.places,
        g.context.ground,
        g.context.buildings,
      ])
        part.dispose();
  }
});

unitTest('V105 coloured terrain preserves ground heights, holes and context draw order', () => {
  const ring = (x: number, y: number, w: number, h: number) => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const terrain = createTerrain(slopeGrid);
  const ground = groundMesh(terrain, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  const result = buildTerrainGround(ground, [
    { kind: 'area', class: 'green', rings: [ring(0, 0, 10, 10), ring(3, 3, 4, 4)] },
    { kind: 'area', class: 'parking', rings: [ring(8, 0, 2, 10)] },
  ]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const opaque = new Mesh(result.opaque, material),
    transparent = new Mesh(result.transparent, material);
  const hit = (mesh: Mesh, x: number, y: number) =>
    new Raycaster(new Vector3(x, 200, y), new Vector3(0, -1, 0)).intersectObject(mesh)[0];
  for (const [x, y, colour] of [
    [1, 2, style.context.green],
    [5, 5, style.background],
    [9, 5, style.context.parking],
  ]) {
    const h = hit(opaque, x!, y!)!;
    expect(h.point.y).toBeCloseTo(terrain.surfaceAt(x!, y!), 4);
    const expected = new Color(colour!);
    const colors = result.opaque.getAttribute('color');
    expect(colors.getX(h.face!.a)).toBeCloseTo(expected.r, 5);
    expect(colors.getY(h.face!.a)).toBeCloseTo(expected.g, 5);
    expect(colors.getZ(h.face!.a)).toBeCloseTo(expected.b, 5);
  }
  expect(hit(transparent, 5, 5)).toBeUndefined();
  expect(hit(transparent, 1, 2)).toBeDefined();
  ground.dispose();
  result.opaque.dispose();
  result.transparent.dispose();
  material.dispose();
});

unitTest(
  'V105 mixes level water with draped ground and offsets buildings by the lowest footprint',
  () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    const terrain = createTerrain(slopeGrid);
    const context = buildContext(
      [
        { kind: 'area', class: 'green', rings: [ring] },
        { kind: 'area', class: 'water', rings: [ring] },
        { kind: 'area', class: 'building', rings: [ring], heightM: 12 },
      ],
      terrain,
    );
    const ground = context.ground.getAttribute('position');
    expect(ground.count).toBeGreaterThan(6);
    const water = Array.from({ length: 6 }, (_, i) => ground.getY(ground.count - 1 - i));
    for (const height of water) expect(height).toBeCloseTo(99.975, 4);
    context.buildings.computeBoundingBox();
    expect(context.buildings.boundingBox!.min.y).toBe(100);
    expect(context.buildings.boundingBox!.max.y).toBe(112);
    context.ground.dispose();
    context.buildings.dispose();
  },
);

unitTest('V105 building foundations include a valley inside the footprint', () => {
  const samples = [1000, 1000, 1000, 1000, 0, 1000, 1000, 1000, 1000];
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((height, i) => bytes.writeInt16LE(height, i * 2));
  const terrain = createTerrain({
    ...slopeGrid,
    baseM: 0,
    cols: 3,
    rows: 3,
    heights: bytes.toString('base64'),
  });
  const rings = [
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ],
  ];
  const context = buildContext([{ kind: 'area', class: 'building', rings, heightM: 12 }], terrain);
  context.buildings.computeBoundingBox();
  expect(context.buildings.boundingBox!.min.y).toBeCloseTo(0, 8);
  expect(context.buildings.boundingBox!.max.y).toBe(12);
  context.buildings.dispose();
  context.ground.dispose();
});

unitTest('V105 retains terrain at the project boundary and rejects malformed grids', () => {
  const city = grid5x5();
  expect(citySchema.parse({ ...city, terrain: slopeGrid }).terrain).toEqual(slopeGrid);
  for (const change of [
    { heights: 'AAAA' },
    { cellM: 0 },
    { cols: 0 },
    { heights: '!!!!!!!!!!!!' },
  ])
    expect(citySchema.safeParse({ ...city, terrain: { ...slopeGrid, ...change } }).success).toBe(
      false,
    );
});

unitTest('V105 samples centres, interpolates metres and clamps outside the grid', () => {
  const terrain = createTerrain(slopeGrid);
  expect(terrain.groundAt(0, 0)).toBe(100);
  expect(terrain.groundAt(10, 10)).toBe(130);
  expect(terrain.groundAt(5, 5)).toBe(115);
  expect(terrain.groundAt(-100, 100)).toBe(120);
  expect(createTerrain().groundAt(500, -200)).toBe(0);
  const mesh = groundMesh(terrain, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  const positions = mesh.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    expect(positions.getY(i)).toBeCloseTo(
      terrain.surfaceAt(positions.getX(i), positions.getZ(i)),
      4,
    );
  mesh.dispose();
});

unitTest(
  'V105 building foundations cut the ground while courtyard holes retain their terrain',
  () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    const hole = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 4 },
    ];
    const terrain = createTerrain(slopeGrid, [
      { kind: 'area', class: 'building', rings: [outer, hole] },
    ]);
    const geometry = groundMesh(terrain, { minX: -10, minY: -10, maxX: 20, maxY: 20 }, -0.04);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    const at = (x: number, y: number) =>
      new Raycaster(new Vector3(x, 200, y), new Vector3(0, -1, 0)).intersectObject(mesh)[0]!.point
        .y;
    expect(at(2, 2)).toBeCloseTo(99.96, 4);
    expect(at(5, 5)).toBeCloseTo(114.96, 4);
    geometry.dispose();
    mesh.material.dispose();
  },
);

unitTest('V105 a partial basemap cell uses the original terrain diagonal', () => {
  const terrain = createTerrain({
    ...slopeGrid,
    baseM: 0,
    heights: Buffer.from([0, 0, 0, 0, 0, 0, 100, 0]).toString('base64'),
  });
  const geometry = groundMesh(terrain, { minX: 5, minY: 0, maxX: 10, maxY: 10 });
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  const hit = new Raycaster(new Vector3(5.01, 30, 4.99), new Vector3(0, -1, 0)).intersectObject(
    mesh,
  )[0]!;
  expect(hit.point.y).toBeCloseTo(terrain.surfaceAt(5.01, 4.99), 5);
  geometry.dispose();
  mesh.material.dispose();
});

unitTest('V105 wide basemap views bound geometry to the varying terrain extent', () => {
  const terrain = createTerrain(slopeGrid);
  const mesh = groundMesh(terrain, { minX: -100, minY: -100, maxX: 100, maxY: 100 });
  expect(mesh.getAttribute('position').count).toBeLessThan(1000);
  mesh.computeBoundingBox();
  expect(mesh.boundingBox!.min.x).toBe(-100);
  expect(mesh.boundingBox!.max.x).toBe(100);
  mesh.dispose();
});

unitTest('V105 raised junctions stay level across a transverse ground slope', () => {
  const b = buildCity('Raised junction', 105);
  const a = b.node(-100, 0, 1),
    junction = b.node(0, 0, 1),
    end = b.node(100, 0, 1),
    side = b.node(0, 100, 1);
  b.road(a, junction).layer = 1;
  b.road(junction, end).layer = 1;
  b.road(junction, side).layer = 1;
  b.city.terrain = {
    ...slopeGrid,
    originM: { x: -100, y: -100 },
    cellM: 200,
    heights: Buffer.from([0, 0, 0, 0, 200, 0, 200, 0]).toString('base64'),
  };
  const result = compile(b.city);
  if (!result.ok) throw new Error('Compile failed');
  const geometry = buildGeometry(result.compiled, b.city);
  const node = result.compiled.nodes[result.compiled.index.node.get(junction.id)!]!;
  expect(node.outline.length).toBeGreaterThan(0);
  const p = geometry.surfaces.getAttribute('position');
  for (const point of node.outline) {
    const heights = Array.from({ length: p.count }, (_, i) => i)
      .filter((i) => Math.hypot(p.getX(i) - point.x, p.getZ(i) - point.y) < 1e-4)
      .map((i) => p.getY(i));
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect(height).toBeCloseTo(115, 4);
  }
  for (const part of [
    geometry.surfaces,
    geometry.slabs,
    geometry.markings,
    geometry.crossings,
    geometry.places,
    geometry.context.ground,
    geometry.context.buildings,
  ])
    part.dispose();
});

unitTest(
  'V105 vehicle instances sit within 0.3 m of the rendered road on a transverse slope',
  () => {
    const b = buildCity('Crossfall', 105),
      a = b.node(0, 0),
      end = b.node(100, 0);
    b.road(a, end, { lanes: 2 });
    b.city.terrain = {
      ...slopeGrid,
      originM: { x: 0, y: -100 },
      cellM: 200,
      heights: Buffer.from([0, 0, 0, 0, 232, 3, 232, 3]).toString('base64'),
    };
    const compiled = compile(b.city);
    if (!compiled.ok) throw new Error('Compile failed');
    const city = compiled.compiled,
      geometry = buildGeometry(city, b.city),
      vehicles = new Vehicles3D();
    const points = city.lanes.map((lane) =>
      pointAtDistance(lane.polyline, lane.cumulative, lane.lengthM / 2),
    );
    vehicles.setGeometry(city);
    vehicles.setSnapshot({
      timeS: 0,
      count: 2,
      id: new Uint32Array([1, 2]),
      x: Float32Array.from(points, (p) => p.x),
      y: Float32Array.from(points, (p) => p.y),
      heading: new Float32Array(2),
      speed: new Float32Array(2),
      lateralM: new Float32Array(2),
      lane: new Int32Array([0, 1]),
      state: new Uint8Array([1, 1]),
      vclass: new Uint8Array(2),
      fade: new Float32Array([1, 1]),
    });
    vehicles.animate(0, city, geometry.heights);
    const surface = new Mesh(geometry.surfaces, new MeshBasicMaterial({ side: DoubleSide }));
    for (let i = 0; i < 2; i++) {
      const matrix = new Matrix4();
      vehicles.mesh.getMatrixAt(i, matrix);
      const position = new Vector3().setFromMatrixPosition(matrix);
      position.y += terrainVehicleOffset(city, geometry.heights, i, {
        x: position.x,
        y: position.z,
      });
      const hit = new Raycaster(
        position.clone().add(new Vector3(0, 1, 0)),
        new Vector3(0, -1, 0),
      ).intersectObject(surface)[0]!;
      expect(Math.abs(position.y - hit.point.y)).toBeLessThan(0.3);
    }
    vehicles.destroy();
    surface.material.dispose();
    for (const part of [
      geometry.surfaces,
      geometry.slabs,
      geometry.markings,
      geometry.crossings,
      geometry.places,
      geometry.context.ground,
      geometry.context.buildings,
    ])
      part.dispose();
  },
);

unitTest('V105 level water excavates land while preserving an island hole', () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ];
  const hole = [
    { x: 4, y: 4 },
    { x: 6, y: 4 },
    { x: 6, y: 6 },
    { x: 4, y: 6 },
    { x: 4, y: 4 },
  ];
  const terrain = createTerrain(slopeGrid, [{ kind: 'area', class: 'water', rings: [ring, hole] }]);
  const geometry = groundMesh(terrain, { minX: -10, minY: -10, maxX: 20, maxY: 20 }, -0.04);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  const hitAt = (x: number, y: number) =>
    new Raycaster(new Vector3(x, 200, y), new Vector3(0, -1, 0)).intersectObject(mesh)[0]!.point.y;
  expect(hitAt(2, 2)).toBeCloseTo(99.96, 4);
  expect(hitAt(5, 5)).toBeCloseTo(114.96, 4);
  geometry.dispose();
  mesh.material.dispose();
});

unitTest('V105 ramps blend sampled ground into the straight deck baseline', () => {
  const b = buildCity('Ramp over valley', 105),
    a = b.node(0, 0),
    end = b.node(100, 0, 1);
  b.road(a, end).layer = 1;
  b.city.terrain = {
    ...slopeGrid,
    cols: 3,
    cellM: 50,
    heights: Buffer.from([0, 0, 156, 255, 100, 0, 0, 0, 156, 255, 100, 0]).toString('base64'),
  };
  const result = compile(b.city);
  if (!result.ok) throw new Error('Compile failed');
  const height = cityHeights(result.compiled, b.city).roads[0]!;
  expect(heightAt(height, height.lengthM / 2)).toBeCloseTo(99.875);
});

unitTest('V105 a deck adds an end-to-end linear ground baseline to its grade profile', () => {
  const b = buildCity('Deck over valley', 105);
  const a = b.node(0, 0, 1),
    end = b.node(100, 0, 1);
  b.road(a, end).layer = 1;
  // A valley at the midpoint distinguishes a straight deck from sampled ground.
  const terrain = {
    ...slopeGrid,
    cols: 3,
    cellM: 50,
    heights: Buffer.from([0, 0, 156, 255, 100, 0, 0, 0, 156, 255, 100, 0]).toString('base64'),
  };
  b.city.terrain = terrain;
  const result = compile(b.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const heights = cityHeights(result.compiled, b.city);
  const road = heights.roads[0]!;
  expect(heightAt(road, 0)).toBeCloseTo(105);
  expect(heightAt(road, road.lengthM / 2)).toBeCloseTo(110);
  expect(heightAt(road, road.lengthM)).toBeCloseTo(115);
});

for (const name of tierCities(['grid', 'town', 'sindelfingen-a81', 'munich-donnersberger'])) {
  unitOrCity(name);
}

function unitOrCity(name: string) {
  // Registered in each tier with its own real city; no test performs a network request.

  test(`V105 ${name}: terrain leaves the compiled network identical`, () => {
    const city =
      name === 'grid'
        ? grid5x5()
        : name === 'town'
          ? town()
          : (() => {
              const result = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
                importerVersion: '1',
                terrain: false,
              });
              if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
              return result.city;
            })();
    const terrain =
      name === 'grid' || name === 'town'
        ? slopeGrid
        : JSON.parse(readFileSync(`fixtures/terrain/${name}.json`, 'utf8'));
    const hash = (value: unknown) =>
      createHash('sha256')
        .update(JSON.stringify(value, (_, v: unknown) => (v instanceof Map ? [...v] : v)))
        .digest('hex');
    const plain = compile(city);
    const before = hash(plain);
    expect(hash(compile({ ...city, terrain }))).toBe(before);
    if (name !== 'grid' && name !== 'town') {
      expect(
        Buffer.byteLength(JSON.stringify(terrain)) / Buffer.byteLength(JSON.stringify(city)),
      ).toBeLessThanOrEqual(0.15);
      const sampler = createTerrain(terrain);
      if (!plain.ok) throw new Error('Compile failed');
      const heights = cityHeights(plain.compiled, { ...city, terrain });
      const grades = cityGrades(plain.compiled, city);
      let worstM = 0;
      let worst = '';
      for (const road of plain.compiled.roads) {
        if (
          Math.min(
            grades.roadGrades[road.idx]!,
            grades.nodeGrades[road.from]!,
            grades.nodeGrades[road.to]!,
          ) < 0
        )
          continue;
        const cumulative = cumulativeLengths(road.reference);
        for (let s = 0; s <= heights.roads[road.idx]!.lengthM; s += 2) {
          const p = pointAtDistance(road.reference, cumulative, s + road.stations[0]!);
          const gap = sampler.groundAt(p.x, p.y) - heightAt(heights.roads[road.idx]!, s);
          if (gap > worstM) {
            worstM = gap;
            worst = JSON.stringify({
              id: road.id,
              s,
              grade: grades.roadGrades[road.idx],
              from: grades.nodeGrades[road.from],
              to: grades.nodeGrades[road.to],
            });
          }
        }
      }
      expect(worstM, worst).toBeLessThanOrEqual(0.3);
      const bytes = Buffer.from(terrain.heights, 'base64');
      for (let row = 0; row < terrain.rows; row += 13)
        for (let col = 0; col < terrain.cols; col += 11)
          expect(
            sampler.groundAt(
              terrain.originM.x + col * terrain.cellM,
              terrain.originM.y + row * terrain.cellM,
            ),
          ).toBeCloseTo(terrain.baseM + bytes.readInt16LE((row * terrain.cols + col) * 2) / 10, 8);
    }
  });
}
