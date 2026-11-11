import { createRandom } from '../geo/random';
import type { City, Person, Scenario, TripRequest } from '../schema';
import { buildAgenda } from './agenda';
import { eventTrips } from './events';
import { stationRiders } from './stations';
import { throughTrips } from './through';
import { tripVehicle } from './vehicle';

/** Rebuild each person's daily agenda from their persistent assignments. */
export function scheduleTrips(city: City, persons: Person[], scenario: Scenario): TripRequest[] {
  const random = createRandom(scenario.seed).derive('schedule');
  const trips: TripRequest[] = [];

  for (const person of persons) {
    const { id, hasCar } = person;
    person.agenda = buildAgenda(city, person, scenario, random.derive(id));

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
        ...tripVehicle(`${id}:trip:${i}`, scenario.demand, 'local', mode),
      });
    }
  }

  trips.push(...throughTrips(city, scenario), ...eventTrips(city, scenario));
  trips.push(...stationRiders(city, scenario).trips);
  return trips.sort((a, b) => a.departS - b.departS || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
