import { describe, expect, test } from 'vitest';
import {
  buildingSeed,
  defaultLighting,
  parseLighting,
  sceneLight,
  sunAt,
  windowLit,
  type LightingSettings,
} from '../../src/render/lighting';
import { style } from '../../src/render/style';
import { buildContext } from '../../src/render3d/context';
import type { ContextFeature } from '../../src/schema';
import { lightingKey, loadLighting, saveLighting } from '../../src/ui/lighting-store';

const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
  { x, y },
];
const at = (mode: LightingSettings['mode'], hour = 12, exposure = 1) =>
  sceneLight({ mode, exposure }, hour * 3600);

describe('V163 lighting model', () => {
  test('Day reproduces the TASK-162 lights exactly', () => {
    const day = at('day');
    const length = Math.hypot(1, 1.5, 1);
    expect(day.sun).toEqual([-1 / length, 1.5 / length, -1 / length]);
    expect(day).toMatchObject({
      sunColor: 0xffffff,
      sunIntensity: 0.95,
      shadows: true,
      sky: 0xffffff,
      ground: 0xd9dad6,
      skyIntensity: 2,
      background: style.background,
      ambient: [1, 1, 1],
      artificial: 0,
      windows: 0,
    });
  });

  test('Evening and Night darken the scene and turn the artificial light on', () => {
    const evening = at('evening'),
      night = at('night');
    for (const light of [evening, night]) {
      expect(light.artificial).toBe(1);
      expect(light.windows).toBeGreaterThan(0.1);
      expect(Math.max(...light.ambient)).toBeLessThan(0.8);
    }
    for (let i = 0; i < 3; i++) expect(night.ambient[i]!).toBeLessThan(evening.ambient[i]!);
    // A low sun casts long shadows; the moon casts none.
    expect(evening.shadows).toBe(true);
    expect(evening.sun[1]).toBeLessThan(Math.sin((12 * Math.PI) / 180));
    expect(night.shadows).toBe(false);
  });

  test('exposure scales the light, not the colours', () => {
    const half = at('evening', 12, 0.5),
      full = at('evening');
    expect(half.sunIntensity).toBeCloseTo(full.sunIntensity / 2);
    expect(half.skyIntensity).toBeCloseTo(full.skyIntensity / 2);
    half.ambient.forEach((c, i) => expect(c).toBeCloseTo(full.ambient[i]! / 2));
    expect(half.sky).toBe(full.sky);
    expect(half.sunColor).toBe(full.sunColor);
  });

  test('following the clock: morning sun in the east, noon in the south, lamps at night', () => {
    const morning = at('clock', 7),
      noon = at('clock', 13),
      late = at('clock', 21);
    expect(morning.artificial).toBe(0);
    expect(morning.shadows).toBe(true);
    expect(morning.sun[0]).toBeGreaterThan(0.5);
    expect(sunAt(13 * 3600).elevation).toBeCloseTo(52);
    expect(noon.sun[2]).toBeGreaterThan(0);
    expect(noon.ambient.every((c) => c > 0.95)).toBe(true);
    expect(late.artificial).toBe(1);
    expect(late.shadows).toBe(false);
    // No jumps in the light through a whole day, minute by minute.
    let previous = at('clock', 0);
    for (let minute = 1; minute <= 24 * 60; minute++) {
      const light = sceneLight({ mode: 'clock', exposure: 1 }, minute * 60);
      for (let i = 0; i < 3; i++)
        expect(Math.abs(light.ambient[i]! - previous.ambient[i]!)).toBeLessThan(0.05);
      expect(Math.abs(light.artificial - previous.artificial)).toBeLessThan(0.05);
      previous = light;
    }
  });
});

describe('V163 settings persistence', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  };

  test('settings round-trip through storage', () => {
    const storage = memory();
    expect(loadLighting(storage)).toEqual(defaultLighting);
    saveLighting(storage, { mode: 'night', exposure: 0.8 });
    expect(JSON.parse(storage.values.get(lightingKey)!)).toEqual({ mode: 'night', exposure: 0.8 });
    expect(loadLighting(storage)).toEqual({ mode: 'night', exposure: 0.8 });
  });

  test('missing, broken or throwing storage falls back to Day', () => {
    expect(loadLighting(undefined)).toEqual(defaultLighting);
    const broken = memory();
    broken.values.set(lightingKey, '{not json');
    expect(loadLighting(broken)).toEqual(defaultLighting);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadLighting(throwing)).toEqual(defaultLighting);
    expect(() => saveLighting(throwing, { mode: 'evening', exposure: 1 })).not.toThrow();
  });

  test('malformed values are clamped or replaced', () => {
    expect(parseLighting(null)).toEqual(defaultLighting);
    expect(parseLighting('evening')).toEqual(defaultLighting);
    expect(parseLighting({ mode: 'dusk', exposure: 1.2 })).toEqual({ mode: 'day', exposure: 1.2 });
    expect(parseLighting({ mode: 'clock', exposure: 9 })).toEqual({ mode: 'clock', exposure: 1.5 });
    expect(parseLighting({ mode: 'night', exposure: Number.NaN })).toEqual({
      mode: 'night',
      exposure: 1,
    });
  });
});

describe('V163 lit windows', () => {
  const seeds = Array.from({ length: 400 }, (_, i) => buildingSeed(ring(i * 37, i * 11, 20, 14)));

  test('the pattern is a pure function of the building seed, level and column', () => {
    expect(buildingSeed(ring(5, 5, 20, 14))).toBe(buildingSeed(ring(5, 5, 20, 14)));
    expect(new Set(seeds).size).toBe(seeds.length);
    for (const seed of seeds.slice(0, 20))
      for (let level = 0; level < 6; level++)
        for (let column = 0; column < 8; column++)
          expect(windowLit(seed, level, column, 0.4)).toBe(windowLit(seed, level, column, 0.4));
    // Seeds fit a float32 attribute exactly.
    for (const seed of seeds) expect(Math.fround(seed)).toBe(seed);
  });

  test('a sensible share is lit, and more windows light up as the share grows', () => {
    for (const share of [0.22, 0.45]) {
      let lit = 0,
        total = 0;
      for (const seed of seeds)
        for (let level = 0; level < 5; level++)
          for (let column = 0; column < 10; column++) {
            total++;
            if (windowLit(seed, level, column, share)) {
              lit++;
              expect(windowLit(seed, level, column, share + 0.1)).toBe(true);
            }
          }
      expect(lit / total).toBeCloseTo(share, 1);
    }
    // Two buildings do not share one pattern.
    const pattern = (seed: number) =>
      Array.from({ length: 40 }, (_, i) => windowLit(seed, i >> 3, i & 7, 0.45)).join();
    expect(pattern(seeds[0]!)).not.toBe(pattern(seeds[1]!));
  });

  test("facades carry their building's seed; roofs and plain blocks carry none", () => {
    const building: ContextFeature = {
      kind: 'area',
      class: 'building',
      levels: 4,
      rings: [ring(3, 4, 18, 12)],
    };
    const context = buildContext([building]);
    const seed = context.detailedBuildings.getAttribute('windowSeed');
    const info = context.detailedBuildings.getAttribute('windowInfo');
    const facade = new Set<number>(),
      other = new Set<number>();
    for (let i = 0; i < seed.count; i++) (info.getZ(i) > 0 ? facade : other).add(seed.getX(i));
    expect([...facade]).toEqual([buildingSeed(building.rings[0]!)]);
    expect([...other]).toEqual([0]);
    expect(new Set(context.buildings.getAttribute('windowSeed').array)).toEqual(new Set([0]));
    for (const part of [context.buildings, context.detailedBuildings, context.ground])
      part.dispose();
  });
});
