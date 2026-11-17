import { beforeAll, expect, test } from 'vitest';
import { curateFreiburg, importFreiburg } from '../../bench/freiburg';
import { probeMorning } from '../../bench/import-probe';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';
import { limit } from '../timeouts';

// TASK-198: the landing city's import and its morning at the showcase demand (0.15 persons per
// resident, mode choice on), 7:00 to 10:00.

/** The entries where Freiburg's polygon crosses a road of tertiary class or above, by the OSM
 * ways each gateway serves (docs/decisions/2026-11-17-landing-city.md). The polygon's east tip
 * cuts the ring road between Leopoldring and Schlossbergring, whose joining way lies outside the
 * extract, so each is an entry. */
const entries: Record<string, number[]> = {
  'Habsburgerstraße, B 3 north': [30313858, 478569866],
  'Stefan-Meier-Straße': [986453816],
  'Breisacher Straße': [23024406],
  'Schnewlinstraße, B 3 west': [27049877, 30339507],
  'Lessingstraße, B 31 link': [27363593, 234491459],
  'B 31 west, Autobahnzubringer Mitte and its links': [39223471, 208424805, 229626071, 526811436],
  Kronenstraße: [239527135, 420014063],
  'Günterstalstraße, L 124': [240454244, 4099150],
  'B 31 east, Schwarzwaldstraße and Leo-Wohleb-Straße': [10209572, 242170278],
  Schlossbergring: [1259488934, 1309085569],
  Leopoldring: [243604098, 51984086],
};

let city: City;
let morning: ReturnType<typeof probeMorning>;

beforeAll(() => {
  city = importFreiburg();
  curateFreiburg(city);
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  morning = probeMorning(city, result.compiled, 0.15);
  console.info('Freiburg morning at 0.15, mode choice on', {
    persons: morning.persons,
    completed: morning.completed,
    failedByReason: morning.failedByReason,
    gatewayTrips: morning.gatewayTrips,
  });
}, limit(600_000));

test('Freiburg has a gateway at each entry and nowhere else', () => {
  const gateways = Object.values(city.places).filter((p) => p.kind === 'gateway');
  const byWays = gateways.map((g) => [...g.provenance.osmIds!].sort((a, b) => a - b).join(','));
  expect(byWays.sort()).toEqual(
    Object.values(entries)
      .map((ways) => [...ways].sort((a, b) => a - b).join(','))
      .sort(),
  );
});

test('every entry carries trips in and out by 10:00', () => {
  const gateways = Object.values(city.places).filter((p) => p.kind === 'gateway');
  for (const gateway of gateways) {
    const trips = morning.gatewayTrips[gateway.id];
    expect(trips?.entered, `${gateway.id} entered`).toBeGreaterThan(0);
    // The link out at Lessingstraße leaves the B 31a inbound and loops back in as Lessingstraße
    // outside the polygon, by a way the extract lacks: only B 31a traffic could take it, and the
    // demand has no through trips, so nothing leaves by it.
    if (gateway.provenance.osmIds!.includes(234491459)) continue;
    expect(trips?.left, `${gateway.id} left`).toBeGreaterThan(0);
  }
});
