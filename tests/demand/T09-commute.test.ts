import { expect, test } from 'vitest';
import { demandSummary, generatePopulation, scheduleTrips } from '../../src/demand';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';

test('T09 commutes reconcile by person, place and hour with spread departures', () => {
  const city = grid5x5();
  const [home, work] = Object.values(city.places);
  home!.population = 400;
  work!.jobs = 300;
  const scenario = defaultScenario('grid5x5');
  const persons = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, persons, scenario);
  const summary = demandSummary(trips, city);

  expect(persons).toHaveLength(400);
  expect(trips).toHaveLength(800);
  const morning = trips.filter((trip) => trip.departS >= 6 * 3600 && trip.departS < 10 * 3600);
  const afternoon = trips.filter((trip) => trip.departS >= 15 * 3600 && trip.departS < 20 * 3600);
  expect(morning.length).toBeGreaterThan(380);
  expect(afternoon.length).toBeGreaterThan(360);
  expect(morning.every((trip) => trip.originPlaceId === home!.id)).toBe(true);
  expect(afternoon.every((trip) => trip.originPlaceId === work!.id)).toBe(true);

  const minuteCounts = new Map<number, number>();
  for (const trip of trips) {
    const minute = Math.floor(trip.departS / 60);
    minuteCounts.set(minute, (minuteCounts.get(minute) ?? 0) + 1);
  }
  expect(Math.max(...minuteCounts.values())).toBeLessThanOrEqual(trips.length * 0.1);
  for (const person of persons) {
    const [outbound, inbound, ...extra] = trips.filter((trip) => trip.personId === person.id);
    expect(extra).toHaveLength(0);
    expect(outbound).toMatchObject({
      originPlaceId: home!.id,
      destinationPlaceId: work!.id,
      mode: 'car',
    });
    expect(inbound).toMatchObject({
      originPlaceId: work!.id,
      destinationPlaceId: home!.id,
      mode: 'car',
    });
    expect(person.agenda.map(({ kind, placeId }) => [kind, placeId])).toEqual([
      ['home', home!.id],
      ['work', work!.id],
      ['home', home!.id],
    ]);
    expect(outbound!.departS).toBe(person.agenda[1]!.startS);
    expect(inbound!.departS).toBe(person.agenda[1]!.startS + person.agenda[1]!.durationS);
  }

  expect(summary.totalTrips).toBe(800);
  expect(summary.byPlace).toEqual({
    [home!.id]: { departures: 400, arrivals: 400 },
    [work!.id]: { departures: 400, arrivals: 400 },
  });
  const hourly = Array<number>(24).fill(0);
  for (const trip of trips) {
    const hour = Math.floor(trip.departS / 3600);
    hourly[hour] = hourly[hour]! + 1;
  }
  expect(summary.byHour).toEqual(hourly);
});
