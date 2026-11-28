import { expect, test } from 'vitest';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { overlaps } from './aircraft-checks';
import { airportFixture } from './airside-fixture';
import { setup } from './fixtures';

// TASK-358: helicopters at a helipad beside a taxiway (tests/sim/airside-fixture.ts, the pad moved
// to 35 m south of the parallel taxiway, short of x = 150): a B777 on the taxiway there reaches over it.

function fleetOf() {
  const { city, stands } = airportFixture();
  city.airport!.helipads['hl:1']!.pos = { x: 115, y: 235 };
  const graph = setup(city).airside!;
  const rest = graph.nodes.findIndex((n) => n.pos.x === 150 && n.pos.y === 200);
  return { stands, rest, fleet: createAircraftFleet(graph, 1) };
}

function run(
  fleet: ReturnType<typeof createAircraftFleet>,
  fromS: number,
  untilS: number,
  at: (timeS: number) => boolean | void = () => {},
) {
  for (let step = Math.round(fromS * 10); step * 0.1 <= untilS; step++) {
    if (at(step / 10)) return step / 10;
    fleet.step(step * 0.1);
    if (step % 10 === 0) expect(overlaps(fleet.snapshot()), `bodies at ${step / 10} s`).toEqual([]);
  }
  return untilS;
}

test('a helicopter hovers short of its pad while an aircraft stands over it, then lands', () => {
  const { fleet, stands, rest } = fleetOf();
  const heavy = fleet.spawnParked({ typeId: 'B77W', stand: stands.E1 });
  if (!heavy.ok) throw new Error('parked');
  expect(fleet.requestTow(heavy.id, { node: rest }).ok).toBe(true);
  let towing = false;
  const restedS = run(fleet, 0, 900, () => {
    towing ||= fleet.statusOf(heavy.id) === 'tow';
    return towing && fleet.idle(heavy.id);
  });
  expect(restedS).toBeLessThan(900);
  const helicopter = fleet.requestHelicopterArrival({
    typeId: 'EC45',
    helipad: 'hl:1',
    headingRad: 0,
  });
  if (!helicopter.ok) throw new Error(helicopter.reason);
  // The approach takes about ten minutes; at its hover point it waits for the B777.
  const pose = () => fleet.snapshot().find((p) => p.id === helicopter.id)!;
  run(fleet, restedS, restedS + 1200);
  expect(pose()).toMatchObject({ state: 'helicopter-approach', speedMps: 0 });
  expect(pose().heightM).toBeGreaterThanOrEqual(19);
  expect(fleet.requestTow(heavy.id, { stand: stands.E1 }).ok).toBe(true);
  const landedS = run(fleet, restedS + 1200, restedS + 2400, () => fleet.idle(helicopter.id));
  expect(landedS).toBeLessThan(restedS + 2400);
  run(fleet, landedS, landedS + 900, () => fleet.metrics().towed === 2);
  expect(fleet.metrics()).toMatchObject({ landed: 1, towed: 2, stuck: 0 });
});

test('a departure passing a helipad waits for its helicopter, which climbs clear first', () => {
  const { fleet, stands } = fleetOf();
  const heavy = fleet.spawnParked({ typeId: 'B77W', stand: stands.E1 });
  const helicopter = fleet.spawnHelicopterParked('EC45', 'hl:1', 0);
  if (!heavy.ok || !helicopter.ok) throw new Error('parked');
  expect(fleet.requestDeparture(heavy.id, '27').ok).toBe(true);
  // The B777 would wait at the pad for good: it keeps its stand while the helicopter stays.
  run(fleet, 0, 300);
  expect(fleet.statusOf(heavy.id)).toBe('ready-for-pushback');
  expect(fleet.requestHelicopterDeparture(helicopter.id, Math.PI / 2).ok).toBe(true);
  run(fleet, 300, 2400, () => fleet.metrics().departed === 2);
  expect(fleet.metrics()).toMatchObject({ departed: 2, stuck: 0 });
});
