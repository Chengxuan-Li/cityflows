import { describe, expect, test } from 'vitest';
import { aircraftTypes } from '../../src/schema/aircraft';
import {
  aircraftHull,
  boxesOverlap,
  CLEAR_BEFORE_READY_S,
  standWays,
  turnaroundVisits,
} from '../../src/sim/ground-vehicles';

// TASK-316: a turnaround's vehicle set and timeline, and the equipment positions around the
// parked aircraft with their ways in and out.

const type = (id: string) => aircraftTypes.find((t) => t.id === id)!;
const onBlock = 36_000;

describe('turnaround vehicle sets and timelines', () => {
  test('a narrowbody at a contact stand: baggage, hydrant, catering and the tug', () => {
    const ready = onBlock + 45 * 60;
    const visits = turnaroundVisits(type('A20N'), 'contact', onBlock, ready, true, true);
    expect(visits.map((v) => `${v.slot}:${v.kind}`).sort()).toEqual([
      'baggage-aft:baggage',
      'catering:catering',
      'fuel:hydrant',
      'tug:tug',
    ]);
    for (const visit of visits) {
      expect(visit.arriveS).toBeGreaterThanOrEqual(onBlock + 60);
      if (visit.slot === 'tug') expect(visit.arriveS).toBe(ready - 240);
      else expect(visit.leaveS).toBeLessThanOrEqual(ready - CLEAR_BEFORE_READY_S);
    }
    expect(visits.find((v) => v.slot === 'baggage-aft')!.carts).toBe(2);
  });

  test('a regional jet at a remote stand: buses off and on, a fuel truck, no hydrant', () => {
    const ready = onBlock + 35 * 60;
    const visits = turnaroundVisits(type('E190'), 'remote', onBlock, ready, true, true);
    const buses = visits.filter((v) => v.slot === 'bus');
    expect(buses).toHaveLength(2);
    expect(buses[0]!.arriveS).toBe(onBlock + 60);
    expect(buses[1]!.leaveS).toBe(ready - CLEAR_BEFORE_READY_S - 60);
    expect(visits.find((v) => v.slot === 'fuel')!.kind).toBe('fuel');
  });

  test('a widebody gets two baggage trains; a business jet only fuel; a helicopter nothing', () => {
    const wide = turnaroundVisits(type('B77W'), 'contact', onBlock, onBlock + 90 * 60, true, true);
    expect(wide.filter((v) => v.kind === 'baggage').map((v) => v.slot)).toEqual(
      expect.arrayContaining(['baggage-aft', 'baggage-fwd']),
    );
    expect(wide.find((v) => v.kind === 'baggage')!.carts).toBe(3);
    const jet = turnaroundVisits(
      type('C25C'),
      'general_aviation',
      onBlock,
      onBlock + 3600,
      true,
      false,
    );
    expect(jet.map((v) => v.kind)).toEqual(['fuel']);
    expect(turnaroundVisits(type('EC45'), 'contact', onBlock, onBlock + 3600, true, true)).toEqual(
      [],
    );
  });

  test('a long turn splits the baggage visit around the stay; one parked overnight only loads', () => {
    const long = turnaroundVisits(type('A20N'), 'contact', onBlock, onBlock + 4 * 3600, true, true);
    expect(long.filter((v) => v.slot === 'baggage-aft')).toHaveLength(2);
    const overnight = turnaroundVisits(type('A20N'), 'contact', 0, 7 * 3600, false, true);
    expect(overnight.filter((v) => v.slot === 'baggage-aft')).toHaveLength(1);
  });
});

describe('equipment positions', () => {
  test.for(['A20N', 'E190', 'B77W', 'AT76'])(
    '%s: positions clear of the hull and of each other',
    (id) => {
      const aircraft = type(id);
      const pose = { x: 0, y: 0, heading: 0.3 };
      const visits = turnaroundVisits(aircraft, 'remote', 0, 3600, true, true);
      // The service lane 20 m behind the tail.
      const off = aircraft.lengthM / 2 + 20;
      const back = { x: -Math.cos(0.3) * off, y: -Math.sin(0.3) * off };
      const merge = { x: back.x + 12, y: back.y - 6 };
      const ways = standWays(aircraft, pose, visits, back, merge, []);
      expect([...ways.keys()].length).toBeGreaterThanOrEqual(Math.min(4, visits.length));
      const hull = aircraftHull(aircraft, pose);
      const footprints = [...ways.values()].map((w) => w.footprint);
      for (const [i, a] of footprints.entries()) {
        expect(hull.some((h) => boxesOverlap(a, h))).toBe(false);
        for (const b of footprints.slice(i + 1)) expect(boxesOverlap(a, b)).toBe(false);
      }
    },
  );
});
