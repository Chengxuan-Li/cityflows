import type { CompiledCity } from '../network';

/** TASK-175: the compiled grades, by node and road index. */
export function cityGrades(city: CompiledCity) {
  return { nodeGrades: city.nodes.map((n) => n.grade), roadGrades: city.roads.map((r) => r.grade) };
}
