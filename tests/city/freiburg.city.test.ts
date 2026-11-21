import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { buildFreiburgProject, freiburgProject, openFreiburg } from '../../bench/freiburg';
import { probeMorning } from '../../bench/import-probe';
import { compile } from '../../src/network';
import { compileRail } from '../../src/network/rail';
import { trainTimetable, trainsAt } from '../../src/network/trains';
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
  // south on Günterstalstraße, and the line from Kronenstraße; then (TASK-202) the Rotteckring
  // both ways, between Habsburgerstraße and Kronenstraße, and the Schwabentorschleife from the
  // east and back. TASK-214's rebuild of the project renumbers the rail nodes by one.
  expect(table.routes.map((r) => `${end(r.from)}>${end(r.to)}`)).toEqual([
    'rn:12243>rn:12226',
    'rn:12884>rn:12226',
    'rn:12228>rn:12561',
    'rn:12517>rn:12577',
    'rn:12049>rn:12515',
    'rn:12517>rn:12882',
    'rn:12884>rn:12515',
    'rn:12228>rn:12226',
  ]);
  for (const route of table.routes.slice(0, 5).filter((r) => end(r.from) !== 'rn:12884'))
    expect(route.stops.map((s) => s.name)).toContain('Bertoldsbrunnen');
  expect(census.routes.map((r) => r.perHour)).toEqual([10, 10, 10, 10, 10, 10, 10, 10]);
  expect(table.periodS).toBe(720);
  // Every mapped stop has a tram (TASK-202; TASK-198 served 24 of the 32).
  expect(census.servedStops).toHaveLength(32);
  expect(census.unservedStops).toEqual([]);
  // TASK-214's rebuild: the renumbered ids' offsets no longer fitted 10 an hour, so the lead's
  // salted retry in `buildTimetable` picks other offsets (same routes and headways).
  // TASK-255: seven more junction groups move the tram stop ids allocated after them by seven
  // (ts:13306 to ts:13313); same routes, stops and headways.
  expect(table.hash).toBe('c0bd7828');
  for (let time = 0; time < 86400; time += 5) {
    const used = new Set<number>();
    for (const tram of trainsAt(rail, table, time))
      for (const track of tram.occupied) {
        if (used.has(track)) throw Error(`Tram collision at ${time} on ${rail.tracks[track]!.id}`);
        used.add(track);
      }
  }
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
    // TASK-201: 3D draws a building's parts instead of its outline. Above the Schwabentor's 48 m
    // stand only the Münster's choir towers and openwork spire (from 37 m) and the Martinstor.
    const drawn = buildings.flatMap((b) =>
      (b.parts ?? [b]).map((part) => ({ ...part, of: b.sub })),
    );
    expect(
      drawn
        .filter((part) => (part.heightM ?? 0) > 48)
        .map((part) => [part.of, part.heightM, part.minHeightM, part.roof?.shape]),
    ).toEqual([
      ['cathedral', 53, undefined, 'pyramidal'],
      ['cathedral', 53, undefined, 'pyramidal'],
      ['cathedral', 116, 37, 'pyramidal'],
      ['gatehouse', 53, undefined, 'hipped'],
    ]);
    expect(buildings.find((b) => b.sub === 'cathedral')?.parts).toHaveLength(31);
    expect(buildings.filter((b) => b.parts)).toHaveLength(82);
    // Building passages and covered streets run at grade.
    const covered = [41455470, 157116842, 30343822, 111812982, 48280860];
    const roads = Object.values(city.roads).filter((r) =>
      r.provenance.osmIds?.some((id) => covered.includes(id)),
    );
    expect(roads.length).toBeGreaterThanOrEqual(5);
    expect(roads.filter((r) => (r.layer ?? 0) !== 0)).toEqual([]);
    expect(project.view?.camera).toMatchObject({ '3d': { pitch: 50, bearing: -60 } });
    // TASK-201: flat for now (owner, 2026-11-18); fixtures/terrain/freiburg.json is not loaded.
    expect(city.terrain).toBeUndefined();
  },
  limit(120_000),
);

test('Freiburg passes its own gate at the showcase demand', () => {
  // Pinned so curation and the import do not drift: rebuild the project and re-pin on purpose.
  // openProject checks city.json against this manifest hash, so it pins the city.
  const { manifest } = JSON.parse(readFileSync(freiburgProject, 'utf8'));
  // TASK-201: re-pinned for the 2026-11-18 extract with building parts and the parts in place of
  // TASK-198's Münster and St. Martin curation. The road network is the same, so the state hash
  // is TASK-198's.
  // TASK-207: re-pinned for its validation curation: three lots the polygon cut leaves without
  // access and two dead-end roads into the pedestrian Schwabentor removed; the ZOB's taxi rank
  // turns round.
  // TASK-214: rebuilt by the lead (connector positions, platform and junction-group ids move).
  // TASK-220: rebuilt for the tram track forms (only tram `form` and its provenance change).
  // TASK-232: rebuilt; 13 stop tracks behind `area:highway` platforms ballast to embedded (only
  // their `form` changes).
  expect(manifest.files['city.json']).toBe(
    // TASK-233: rebuilt; 12 roads are shared lanes (`sharedLane` inferred); the compiled network
    // and the state hash are unchanged.
    // TASK-226 (landed as TASK-234): rebuilt (TASK-219's rules: the Hauptbahnhof group loses
    // the median crossover's nodes and the slip-road diverge; the crossover reads no arrows).
    // TASK-238: rebuilt; Bismarckallee's halves r:1251/r:2215 are one carriageway (TASK-231's D5).
    // TASK-239 (landed as TASK-248): rebuilt; 9 crossing links from marked crossings mapped only
    // as nodes, with the last ids (the tram timetable stays 90e3ff6f).
    // TASK-256: rebuilt; 7 short ballast sections between a street track and another bed are
    // embedded (Rotteckring rt:12944 among them; only their `form` changes).
    // TASK-255: rebuilt; 18 signals mapped at their stop positions join their junctions' groups
    // (groups 39 to 46) and are marked `stopPosition` (`stopPositionCrossing` on a crossing).
    // TASK-264: rebuilt; 40 roads from ways tagged placement=transition are marked
    // `placementTransition`; r:1175's widened surface moves two car-park exits on it by 0.05 mm.
    'bf3f76cd30325f155943347acf165f32800a23e99e95849dec1361abaa1b6314',
  );
  // TASK-204 re-pinned (group chains follow the route's planned movements; changes off the
  // planned lane prepare for a later turn).
  // TASK-202: the Rotteckring and Schwabentorschleife trams and the crossing stop-line fix.
  // TASK-207: its validation curation (above).
  // TASK-213: 16 corners rounded (n:44's far-cut curb, gore fillets); the walk network follows
  // the curbs, so walkers and the cars meeting them move; no lane's stop position moves.
  // Re-pinned by the lead on top of TASK-207's curation.
  // TASK-214: lanes through splits and merges (1,467 to 1,463 completed, 75 to 89 s).
  // Rebuilt project and the retimed trams (lead, at the merge): 1,462 completed, 76 s.
  // TASK-222: in a mutual wait at a crossing, an actuated green is kept for the held car while
  // the joined controller changes to its phase (1,462 completed, 76.2 to 75.7 s).
  // TASK-228: a tram waits at its origin for a delayed run of another line only when it would
  // meet it in time, so all 240 runs due by 10:00 enter (184 before), and their crossings close
  // more often (1,462 to 1,460 completed, 75.7 to 80.3 s).
  // TASK-221 (landed as TASK-235): lane transitions carried through plain nodes (1,460 to 1,459
  // completed, 80.3 to 82.0 s).
  // TASK-226 (landed as TASK-234): the Hauptbahnhof's stop line at the junction (TASK-219's
  // group membership), the gore fillet at n:473, and the carriageway's arrows read at the
  // junction past the median crossover n:1147, not at it (80.3 to 80.6 s alone; with TASK-235
  // 1,461 completed, 77.8 s).
  // TASK-238: Bismarckallee's halves pulled to one carriageway (1,461 completed, 77.8 to 77.9 s).
  // TASK-247: a car behind a head waiting for another phase does not extend an actuated green
  // (Bismarckallee's shared lane at n:1132; 1,461 to 1,464 completed, 77.9 to 68.1 s).
  // TASK-239 (landed as TASK-248): walkers cross at the 9 zebras and signals mapped only as nodes
  // (1,464 completed, 68.1 to 70.4 s).
  // TASK-249 (TASK-245's v1): an actuated green resting with walk green serves a waiting walker (a
  // rounding error held it), and signal crossings no phase serves are crossed in a gap (1,464 to
  // 1,523 completed, 68.1 to 68.2 s).
  // With TASK-248 (lead, at the merge): 1,522 completed, 66.1 s.
  // TASK-255: stop lines at the signals mapped before their junctions (TASK-218's D4), whose
  // groups now include them (1,522 to 1,518 completed, 66.1 to 65.8 s).
  expect(morning.stateHash).toBe(1024213382);
  expect(morning.failedByReason.gridlocked).toBe(0);
  expect(morning.stalledHeads).toBe(0);
  expect(morning.failedByReason.no_route).toBe(0);
  // Every failure is a counted parking failure, under 2% of local arrivals.
  expect(morning.failed).toBe(morning.failedByReason.no_parking);
  expect(morning.failedByReason.no_parking).toBeLessThan(0.02 * morning.localArrivals);
  expect(worstVisit.addedS, worstVisit.road).toBeLessThan(900);
});
