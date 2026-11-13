import { createRandom } from '../geo/random';
import type { CompiledCity } from '../network';
import type { City, Person, Scenario, TripRequest } from '../schema';
import { buildAgenda } from './agenda';
import { eventTrips } from './events';
import { servedTrips } from './served';
import { throughTrips } from './through';
import { tripVehicle } from './vehicle';

/** Rebuild each person's daily agenda from their persistent assignments. Pass `compiled`, the
 * city already compiled, to spare compiling it again for gateway service (TASK-155). */
export function scheduleTrips(
  city: City,
  persons: Person[],
  scenario: Scenario,
  compiled?: CompiledCity,
): TripRequest[] {
  const random = createRandom(scenario.seed).derive('schedule');
  const served = servedTrips(city, compiled);
  const trips: TripRequest[] = [];

  for (const person of persons) {
    const { id, hasCar } = person;
    const agenda = buildAgenda(city, person, scenario, random.derive(id));
    // A person whose next leg no car can serve stays at the activity before it for the day.
    const stop = agenda.findIndex((to, i) => i > 0 && !served(agenda[i - 1]!.placeId, to.placeId));
    if (stop !== -1) {
      agenda.length = stop;
      const last = agenda.at(-1)!;
      last.durationS = Math.max(0, 86400 - last.startS);
    }
    person.agenda = agenda;

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

  trips.push(...throughTrips(city, scenario, served), ...eventTrips(city, scenario, served));
  return trips.sort((a, b) => a.departS - b.departS || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
