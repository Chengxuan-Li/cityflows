import type { CompiledCity } from '../network';
import type { CityGeometry } from './types';

export function cityGrades(city: CompiledCity, source?: CityGeometry) {
  const nodeGrades = city.nodes.map(({ id }) => source?.nodes[id]?.layer ?? 0);
  const roadGrades = city.roads.map(
    ({ id, from, to }) =>
      source?.roads?.[id]?.layer ?? Math.min(nodeGrades[from]!, nodeGrades[to]!),
  );
  return { nodeGrades, roadGrades };
}
