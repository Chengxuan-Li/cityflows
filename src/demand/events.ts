import { createRandom } from '../geo/random';
import type { City, Scenario, TripRequest } from '../schema';
import { weightedChoice } from './selection';
import { tripVehicle } from './vehicle';

export function eventTrips(city: City, scenario: Scenario): TripRequest[] {
  const places = Object.values(city.places).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const root = createRandom(scenario.seed).derive('events');
  const trips: TripRequest[] = [];
  for (const place of places) {
    const gateways = places.filter((p) => p.kind === 'gateway' && p.id !== place.id);
    const endpoints = gateways.length
      ? gateways
      : places.filter((p) => p.kind === 'residential' && p.id !== place.id);
    for (const event of place.events) {
      for (let i = 0; i < Math.max(event.arrivals, event.departures); i++) {
        const personId = `visitor:${place.id}:${event.id}:${i}`;
        const random = root.derive(personId);
        const endpoint = weightedChoice(endpoints, (p) => p.population + p.jobs, random);
        if (!endpoint)
          throw new Error(
            `Event ${event.id} at ${place.id} needs a populated residential place or gateway`,
          );
        let arrival = random.uniform(event.startS, event.startS + event.durationS);
        let departure = random.uniform(event.startS, event.startS + event.durationS);
        if (i < event.arrivals && i < event.departures && arrival > departure)
          [arrival, departure] = [departure, arrival];
        function emit(direction: 'in' | 'out', departS: number) {
          const from = direction === 'in' ? endpoint!.id : place.id;
          const to = direction === 'in' ? place.id : endpoint!.id;
          trips.push({
            id: `${personId}:${direction}`,
            personId,
            originPlaceId: from,
            destinationPlaceId: to,
            departS,
            mode: 'car',
            legs: [{ mode: 'car', fromPlaceId: from, toPlaceId: to }],
            ...tripVehicle(`${personId}:${direction}`, scenario.demand, 'local'),
          });
        }
        if (i < event.arrivals) emit('in', arrival);
        if (i < event.departures) emit('out', departure);
      }
    }
  }
  return trips;
}
