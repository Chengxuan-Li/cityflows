import type { Random } from '../geo/random';

/** Zero total weight means no eligible destination, not a uniform fallback. */
export function weightedChoice<T>(
  choices: readonly T[],
  weight: (item: T) => number,
  random: Random,
): T | undefined {
  const total = choices.reduce((sum, item) => sum + weight(item), 0);
  if (total === 0) return undefined;
  let draw = random.uniform(0, total);
  return choices.find((item) => (draw -= weight(item)) < 0);
}
