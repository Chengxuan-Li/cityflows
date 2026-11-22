import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
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
    A: 1,
    B: 6,
    C: 70,
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
