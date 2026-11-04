import { expect, test } from 'vitest';
import { probeMorning } from '../../bench/import-probe';
import { auditRoute } from '../../bench/route-audit';
import { lonLatToLocal } from '../../src/geo/projection';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { fixture } from './fixtures';
import {
  importedRoadBodyOverlaps,
  junctionOverlaps,
  movementsOutside,
} from '../network/junction-audit';

const remainingShortRoads: Record<string, string> = {
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
  'r:1161#0':
    'Isolated service spur has no legal return through the retained Hansastraße boundary junction.',
  'r:1173#0':
    'Westendstraße faces a one-way approach; the only outgoing road reverses its own street group.',
  'r:350#0':
    'Friedrich-von-Pauli-Straße faces a one-way approach; only its reverse carriageway leaves.',
  'r:672#0':
    'Two-way trunk link terminates against an incoming one-way link; ramp U-turns remain prohibited.',
};

test('Munich import satisfies topology, demand, route and morning-run targets', () => {
  const { xml } = fixture('munich-donnersberger');
  const imported = importOsm(xml, {
    importerVersion: 'test',
    bbox: [11.525, 48.135, 11.545, 48.148],
  });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const { city } = imported;
  const count = (code: string) => imported.diagnostics.filter((d) => d.code === code).length;
  expect(count('connector_unreachable')).toBe(0);
  expect(count('road_too_short')).toBeLessThanOrEqual(15);
  expect(count('dead_end')).toBeLessThanOrEqual(7);
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
    imported.diagnostics
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
  expect(places.filter((p) => p.kind === 'parking')).toHaveLength(80);
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
    result.diagnostics
      .filter((d) => d.code === 'road_too_short')
      .flatMap((d) => d.refs)
      .sort(),
  ).toEqual(Object.keys(remainingShortRoads).sort());
  // 78 lane crossings at junction ends before TASK-061. What remains is either a source
  // road-body defect listed in the audit or a crossing at a node with a capped setback,
  // which the junction surface covers (architecture 5.1).
  const overlaps = junctionOverlaps(compiled).filter((pair) => !pair.capped);
  expect(
    overlaps.filter(
      (pair) => !importedRoadBodyOverlaps['munich-donnersberger']![pair.lanes.join('>')],
    ),
  ).toEqual([]);
  expect(movementsOutside(compiled)).toEqual([]);
  const provider = createRouteProvider(),
    costs = freeFlowLinkCosts(compiled);
  const unroutable: string[] = [];
  const infeasible: string[] = [];
  let pairs = 0;
  for (const origin of compiled.connectors.filter((c) => c.direction !== 'in')) {
    for (const destination of compiled.connectors.filter((c) => c.direction !== 'out')) {
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
      if (!route.ok) unroutable.push(`${origin.id}>${destination.id}: ${route.reason}`);
      else
        for (const issue of auditRoute(city, compiled, request, route.route))
          infeasible.push(`${origin.id}>${destination.id}: ${JSON.stringify(issue)}`);
    }
  }
  expect(pairs).toBeGreaterThan(40_000);
  expect(unroutable).toEqual([]);
  expect(infeasible).toEqual([]);
  const morning = probeMorning(city, compiled);
  console.info('Munich morning probe', morning);
  expect(morning.releasedTrips).toBeGreaterThan(10_000);
  expect(morning.failed).toBe(0);
  expect(morning.failedShareOfReleased).toBe(0);
  expect(morning.completed).toBeGreaterThanOrEqual(Math.floor(445 * 0.99));
  expect(morning.gatewayTraffic.trunk!.entered).toBeGreaterThan(0);
  expect(morning.gatewayTraffic.trunk!.left).toBeGreaterThan(0);
  expect(morning.sampledRoadTraffic.ramp!.entered).toBeGreaterThan(0);
  expect(morning.sampledRoadTraffic.ramp!.left).toBeGreaterThan(0);
}, 600_000);

test.each([
  ['downtown', 60],
  ['highway', 19], // 17 after TASK-054 plus two lane_requires_merge warnings from TASK-055
  ['suburb', 7],
  ['sindelfingen-a81', 58], // TASK-061: five additional road_too_short warnings from per-end setbacks.
] as const)('%s retains no more warnings than the TASK-054 baseline', (name, baseline) => {
  const { xml, options } = fixture(name);
  const result = importOsm(xml, options);
  expect(result.ok).toBe(true);
  expect(result.diagnostics.filter((d) => d.severity === 'warning').length).toBeLessThanOrEqual(
    baseline,
  );
});
