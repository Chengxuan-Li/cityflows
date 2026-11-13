import { createRandom } from '../geo/random';
import {
  DEFAULT_MODE_CHOICE,
  type ModeChoiceConfig,
  type Scenario,
  type TripRequest,
} from '../schema';

/** The alternatives a trip can take, in draw order. */
export const modeAlternatives = ['walk', 'car', 'transit'] as const;
export type ModeAlternative = (typeof modeAlternatives)[number];

/** What a trip's alternatives cost at departure. An absent alternative is not on offer. */
export interface ModeInputs {
  /** Door-to-door walk on the walk graph; absent without a walk route. */
  walkS?: number;
  /** Absent without a free household car at the origin. Access and egress are the walks to and
   * from the parked car, search the expected parking search at the destination. */
  car?: { accessS: number; driveS: number; searchS: number; egressS: number; distanceM: number };
  /** TASK-174: absent without a transit plan that walks less than the direct walk. Walking to the
   * first stop, between stops and from the last (platforms included), waiting at stops (the first
   * and at transfers), riding (dwells on board included), and the number of transfers. */
  transit?: { walkS: number; waitS: number; rideS: number; transfers: number };
}

/** TASK-174: the transit alternative's constants (no settings). In-vehicle time counts this many
 * times a minute walked or waited; each transfer costs this many minutes; the fare is a flat
 * expected cost per trip, between a short-trip ticket and nothing for pass holders (an assumption). */
export const TRANSIT_CHOICE = { comfort: 1.1, transferMin: 5, fareEur: 1 };

/** The weights the transit router minimizes: the generalized cost without the fare, which is the
 * same for every plan. */
export const transitWeights = {
  ride: TRANSIT_CHOICE.comfort,
  wait: 1,
  transferS: 60 * TRANSIT_CHOICE.transferMin,
};

export interface ModePreferences {
  walkMin: number;
  valueOfTimePerH: number;
}

/** Spread of the persons' preferences around the configured means (no settings). */
export const WALK_PREFERENCE_SD_MIN = 6;
export const VALUE_OF_TIME_SIGMA = 0.5;

export const modeChoiceConfig = (scenario: Scenario): ModeChoiceConfig => ({
  ...DEFAULT_MODE_CHOICE,
  ...scenario.demand.modeChoice,
});

/** A person's walk preference and value of time, drawn on their own stream of the demand seed.
 * The draws are standard normals scaled by the configuration, so a slider rescales them and moves
 * no draw. */
export function modePreferences(
  demandSeed: number,
  personId: string,
  config: ModeChoiceConfig,
): ModePreferences {
  const random = createRandom(demandSeed).derive('mode-preferences').derive(personId);
  const walk = random.normal(0, 1);
  const time = random.normal(0, 1);
  return {
    walkMin: config.walkPreferenceMin + WALK_PREFERENCE_SD_MIN * walk,
    valueOfTimePerH: config.valueOfTimePerH * Math.exp(VALUE_OF_TIME_SIGMA * time),
  };
}

/** Generalized cost in minutes of each offered alternative. */
export function generalizedMinutes(
  inputs: ModeInputs,
  preferences: ModePreferences,
  config: ModeChoiceConfig,
): Partial<Record<ModeAlternative, number>> {
  const costs: Partial<Record<ModeAlternative, number>> = {};
  if (inputs.walkS !== undefined) costs.walk = inputs.walkS / 60 - preferences.walkMin;
  if (inputs.car) {
    const { accessS, driveS, searchS, egressS, distanceM } = inputs.car;
    costs.car =
      (accessS + driveS + searchS + egressS) / 60 +
      (60 * config.carCostPerKm * distanceM) / 1000 / preferences.valueOfTimePerH;
  }
  if (inputs.transit) {
    const { walkS, waitS, rideS, transfers } = inputs.transit;
    costs.transit =
      (walkS + waitS + TRANSIT_CHOICE.comfort * rideS) / 60 +
      TRANSIT_CHOICE.transferMin * transfers +
      (60 * TRANSIT_CHOICE.fareEur) / preferences.valueOfTimePerH;
  }
  return costs;
}

/** Multinomial logit over the offered alternatives. */
export function modeProbabilities(
  inputs: ModeInputs,
  preferences: ModePreferences,
  config: ModeChoiceConfig,
): Partial<Record<ModeAlternative, number>> {
  const costs = generalizedMinutes(inputs, preferences, config);
  const offered = modeAlternatives.filter((mode) => costs[mode] !== undefined);
  const least = Math.min(...offered.map((mode) => costs[mode]!));
  const weights = offered.map((mode) =>
    Math.exp(-config.sensitivityPerMin * (costs[mode]! - least)),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(offered.map((mode, i) => [mode, weights[i]! / total]));
}

/** The trip's own draw on the scenario seed: no other stream moves when a slider does. */
export function modeDraw(scenarioSeed: number, tripId: string) {
  return createRandom(scenarioSeed).derive('mode-choice').derive(tripId).next();
}

/** TASK-113: the home-based tours in the choice, each its trip ids in departure order. A tour of a
 * person with today's household car (TASK-129) runs from a departure at home to the next return
 * home (or the person's last car trip); the car is at home when it starts and stays with its driver
 * until it is back. `eligible` says whether a car trip may walk (a private car trip between two
 * places a person can walk to); a tour with any other trip keeps its car. None when the choice is
 * off. TASK-173: the engine chooses each tour's mode when its first trip starts (`chooseTour`).
 * TASK-174: with `walkers`, the tours of persons walking all day (no free household car) join,
 * to choose between walk and transit; `eligible` then also decides which walk trips may. */
export function modeTours(
  trips: readonly TripRequest[],
  scenario: Scenario,
  eligible: (trip: TripRequest) => boolean,
  walkers = false,
): number[][] {
  if (!modeChoiceConfig(scenario).enabled) return [];
  const byPerson = new Map<string, number[]>();
  const order = trips
    .map((_, id) => id)
    .sort((a, b) => trips[a]!.departS - trips[b]!.departS || a - b);
  for (const id of order) {
    const { personId, carId, mode } = trips[id]!;
    const car = carId !== undefined && mode === 'car';
    if (personId === null || !(car || (walkers && mode === 'walk' && carId === undefined)))
      continue;
    const chain = byPerson.get(personId);
    if (chain) chain.push(id);
    else byPerson.set(personId, [id]);
  }
  const tours: number[][] = [];
  for (const chain of byPerson.values()) {
    const home = trips[chain[0]!]!.originPlaceId;
    for (let start = 0; start < chain.length;) {
      let end = start;
      while (end < chain.length - 1 && trips[chain[end]!]!.destinationPlaceId !== home) end++;
      const tour = chain.slice(start, end + 1);
      start = end + 1;
      if (trips[tour[0]!]!.originPlaceId === home && tour.every((id) => eligible(trips[id]!)))
        tours.push(tour);
    }
  }
  return tours;
}

/** A tour's choice from the inputs at its first departure: the probabilities, and the mode its
 * first trip's own draw picks, by cumulative probability in the order walk, car, transit. Without
 * transit on offer every draw picks as TASK-113's walk-or-car draw did. */
export function chooseTour(scenario: Scenario, firstTrip: TripRequest, inputs: ModeInputs) {
  const config = modeChoiceConfig(scenario);
  const preferences = modePreferences(scenario.demand.seed, firstTrip.personId!, config);
  const probabilities = modeProbabilities(inputs, preferences, config);
  const draw = modeDraw(scenario.seed, firstTrip.id);
  let sum = 0;
  const offered = modeAlternatives.filter((mode) => probabilities[mode] !== undefined);
  const mode = offered.find((m) => draw < (sum += probabilities[m]!)) ?? offered.at(-1) ?? 'walk';
  return { probabilities, walkProbability: probabilities.walk ?? 0, mode, walk: mode === 'walk' };
}

/** TASK-174: a trip of a tour that takes transit: mode `rail` (tram or S-Bahn), no household car.
 * The engine routes each such trip as it departs. */
export function transitTrip(trip: TripRequest): TripRequest {
  const ridden: TripRequest = {
    ...trip,
    mode: 'rail',
    legs: trip.legs.map((leg) => ({ ...leg, mode: 'rail' })),
  };
  delete ridden.carId;
  return ridden;
}

/** A car trip as part of a tour that walks: every leg on foot, no household car. */
export function walkTrip(trip: TripRequest): TripRequest {
  const walked: TripRequest = {
    ...trip,
    mode: 'walk',
    legs: trip.legs.map((leg) => ({ ...leg, mode: 'walk' })),
  };
  delete walked.carId;
  return walked;
}
