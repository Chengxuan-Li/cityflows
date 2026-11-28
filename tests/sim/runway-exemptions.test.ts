import { describe, expect, it } from 'vitest';
import type { AircraftPoseSnapshot } from '../../src/sim/aircraft';
import { exemptRunwayPair } from './aircraft-checks';

// TASK-345: the runway sharing the owner approved on 2026-11-24.
const pose = (state: string, x: number, heading = 0, runwayEnd: string | null = null) =>
  ({
    id: 1,
    registration: state + x,
    typeId: 'A20N',
    x,
    y: 0,
    heightM: 0,
    heading,
    speedMps: 0,
    state,
    enginesRunning: true,
    onRunway: true,
    airborne: false,
    gearDown: true,
    stand: null,
    runwayEnd,
    route: [],
  }) as unknown as AircraftPoseSnapshot;

describe('exemptRunwayPair', () => {
  it('lets two crossings share a runway', () => {
    expect(exemptRunwayPair(pose('taxi', 0), pose('tow', 50))).toBe(true);
  });
  it('lets a crossing go at least 150 m behind a landing roll', () => {
    expect(exemptRunwayPair(pose('taxi', 0), pose('landing-roll', 200))).toBe(true);
    expect(exemptRunwayPair(pose('taxi', 0), pose('landing-roll', 100))).toBe(false);
    expect(exemptRunwayPair(pose('taxi', 300), pose('landing-roll', 0))).toBe(false);
  });
  it('lets a departure line up behind one rolling away', () => {
    expect(exemptRunwayPair(pose('line-up', 0), pose('takeoff-roll', 80))).toBe(true);
    expect(exemptRunwayPair(pose('line-up', 100), pose('takeoff-roll', 0))).toBe(false);
  });
  it('lets a departure line up behind a roll that started behind its entry (TASK-360 rule 2)', () => {
    // The roller passed the line-up at x = 0 and is 400 m on; one rolling toward it is a conflict.
    expect(exemptRunwayPair(pose('line-up', 0), pose('takeoff-roll', 400))).toBe(true);
    expect(exemptRunwayPair(pose('line-up', 0), pose('takeoff-roll', -400))).toBe(false);
    expect(exemptRunwayPair(pose('takeoff-roll', 0), pose('takeoff-roll', 400))).toBe(false);
    expect(exemptRunwayPair(pose('takeoff-roll', 0), pose('rotation', 400, Math.PI))).toBe(false);
  });
  it('lets two departures stand lined up one behind the other (TASK-360 rule 3)', () => {
    const lined = (x: number, end: string | null = '09') => pose('line-up', x, 0, end);
    expect(exemptRunwayPair(lined(0), lined(300))).toBe(true);
    expect(exemptRunwayPair(lined(300), lined(0))).toBe(true);
    // Nose past the other's tail (two A20N, 37.6 m long), other ends, or no end: not exempt.
    expect(exemptRunwayPair(lined(0), lined(30))).toBe(false);
    expect(exemptRunwayPair(lined(0), lined(300, '27'))).toBe(false);
    expect(exemptRunwayPair(lined(0, null), lined(300, null))).toBe(false);
  });
  it('keeps them in line while the front one still turns onto the runway (TASK-367)', () => {
    // As Heathrow peak seed 1 at 08:42: the front one, 1.1 km ahead, still swings onto 27R.
    const rear = pose('line-up', 1268, Math.PI, '27R');
    const turning = (heading: number) => pose('line-up', 144, heading, '27R');
    expect(exemptRunwayPair(rear, turning(-0.35))).toBe(true);
    expect(exemptRunwayPair(turning(-1.12), rear)).toBe(true);
    // One turning in beside it (nose past its tail) is still a conflict, whichever heading.
    expect(exemptRunwayPair(pose('line-up', 1250, -Math.PI / 2, '27R'), rear)).toBe(false);
  });
  it('does not exempt a crossing ahead of a take-off roll', () => {
    expect(exemptRunwayPair(pose('taxi', 300), pose('takeoff-roll', 0))).toBe(false);
  });
});
