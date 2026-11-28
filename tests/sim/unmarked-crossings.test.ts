import { describe, expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { CompiledCity } from '../../src/network';
import type { City, CrossingMarking, Scenario, TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles } from '../../src/sim/vehicle';
import { createWalkers } from '../../src/sim/walkers';
import { sampleCrossings } from './crossing-safety';
import { scenario as baseScenario, setup } from './fixtures';

// TASK-279: German rules at a crossing without a zebra. A walker has no priority there (StVO
// §25(3)): it crosses in a gap of the traffic, while drivers turning into the street it crosses
// yield to it (§9(3)). A zebra (§26) keeps the walker's priority over everyone. The street: a T
// junction whose east arm walkers cross; cars run straight west to east and back, and turn from
// the north arm into the east arm.

function trip(id: string, from: string, to: string, departS: number): TripRequest {
  return {
    id,
    personId: null,
    originPlaceId: from,
    destinationPlaceId: to,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  };
}

function place(city: City, name: string, pos: { x: number; y: number }) {
  const id = `p:${city.nextId++}`;
  city.places[id] = {
    id,
    name,
    kind: 'other',
    shape: { kind: 'point', pos },
    population: 0,
    jobs: 0,
    attraction: 1,
    capacity: null,
    connectors: [],
    profile: null,
    events: [],
    provenance: { source: 'generated' },
  };
  return id;
}

/** A secondary street west to east with priority over a minor street from the north.
 * `imported`: the roads come from OSM, which maps no crossing here, so the junction's crossings
 * draw no zebra (`crossingStyle` 'none'); drawn by hand they are zebras. */
function tStreet(imported: boolean, crawl = false) {
  const { city, node, road, street, place: carPlace } = buildCity('Unmarked', 1);
  const west = node(-300, 0),
    centre = node(0, 0),
    east = node(300, 0);
  const major = (a: typeof west, b: typeof west, speedKmh = 50) => {
    const options = { roadClass: 'secondary' as const, streetGroupId: `major:${a.id}:${b.id}` };
    return [road(a, b, { ...options, speedKmh }), road(b, a, { ...options, speedKmh })] as const;
  };
  const [westIn, westOut] = major(west, centre);
  const [eastOut, eastIn] = major(centre, east, crawl ? 2 : 50);
  const [northIn] = street(node(0, -150), centre);
  centre.control = 'yield';
  carPlace('West homes', 'residential', { x: -290, y: 10 }, [{ road: westIn, direction: 'out' }]);
  carPlace('East offices', 'work', { x: 290, y: 10 }, [
    { road: eastOut, direction: 'in', positionM: crawl ? 60 : 250 },
  ]);
  carPlace('East homes', 'residential', { x: 290, y: -10 }, [
    { road: eastIn, direction: 'out', ...(crawl ? { positionM: 240 } : {}) },
  ]);
  carPlace('West offices', 'work', { x: -290, y: -10 }, [
    { road: westOut, direction: 'in', positionM: 250 },
  ]);
  carPlace('North homes', 'residential', { x: 10, y: -140 }, [{ road: northIn, direction: 'out' }]);
  const [westHomes, eastOffices, eastHomes, westOffices, northHomes] = Object.keys(city.places);
  const north = place(city, 'North bank', { x: 24, y: -14 });
  const south = place(city, 'South bank', { x: 24, y: 14 });
  if (imported) for (const road of Object.values(city.roads)) road.provenance = { source: 'osm' };
  const trips = [
    ...Array.from({ length: crawl ? 200 : 70 }, (_, i) =>
      i % 2
        ? trip(`trip:${i}`, eastHomes!, westOffices!, 100 + i * (crawl ? 2.3 : 7.9))
        : trip(`trip:${i}`, westHomes!, eastOffices!, 100 + i * (crawl ? 2.1 : 7.3)),
    ),
    ...Array.from({ length: 45 }, (_, i) =>
      trip(`turn:${i}`, northHomes!, eastOffices!, 110 + i * 11.3),
    ),
  ];
  const walkers: Scenario['walkers'] = [
    { fromPlaceId: north, toPlaceId: south, perHour: 180 },
    { fromPlaceId: south, toPlaceId: north, perHour: 180 },
  ];
  return { city, trips, walkers, northHomes: northHomes! };
}

/** The east arm's crossing links (both kerbs east of the junction). */
const eastCrossing = (compiled: CompiledCity) =>
  compiled.walk.links.filter((link) => link.crossing && link.line.every((p) => p.x > 3));

/**
 * Six thousand steps with the safety sample at each. A car comes to a stop for a walker when it
 * stops within 4 m of a crossed span while one waits or crosses (nothing else stops a car this
 * close on this street): a car going straight, counted only while no walker is on the crossing,
 * and a driver turning in from the north arm.
 */
function observe(imported: boolean, crawl = false) {
  const { city, trips, walkers, northHomes } = tStreet(imported, crawl);
  const compiled = setup(city);
  const links = eastCrossing(compiled);
  const spans = links.flatMap((link) => link.crossing!.spans);
  const engine = createEngine();
  engine.load({ compiled, trips, scenario: { ...baseScenario(1), walkers } });
  const counts = { straightForWaiting: 0, turning: 0, overlap: '' };
  const speeds = new Map<number, number>();
  for (let step = 0; step < 6000; step++) {
    engine.step();
    counts.overlap ||= sampleCrossings(engine, compiled) ?? '';
    const people = engine.snapshot().walkers!;
    const states = Array.from(people.id, (id) => engine.inspectWalker(id)!);
    const onCrossing = states.some(
      (w) => links.some((l) => l.idx === w.link) && w.state !== 'waiting',
    );
    const waiting = states.some((w) => w.state === 'waiting');
    const snapshot = engine.snapshot();
    for (let i = 0; i < snapshot.count; i++) {
      const id = snapshot.id[i]!;
      const field = snapshot.lane[i]!;
      const car = engine.inspect(id)!;
      const movement = field < 0 ? compiled.movements[-field - 1]! : undefined;
      const lane = movement ? movement.toLane : field;
      const front = movement ? car.positionM - movement.lengthM : car.positionM;
      const span = spans.find((s) => s.lane === lane);
      const before = speeds.get(id) ?? Infinity;
      speeds.set(id, car.speedMps);
      if (!span || car.speedMps >= 0.1 || before < 0.1) continue;
      const lo = span.atM - span.halfM;
      if (front > lo || front <= lo - 4 || !(onCrossing || waiting)) continue;
      if (car.originPlace === northHomes) counts.turning++;
      else if (!onCrossing) counts.straightForWaiting++;
    }
  }
  return { compiled, links, counts, walkers: engine.metrics().walkers!, engine };
}

describe('TASK-279 unmarked crossings', () => {
  const zebra = observe(false);
  const unmarked = observe(true);

  test('a crossing that draws no zebra is unmarked; one drawn by hand stays a zebra', () => {
    expect(unmarked.links.length).toBeGreaterThan(0);
    expect(unmarked.links.every((l) => l.crossing!.control === 'unmarked')).toBe(true);
    expect(zebra.links.every((l) => l.crossing!.control === 'zebra')).toBe(true);
  });

  test('straight-on drivers do not stop for a walker waiting at an unmarked crossing', () => {
    // At the zebra they do (§26); unmarked, the walker waits for a gap (§25(3)).
    expect(zebra.counts.straightForWaiting).toBeGreaterThan(0);
    expect(unmarked.counts.straightForWaiting).toBe(0);
    expect(unmarked.walkers.crossings.unmarked).toBeGreaterThan(10);
    expect(unmarked.walkers.crossings.zebra).toBe(0);
    expect(unmarked.walkers.meanWaitS.unmarked).toBeGreaterThan(zebra.walkers.meanWaitS.zebra);
  });

  test('drivers turning into the arm yield to a walker waiting there (§9(3))', () => {
    expect(unmarked.counts.turning).toBeGreaterThan(0);
    expect(unmarked.walkers.vehicleStops.unmarked).toBeGreaterThan(0);
  });

  test('gate 4 holds at an unmarked crossing: no body over a span a walker is inside', () => {
    expect(unmarked.counts.overlap).toBe('');
    expect(unmarked.walkers.hardStops).toBe(0);
    expect(unmarked.engine.metrics().trips.failed).toBe(0);
  });
});

describe('TASK-279 v2: traffic crawling below walking pace', () => {
  // The east arm at 2 km/h, with more cars than it carries, so queues crawl over the crossing in
  // both directions: the next car always reaches the stripes sooner than the walker needs.
  const crawl = observe(true, true);

  test('a waiting walker holds crawling traffic short of the stripes', () => {
    // Without the hold a creeping queue came to stand on the crossing (0 such stops).
    expect(crawl.counts.straightForWaiting).toBeGreaterThan(5);
  });

  test('a walker steps out in front of crawling traffic that can stop, which then stops', () => {
    // Without the rule: mean wait 12.1 s, 19 stops (walkers waited for the queues to thin).
    expect(crawl.walkers.crossings.unmarked).toBeGreaterThan(10);
    expect(crawl.walkers.meanWaitS.unmarked).toBeLessThan(6);
    expect(crawl.walkers.vehicleStops.unmarked).toBeGreaterThan(25);
    expect(crawl.counts.overlap).toBe('');
    expect(crawl.walkers.hardStops).toBe(0);
  });
});

/** A mapped crossing way midblock on the west street, with OSM's marking (TASK-257). */
function addMapped(city: City, marking: CrossingMarking | undefined, x = -150) {
  const provenance = { source: 'osm' as const };
  const a = { x, y: -9 },
    b = { x, y: 9 };
  city.walk = {
    nodes: {
      'w:1': { id: 'w:1', pos: a, layer: 0, provenance },
      'w:2': { id: 'w:2', pos: b, layer: 0, provenance },
    },
    links: {
      'wl:1': {
        id: 'wl:1',
        from: 'w:1',
        to: 'w:2',
        line: [a, b],
        kind: 'crossing',
        widthM: null,
        provenance,
        ...(marking ? { marking } : {}),
      },
    },
  } as NonNullable<City['walk']>;
}

function mapped(marking: CrossingMarking | undefined) {
  const { city } = tStreet(true);
  addMapped(city, marking);
  // The way is split where it meets the sidewalks; every piece over the road is a crossing.
  const links = setup(city).walk.links.filter((l) => l.id.startsWith('wl:1') && l.crossing);
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((l) => l.crossing!.end === 'midblock')).toBe(true);
  return [...new Set(links.map((l) => l.crossing!.control))].join();
}

test('TASK-279: a mapped crossing is unmarked where OSM says so, a zebra otherwise', () => {
  expect(mapped('none')).toBe('unmarked');
  expect(mapped('zebra')).toBe('zebra');
  expect(mapped(undefined)).toBe('zebra');
});

/** One approaching driver can brake for the crossing but is too near for the walker to
 * step off the kerb yet. Does the waiting walker hold the driver before the crossing? */
function kerbHold(country: City['country'], turn: boolean, mappedX?: number) {
  const { city } = tStreet(true);
  city.country = country;
  if (mappedX !== undefined) addMapped(city, 'none', mappedX);
  const compiled = setup(city);
  const link =
    mappedX !== undefined
      ? compiled.walk.links.find((l) => l.id.startsWith('wl:1') && l.crossing?.spans.length)!
      : eastCrossing(compiled)[0]!;
  expect(link.crossing!.control).toBe('unmarked');
  const span = link.crossing!.spans.find((s) =>
    compiled.lanes[s.lane]!.out.some((i) => compiled.movements[i]!.turn === 'through'),
  )!;
  const lane = compiled.lanes[span.lane]!;
  const movement = lane.out.find((i) =>
    turn
      ? ['left', 'right'].includes(compiled.movements[i]!.turn)
      : compiled.movements[i]!.turn === 'through',
  )!;
  expect(movement).toBeDefined();
  const vehicles = createVehicles(1, compiled.lanes.length, compiled.movements.length);
  const params = DEFAULT_SIM_PARAMS;
  const speed = 6;
  const gap = (speed * speed) / (2 * params.idm.bMps2) + params.idm.minGapM / 2;
  const edge = span.atM - span.halfM;
  vehicles.insert(0, lane.idx, edge - gap);
  vehicles.speed[0] = speed;
  vehicles.movement[0] = movement;
  const walkers = createWalkers(compiled, baseScenario(1), params, vehicles, true)!;
  const walker = walkers.spawn(
    {
      route: {
        links: [link.idx],
        legs: [{ link: link.idx, fromM: 0, toM: link.lengthM }],
        lengthM: link.lengthM,
        costS: 0,
      },
      timeS: 100,
      fromPlaceId: 'p:1',
      toPlaceId: 'p:2',
      personId: 'person',
      tripId: 'trip',
      tripLeg: 'walk',
    },
    () => {},
  );
  walkers.step(100);
  expect(walkers.inspect(walker)?.state).toBe('waiting');
  return { hold: walkers.hold(0, lane, null), edge };
}

test('TASK-372: US straight drivers yield at an unmarked junction crossing but not midblock', () => {
  for (const x of [undefined, -10]) {
    const junction = kerbHold('us', false, x);
    expect(junction.hold).toBe(junction.edge);
  }
  for (const x of [-25, -150]) expect(kerbHold('us', false, x).hold).toBe(Infinity);
});

test('TASK-373: GB and DE use the same rule for straight and turning-out traffic', () => {
  const priority = (country?: string) => [
    kerbHold(country, false).hold,
    kerbHold(country, true).hold,
  ];
  expect(priority('de')).toEqual([Infinity, Infinity]);
  for (const country of ['gb', 'ch', undefined, 'fr'])
    expect(priority(country)).toEqual(priority('de'));
});
