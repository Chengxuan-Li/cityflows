import type { Road } from '../schema';
import { buildCity } from './build-city';

export function grid5x5(seed = 1) {
  const { city, node, road, street, place, signal } = buildCity('5 × 5 grid', seed);
  const grid = Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => node(120 * x, 120 * y)),
  );
  const center = grid[2]![2]!;
  const approaches: [Road, Road][] = [];
  for (const [y, row] of grid.entries()) {
    for (const [x, here] of row.entries()) {
      for (const there of [row[x + 1], grid[y + 1]?.[x]]) {
        if (!there) continue;
        if (x === 1 && y < 2 && there.pos.y === here.pos.y) {
          // The parallel one-way blocks run in opposite directions.
          if (y === 0) road(here, there);
          else road(there, here);
          continue;
        }
        const centerArm = here === center || there === center;
        const lanes = centerArm || x === 2 || y === 2 ? 2 : 1;
        const [forward, reverse] = street(here, there, lanes);
        if (centerArm) approaches.push(there === center ? [forward, reverse] : [reverse, forward]);
      }
    }
  }
  signal(center, approaches);

  const cornerLinks = (id: string) => [
    { road: Object.values(city.roads).find((r) => r.from === id)!, direction: 'out' as const },
    { road: Object.values(city.roads).find((r) => r.to === id)!, direction: 'in' as const },
  ];
  const home = grid[0]![0]!;
  const work = grid[4]![4]!;
  place('Homes', 'residential', { x: 15, y: -15 }, cornerLinks(home.id));
  place('Offices', 'work', { x: 465, y: 495 }, cornerLinks(work.id));
  return city;
}
