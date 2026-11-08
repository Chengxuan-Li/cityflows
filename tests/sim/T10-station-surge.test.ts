import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createConnectors } from '../../src/sim/connectors';
import { createAccounting } from '../../src/sim/metrics';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles } from '../../src/sim/vehicle';
import { createEngine } from '../../src/sim/engine';
import type { TripRequest } from '../../src/schema';
import { scenario, setup } from './fixtures';
import { bundledProject } from '../../src/ui/bundled-projects';
import { generatePopulation, scheduleTrips } from '../../src/demand';

test('T10 the bundled station surge peaks within fifteen minutes, slows its approach and replays', async () => {
  const opened = await bundledProject('station');
  if (!opened.ok) throw new Error('Station must open');
  const { city, scenarios } = opened.project;
  const scenario = scenarios[0]!;
  const station = Object.values(city.places).find((p) => p.kind === 'station')!;
  const parking = Object.values(city.places).find((p) => p.kind === 'parking')!;
  expect(parking.capacity).toBeGreaterThan(0);
  const event = station.events[0]!;
  expect(event.startS).toBe(8 * 3600 + 5 * 60);
  const compiled = setup(city);
  const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
  const visitors = trips.filter(
    (t) => t.destinationPlaceId === station.id || t.originPlaceId === station.id,
  );
  expect(visitors.filter((t) => t.destinationPlaceId === station.id)).toHaveLength(event.arrivals);
  expect(visitors.filter((t) => t.originPlaceId === station.id)).toHaveLength(event.departures);
  expect(
    visitors.every((t) => t.departS >= event.startS && t.departS < event.startS + event.durationS),
  ).toBe(true);
  const quietCity = structuredClone(city);
  for (const place of Object.values(quietCity.places)) place.events = [];
  const quietTrips = scheduleTrips(
    quietCity,
    generatePopulation(quietCity, scenario.demand),
    scenario,
  );
  const engine = createEngine(),
    replay = createEngine(),
    quiet = createEngine();
  engine.load({ compiled, trips, scenario });
  replay.load({ compiled, trips, scenario });
  quiet.load({ compiled: setup(quietCity), trips: quietTrips, scenario });
  const upstream = compiled.roads.find((r) => city.roads[r.id]!.name === 'Station approach')!;
  const loopRoads = compiled.roads
    .filter((r) => city.roads[r.id]!.name === 'Pickup loop')
    .map((r) => r.idx);
  let peak = 0,
    peakS = 0,
    slow = 0,
    baseline = 0,
    samples = 0,
    upstreamQueue = 0;
  while (engine.timeS < scenario.endS) {
    engine.step(100);
    replay.step(100);
    quiet.step(100);
    expect(engine.stateHash()).toBe(replay.stateHash());
    const snapshot = engine.snapshot();
    let queue = 0;
    for (let i = 0; i < snapshot.count; i++) {
      const lane = compiled.lanes[snapshot.lane[i]!];
      if (lane && snapshot.speed[i]! < 1) {
        if (loopRoads.includes(lane.road)) queue++;
        if (lane.road === upstream.idx) upstreamQueue++;
      }
    }
    if (queue > peak) {
      peak = queue;
      peakS = engine.timeS;
    }
    if (engine.timeS >= event.startS && engine.timeS < event.startS + 900) {
      slow += engine.metrics().roadSpeedRatio[upstream.idx]!;
      baseline += quiet.metrics().roadSpeedRatio[upstream.idx]!;
      samples++;
    }
  }
  expect(peak).toBeGreaterThan(5);
  expect(peakS).toBeGreaterThanOrEqual(event.startS);
  expect(peakS).toBeLessThanOrEqual(event.startS + 900);
  expect(upstreamQueue).toBeGreaterThan(0);
  expect(slow / samples).toBeLessThan(baseline / samples - 0.1);
  expect(engine.metrics().trips.failed).toBe(0);
  expect(engine.metrics().trips.queuedDestination).toBe(0);
  expect(engine.metrics().trips.queuedOrigin).toBe(0);
});

test('T10 event windows accumulate shared admission quotas without bypassing capacity or throughput', () => {
  const { city, node, road, place } = buildCity('Event windows', 1);
  const link = road(node(0, 0), node(300, 0));
  place('Station', 'station', { x: 200, y: 10 }, [
    { road: link, direction: 'in', positionM: 100 },
    { road: link, direction: 'in', positionM: 200 },
  ]);
  const source = Object.values(city.places)[0]!;
  source.capacity = 3;
  source.events = [
    { id: 'train', name: 'Train', startS: 200, durationS: 100, arrivals: 2, departures: 0 },
    { id: 'next', name: 'Next', startS: 400, durationS: 100, arrivals: 2, departures: 0 },
  ];
  const compiled = setup(city);
  const vehicles = createVehicles(0, compiled.lanes.length, compiled.movements.length);
  const connectors = createConnectors(
    compiled,
    [],
    scenario(),
    DEFAULT_SIM_PARAMS,
    vehicles,
    createAccounting(compiled, vehicles),
  );
  const [first, second] = compiled.connectors;
  expect(connectors.canArrive(first!, 199)).toBe(false);
  expect(connectors.canArrive(first!, 249)).toBe(false);
  expect(connectors.arrive(first!, 250)).toBe(true);
  expect(connectors.arrive(second!, 250)).toBe(false);
  expect(connectors.arrive(first!, 300)).toBe(true);
  expect(connectors.arrive(second!, 399)).toBe(false);
  expect(connectors.arrive(second!, 450)).toBe(true);
  compiled.places[0]!.capacity = 4;
  expect(connectors.arrive(second!, 451)).toBe(false);
  compiled.places[0]!.capacity = 3;
  expect(connectors.arrive(first!, 600)).toBe(false);
  compiled.places[0]!.capacity = 4;
  expect(connectors.arrive(first!, 600)).toBe(true);
});

test('T10 a parking departure waits for its arrival, releases a slot and drains the lane queue', () => {
  const { city, node, road, place } = buildCity('Parking', 1);
  const a = node(0, 0),
    b = node(400, 0),
    c = node(400, 200),
    d = node(0, 200);
  const inbound = road(a, b);
  road(b, c);
  road(c, d);
  const outbound = road(d, a);
  place('Gateway', 'gateway', { x: 20, y: 20 }, [
    { road: inbound, direction: 'out', positionM: 20 },
    { road: outbound, direction: 'in', positionM: 100 },
  ]);
  place('Parking', 'parking', { x: 300, y: 20 }, [
    { road: inbound, direction: 'in', positionM: 280 },
    { road: inbound, direction: 'out', positionM: 320 },
  ]);
  const [gateway, parking] = Object.values(city.places);
  parking!.capacity = 1;
  const trip = (
    id: string,
    personId: string,
    from: string,
    to: string,
    departS: number,
  ): TripRequest => ({
    id,
    personId,
    originPlaceId: from,
    destinationPlaceId: to,
    departS,
    vehicleClass: 'car',
    purpose: 'private',
    mode: 'car',
    legs: [],
  });
  const trips = [
    trip('in:a', 'a', gateway!.id, parking!.id, 100),
    trip('in:b', 'b', gateway!.id, parking!.id, 105),
    trip('out:b', 'b', parking!.id, gateway!.id, 110),
    trip('out:a', 'a', parking!.id, gateway!.id, 180),
  ];
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({ compiled, trips, scenario: scenario() });
  engine.step(150);
  expect(engine.inspect(3)!.state).toBe('queued_origin');
  engine.step(450);
  expect(engine.inspect(2)!.state).toBe('queued_destination');
  engine.step(1900);
  expect(engine.inspect(4)!.departedS).toBeGreaterThanOrEqual(engine.inspect(1)!.arrivedS!);
  expect(engine.inspect(2)!.arrivedS).toBeGreaterThanOrEqual(engine.inspect(4)!.departedS!);
  expect(engine.inspect(3)!.departedS).toBeGreaterThanOrEqual(engine.inspect(2)!.arrivedS!);
  expect(engine.metrics().trips.completed).toBe(4);
  expect(engine.metrics().trips.failed).toBe(0);

  gateway!.connectors = gateway!.connectors.filter((c) => c.direction === 'in');
  engine.load({ compiled: setup(city), trips, scenario: scenario() });
  engine.step(1500);
  expect(engine.metrics().trips.failed).toBe(4);
  expect(engine.metrics().failedByReason.no_origin_connector).toBe(2);
  expect(engine.metrics().failedByReason.stranded).toBe(2);
});

test('T10 Station with a second bidirectional connector drains paired visits without spawning into arrivals', async () => {
  const opened = await bundledProject('station');
  if (!opened.ok) throw new Error('Station must open');
  const { city, scenarios } = opened.project;
  const station = Object.values(city.places).find((p) => p.kind === 'station')!;
  station.connectors.push({
    ...station.connectors[0]!,
    id: `c:${city.nextId++}`,
    positionM: 85,
    direction: 'both',
    throughputPerMin: 30,
  });
  const compiled = setup(city);
  const scenario = scenarios[0]!;
  const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
  const engine = createEngine(),
    replay = createEngine();
  engine.load({ compiled, trips, scenario });
  replay.load({ compiled, trips, scenario });
  while (engine.timeS < scenario.endS) {
    engine.step(100);
    replay.step(100);
    expect(engine.stateHash()).toBe(replay.stateHash());
  }
  expect(engine.metrics().trips.failed).toBe(0);
  expect(engine.metrics().trips.queuedDestination).toBe(0);
  expect(engine.metrics().trips.queuedOrigin).toBe(0);
  engine.step(6000);
  replay.step(6000);
  expect(engine.stateHash()).toBe(replay.stateHash());
  expect(engine.metrics().trips.driving).toBe(0);
  for (const [id, trip] of trips.entries()) {
    if (trip.originPlaceId !== station.id) continue;
    const inbound = trips.findIndex(
      (t) => t.personId === trip.personId && t.destinationPlaceId === station.id,
    );
    if (inbound >= 0)
      expect(engine.inspect(id + 1)!.departedS).toBeGreaterThanOrEqual(
        engine.inspect(inbound + 1)!.arrivedS!,
      );
  }
});
