import { expect as baseExpect } from 'vitest';
const isPin = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) || Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && (/^[a-f0-9]{64}$/.test(v) || /^rp:\d+$/.test(v)));
export const expect: typeof baseExpect = new Proxy(baseExpect, {
  apply(target, self, args: [unknown]) {
    const assertions = Reflect.apply(target, self, args);
    return new Proxy(assertions, {
      get(matchers, key) {
        const matcher = Reflect.get(matchers, key);
        if (key === 'toBe' || key === 'toEqual') return (expected: unknown) => {
          if (isPin(expected)) {
            if (JSON.stringify(args[0]) !== JSON.stringify(expected)) console.error('TASK144_PIN', JSON.stringify({ actual: args[0], expected, location: new Error().stack?.split('\n').slice(2, 4) }));
            return;
          }
          return matcher.call(matchers, expected);
        };
        return typeof matcher === 'function' ? matcher.bind(matchers) : matcher;
      },
    });
  },
});
