import { describe, expect, test } from 'vitest';
import type { ScheduledFlight } from '../../src/demand/flight-schedule';
import { syntheticAirport } from '../../src/fixtures/synthetic-airport';
import { compile } from '../../src/network';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { airportFixture } from './airside-fixture';

function setup() {
  const result = compile(syntheticAirport());
  if (!result.ok || !result.compiled.airside) throw new Error('Synthetic airport must compile');
  return createAircraftFleet(result.compiled.airside, 1);
}

function turn(overrides: Partial<ScheduledFlight> = {}): ScheduledFlight {
  return {
    id: 'flight:1',
    typeId: 'E190',
    arrivalS: 0,
    departureS: 2100,
    standKind: 'contact',
    standCode: 'C',
    overnight: false,
    maintenance: false,
    irregularTow: false,
    ...overrides,
  };
}

function advance(
  fleet: ReturnType<typeof setup>,
  schedule: ScheduledFlight[],
  endS: number,
  startS = 0,
) {
  const operations = createFlightOperations(fleet, 1, startS, schedule);
  let occupied = new Set<string>();
  const stops: string[] = [];
  for (let timeS = startS; timeS <= endS; timeS++) {
    operations.step(timeS);
    fleet.step(timeS);
    const current = new Set<string>();
    for (const stand of fleet.graph.stands) {
      const id = fleet.standOccupant(stand.idx);
      if (id === -1) continue;
      const ref = stand.ref ?? stand.id;
      if (!occupied.has(ref)) stops.push(ref);
      current.add(ref);
    }
    occupied = current;
  }
  operations.step(endS + 1);
  return { ...operations.metrics(), stops };
}

describe('flight operations on the synthetic airport', () => {
  test('splits nearby stands between eligible departure ends as their queues grow', () => {
    const { city } = airportFixture();
    const result = compile(city);
    if (!result.ok || !result.compiled.airside) throw new Error('Inline airport must compile');
    const fleet = createAircraftFleet(result.compiled.airside, 1);
    const startS = 3600;
    const flights = ['a', 'b'].map((id) => turn({ id, departureS: startS }));
    const operations = createFlightOperations(fleet, 1, startS, flights, {
      wind: { fromDeg: 0, speedKt: 0 },
      runways: {
        configurations: [{ id: 'split', arrivalEnds: ['27'], departureEnds: ['27', '09'] }],
      },
    });
    operations.step(startS);
    const departureEnds = fleet
      .snapshot()
      .filter(({ state }) => state === 'parked' || state === 'ready-for-pushback')
      .map(({ runwayEnd }) => runwayEnd);
    expect(departureEnds).toEqual(['27', '09']);
  });

  test('builds the same eligible schedule for the same seed and a different schedule for another', () => {
    const board = (seed: number) => createFlightOperations(setup(), seed, 0).board(0);
    const day = board(1);
    expect(day.arrivals.length).toBeGreaterThan(6);
    expect(
      day.arrivals.some((flight) => flight.typeId === 'EC45' || flight.typeId === 'A139'),
    ).toBe(true);
    expect(board(1)).toEqual(day);
    expect(board(2)).not.toEqual(day);

    const airportWithCurfew = setup();
    airportWithCurfew.graph.icao = 'EGLC';
    const curfewDay = createFlightOperations(airportWithCurfew, 1, 0).board(0);
    expect(
      curfewDay.arrivals.filter(({ typeId }) => typeId === 'EC45' || typeId === 'A139'),
    ).toHaveLength(3);
    expect(
      [...curfewDay.arrivals, ...curfewDay.departures].every(
        ({ timeS }) => timeS >= 6 * 3600 && timeS < 22 * 3600,
      ),
    ).toBe(true);
  });

  test('allocates the widebody only to code E stands', () => {
    const fleet = setup();
    const day = advance(fleet, [turn({ typeId: 'A333', standCode: 'E', departureS: 4800 })], 7000);
    expect(day.completed).toBe(2);
    expect(day.stops).toHaveLength(1);
    expect(fleet.graph.stands.find((s) => s.ref === day.stops[0])?.maxCode).toBe(4);
  });

  test('tows out overnight and back to contact before the morning departure', () => {
    const fleet = setup();
    const day = advance(fleet, [turn({ overnight: true, departureS: 25 * 3600 })], 26 * 3600);
    expect(day.stops).toEqual(['4', 'R2', '4']);
    expect(day.tows).toBe(2);
    expect(day.completed).toBe(1);
    expect(fleet.metrics().departed).toBe(1);
  });

  // TASK-353: one parked away overnight at the run's start left no stand of its own; it is towed
  // to the nearest free contact stand in time for its departure, or departs from the remote
  // stand it stands on when no contact stand is free.
  test('tows one parked away at the start to the nearest free contact stand', () => {
    const fleet = setup();
    const flight = turn({ overnight: true, arrivalS: 0, departureS: 3600 + 3000 });
    const day = advance(fleet, [flight], 3600 + 3600, 3600);
    expect(day.stops).toHaveLength(2);
    const [away, back] = day.stops.map((ref) => fleet.graph.stands.find((s) => s.ref === ref)!);
    expect(away!.kind).toBe('remote');
    expect(back!.kind).toBe('contact');
    const contact = fleet.graph.stands.filter(
      (s) => s.kind === 'contact' && fleet.standAdmits(s.idx, 'E190'),
    );
    const distance = (s: (typeof contact)[number]) =>
      Math.hypot(s.pos.x - away!.pos.x, s.pos.y - away!.pos.y);
    expect(distance(back!)).toBe(Math.min(...contact.map(distance)));
    expect(day.tows).toBe(1);
    expect(day.completed).toBe(1);
  });

  test('departs from the remote stand when no contact stand is free at its return', () => {
    const fleet = setup();
    for (const stand of fleet.graph.stands.filter(
      (s) => s.kind === 'contact' && fleet.standAdmits(s.idx, 'E190'),
    ))
      expect(fleet.spawnParked({ typeId: 'E190', stand: stand.id }).ok).toBe(true);
    const flight = turn({ overnight: true, arrivalS: 0, departureS: 3600 + 3000 });
    const day = advance(fleet, [flight], 3600 + 3600, 3600);
    expect(day.stops).toHaveLength(7);
    const kinds = day.stops.map((ref) => fleet.graph.stands.find((s) => s.ref === ref)!.kind);
    expect(kinds.filter((kind) => kind === 'remote')).toHaveLength(1);
    expect(day.tows).toBe(0);
    expect(day.completed).toBe(1);
    expect(fleet.metrics().departed).toBe(1);
  });

  test('takes a maintenance turn to the hangar apron and back', () => {
    const day = advance(setup(), [turn({ maintenance: true, departureS: 3600 })], 4400);
    expect(day.stops).toContain('M1');
    expect(day.tows).toBe(2);
    expect(day.completed).toBe(2);
  });

  test('frees a contact stand during a long turnaround and departs from the remote apron', () => {
    const day = advance(setup(), [turn({ departureS: 5400 })], 6500);
    expect(day.stops).toEqual(['4', 'R2']);
    expect(day.tows).toBe(1);
    expect(day.completed).toBe(2);
  });

  test('counts an arrival in the off-map hold once and diverts it after 30 minutes', () => {
    const fleet = setup();
    for (const stand of fleet.graph.stands.filter(
      (s) => s.kind !== 'maintenance' && fleet.standAdmits(s.idx, 'E190'),
    ))
      expect(fleet.spawnParked({ typeId: 'E190', stand: stand.id }).ok).toBe(true);
    const operations = createFlightOperations(fleet, 1, 0, [turn()]);
    operations.step(0);
    operations.step(30);
    expect(operations.metrics()).toMatchObject({ holding: 1, held: 1, diverted: 0 });
    expect(operations.board(30).arrivals[0]?.state).toBe('holding for stand');
    operations.step(1800);
    expect(operations.metrics()).toMatchObject({ holding: 0, held: 1, diverted: 1 });
    expect(operations.board(1800).departures[0]?.state).toBe('cancelled');
  });

  test('runs a helicopter turnaround at a helipad independently of runway flights', () => {
    const fleet = setup();
    const operations = createFlightOperations(fleet, 1, 0, [
      turn({ typeId: 'EC45', standKind: 'helipad', standCode: null, departureS: 900 }),
    ]);
    for (let timeS = 0; timeS <= 2400; timeS++) {
      operations.step(timeS);
      fleet.step(timeS);
    }
    const board = operations.board(2400);
    expect(board.arrivals[0]).toMatchObject({ stand: 'H1', state: 'arrived' });
    expect(board.departures[0]).toMatchObject({ stand: 'H1', state: 'departed' });
    expect(operations.metrics().completed).toBe(2);
  });
});
