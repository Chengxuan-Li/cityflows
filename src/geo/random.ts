export interface Random {
  next(): number;
  uniform(a: number, b: number): number;
  normal(mean: number, sd: number): number;
  pick<T>(array: readonly T[]): T;
  derive(key: string | number): Random;
}

export function createRandom(seed: number): Random {
  const root = seed >>> 0;
  let state = root;
  // A full-period 32-bit LCG with an output mix to decorrelate neighboring states.
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const bits = Math.imul(state ^ (state >>> 16), 0x9e3779b1);
    return ((bits ^ (bits >>> 16)) >>> 0) / 2 ** 32;
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
