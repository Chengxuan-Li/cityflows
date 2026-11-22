import { describe, expect, it } from 'vitest';
import {
  generateFlightSchedule,
  largeAirportSchedule,
  londonCitySchedule,
  type FlightScheduleInput,
  type ScheduledFlight,
} from '../../src/demand/flight-schedule';
import { aircraftCode, aircraftTurnaroundMinutes, aircraftTypes } from '../../src/schema/aircraft';

const hourS = 3600;
const dayS = 24 * hourS;
const london: FlightScheduleInput = {
  ...londonCitySchedule,
  runwayCount: 1,
  stands: [{ kind: 'contact', code: 'C', count: 19 }],
};

function movementTimes(flights: readonly ScheduledFlight[]): number[] {
  return flights.flatMap(({ arrivalS, departureS }) =>
    [arrivalS, departureS].filter((time) => time >= 0 && time < dayS),
  );
}

describe('flight schedule', () => {
  it('replays the day by seed and produces two peaks within the London City curfew', () => {
    const flights = generateFlightSchedule(london, 42);
    expect(generateFlightSchedule(london, 42)).toEqual(flights);
    expect(generateFlightSchedule(london, 43)).not.toEqual(flights);
    const movements = movementTimes(flights);
    expect(movements).toHaveLength(150);
    expect(movements.every((time) => time >= 6 * hourS && time < 22 * hourS)).toBe(true);
    const between = (start: number, end: number) =>
      movements.filter((time) => time >= start * hourS && time < end * hourS).length;
    expect(between(7, 10)).toBeGreaterThan(between(12, 15) * 1.5);
    expect(between(16, 19)).toBeGreaterThan(between(12, 15) * 1.5);
    expect(
      new Set(flights.map(({ typeId }) => aircraftTypes.find((type) => type.id === typeId)?.class)),
    ).toEqual(new Set(['regional_jet', 'propeller', 'narrowbody', 'private']));
    const carryIn = flights.filter(({ arrivalS }) => arrivalS < 0);
    const carryOut = flights.filter(({ departureS }) => departureS >= dayS);
    expect(carryIn).toHaveLength(9);
    expect(carryOut).toHaveLength(9);
    expect(carryIn.every(({ overnight }) => overnight)).toBe(true);
  });

  it('uses only compatible types and kinds, with the catalogue turnaround for each type', () => {
    const flights = generateFlightSchedule(
      {
        ...largeAirportSchedule,
        runwayCount: 2,
        stands: [
          { kind: 'contact', code: 'B', count: 2 },
          { kind: 'general_aviation', code: 'B', count: 3 },
          { kind: 'remote', code: 'C', count: 5 },
        ],
        dailyMovements: 77,
        overnightShare: 0,
        typeMix: [
          { typeId: 'A388', weight: 100 },
          { typeId: 'E190', weight: 3 },
          { typeId: 'C25C', weight: 1 },
        ],
      },
      7,
    );
    expect(movementTimes(flights)).toHaveLength(77);
    expect(new Set(flights.map(({ typeId }) => typeId))).toEqual(new Set(['E190', 'C25C']));
    for (const flight of flights) {
      const type = aircraftTypes.find(({ id }) => id === flight.typeId)!;
      expect(flight.standCode).toBe(aircraftCode(type));
      expect(flight.standKind).toBe(type.id === 'E190' ? 'remote' : 'general_aviation');
      const turnaroundS = aircraftTurnaroundMinutes[type.id]! * 60;
      expect(flight.departureS - flight.arrivalS).toBeGreaterThanOrEqual(turnaroundS - 1e-6);
      if (!flight.overnight) {
        expect(flight.departureS - flight.arrivalS).toBeCloseTo(turnaroundS);
      }
    }
  });

  it('derives volume from stands, with a runway capacity bound and a non-wrapping curfew', () => {
    const input: FlightScheduleInput = {
      ...largeAirportSchedule,
      runwayCount: 1,
      stands: [{ kind: 'contact', code: 'F', count: 300 }],
      turnsPerStand: 1,
      hourlyProfile: Array<number>(24).fill(1),
      curfew: { startS: 1.5 * hourS, endS: 2.5 * hourS },
    };
    const movements = movementTimes(generateFlightSchedule(input, 1));
    expect(movements).toHaveLength(600);
    expect(movements.every((time) => time < 1.5 * hourS || time >= 2.5 * hourS)).toBe(true);
    expect(
      movementTimes(
        generateFlightSchedule({ ...input, curfew: { startS: 4 * hourS, endS: 0 } }, 1),
      ),
    ).toHaveLength(160);
    expect(
      movementTimes(
        generateFlightSchedule(
          {
            ...input,
            stands: [
              { kind: 'contact', code: 'F', count: 5 },
              { kind: 'contact', code: 'A', count: 100 },
            ],
          },
          1,
        ),
      ),
    ).toHaveLength(10);
  });

  it('adds helicopter movements only with pads and flags tows to compatible stands', () => {
    const input: FlightScheduleInput = {
      ...london,
      stands: [
        ...london.stands,
        { kind: 'remote', code: 'C', count: 1 },
        { kind: 'maintenance', code: 'B', count: 1 },
      ],
      typeMix: [
        { typeId: 'E190', weight: 1 },
        { typeId: 'C25C', weight: 1 },
        { typeId: 'EC45', weight: 1 },
      ],
      maintenanceRate: 1,
      irregularTowRate: 1,
      helicopterMovements: 5,
    };
    expect(movementTimes(generateFlightSchedule(input, 5))).toHaveLength(150);
    const flights = generateFlightSchedule({ ...input, helipadCount: 1 }, 5);
    expect(movementTimes(flights)).toHaveLength(155);
    expect(movementTimes(flights.filter(({ standKind }) => standKind === 'helipad'))).toHaveLength(
      5,
    );
    for (const flight of flights) {
      expect(flight.maintenance).toBe(flight.typeId === 'C25C');
      expect(flight.irregularTow).toBe(flight.typeId !== 'EC45');
      if (flight.typeId === 'EC45') expect(flight.standCode).toBeNull();
    }
  });
});
