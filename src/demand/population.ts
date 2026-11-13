import { distance } from '../geo/polyline';
import { createRandom } from '../geo/random';
import { compile } from '../network';
import type { City, DemandConfig, Person } from '../schema';
import { withHouseholds } from './households';

export function generatePopulation(city: City, config: DemandConfig): Person[] {
  const result = compile(city);
  if (!result.ok) {
    throw new Error(`Cannot generate population: ${result.diagnostics[0]!.message}`);
  }

  const { places } = result.compiled;
  const workplaces = places.filter((place) => city.places[place.id]!.jobs > 0);
  const random = createRandom(config.seed).derive('population');
  const persons: Omit<Person, 'householdId'>[] = [];

  for (const home of places) {
    if (home.kind !== 'residential' && home.kind !== 'gateway') continue;
    const count = Math.round(city.places[home.id]!.population * config.personsPerResident);
    if (count === 0) continue;

    const distances = workplaces.map((work) => distance(home.centroid, work.centroid));
    const nearest = distances.reduce((min, meters) => Math.min(min, meters), Infinity);
    let totalWeight = 0;
    const cumulativeWeights = workplaces.map((work, index) => {
      // Shifting by the nearest distance preserves the odds when all jobs are far away.
      totalWeight +=
        city.places[work.id]!.jobs *
        Math.exp(-(distances[index]! - nearest) / config.gravityScaleM);
      return totalWeight;
    });

    for (let i = 0; i < count; i++) {
      const id = `person:${home.id}:${i}`;
      const personRandom = random.derive(id);
      const hasCar = personRandom.next() < config.carShare;
      const draw = personRandom.uniform(0, totalWeight);
      const workIndex = cumulativeWeights.findIndex((weight) => draw < weight);
      persons.push({
        id,
        homePlaceId: home.id,
        workPlaceId: workplaces[workIndex]?.id ?? null,
        hasCar,
        agenda: [],
      });
    }
  }
  return withHouseholds(city, persons, config.seed);
}
