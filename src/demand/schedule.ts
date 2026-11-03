import { createRandom } from '../geo/random';
import type { City, Person, Scenario, TripRequest } from '../schema';

const dayS = 24 * 3600;

/** Rebuild each person's daily agenda from their persistent assignments. */
export function scheduleTrips(_city: City, persons: Person[], scenario: Scenario): TripRequest[] {
  const random = createRandom(scenario.seed).derive('schedule');
  const { workStart, workDuration } = scenario.demand;
  const trips: TripRequest[] = [];

  for (const person of persons) {
    const { id, homePlaceId, workPlaceId, hasCar } = person;
    if (workPlaceId === null) {
      person.agenda = [{ kind: 'home', placeId: homePlaceId, startS: 0, durationS: dayS }];
      continue;
    }

    const personRandom = random.derive(id);
    const startS = Math.max(0, personRandom.normal(workStart.meanS, workStart.sdS));
    const durationS = Math.max(0, personRandom.normal(workDuration.meanS, workDuration.sdS));
    const endS = startS + durationS;
    person.agenda = [
      { kind: 'home', placeId: homePlaceId, startS: 0, durationS: startS },
      { kind: 'work', placeId: workPlaceId, startS, durationS },
      { kind: 'home', placeId: homePlaceId, startS: endS, durationS: Math.max(0, dayS - endS) },
    ];

    const mode = hasCar ? 'car' : 'walk';
    for (let i = 1; i < person.agenda.length; i++) {
      const from = person.agenda[i - 1]!;
      const to = person.agenda[i]!;
      trips.push({
        id: `${id}:trip:${i}`,
        personId: id,
        originPlaceId: from.placeId,
        destinationPlaceId: to.placeId,
        departS: to.startS,
        mode,
        legs: [{ mode, fromPlaceId: from.placeId, toPlaceId: to.placeId }],
      });
    }
  }

  return trips.sort((a, b) => a.departS - b.departS || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
