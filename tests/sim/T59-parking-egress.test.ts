import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile, type CompiledCity } from '../../src/network';
import { allocateId, vehicleClasses, type City, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createParking } from '../../src/sim/parking';
import { createVehicles } from '../../src/sim/vehicle';
import { parkingWorld } from '../parking-world';

function world(connected = false) {
  const builder = buildCity('Parking egress', 122);
  const { city, node, road, place } = builder;
  const a = node(0, 0),
    b = node(400, 0),
    c = node(400, 200),
    d = node(0, 200);
  const street = road(a, b);
  road(b, c);
  road(c, d);
  road(d, a);
  const boundary = node(0, -180),
    sink = road(a, boundary);
  place('Home', 'residential', { x: 20, y: -30 }, [
    { road: street, positionM: 30, direction: 'both' },
  ]);
  place('Shop', 'retail', { x: 20, y: -80 }, [{ road: street, positionM: 150, direction: 'both' }]);
  place('Gateway', 'gateway', boundary.pos, [{ road: sink, positionM: 140, direction: 'in' }]);
  const [home, shop] = Object.values(city.places);
  home!.population = 20;
  shop!.jobs = 20;
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'roadside',
      name: null,
      capacity: 16,
      access: 'public',
      placeId: null,
      connectors: [],
      shape: null,
      strip: { roadId: sink.id, side: 'right', fromM: 30, toM: 118, layout: 'parallel' },
      provenance: { source: 'authored' },
    },
  };
  const exit = connected ? road(boundary, b) : null;
  const trip = (
    id: string,
    personId = id,
    origin = home!.id,
    destination = shop!.id,
    departS = 100,
  ): TripRequest => ({
    id,
    personId,
    originPlaceId: origin,
    destinationPlaceId: destination,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const scenario = {
    ...defaultScenario('grid5x5', 122),
    startS: 100,
    endS: 2000,
    simParams: { streetParkingShare: 1 },
  };
  return { ...builder, home: home!, shop: shop!, id, sink, boundary, b, exit, trip, scenario };
}

function compiled(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

function parking(w: ReturnType<typeof world>, trips: TripRequest[], net = compiled(w.city)) {
  const vehicles = createVehicles(trips.length, net.lanes.length, net.movements.length);
  trips.forEach((trip, id) => {
    vehicles.vclass[id] = vehicleClasses.indexOf(trip.vehicleClass ?? 'car');
  });
  const state = createParking(
    net,
    trips,
    w.scenario,
    { ...DEFAULT_SIM_PARAMS, ...w.scenario.simParams },
    vehicles,
  );
  return { state, net, vehicles };
}

const strip = (net: CompiledCity, id: string) => net.parking[net.index.parking.get(id)!]!;

test('T59 trip cars skip a cropped strip, background stock stays drawn, and the resident completes', () => {
  const w = world(),
    trips = [w.trip('commute')];
  w.city.parking![w.id]!.occupancyAtStart = 1;
  const { state, net } = parking(w, trips);
  expect(net.parking[state.location(0, true).facility]!.kind).toBe('garage');
  expect(state.location(0, true).space).toBe(-1);
  expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(36);
  const f = strip(net, w.id),
    bits = state.stockSnapshot().occupied;
  expect(f.spaces!.every((i) => (bits[i >> 3]! & (1 << (i & 7))) !== 0)).toBe(true);

  const runs = [createEngine(), createEngine()];
  for (const run of runs) run.load({ compiled: net, trips, scenario: w.scenario });
  for (let step = 0; step < 12000; step++) {
    for (const run of runs) run.step();
    if (step % 100 === 0) expect(runs[0]!.stateHash()).toBe(runs[1]!.stateHash());
  }
  expect(runs[0]!.inspect(1)?.state).toBe('completed');
  expect(runs[0]!.metrics().failedByReason.no_parking).toBe(0);
});

test.each([false, true])(
  'T59 a full street share keeps an actual car in its %s mapped garage',
  (mapped) => {
    const w = world();
    w.home.population = 16;
    if (mapped) {
      const id = allocateId(w.city, 'pk');
      w.city.parking![id] = {
        id,
        kind: 'garage',
        capacity: 16,
        name: null,
        access: 'private',
        placeId: w.home.id,
        shape: w.home.shape,
        connectors: w.home.connectors.map((c) => ({ ...c, id: allocateId(w.city, 'c') })),
        provenance: { source: 'authored' },
      };
    }
    const { state, net } = parking(
      w,
      Array.from({ length: 16 }, (_, i) => w.trip(`commute:${i}`)),
    );
    expect(state.noOriginCar(0)).toBe(false);
    expect(net.parking[state.location(0, true).facility]!.kind).toBe('garage');
    expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(16);
    expect(state.snapshot()[strip(net, w.id).idx]).toBe(0);
    state.depart(0);
    expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(15);
  },
);

test('T59 a lot needs a usable outbound portal for a later trip, while a terminal visit may stay', () => {
  const w = parkingWorld(),
    city = w.city,
    source = city.parking![w.id]!;
  const end = allocateId(city, 'n'),
    roadId = allocateId(city, 'r');
  city.nodes[end] = {
    ...city.nodes[w.street.from]!,
    id: end,
    pos: { x: 180, y: 80 },
    turnRules: [],
  };
  city.roads[roadId] = {
    ...w.street,
    id: roadId,
    from: w.street.to,
    to: end,
    centerline: [city.nodes[w.street.to]!.pos, city.nodes[end]!.pos],
    streetGroupId: null,
  };
  source.connectors.push({
    id: allocateId(city, 'c'),
    roadId,
    lane: 0,
    positionM: 100,
    direction: 'out',
    throughputPerMin: 30,
  });
  const inbound = w.trip('in'),
    onward = {
      ...w.trip('out', 5000),
      personId: inbound.personId,
      originPlaceId: w.shop.id,
      destinationPlaceId: w.home.id,
    };
  const make = (trips: TripRequest[]) => {
    const net = compiled(city),
      vehicles = createVehicles(trips.length, net.lanes.length, net.movements.length);
    return createParking(
      net,
      trips,
      w.scenario,
      { ...DEFAULT_SIM_PARAMS, ...w.scenario.simParams },
      vehicles,
    );
  };
  const open = make([inbound, onward]);
  expect(open.choose(0, 100, () => true)).toBe(true);
  expect(open.detail(0, 100).parkingFacility).toBe(w.id);
  source.connectors[0]!.direction = 'in';
  city.version++;
  const closed = make([inbound, onward]);
  expect(closed.choose(0, 100, () => true)).toBe(true);
  expect(closed.detail(0, 100).parkingFacility).not.toBe(w.id);
  const terminal = make([inbound]);
  expect(terminal.choose(0, 100, () => true)).toBe(true);
  expect(terminal.detail(0, 100).parkingFacility).toBe(w.id);
});

test('T59 an owner may circulate inside its private campus instead of reaching an unrelated public core', () => {
  const w = world();
  const campus = Array.from({ length: 6 }, (_, i) =>
    w.node(1000 + 100 * Math.cos((i * Math.PI) / 3), 100 * Math.sin((i * Math.PI) / 3)),
  );
  const roads = campus.map((n, i) => w.road(n, campus[(i + 1) % campus.length]!));
  for (const road of roads) road.access = { all: 'private' };
  w.place('Campus', 'work', { x: 1080, y: 20 }, [
    { road: roads[0]!, positionM: 30, direction: 'both' },
  ]);
  const work = Object.values(w.city.places).find((p) => p.name === 'Campus')!;
  work.jobs = 20;
  const inbound = w.trip('campus-in', 'worker', w.home.id, work.id);
  const onward = w.trip('campus-out', 'worker', work.id, w.home.id, 5000);
  const { state, net } = parking(w, [inbound, onward]);
  expect(state.choose(0, 100, () => true)).toBe(true);
  const own = net.parking.find((f) => f.place === net.index.place.get(work.id))!;
  expect(state.detail(0, 100).parkingFacility).toBe(own.id);
});

test('T59 a later car trip needs an exit, including beyond the run; a terminal visit may park in the sink', () => {
  const w = world();
  w.city.parking![w.id]!.occupancyAtStart = 0;
  const inbound = w.trip('in', 'owner');
  const onward = w.trip('out', 'owner', w.shop.id, w.home.id, 5000);
  const returning = parking(w, [inbound, onward]);
  expect(returning.state.choose(0, 100, () => true)).toBe(true);
  expect(returning.state.detail(0, 100).parkingFacility).not.toBe(w.id);
  const connector = strip(returning.net, w.id).connectorsIn[0]!;
  expect(returning.state.full(connector, 0)).toBe(true);

  const terminal = parking(w, [inbound]);
  expect(terminal.state.choose(0, 100, () => true)).toBe(true);
  expect(terminal.state.detail(0, 100).parkingFacility).toBe(w.id);
  expect(terminal.state.full(strip(terminal.net, w.id).connectorsIn[0]!, 0)).toBe(false);
});

test.each([false, true])(
  'T59 gateway visitors retain parking choices while local gateway-bound cars need an exit (%s)',
  (visitor) => {
    const w = world();
    w.city.parking![w.id]!.occupancyAtStart = 0;
    const gateway = Object.values(w.city.places).find((p) => p.kind === 'gateway')!;
    const inbound = w.trip('in', 'owner', visitor ? gateway.id : w.home.id);
    const onward = w.trip('out', 'owner', w.shop.id, gateway.id, 5000);
    const { state, net } = parking(w, [inbound, onward]);
    const connector = strip(net, w.id).connectorsIn[0]!;
    expect(state.full(connector, 0)).toBe(!visitor);
    expect(state.choose(0, 100, () => true)).toBe(true);
    expect(state.detail(0, 100).parkingFacility === w.id).toBe(visitor);
    if (visitor) {
      state.arrive(0, connector, 110);
      expect(state.location(0).space).toBe(strip(net, w.id).spaces![0]);
      expect(state.location(1, true)).toEqual(state.location(0));
      expect(state.metrics(0).parkedWithoutExit).toBe(1);
    }
  },
);

test.each(['none', 'full', 'unreachable', 'beyond', 'available'] as const)(
  'T59 a later-trip arrival keeps its garage when no usable local space is available (%s)',
  (alternative) => {
    const w = world();
    w.shop.kind = 'work';
    w.shop.connectors = w.shop.connectors.map((c) => ({
      ...c,
      roadId: w.sink.id,
      lane: 0,
      positionM: 60,
    }));
    w.city.parking![w.id]!.occupancyAtStart = 0;
    const safeId = allocateId(w.city, 'pk');
    if (alternative !== 'none') {
      w.city.parking![safeId] = {
        ...w.city.parking![w.id]!,
        id: safeId,
        occupancyAtStart: alternative === 'full' ? 1 : 0,
        strip: {
          ...w.city.parking![w.id]!.strip!,
          roadId: Object.values(w.city.roads)[0]!.id,
          fromM: 200,
          toM: 288,
        },
      };
    }
    if (alternative === 'beyond')
      Object.assign(w.scenario.simParams, { parkingSearchRadiusM: 100 });
    const inbound = w.trip('in', 'owner');
    const onward = w.trip('out', 'owner', w.shop.id, w.home.id, 5000);
    const { state, net, vehicles } = parking(w, [inbound, onward]);
    const garage = net.parking.find((f) => f.place === net.index.place.get(w.shop.id))!;
    const accept = (c: number) =>
      alternative !== 'unreachable' || net.parking[net.connectors[c]!.parking!]?.id !== safeId;
    for (const forecast of [true, false]) {
      expect(state.choose(0, 100, accept, forecast)).toBe(true);
      expect(state.detail(0, 100).parkingFacility).toBe(
        alternative === 'available' ? safeId : garage.id,
      );
      expect(state.metrics(0).parkedWithoutExit).toBe(0);
    }
    const f = alternative === 'available' ? strip(net, safeId) : garage;
    vehicles.destination[0] = f.connectorsIn[0]!;
    state.beginSearch(0, 100);
    expect(state.needsChoice(0)).toBe(alternative !== 'available');
    state.arrive(0, f.connectorsIn[0]!, 110);
    expect(state.metrics(0).parkedWithoutExit).toBe(alternative === 'available' ? 0 : 1);
    expect(state.location(1, true)).toEqual(state.location(0));
  },
);

test('T59 a temporarily rejected safe strip is reconsidered when a car leaves', () => {
  const w = world(true);
  w.city.parking![w.id]!.capacity = 1;
  w.city.parking![w.id]!.strip!.toM = 35.5;
  w.city.parking![w.id]!.occupancyAtStart = 0;
  const trips = ['a', 'b'].flatMap((person) => [
    w.trip(`${person}-in`, person),
    w.trip(`${person}-out`, person, w.shop.id, w.home.id, 5000),
  ]);
  const { state, net } = parking(w, trips);
  const connector = strip(net, w.id).connectorsIn[0]!;
  const accept = (c: number) => c === connector;
  expect(state.choose(0, 100, accept)).toBe(true);
  state.arrive(2, connector, 101);
  state.reject(0, 102);
  state.depart(3, 103, connector);
  for (let i = 0; i < 200; i++)
    state.advance(103 + i / 10, {
      clearLane: () => {},
      park: () => {},
      exit: () => true,
      resume: () => {},
    });
  expect(state.full(connector, 0)).toBe(false);
  expect(state.choose(0, 124, accept)).toBe(true);
});

test('T59 a car rechecks a filled safe space from its current position before reaching it', () => {
  const w = world();
  w.scenario.simParams.streetParkingShare = 0;
  w.shop.kind = 'work';
  w.shop.connectors = w.shop.connectors.map((c) => ({
    ...c,
    roadId: w.sink.id,
    lane: 0,
    positionM: 60,
  }));
  w.city.parking![w.id]!.occupancyAtStart = 0;
  const street = Object.values(w.city.roads)[0]!;
  const safeId = allocateId(w.city, 'pk');
  w.city.parking![safeId] = {
    ...w.city.parking![w.id]!,
    id: safeId,
    capacity: 1,
    occupancyAtStart: 0,
    strip: { ...w.city.parking![w.id]!.strip!, roadId: street.id, fromM: 200, toM: 205.5 },
  };
  w.place('Near home', 'residential', { x: 190, y: -20 }, [
    { road: street, positionM: 190, direction: 'both' },
  ]);
  const near = Object.values(w.city.places).find((p) => p.name === 'Near home')!;
  near.population = 2;
  const trips = [
    w.trip('far-in', 'far'),
    w.trip('far-out', 'far', w.shop.id, w.home.id, 5000),
    w.trip('near-in', 'near', near.id, w.shop.id, 145),
    w.trip('near-out', 'near', w.shop.id, near.id, 5000),
  ];
  const engine = createEngine();
  const twin = createEngine();
  const net = compiled(w.city);
  for (const run of [engine, twin]) run.load({ compiled: net, trips, scenario: w.scenario });
  let firstChoice = false;
  let changedBeforeArrival = false;
  for (let i = 0; i < 6000; i++) {
    engine.step();
    twin.step();
    if (i % 100 === 0) expect(engine.stateHash()).toBe(twin.stateHash());
    const car = engine.inspect(1)!;
    if (car.parkingFacility === safeId) firstChoice = true;
    if (firstChoice && car.routeReason === 'parking' && car.parkingFacility !== safeId) {
      changedBeforeArrival = car.positionM < 200;
      break;
    }
  }
  expect(firstChoice).toBe(true);
  expect(changedBeforeArrival).toBe(true);
  engine.step(6000);
  twin.step(6000);
  expect(engine.stateHash()).toBe(twin.stateHash());
  expect(engine.inspect(1)!.state).toBe('completed');
  expect(engine.metrics().parking.parkedWithoutExit).toBe(1);
});

test.each(['later', 'terminal', 'opened'] as const)(
  'T59 fallback strip admissions count actual departure reachability (%s)',
  (kind) => {
    const w = world();
    w.city.parking![w.id]!.occupancyAtStart = 0;
    const inbound = w.trip('in', 'owner');
    const trips = [inbound];
    if (kind !== 'terminal') trips.push(w.trip('out', 'owner', w.shop.id, w.home.id, 5000));
    const { state, net } = parking(w, trips);
    const connector = strip(net, w.id).connectorsIn[0]!;
    expect(state.choose(0, 100, (c) => net.connectors[c]!.parking === strip(net, w.id).idx)).toBe(
      true,
    );
    expect(state.full(connector, 0)).toBe(false);
    expect(state.metrics(0).parkedWithoutExit).toBe(0);
    let arrival = connector;
    if (kind === 'opened') {
      w.road(w.boundary, w.b);
      w.city.version++;
      const next = compiled(w.city);
      state.patch(next);
      arrival = next.index.connector.get(net.connectors[connector]!.id)!;
    }
    state.arrive(0, arrival, 110);
    expect(state.metrics(0).parkedWithoutExit).toBe(kind === 'later' ? 1 : 0);
  },
);

test.each(['no', 'private'] as const)(
  'T59 an exit through %s access is not a public way out',
  (access) => {
    const w = world(true);
    w.exit!.access = { all: access };
    const { state, net } = parking(w, [w.trip('commute')]);
    expect(net.parking[state.location(0, true).facility]!.kind).toBe('garage');
  },
);

test('T59 the street share uses the next safe strip without duplicating stock or changing explicit occupancy', () => {
  const w = world();
  w.scenario.simParams.streetParkingShare = 0.3;
  w.city.parking![w.id]!.capacity = 6;
  w.city.parking![w.id]!.strip!.toM = 63;
  const safeId = allocateId(w.city, 'pk');
  w.city.parking![safeId] = {
    ...w.city.parking![w.id]!,
    id: safeId,
    strip: { ...w.city.parking![w.id]!.strip!, roadId: Object.values(w.city.roads)[0]!.id },
  };
  const id = allocateId(w.city, 'pk');
  w.city.parking![id] = {
    id,
    kind: 'garage',
    capacity: 50,
    name: null,
    access: 'private',
    placeId: w.shop.id,
    shape: w.shop.shape,
    occupancyAtStart: 1,
    connectors: w.shop.connectors.map((c) => ({ ...c, id: allocateId(w.city, 'c') })),
    provenance: { source: 'authored' },
  };
  const { state, net } = parking(w, [w.trip('commute')]);
  expect(state.snapshot()[strip(net, w.id).idx]).toBe(0);
  expect(state.snapshot()[strip(net, safeId).idx]).toBe(6);
  expect(state.snapshot()[net.index.parking.get(id)!]).toBe(50);
  expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(70);
  state.depart(0);
  expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(69);
});

test('T59 a van keeps its mapped garage stock when a street space only admits cars', () => {
  const w = world(true);
  w.home.population = 16;
  w.sink.lanes[0]!.allowed = ['car'];
  const id = allocateId(w.city, 'pk');
  w.city.parking![id] = {
    id,
    kind: 'garage',
    capacity: 16,
    name: null,
    access: 'private',
    placeId: w.home.id,
    shape: w.home.shape,
    connectors: w.home.connectors.map((c) => ({ ...c, id: allocateId(w.city, 'c') })),
    provenance: { source: 'authored' },
  };
  const trips = Array.from({ length: 16 }, (_, i) => ({
    ...w.trip(`van:${i}`),
    vehicleClass: 'van' as const,
  }));
  const { state } = parking(w, trips);
  expect(state.noOriginCar(0)).toBe(false);
  expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(16);
  state.depart(0);
  expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(15);
});

test.each([false, true])(
  'T59 space position and a forbidden intermediate lane constrain egress (%s)',
  (blocked) => {
    const w = world(true);
    const count = blocked ? 3 : 2;
    w.sink.lanes = Array.from({ length: count }, (_, i) => ({
      widthM: 3,
      allowed: blocked && i === 1 ? ['bus'] : ['car', 'van', 'truck', 'bus'],
    }));
    w.exit!.lanes = Array.from({ length: count }, (_, i) => ({
      widthM: 3,
      allowed: i === 0 ? ['car', 'van', 'truck', 'bus'] : ['bus'],
    }));
    w.boundary.turnRules = Array.from({ length: count }, (_, i) => ({
      from: w.sink.id,
      to: w.exit!.id,
      fromLane: i,
      toLane: i,
      allowed: true,
      provenance: { source: 'authored' },
    }));
    w.city.parking![w.id]!.strip!.toM = 165;
    w.city.parking![w.id]!.capacity = 25;
    w.city.parking![w.id]!.occupancyAtStart = 0;
    const trips = [w.trip('in', 'owner'), w.trip('out', 'owner', w.shop.id, w.home.id, 5000)];
    const { state, net } = parking(w, trips),
      f = strip(net, w.id);
    const connectors = f.connectorsIn.map((i) => net.connectors[i]!);
    const early = connectors.filter((c) => c.positionM < net.lanes[c.lane]!.lengthM - 35);
    const late = connectors.filter((c) => c.positionM > net.lanes[c.lane]!.lengthM - 25);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    expect(early.every((c) => state.full(c.idx, 0) === blocked)).toBe(true);
    expect(late.every((c) => state.full(c.idx, 0))).toBe(true);
  },
);

test('T59 live edits update new choices, retaining parked cars and their existing departure space', () => {
  const w = world(true);
  w.city.parking![w.id]!.occupancyAtStart = 0;
  const trips = [
    w.trip('a', 'a'),
    w.trip('a-back', 'a', w.shop.id, w.home.id, 5000),
    w.trip('b', 'b'),
    w.trip('b-back', 'b', w.shop.id, w.home.id, 6000),
  ];
  const { state, net } = parking(w, trips);
  expect(state.choose(0, 100, () => true)).toBe(true);
  expect(state.detail(0, 100).parkingFacility).toBe(w.id);
  state.depart(0);
  state.arrive(0, strip(net, w.id).connectorsIn[0]!, 110);
  const old = state.location(0),
    occupied = state.snapshot().reduce((a, b) => a + b, 0);
  const oldExitId = net.connectors[state.exits(1, [])[0]!]!.id;
  delete w.city.roads[w.exit!.id];
  w.city.version++;
  const closed = compiled(w.city);
  state.patch(closed);
  expect(state.location(0).space).toBe(
    strip(closed, w.id).spaces![strip(net, w.id).spaces!.indexOf(old.space)],
  );
  expect(state.snapshot().reduce((a, b) => a + b, 0)).toBe(occupied);
  expect(closed.connectors[state.exits(1, [])[0]!]!.id).toBe(oldExitId);
  expect(state.choose(2, 120, () => true)).toBe(true);
  expect(state.detail(2, 120).parkingFacility).not.toBe(w.id);
  w.city.roads[w.exit!.id] = w.exit!;
  w.city.version++;
  state.patch(compiled(w.city));
  expect(state.choose(2, 130, () => true)).toBe(true);
  expect(state.detail(2, 130).parkingFacility).toBe(w.id);
});
