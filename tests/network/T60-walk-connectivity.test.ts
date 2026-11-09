import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { station } from '../../src/fixtures/station';
import { compile, type WalkGraph } from '../../src/network';
import { compileWalk } from '../../src/network/walk';
import { walkRoots } from '../../src/network/walk-joins';
import { createWalkRouter } from '../../src/routing/walk';
import { allocateId, type City } from '../../src/schema';
import type { Vec2 } from '../../src/geo/vec2';

function graph(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled.walk;
}

function mapped(city: City, line: Vec2[], layer = 0) {
  city.walk ??= { nodes: {}, links: {} };
  const ids = line.map((pos) => {
    const id = allocateId(city, 'wn');
    city.walk!.nodes[id] = { id, pos, layer, provenance: { source: 'osm' } };
    return id;
  });
  const id = allocateId(city, 'wl');
  city.walk.links[id] = {
    id,
    from: ids[0]!,
    to: ids[1]!,
    line,
    layer,
    kind: 'footway',
    widthM: 2,
    provenance: { source: 'osm' },
  };
  return ids;
}

function connected(g: WalkGraph, a: number, b: number) {
  return createWalkRouter(g).route({ from: { node: a }, to: { node: b } }).ok;
}

test.each([
  { order: [0, 1, 2], same: false },
  { order: [2, 0, 1], same: true },
])('T60 component bookkeeping uses the first snapped representative ($same)', ({ order, same }) => {
  const { city } = buildCity('Nearby representatives', 1);
  city.walk = { nodes: {}, links: {} };
  const positions = [
    { x: 0, y: 0 },
    { x: 0.08, y: 0 },
    { x: 0.04, y: 0 },
  ];
  for (const [i, j] of order.entries()) {
    const id = `wn:${100 + i}`;
    city.walk.nodes[id] = { id, pos: positions[j]!, layer: 0, provenance: { source: 'osm' } };
  }
  const roots = walkRoots(
    city,
    positions.map((p, i) => ({
      id: `raw:${i}`,
      line: [p, { x: i * 20, y: 20 }],
      layer: 0,
      cuts: [0, Math.hypot(i * 20 - p.x, 20)],
    })),
  );
  expect(roots.root('raw:0') === roots.root('raw:1')).toBe(same);
});

function junction() {
  const b = buildCity('Missing separate sidewalks', 1);
  const j = b.node(0, 0);
  const roads = [...b.street(b.node(-100, 0), j), ...b.street(j, b.node(100, 0))];
  for (const r of roads) {
    r.roadClass = 'secondary';
    r.sidewalk = { left: 'separate', right: 'separate' };
  }
  b.street(b.node(0, -100), j);
  b.place('North', 'work', { x: 30, y: -20 }, []);
  b.place('South', 'work', { x: 30, y: 20 }, []);
  return { ...b, roads };
}

test('T60 missing separate sidewalks join a residential arm to a place across the road', () => {
  const { city } = junction();
  const g = graph(city);
  const [a, b] = Object.keys(city.places);
  const route = createWalkRouter(g).route({ from: { placeId: a! }, to: { placeId: b! } });
  expect(route.ok).toBe(true);
  if (route.ok) expect(route.route.links.some((i) => g.links[i]!.kind === 'crossing')).toBe(true);
});

test('T60 a mapped sidewalk is used without a generated duplicate on that side', () => {
  const { city, node, street } = buildCity('Mapped separate sidewalk', 1);
  const roads = street(node(0, 0), node(120, 0));
  for (const r of roads) r.sidewalk = { left: 'separate', right: 'separate' };
  const ids = mapped(city, [
    { x: 0, y: 5 },
    { x: 120, y: 5 },
  ]);
  const g = graph(city);
  expect(g.links.some((l) => l.kind === 'sidewalk' && l.line[0]!.y > 0)).toBe(false);
  expect(g.links.some((l) => l.kind === 'sidewalk' && l.line[0]!.y < 0)).toBe(true);
  expect(connected(g, g.sourceNodes.get(ids[0]!)!, g.sourceNodes.get(ids[1]!)!)).toBe(true);
});

test('T60 a short mapped sidewalk suppresses only the covered part of a separate side', () => {
  const { city, node, street } = buildCity('Partial mapped sidewalk', 1);
  for (const r of street(node(0, 0), node(120, 0)))
    r.sidewalk = { left: 'separate', right: 'separate' };
  const ids = mapped(city, [
    { x: 50, y: 5 },
    { x: 70, y: 5 },
  ]);
  const g = graph(city);
  const south = g.links.filter((l) => l.kind === 'sidewalk' && l.line[0]!.y > 0);
  expect(south.some((l) => l.line.some((p) => p.x < 40))).toBe(true);
  expect(south.some((l) => l.line.some((p) => p.x > 80))).toBe(true);
  expect(south.some((l) => l.line.some((p) => p.x > 54 && p.x < 66))).toBe(false);
  expect(connected(g, g.sourceNodes.get(ids[0]!)!, south[0]!.from)).toBe(true);
});

test('T60 equidistant car connectors use the curb beside their owning place', () => {
  const city = station();
  const parking = Object.values(city.places).find((p) => p.kind === 'parking')!;
  const g = graph(city);
  const route = createWalkRouter(g).route({
    from: { placeId: parking.id },
    to: { node: g.connectors.get(parking.connectors[1]!.id)! },
  });
  expect(route.ok).toBe(true);
  if (route.ok) expect(route.route.lengthM).toBeLessThan(40);
});

test('T60 a mapped sub-centimetre segment omitted from geometry cannot crash a curb join', () => {
  const { city, node, street } = buildCity('Tiny mapped link', 1);
  for (const r of street(node(0, 0), node(120, 0)))
    r.sidewalk = { left: 'separate', right: 'separate' };
  mapped(city, [
    { x: 2.5, y: 0 },
    { x: 2.505, y: 0 },
  ]);
  expect(() => graph(city)).not.toThrow();
});

test('T60 residential sidewalks and a crossing use the mapped separate sidewalks at a junction', () => {
  const { city } = junction();
  mapped(city, [
    { x: -100, y: -5 },
    { x: 100, y: -5 },
  ]);
  mapped(city, [
    { x: -100, y: 5 },
    { x: 100, y: 5 },
  ]);
  const g = graph(city),
    [a, b] = Object.keys(city.places);
  const result = createWalkRouter(g).route({ from: { placeId: a! }, to: { placeId: b! } });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.route.links.some((i) => !g.links[i]!.generated)).toBe(true);
    expect(result.route.links.some((i) => g.links[i]!.kind === 'crossing')).toBe(true);
  }
});

test.each([0, 1])(
  'T60 a generated endpoint joins a nearby mapped through path only on its layer (%i)',
  (layer) => {
    const { city, node, road } = buildCity('Endpoint to path', 1);
    road(node(0, 0), node(100, 0));
    const ids = mapped(
      city,
      [
        { x: 101, y: -20 },
        { x: 101, y: 20 },
      ],
      layer,
    );
    const g = graph(city);
    const sidewalk = g.links.find((l) => l.kind === 'sidewalk')!;
    expect(connected(g, sidewalk.from, g.sourceNodes.get(ids[0]!)!)).toBe(layer === 0);
  },
);

test('T60 sidewalks continue around a dead-end cap without crossing the carriageway', () => {
  const { city, node, street } = buildCity('Walk around the cap', 1);
  street(node(0, 0), node(100, 0));
  const g = graph(city);
  const a = g.links.find((l) => l.kind === 'sidewalk' && l.line[0]!.y < 0)!;
  const b = g.links.find((l) => l.kind === 'sidewalk' && l.line[0]!.y > 0)!;
  expect(connected(g, a.from, b.from)).toBe(true);
  expect(g.links.some((l) => l.kind === 'crossing')).toBe(false);
});

test('T60 a driveway does not sever a continuous street sidewalk', () => {
  const { city, node, street, road } = buildCity('Driveway seam', 1);
  const j = node(0, 0);
  const [a] = street(node(-100, 0), j);
  const [b] = street(j, node(100, 0));
  road(j, node(0, 40), { roadClass: 'service' });
  const g = graph(city);
  const left = g.links.find((l) => l.id.startsWith(`sidewalk:${a.id}:right/`))!;
  const right = g.links.find((l) => l.id.startsWith(`sidewalk:${b.id}:right/`))!;
  expect(connected(g, left.from, right.to)).toBe(true);
});

test.each([1, -1])(
  'T60 mapped grade %i sidewalks join their explicitly shared ground approaches',
  (layer) => {
    const { city, node, street, place } = buildCity('Mapped bridge approach', 1);
    const a = node(0, 0),
      b = node(200, 0);
    street(node(-200, 0), a);
    for (const r of street(a, b)) {
      r.layer = layer;
      r.provenance = { source: 'osm', osmIds: [100] };
    }
    street(b, node(400, 0));
    place('West', 'work', { x: -100, y: 20 }, []);
    place('East', 'work', { x: 300, y: 20 }, []);
    const g = graph(city),
      [from, to] = Object.keys(city.places);
    const result = createWalkRouter(g).route({ from: { placeId: from! }, to: { placeId: to! } });
    expect(result.ok).toBe(true);
    expect(
      g.links.some((l) => l.generated && l.layer === layer && g.nodes[l.from]!.layer === 0),
    ).toBe(true);
  },
);

test('T60 coincident bridge and ground endpoints with different road node IDs stay separate', () => {
  const { city, node, street } = buildCity('Unshared bridge endpoint', 1);
  const pair = street(node(0, 0), node(200, 0));
  for (const r of pair) {
    r.layer = 1;
    r.provenance = { source: 'osm', osmIds: [100] };
  }
  street(node(200, 0), node(400, 0));
  const g = graph(city);
  const bridge = g.links.find((l) => l.kind === 'sidewalk' && l.layer === 1)!;
  const ground = g.links.find((l) => l.kind === 'sidewalk' && l.layer === 0)!;
  expect(connected(g, bridge.from, ground.from)).toBe(false);
});

test.each(['motorway', 'trunk', 'ramp'] as const)(
  'T60 never generates a crossing on %s',
  (roadClass) => {
    const { city, roads } = junction();
    for (const r of roads) {
      r.roadClass = roadClass;
      r.sidewalk = { left: 'yes', right: 'yes' };
    }
    const result = compile(city);
    if (!result.ok) throw new Error('compile');
    expect(
      result.compiled.walk.links
        .filter((l) => l.crossing)
        .every((l) => !roads.some((r) => r.id === result.compiled.roads[l.crossing!.road]!.id)),
    ).toBe(true);
  },
);

test.each(['yes', 'no'] as const)(
  'T60 a live sidewalk edit to %s matches a fresh compile',
  (tag) => {
    const { city, roads } = junction();
    const initial = compile(city);
    if (!initial.ok) throw new Error('compile');
    const road = roads[0]!;
    city.roads[road.id]!.sidewalk = { left: tag, right: tag };
    expect(compileWalk(city, initial.compiled)).toEqual(graph(city));
  },
);
