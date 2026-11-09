import { expect, test } from 'vitest';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createWalkRouter } from '../../src/routing/walk';
import { parkingWorld } from '../parking-world';
import { setup } from './fixtures';

function world() {
  const w = parkingWorld();
  const id = allocateId(w.city, 'pk');
  w.city.parking![id] = {
    id,
    kind: 'roadside',
    name: 'Home strip',
    capacity: 6,
    access: 'public',
    placeId: null,
    connectors: [],
    shape: null,
    strip: { roadId: w.street.id, side: 'right', fromM: 35, toM: 80, layout: 'parallel' },
    provenance: { source: 'authored' },
  };
  w.scenario.simParams.streetParkingShare = 1;
  const compiled = setup(w.city);
  return { ...w, compiled, stripId: id };
}

test('T57 a person walks to a strip car, drives to a lot, then reaches the door before returning', () => {
  const w = world();
  const outbound = w.trip('owner');
  const requests = [
    outbound,
    {
      ...outbound,
      id: 'return',
      originPlaceId: w.shop.id,
      destinationPlaceId: w.home.id,
      departS: 101,
    },
  ];
  const engine = createEngine();
  engine.load({ compiled: w.compiled, trips: requests, scenario: w.scenario });
  engine.step();
  let person = engine.inspectPerson('owner')!;
  expect(person.car.facility).toBe(w.stripId);
  expect(person.currentLeg?.kind).toBe('access');
  expect(engine.inspect(1)?.departedS ?? null).toBeNull();
  expect(engine.snapshot().walkers!.count).toBe(1);
  let accessArrival = 0;
  let egressSeen = false;
  while (engine.timeS < 700 && engine.metrics().persons!.completed < 1) {
    engine.step();
    person = engine.inspectPerson('owner')!;
    accessArrival = person.trips[0]!.legs.find((l) => l.kind === 'access')!.arrivedS ?? 0;
    if (person.currentLeg?.kind === 'egress') {
      egressSeen = true;
      expect(engine.metrics().trips.completed).toBe(1);
      expect(engine.metrics().persons!.completed).toBe(0);
      expect(engine.inspect(2)?.departedS ?? null).toBeNull();
      expect(person.car.facility).toBe(w.id);
    }
  }
  expect(egressSeen).toBe(true);
  expect(engine.inspect(1)!.departedS!).toBeGreaterThanOrEqual(accessArrival);
  const first = person.trips[0]!;
  expect(first.state).toBe('completed');
  expect(first.legs.map((l) => l.kind)).toEqual(['access', 'drive', 'egress']);
  const arrival = first.legs.at(-1)!.arrivedS!;
  engine.step(5000);
  person = engine.inspectPerson('owner')!;
  expect(person.trips[1]!.legs[0]!.startedS!).toBeGreaterThanOrEqual(arrival);
  expect(engine.metrics().persons!.completed).toBe(2);
});

test('T57 garage access ends at its connector anchor and gateways have no walk at that end', () => {
  const w = parkingWorld();
  const compiled = setup(w.city),
    engine = createEngine();
  engine.load({ compiled, trips: [w.trip('garage')], scenario: w.scenario });
  engine.step();
  const person = engine.inspectPerson('garage')!;
  const walker = engine.inspectWalker(person.currentLeg!.walkerId!)!;
  const garage = compiled.parking.find((f) => f.id === person.car.facility)!;
  expect(garage.kind).toBe('garage');
  const anchors = compiled.walk.connectors.get(compiled.connectors[garage.connectorsOut[0]!]!.id)!;
  const end = compiled.walk.links[walker.route!.links.at(-1)!]!;
  expect([end.from, end.to]).toContain(anchors);
  w.home.kind = 'gateway';
  const gateway = createEngine();
  const outbound = w.trip('gateway');
  gateway.load({
    compiled: setup(w.city),
    trips: [
      outbound,
      {
        ...outbound,
        id: 'gateway-return',
        originPlaceId: w.shop.id,
        destinationPlaceId: w.home.id,
        departS: 102,
      },
    ],
    scenario: w.scenario,
  });
  gateway.step(12000);
  expect(gateway.inspectPerson('gateway')!.trips[0]!.legs.map((l) => l.kind)).toEqual([
    'drive',
    'egress',
  ]);
  expect(gateway.inspectPerson('gateway')!.trips[1]!.legs.map((l) => l.kind)).toEqual([
    'access',
    'drive',
  ]);
});

test('T57 a whole walk completes without a car, and a missing walk route fails explicitly', () => {
  const w = world(),
    engine = createEngine();
  const request: TripRequest = { ...w.trip('walker'), mode: 'walk' };
  engine.load({ compiled: w.compiled, trips: [request], scenario: w.scenario });
  engine.step(4000);
  expect(engine.metrics().persons!.walkTripsCompleted).toBe(1);
  expect(engine.metrics().trips.completed).toBe(0);
  expect(engine.snapshot().count).toBe(0);
  expect(engine.inspectPerson('walker')!.trips[0]!.legs[0]!.kind).toBe('walk');
  const broken = { ...w.compiled, walk: { ...w.compiled.walk, places: new Map() } };
  engine.load({ compiled: broken, trips: [request], scenario: w.scenario });
  engine.step();
  expect(engine.metrics().persons!.walkTripsFailed).toBe(1);
  expect(engine.metrics().failedByReason.no_walk_route).toBe(1);
  expect(engine.inspectPerson('walker')!.trips[0]!.failReason).toBe('no_walk_route');
});

test('T57 a walk gap falls back at walk speed and preserves a deterministic person trip', () => {
  const w = world();
  const compiled = { ...w.compiled, walk: { ...w.compiled.walk, places: new Map() } };
  const engines = [createEngine(), createEngine()];
  for (const engine of engines)
    engine.load({ compiled, trips: [w.trip('gap')], scenario: w.scenario });
  for (let i = 0; i < 7000; i++) {
    for (const engine of engines) engine.step();
    expect(engines[0]!.stateHash()).toBe(engines[1]!.stateHash());
  }
  const metrics = engines[0]!.metrics();
  expect(metrics.persons!.completed).toBe(1);
  expect(metrics.persons!.walkFallbacks).toBe(2);
  expect(metrics.persons!.fallbacks[0]!.facilityId).toBe(w.stripId);
  expect(metrics.persons!.access.meanTimeS).toBeGreaterThan(1);
});

test.each(['delivery', 'through'] as const)(
  'T57 %s vehicles have no occupant or walk legs',
  (purpose) => {
    const w = world(),
      engine = createEngine();
    engine.load({
      compiled: w.compiled,
      scenario: w.scenario,
      trips: [
        { ...w.trip('goods'), purpose, vehicleClass: purpose === 'delivery' ? 'van' : 'car' },
      ],
    });
    engine.step(2000);
    expect(engine.inspect(1)!.personId).toBeNull();
    expect(engine.inspectPerson('goods')).toBeNull();
    expect(engine.snapshot().walkers).toBeUndefined();
  },
);

test('T57 a driving failure ends the person journey and strands the next trip without egress', () => {
  const w = world(),
    engine = createEngine();
  const outbound = w.trip('failure');
  engine.load({
    compiled: w.compiled,
    scenario: w.scenario,
    trips: [
      outbound,
      {
        ...outbound,
        id: 'return',
        originPlaceId: w.shop.id,
        destinationPlaceId: w.home.id,
        departS: 101,
      },
    ],
    routeProvider: { route: () => ({ ok: false, reason: 'no_path' }) },
  });
  engine.step(4000);
  const person = engine.inspectPerson('failure')!;
  expect(person.trips.map((t) => t.state)).toEqual(['failed', 'failed']);
  expect(person.trips[0]!.legs.map((l) => l.kind)).toEqual(['access']);
  expect(person.trips[1]!.failReason).toBe('stranded');
  expect(engine.metrics().persons!.egress.count).toBe(0);
});

test('T57 repeated building-to-garage walks reuse one cached route', () => {
  const w = parkingWorld(),
    compiled = setup(w.city),
    router = createWalkRouter(compiled.walk);
  let requests = 0;
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: w.scenario,
    trips: [w.trip('one'), w.trip('two')],
    walkRouter: {
      route(request) {
        requests++;
        return router.route(request);
      },
    },
  });
  engine.step();
  expect(engine.metrics().persons!.started).toBe(2);
  expect(requests).toBe(1);
  expect(engine.snapshot().walkers!.count).toBe(2);
});

test('T57 a future trip stays failed when its person is stranded before departure', () => {
  const w = world(),
    engine = createEngine(),
    outbound = w.trip('stranded');
  engine.load({
    compiled: w.compiled,
    scenario: w.scenario,
    trips: [
      outbound,
      {
        ...outbound,
        id: 'later',
        originPlaceId: w.shop.id,
        destinationPlaceId: w.home.id,
        departS: 500,
      },
    ],
    routeProvider: { route: () => ({ ok: false, reason: 'no_path' }) },
  });
  engine.step(6000);
  expect(engine.metrics().trips.failed).toBe(2);
  expect(engine.metrics().trips.queuedOrigin).toBe(0);
  expect(engine.inspectPerson('stranded')!.trips[1]!.state).toBe('failed');
});
