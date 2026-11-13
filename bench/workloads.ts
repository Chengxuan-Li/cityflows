import { generatePopulation, scheduleTrips } from '../src/demand';
import { grid5x5 } from '../src/fixtures/grid5x5';
import { defaultScenario } from '../src/fixtures/scenarios';
import { town } from '../src/fixtures/town';
import { allocateId } from '../src/schema';

export const workloadNames = ['grid5x5', 'grid5x5-scaled', 'grid5x5-stress', 'town'] as const;
export type WorkloadName = (typeof workloadNames)[number];

export function workload(name: WorkloadName) {
  const city = name === 'town' ? town() : grid5x5();
  const scenario = defaultScenario(name === 'town' ? 'town' : 'grid5x5');
  if (name === 'grid5x5-scaled') {
    const residents = Object.values(city.places).reduce((sum, place) => sum + place.population, 0);
    scenario.demand.personsPerResident = 3000 / residents;
  }
  if (name === 'grid5x5-stress') {
    city.name = '5 × 5 grid — distributed stress';
    // Same road graph; 1.2 km blocks and distributed portals provide room and ingress
    // for 3,000 actual road vehicles. This is not the ordinary two-place grid.
    for (const node of Object.values(city.nodes))
      node.pos = { x: node.pos.x * 10, y: node.pos.y * 10 };
    for (const road of Object.values(city.roads))
      road.centerline = road.centerline.map(({ x, y }) => ({ x: x * 10, y: y * 10 }));
    const template = Object.values(city.places)[0]!;
    city.places = {};
    for (const road of Object.values(city.roads)) {
      const id = allocateId(city, 'p');
      const point = road.centerline[0]!;
      city.places[id] = {
        ...template,
        id,
        name: `Stress ${road.id}`,
        kind: 'residential',
        population: 40,
        jobs: 40,
        shape: { kind: 'point', pos: { x: point.x + 20, y: point.y + 20 } },
        connectors: [
          {
            id: allocateId(city, 'c'),
            roadId: road.id,
            lane: 0,
            positionM: 40,
            direction: 'out',
            throughputPerMin: 120,
          },
          {
            id: allocateId(city, 'c'),
            roadId: road.id,
            lane: 0,
            positionM: 1100,
            direction: 'in',
            throughputPerMin: 120,
          },
        ],
      };
    }
    scenario.demand.workStart = { meanS: 8 * 3600, sdS: 1 };
    scenario.demand.gravityScaleM = 50000;
    // Owner, 2026-11-13: mode choice is on by default; the stress case measures road vehicles.
    scenario.demand.modeChoice = { enabled: false };
  }
  const population = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(city, population, scenario);
  return { city, scenario, population, trips };
}
