import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { buildFreiburgProject, freiburgProject, openFreiburg } from '../../bench/freiburg';
import { probeMorning } from '../../bench/import-probe';
import { compile } from '../../src/network';
import { compileRail } from '../../src/network/rail';
import { trainTimetable } from '../../src/network/trains';
import { tramCensus, tramTimetable } from '../../src/network/trams';
import type { City } from '../../src/schema';
import { limit } from '../timeouts';

// TASK-198: the landing city, as bundled (fixtures/projects/freiburg.cityflows.json), and its
// morning at the showcase demand (0.15 persons per resident, mode choice on), 7:00 to 10:00.

/** The entries where Freiburg's polygon crosses a road of tertiary class or above, by the OSM
 * ways each gateway serves (docs/decisions/2026-11-17-landing-city.md). The polygon's east tip
 * cuts the ring road between Leopoldring and Schlossbergring, whose joining way lies outside the
 * extract, so each is an entry. */
const entries: Record<string, number[]> = {
  'Habsburgerstraße, B 3 north': [30313858, 478569866],
  'Stefan-Meier-Straße': [986453816],
  'Breisacher Straße': [23024406],
  'Schnewlinstraße, B 3 west': [27049877, 30339507],
  'Lessingstraße, B 31 link': [27363593, 234491459],
  'B 31 west, Autobahnzubringer Mitte and its links': [39223471, 208424805, 229626071, 526811436],
  Kronenstraße: [239527135, 420014063],
  'Günterstalstraße, L 124': [240454244, 4099150],
  'B 31 east, Schwarzwaldstraße and Leo-Wohleb-Straße': [10209572, 242170278],
  Schlossbergring: [1259488934, 1309085569],
  Leopoldring: [243604098, 51984086],
};

let city: City;
let project: Awaited<ReturnType<typeof openFreiburg>>;
let morning: ReturnType<typeof probeMorning>;
/** The most wait any single visit to one road added (TASK-154's drain criterion, generalised to
 * every road as TASK-197 measured it), sampled every simulated second, and where. */
const worstVisit = { addedS: 0, road: '' };

beforeAll(async () => {
  project = await openFreiburg();
  city = project.city;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const { compiled } = result;
  const visits = new Map<number, { road: number; waitS: number }>();
  let tick = 0;
  morning = probeMorning(city, compiled, 0.15, {
    observe(engine) {
      if (++tick % 10) return;
      const snapshot = engine.snapshot();
      const active = new Set(snapshot.id);
      for (const id of visits.keys()) if (!active.has(id)) visits.delete(id);
      for (const [i, id] of snapshot.id.entries()) {
        const segment = snapshot.lane[i]!;
        if (segment === -2147483648) {
          visits.delete(id);
          continue;
        }
        const lane = segment < 0 ? compiled.movements[-segment - 1]!.fromLane : segment;
        const road = compiled.lanes[lane]!.road;
        const visit = visits.get(id);
        const waitS = engine.inspect(id)!.waitingS;
        if (visit?.road !== road) visits.set(id, { road, waitS });
        else if (waitS - visit.waitS > worstVisit.addedS)
          Object.assign(worstVisit, {
            addedS: waitS - visit.waitS,
            road: compiled.roads[road]!.id,
          });
      }
    },
  });
  console.info('Freiburg morning at 0.15, mode choice on', {
    persons: morning.persons,
    completed: morning.completed,
    failed: morning.failed,
    failedByReason: morning.failedByReason,
    stalledHeads: morning.stalledHeads,
    failures: morning.failures,
    localArrivals: morning.localArrivals,
    worstVisit,
    stateHash: morning.stateHash,
    gatewayTrips: morning.gatewayTrips,
  });
}, limit(900_000));

test('Freiburg has a gateway at each entry and nowhere else', () => {
  const gateways = Object.values(city.places).filter((p) => p.kind === 'gateway');
  const byWays = gateways.map((g) => [...g.provenance.osmIds!].sort((a, b) => a - b).join(','));
  expect(byWays.sort()).toEqual(
    Object.values(entries)
      .map((ways) => [...ways].sort((a, b) => a - b).join(','))
      .sort(),
  );
});

test('every entry carries trips in and out by 10:00', () => {
  const gateways = Object.values(city.places).filter((p) => p.kind === 'gateway');
  for (const gateway of gateways) {
    const trips = morning.gatewayTrips[gateway.id];
    expect(trips?.entered, `${gateway.id} entered`).toBeGreaterThan(0);
    // The link out at Lessingstraße leaves the B 31a inbound and loops back in as Lessingstraße
    // outside the polygon, by a way the extract lacks: only B 31a traffic could take it, and the
    // demand has no through trips, so nothing leaves by it.
    if (gateway.provenance.osmIds!.includes(234491459)) continue;
    expect(trips?.left, `${gateway.id} left`).toBeGreaterThan(0);
  }
});

test('trams run the main lines through Bertoldsbrunnen, both ways', () => {
  const rail = compileRail(city)!;
  const table = tramTimetable(rail);
  const census = tramCensus(rail, table);
  console.info(
    'Freiburg trams',
    census.routes.map((r) => `${r.destination}: ${r.stops.map((s) => s.name).join(', ')}`),
  );
  const end = (node: number) => rail.nodes[node]!.id;
  // West at the Stühlingerbrücke, east at the Schwabentorbrücke, north on Habsburgerstraße,
  // south on Günterstalstraße, and the Rotteckring line from Kronenstraße.
  expect(table.routes.map((r) => `${end(r.from)}>${end(r.to)}`)).toEqual([
    'rn:12244>rn:12227',
    'rn:12885>rn:12227',
    'rn:12229>rn:12562',
    'rn:12518>rn:12578',
    'rn:12050>rn:12516',
  ]);
  for (const route of table.routes.filter((r) => end(r.from) !== 'rn:12885'))
    expect(route.stops.map((s) => s.name)).toContain('Bertoldsbrunnen');
  expect(census.routes.map((r) => r.perHour)).toEqual([10, 10, 10, 10, 10]);
  expect(table.periodS).toBe(720);
  expect(census.servedStops).toHaveLength(24);
  expect(table.hash).toBe('aff6c2fd');
  expect(trainTimetable(rail).routes).toHaveLength(5);
});

test(
  'the bundled project is the curated build of the committed extract',
  async () => {
    expect(await buildFreiburgProject()).toBe(readFileSync(freiburgProject, 'utf8'));
    expect(city.name).toBe('Freiburg im Breisgau');
    expect(project.population).toHaveLength(morning.persons);
    expect(project.scenarios[0]!.demand.personsPerResident).toBe(0.15);
    const buildings = city.context!.features.filter(
      (f): f is Extract<typeof f, { kind: 'area' }> => f.kind === 'area' && f.class === 'building',
    );
    // The Münster's tower carries its spire; nothing else stands above the Schwabentor's 48 m.
    const tall = buildings.filter((b) => (b.heightM ?? 0) > 48);
    expect(tall.map((b) => [b.sub, b.heightM, b.roof?.shape])).toEqual([
      ['tower', 116, 'pyramidal'],
    ]);
    expect(buildings.find((b) => b.sub === 'cathedral')).toMatchObject({ heightM: 30 });
    // Building passages and covered streets run at grade.
    const covered = [41455470, 157116842, 30343822, 111812982, 48280860];
    const roads = Object.values(city.roads).filter((r) =>
      r.provenance.osmIds?.some((id) => covered.includes(id)),
    );
    expect(roads.length).toBeGreaterThanOrEqual(5);
    expect(roads.filter((r) => (r.layer ?? 0) !== 0)).toEqual([]);
    expect(project.view?.camera).toMatchObject({ '3d': { pitch: 50, bearing: -60 } });
  },
  limit(120_000),
);

test('Freiburg passes its own gate at the showcase demand', () => {
  // Pinned so curation and the import do not drift: rebuild the project and re-pin on purpose.
  // openProject checks city.json against this manifest hash, so it pins the city.
  const { manifest } = JSON.parse(readFileSync(freiburgProject, 'utf8'));
  expect(manifest.files['city.json']).toBe(
    'ded060cfd6e9787fdb7e846b3f5c074a2e0e3d2e0822ed0751c80aea696b9539',
  );
  expect(morning.stateHash).toBe(1137612334);
  expect(morning.failedByReason.gridlocked).toBe(0);
  expect(morning.stalledHeads).toBe(0);
  expect(morning.failedByReason.no_route).toBe(0);
  // Every failure is a counted parking failure, under 2% of local arrivals.
  expect(morning.failed).toBe(morning.failedByReason.no_parking);
  expect(morning.failedByReason.no_parking).toBeLessThan(0.02 * morning.localArrivals);
  expect(worstVisit.addedS, worstVisit.road).toBeLessThan(900);
});
