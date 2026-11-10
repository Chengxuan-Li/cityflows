import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { citySchema, legacyCitySchema } from '../../src/schema';
import { compileRail } from '../../src/network/rail';
import type { RailNetwork } from '../../src/schema/rail';

function fixture() {
  const { city, node, road } = buildCity('Rail', 1);
  road(node(50, -50), node(50, 50));
  return city;
}

function railway(): RailNetwork {
  const nodes = Object.fromEntries(
    [
      ['rn:1', -100, 0],
      ['rn:2', 0, 0],
      ['rn:3', 100, 0],
      ['rn:4', 100, 20],
      ['rn:5', 0, 100],
    ].map(([id, x, y]) => [
      id,
      {
        id: String(id),
        pos: { x: Number(x), y: Number(y) },
        kind: id === 'rn:2' ? ('switch' as const) : ('plain' as const),
        layer: 0,
      },
    ]),
  );
  const tracks = Object.fromEntries(
    [
      ['rt:1', 'rn:1', 'rn:2'],
      ['rt:2', 'rn:2', 'rn:3'],
      ['rt:3', 'rn:2', 'rn:4'],
      ['rt:4', 'rn:2', 'rn:5'],
    ].map(([id, from, to]) => [
      id!,
      {
        id: id!,
        from: from!,
        to: to!,
        line: [nodes[from!]!.pos, nodes[to!]!.pos],
        kind: 'rail' as const,
        layer: 0,
      },
    ]),
  );
  return { nodes, tracks, platforms: {} };
}

test('T62 an empty saved rail network compiles beside roads', () => {
  const { city, node, road } = buildCity('Empty rail', 1);
  road(node(-10, 0), node(10, 0));
  city.rail = { nodes: {}, tracks: {}, platforms: {} };
  expect(compileRail(city)).toMatchObject({
    nodes: [],
    tracks: [],
    connections: [],
    crossings: [],
    components: [],
  });
});

test('T62 switch admits both shallow branches from the stem, excluding branch reversals and sharp corners', () => {
  const city = fixture();
  city.rail = railway();
  const graph = compileRail(city)!;
  const through = graph.connections.map((c) => [graph.tracks[c.from]!.id, graph.tracks[c.to]!.id]);
  expect(through).toContainEqual(['rt:1', 'rt:2']);
  expect(through).toContainEqual(['rt:1', 'rt:3']);
  expect(through).not.toContainEqual(['rt:2', 'rt:3']);
  expect(through).not.toContainEqual(['rt:1', 'rt:4']);
});

test('T62 grade crossings never invent connectivity; a shared bridge endpoint connects', () => {
  const city = fixture();
  city.rail = railway();
  city.rail.tracks['rt:2']!.layer = 1;
  const graph = compileRail(city)!;
  expect(
    graph.connections.some(
      (c) => graph.tracks[c.from]!.id === 'rt:1' && graph.tracks[c.to]!.id === 'rt:2',
    ),
  ).toBe(true);
  city.rail.nodes['rn:6'] = { id: 'rn:6', pos: { x: 50, y: -50 }, kind: 'plain', layer: 1 };
  city.rail.nodes['rn:7'] = { id: 'rn:7', pos: { x: 50, y: 50 }, kind: 'plain', layer: 1 };
  city.rail.tracks['rt:5'] = {
    id: 'rt:5',
    from: 'rn:6',
    to: 'rn:7',
    line: [
      { x: 50, y: -50 },
      { x: 50, y: 50 },
    ],
    kind: 'rail',
    layer: 1,
  };
  expect(compileRail(city)!.components).toHaveLength(2);
});

test('T62 crossing records both stations, survives save/open, and follows road deletion without changing tracks', () => {
  const city = fixture();
  city.rail = railway();
  const graph = compileRail(city)!;
  expect(graph.crossings.some((c) => c.track === 1 && Math.abs(c.trackM - 50) < 0.001)).toBe(true);
  expect(citySchema.parse(JSON.parse(JSON.stringify(city))).rail).toEqual(city.rail);
  expect(legacyCitySchema.parse({ ...city, schemaVersion: 2 }).rail).toEqual(city.rail);
  const invalid = structuredClone(city);
  invalid.rail!.tracks['rt:1']!.from = 'rn:999';
  expect(citySchema.safeParse(invalid).success).toBe(false);
  const compiled = compile(city);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  expect(compiled.compiled.rail).toEqual(graph);
  expect(compileRail(city)).toEqual(graph);
  city.roads = {};
  const after = compileRail(city)!;
  expect(after.tracks).toEqual(graph.tracks);
  expect(after.connections).toEqual(graph.connections);
  expect(after.crossings).toEqual([]);
});
