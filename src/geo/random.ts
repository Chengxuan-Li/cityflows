export interface Random {
  next(): number;
  uniform(a: number, b: number): number;
  normal(mean: number, sd: number): number;
  pick<T>(array: readonly T[]): T;
  derive(key: string | number): Random;
}

/** mulberry32: small, fast, and good enough for a game; seeded and fully deterministic. */
export function createRandom(seed: number): Random {
  const root = seed >>> 0;
  let state = root;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (a, b) => a + (b - a) * next(),
    normal: (mean, sd) =>
      mean + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    pick<T>(array: readonly T[]): T {
      if (array.length === 0) throw new RangeError('Cannot pick from an empty array');
      return array[Math.floor(next() * array.length)]!;
    },
    derive(key) {
      let hash = root ^ 0x811c9dc5;
      for (const char of `${typeof key}:${key}`)
        hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193);
      return createRandom(hash);
    },
  };
}
