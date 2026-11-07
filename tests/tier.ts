import { inject, test } from 'vitest';

// TASK-090: a file importing this module runs in two tiers (vite.config.ts): `npm test`, which
// imports no Munich, and `npm run test:city`, which runs only Munich.

declare module 'vitest' {
  export interface ProvidedContext {
    munich: boolean;
  }
}

const munich = inject('munich');
const unregistered = Object.assign(() => {}, { each: () => () => {} }) as unknown as typeof test;

/** The cases of `all` (city names, or rows starting with one) this tier runs: Munich in the city
 * tier, the others in `npm test`. */
export function tierCities<T extends string | readonly [string, ...unknown[]]>(
  all: readonly T[],
): T[] {
  return all.filter((row) => /munich/i.test(typeof row === 'string' ? row : row[0]) === munich);
}

/** A test of Munich: registered in the city tier only. */
export const cityTest = munich ? test : unregistered;

/** A test of no real city, in a file shared with the city tier: registered in `npm test` only. */
export const unitTest = munich ? unregistered : test;
