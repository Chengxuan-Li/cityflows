import { withoutLotAisles } from '../without-lot-aisles';
import { expect } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { auditRoute } from '../../bench/route-audit';
import { lonLatToLocal } from '../../src/geo/projection';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { cityTest, unitTest } from '../tier';
import { fixture } from './fixtures';
import { movementsOutside, roadBodyCrossings } from '../network/junction-audit';

// Short roads on main 5568eed. TASK-090: a budget of the recorded count plus two, not the exact
// list: setbacks move with every junction geometry change.
const remainingShortRoads: Record<string, string> = {
  'r:1032': 'TASK-101 retains the 7.40 m private link; its floor setbacks and 5 m lane cannot fit.',
  'r:1033': 'The reverse of the retained 7.40 m private link.',
  'r:1072':
    'TASK-101 retains the 17.57 m private approach; 5.90 m and 7.38 m setbacks leave under 5 m.',
  'r:1073': 'The reverse private approach; 5.18 m and 10 m setbacks leave under 5 m.',
  'r:1316':
    'TASK-101 retains the 9.87 m truck-delivery segment; its two junction cuts leave under 5 m.',
  'r:1319':
    'The inferred median crossing beside the retained segment is 9.87 m, under two floor setbacks plus 5 m.',
  'r:1320': 'The reverse of the same 9.87 m median crossing.',
  'r:1172': 'Short Westendstraße remnant: 2.50 m and 3.41 m setbacks leave less than 5 m.',
  'r:1173': 'Reverse Westendstraße remnant: 3.69 m and 2.50 m setbacks leave less than 5 m.',
  'r:345': 'Philipp-Loewenfeld-Straße link: 4.09 m and 3.94 m setbacks exceed available length.',
  'r:972': 'Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
  'r:973':
    'Reverse Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
  'r:976': 'Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
  'r:977':
    'Reverse Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
};

const remainingDeadEnds: Record<string, string> = {
  'r:1095#0':
    'Service approach meets the reverse direction of Josef-Obenhin-Straße; all exits are U-turns.',
  'r:1103#0':
    'One-way Georg-Lindau-Straße fragment leaves the crop without a route from the main network.',
  'r:1161#0': 'Cropped Hansastraße boundary; an artificial crop is not a physical cul-de-sac.',
  'r:1173#0':
    'Westendstraße faces a one-way approach; the only outgoing road reverses its own street group.',
  'r:350#0':
    'Friedrich-von-Pauli-Straße faces a one-way approach; only its reverse carriageway leaves.',
  'r:490#0':
    'TASK-101 retains the height-restricted 13.16 m link: its only outgoing direction is a same-street U-turn.',
  'r:672#0':
    'Two-way trunk link terminates against an incoming one-way link; ramp U-turns remain prohibited.',
};

// Its morning at full demand runs in the traffic tier (tests/traffic/munich-full-demand.test.ts).
cityTest(
  'Munich import satisfies topology, demand and route targets',
  () => {
    const { xml } = fixture('munich-donnersberger');
    const imported = importOsmCached(xml, {
      importerVersion: 'test',
      bbox: [11.525, 48.135, 11.545, 48.148],
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    // TASK-104: retain the historical public-road oracle; lots and full traffic are T49/traffic:quick.
    const city = withoutLotAisles(imported.city);
    const diagnostics = compile(city).diagnostics;
    const count = (code: string) => diagnostics.filter((d) => d.code === code).length;
    expect(count('connector_unreachable')).toBe(0);
    // TASK-131 keeps OSM geometry: short roads between close nodes stay as roads (no longer
    // merged into one node); inner roads of groups are not counted. Dead ends: lanes of a group's
    // inner links or arms that end without a movement at the next member (r:252#2, r:966#2).
    expect(count('road_too_short')).toBeLessThanOrEqual(27);
    expect(count('dead_end')).toBeLessThanOrEqual(11);
    const roads = Object.values(city.roads);
    const signals = Object.values(city.nodes).filter((n) => n.control === 'signal');
    expect(signals).toHaveLength(14);
    for (const node of signals) {
      const ends = roads.filter((r) => r.from === node.id || r.to === node.id);
      expect(
        new Set(ends.map((r) => (r.from === node.id ? r.to : r.from))).size,
      ).toBeGreaterThanOrEqual(3);
      expect(new Set(ends.map((r) => r.name)).size).toBeGreaterThanOrEqual(2);
      expect(node.signal).not.toBeNull();
    }
    expect(
      diagnostics
        .filter((d) => d.code === 'dead_end')
        .flatMap((d) => d.refs)
        .sort(),
    ).toEqual(Object.keys(remainingDeadEnds).sort());
    const places = Object.values(city.places);
    const homes = places.filter((p) => p.kind === 'residential');
    const work = places.filter((p) => p.kind === 'work');
    for (const count of [
      homes.reduce((s, p) => s + p.population, 0),
      work.reduce((s, p) => s + p.jobs, 0),
      places.reduce((s, p) => s + p.population, 0),
      places.reduce((s, p) => s + p.jobs, 0),
    ]) {
      expect(count).toBeGreaterThanOrEqual(10_000);
      expect(count).toBeLessThanOrEqual(40_000);
    }
    expect(
      homes.length + work.length + places.filter((p) => p.kind === 'retail').length,
    ).toBeLessThan(100);
    // TASK-119's 57 mapped street-side areas are facilities, no longer demand places.
    expect(places.filter((p) => p.kind === 'parking')).toHaveLength(23);
    expect(places.filter((p) => p.kind === 'school')).toHaveLength(5);
    const northwest = lonLatToLocal(city.geo!, { lon: 11.525, lat: 48.148 });
    const southeast = lonLatToLocal(city.geo!, { lon: 11.545, lat: 48.135 });
    for (const road of Object.values(city.roads)) {
      if (!['motorway', 'trunk', 'primary', 'secondary'].includes(road.roadClass)) continue;
      for (const [id, direction] of [
        [road.from, 'out'],
        [road.to, 'in'],
      ] as const) {
        const { pos } = city.nodes[id]!;
        if (
          Math.min(
            Math.abs(pos.x - northwest.x),
            Math.abs(pos.x - southeast.x),
            Math.abs(pos.y - northwest.y),
            Math.abs(pos.y - southeast.y),
          ) > 1e-6
        )
          continue;
        expect(
          places.some(
            (p) =>
              p.kind === 'gateway' &&
              p.connectors.some((c) => c.roadId === road.id && c.direction === direction),
          ),
        ).toBe(true);
      }
    }

    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { compiled } = result;
    expect(
      result.diagnostics.filter((d) => d.code === 'road_too_short').flatMap((d) => d.refs).length,
    ).toBeLessThanOrEqual(Object.keys(remainingShortRoads).length + 2);
    // 78 lane crossings at junction ends before TASK-061. What remains is either a source
    // road-body defect in the audit's budget (TASK-090) or a crossing at a node with a capped
    // setback, which the junction surface covers (architecture 5.1).
    const crossings = roadBodyCrossings(compiled, 'munich-donnersberger');
    expect(crossings.pairs.length).toBeLessThanOrEqual(crossings.budget);
    // TASK-074 residuals (see T20 and T27): a dead-end U-turn, a merged pair of carriageways
    // lying on top of each other, and a short stub whose turns cross its neighbour's mouth.
    // TASK-080: r:1276#0>r:1368#0 left the list (r:1368's shorter transition at n:936, see T20).
    // TASK-082: r:973#0>r:972#0 left it too (see T20).
    // TASK-083: the junction polygon holds every movement surface (T38.2), the dead-end U-turn
    // r:1163#0>r:1121#0 included.
    expect(movementsOutside(compiled)).toEqual([]);
    const provider = createRouteProvider(),
      costs = freeFlowLinkCosts(compiled);
    const unroutable: string[] = [];
    const infeasible: string[] = [];
    // TASK-101: these open connector roads require entering a different restricted road.
    // r:379 exits through the bus-only Trappentreustraße links r:373/r:374; r:1059/r:1060
    // are reached/left through private r:917/r:921. Their open endpoints confer no zone permit.
    const forbidden = { from379: 0, from1060: 0, to1059: 0 };
    // TASK-102 garage entries have separate reachability checks; preserve this place audit.
    const placeEntries = new Set(
      compiled.places.flatMap((p) => [...p.connectorsIn, ...p.connectorsOut]),
    );
    const connectors = compiled.connectors.filter((c) => placeEntries.has(c.idx));
    let pairs = 0;
    for (const origin of connectors.filter((c) => c.direction !== 'in')) {
      for (const destination of connectors.filter((c) => c.direction !== 'out')) {
        if (origin.place === destination.place) continue;
        pairs++;
        const request = {
          fromLane: origin.lane,
          fromPosM: origin.positionM,
          toConnector: destination.idx,
          vehicleClass: 'car' as const,
          desiredSpeedFactor: 1,
          noise: 0,
          seed: 1,
        };
        const route = provider.route(compiled, costs, request);
        if (!route.ok) {
          const from = compiled.roads[compiled.lanes[origin.lane]!.road]!.id;
          const to = compiled.roads[compiled.lanes[destination.lane]!.road]!.id;
          const expected =
            from === 'r:379'
              ? 'from379'
              : from === 'r:1060'
                ? 'from1060'
                : to === 'r:1059'
                  ? 'to1059'
                  : null;
          if (route.reason === 'class_forbidden' && expected) forbidden[expected]++;
          else unroutable.push(`${origin.id}>${destination.id}: ${route.reason}`);
        } else
          for (const issue of auditRoute(city, compiled, request, route.route))
            infeasible.push(`${origin.id}>${destination.id}: ${JSON.stringify(issue)}`);
      }
    }
    expect(pairs).toBe(24_944); // TASK-119 removes 57 unused parking destinations from all pairs.
    expect(unroutable).toEqual([]);
    // TASK-124 keeps arrivals on r:379/r:1060 and adds legal exits; the fixed-size
    // connector sample now includes 15 more destinations on still-restricted r:1059.
    expect(forbidden).toEqual({ from379: 0, from1060: 0, to1059: 906 });
    expect(infeasible).toEqual([]);
  },
  600_000,
);

unitTest.each([
  // Warnings only: lane_requires_merge (TASK-069) and realign_limited (TASK-068) are notes.
  // TASK-131: OSM geometry kept, short roads between close nodes stay (inner roads not counted).
  ['downtown', 49],
  ['highway', 23], // TASK-101 short access boundaries; TASK-131 short roads kept.
  ['suburb', 7],
  ['sindelfingen-a81', 77], // TASK-101 restricted segments; TASK-131 short roads kept.
] as const)('%s stays within its import warning baseline', (name, baseline) => {
  const { xml, options } = fixture(name);
  const result = importOsmCached(xml, options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Import failed');
  // TASK-104 diagnoses new lots separately; TASK-124 exit warnings have their own T61 gate.
  const original = compile(withoutLotAisles(result.city));
  expect(
    original.diagnostics.filter(
      (d) => d.severity === 'warning' && !['parking_no_exit', 'place_no_exit'].includes(d.code),
    ).length,
  ).toBeLessThanOrEqual(baseline);
});
