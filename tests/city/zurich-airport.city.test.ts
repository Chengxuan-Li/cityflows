import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { airsideReachable } from '../airside-topology';

// TASK-302: Zurich Airport as bundled (fixtures/projects/zurich-airport.cityflows.json, a fresh
// build of TASK-309's extract by the staleness test in bundled-cities.city.test.ts).

const count = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>(
    (m, item) => ({ ...m, [key(item)]: (m[key(item)] ?? 0) + 1 }),
    {},
  );

test('Zurich: three runways crossing once, the helicopter runway, Dock E, stands to code F', async () => {
  const { city } = await openBundled('zurich-airport');
  const airport = city.airport!;
  expect([airport.iata, airport.icao]).toEqual(['ZRH', 'LSZH']);
  const runways = Object.values(airport.runways);
  expect(runways.map((r) => [r.ref, r.maxCode])).toEqual([
    ['14/32', 'F'],
    ['10/28', 'F'],
    ['16/34', 'F'],
    ['H01/H19', null],
  ]);
  const nodesOf = (ref: string) => {
    const runway = runways.find((r) => r.ref === ref)!;
    return new Set(runway.edges.flatMap((id) => [airport.edges[id]!.from, airport.edges[id]!.to]));
  };
  const crossing = runways.flatMap((a, i) =>
    runways
      .slice(i + 1)
      .filter((b) => [...nodesOf(a.ref)].some((node) => nodesOf(b.ref).has(node)))
      .map((b) => `${a.ref} × ${b.ref}`),
  );
  expect(crossing).toEqual(['10/28 × 16/34']);

  const edges = Object.values(airport.edges);
  expect(count(edges, (e) => e.kind)).toEqual({ runway: 69, taxiway: 1180, lead_in: 301 });
  const stands = Object.values(airport.stands);
  expect(count(stands, (s) => String(s.maxCode))).toEqual({
    A: 55,
    B: 109,
    C: 70,
    D: 8,
    E: 2,
    F: 4,
    null: 6,
  });
  expect(count(stands, (s) => s.kind)).toEqual({ remote: 178, maintenance: 42, contact: 34 });
  // Dock E stands apart from the docks A and B and the terminal; the business aviation centre too.
  const groups = count(Object.values(airport.terminals), (t) => String(t.group));
  expect(Object.values(groups)).toEqual([20, 1, 1]);
  const dockE = Object.values(airport.terminals).find((t) => t.name === 'Dock E')!;
  expect(groups[dockE.group]).toBe(1);
  expect(stands.filter((s) => s.ref?.startsWith('E') && s.kind === 'contact')).toHaveLength(24);
  expect([
    Object.keys(airport.gates).length,
    airport.hangars.length,
    Object.keys(airport.helipads).length,
    Object.keys(airport.holdingPositions).length,
    airport.roadCrossings.length,
  ]).toEqual([105, 11, 12, 184, 91]);

  // One airside graph; every stand reaches every fixed-wing runway end.
  const ends = runways.filter((r) => r.maxCode).flatMap((r) => r.ends);
  expect(airsideReachable(airport, ends[0]!.node, undefined, 'either').size).toBe(
    Object.keys(airport.nodes).length,
  );
  for (const end of ends) {
    const reach = airsideReachable(airport, end.node, undefined, 'reverse');
    for (const stand of stands)
      expect(
        reach.has(airport.edges[stand.leadIn.at(-1)!]!.to),
        `${stand.ref} to ${end.designator}`,
      ).toBe(true);
  }
  // Code F stands with all-code-F ways to every runway end: the A380's stands.
  const allF = stands
    .filter((s) => s.maxCode === 'F')
    .filter((s) => {
      const reach = airsideReachable(
        airport,
        airport.edges[s.leadIn[0]!]!.from,
        (e) => e.maxCode === 'F' && (e.kind !== 'lead_in' || e.stand === s.id),
        'either',
      );
      return ends.every((end) => reach.has(end.node));
    })
    .map((s) => s.ref)
    .sort();
  expect(allF).toEqual(['E19', 'F71', 'F72']);
});
