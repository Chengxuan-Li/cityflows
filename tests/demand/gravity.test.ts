import { expect, test } from 'vitest';
import { generatePopulation } from '../../src/demand';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';

test('gravity favors closer jobs and flattens as its distance scale grows', () => {
  const city = grid5x5();
  const [home, near] = Object.values(city.places);
  home!.population = 2000;
  home!.shape = { kind: 'point', pos: { x: 0, y: 0 } };
  near!.shape = { kind: 'point', pos: { x: 100, y: 0 } };
  const farId = `p:${city.nextId++}`;
  city.places[farId] = {
    ...near!,
    id: farId,
    kind: 'retail',
    shape: { kind: 'point', pos: { x: 1100, y: 0 } },
    connectors: [],
  };
  const { demand } = defaultScenario('grid5x5');

  const nearCount = (gravityScaleM: number) =>
    generatePopulation(city, { ...demand, gravityScaleM }).filter(
      (person) => person.workPlaceId === near!.id,
    ).length;

  const steep = nearCount(1000);
  const flat = nearCount(10000);
  expect(steep).toBeGreaterThan(1350);
  expect(flat).toBeLessThan(steep);
  expect(flat).toBeGreaterThan(950);
  expect(flat).toBeLessThan(1150);

  city.places[farId]!.jobs *= 3;
  expect(nearCount(10000)).toBeLessThan(650);
});
