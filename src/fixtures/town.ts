import type { City, Node, Road } from '../schema';
import { buildCity, generated } from './build-city';

const size = 18;
const isArterial = (line: number) => line > 0 && line % 4 === 0;
const oneWayRows = [1, 2, 5, 6, 9, 10, 13, 14, 15];

export function town(seed = 1): City {
  const { city, node, road, place, signal } = buildCity('Town', seed);
  const grid = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => node(100 * x, 100 * y)),
  );
  const at = (x: number, y: number) => grid[y]![x]!;
  const arterial = { lanes: 2, roadClass: 'primary', speedKmh: 60 } as const;
  const local = { speedKmh: 30 };
  const avenue = { roadClass: 'secondary', speedKmh: 40 } as const;

  function twoWay(a: Node, b: Node, options: Parameters<typeof road>[2]) {
    const streetGroupId = `street:${a.id}:${b.id}`;
    road(a, b, { ...options, streetGroupId });
    road(b, a, { ...options, streetGroupId });
  }

  for (let y = 0; y < size; y++) {
    const oneWay = oneWayRows.indexOf(y);
    for (let x = 0; x < size; x++) {
      const here = at(x, y);
      if (x + 1 < size) {
        const east = at(x + 1, y);
        if (oneWay === -1) twoWay(here, east, isArterial(y) ? arterial : local);
        else if (oneWay % 2 === 0) road(here, east, local);
        else road(east, here, local);
      }
      if (y + 1 < size) twoWay(here, at(x, y + 1), isArterial(x) ? arterial : local);
      // Offset both diagonals from the arterial crossings, where there are two signal phases.
      if (x + 1 < size && y === x + 1 && y + 1 < size) {
        twoWay(here, at(x + 1, y + 1), avenue);
      }
      if (x + 1 < size && y === size - 1 - x) {
        twoWay(here, at(x + 1, y - 1), avenue);
      }
    }
  }

  const roads = Object.values(city.roads);
  const roadBetween = (from: Node, to: Node) =>
    roads.find((road) => road.from === from.id && road.to === to.id)!;

  for (let y = 4; y < size; y += 4) {
    for (let x = 4; x < size; x += 4) {
      const center = at(x, y);
      const neighbors = [at(x + 1, y), at(x, y + 1), at(x - 1, y), at(x, y - 1)];
      const arms = neighbors.map<[Road, Road]>((neighbor) => [
        roadBetween(neighbor, center),
        roadBetween(center, neighbor),
      ]);
      signal(center, arms);
      const program = center.signal!;
      const approaches = program.phases.map(({ groups }, i) => {
        // Turns across opposing traffic use the adjacent local streets instead.
        const left = arms[(i + 1) % arms.length]![1].id;
        center.turnRules.push({
          from: arms[i]![0].id,
          to: left,
          allowed: false,
          provenance: generated,
        });
        return groups.filter(({ to }) => to !== left);
      });
      program.phases = [0, 1].map((i) => ({
        durationS: 25,
        groups: [...approaches[i]!, ...approaches[i + 2]!],
      }));
      program.offsetS = ((x + y) / 4) * 12;
    }
  }

  const sites = [
    ['West Park', 'residential', 2, 3],
    ['North Gardens', 'residential', 6, 3],
    ['Orchard', 'residential', 10, 3],
    ['East Terrace', 'residential', 14, 7],
    ['South Bank', 'residential', 14, 16],
    ['The Grove', 'residential', 6, 16],
    ['Meadow', 'residential', 2, 11],
    ['Civic Center', 'work', 7, 7],
    ['Market Offices', 'work', 11, 7],
    ['Foundry', 'work', 11, 11],
    ['Mill Works', 'work', 7, 11],
    ['North Market', 'retail', 9, 3],
    ['South Shops', 'retail', 9, 16],
    ['Town School', 'school', 3, 7],
    ['North Gateway', 'gateway', 8, 0],
    ['East Gateway', 'gateway', 17, 8],
    ['South Gateway', 'gateway', 8, 17],
    ['West Gateway', 'gateway', 0, 8],
  ] as const;
  for (const [name, kind, x, y] of sites) {
    const here = at(x, y);
    const horizontal = at(x === size - 1 ? x - 1 : x + 1, y);
    const vertical = at(x, y === size - 1 ? y - 1 : y + 1);
    const departure = roadBetween(here, horizontal);
    const arrival = roadBetween(vertical, here);
    place(name, kind, { x: here.pos.x + 24, y: here.pos.y + 24 }, [
      { road: departure, direction: 'out', lane: departure.lanes.length - 1, positionM: 40 },
      { road: arrival, direction: 'in', lane: arrival.lanes.length - 1, positionM: 40 },
    ]);
  }

  for (const site of Object.values(city.places)) {
    if (site.kind === 'residential') site.population = Math.round(site.population * 0.82);
    if (site.kind === 'work') site.jobs = 1250;
    if (site.kind === 'retail') site.jobs = 120;
    if (site.kind === 'school') site.jobs = 80;
    if (site.kind === 'gateway') {
      site.population = 200;
      site.jobs = 250;
    }
  }
  return city;
}
