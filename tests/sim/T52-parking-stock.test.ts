import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { allocateId, vehicleClasses, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { createParking } from '../../src/sim/parking';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles } from '../../src/sim/vehicle';
import { scenario } from './fixtures';

function stockWorld(kind: 'roadside' | 'lot' = 'roadside', driveway = false, residents = 2) {
  const { city, node, road, place } = buildCity('Parking stock', 520);
  const a = node(0, 0),
    b = node(300, 0),
    c = node(300, 100),
    d = node(0, 100);
  const street = road(a, b);
  road(b, c);
  road(c, d);
  road(d, a);
  place('Home', 'residential', { x: 20, y: 12 }, [
    { road: street, positionM: 20, direction: 'both' },
  ]);
  place('Shop', 'retail', { x: 230, y: 12 }, [{ road: street, positionM: 230, direction: 'both' }]);
  const home = Object.values(city.places)[0]!,
    shop = Object.values(city.places)[1]!;
  home.population = residents;
  shop.jobs = 2;
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind,
      name: null,
      capacity: kind === 'roadside' ? 3 : 0,
      access: 'public',
      placeId: null,
      connectors: driveway
        ? [
            {
              id: allocateId(city, 'c'),
              roadId: street.id,
              lane: 0,
              positionM: 150,
              direction: 'both',
              throughputPerMin: 600,
            },
          ]
        : [],
      shape:
        kind === 'lot'
          ? {
              kind: 'polygon',
              ring: [
                { x: 80, y: -16 },
                { x: 260, y: -16 },
                { x: 260, y: 16 },
                { x: 80, y: 16 },
              ],
            }
          : null,
      ...(kind === 'lot' && !driveway ? { aisles: [street.id] } : {}),
      ...(kind === 'roadside'
        ? {
            strip: {
              roadId: street.id,
              side: 'right',
              fromM: 50,
              toM: 66.5,
              layout: 'parallel',
            } as const,
          }
        : {}),
      provenance: driveway
        ? { source: 'authored', inferred: ['driveway'] }
        : { source: 'authored' },
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled;
  const facility = compiled.parking[compiled.index.parking.get(id)!]!;
  const trip = (
    id: string,
    vehicleClass: TripRequest['vehicleClass'] = 'car',
    departS = 100,
  ): TripRequest => ({
    id,
    personId: id,
    originPlaceId: home.id,
    destinationPlaceId: shop.id,
    vehicleClass,
    departS,
    mode: 'car',
    purpose: 'private',
    legs: [],
  });
  const load = (requests: TripRequest[], streetParkingShare: number, seed = 520) => {
    const vehicles = createVehicles(
      requests.length,
      compiled.lanes.length,
      compiled.movements.length,
    );
    requests.forEach((trip, id) => {
      vehicles.vclass[id] = vehicleClasses.indexOf(trip.vehicleClass);
    });
    return createParking(
      compiled,
      requests,
      scenario(seed),
      { ...DEFAULT_SIM_PARAMS, streetParkingShare },
      vehicles,
    );
  };
  return { city, compiled, facility, home, shop, street, trip, load };
}

function occupiedSpaces(occupied: Uint8Array, count: number) {
  return Array.from({ length: count }, (_, i) => i).filter(
    (i) => occupied[i >> 3]! & (1 << (i & 7)),
  );
}

test('T52 street share zero keeps resident stock in garages; share one reserves distinct slots', () => {
  const w = stockWorld();
  const requests = [w.trip('first'), w.trip('second', 'van'), w.trip('excess')];
  const garages = w.compiled.parking.filter(
    (f) => f.place === w.compiled.index.place.get(w.home.id),
  );
  expect(garages).toHaveLength(1);
  const garage = garages[0]!;
  const off = w.load(requests, 0);
  expect(off.snapshot()[garage.idx]).toBe(2);
  expect(off.snapshot()[w.facility.idx]).toBe(0);
  expect(occupiedSpaces(off.stockSnapshot().occupied, 3)).toEqual([]);
  const on = w.load(requests, 1);
  expect(on.snapshot()[garage.idx]).toBe(0);
  expect(on.snapshot()[w.facility.idx]).toBe(2);
  expect(occupiedSpaces(on.stockSnapshot().occupied, 3)).toEqual([0, 1]);
  const first = on.exits(0, []),
    second = on.exits(1, []);
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1);
  expect(first[0]).not.toBe(second[0]);
  expect(on.noOriginCar(2)).toBe(true);
  expect([...on.stockSnapshot().vclass]).toEqual([0, 1, 0]);
  on.depart(0, 100);
  expect(occupiedSpaces(on.stockSnapshot().occupied, 3)).toEqual([1]);
  expect(on.snapshot()[w.facility.idx]).toBe(1);
  expect(on.exits(1, [])).toEqual(second);
  on.depart(1, 100);
  expect(occupiedSpaces(on.stockSnapshot().occupied, 3)).toEqual([]);
  expect(on.snapshot()[w.facility.idx]).toBe(0);
});

test('T52 cars and vans choose visible parking while trucks and buses choose the own garage', () => {
  const w = stockWorld();
  const requests = vehicleClasses.map((kind) => w.trip(kind, kind));
  const parking = w.load(requests, 0);
  const own = w.compiled.parking.find((f) => f.place === w.compiled.index.place.get(w.shop.id))!;
  for (const [id, kind] of vehicleClasses.entries()) {
    expect(parking.choose(id, 100, () => true)).toBe(true);
    expect(parking.detail(id, 100).parkingFacility).toBe(
      kind === 'truck' || kind === 'bus' ? own.id : w.facility.id,
    );
    for (const connector of w.facility.connectorsIn)
      expect(parking.admits(id, connector)).toBe(kind === 'car' || kind === 'van');
  }
});

test('T52 simultaneous lot arrivals reserve the nearest remaining stall to their entry', () => {
  const w = stockWorld('lot');
  expect(w.facility.spaces!.length).toBeGreaterThan(2);
  const parking = w.load([w.trip('first'), w.trip('second')], 0);
  const connector = w.facility.connectorsIn[0]!;
  const entry = w.compiled.connectors[connector]!;
  const lane = w.compiled.lanes[entry.lane]!;
  // The fixture's straight aisle lies at y=0 and has no lateral offset.
  const distance = (space: number) => {
    const p = w.compiled.parkingSpaces![space]!.position;
    return Math.hypot(p.x - (lane.polyline[0]!.x + entry.positionM), p.y);
  };
  const nearest = [...w.facility.spaces!].sort((a, b) => distance(a) - distance(b));
  expect(parking.holdArrival(0, connector, 100)).toBe(false);
  expect(parking.holdArrival(1, connector, 100)).toBe(false);
  expect(parking.holdArrival(0, connector, 104)).toBe(true);
  expect(parking.holdArrival(1, connector, 104)).toBe(true);
  parking.arrive(0, connector, 104);
  parking.arrive(1, connector, 104);
  const stock = parking.stockSnapshot();
  expect(stock.id[nearest[0]!]).toBe(1);
  expect(stock.id[nearest[1]!]).toBe(2);
  expect(occupiedSpaces(stock.occupied, stock.id.length)).toHaveLength(2);
  expect(parking.snapshot()[w.facility.idx]).toBe(2);
});

test('T52 an unchanged inferred-driveway lot patch preserves individual occupied stalls', () => {
  const w = stockWorld('lot', true);
  const parking = w.load([w.trip('first'), w.trip('second')], 0);
  const connector = w.facility.connectorsIn[0]!;
  parking.arrive(0, connector, 100);
  parking.arrive(1, connector, 100);
  const before = parking.stockSnapshot();
  const next = compile({ ...w.city, version: w.city.version + 1 });
  if (!next.ok) throw new Error(JSON.stringify(next.diagnostics));
  parking.patch(next.compiled);
  const after = parking.stockSnapshot();
  expect(after.occupied).toEqual(before.occupied);
  expect(after.id).toEqual(before.id);
  expect(after.vclass).toEqual(before.vclass);
  expect(parking.snapshot()[w.facility.idx]).toBe(2);
});

test('T52 removing occupied visible parking requires restart and leaves the run untouched', () => {
  const w = stockWorld();
  const engine = createEngine();
  engine.load({
    compiled: w.compiled,
    trips: [],
    scenario: {
      ...scenario(520),
      simParams: { streetParkingShare: 1 },
    },
  });
  const before = engine.snapshot().parkedCars!;
  const hash = engine.stateHash();
  expect(occupiedSpaces(before.occupied, before.id.length)).toHaveLength(2);
  const next = compile({ ...w.city, parking: {}, version: w.city.version + 1 });
  if (!next.ok) throw new Error(JSON.stringify(next.diagnostics));
  expect(() => engine.patch(next.compiled)).toThrow(/occupied.*restart|restart.*occupied/i);
  expect(engine.snapshot().parkedCars).toEqual(before);
  expect(engine.stateHash()).toBe(hash);
  expect(engine.metrics().parking.facilities.find((f) => f.id === w.facility.id)?.occupied).toBe(2);
});

test('T52 a fast approaching follower blocks a slot departure despite a stationary spawn gap', () => {
  const w = stockWorld();
  const slot = w.compiled.parkingSpaces![w.facility.spaces![0]!]!;
  const gateway = (name: string, positionM: number) => {
    const id = allocateId(w.city, 'p');
    w.city.places[id] = {
      ...w.home,
      id,
      name,
      kind: 'gateway',
      population: 0,
      jobs: 0,
      connectors: [
        {
          id: allocateId(w.city, 'c'),
          roadId: w.street.id,
          lane: 0,
          positionM,
          direction: 'both',
          throughputPerMin: 600,
        },
      ],
    };
    return id;
  };
  const entrance = gateway('Through entrance', slot.positionM - 35);
  const exit = gateway('Through exit', 270);
  const result = compile(w.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const follower: TripRequest = {
    ...w.trip('follower'),
    originPlaceId: entrance,
    destinationPlaceId: exit,
  };
  const parked = w.trip('parked', 'car', 105);
  const engine = createEngine();
  engine.load({
    compiled: result.compiled,
    trips: [follower, parked],
    scenario: {
      ...scenario(520),
      simParams: { streetParkingShare: 1, idm: { ...DEFAULT_SIM_PARAMS.idm, desiredSpeedSd: 0 } },
    },
  });
  engine.step(50);
  const approaching = engine.inspect(1)!;
  expect(approaching.state).toBe('driving');
  expect(approaching.speedMps).toBeGreaterThan(5);
  expect(slot.positionM - approaching.positionM).toBeGreaterThan(12.5);
  engine.step();
  expect(engine.inspect(2)?.state).toBe('queued_origin');
  expect(engine.inspect(2)?.departedS).toBeNull();
  const stock = engine.snapshot().parkedCars!;
  expect(occupiedSpaces(stock.occupied, stock.id.length)).toHaveLength(2);
  for (let i = 0; i < 200 && engine.inspect(2)?.departedS === null; i++) engine.step();
  expect(engine.inspect(2)?.departedS).toBeGreaterThan(105);
  expect(engine.inspect(2)?.lane).toBe(slot.lane);
});

test('T52 an unreachable destination from a parked street origin counts a parking failure without losing stock', () => {
  const { city, node, road, place } = buildCity('Disconnected parked departure', 521);
  const homeRoad = road(node(0, 0), node(150, 0));
  const destinationRoad = road(node(300, 0), node(450, 0));
  place('Home', 'residential', { x: 20, y: 12 }, [
    { road: homeRoad, positionM: 20, direction: 'both' },
  ]);
  place('Exit', 'gateway', { x: 420, y: 12 }, [
    { road: destinationRoad, positionM: 100, direction: 'in' },
  ]);
  const [home, exit] = Object.values(city.places);
  home!.population = 1;
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'roadside',
      name: null,
      capacity: 1,
      access: 'public',
      placeId: null,
      connectors: [],
      shape: null,
      provenance: { source: 'authored' },
      strip: { roadId: homeRoad.id, side: 'right', fromM: 50, toM: 55.5, layout: 'parallel' },
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const request: TripRequest = {
    id: 'unreachable',
    personId: 'resident',
    originPlaceId: home!.id,
    destinationPlaceId: exit!.id,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    departS: 100,
    legs: [],
  };
  const engine = createEngine();
  engine.load({
    compiled: result.compiled,
    trips: [request],
    scenario: { ...scenario(521), simParams: { streetParkingShare: 1 } },
  });
  const before = engine.snapshot().parkedCars!;
  expect(occupiedSpaces(before.occupied, before.id.length)).toHaveLength(1);
  engine.step(10);
  expect(engine.metrics().failedByReason.no_parking).toBe(1);
  expect(engine.metrics().failedByReason.no_route).toBe(0);
  expect(engine.metrics().trips.failed).toBe(1);
  expect(engine.snapshot().parkedCars).toEqual(before);
  expect(engine.metrics().parking.facilities.find((f) => f.id === id)?.occupied).toBe(1);
});

test.each([1, 2, 3, 4, 5, 52, 520])(
  'T52 all ten resident car owners find their counted initial stock with seed %i',
  (seed) => {
    const w = stockWorld('roadside', false, 10);
    const requests = Array.from({ length: 10 }, (_, i) => w.trip(`resident:${i}`));
    const parking = w.load(requests, 0.3, seed);
    expect(parking.snapshot()[w.facility.idx]).toBe(3);
    let streetDepartures = 0;
    for (let id = 0; id < requests.length; id++) {
      expect(parking.noOriginCar(id)).toBe(false);
      const exits = parking.exits(id, []);
      expect(exits).toHaveLength(1);
      if (w.compiled.connectors[exits[0]!]!.parking === w.facility.idx) streetDepartures++;
    }
    expect(streetDepartures).toBe(3);
    for (let id = 0; id < requests.length; id++) parking.depart(id, 100);
    expect([...parking.snapshot()].reduce((sum, count) => sum + count, 0)).toBe(0);
    const stock = parking.stockSnapshot();
    expect(occupiedSpaces(stock.occupied, stock.id.length)).toEqual([]);
  },
);

test.each([0, 1])(
  'T52 owned residential lot supplies initial resident cars beside %i hard garage slots',
  (garageCapacity) => {
    const residents = garageCapacity ? 3 : 2;
    const w = stockWorld('lot', false, residents);
    w.city.parking![w.facility.id]!.placeId = w.home.id;
    let garageId: string | undefined;
    if (garageCapacity) {
      garageId = allocateId(w.city, 'pk');
      w.city.parking![garageId] = {
        id: garageId,
        kind: 'garage',
        name: 'Home garage',
        access: 'private',
        placeId: w.home.id,
        capacity: garageCapacity,
        shape: w.home.shape,
        connectors: w.home.connectors.map((connector) => ({
          ...connector,
          id: allocateId(w.city, 'c'),
        })),
        provenance: { source: 'authored' },
      };
    }
    const result = compile(w.city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const compiled = result.compiled;
    const homeFacilities = compiled.parking.filter(
      (f) => f.place === compiled.index.place.get(w.home.id),
    );
    expect(homeFacilities.filter((f) => f.kind === 'garage')).toHaveLength(garageCapacity ? 1 : 0);
    expect(
      homeFacilities.some((f) => f.source.provenance.inferred?.includes('implicitGarage')),
    ).toBe(false);
    const requests = Array.from({ length: residents }, (_, i) => w.trip(`lot-resident:${i}`));
    const vehicles = createVehicles(
      requests.length,
      compiled.lanes.length,
      compiled.movements.length,
    );
    const parking = createParking(
      compiled,
      requests,
      scenario(520),
      { ...DEFAULT_SIM_PARAMS, streetParkingShare: 0 },
      vehicles,
    );
    const lot = compiled.parking[compiled.index.parking.get(w.facility.id)!]!;
    expect(parking.snapshot()[lot.idx]).toBe(2);
    if (garageId) expect(parking.snapshot()[compiled.index.parking.get(garageId)!]).toBe(1);
    expect(homeFacilities.reduce((sum, f) => sum + parking.snapshot()[f.idx]!, 0)).toBe(residents);
    const stock = parking.stockSnapshot();
    expect(occupiedSpaces(stock.occupied, stock.id.length)).toHaveLength(2);
    const lotExits: number[] = [];
    for (let id = 0; id < requests.length; id++) {
      expect(parking.noOriginCar(id)).toBe(false);
      const exits = parking.exits(id, []);
      expect(exits).toHaveLength(1);
      if (compiled.connectors[exits[0]!]!.parking === lot.idx) lotExits.push(exits[0]!);
    }
    expect(lotExits).toHaveLength(2);
    expect(new Set(lotExits).size).toBe(2);
    for (let id = 0; id < requests.length; id++) parking.depart(id, 100);
    expect(homeFacilities.reduce((sum, f) => sum + parking.snapshot()[f.idx]!, 0)).toBe(0);
    expect(occupiedSpaces(parking.stockSnapshot().occupied, stock.id.length)).toEqual([]);
  },
);
