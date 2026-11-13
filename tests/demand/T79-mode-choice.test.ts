import { describe, expect, test } from 'vitest';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import {
  chooseTour,
  generalizedMinutes,
  modeDraw,
  modePreferences,
  modeProbabilities,
  modeTours,
  walkTrip,
  type ModeInputs,
} from '../../src/demand/mode-choice';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import {
  DEFAULT_MODE_CHOICE,
  type Person,
  type Scenario,
  type TripRequest,
} from '../../src/schema';
import { demandConfigSchema } from '../../src/schema/demand.schema';

const config = DEFAULT_MODE_CHOICE;
const car = { accessS: 60, driveS: 240, searchS: 0, egressS: 30, distanceM: 2000 };

describe('T79 the logit', () => {
  test('probabilities follow the generalized minutes of each offered alternative', () => {
    const preferences = { walkMin: 10, valueOfTimePerH: 12 };
    const inputs: ModeInputs = { walkS: 1200, car };
    const costs = generalizedMinutes(inputs, preferences, config);
    expect(costs.walk).toBeCloseTo(20 - 10);
    // 5.5 minutes door to door plus 2 km at 0.30 EUR/km for a person at 12 EUR/h: 3 minutes.
    expect(costs.car).toBeCloseTo(5.5 + 3);
    const p = modeProbabilities(inputs, preferences, config);
    const expected = 1 / (1 + Math.exp(config.sensitivityPerMin * (costs.walk! - costs.car!)));
    expect(p.walk).toBeCloseTo(expected, 12);
    expect(p.walk! + p.car!).toBeCloseTo(1, 12);
    expect(p.transit).toBeUndefined();
    // A higher value of time makes the car's running cost cheaper in minutes.
    expect(
      modeProbabilities(inputs, { ...preferences, valueOfTimePerH: 40 }, config).car,
    ).toBeGreaterThan(p.car!);
  });

  test('an alternative not on offer has no probability: no car, no drive; no walk route, no walk', () => {
    const preferences = { walkMin: 0, valueOfTimePerH: 12 };
    expect(modeProbabilities({ walkS: 1e6 }, preferences, config)).toEqual({ walk: 1 });
    expect(modeProbabilities({ car }, preferences, config)).toEqual({ car: 1 });
  });

  test('short walks win and long ones lose at the defaults, for a median person', () => {
    const median = { walkMin: config.walkPreferenceMin, valueOfTimePerH: config.valueOfTimePerH };
    // About 1.3 m of walk per metre of straight line, 1.4 m/s; a 10 m/s drive with 90 s of stops.
    const at = (meters: number) =>
      modeProbabilities(
        {
          walkS: (meters * 1.3) / 1.4,
          car: {
            accessS: 30,
            driveS: (meters * 1.3) / 10 + 90,
            searchS: 0,
            egressS: 30,
            distanceM: meters * 1.3,
          },
        },
        median,
        config,
      ).walk!;
    expect(at(500)).toBeGreaterThan(0.9);
    expect(at(1000)).toBeGreaterThan(0.5);
    expect(at(3000)).toBeLessThan(0.05);
  });
});

function townDay(modeChoice?: Scenario['demand']['modeChoice']) {
  const city = town();
  const scenario = defaultScenario('town');
  scenario.demand.personsPerResident = 0.2;
  scenario.demand.carShare = 0.6;
  scenario.demand.chains = { shopShare: 0.5, leisureShare: 0.5 };
  if (modeChoice) scenario.demand.modeChoice = modeChoice;
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  return { city, scenario, persons, trips };
}

/** A walk time and a drive from the places' order in the trip id, enough to spread the choices. */
const inputs = (trips: readonly TripRequest[]) => (id: number) => {
  const meters = 300 + (Number(trips[id]!.id.split(':')[2]) % 12) * 250;
  return { walkS: meters / 1.4, car: { ...car, driveS: meters / 8, distanceM: meters } };
};

/** Every tour in the choice chooses from `inputs`, as the engine does at its departure (TASK-173). */
function chooseAll(
  trips: readonly TripRequest[],
  scenario: Scenario,
  eligible: (trip: TripRequest) => boolean = () => true,
) {
  const chosen = trips.slice();
  const walkProbability: (number | null)[] = trips.map(() => null);
  for (const tour of modeTours(trips, scenario, eligible)) {
    const choice = chooseTour(scenario, trips[tour[0]!]!, inputs(trips)(tour[0]!));
    for (const id of tour) {
      walkProbability[id] = choice.walkProbability;
      if (choice.walk) chosen[id] = walkTrip(trips[id]!);
    }
  }
  return { trips: chosen, walkProbability };
}

/** A person's trips as home-based tours, in departure order. */
function tours(trips: readonly TripRequest[], person: Person) {
  const chain = trips
    .map((trip, id) => ({ trip, id }))
    .filter(({ trip }) => trip.personId === person.id)
    .sort((a, b) => a.trip.departS - b.trip.departS);
  const result: number[][] = [];
  for (const { trip, id } of chain) {
    if (trip.originPlaceId === person.homePlaceId) result.push([]);
    result.at(-1)!.push(id);
  }
  return result;
}

describe('T79 tours', () => {
  test('a person without a free household car never drives, and the choice moves no draw', () => {
    const { scenario, trips } = townDay();
    const { trips: chosen } = chooseAll(trips, scenario);
    expect(chosen.some((trip) => trip.mode === 'walk' && trip.carId === undefined)).toBe(true);
    for (const [id, trip] of chosen.entries()) {
      const before = trips[id]!;
      if (!before.carId) expect(trip).toBe(before);
      if (trip.mode === 'car') expect(trip.carId).toBe(before.carId);
      expect({ ...trip, mode: before.mode, legs: before.legs, carId: before.carId }).toEqual(
        before,
      );
    }
  });

  test('a tour keeps one mode: who walked out walks home, who drove out drives home', () => {
    const { scenario, persons, trips } = townDay();
    const { trips: chosen, walkProbability } = chooseAll(trips, scenario);
    let mixedDays = 0;
    for (const person of persons) {
      const days = tours(trips, person);
      if (!trips[days[0]?.[0] ?? -1]?.carId) continue;
      for (const tour of days) {
        const mode = chosen[tour[0]!]!.mode;
        for (const id of tour) {
          expect(chosen[id]!.mode).toBe(mode);
          expect(chosen[id]!.legs.every((leg) => leg.mode === mode)).toBe(true);
          expect(walkProbability[id]).not.toBeNull();
        }
      }
      if (new Set(days.map((tour) => chosen[tour[0]!]!.mode)).size > 1) mixedDays++;
    }
    // With an evening outing, a day can walk one tour and drive the other.
    expect(mixedDays).toBeGreaterThan(0);
  });

  test('a tour with a trip that cannot walk keeps its car', () => {
    const { scenario, persons, trips } = townDay();
    const { trips: chosen } = chooseAll(trips, scenario, (trip) => trip.vehicleClass === 'car');
    let vanTours = 0;
    for (const person of persons)
      for (const tour of tours(trips, person))
        if (tour.some((id) => trips[id]!.carId && trips[id]!.vehicleClass !== 'car')) {
          vanTours++;
          for (const id of tour) expect(chosen[id]!.mode).toBe('car');
        }
    expect(vanTours).toBeGreaterThan(0);
  });

  test('off, every driver drives as before', () => {
    const { scenario, trips } = townDay({ enabled: false });
    expect(modeTours(trips, scenario, () => true)).toEqual([]);
  });
});

describe('T79 determinism', () => {
  test('the same seed chooses the same modes', () => {
    const a = townDay(),
      b = townDay();
    expect(chooseAll(a.trips, a.scenario).trips).toEqual(chooseAll(b.trips, b.scenario).trips);
  });

  test('sliders rescale the persons’ draws and move no draw, so walking more only adds walks', () => {
    const base = modePreferences(7, 'person:p:3:0', config);
    const changed = modePreferences(7, 'person:p:3:0', {
      ...config,
      walkPreferenceMin: 20,
      valueOfTimePerH: 24,
    });
    expect(changed.walkMin - 20).toBeCloseTo(base.walkMin - config.walkPreferenceMin, 12);
    expect(changed.valueOfTimePerH / 24).toBeCloseTo(
      base.valueOfTimePerH / config.valueOfTimePerH,
      12,
    );
    expect(modeDraw(1, 'person:p:3:0:trip:1')).toBe(modeDraw(1, 'person:p:3:0:trip:1'));

    const walks = (walkPreferenceMin: number) => {
      const { scenario, trips } = townDay({ walkPreferenceMin });
      const { trips: chosen } = chooseAll(trips, scenario);
      return new Set(
        chosen.filter((t, id) => t.mode === 'walk' && trips[id]!.carId).map((t) => t.id),
      );
    };
    const few = walks(5),
      many = walks(25);
    expect(many.size).toBeGreaterThan(few.size);
    for (const id of few) expect(many.has(id)).toBe(true);
  });

  test('saved parameters are optional and round-trip through the schema', () => {
    const { scenario } = townDay({ walkPreferenceMin: 20, enabled: false });
    expect(
      demandConfigSchema.parse(JSON.parse(JSON.stringify(scenario.demand))).modeChoice,
    ).toEqual({
      walkPreferenceMin: 20,
      enabled: false,
    });
    const old = { ...scenario.demand };
    delete old.modeChoice;
    expect(demandConfigSchema.parse(old).modeChoice).toBeUndefined();
  });
});
