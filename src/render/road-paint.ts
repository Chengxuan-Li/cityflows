import type { CLane, CompiledCity } from '../network';
import { corridorSurfaces } from '../network/corridor';
import { laneEdges } from '../network/lanes';

export const paintedLaneEdges = (lane: CLane, roadLanes: CLane[]) =>
  laneEdges(lane, roadLanes, true);

const cities = new WeakMap<CompiledCity, CompiledCity>();

/** A cached drawing view: simulation/walk geometry and the input remain untouched. */
export function paintedCity(city: CompiledCity): CompiledCity {
  const cached = cities.get(city);
  if (cached) return cached;
  const additions = city.roads.filter((road) =>
    road.lanes.some(
      (i, j) => city.lanes[i]!.taperStartM && j > 0 && city.lanes[road.lanes[j - 1]!]!.taperStartM,
    ),
  );
  if (!additions.length) {
    cities.set(city, city);
    return city;
  }
  const changed = new Set(additions.map((road) => road.idx));
  const corridor = (road: CompiledCity['roads'][number]) => road.corridorId ?? `#${road.idx}`;
  const corridors = new Set(additions.map(corridor));
  const roads = city.roads.map((road) => {
    if (!corridors.has(corridor(road))) return road;
    if (!changed.has(road.idx)) return { ...road };
    const lanes = road.lanes.map((i) => city.lanes[i]!);
    const first = paintedLaneEdges(lanes[0]!, lanes);
    const last = paintedLaneEdges(lanes.at(-1)!, lanes);
    return { ...road, surface: [...first.left, ...last.right.reverse()] };
  });
  corridorSurfaces(roads.filter((road) => corridors.has(corridor(road))));
  const painted = { ...city, roads };
  cities.set(city, painted);
  cities.set(painted, painted);
  return painted;
}
