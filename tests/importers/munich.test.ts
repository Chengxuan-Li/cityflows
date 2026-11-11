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
  // TASK-131: main's r:1316, r:1319 and r:1320 (9.87 m links at its merged n:138) are gone; the
  // ids name other roads, which are not short.
  'r:1172': 'Short Westendstraße remnant: 2.50 m and 3.41 m setbacks leave less than 5 m.',
  'r:1173': 'Reverse Westendstraße remnant: 3.69 m and 2.50 m setbacks leave less than 5 m.',
  'r:345': 'Philipp-Loewenfeld-Straße link: 4.09 m and 3.94 m setbacks exceed available length.',
  'r:972': 'Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
  'r:973':
    'Reverse Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
  'r:976': 'Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
  'r:977':
    'Reverse Friedrich-von-Pauli-Straße short remnant cannot fit two floor setbacks plus 5 m.',
  // TASK-131 keeps OSM geometry: links between OSM nodes main merged into one (at least one end
  // is not a node on main) stay roads, too short for two setbacks plus 5 m.
  'r:1027': 'Service way 19.6 m from n:898 to n:895.',
  'r:899': 'Service way 14.6 m from n:895 to n:898.',
  'r:900': 'Service way 14.6 m from n:898 to n:895.',
  'r:1241': 'Bergmannstraße 6.2 m from n:1239 to n:1240.',
  'r:1242': 'Bergmannstraße 6.2 m from n:1240 to n:1239.',
  'r:1304': 'Arnulfstraße 11.8 m from n:1303 to n:124.',
  'r:143': 'Donnersbergerstraße 10.4 m from n:139 to n:142.',
  'r:144': 'Donnersbergerstraße 10.4 m from n:142 to n:139.',
  'r:219': 'Kazmairstraße 4.1 m from n:215 to n:218.',
  'r:220': 'Kazmairstraße 4.1 m from n:218 to n:215.',
  'r:303': 'Service way 9.7 m from n:302 to n:171.',
  'r:304': 'Service way 9.7 m from n:171 to n:302.',
  'r:360': 'Service way 2.8 m from n:358 to n:359.',
  'r:361': 'Service way 2.8 m from n:359 to n:358.',
  'r:514': 'Richelstraße 11.2 m from n:510 to n:513.',
  'r:515': 'Richelstraße 11.2 m from n:513 to n:510.',
  'r:550': 'Service way 3.6 m from n:548 to n:549.',
  'r:551': 'Service way 3.6 m from n:549 to n:548.',
  'r:809': 'Gabrielenstraße 2.5 m from n:808 to n:616.',
  'r:810': 'Gabrielenstraße 2.5 m from n:616 to n:808.',
  'r:860': 'Service way 9.1 m from n:859 to n:492.',
  'r:861': 'Service way 9.1 m from n:492 to n:859.',
  'r:863': 'Service way 9.3 m from n:498 to n:862.',
  'r:864': 'Service way 9.3 m from n:862 to n:498.',
  'r:890': 'Service way 3.3 m from n:594 to n:887.',
  'r:891': 'Service way 3.3 m from n:887 to n:594.',
  'r:1063': 'Service way 3.1 m from n:908 to n:1003.',
  'r:1064': 'Service way 3.1 m from n:1003 to n:908.',
};

// TASK-131 keeps OSM geometry: main's r:1095#0 (now from n:1089, not main's n:440) and r:1161#0
// (the service way now meets Hansastraße at n:1158 inside the crop) have exits.
const remainingDeadEnds: Record<string, string> = {
  'r:1103#0':
    'One-way Georg-Lindau-Straße fragment leaves the crop without a route from the main network.',
  'r:1287#0':
    'TASK-131: cropped Hansastraße boundary at n:1286 (west edge), apart from n:1158; a crop, not a cul-de-sac.',
  'r:1287#1': 'The second lane of the same cropped Hansastraße end.',
  'r:1291#0': 'TASK-131: cropped Hansastraße boundary at n:1289 (north edge), as r:1287.',
  'r:470#0':
    'TASK-131: the 9.1 m two-way Gollierstraße link n:16 to n:452 (one node on main) faces the one-way r:453; its only exit is a U-turn.',
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
    // merged into one node); inner roads of groups are not counted. Dead ends: the 9 named below;
    // e4654d8 gives r:252#2 and r:966#2 (jg:10783's inner roads) their merges at the next member.
    expect(count('road_too_short')).toBeLessThanOrEqual(39);
    expect(count('dead_end')).toBeLessThanOrEqual(9);
    const roads = Object.values(city.roads);
    // TASK-131: a signalised junction group runs one program for its members (which have
    // `signal: null`), so controllers are counted: main's 14 signal nodes are 10, as main's n:247,
    // n:262 and n:963 are members of one group (jg:10783) and so are n:638, n:647 and n:665
    // (jg:10802). Neighbours and names are those of the roads entering or leaving the group.
    const groupOf = new Map(
      Object.values(city.junctionGroups ?? {}).flatMap((g) => g.nodes.map((id) => [id, g])),
    );
    const controllers = new Map<string, { members: Set<string>; program: unknown }>();
    for (const node of Object.values(city.nodes).filter((n) => n.control === 'signal')) {
      const group = groupOf.get(node.id);
      controllers.set(
        group?.id ?? node.id,
        group
          ? { members: new Set(group.nodes), program: group.signal }
          : { members: new Set([node.id]), program: node.signal },
      );
    }
    expect(controllers.size).toBe(10);
    for (const { members, program } of controllers.values()) {
      const ends = roads.filter((r) => members.has(r.from) !== members.has(r.to));
      expect(
        new Set(ends.map((r) => (members.has(r.from) ? r.to : r.from))).size,
      ).toBeGreaterThanOrEqual(3);
      expect(new Set(ends.map((r) => r.name)).size).toBeGreaterThanOrEqual(2);
      expect(program).not.toBeNull();
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
    // TASK-119 removes 57 unused parking destinations from all pairs. TASK-131 keeps OSM
    // geometry: place connectors sit on more, shorter roads (main 24 944 pairs).
    expect(pairs).toBe(25_753);
    expect(unroutable).toEqual([]);
    // TASK-124 keeps arrivals on r:379/r:1060 and adds legal exits; the fixed-size
    // connector sample now includes 15 more destinations on still-restricted r:1059.
    // TASK-131: r:379, r:1059 and r:1060 are the same roads; more origins reach r:1059 (main 906).
    expect(forbidden).toEqual({ from379: 0, from1060: 0, to1059: 924 });
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
  // TASK-101 restricted segments; TASK-131 short roads kept, and Benzstraße r:1065 is short since
  // its split n:867 (merged on main) is a junction with a 10 m setback.
  ['sindelfingen-a81', 78],
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
