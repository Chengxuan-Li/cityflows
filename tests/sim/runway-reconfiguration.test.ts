import { describe, expect, test } from 'vitest';
import type { ScheduledFlight } from '../../src/demand/flight-schedule';
import { syntheticAirport } from '../../src/fixtures/synthetic-airport';
import { compile } from '../../src/network';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { windComponents, type AirportWind } from '../../src/sim/runway-configuration';
import { exemptRunwayPair, overlaps } from './aircraft-checks';

// TASK-300: a wind reversal mid-morning on the synthetic one-runway airport. Departures leave
// from 09:50 toward 09; the wind turns at 10:00, so the airport changes to 27 while some taxi.

const hourS = 3600;
const easterly: AirportWind = { fromDeg: 90, speedKt: 10 };
const westerly: AirportWind = { fromDeg: 270, speedKt: 12 };
const switchS = 10 * hourS;

function schedule(): ScheduledFlight[] {
  const turn = (i: number, arrivalS: number, departureS: number): ScheduledFlight => ({
    id: `flight:${i}`,
    typeId: i % 2 ? 'E190' : 'A20N',
    arrivalS,
    departureS,
    standKind: 'contact',
    standCode: 'C',
    overnight: false,
    maintenance: false,
    irregularTow: false,
  });
  return [
    // Parked at the start, leaving from 09:56.
    ...[0, 1, 2, 3, 4].map((i) => turn(i, 8 * hourS, switchS - 240 + i * 120)),
    // Arriving during and after the change: the first is on final when it begins.
    turn(5, switchS + 30, switchS + 3600),
    turn(6, switchS + 600, switchS + 4200),
  ];
}

function run() {
  const result = compile(syntheticAirport());
  if (!result.ok || !result.compiled.airside) throw new Error('Synthetic airport must compile');
  const fleet = createAircraftFleet(result.compiled.airside, 1);
  const operations = createFlightOperations(fleet, 1, 9 * hourS, schedule(), { wind: easterly });
  const ends = new Map(
    fleet.graph.runways.flatMap((r) => r.ends.map((e) => [e.designator, e.heading] as const)),
  );
  const taxiingAtSwitch = new Set<number>();
  const onFinalAtSwitch = new Set<number>();
  const takeoffEnd = new Map<number, string>();
  const landingEnd = new Map<number, string>();
  let overlapCount = 0;
  let runwayConflicts = 0;
  let peakStuck = 0;
  let tailwindViolations = 0;
  let wind = easterly;
  let hash = 0;
  const word = (h: number, v: number) => (Math.imul(h ^ v, 16777619) >>> 0) as number;
  for (let timeS = 9 * hourS; timeS <= 12 * hourS; timeS++) {
    if (timeS === switchS) {
      wind = westerly;
      operations.setWind(wind);
      for (const a of fleet.snapshot())
        if ((a.state === 'taxi' || a.state === 'holding') && a.runwayEnd === '09')
          taxiingAtSwitch.add(a.id);
        else if (a.state === 'approach') onFinalAtSwitch.add(a.id);
    }
    operations.step(timeS);
    fleet.step(timeS);
    const aircraft = fleet.snapshot();
    overlapCount += overlaps(aircraft).length;
    // TASK-330: one aircraft on the runway at a time, but for the sharing the owner approved
    // (TASK-345: crossings together or behind a landing roll, a line-up behind a roll).
    const on = aircraft.filter((a) => a.onRunway);
    runwayConflicts += Number(
      on.some((a, i) => on.slice(i + 1).some((b) => !exemptRunwayPair(a, b))),
    );
    peakStuck = Math.max(peakStuck, fleet.metrics().stuck);
    for (const a of aircraft) {
      if (a.state === 'takeoff-roll') takeoffEnd.set(a.id, a.runwayEnd!);
      if (a.state === 'landing-roll') landingEnd.set(a.id, a.runwayEnd!);
    }
    // While no change is in progress, every open end keeps the tailwind limit.
    const runways = fleet.airfield().runways!;
    if (!runways.switching)
      for (const end of [...runways.arrivalEnds, ...runways.departureEnds])
        if (-windComponents(ends.get(end)!, wind).headwindKt > 5) tailwindViolations++;
    hash = fleet.hash(word, hash);
  }
  operations.step(12 * hourS + 1);
  return {
    metrics: operations.metrics(),
    aircraft: fleet.metrics(),
    transitions: fleet.runwayTransitions(),
    taxiingAtSwitch,
    onFinalAtSwitch,
    takeoffEnd,
    landingEnd,
    overlapCount,
    runwayConflicts,
    peakStuck,
    tailwindViolations,
    hash,
  };
}

describe('runway reconfiguration on the synthetic airport', () => {
  test('a wind reversal switches 09 to 27, re-routes the taxiing departures and stays deterministic', () => {
    const day = run();
    console.info({
      transitions: day.transitions,
      taxiingAtSwitch: day.taxiingAtSwitch.size,
      onFinalAtSwitch: day.onFinalAtSwitch.size,
    });
    expect(day.transitions).toHaveLength(1);
    const [change] = day.transitions;
    expect(change).toMatchObject({ fromId: '09', toId: '27', startS: switchS });
    // The arrival on final lands on 09; the new end opens once it has vacated.
    expect(day.onFinalAtSwitch.size).toBe(1);
    expect(change!.openS).toBeGreaterThan(switchS + 20);
    expect(day.metrics.completed).toBe(day.metrics.scheduled);
    expect(day.taxiingAtSwitch.size).toBeGreaterThan(0);
    expect(change!.rerouted).toBe(day.taxiingAtSwitch.size);
    for (const id of day.taxiingAtSwitch) expect(day.takeoffEnd.get(id)).toBe('27');
    // No line-up or approach on the old end once the change began.
    for (const [id, end] of day.landingEnd)
      expect(end).toBe(day.onFinalAtSwitch.has(id) ? '09' : '27');
    expect(day.landingEnd.size).toBe(2);
    expect(day.overlapCount).toBe(0);
    expect(day.runwayConflicts).toBe(0);
    expect(day.peakStuck).toBe(0);
    expect(day.aircraft.goArounds).toBe(0);
    expect(day.tailwindViolations).toBe(0);
    expect(run().hash).toBe(day.hash);
  });

  test('changes at a concept boundary, and on wind only past the limits', () => {
    const result = compile(syntheticAirport());
    if (!result.ok || !result.compiled.airside) throw new Error('Synthetic airport must compile');
    const fleet = createAircraftFleet(result.compiled.airside, 1);
    const operations = createFlightOperations(fleet, 1, 9 * hourS, [], {
      wind: { fromDeg: 0, speedKt: 0 },
      runways: {
        concepts: [
          { startS: 6 * hourS, endS: 10 * hourS, configurationId: '09' },
          { startS: 10 * hourS, endS: 22 * hourS, configurationId: '27' },
          { startS: 22 * hourS, endS: 6 * hourS, configurationId: null },
        ],
      },
    });
    const at = (timeS: number) => {
      operations.step(timeS);
      fleet.step(timeS);
      return fleet.airfield().runways!;
    };
    expect(at(9 * hourS)).toMatchObject({ configuration: '09', arrivalEnds: ['09'] });
    expect(at(10 * hourS + 1)).toMatchObject({ configuration: '27', departureEnds: ['27'] });
    // A tailwind of 4 kt on 27 keeps it; 8 kt changes to 09 within the concept's period.
    operations.setWind({ fromDeg: 90, speedKt: 4 });
    expect(at(11 * hourS)).toMatchObject({ configuration: '27' });
    operations.setWind({ fromDeg: 90, speedKt: 8 });
    expect(at(11 * hourS + 1)).toMatchObject({ configuration: '09' });
    // The night concept closes the runway.
    expect(at(22 * hourS)).toMatchObject({ configuration: null, arrivalEnds: [] });
    expect(fleet.runwayTransitions().map(({ toId }) => toId)).toEqual(['27', '09', null]);
  });
});
