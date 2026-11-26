import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { arcEdge, arcEnd, reverseArc, routeAirside } from '../../src/routing/airside';
import { aircraftCodes } from '../../src/schema/aircraft';
import { expectAirsideTopology } from '../airside-topology';

// TASK-295: London City's airside as bundled (fixtures/projects/london-city-airport.cityflows.json,
// a fresh build of its extract by the staleness test in bundled-cities.city.test.ts).

const count = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>(
    (m, item) => ({ ...m, [key(item)]: (m[key(item)] ?? 0) + 1 }),
    {},
  );

test('London City: one runway, its holds, stands, gates and terminal, all on one graph', async () => {
  const { city } = await openBundled('london-city-airport');
  const airport = city.airport!;
  expect([airport.name, airport.iata, airport.icao]).toEqual([
    'London City Airport',
    'LCY',
    'EGLC',
  ]);
  const runways = Object.values(airport.runways);
  expect(runways.map((r) => [r.ref, r.ends.map((e) => e.designator), r.widthM, r.maxCode])).toEqual(
    [['09/27', ['09', '27'], 30, 'C']],
  );
  // The runway, with both mapped displaced thresholds, runs its whole length end to end.
  expect(runways[0]!.lengthM).toBeGreaterThan(1450);
  expect(runways[0]!.ends.every((e) => e.displacedM > 0)).toBe(true);
  const edges = Object.values(airport.edges);
  expect(count(edges, (e) => e.kind)).toEqual({ taxiway: 97, runway: 18, lead_in: 19 });
  expect(
    count(
      edges.filter((e) => e.kind === 'taxiway'),
      (e) => String(e.maxCode),
    ),
  ).toEqual({
    B: 3,
    C: 74,
    D: 20,
  });
  expect(edges.filter((e) => e.provenance.source === 'generated')).toHaveLength(0);
  const holds = Object.values(airport.holdingPositions);
  expect(count(holds, (h) => `${h.kind} ${h.side} ${h.provenance.source}`)).toEqual({
    'runway right osm': 12,
    'intermediate null osm': 4,
  });
  const stands = Object.values(airport.stands);
  expect(count(stands, (s) => `${s.kind} ${s.maxCode}`)).toEqual({
    'contact C': 8,
    'contact B': 4,
    'remote C': 7,
  });
  expect(stands.filter((s) => s.gate)).toHaveLength(12);
  expect(Object.keys(airport.gates)).toHaveLength(15);
  expect(Object.values(airport.terminals).map((t) => t.group)).toEqual([0]);
  expect(airport.hangars).toHaveLength(1);
  expect(airport.roadCrossings.map((c) => airport.edges[c.edge]!.kind)).toEqual([
    'taxiway',
    'runway',
  ]);
  expectAirsideTopology(airport);
});

test('London City: code C can taxi through the intermediate hold between C and D both ways', async () => {
  const { city } = await openBundled('london-city-airport');
  const result = compile(city);
  if (!result.ok || !result.compiled.airside) throw new Error('London City must compile');
  const graph = result.compiled.airside;
  const indexOfOsmNode = (osmId: number) =>
    graph.nodes.findIndex(({ id }) => city.airport!.nodes[id]!.osmId === osmId);
  const west = indexOfOsmNode(3307802191);
  const east = indexOfOsmNode(7818001804);
  const hold = indexOfOsmNode(6695579053);
  const route = (from: number, to: number) =>
    routeAirside(graph, {
      from: { node: from },
      goal: (arc) => arcEnd(graph, arc) === to,
      code: aircraftCodes.indexOf('C'),
      turnRadiusM: 15,
    })?.arcs;

  const eastbound = route(west, east);
  expect(eastbound?.map((arc) => graph.edges[arcEdge(arc)]!.ref)).toEqual(
    Array<string>(6).fill('Apron Twy'),
  );
  expect(eastbound?.map((arc) => arcEnd(graph, arc))).toContain(hold);
  expect(route(east, west)).toEqual(eastbound!.toReversed().map(reverseArc));
});
