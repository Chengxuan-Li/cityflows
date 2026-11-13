import { describe, expect, test } from 'vitest';
import { defaultLighting, sceneLight, type LightingSettings } from '../../src/render/lighting';
import { mapPalettes, placeColors, style } from '../../src/render/style';
import { buildContext } from '../../src/render3d/context';
import type { ContextFeature } from '../../src/schema';
import {
  appearanceKey,
  defaultAppearance,
  loadAppearance,
  nightLighting,
  resolveAppearance,
  saveAppearance,
  type AppearanceSettings,
} from '../../src/ui/appearance-store';

const lit = (mode: LightingSettings['mode']): LightingSettings => ({ mode, exposure: 1 });
const settings = (appearance: AppearanceSettings['appearance'], matchLighting = false) => ({
  appearance,
  matchLighting,
});

describe('V166 appearance setting', () => {
  test('stored per viewer, with a fallback for missing, malformed or blocked storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(loadAppearance(storage)).toEqual(defaultAppearance);
    saveAppearance(storage, settings('dark', true));
    expect(JSON.parse(values.get(appearanceKey)!)).toEqual(settings('dark', true));
    expect(loadAppearance(storage)).toEqual(settings('dark', true));
    values.set(appearanceKey, '{"appearance":"sepia","matchLighting":"yes"}');
    expect(loadAppearance(storage)).toEqual(defaultAppearance);
    values.set(appearanceKey, 'not json');
    expect(loadAppearance(storage)).toEqual(defaultAppearance);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadAppearance(blocked)).toEqual(defaultAppearance);
    expect(() => saveAppearance(blocked, settings('light'))).not.toThrow();
    expect(loadAppearance(undefined)).toEqual(defaultAppearance);
  });

  test('System follows the OS; Light and Dark ignore it', () => {
    for (const systemDark of [false, true]) {
      const day = (a: AppearanceSettings) => resolveAppearance(a, systemDark, defaultLighting, 0);
      expect(day(settings('system')).dark).toBe(systemDark);
      expect(day(settings('light')).dark).toBe(false);
      expect(day(settings('dark')).dark).toBe(true);
    }
  });

  test('Match lighting turns dark with Evening, Night and the clock after dusk only', () => {
    const match = settings('light', true);
    expect(resolveAppearance(match, false, lit('day'), 0).dark).toBe(false);
    expect(resolveAppearance(match, false, lit('evening'), 0).dark).toBe(true);
    expect(resolveAppearance(match, false, lit('night'), 0).dark).toBe(true);
    expect(resolveAppearance(match, false, lit('clock'), 12 * 3600).dark).toBe(false);
    expect(resolveAppearance(match, false, lit('clock'), 21 * 3600).dark).toBe(true);
    expect(resolveAppearance(match, false, lit('clock'), 5 * 3600).dark).toBe(true);
    // Before a run starts, the clock reads as day.
    expect(nightLighting(lit('clock'), undefined)).toBe(false);
    // Off by default: Evening alone leaves Light light.
    expect(resolveAppearance(settings('light'), false, lit('evening'), 0).dark).toBe(false);
  });

  test('the map follows the chosen appearance, so a lighting change never rebuilds it', () => {
    for (const mode of ['day', 'evening', 'night', 'clock'] as const) {
      expect(resolveAppearance(settings('dark'), false, lit(mode), 12 * 3600).darkMap).toBe(true);
      expect(resolveAppearance(settings('system'), true, lit(mode), 12 * 3600).darkMap).toBe(true);
      expect(resolveAppearance(settings('light'), true, lit(mode), 12 * 3600).darkMap).toBe(false);
      // Match lighting darkens only the chrome.
      expect(resolveAppearance(settings('light', true), false, lit(mode), 0).darkMap).toBe(false);
    }
  });
});

describe('V166 dark map palette', () => {
  test('covers every class the light palette colours', () => {
    const { light, dark } = mapPalettes;
    expect(light.context).toBe(style.context);
    expect(Object.keys(dark.context.landuseSub).sort()).toEqual(
      Object.keys(light.context.landuseSub).sort(),
    );
    expect(Object.keys(dark.buildings.walls).sort()).toEqual(
      Object.keys(light.buildings.walls).sort(),
    );
    expect(Object.keys(dark.buildings.roofs).sort()).toEqual(
      Object.keys(light.buildings.roofs).sort(),
    );
  });

  test('place tints and paving are toned for the dark ground, not near-white', () => {
    const light = placeColors('work'),
      dark = placeColors('work', mapPalettes.dark.placeBase);
    const grey = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    expect(grey(dark.fill)).toBeLessThan(grey(light.fill) / 3);
    // Paving: toned down from near-white, below the real asphalt, above the ground.
    const { sidewalk, footway } = mapPalettes.dark.walk;
    for (const paving of [sidewalk, footway]) {
      expect(grey(paving)).toBeLessThan(grey(style.asphalt));
      expect(grey(paving)).toBeGreaterThan(2 * grey(mapPalettes.dark.background));
    }
    expect(grey(dark.fill)).toBeGreaterThan(grey(mapPalettes.dark.background));
    expect(grey(dark.edge)).toBeGreaterThan(grey(dark.fill));
  });

  test('daylight in dark keeps the Day light and swaps only the canvas', () => {
    const day = sceneLight(defaultLighting, 0);
    const dark = sceneLight(defaultLighting, 0, mapPalettes.dark.background);
    expect(dark).toEqual({ ...day, background: mapPalettes.dark.background });
    expect(sceneLight(defaultLighting, 0, style.background)).toEqual(day);
  });

  test('3D buildings and ground take the dark colours, a step lighter than the canvas', () => {
    const square = (x: number) => [
      { x, y: 0 },
      { x: x + 20, y: 0 },
      { x: x + 20, y: 20 },
      { x, y: 20 },
      { x, y: 0 },
    ];
    const features: ContextFeature[] = [
      { kind: 'area', class: 'building', rings: [square(0)], levels: 3 },
      { kind: 'area', class: 'green', rings: [square(40)] },
    ];
    const mean = (palette = mapPalettes.light) => {
      const context = buildContext(features, undefined, true, palette);
      const colours = context.detailedBuildings.getAttribute('color');
      let sum = 0;
      for (let i = 0; i < colours.count; i++) sum += colours.getY(i);
      return {
        buildings: sum / colours.count,
        ground: context.ground.getAttribute('color').getY(0),
      };
    };
    const light = mean(),
      dark = mean(mapPalettes.dark);
    expect(dark.buildings).toBeLessThan(light.buildings / 4);
    expect(dark.ground).toBeLessThan(light.ground / 4);
    // Linear green channel of the dark canvas: buildings stand a step above it.
    const canvasGreen = (((mapPalettes.dark.background >> 8) & 255) / 255) ** 2.2;
    expect(dark.buildings).toBeGreaterThan(canvasGreen);
  });
});
