import type { Scenario } from '../schema';

const names = {
  grid5x5: '5 × 5 grid',
  town: 'Town',
  station: 'Station',
  signalApproach: 'Four-way signal',
  bypass: 'Expressway bypass',
  ramp: 'Motorway ramps',
  dividedHighway: 'Divided highway',
  shortTurnLane: 'Short turn lane',
  disconnected: 'Disconnected network',
} as const;

export type FixtureId = keyof typeof names;

export function defaultScenario(id: FixtureId, seed = 1): Scenario {
  return {
    id,
    name: names[id],
    seed,
    startS: id === 'station' ? 8 * 3600 : 7 * 3600,
    endS: id === 'station' ? 8 * 3600 + 35 * 60 : 18 * 3600,
    demand: {
      seed,
      personsPerResident: id === 'station' ? 0 : 1,
      carShare: 1,
      workStart: { meanS: 8 * 3600, sdS: 30 * 60 },
      workDuration: { meanS: 9 * 3600, sdS: 3600 },
      gravityScaleM: 5000,
      throughTripsPerHour: Array.from({ length: 24 }, (_, hour) =>
        id === 'station' && hour === 8 ? 180 : 0,
      ),
    },
    simParams: {},
  };
}

export const scenarios = [
  defaultScenario('grid5x5'),
  defaultScenario('town'),
  defaultScenario('station'),
  defaultScenario('signalApproach'),
  defaultScenario('bypass'),
  defaultScenario('ramp'),
  defaultScenario('dividedHighway'),
  defaultScenario('shortTurnLane'),
  defaultScenario('disconnected'),
];
