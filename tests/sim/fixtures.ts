import { expect } from 'vitest';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile } from '../../src/network';
import type { City, TripRequest } from '../../src/schema';

export function setup(city: City) {
  const result = compile(city);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error('Fixture must compile');
  return result.compiled;
}

export function scenario(seed = 1) {
  return { ...defaultScenario('grid5x5', seed), startS: 100, endS: 7300 };
}

export function trips(city: City, count: number, spacingS = 0): TripRequest[] {
  const [origin, destination] = Object.values(city.places);
  return Array.from({ length: count }, (_, i) => ({
    id: `trip:${i}`,
    personId: null,
    originPlaceId: origin!.id,
    destinationPlaceId: destination!.id,
    departS: 100 + i * spacingS,
    mode: 'car',
    legs: [],
  }));
}
