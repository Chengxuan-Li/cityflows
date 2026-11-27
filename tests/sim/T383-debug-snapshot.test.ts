import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { syntheticAirport } from '../../src/fixtures/synthetic-airport';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { markRings, type WaitLink } from '../../src/sim/debug-snapshot';
import { createEngine } from '../../src/sim/engine';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { scenario, setup, trips } from './fixtures';

// TASK-383: the debug views' sim state is read only: asking for it leaves the run, its hashes and
// its snapshots as they are.

test('T383 debug snapshots leave the run and its hashes unchanged', () => {
  const city = grid5x5();
  const input = { compiled: setup(city), scenario: scenario(), trips: trips(city, 80, 1) };
  const plain = createEngine();
  const watched = createEngine();
  plain.load(input);
  watched.load(input);
  let leaders = 0;
  for (let i = 0; i < 1500; i++) {
    plain.step();
    watched.step();
    if (i % 25) continue;
    const { debug, ...snapshot } = watched.snapshot({ vehicles: true, gridlock: true });
    const { debug: none, ...reference } = plain.snapshot();
    expect(none).toBeUndefined();
    expect(snapshot).toEqual(reference);
    expect(watched.stateHash()).toBe(plain.stateHash());
    expect(debug!.vehicles).toHaveLength(snapshot.count);
    for (const vehicle of debug!.vehicles!) {
      expect([...snapshot.id]).toContain(vehicle.id);
      if (!vehicle.leader) continue;
      leaders++;
      expect([...snapshot.id]).toContain(vehicle.leader);
      // The gap to the leader's rear: never far inside it.
      expect(vehicle.gapM).toBeGreaterThan(-1);
    }
    for (const link of debug!.vehicleWaits!) expect(link.from).not.toBe(link.to);
  }
  expect(leaders).toBeGreaterThan(0);
});

test('T383 aircraft debug state leaves the fleet unchanged', () => {
  const result = setup(syntheticAirport(1));
  const schedule = [0, 300, 600].map((arrivalS, i) => ({
    id: `flight:${i}`,
    typeId: 'E190',
    arrivalS,
    departureS: arrivalS + 2100,
    standKind: 'contact' as const,
    standCode: 'C' as const,
    overnight: false,
    maintenance: false,
    irregularTow: false,
  }));
  const fleets = [0, 1].map(() => createAircraftFleet(result.airside!, 1));
  const operations = fleets.map((fleet) => createFlightOperations(fleet, 1, 0, schedule));
  let reserved = 0;
  for (let timeS = 0; timeS <= 3600; timeS++) {
    for (let k = 0; k < 2; k++) {
      operations[k]!.step(timeS);
      fleets[k]!.step(timeS);
    }
    if (timeS % 30) continue;
    const debug = fleets[1]!.debugSnapshot();
    reserved += debug.aircraft.reduce((sum, a) => sum + a.reserved.length, 0);
    for (const craft of debug.aircraft) expect(craft.radiusM).toBeGreaterThanOrEqual(0);
    expect(fleets[1]!.snapshot()).toEqual(fleets[0]!.snapshot());
  }
  expect(reserved).toBeGreaterThan(0);
});

test('T383 wait-for links on a closed ring are marked, chains into it are not', () => {
  const link = (from: number, to: number): WaitLink => ({ from, to, ring: false });
  const links = markRings([link(1, 2), link(2, 3), link(3, 1), link(4, 1), link(5, 4), link(6, 7)]);
  expect(links.map((l) => l.ring)).toEqual([true, true, true, false, false, false]);
  // A long standing queue does not overflow the stack.
  const queue = Array.from({ length: 50_000 }, (_, i) => link(i + 1, i));
  expect(markRings(queue).some((l) => l.ring)).toBe(false);
  expect(markRings([...queue, link(0, 50_000)]).every((l) => l.ring)).toBe(true);
});
