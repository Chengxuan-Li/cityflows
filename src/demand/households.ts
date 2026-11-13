import { createRandom } from '../geo/random';
import type { City, Person, TripRequest } from '../schema';
import { weightedChoice } from './selection';

/** Private households by size, 1 to 5 persons (Germany, 2023 microcensus; 5 stands for 5 or
 * more). No settings UI: households group the sampled persons, so the shares hold for the
 * sampled population, not for a home's residents. */
export const HOUSEHOLD_SIZE_SHARES = [0.41, 0.34, 0.12, 0.09, 0.04] as const;

/** A borrowed car must be free from the borrower's first departure until this long after their
 * planned return home. */
export const CAR_RETURN_MARGIN_S = 1800;

const sizes = HOUSEHOLD_SIZE_SHARES.map((_, i) => i + 1);

/** Group each home's persons into households, in person order: sizes drawn on a sub-stream per
 * home (adding a place leaves other homes alone), the last household taking the persons left
 * over. A gateway person is a household of one. A pure function of the persons, the city's place
 * kinds and the demand seed, so a saved population without households (TASK-129) gets the same
 * households as a regenerated one. */
export function withHouseholds<T extends Omit<Person, 'householdId'>>(
  city: City,
  persons: readonly T[],
  seed: number,
): (T & { householdId: string })[] {
  const random = createRandom(seed).derive('households');
  const remaining = new Map<string, number>();
  for (const { homePlaceId } of persons)
    remaining.set(homePlaceId, (remaining.get(homePlaceId) ?? 0) + 1);
  const homes = new Map<
    string,
    { random: ReturnType<typeof random.derive>; k: number; left: number }
  >();
  return persons.map((person) => {
    const home = person.homePlaceId;
    let state = homes.get(home);
    if (!state) homes.set(home, (state = { random: random.derive(home), k: -1, left: 0 }));
    const left = remaining.get(home)!;
    remaining.set(home, left - 1);
    if (!state.left) {
      state.k++;
      state.left =
        city.places[home]?.kind === 'gateway'
          ? 1
          : Math.min(
              left,
              weightedChoice(sizes, (n) => HOUSEHOLD_SIZE_SHARES[n - 1]!, state.random)!,
            );
    }
    state.left--;
    return { ...person, householdId: `hh:${home}:${state.k}` };
  });
}

/** A member's day away from home: first departure to planned return home plus the margin. */
function dayAway(person: Person): [number, number] | null {
  if (person.agenda.length < 2) return null;
  return [person.agenda[1]!.startS, person.agenda.at(-1)!.startS + CAR_RETURN_MARGIN_S];
}

/** Each household's members in person index order (`person:<homePlaceId>:<i>`, else by id), so
 * car ids and drivers do not depend on the order the persons are passed in. */
function householdMembers(persons: readonly Person[]) {
  const index = (person: Person) => Number(person.id.slice(person.id.lastIndexOf(':') + 1));
  const households = new Map<string, Person[]>();
  for (const person of persons) {
    const members = households.get(person.householdId);
    if (members) members.push(person);
    else households.set(person.householdId, [person]);
  }
  for (const members of households.values())
    members.sort((a, b) => index(a) - index(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return households;
}

/** Who drives which household car today, from the planned agendas (TASK-129). A household owns
 * car `car:<householdId>:<k>` for its k-th member with `hasCar`, who drives it on any day away.
 * Then the other members, by first departure, each take the first car free for their whole day
 * away; the rest walk (no mode choice yet, TASK-113). */
export function assignCars(persons: readonly Person[]): Map<string, string> {
  const drivers = new Map<string, string>();
  for (const [household, members] of householdMembers(persons)) {
    const owners = members.filter((m) => m.hasCar);
    if (!owners.length) continue;
    const busy = owners.map((owner, k) => {
      const day = dayAway(owner);
      if (day) drivers.set(owner.id, `car:${household}:${k}`);
      return day ? [day] : [];
    });
    const others = members
      .filter((m) => !m.hasCar && dayAway(m))
      .sort((a, b) => dayAway(a)![0] - dayAway(b)![0]);
    for (const member of others) {
      const [startS, endS] = dayAway(member)!;
      const k = busy.findIndex((days) => days.every(([s, e]) => endS <= s || startS >= e));
      if (k === -1) continue;
      busy[k]!.push([startS, endS]);
      drivers.set(member.id, `car:${household}:${k}`);
    }
  }
  return drivers;
}

/** Households, cars and today's drivers, for the census (bench/import-probe.ts) and T67. */
export function householdCensus(
  city: City,
  persons: readonly Person[],
  trips: readonly TripRequest[],
) {
  const members = householdMembers(persons);
  const driving = new Map<string, string>();
  for (const trip of trips) if (trip.carId && trip.personId) driving.set(trip.personId, trip.carId);
  const bySize: Record<number, number> = {};
  const carsPerHousehold: Record<number, number> = {};
  let gatewayHouseholds = 0,
    cars = 0;
  for (const list of members.values()) {
    const owners = list.filter((m) => m.hasCar).length;
    cars += owners;
    if (city.places[list[0]!.homePlaceId]?.kind === 'gateway') {
      gatewayHouseholds++;
      continue;
    }
    bySize[list.length] = (bySize[list.length] ?? 0) + 1;
    carsPerHousehold[owners] = (carsPerHousehold[owners] ?? 0) + 1;
  }
  const driven = new Set(driving.values());
  return {
    households: members.size - gatewayHouseholds,
    gatewayHouseholds,
    bySize,
    carsPerHousehold,
    cars,
    carsDriven: driven.size,
    carsStayedHome: cars - driven.size,
    borrowedCarDays: persons.filter((p) => !p.hasCar && driving.has(p.id)).length,
    noFreeCar: persons.filter(
      (p) =>
        !p.hasCar &&
        !driving.has(p.id) &&
        dayAway(p) &&
        members.get(p.householdId)!.some((m) => m.hasCar),
    ).length,
  };
}
