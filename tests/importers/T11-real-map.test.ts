import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import type { Road } from '../../src/schema';
import { fixture } from './fixtures';

function load(name: Parameters<typeof fixture>[0]) {
  const { xml, options } = fixture(name);
  const start = performance.now();
  const result = importOsm(xml, options);
  const elapsed = performance.now() - start;
  if (!result.ok)
    throw new Error(
      JSON.stringify(result.diagnostics.filter(({ severity }) => severity === 'error')),
    );
  const { city } = result;
  const compilation = compile(city);
  if (!compilation.ok) throw new Error(JSON.stringify(compilation.diagnostics));
  const { compiled } = compilation;
  const roads = Object.values(city.roads);
  const way = (id: number) => roads.filter(({ provenance }) => provenance.osmIds?.includes(id));
  const movements = compiled.movements.map((movement) => ({
    ...movement,
    from: city.roads[compiled.roads[compiled.lanes[movement.fromLane]!.road]!.id]!,
    to: city.roads[compiled.roads[compiled.lanes[movement.toLane]!.road]!.id]!,
  }));
  return { city, roads, way, movements, elapsed, size: new TextEncoder().encode(xml).length };
}

test('T11 real extracts compile with OSM attribution and class-appropriate roads', () => {
  const maps = (['downtown', 'highway', 'suburb'] as const).map((name) => ({
    name,
    ...load(name),
  }));
  for (const { city, roads, size } of maps) {
    expect(size).toBeLessThan(2_000_000);
    expect(city.geo?.source.attribution).toContain('OpenStreetMap contributors');
    expect(roads.length).toBeGreaterThan(0);
  }
  const highway = maps.find(({ name }) => name === 'highway')!;
  expect(Object.values(highway.city.places)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'parking',
        shape: expect.objectContaining({ kind: 'polygon' }),
        connectors: [expect.objectContaining({ direction: 'both' })],
        population: 0,
        jobs: 0,
      }),
    ]),
  );
  const suburb = maps.find(({ name }) => name === 'suburb')!;
  expect(
    suburb.roads.some(
      ({ roadClass, streetGroupId }) => roadClass === 'residential' && streetGroupId,
    ),
  ).toBe(true);
  const largest = maps.reduce((a, b) => (a.size > b.size ? a : b));
  console.info(
    `Largest fixture ${largest.name}.osm (${largest.size} bytes): ${largest.elapsed.toFixed(1)} ms import`,
  );
});

test('T11 keeps the divided highway, bridge, and ramp movements separate', () => {
  const { way, movements, roads, city } = load('highway');
  const carriageways = [way(30953183), way(121243831)];
  for (const pair of carriageways) {
    expect(pair).toHaveLength(1);
    expect(pair[0]!.streetGroupId).toBeNull();
  }
  const bridge = way(1200613540);
  expect(bridge).toHaveLength(2);
  const motorway = (road: Road) => road.roadClass === 'motorway';
  const motorwayNodes = new Set(roads.filter(motorway).flatMap(({ from, to }) => [from, to]));
  for (const { from, to, layer } of bridge) {
    expect(motorwayNodes.has(from)).toBe(false);
    expect(motorwayNodes.has(to)).toBe(false);
    expect(layer).toBe(1);
  }
  const bridgeEnds = [bridge[0]!.from, bridge[0]!.to].map((id) => city.nodes[id]!);
  const groundEnd = bridgeEnds.find((node) => node.provenance.osmIds?.includes(110413062));
  expect(groundEnd?.layer).toBe(0);
  // The bbox clips the other end mid-deck.
  expect(bridgeEnds.find((node) => node !== groundEnd)?.layer).toBe(1);
  expect(
    movements.some(
      ({ from, to }) =>
        (bridge.includes(from) && motorway(to)) || (motorway(from) && bridge.includes(to)),
    ),
  ).toBe(false);
  expect(
    movements.some(
      ({ from, to, turn }) => from.roadClass === 'ramp' && motorway(to) && turn === 'merge',
    ),
  ).toBe(true);
  expect(
    movements.some(
      ({ from, to, turn }) => motorway(from) && to.roadClass === 'ramp' && turn === 'diverge',
    ),
  ).toBe(true);
  expect(
    Object.values(city.nodes)
      .flatMap(({ turnRules }) => turnRules)
      .some(({ from, fromLane }) => way(30953183).some(({ id }) => id === from) && fromLane === 3),
  ).toBe(true);
});

test('T11 follows a downtown one-way way in its OSM direction', () => {
  const { city, way, movements } = load('downtown');
  const roads = way(12136389);
  expect(roads).toHaveLength(1);
  const road = roads[0]!;
  expect(road.streetGroupId).toBeNull();
  expect(city.nodes[road.from]!.provenance.osmIds).toEqual([9044739432]);
  expect(city.nodes[road.to]!.provenance.osmIds).toEqual([534960909]);
  const incident = movements.filter(({ from, to }) => from === road || to === road);
  expect(incident.some(({ from }) => from === road)).toBe(true);
  expect(incident.some(({ to }) => to === road)).toBe(true);
  for (const { from, to } of incident) expect(from.to).toBe(to.from);
});

test('T11 removes a real prohibited turn from the compiled network', () => {
  const { city, movements } = load('downtown');
  const rules = Object.values(city.nodes)
    .flatMap(({ turnRules }) => turnRules)
    .filter(({ provenance }) => provenance.osmIds?.includes(7553350));
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) {
    expect(rule.allowed).toBe(false);
    expect(rule.fromLane).toBeUndefined();
    expect(movements.some(({ from, to }) => from.id === rule.from && to.id === rule.to)).toBe(
      false,
    );
  }
});

test('T11 keeps a marked through lane aligned with the unmarked lane beside it', () => {
  const result = importOsm(
    `<osm>
    <node id="1" lat="0" lon="-0.001"/>
    <node id="2" lat="0" lon="0"><tag k="highway" v="traffic_signals"/></node>
    <node id="3" lat="0" lon="0.001"/>
    <way id="4"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/>
      <tag k="oneway" v="yes"/><tag k="lanes" v="2"/><tag k="turn:lanes" v="none|through"/>
    </way>
    <way id="5"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/>
      <tag k="oneway" v="yes"/><tag k="lanes" v="2"/>
    </way>
  </osm>`,
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compilation = compile(result.city);
  if (!compilation.ok) throw new Error(JSON.stringify(compilation.diagnostics));
  const { movements, lanes } = compilation.compiled;
  expect(movements).toHaveLength(2);
  for (const { fromLane, toLane, neverGreen } of movements) {
    expect(lanes[toLane]!.lane).toBe(lanes[fromLane]!.lane);
    expect(neverGreen).toBe(false);
  }
});
