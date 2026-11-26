// TASK-273: city walls and gates read into the context (TASK-259's D5, York). The excerpt is York's
// walls at Micklegate and Bootham Bars from the 2026-11-21 extract (ODbL, see its note).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createGeoReference, lonLatToLocal } from '../../src/geo/projection';
import { pointInPolygon, polylineLength } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importContext } from '../../src/importers/osm/context';
import { parseOsm, type OsmData } from '../../src/importers/osm/parse';
import type { ContextFeature } from '../../src/schema';

type Line = Extract<ContextFeature, { kind: 'line' }>;
const york = parseOsm(readFileSync('tests/importers/york-walls.osm', 'utf8')) as OsmData;
const far = { min: { x: -1e5, y: -1e5 }, max: { x: 1e5, y: 1e5 } };

function read(data: OsmData) {
  const geo = createGeoReference({ lon: -1.085, lat: 53.958 });
  const positions = new Map(data.node.map((node) => [node.id, lonLatToLocal(geo, node)]));
  return { features: importContext(data, positions, far), positions };
}
const walls = (features: ContextFeature[]) =>
  features.filter((f): f is Line => f.kind === 'line' && f.class === 'city_wall');
/** The wall line drawn from one OSM way: the one whose ends are that way's end nodes. */
function wallOf(features: ContextFeature[], positions: Map<number, Vec2>, way: number) {
  const nd = york.way.find((w) => w.id === way)!.nd;
  const [a, b] = [positions.get(nd[0]!)!, positions.get(nd.at(-1)!)!];
  const near = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) < 0.2;
  return walls(features).find((f) => near(f.line[0]!, a) && near(f.line.at(-1)!, b));
}
const withTags = (data: OsmData, way: number, tag: Record<string, string>): OsmData => ({
  ...data,
  way: data.way.map((w) => (w.id === way ? { ...w, tag: { ...w.tag, ...tag } } : w)),
});

test("York's walls at Micklegate and Bootham Bars: walls, walkways, bridges and gates by name", () => {
  const { features, positions } = read(york);
  const lines = walls(features);
  // 22 ways: 2 gatehouses, 3 stairs onto the wall, 17 wall ways.
  expect(lines).toHaveLength(17);
  const km = lines.reduce((sum, f) => sum + polylineLength(f.line), 0) / 1000;
  expect(km).toBeCloseTo(0.45, 2);
  expect(lines.filter((f) => f.walkway)).toHaveLength(12);
  expect(lines.filter((f) => f.bridge)).toHaveLength(3);
  // Gates by name: the two bars are gatehouses (their buildings), Victoria Bar a wall over its arch.
  const buildings = features.filter((f) => f.kind === 'area' && f.class === 'building');
  expect(buildings.map((f) => f.kind === 'area' && f.sub).sort()).toEqual(['castle', 'gatehouse']);
  const victoria = wallOf(features, positions, 133326570)!;
  expect(victoria).toMatchObject({ walkway: true, bridge: true, layer: 1 });
  expect(features.filter((f) => f.class === 'city_gate')).toEqual([]);
});

test('a city wall is barrier=city_wall or the older historic=citywalls, never its stairs', () => {
  const { features, positions } = read(york);
  // Abbey Wall: barrier=wall with historic=citywalls; 259734653: a footway with historic=citywalls.
  expect(wallOf(features, positions, 57867248)).toBeDefined();
  expect(wallOf(features, positions, 259734653)).toMatchObject({ walkway: true });
  for (const steps of [259595368, 732608154, 732608156])
    expect(wallOf(features, positions, steps)).toBeUndefined();
  // A plain wall way (no footway) has no walkway; one without `bridge` spans nothing.
  expect(wallOf(features, positions, 259489179)).toEqual(
    expect.not.objectContaining({ walkway: expect.anything() }),
  );
  expect(wallOf(features, positions, 259595296)).toEqual(
    expect.not.objectContaining({ bridge: expect.anything() }),
  );
});

test("a wall reads its tagged height and width; a wall on a building is that building's", () => {
  let data = withTags(york, 259489179, { height: '5.5', width: "8'" });
  data = withTags(data, 259595296, { building: 'yes' });
  const { features, positions } = read(data);
  expect(wallOf(features, positions, 259489179)).toMatchObject({ heightM: 5.5 });
  expect(wallOf(features, positions, 259489179)!.widthM).toBeCloseTo(2.44, 2);
  expect(wallOf(features, positions, 259595296)).toBeUndefined();
});

test('a footway on a wall inside a wood is the wall, not a wooded path', () => {
  const wall = york.way.find((w) => w.id === 173550443)!;
  const nodes = york.node.filter((n) => wall.nd.includes(n.id));
  const lat = nodes.map((n) => n.lat),
    lon = nodes.map((n) => n.lon);
  const box = [
    [Math.min(...lat) - 0.001, Math.min(...lon) - 0.001],
    [Math.min(...lat) - 0.001, Math.max(...lon) + 0.001],
    [Math.max(...lat) + 0.001, Math.max(...lon) + 0.001],
    [Math.max(...lat) + 0.001, Math.min(...lon) - 0.001],
  ];
  const data: OsmData = {
    ...york,
    node: [
      ...york.node,
      ...box.map(([lat, lon], i) => ({ id: -1 - i, lat: lat!, lon: lon!, tag: {} })),
    ],
    way: [...york.way, { id: -1, nd: [-1, -2, -3, -4, -1], tag: { natural: 'wood' } }],
  };
  const { features, positions } = read(data);
  const line = wallOf(features, positions, 173550443)!;
  expect(line).toMatchObject({ walkway: true });
  // The stairs in the wood are paths; nothing is paved along the wall itself.
  const middle = {
    x: (line.line[0]!.x + line.line.at(-1)!.x) / 2,
    y: (line.line[0]!.y + line.line.at(-1)!.y) / 2,
  };
  const paths = features.filter((f) => f.kind === 'area' && f.sub === 'path');
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.filter((f) => f.kind === 'area' && pointInPolygon(middle, f.rings[0]!))).toEqual([]);
});

/** A street east-west through a gate node at the origin, with an optional gatehouse around it. */
function gateOnStreet(street: Record<string, string>, gate: Record<string, string>, house = false) {
  const geo = createGeoReference({ lon: 0, lat: 0 });
  const at = (x: number, y: number) => {
    const lon = x / (6378137 * (Math.PI / 180));
    return { lon, lat: -y / (6378137 * (Math.PI / 180)) };
  };
  const node = (id: number, x: number, y: number, tag: Record<string, string> = {}) => ({
    id,
    ...at(x, y),
    tag,
  });
  const data: OsmData = {
    node: [
      node(1, -40, 0),
      node(2, 0, 0, gate),
      node(3, 40, 0),
      node(4, 0, 30, gate),
      node(11, -5, -8),
      node(12, 5, -8),
      node(13, 5, 8),
      node(14, -5, 8),
    ],
    way: [
      { id: 1, nd: [1, 2, 3], tag: street },
      ...(house ? [{ id: 2, nd: [11, 12, 13, 14, 11], tag: { building: 'gatehouse' } }] : []),
    ],
    relation: [],
  };
  const positions = new Map(data.node.map((n) => [n.id, lonLatToLocal(geo, n)]));
  return importContext(data, positions, far).filter((f) => f.class === 'city_gate') as Line[];
}

test('a gate mapped only as a node is an arch across its way, sized from the way', () => {
  const gate = { historic: 'city_gate', name: 'Test Bar' };
  // Square to the street, through the node; 6 m of road and a 1.5 m pier each side.
  const [arch, ...rest] = gateOnStreet({ highway: 'tertiary' }, gate);
  expect(rest).toEqual([]); // node 4 lies on no way: it has no direction
  expect(arch!.line.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])).toEqual([
    [0, -4.5],
    [0, 4.5],
  ]);
  expect(arch!.heightM).toBeUndefined();
  const length = (street: Record<string, string>, tag = gate) =>
    polylineLength(gateOnStreet(street, tag)[0]!.line);
  expect(length({ highway: 'tertiary', lanes: '3' })).toBeCloseTo(12, 1);
  expect(length({ highway: 'tertiary', width: '7.5', lanes: '3' })).toBeCloseTo(10.5, 1);
  expect(length({ highway: 'footway' })).toBeCloseTo(6, 1);
  expect(gateOnStreet({ highway: 'tertiary' }, { ...gate, height: '9' })[0]!.heightM).toBe(9);
  // A gate node inside a mapped gatehouse is that building's gate.
  expect(gateOnStreet({ highway: 'tertiary' }, gate, true)).toEqual([]);
});
