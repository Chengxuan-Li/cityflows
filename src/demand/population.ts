import { distance } from '../geo/polyline';
import { createRandom } from '../geo/random';
import { compile } from '../network';
import type { City, DemandConfig, Person } from '../schema';
import { withHouseholds } from './households';
import { servedTrips } from './served';

export function generatePopulation(city: City, config: DemandConfig): Person[] {
  // Population placement only asks about car access to jobs and gateways.
  const result = compile(city, () => {});
  if (!result.ok) {
    throw new Error(`Cannot generate population: ${result.diagnostics[0]!.message}`);
  }

  const { places } = result.compiled;
  const workplaces = places.filter((place) => city.places[place.id]!.jobs > 0);
  const served = servedTrips(city, result.compiled);
  const random = createRandom(config.seed).derive('population');
  const persons: Omit<Person, 'householdId'>[] = [];

  for (const home of places) {
    if (home.kind !== 'residential' && home.kind !== 'gateway') continue;
    const count = Math.round(city.places[home.id]!.population * config.personsPerResident);
    if (count === 0) continue;

    const distances = workplaces.map((work) => distance(home.centroid, work.centroid));
    const nearest = distances.reduce((min, meters) => Math.min(min, meters), Infinity);
    // Shifting by the nearest distance preserves the odds when all jobs are far away.
    const weights = workplaces.map(
      (work, index) =>
        city.places[work.id]!.jobs *
        Math.exp(-(distances[index]! - nearest) / config.gravityScaleM),
    );
    const cumulative = (keep: (index: number) => boolean) => {
      let total = 0;
      return weights.map((weight, index) => (total += keep(index) ? weight : 0));
    };
    const cumulativeWeights = cumulative(() => true);
    const totalWeight = cumulativeWeights.at(-1) ?? 0;
    // TASK-288: a work place with a gateway end is kept only if the home's own car can drive
    // there and back (the legs `scheduleTrips` judges). A person drawn to one their car cannot
    // serve draws again, by the same weights, among the work places it can; where there is none,
    // the draw stands and the person stays home, as `scheduleTrips` leaves them.
    const checked = new Map<number, boolean>();
    const servable = (index: number) => {
      let ok = checked.get(index);
      if (ok === undefined) {
        const work = workplaces[index]!.id;
        ok = served(home.id, work, true) && served(work, home.id);
        checked.set(index, ok);
      }
      return ok;
    };
    let servedWeights: number[] | undefined;

    for (let i = 0; i < count; i++) {
      const id = `person:${home.id}:${i}`;
      const personRandom = random.derive(id);
      const hasCar = personRandom.next() < config.carShare;
      const draw = personRandom.uniform(0, totalWeight);
      let workIndex = cumulativeWeights.findIndex((weight) => draw < weight);
      if (workIndex !== -1 && !servable(workIndex)) {
        servedWeights ??= cumulative(servable);
        const total = servedWeights.at(-1)!;
        if (total > 0) {
          const again = personRandom.uniform(0, total);
          workIndex = servedWeights.findIndex((weight) => again < weight);
        }
      }
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
