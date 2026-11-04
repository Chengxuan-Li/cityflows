import type { Random } from '../geo/random';
import type { Activity, City, Person, Place, Scenario } from '../schema';
import { weightedChoice } from './selection';

const dayS = 86400;

function departure(from: Place, to: Place, earliest: number, fallback: number, random: Random) {
  const departures = from.profile?.departures;
  const weights = departures?.some((w) => w > 0) ? departures : to.profile?.arrivals;
  if (!weights?.some((w) => w > 0)) return Math.max(earliest, fallback);
  let day = Math.floor(earliest / dayS) * dayS;
  let after = earliest - day;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const weight = (hour: number) =>
    (weights[hour]! * Math.max(0, (hour + 1) * 3600 - Math.max(hour * 3600, after))) / 3600;
  let hour = weightedChoice(hours, weight, random);
  if (hour === undefined) {
    day += dayS;
    after = 0;
    hour = weightedChoice(hours, weight, random)!;
  }
  return day + random.uniform(Math.max(hour * 3600, after), (hour + 1) * 3600);
}

export function buildAgenda(
  city: City,
  person: Person,
  scenario: Scenario,
  random: Random,
): Activity[] {
  const { homePlaceId, workPlaceId } = person;
  const agenda: Activity[] = [{ kind: 'home', placeId: homePlaceId, startS: 0, durationS: dayS }];
  if (workPlaceId === null) return agenda;
  const { workStart, workDuration, chains } = scenario.demand;
  // Keep the original two draws intact so commute-only projects replay unchanged.
  const workStartS = Math.max(0, random.normal(workStart.meanS, workStart.sdS));
  const workDurationS = Math.max(0, random.normal(workDuration.meanS, workDuration.sdS));
  const places = Object.values(city.places).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const chainRandom = random.derive('chains');
  const choose = (kind: Place['kind']) =>
    weightedChoice(
      places.filter((p) => p.kind === kind && p.id !== homePlaceId && p.id !== workPlaceId),
      (p) => p.attraction,
      chainRandom,
    );
  const school = chainRandom.next() < (chains?.schoolShare ?? 0) ? choose('school') : undefined;
  function append(kind: Activity['kind'], placeId: string, fallback: number, earliest?: number) {
    const previous = agenda.at(-1)!;
    const startS = departure(
      city.places[previous.placeId]!,
      city.places[placeId]!,
      earliest ?? previous.startS,
      fallback,
      random.derive(`departure:${agenda.length}`),
    );
    previous.durationS = startS - previous.startS;
    agenda.push({ kind, placeId, startS, durationS: Math.max(0, dayS - startS) });
    return startS;
  }
  const start = append(school ? 'school' : 'work', school?.id ?? workPlaceId, workStartS);
  const end = start + (school ? 6 * 3600 : workDurationS);
  const shop = chainRandom.next() < (chains?.shopShare ?? 0) ? choose('retail') : undefined;
  if (shop) {
    const shopStart = append('shop', shop.id, end);
    append('home', homePlaceId, shopStart + 1800);
  } else append('home', homePlaceId, end);
  if (chainRandom.next() < (chains?.leisureShare ?? 0)) {
    const leisure = weightedChoice(
      places.filter(
        (p) => ['other', 'retail'].includes(p.kind) && p.id !== homePlaceId && p.id !== workPlaceId,
      ),
      (p) => p.attraction,
      chainRandom,
    );
    if (leisure) {
      const earliest = Math.max(18 * 3600, agenda.at(-1)!.startS);
      const start = append(
        'leisure',
        leisure.id,
        earliest + chainRandom.uniform(0, 3600),
        earliest,
      );
      append('home', homePlaceId, start + 2 * 3600);
    }
  }
  return agenda;
}
