// TASK-136: crossing metadata/facilities change whole-network pins; T75 strips them and retains the previous bytes.
// TASK-127: compiled rail gains boundary flags; T62 still pins unchanged lanes/movements.
// TASK-124: re-pin repaired/split connector data and exit warnings; T61 pins unchanged car geometry and strips.
// TASK-126: whole-city/compile pins include rail and station metadata; T62 keeps main lane/movement hashes.
import { createHash } from 'node:crypto';
import { InstancedMesh, Matrix4, Mesh } from 'three';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import {
  distance,
  nearestOnPolyline,
  parallelOffset,
  pointInPolygon,
  pointAtDistance,
} from '../../src/geo/polyline';
import { placeStreet, treeContext } from '../../src/render/street';
import { placeTrees } from '../../src/render/vegetation';
import { busLabels, roadMarkingGeometry } from '../../src/render/marking-geometry';
import { importOsmCached } from '../../bench/city-cache';
import type { City } from '../../src/schema';
import { crossingEnabled, crossingPlacement } from '../../src/network/crossings';
import { drawStreet } from '../../src/render/layers/street';
import { cityGrades } from '../../src/render/grades';
import { buildCurbs, buildStreet, signHeight } from '../../src/render3d/street';
import { cityHeights, roadStation } from '../../src/render3d/heights';
import { tierCities, unitTest } from '../tier';

function compiled(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error('Invalid fixture');
  return result.compiled;
}

unitTest(
  'V107 deterministic verge lamps keep clear of roads, junctions, trees, water and buildings',
  () => {
    const city = grid5x5();
    const ring = (x: number) => [
      { x, y: 20 },
      { x: x + 35, y: 20 },
      { x: x + 35, y: 100 },
      { x, y: 100 },
      { x, y: 20 },
    ];
    city.context = {
      features: [
        { kind: 'point', class: 'street_lamp', pos: { x: 48, y: -3.5 }, heightM: 9 },
        { kind: 'point', class: 'tree', pos: { x: 75, y: -10 }, crownM: 4 },
        { kind: 'area', class: 'building', rings: [ring(20)] },
        { kind: 'area', class: 'water', rings: [ring(140)] },
      ],
    };
    const network = compiled(city),
      before = JSON.stringify(city);
    const trees = placeTrees(network, treeContext(city)).trees.filter(
      (tree) => tree.source !== 'street',
    );
    const result = placeStreet(network, city, trees);
    expect(placeStreet(network, city, trees)).toEqual(result);
    expect(result.counts.lamps.osm).toBe(1);
    expect(result.counts.lamps.generated).toBeGreaterThan(0);
    for (const lamp of result.lamps.filter((l) => l.source === 'generated')) {
      expect(distance(lamp.pos, { x: 48, y: -3.5 })).toBeGreaterThanOrEqual(25);
      for (const tree of trees) expect(distance(lamp.pos, tree.pos)).toBeGreaterThanOrEqual(8);
      for (const road of network.roads)
        expect(pointInPolygon(lamp.pos, [...road.surface, road.surface[0]!])).toBe(false);
      for (const node of network.nodes)
        expect(distance(lamp.pos, node.pos)).toBeGreaterThanOrEqual(12);
      for (const feature of city.context.features)
        if (feature.kind === 'area')
          expect(pointInPolygon(lamp.pos, feature.rings[0]!)).toBe(false);
    }
    expect(placeTrees(network, treeContext(city)).counts.osm).toBe(1);
    expect(JSON.stringify(city)).toBe(before);
    expect(compiled(city)).toEqual(network);
  },
);

unitTest(
  'V107 signs mark every entering restriction once and omit internal zone roads and open exits',
  () => {
    const b = buildCity('zones', 1),
      a = b.node(0, 0),
      c = b.node(120, 0),
      d = b.node(240, 0),
      e = b.node(360, 0);
    b.road(a, c);
    const entry = b.road(c, d),
      internal = b.road(d, e);
    entry.access = internal.access = { all: 'destination', truck: 'no' };
    b.road(e, d).access = { all: 'destination', truck: 'no' };
    b.road(d, c).access = { all: 'destination', truck: 'no' };
    b.road(c, a);
    const network = compiled(b.city),
      result = placeStreet(network, b.city, []);
    expect(result.signs.map((s) => network.roads[s.road]!.id)).toEqual([entry.id]);
    expect(result.signs[0]!.rules).toEqual(['destination', 'no']);
  },
);

unitTest('V107 BUS labels belong only to bus-only lanes, recur at 50m and use shared paint', () => {
  const b = buildCity('bus', 1),
    a = b.node(0, 0),
    c = b.node(180, 0);
  const road = b.road(a, c, { lanes: 2 });
  road.lanes[1]!.allowed = ['bus'];
  const network = compiled(b.city),
    labels = busLabels(network, network.roads[0]!);
  expect(labels.length).toBe(4);
  expect(new Set(labels.map((label) => label.lane))).toEqual(new Set([1]));
  expect(labels[1]!.stationM - labels[0]!.stationM).toBe(50);
  const paint = roadMarkingGeometry(network, network.roads[0]!).below.filter(
    (s) => s.role === 'bus',
  );
  expect(paint).toEqual(labels.flatMap((l) => l.shapes));
  for (const shape of paint)
    for (const p of shape.points)
      expect(nearestOnPolyline(network.lanes[1]!.polyline, p).away).toBeLessThan(1.5);
});

unitTest('V107 curbs leave driveway gaps on both sides and exclude elevated roads', () => {
  const b = buildCity('driveway', 1),
    a = b.node(0, 0),
    c = b.node(180, 0);
  const road = b.road(a, c);
  b.place('Home', 'residential', { x: 90, y: 20 }, [{ road, direction: 'both', positionM: 90 }]);
  const network = compiled(b.city),
    result = placeStreet(network, b.city, []);
  expect(result.curbs.length).toBe(4);
  for (const curb of result.curbs)
    for (const p of curb.points)
      expect(
        Math.abs(
          p.x -
            pointAtDistance(
              network.lanes[network.connectors[0]!.lane]!.polyline,
              network.lanes[network.connectors[0]!.lane]!.cumulative,
              network.connectors[0]!.positionM,
            ).x,
        ),
      ).toBeGreaterThanOrEqual(3);
  a.layer = c.layer = 1;
  expect(placeStreet(compiled(b.city), b.city, []).curbs).toHaveLength(0);
});

// Main 378a1f1's compile output (TASK-102/104/110 moved TASK-107's 806263a pins); TASK-107
// changes no network code. TASK-111 re-pinned: its crossing node, arm and spans and the signal
// phases' walk lists are new compiled data; with them stripped every city hashes to the previous
// pin (grid 645ce5cf…, town 4b08bdfa…, Munich db7eea6e…, Sindelfingen ad1ccb01…).
// Lead, TASK-103 merge: Munich and Sindelfingen add parking bands, entries and spaces; with
// TASK-111's fields stripped they hash to TASK-103's own pins (35122d76…, 1b4fdcc4…).
// TASK-123: derived walk joins/fallback curbs only; vehicle hashes are unchanged.
// TASK-131 keeps OSM geometry (no node merges, junction groups): both real cities re-pinned.
// Munich re-pinned for 06dae00 (median crossings offset by half their lane block)
// and e4654d8 (merging lanes kept on a group's inner roads).
// TASK-140 (B59): crossing walk links run along the stripes' centreline; only the walk graph and
// the signal phases' walk lists move (stripped of both, every city hashes as main c3a6ec2:
// grid dfe0b271…, town e546aee8…, Munich d03b61a3…, Sindelfingen 815bbb52…).
const baselines = {
  // TASK-135: Munich's 54 tram tracks gain `form` and `provenance`; with them stripped (the
  // import without assignTramForms) every pin equals c3a6ec2's. Lead: Munich re-pinned for
  // TASK-135 and TASK-140 together.
  grid: '6c1e86734dfc688415bd805d175bc5d173385a0a83fb18da32136aa1018fb3e7',
  town: '00190f0813eca63be8fbf85dfa182edd1c5c7d3512d8097ee90968bf7b21b7bc',
  // TASK-132: building passages (Munich 18 tracks, Sindelfingen 3) gain `covered`; with it
  // stripped every pin equals 2df05a1's.
  'munich-donnersberger': 'b9abe89cc3b61c28f5102ff1aeb74bcdee49e783ffabfb711b605dcc402e1b18',
  'sindelfingen-a81': '4a92587971792bdc034e1d82c976dbad5a5cb0a0d36f2e4132590615b35258cc',
};
const lampCounts = {
  grid: [0, 0],
  town: [0, 410],
  'munich-donnersberger': [113, 430], // TASK-119 mapped bands move generated furniture outward.
  'sindelfingen-a81': [47, 531],
};
test.each(tierCities(Object.keys(baselines) as (keyof typeof baselines)[]))(
  'V107 %s retains pinned network bytes and reports furniture counts',
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
    const hash = () =>
      createHash('sha256')
        .update(JSON.stringify(compile(city), (_, v: unknown) => (v instanceof Map ? [...v] : v)))
        .digest('hex');
    expect(hash()).toBe(baselines[name]);
    const network = compiled(city),
      trees = placeTrees(network, treeContext(city)).trees;
    const start = performance.now(),
      result = placeStreet(network, city, trees);
    console.info('V107', name, result.counts, { placementMs: performance.now() - start });
    for (const [i, count] of [result.counts.lamps.osm, result.counts.lamps.generated].entries()) {
      expect(count).toBeGreaterThanOrEqual(lampCounts[name][i]! * 0.9);
      expect(count).toBeLessThanOrEqual(lampCounts[name][i]! * 1.1);
    }
    expect(hash()).toBe(baselines[name]);
  },
);

unitTest('V107 generated lamps space and stagger both verges on a wide street', () => {
  const b = buildCity('lamps', 1),
    a = b.node(0, 0),
    c = b.node(200, 0);
  const road = b.road(a, c, { lanes: 4 });
  const network = compiled(b.city),
    result = placeStreet(network, b.city, []);
  const near = result.lamps.filter((lamp) => lamp.pos.y > 0),
    far = result.lamps.filter((lamp) => lamp.pos.y < 0);
  expect(near.length).toBeGreaterThan(3);
  expect(far.length).toBeGreaterThan(3);
  expect(near[1]!.pos.x - near[0]!.pos.x).toBeCloseTo(30);
  expect(far[0]!.pos.x - near[0]!.pos.x).toBeCloseTo(15);
  for (const lamp of result.lamps)
    expect(
      nearestOnPolyline([...network.roads[0]!.surface, network.roads[0]!.surface[0]!], lamp.pos)
        .away,
    ).toBeCloseTo(0.5);
  road.roadClass = 'motorway';
  expect(placeStreet(compiled(b.city), b.city, []).lamps).toHaveLength(0);
});
unitTest('V107 every crossing opens the curb and its 3D strip is 12cm high', () => {
  const city = grid5x5(),
    network = compiled(city),
    result = placeStreet(network, city, []);
  let crossings = 0;
  for (const road of network.roads)
    for (const end of [false, true]) {
      if (!crossingEnabled(network, road, end, city)) continue;
      const stripes = crossingPlacement(network, road, end).stripes;
      if (!stripes.length) continue;
      crossings++;
      const lane = network.lanes[road.lanes[0]!]!;
      const stations = stripes.flat().map((p) => nearestOnPolyline(lane.polyline, p).along);
      const lo = Math.min(...stations),
        hi = Math.max(...stations);
      for (const curb of result.curbs.filter((curb) => curb.road === road.idx))
        for (let i = 1; i < curb.points.length; i++) {
          const a = nearestOnPolyline(lane.polyline, curb.points[i - 1]!).along;
          const b = nearestOnPolyline(lane.polyline, curb.points[i]!).along;
          expect(Math.max(a, b) <= lo || Math.min(a, b) >= hi).toBe(true);
        }
    }
  expect(crossings).toBeGreaterThan(0);
  const geometry = buildCurbs(result.curbs, network, cityHeights(network, city));
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.min.y).toBe(0);
  expect(geometry.boundingBox!.max.y).toBeCloseTo(0.12);
  geometry.dispose();
});

unitTest('V107 a paired street opens both outside curbs at a driveway on either direction', () => {
  const b = buildCity('paired driveway', 1),
    a = b.node(0, 0),
    c = b.node(180, 0);
  const [road] = b.street(a, c);
  b.place('North home', 'residential', { x: 90, y: -20 }, [
    { road, direction: 'both', positionM: 90 },
  ]);
  const network = compiled(b.city),
    street = placeStreet(network, b.city, []);
  const connector = network.connectors[0]!,
    lane = network.lanes[connector.lane]!;
  const at = pointAtDistance(lane.polyline, lane.cumulative, connector.positionM);
  expect(street.curbs).toHaveLength(4);
  for (const curb of street.curbs)
    for (let i = 1; i < curb.points.length; i++) {
      const from = curb.points[i - 1]!.x,
        to = curb.points[i]!.x;
      expect(Math.max(from, to) <= at.x - 3 || Math.min(from, to) >= at.x + 3).toBe(true);
    }
});
unitTest('V107 elevated entry signs use their road deck and not ground below it', () => {
  const b = buildCity('bridge sign', 1),
    a = b.node(0, 0, 1),
    c = b.node(180, 0, 1);
  b.road(a, c).access = { all: 'private' };
  const network = compiled(b.city),
    street = placeStreet(network, b.city, []),
    heights = cityHeights(network, b.city);
  expect(street.signs).toHaveLength(1);
  expect(heights.terrain.groundAt(0, 0)).toBe(0);
  expect(signHeight(street.signs[0]!, network, heights)).toBe(5);
});

unitTest('V107 an eligible elevated street still gets lamps while its curb stays absent', () => {
  const b = buildCity('bridge lamps', 1),
    a = b.node(0, 0, 1),
    c = b.node(180, 0, 1);
  b.road(a, c, { roadClass: 'secondary' });
  const network = compiled(b.city),
    street = placeStreet(network, b.city, []);
  expect(street.curbs).toHaveLength(0);
  expect(street.lamps.length).toBeGreaterThan(0);
  expect(street.lamps.every((lamp) => lamp.road === 0)).toBe(true);
});

unitTest('V107 2D lamp geometry belongs above its elevated road grade', () => {
  const b = buildCity('lamp grade', 1),
    a = b.node(0, 0, 1),
    c = b.node(180, 0, 1);
  b.road(a, c, { roadClass: 'secondary' });
  const network = compiled(b.city),
    street = placeStreet(network, b.city, []);
  const flat = drawStreet(street, cityGrades(network, b.city).roadGrades);
  expect(Array.isArray(flat)).toBe(true);
  expect(flat).toHaveLength(1);
  expect(flat[0]!.grade).toBe(1);
  for (const lamp of street.lamps) expect(flat[0]!.lamps.containsPoint(lamp.pos)).toBe(true);
  for (const layer of flat) layer.container.destroy({ children: true, context: true });
});

unitTest('V107 an OSM lamp beside an elevated road keeps its tagged height above the deck', () => {
  const b = buildCity('OSM bridge lamp', 1),
    a = b.node(0, 0, 1),
    c = b.node(180, 0, 1);
  b.road(a, c, { roadClass: 'secondary' });
  b.city.context = {
    features: [{ kind: 'point', class: 'street_lamp', pos: { x: 50, y: 2.25 }, heightM: 8 }],
  };
  const network = compiled(b.city),
    street = placeStreet(network, b.city, []);
  expect(street.lamps[0]).toMatchObject({ source: 'osm', road: 0, heightM: 8 });
  const three = buildStreet(street, network, cityHeights(network, b.city));
  const posts = three.lamps.children[0] as InstancedMesh,
    matrix = new Matrix4();
  posts.getMatrixAt(0, matrix);
  expect(matrix.elements[13]! - matrix.elements[5]! / 2).toBe(5);
  expect(matrix.elements[13]! + matrix.elements[5]! / 2).toBe(13);
  three.group.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
      if (object instanceof InstancedMesh) object.dispose();
    }
  });
});

unitTest(
  'V107 tunnel streets do not generate poles through their roofs or capture surface OSM lamps',
  () => {
    const b = buildCity('tunnel lamps', 1),
      a = b.node(0, 0, -1),
      c = b.node(180, 0, -1);
    b.road(a, c, { roadClass: 'secondary' });
    const network = compiled(b.city);
    expect(placeStreet(network, b.city, []).lamps).toHaveLength(0);
    b.city.context = {
      features: [{ kind: 'point', class: 'street_lamp', pos: { x: 50, y: 2.25 } }],
    };
    const street = placeStreet(network, b.city, []);
    expect(street.lamps).toHaveLength(1);
    expect(street.lamps[0]!.road).toBeUndefined();
  },
);

unitTest('V107 paired lamps share a station grid and stagger wide two-way streets', () => {
  const b = buildCity('paired lamps', 1),
    a = b.node(0, 0),
    c = b.node(188, 0);
  const [forward, reverse] = b.street(a, c, 2);
  const network = compiled(b.city),
    street = placeStreet(network, b.city, []);
  const south = street.lamps.filter((lamp) => lamp.road === network.index.road.get(forward.id));
  const north = street.lamps.filter((lamp) => lamp.road === network.index.road.get(reverse.id));
  expect(south.length).toBeGreaterThan(2);
  expect(north.length).toBeGreaterThan(2);
  for (const lamp of south.filter((lamp) => lamp.pos.x > 30 && lamp.pos.x < 150))
    expect(Math.min(...north.map((other) => Math.abs(lamp.pos.x - other.pos.x)))).toBeCloseTo(
      15,
      2,
    );
});

unitTest('V107 curb meshes collapse straight runs and retain terrain profile changes', () => {
  const b = buildCity('curb mesh', 1),
    a = b.node(0, 0),
    c = b.node(200, 0);
  b.road(a, c);
  const network = compiled(b.city),
    heights = cityHeights(network, b.city),
    curbs = [{ road: 0, points: Array.from({ length: 101 }, (_, i) => ({ x: 30 + i, y: 2 })) }];
  const flat = buildCurbs(curbs, network, heights);
  expect(flat.index).not.toBeNull();
  expect(flat.index!.count).toBe(30);
  expect(flat.getAttribute('position').count).toBeLessThan(30);
  const normals = flat.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThanOrEqual(0);
  const capNormals = Array.from({ length: normals.count }, (_, i) => normals.getX(i));
  expect(Math.min(...capNormals)).toBe(-1);
  expect(Math.max(...capNormals)).toBe(1);
  flat.dispose();
  const peak = roadStation(network.roads[0]!, { x: 60, y: 2 });
  heights.roads[0]!.ground = (s) => (s <= peak ? s : 2 * peak - s) * 0.01;
  const hill = buildCurbs(curbs, network, heights);
  hill.computeBoundingBox();
  expect(hill.boundingBox!.max.y).toBeCloseTo(peak * 0.01 + 0.12, 5);
  expect(hill.index!.count).toBe(48);
  hill.dispose();
});

unitTest('V107 curbs remain continuous beneath a grade-separated crossing', () => {
  const b = buildCity('overpass curbs', 1),
    a = b.node(-100, 0),
    c = b.node(100, 0),
    d = b.node(0, -100, 1),
    e = b.node(0, 100, 1);
  b.road(a, c);
  b.road(d, e);
  const street = placeStreet(compiled(b.city), b.city, []);
  expect(street.curbs).toHaveLength(2);
  for (const curb of street.curbs) {
    expect(curb.road).toBe(0);
    expect(curb.points.some((p) => Math.abs(p.x) < 1)).toBe(true);
  }
});

unitTest('V107 curved curb meshes bound plan error to 1cm without dense subpixel vertices', () => {
  const b = buildCity('curved curb mesh', 1),
    a = b.node(0, 0),
    c = b.node(200, 0);
  b.road(a, c);
  const network = compiled(b.city),
    points = Array.from({ length: 101 }, (_, i) => ({ x: 30 + i, y: 2 + 0.002 * (i - 50) ** 2 })),
    mesh = buildCurbs([{ road: 0, points }], network, cityHeights(network, b.city)),
    expanded = mesh.index ? mesh.toNonIndexed() : mesh,
    positions = expanded.getAttribute('position'),
    edge = [];
  for (let i = 0; i < positions.count - 12; i += 18) {
    if (!i) edge.push({ x: positions.getX(i + 6), y: positions.getZ(i + 6) });
    edge.push({ x: positions.getX(i + 11), y: positions.getZ(i + 11) });
  }
  for (const point of parallelOffset(points, -0.1))
    expect(nearestOnPolyline(edge, point).away).toBeLessThanOrEqual(0.01001);
  expect(positions.count).toBeLessThan(750);
  if (expanded !== mesh) expanded.dispose();
  mesh.dispose();
});
