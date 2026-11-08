import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';
import { pointInPolygon } from '../../src/geo/polyline';

function graph(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled.walk;
}

test('T50 sidewalks occupy the outer curbs of a two-way pair, and both one-way curbs', () => {
  const { city, node, street, road } = buildCity('Walk curbs', 1);
  street(node(0, 0), node(120, 0));
  road(node(0, 60), node(120, 60));
  const walk = graph(city);
  expect(walk).toBeDefined();
  const sidewalks = walk.links.filter((link) => link.kind === 'sidewalk');
  expect(sidewalks).toHaveLength(4);
  expect(sidewalks.map((link) => link.line[0]!.y).sort((a, b) => a - b)).toEqual([
    -4, 4, 57.5, 62.5,
  ]);
  expect(graph(city)).toEqual(walk);
});

test('T50 no default sidewalks on service roads or expressways; separate is not generated', () => {
  const { city, node, road } = buildCity('Sidewalk rules', 1);
  for (const [i, roadClass] of (['service', 'motorway', 'trunk', 'ramp'] as const).entries())
    road(node(0, i * 50), node(120, i * 50), { roadClass });
  const r = road(node(0, 250), node(120, 250));
  r.sidewalk = { left: 'separate', right: 'no' };
  expect(graph(city).links).toHaveLength(0);
});

test('T50 corners and crossings join the grid, and crossing overrides remove only walk crossings', () => {
  const city = grid5x5();
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const walk = result.compiled.walk;
  expect(walk.links.some((link) => link.kind === 'corner')).toBe(true);
  for (const link of walk.links.filter((l) => l.kind === 'corner' && l.node !== undefined)) {
    const middle = link.line[Math.floor(link.line.length / 2)]!;
    const outline = result.compiled.nodes[link.node!]!.outline;
    if (outline.length) expect(pointInPolygon(middle, outline, 0)).toBe(false);
  }
  const crossings = walk.links.filter((link) => link.kind === 'crossing');
  expect(crossings.length).toBeGreaterThan(0);
  for (const link of crossings) {
    expect(link.crossing?.road).toBeTypeOf('number');
    expect(walk.nodes[link.from]!.links.length).toBeGreaterThan(1);
    expect(walk.nodes[link.to]!.links.length).toBeGreaterThan(1);
  }
  for (const road of Object.values(city.roads)) road.crossings = { start: false, end: false };
  const off = graph(city);
  expect(off.links.some((link) => link.kind === 'crossing')).toBe(false);
});

test('T50 mapped paths split at same-grade intersections, but a bridge stays separate', () => {
  const { city } = buildCity('Walk bridge', 1);
  city.walk = { nodes: {}, links: {} };
  for (const [i, pos] of [
    { x: -20, y: 0 },
    { x: 20, y: 0 },
    { x: 0, y: -20 },
    { x: 0, y: 20 },
    { x: -20, y: 10 },
    { x: 20, y: 10 },
  ].entries()) {
    const id = `wn:${i + 1}`;
    city.walk.nodes[id] = { id, pos, layer: i >= 4 ? 1 : 0, provenance: { source: 'osm' } };
  }
  for (const [i, pair] of [
    [1, 2],
    [3, 4],
    [5, 6],
  ].entries()) {
    const id = `wl:${i + 7}`;
    const from = `wn:${pair[0]}`,
      to = `wn:${pair[1]}`;
    city.walk.links[id] = {
      id,
      from,
      to,
      line: [city.walk.nodes[from]!.pos, city.walk.nodes[to]!.pos],
      kind: 'footway',
      widthM: null,
      provenance: { source: 'osm' },
    };
  }
  city.nextId = 20;
  const walk = graph(city);
  expect(walk.nodes.find((n) => n.pos.x === 0 && n.pos.y === 0)?.links).toHaveLength(4);
  expect(walk.links.filter((l) => l.layer === 1)).toHaveLength(1);
  expect(walk.nodes.some((n) => n.pos.x === 0 && n.pos.y === 10)).toBe(false);
});

test('T50 parking shapes, roadside strips and car connectors have walk access', () => {
  const { city, node, road, place } = buildCity('Park to door', 1);
  const r = road(node(0, 0), node(120, 0));
  place('House', 'residential', { x: 60, y: 15 }, [{ road: r, direction: 'both', positionM: 60 }]);
  city.parking = {
    'pk:900': {
      id: 'pk:900',
      kind: 'lot',
      name: null,
      capacity: 10,
      access: 'public',
      placeId: null,
      shape: { kind: 'point', pos: { x: 50, y: 12 } },
      connectors: [],
      provenance: { source: 'authored' },
    },
    'pk:901': {
      id: 'pk:901',
      kind: 'roadside',
      name: null,
      capacity: 5,
      access: 'public',
      placeId: null,
      shape: null,
      strip: { roadId: r.id, side: 'right', fromM: 20, toM: 50, layout: 'parallel' },
      connectors: [],
      provenance: { source: 'authored' },
    },
  };
  const g = graph(city);
  expect(g.parking.get('pk:900')?.length).toBeGreaterThan(0);
  expect(g.parking.get('pk:901')?.length).toBeGreaterThan(0);
  expect(g.connectors.has(Object.values(city.places)[0]!.connectors[0]!.id)).toBe(true);
});

test('T50 divided streets with a wide median still have only outer-curb sidewalks', () => {
  const { city, node, road } = buildCity('Wide median', 1);
  const a = road(node(0, 0), node(120, 0)),
    b = road(node(120, 60), node(0, 60));
  a.corridorId = b.corridorId = 'boulevard';
  const sidewalks = graph(city).links.filter((l) => l.kind === 'sidewalk');
  expect(sidewalks.map((l) => l.line[0]!.y).sort((a, b) => a - b)).toEqual([-2.5, 62.5]);
});

test('T50 car-only motorway worlds still compile when no walk links exist', () => {
  const { city, node, road, place } = buildCity('Car-only world', 1);
  const r = road(node(0, 0), node(120, 0), { roadClass: 'motorway' });
  place('Gateway', 'gateway', { x: 60, y: 5 }, [{ road: r, direction: 'both', positionM: 60 }]);
  expect(graph(city).links).toEqual([]);
});
