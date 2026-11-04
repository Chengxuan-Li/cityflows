import { createRandom } from '../geo/random';
import type { City, Scenario, TripRequest } from '../schema';
import { weightedChoice } from './selection';

export function throughTrips(city: City, scenario: Scenario): TripRequest[] {
  const gateways = Object.values(city.places)
    .filter((p) => p.kind === 'gateway')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (gateways.length < 2) return [];
  const origins = gateways.filter(
    (p) => p.population > 0 && gateways.some((q) => q.id !== p.id && q.jobs > 0),
  );
  if (origins.length === 0) return [];
  const root = createRandom(scenario.seed).derive('through');
  const trips: TripRequest[] = [];
  for (const [hour, rate] of scenario.demand.throughTripsPerHour.entries()) {
    const count = Math.floor(rate) + Number(root.derive(`count:${hour}`).next() < rate % 1);
    for (let i = 0; i < count; i++) {
      const id = `through:${hour}:${i}`;
      const random = root.derive(id);
      const origin = weightedChoice(origins, (p) => p.population, random)!;
      const destination = weightedChoice(
        gateways.filter((p) => p.id !== origin.id),
        (p) => p.jobs,
        random,
      )!;
      trips.push({
        id,
        personId: null,
        originPlaceId: origin.id,
        destinationPlaceId: destination.id,
        departS: hour * 3600 + random.uniform(0, 3600),
        mode: 'car',
        legs: [{ mode: 'car', fromPlaceId: origin.id, toPlaceId: destination.id }],
      });
    }
  }
  return trips;
}
