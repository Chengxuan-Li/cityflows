import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { gatewayDiagnostics } from '../../src/importers/osm/places';
import { compile } from '../../src/network';
import { allocateId, type City, type ParkingFacility, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';

/** A connected loop with homes, offices and one gateway, beside the pieces a crop cuts off. */
function croppedCity() {
  const { city, node, street, place } = buildCity('Cropped gateways', 155);
  const [a, b, c, d] = [node(0, 0), node(300, 0), node(300, 300), node(0, 300)];
  const loop = [street(a, b), street(b, c), street(c, d), street(d, a)];
  place('Homes', 'residential', { x: 150, y: -10 }, [
    { road: loop[0]![0], direction: 'both', positionM: 150 },
  ]);
  place('Offices', 'work', { x: 150, y: 310 }, [
    { road: loop[2]![0], direction: 'both', positionM: 150 },
  ]);
  const [toLoop, fromLoop] = street(node(-300, 150), a);
  place('Connected', 'gateway', { x: -300, y: 150 }, [
    { road: toLoop, direction: 'out' },
    { road: fromLoop, direction: 'in', positionM: 300 },
  ]);
  // A motorway piece that never meets the loop: its two ends see only each other.
  const [east, west] = street(node(800, 0), node(1400, 0));
  place('Cut west', 'gateway', { x: 800, y: 0 }, [
    { road: east, direction: 'out' },
    { road: west, direction: 'in', positionM: 595 },
  ]);
  place('Cut east', 'gateway', { x: 1400, y: 0 }, [
    { road: west, direction: 'out' },
    { road: east, direction: 'in', positionM: 595 },
  ]);
  const [lonely] = street(node(800, 600), node(1000, 600));
  place('Isolated', 'gateway', { x: 800, y: 600 }, [{ road: lonely, direction: 'out' }]);
  const places = Object.fromEntries(Object.values(city.places).map((p) => [p.name, p]));
  places.Homes!.population = 40;
  places.Offices!.jobs = 60;
  for (const name of ['Connected', 'Cut west', 'Cut east', 'Isolated']) {
    places[name]!.population = 20;
    places[name]!.jobs = 20;
  }
  return { city, places };
}

function morning(seed = 155) {
  const scenario = defaultScenario('grid5x5', seed);
  scenario.startS = 6 * 3600;
  scenario.endS = 11 * 3600;
  scenario.demand.throughTripsPerHour[7] = 30;
  return scenario;
}

const ends = (city: City, trips: TripRequest[]) =>
  trips.map(
    (t) => `${city.places[t.originPlaceId]!.name}>${city.places[t.destinationPlaceId]!.name}`,
  );

test('TASK-155 a cut-off gateway component generates no unservable trips and says why', () => {
  const { city, places } = croppedCity();
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const notes = gatewayDiagnostics(result.compiled);
  expect(notes.map((d) => [d.code, d.refs[0], d.message])).toEqual([
    [
      'gateway_unserved',
      places['Cut west']!.id,
      `Gateway ${places['Cut west']!.id} reaches no local place or parking, so it only serves trips with ${places['Cut east']!.id}`,
    ],
    [
      'gateway_unserved',
      places['Cut east']!.id,
      `Gateway ${places['Cut east']!.id} reaches no local place or parking, so it only serves trips with ${places['Cut west']!.id}`,
    ],
    [
      'gateway_unserved',
      places.Isolated!.id,
      `Gateway ${places.Isolated!.id} reaches no local place or parking, so it generates no trips`,
    ],
  ]);

  const scenario = morning();
  const persons = generatePopulation(city, scenario.demand);
  // The unchanged population still assigns cut-off commuters to the loop's offices.
  expect(
    persons.some(
      (p) => p.homePlaceId === places['Cut west']!.id && p.workPlaceId === places.Offices!.id,
    ),
  ).toBe(true);
  const trips = scheduleTrips(city, persons, scenario);
  // The caller's compiled city gives the same trips without compiling again.
  expect(scheduleTrips(city, persons, scenario, result.compiled)).toEqual(trips);
  const legs = ends(city, trips);
  const servable = new Set([
    'Homes>Offices',
    'Offices>Homes',
    'Homes>Connected',
    'Connected>Homes',
    'Connected>Offices',
    'Offices>Connected',
    'Connected>Connected',
    'Cut west>Cut east',
    'Cut east>Cut west',
  ]);
  expect(legs.filter((leg) => !servable.has(leg))).toEqual([]);
  expect(legs).toContain('Cut west>Cut east');
  expect(legs).toContain('Connected>Offices');
  const through = trips.filter((t) => t.id.startsWith('through:'));
  expect(through).toHaveLength(30);
  expect(new Set(ends(city, through))).toEqual(new Set(['Cut west>Cut east', 'Cut east>Cut west']));
  // A commuter whose first leg no car can serve stays home all day.
  const stranded = persons.find(
    (p) => p.homePlaceId === places['Cut west']!.id && p.workPlaceId === places.Offices!.id,
  )!;
  expect(stranded.agenda).toEqual([
    { kind: 'home', placeId: stranded.homePlaceId, startS: 0, durationS: 86400 },
  ]);
  expect(trips.some((t) => t.personId === stranded.id)).toBe(false);

  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips, scenario, population: persons });
  engine.step((scenario.endS - scenario.startS) * 10);
  const { trips: counts, failedByReason, persons: journeys } = engine.metrics();
  expect(counts.failed).toBe(0);
  expect(failedByReason.no_route + failedByReason.no_parking).toBe(0);
  // TASK-113: the trips whose tour walked arrive on foot instead.
  expect(counts.completed + journeys!.walkTripsCompleted).toBe(
    trips.filter((t) => t.departS <= scenario.endS).length,
  );
});

test('TASK-155 a connected gateway keeps exactly the trips it had without the cut-off pieces', () => {
  const { city, places } = croppedCity();
  const scenario = morning();
  scenario.demand.throughTripsPerHour[7] = 0;
  const persons = generatePopulation(city, scenario.demand);
  const loop = new Set([places.Homes!.id, places.Offices!.id, places.Connected!.id]);
  const local = (p: (typeof persons)[number]) =>
    loop.has(p.homePlaceId) && (p.workPlaceId === null || loop.has(p.workPlaceId));
  const kept = scheduleTrips(city, persons, scenario).filter(
    (t) => t.personId !== null && local(persons.find((p) => p.id === t.personId)!),
  );
  // The same persons on the loop alone, where every leg is servable and nothing is filtered.
  const alone = structuredClone(city);
  for (const name of ['Cut west', 'Cut east', 'Isolated']) delete alone.places[places[name]!.id];
  const reference = scheduleTrips(alone, structuredClone(persons.filter(local)), scenario);
  expect(kept.length).toBeGreaterThan(0);
  expect(ends(city, kept)).toContain('Connected>Offices');
  // TASK-129 shares household cars over every member's day, and a member whose work is on a
  // cut-off piece now stays home, so which household car a loop person drives can differ from
  // the reference that leaves those members out. The trips themselves are identical.
  const withoutCar = (trips: typeof kept) => trips.map((trip) => ({ ...trip, carId: undefined }));
  expect(withoutCar(kept)).toEqual(withoutCar(reference));
  for (const trip of kept.filter((t) => t.mode === 'car')) {
    const person = persons.find((p) => p.id === trip.personId)!;
    expect(trip.carId?.startsWith(`car:${person.householdId}:`)).toBe(true);
  }
});

test('TASK-155 a trip that reaches none of its parking fails as no_route, a full one as no_parking', () => {
  const { city, node, street, place } = buildCity('Parking reach', 155);
  const [a, b] = [node(0, 0), node(400, 0)];
  const [ab] = street(a, b);
  place('Offices', 'work', { x: 200, y: 10 }, [{ road: ab, direction: 'both', positionM: 200 }]);
  place('Kiosk', 'other', { x: 50, y: 10 }, [{ road: ab, direction: 'both', positionM: 50 }]);
  const [island] = street(node(0, 500), node(400, 500));
  place('Island', 'other', { x: 50, y: 510 }, [{ road: island, direction: 'both', positionM: 50 }]);
  const [offices, kiosk, islandPlace] = Object.values(city.places);
  offices!.jobs = 2;
  const garage: ParkingFacility = {
    id: allocateId(city, 'pk'),
    kind: 'garage',
    name: 'Office garage',
    capacity: 2,
    access: 'public',
    placeId: offices!.id,
    shape: { kind: 'point', pos: { x: 220, y: 10 } },
    connectors: [
      {
        id: allocateId(city, 'c'),
        roadId: ab.id,
        lane: 0,
        positionM: 220,
        direction: 'both',
        throughputPerMin: 600,
      },
    ],
    provenance: { source: 'authored' },
    occupancyAtStart: 0,
  };
  city.parking = { [garage.id]: garage };
  const trip = (id: string, origin: string): TripRequest => ({
    id,
    personId: null,
    originPlaceId: origin,
    destinationPlaceId: offices!.id,
    departS: 100,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const run = () => {
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const engine = createEngine();
    engine.load({
      compiled: result.compiled,
      trips: [trip('island', islandPlace!.id), trip('kiosk', kiosk!.id)],
      scenario: { ...defaultScenario('grid5x5'), startS: 0, endS: 600 },
    });
    engine.step(2000);
    return engine;
  };
  const open = run();
  expect(open.inspect(1)?.failReason).toBe('no_route');
  expect(open.inspect(2)?.failReason).toBeNull();
  garage.capacity = 0;
  const full = run();
  expect(full.inspect(1)?.failReason).toBe('no_route');
  expect(full.inspect(2)?.failReason).toBe('no_parking');
});

test('TASK-283 a gateway in a pocket behind a destination street gets only the trips a car can drive', () => {
  // A loop of public streets with homes and offices; east of it Lane, a destination street, leads
  // to a pocket of public streets with a public car park and a gateway (Lübeck's Wallstraße).
  // Lane homes live on Lane; Split homes own a small garage on Lane and a block garage on the
  // loop (Cambridge's block whose 4-space garage reaches the north-east and 1,692-space one
  // does not).
  const { city, node, street, place } = buildCity('Pocket gateway', 283);
  const [a, b, c, d] = [node(0, 0), node(300, 0), node(300, 300), node(0, 300)];
  const loop = [street(a, b), street(b, c), street(c, d), street(d, a)];
  const [e, f, g, h] = [node(600, 0), node(900, 0), node(900, 300), node(600, 300)];
  const pocket = [street(e, f), street(f, g), street(g, h), street(h, e)];
  const lane = street(b, e);
  for (const road of lane) road.access = { all: 'destination' };
  place('Homes', 'residential', { x: 150, y: -10 }, [
    { road: loop[0]![0], direction: 'both', positionM: 150 },
  ]);
  place('Offices', 'work', { x: 150, y: 310 }, [
    { road: loop[2]![0], direction: 'both', positionM: 150 },
  ]);
  place('Lane homes', 'residential', { x: 450, y: -10 }, [
    { road: lane[0], direction: 'both', positionM: 100 },
    { road: lane[1], direction: 'both', positionM: 200 },
  ]);
  place('Split homes', 'residential', { x: -10, y: 150 }, [
    { road: loop[3]![0], direction: 'both', positionM: 150 },
  ]);
  const [toPocket, fromPocket] = street(node(1200, 0), f);
  place('Pocket gateway', 'gateway', { x: 1200, y: 0 }, [
    { road: toPocket, direction: 'out' },
    { road: fromPocket, direction: 'in', positionM: 280 },
  ]);
  const places = Object.fromEntries(Object.values(city.places).map((p) => [p.name, p]));
  for (const name of ['Homes', 'Lane homes', 'Split homes']) places[name]!.population = 40;
  places['Split homes']!.provenance = {
    source: 'osm',
    osmIds: [1, 2],
    inferred: ['blockAggregation'],
  };
  places.Offices!.jobs = 60;
  places['Pocket gateway']!.population = 20;
  places['Pocket gateway']!.jobs = 60;
  const garage = (
    name: string,
    placeId: string | null,
    road: string,
    access: 'public' | 'private',
    capacity: number,
  ) => {
    const id = allocateId(city, 'pk');
    city.parking![id] = {
      id,
      kind: 'garage',
      name,
      capacity,
      access,
      placeId,
      shape: { kind: 'point', pos: { x: 0, y: 0 } },
      connectors: [
        {
          id: allocateId(city, 'c'),
          roadId: road,
          lane: 0,
          positionM: 250,
          direction: 'both',
          throughputPerMin: 30,
        },
      ],
      provenance: { source: 'authored' },
      occupancyAtStart: 0,
    } satisfies ParkingFacility;
  };
  city.parking = {};
  garage('Pocket car park', null, pocket[0]![0].id, 'public', 200);
  garage('Split garage', places['Split homes']!.id, lane[0].id, 'private', 2);
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

  const scenario = morning(283);
  scenario.demand.throughTripsPerHour[7] = 0;
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario, result.compiled);
  const legs = ends(city, trips);
  const servable = new Set([
    ...['Homes', 'Lane homes', 'Split homes'].flatMap((home) => [
      `${home}>Offices`,
      `Offices>${home}`,
    ]),
    'Lane homes>Pocket gateway',
    'Pocket gateway>Lane homes',
    'Pocket gateway>Pocket gateway',
    // A commuter's car from the gateway parks where it can and leaves from there: the car park.
    'Pocket gateway>Offices',
    'Offices>Pocket gateway',
  ]);
  expect(legs.filter((leg) => !servable.has(leg))).toEqual([]);
  expect(legs).toContain('Lane homes>Pocket gateway');
  // The residents whose car cannot leave home for the pocket stay home.
  for (const home of ['Homes', 'Split homes']) {
    const kept = persons.filter(
      (p) => p.homePlaceId === places[home]!.id && p.workPlaceId === places['Pocket gateway']!.id,
    );
    expect(kept.length).toBeGreaterThan(0);
    for (const person of kept) expect(person.agenda).toHaveLength(1);
  }

  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips, scenario, population: persons });
  engine.step((scenario.endS - scenario.startS) * 10);
  const { failedByReason } = engine.metrics();
  expect(failedByReason.no_route + failedByReason.no_parking).toBe(0);
});

test('TASK-288 a person drawn to a gateway their car cannot reach works at one it can', () => {
  // A loop of public streets with homes, offices and a gateway; east of it Lane, a destination
  // street, leads to a pocket with a public car park and a second gateway (TASK-283's pocket).
  // Loop homes reach only the loop gateway, Lane homes both; a cut-off gateway reaches nothing.
  const { city, node, street, place } = buildCity('Reachable gateways', 288);
  const [a, b, c, d] = [node(0, 0), node(300, 0), node(300, 300), node(0, 300)];
  const loop = [street(a, b), street(b, c), street(c, d), street(d, a)];
  const [e, f] = [node(600, 0), node(900, 0)];
  const [pocket] = street(e, f);
  const lane = street(b, e);
  for (const road of lane) road.access = { all: 'destination' };
  place('Homes', 'residential', { x: 150, y: -10 }, [
    { road: loop[0]![0], direction: 'both', positionM: 150 },
  ]);
  place('Offices', 'work', { x: 150, y: 310 }, [
    { road: loop[2]![0], direction: 'both', positionM: 150 },
  ]);
  place('Lane homes', 'residential', { x: 450, y: -10 }, [
    { road: lane[0], direction: 'both', positionM: 100 },
    { road: lane[1], direction: 'both', positionM: 200 },
  ]);
  const [toPocket, fromPocket] = street(node(1200, 0), f);
  place('Pocket gateway', 'gateway', { x: 1200, y: 0 }, [
    { road: toPocket, direction: 'out' },
    { road: fromPocket, direction: 'in', positionM: 280 },
  ]);
  const [toLoop, fromLoop] = street(node(-300, 150), a);
  place('Loop gateway', 'gateway', { x: -300, y: 150 }, [
    { road: toLoop, direction: 'out' },
    { road: fromLoop, direction: 'in', positionM: 300 },
  ]);
  const [lonely] = street(node(0, 900), node(300, 900));
  place('Isolated', 'gateway', { x: 0, y: 900 }, [{ road: lonely, direction: 'in' }]);
  const places = Object.fromEntries(Object.values(city.places).map((p) => [p.name, p]));
  places.Homes!.population = 80;
  places['Lane homes']!.population = 80;
  places.Offices!.jobs = 40;
  // The pocket gateway draws most out-commuters by its jobs and nearness.
  places['Pocket gateway']!.jobs = 200;
  places['Loop gateway']!.jobs = 20;
  places.Isolated!.jobs = 100;
  const parkId = allocateId(city, 'pk');
  city.parking = {
    [parkId]: {
      id: parkId,
      kind: 'garage',
      name: 'Pocket car park',
      capacity: 200,
      access: 'public',
      placeId: null,
      shape: { kind: 'point', pos: { x: 750, y: 10 } },
      connectors: [
        {
          id: allocateId(city, 'c'),
          roadId: pocket.id,
          lane: 0,
          positionM: 150,
          direction: 'both',
          throughputPerMin: 30,
        },
      ],
      provenance: { source: 'authored' },
      occupancyAtStart: 0,
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

  const scenario = morning(288);
  scenario.demand.throughTripsPerHour[7] = 0;
  scenario.demand.gravityScaleM = 100_000;
  const persons = generatePopulation(city, scenario.demand);
  const from = (home: string) => persons.filter((p) => p.homePlaceId === places[home]!.id);
  const works = (home: string) => {
    const counts: Record<string, number> = {};
    for (const p of from(home)) {
      const name = p.workPlaceId ? city.places[p.workPlaceId]!.name : '-';
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
  };
  // Loop homes draw only the loop gateway, as often as they drew any gateway: the pocket
  // gateway's commuters move there, and the cut-off one's.
  const loopHomes = works('Homes');
  expect(loopHomes['Pocket gateway']).toBeUndefined();
  expect(loopHomes.Isolated).toBeUndefined();
  expect(loopHomes['Loop gateway']).toBeGreaterThan(from('Homes').length / 2);
  // Lane homes reach the pocket too; the cut-off gateway is redrawn among the two.
  const laneHomes = works('Lane homes');
  expect(laneHomes['Pocket gateway']).toBeGreaterThan(0);
  expect(laneHomes.Isolated).toBeUndefined();

  const trips = scheduleTrips(city, persons, scenario, result.compiled);
  for (const person of persons.filter((p) => p.workPlaceId !== null))
    expect(person.agenda.length).toBeGreaterThan(1);
  expect(ends(city, trips)).toContain('Homes>Loop gateway');
  expect(ends(city, trips)).toContain('Lane homes>Pocket gateway');

  const engine = createEngine();
  engine.load({ compiled: result.compiled, trips, scenario, population: persons });
  engine.step((scenario.endS - scenario.startS) * 10);
  const { failedByReason } = engine.metrics();
  expect(failedByReason.no_route + failedByReason.no_parking).toBe(0);
});
