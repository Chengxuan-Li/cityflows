import { describe, expect, it } from 'vitest';
import type { AircraftPoseSnapshot } from '../../src/sim/aircraft';
import { exemptRunwayPair } from './aircraft-checks';

// TASK-345: the runway sharing the owner approved on 2026-11-24.
const pose = (state: string, x: number, heading = 0): AircraftPoseSnapshot =>
  ({
    id: 1,
    registration: state + x,
    typeId: 'A320',
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
    runwayEnd: null,
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
  it('does not exempt a crossing ahead of a take-off roll', () => {
    expect(exemptRunwayPair(pose('taxi', 300), pose('takeoff-roll', 0))).toBe(false);
  });
});
