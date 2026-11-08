import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { allocateId, type TripRequest } from '../../src/schema';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { scenario } from './fixtures';

function world(streetParkingShare = 0) {
  const { city, node, road, place } = buildCity('Visible parking', 52);
  const a = node(0, 0),
    b = node(600, 0),
    c = node(600, 200),
    d = node(0, 200);
  const street = road(a, b);
  road(b, c);
  road(c, d);
  road(d, a);
  place('Home', 'residential', { x: 30, y: 10 }, [
    { road: street, direction: 'both', positionM: 30 },
  ]);
  place('Shop', 'retail', { x: 250, y: 10 }, [{ road: street, direction: 'both', positionM: 250 }]);
  const [home, shop] = Object.values(city.places) as [
    import('../../src/schema').Place,
    import('../../src/schema').Place,
  ];
  home.population = 10;
  shop.jobs = 10;
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'roadside',
      name: null,
      capacity: 10,
      access: 'public',
      placeId: null,
      shape: null,
      connectors: [],
      strip: { roadId: street.id, side: 'right', fromM: 200, toM: 255, layout: 'parallel' },
      provenance: { source: 'authored' },
      occupancyAtStart: 0,
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled;
  const trip = (name: string, departS = 100): TripRequest => ({
    id: name,
    personId: name,
    originPlaceId: home.id,
    destinationPlaceId: shop.id,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const load = (trips: TripRequest[]) => {
    const engine = createEngine();
    engine.load({
      compiled,
      trips,
      scenario: { ...scenario(52), simParams: { streetParkingShare } },
    });
    return engine;
  };
  return { city, compiled, id, home, shop, street, trip, load };
}

test('T52 parallel parking holds the curb lane for eight seconds and parks once', () => {
  const w = world();
  expect(w.compiled.parkingSpaces?.length).toBeGreaterThan(0);
  const engine = w.load([w.trip('car')]);
  while (engine.timeS < 300 && engine.inspect(1)?.state !== 'queued_destination') engine.step();
  expect(engine.inspect(1)?.state).toBe('queued_destination');
  const stop = engine.inspect(1)!.positionM;
  engine.step(79);
  expect(engine.inspect(1)?.state).toBe('queued_destination');
  expect(engine.inspect(1)?.positionM).toBe(stop);
  engine.step(2);
  expect(engine.inspect(1)?.state).toBe('completed');
  const slots = engine.snapshot().parkedCars!;
  expect([...slots.id].filter((id) => id === 1)).toHaveLength(1);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.id)?.occupied).toBe(1);
});

test('T52 a following car stops behind a parking manoeuvre, then both occupy distinct slots', () => {
  const w = world();
  const engine = w.load([w.trip('a'), w.trip('b', 101)]);
  let sawQueue = false;
  for (let i = 0; i < 2000; i++) {
    engine.step();
    if (
      engine.inspect(1)?.state === 'queued_destination' &&
      engine.inspect(2)?.state === 'driving'
    ) {
      const leader = engine.inspect(1)!,
        follower = engine.inspect(2)!;
      if (follower.lane === leader.lane && follower.speedMps < 0.5) {
        expect(follower.positionM).toBeLessThanOrEqual(leader.positionM - 6.4);
        sawQueue = true;
      }
    }
  }
  expect(sawQueue).toBe(true);
  expect(engine.metrics().trips.completed).toBe(2);
  expect([...engine.snapshot().parkedCars!.id].filter((id) => id > 0).sort()).toEqual([1, 2]);
});

test('T52 the next trip leaves its occupied slot and holds the lane four seconds', () => {
  const w = world();
  const inbound = w.trip('in');
  const outbound = {
    ...w.trip('out', 250),
    personId: inbound.personId,
    originPlaceId: w.shop.id,
    destinationPlaceId: w.home.id,
  };
  const engine = w.load([inbound, outbound]);
  engine.step(1400);
  expect(engine.inspect(1)?.parkingFacility).toBe(w.id);
  const stock = engine.snapshot().parkedCars!;
  const space = w.compiled.parkingSpaces![stock.id.indexOf(1)]!;
  engine.step(101);
  expect(engine.inspect(2)?.lane).toBe(space.lane);
  expect(engine.inspect(2)?.positionM).toBeCloseTo(space.positionM);
  engine.step(38);
  expect(engine.inspect(2)?.speedMps).toBe(0);
  engine.step(20);
  expect(engine.inspect(2)?.positionM).toBeGreaterThan(space.positionM);
  expect([...engine.snapshot().parkedCars!.id]).not.toContain(1);
});

test('T52 trucks and buses never choose visible spaces; visible stock is deterministic', () => {
  const w = world();
  for (const vehicleClass of ['truck', 'bus'] as const) {
    const engine = w.load([{ ...w.trip(vehicleClass), vehicleClass }]);
    engine.step(2000);
    expect(engine.inspect(1)?.parkingFacility).not.toBe(w.id);
  }
  const trips = [w.trip('one'), w.trip('two', 110)];
  const a = w.load(trips),
    b = w.load(trips);
  a.step(2200);
  b.step(2200);
  expect(a.stateHash()).toBe(b.stateHash());
  expect(a.snapshot().parkedCars).toEqual(b.snapshot().parkedCars);
});
