import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { station } from '../../src/fixtures/station';
import { compile, type WalkGraph } from '../../src/network';
import { compileWalk } from '../../src/network/walk';
import { walkRoots } from '../../src/network/walk-joins';
import { createWalkRouter } from '../../src/routing/walk';
import { allocateId, type City } from '../../src/schema';
import type { Vec2 } from '../../src/geo/vec2';
import { walkDetour, matchWalkRoute } from '../../bench/import-probe';

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
    to: ids.at(-1)!,
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

test.each([false, true])('T60 detours use the oriented partial leg endpoints (%s)', (reverse) => {
  const { city } = buildCity('Detour endpoints', 1);
  mapped(city, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);
  const g = graph(city);
  const link = g.links[0]!.idx;
  const route = createWalkRouter(g).route({
    from: { link, positionM: reverse ? 150 : 50 },
    to: { link, positionM: reverse ? 50 : 150 },
  });
  if (!route.ok) throw new Error('route');
  const report = walkDetour(g, route.route);
  expect(report.from).toEqual(reverse ? { x: 100, y: 50 } : { x: 50, y: 0 });
  expect(report.to).toEqual(reverse ? { x: 50, y: 0 } : { x: 100, y: 50 });
  expect(report.straightM).toBeCloseTo(Math.hypot(50, 50));
  expect(report.detour).toBeCloseTo(Math.SQRT2);
});

test('T60 equal-length walks from different entrances keep their actual detour measurement', () => {
  const { city } = buildCity('Two measured entrances', 1);
  const ends = mapped(city, [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 170 },
  ]);
  const g = graph(city),
    link = g.links[0]!.idx;
  g.places.set('door', [g.sourceNodes.get(ends[0]!)!, g.sourceNodes.get(ends.at(-1)!)!]);
  const router = createWalkRouter(g);
  const routes = [75, 125].map((positionM) => {
    const result = router.route({ from: { placeId: 'door' }, to: { link, positionM } });
    if (!result.ok) throw new Error('route');
    return result.route;
  });
  expect(routes.map((r) => r.lengthM)).toEqual([75, 75]);
  expect(routes[0]!.links).toEqual(routes[1]!.links);
  for (const [i, positionM] of [75, 125].entries()) {
    const measured = matchWalkRoute(routes, { state: 'done', link, positionM });
    expect(measured).toBe(routes[i]);
    expect(walkDetour(g, measured).detour).toBeCloseTo(i === 0 ? 75 / Math.hypot(30, 45) : 1);
  }
});

test('T60 a successful zero-length walk is measured without inventing an endpoint', () => {
  const { city } = buildCity('Zero walk', 1);
  mapped(city, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  const g = graph(city),
    link = g.links[0]!.idx;
  const result = createWalkRouter(g).route({
    from: { link, positionM: 50 },
    to: { link, positionM: 50 },
  });
  if (!result.ok) throw new Error('route');
  const route = matchWalkRoute([result.route], { state: 'done', link: -1, positionM: 0 });
  expect(walkDetour(g, route)).toEqual({ from: null, to: null, straightM: 0, detour: 1 });
});

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
  const { city, node, street, place } = buildCity('Mapped separate sidewalk', 1);
  const roads = street(node(0, 0), node(120, 0));
  for (const r of roads) r.sidewalk = { left: 'separate', right: 'separate' };
  const ids = mapped(city, [
    { x: 0, y: 5 },
    { x: 120, y: 5 },
  ]);
  place('Unserved north door', 'work', { x: 60, y: -10 }, []);
  const g = graph(city);
  expect(g.links.some((l) => l.kind === 'sidewalk' && l.line[0]!.y > 0)).toBe(false);
  expect(g.links.some((l) => l.kind === 'sidewalk' && l.line[0]!.y < 0)).toBe(true);
  expect(connected(g, g.sourceNodes.get(ids[0]!)!, g.sourceNodes.get(ids[1]!)!)).toBe(true);
});

test.each([8, 12, 16])(
  'T60 a mapped sidewalk %i m from the road centre covers its own curb',
  (y) => {
    const { city, node, street, place } = buildCity('Set-back mapped sidewalk', 1);
    for (const r of street(node(0, 0), node(120, 0)))
      r.sidewalk = { left: 'separate', right: 'separate' };
    mapped(city, [
      { x: 0, y },
      { x: 120, y },
    ]);
    place('Unserved north door', 'work', { x: 60, y: -10 }, []);
    const g = graph(city);
    const south = g.links.filter((l) => l.kind === 'sidewalk' && l.line[0]!.y > 0);
    expect(south).toHaveLength(0);
    expect(g.links.some((l) => l.kind === 'sidewalk' && l.line[0]!.y < 0)).toBe(true);
  },
);

test.each([5, 12])('T60 a short mapped sidewalk at y=%i suppresses only its covered curb', (y) => {
  const { city, node, street, place } = buildCity('Partial mapped sidewalk', 1);
  for (const r of street(node(0, 0), node(600, 0)))
    r.sidewalk = { left: 'separate', right: 'separate' };
  const ids = mapped(city, [
    { x: 250, y },
    { x: 350, y },
  ]);
  place('West door', 'work', { x: 20, y: 5 }, []);
  place('East door', 'work', { x: 580, y: 5 }, []);
  const g = graph(city);
  const south = g.links.filter((l) => l.kind === 'sidewalk' && l.line[0]!.y > 0);
  expect(south.some((l) => l.line.some((p) => p.x < 40))).toBe(true);
  expect(south.some((l) => l.line.some((p) => p.x > 560))).toBe(true);
  expect(south.some((l) => l.line.some((p) => p.x > 270 && p.x < 330))).toBe(false);
  expect(connected(g, g.sourceNodes.get(ids[0]!)!, south[0]!.from)).toBe(true);
});

test('T60 a mapped sidewalk vertex is not a gap beside the curb', () => {
  const { city, node, street } = buildCity('Mapped sidewalk bend', 1);
  for (const r of street(node(0, 0), node(120, 0)))
    r.sidewalk = { left: 'separate', right: 'separate' };
  const west = mapped(city, [
    { x: 0, y: 12 },
    { x: 60, y: 11.5 },
  ]);
  const east = mapped(city, [
    { x: 60, y: 11.5 },
    { x: 120, y: 12 },
  ]);
  const link = Object.values(city.walk!.links).find((l) => l.from === east[0])!;
  link.from = west[1]!;
  delete city.walk!.nodes[east[0]!];
  expect(graph(city).links.some((l) => l.kind === 'sidewalk' && l.line[0]!.y > 0)).toBe(false);
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

test('T60 a remote mapped entrance does not flip an equidistant connector curb', () => {
  const { city, node, road, place } = buildCity('Remote entrance', 1);
  const r = road(node(0, 0), node(200, 0));
  mapped(city, [
    { x: 0, y: 2.5 },
    { x: -20, y: 2.5 },
    { x: -20, y: 40 },
    { x: 200, y: 40 },
  ]);
  place('Owner', 'work', { x: 100, y: 45 }, [{ road: r, direction: 'both', positionM: 100 }]);
  const p = Object.values(city.places)[0]!;
  const g = graph(city);
  const access = g.links.find((l) => l.id.startsWith(`access:connectors:${p.connectors[0]!.id}:`))!;
  expect(access.line.at(-1)!.y).toBeLessThan(0);
});

test('T60 a local mapped sidewalk still identifies the owning curb', () => {
  const { city, node, road, place } = buildCity('Local mapped entrance', 1);
  const r = road(node(0, 0), node(200, 0));
  mapped(city, [
    { x: 0, y: 4 },
    { x: 200, y: 4 },
  ]);
  place('Owner', 'work', { x: 100, y: 10 }, [{ road: r, direction: 'both', positionM: 100 }]);
  const p = Object.values(city.places)[0]!;
  const g = graph(city);
  const access = g.links.find((l) => l.id.startsWith(`access:connectors:${p.connectors[0]!.id}:`))!;
  expect(access.line.at(-1)!.y).toBeGreaterThan(0);
});

test('T60 existing main-network access is retained ahead of an inferred separate curb', () => {
  const { city, node, street, place } = buildCity('Retain mapped access', 1);
  const j = node(120, 0);
  const separate = street(node(0, 0), j);
  for (const r of separate) r.sidewalk = { left: 'separate', right: 'separate' };
  street(j, node(240, 0));
  mapped(city, [
    { x: 0, y: 20 },
    { x: 240, y: 20 },
  ]);
  mapped(city, [
    { x: 220, y: 20 },
    { x: 220, y: 4 },
  ]);
  place('Door', 'work', { x: 60, y: 10 }, []);
  const p = Object.values(city.places)[0]!;
  const g = graph(city);
  const access = g.links.find((l) => l.id.startsWith(`access:places:${p.id}:`))!;
  expect(access.line.at(-1)!.y).toBe(20);
  expect(
    g.links.some(
      (l) => l.kind === 'sidewalk' && separate.some((r) => l.id.startsWith(`sidewalk:${r.id}:`)),
    ),
  ).toBe(false);
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

test('T60 an already connected mapped sidewalk loop does not gain redundant crossings', () => {
  const { city, roads } = junction();
  for (const line of [
    [
      { x: -120, y: -5 },
      { x: 120, y: -5 },
    ],
    [
      { x: 120, y: -5 },
      { x: 120, y: 5 },
    ],
    [
      { x: 120, y: 5 },
      { x: -120, y: 5 },
    ],
    [
      { x: -120, y: 5 },
      { x: -120, y: -5 },
    ],
  ])
    mapped(city, line);
  const compiled = compile(city);
  if (!compiled.ok) throw new Error('compile');
  expect(
    compiled.compiled.walk.links.filter(
      (l) =>
        l.generated &&
        l.crossing &&
        roads.some((r) => r.id === compiled.compiled.roads[l.crossing!.road]!.id),
    ),
  ).toHaveLength(0);
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
