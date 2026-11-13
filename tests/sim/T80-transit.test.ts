import { expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { transitNetwork } from '../../src/routing/transit';
import type { City, Scenario } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import {
  createTransit,
  MAX_WAIT_S,
  scheduledServices,
  TRANSIT_CAPACITY,
  TRANSIT_RIDER_ID,
} from '../../src/sim/transit';
import { riderOf } from '../../src/demand/stations';
import { transitTown } from '../routing/transit-town';
import { railStation } from '../demand/rail-station';
import { setup } from './fixtures';

// TASK-174: riders on platforms and in vehicles; the transit trip through the engine.
function platform(personsPerResident: number) {
  const compiled = setup(transitTown());
  const network = transitNetwork(compiled)!;
  const transit = createTransit(compiled, network, DEFAULT_SIM_PARAMS, 1, personsPerResident, (t) =>
    scheduledServices(network, t),
  );
  return { compiled, network, transit };
}

test('T80 capacity: a full tram leaves riders for the next one, which takes them in order', () => {
  // One place per tram.
  const { network, transit } = platform(0.5 / TRANSIT_CAPACITY.tram);
  const stop = network.index.get('ts:A0')!,
    toStop = network.index.get('ts:A2')!;
  const eastbound = network.lines.find((l) => l.visits[0]!.stop === stop)!;
  const log: string[] = [];
  const startS = 8 * 3600;
  for (const name of ['first', 'second', 'third'])
    transit.wait({
      personId: name,
      tripId: `${name}:trip`,
      from: network.stops[stop]!.access[0]!.point,
      stop,
      routes: [eastbound.route],
      toStop,
      exit: network.stops[toStop]!.access[0]!.point,
      timeS: startS,
      onBoard: (t, vehicle) => log.push(`${name} boards ${vehicle} ${t.toFixed(1)}`),
      onAlight: (t) => log.push(`${name} alights ${t.toFixed(1)}`),
      onGiveUp: (t) => log.push(`${name} gives up ${t.toFixed(1)}`),
    });
  const vehicles = new Set<string>();
  for (let t = startS; t < startS + 3 * 1440; t += DEFAULT_SIM_PARAMS.dtS) {
    transit.step(t);
    for (const v of transit.snapshot(t).vehicles) if (v.riders.length) vehicles.add(v.id);
    for (const v of transit.snapshot(t).vehicles) expect(v.riders.length).toBeLessThanOrEqual(1);
  }
  const boards = log.filter((l) => l.includes('boards'));
  expect(boards.map((l) => l.split(' ')[0])).toEqual(['first', 'second', 'third']);
  // Each on its own run, and each alights at Orchard after boarding.
  expect(new Set(boards.map((l) => l.split(' ')[2])).size).toBe(3);
  expect(vehicles.size).toBe(3);
  for (const name of ['first', 'second', 'third']) {
    const board = Number(
      log
        .find((l) => l.startsWith(`${name} boards`))!
        .split(' ')
        .at(-1),
    );
    const alight = Number(
      log
        .find((l) => l.startsWith(`${name} alights`))!
        .split(' ')
        .at(-1),
    );
    expect(alight).toBeGreaterThan(board);
  }
  const metrics = transit.metrics();
  // The second was left once, the third twice.
  expect(metrics.deniedBoardings).toBe(3);
  expect(metrics.lines.find((l) => l.route === eastbound.route)!).toMatchObject({
    capacity: 1,
    boardings: 3,
    alightings: 3,
    peakLoad: 1,
  });
  expect(metrics.stops[stop]!.boardings).toBe(3);
  expect(metrics.stops[toStop]!.alightings).toBe(3);
  expect(metrics.waiting + metrics.aboard).toBe(0);
});

test('T80 a rider no run can take gives up after the longest wait', () => {
  const { network, transit } = platform(0.15);
  const stop = network.index.get('ts:A0')!;
  let gaveUp = -1;
  transit.wait({
    personId: 'p',
    tripId: 'p:trip',
    from: network.stops[stop]!.centre,
    stop,
    routes: [],
    toStop: stop,
    exit: network.stops[stop]!.centre,
    timeS: 0,
    onBoard: () => {},
    onAlight: () => {},
    onGiveUp: (t) => (gaveUp = t),
  });
  for (let t = 0; t < MAX_WAIT_S + 60; t += 1) transit.step(t);
  expect(gaveUp).toBeGreaterThanOrEqual(MAX_WAIT_S);
  expect(gaveUp).toBeLessThan(MAX_WAIT_S + 60);
  expect(transit.metrics().gaveUp).toBe(1);
});

function morning(city: City, modeChoice?: Scenario['demand']['modeChoice']) {
  const scenario = { ...defaultScenario('town'), startS: 7 * 3600, endS: 10 * 3600 };
  scenario.demand.personsPerResident = 0.2;
  scenario.demand.carShare = 0.6;
  if (modeChoice) scenario.demand.modeChoice = modeChoice;
  const compiled = setup(city);
  const population = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, population, scenario, compiled);
  const engine = createEngine();
  engine.load({ compiled, trips, scenario, population });
  return { engine, trips };
}

test('T80 transit trips walk to a stop, wait, ride and walk on, and the same seed rides the same way', () => {
  const { engine, trips } = morning(transitTown());
  engine.step(3 * 36000);
  const metrics = engine.metrics();
  const outcomes = metrics.tripOutcomes!;
  const ridden = outcomes.flatMap((o, id) => (o.mode === 'rail' ? [id] : []));
  const record = (id: number) =>
    engine.inspectPerson(trips[id]!.personId!)!.trips.find((t) => t.tripId === trips[id]!.id)!;
  // Later trips of a tour that took transit carry its mode before they start.
  const started = ridden.filter((id) => record(id).state !== 'pending');
  expect(started.length).toBeGreaterThan(0);
  expect(metrics.persons!.modes.started.transit).toBe(started.length);
  for (const id of started) {
    const trip = record(id);
    if (trip.state !== 'completed') continue;
    const kinds = trip.legs.map((l) => l.kind);
    expect(kinds[0]).toBe('walk');
    expect(kinds.at(-1)).toBe('walk');
    expect(kinds.filter((k) => k === 'ride').length).toBe(kinds.filter((k) => k === 'wait').length);
    for (let i = 1; i < trip.legs.length; i++)
      expect(trip.legs[i]!.startedS).toBeCloseTo(trip.legs[i - 1]!.arrivedS!, 6);
    for (const ride of trip.legs.filter((l) => l.kind === 'ride')) {
      expect(ride.vehicle).toMatch(/^tram:/);
      expect(ride.toStop).not.toBe(ride.stop);
    }
  }
  const lines = metrics.transit!.lines;
  expect(lines.reduce((n, l) => n + l.boardings, 0)).toBeGreaterThanOrEqual(
    lines.reduce((n, l) => n + l.alightings, 0),
  );
  const again = morning(transitTown());
  again.engine.step(3 * 36000);
  expect(again.engine.stateHash()).toBe(engine.stateHash());
  expect(again.engine.metrics().transit).toEqual(metrics.transit);
});

test('T80 choice off: no transit trips, and the run equals the town without trams', () => {
  const off = { enabled: false };
  const withTrams = morning(transitTown(), off),
    without = morning(town(), off);
  for (const run of [withTrams, without]) run.engine.step(2 * 36000);
  expect(withTrams.engine.metrics().persons!.modes.started.transit).toBe(0);
  expect(withTrams.engine.stateHash()).toBe(without.engine.stateHash());
});

test('T80 TASK-128 riders come in on the S-Bahn, get off at its doors and leave on it', () => {
  const { city } = railStation();
  const scenario = { ...defaultScenario('station'), startS: 11 * 3600, endS: 12.75 * 3600 };
  scenario.demand.personsPerResident = 0.5;
  const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
  const engine = createEngine();
  engine.load({ compiled: setup(city), trips, scenario });
  let onPlatform = 0;
  let aboard = 0;
  for (let t = scenario.startS; t < scenario.endS; t += 60) {
    engine.step(600);
    const snapshot = engine.snapshot();
    onPlatform = Math.max(
      onPlatform,
      [...(snapshot.walkers?.id ?? [])].filter((id) => id >= TRANSIT_RIDER_ID).length,
    );
    aboard = Math.max(aboard, ...(snapshot.transit?.vehicles ?? []).map((v) => v.riders.length));
  }
  const metrics = engine.metrics();
  const sbahn = metrics.transit!.lines.find((l) => l.kind === 'sbahn')!;
  // Riders of trains arriving after the start ride in and get off; their walks are unchanged.
  const arriving = trips.filter(
    (t) =>
      t.id.endsWith(':out') && (riderOf(t.personId ?? '')?.arrivalS ?? 0) > scenario.startS + 60,
  );
  const arrived = arriving.filter((t) => riderOf(t.personId!)!.arrivalS < engine.timeS);
  expect(arrived.length).toBeGreaterThan(5);
  expect(sbahn.riderAlightings).toBeGreaterThanOrEqual(arrived.length);
  expect(sbahn.boardings + sbahn.alightings).toBe(0);
  const back = trips.filter(
    (t) =>
      t.id.endsWith(':back') &&
      !!riderOf(t.personId ?? '') &&
      engine.inspectPerson(t.personId!)!.trips.at(-1)!.state === 'completed',
  );
  expect(back.length).toBeGreaterThan(0);
  expect(sbahn.riderBoardings + metrics.transit!.waiting).toBeGreaterThanOrEqual(back.length);
  expect(sbahn.riderBoardings).toBeGreaterThan(0);
  expect(onPlatform).toBeGreaterThan(0);
  expect(aboard).toBeGreaterThan(0);
});
