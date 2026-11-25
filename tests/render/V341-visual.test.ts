import { describe, expect, test } from 'vitest';
import {
  addsOffline,
  climateZone,
  currentPreset,
  defaultVisual,
  foliageSeason,
  localToUtc,
  parseVisual,
  qualityPresets,
  sceneLight,
  solarPosition,
  zoneFor,
  type VisualSettings,
} from '../../src/render/lighting';
import { lightingKey, loadVisual, saveVisual, visualKey } from '../../src/ui/lighting-store';

const utc = (date: string, time: string, zone: string) => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return localToUtc(date, h * 3600 + m * 60, zone);
};

describe('V341 sun position', () => {
  // Published by timeanddate.com for 2026, in local time: sunrise and sunset put the sun's centre
  // 0.833° below the geometric horizon (half the disc and the refraction); azimuths in whole
  // degrees, noon altitudes (with refraction) to 0.1°.
  const places = [
    {
      name: 'London',
      lat: 51.5074,
      lon: -0.1278,
      zone: 'Europe/London',
      date: '2026-06-21',
      rise: ['04:43', 49],
      set: ['21:21', 311],
      noon: ['13:02', 61.9],
    },
    {
      name: 'Sydney',
      lat: -33.8688,
      lon: 151.2093,
      zone: 'Australia/Sydney',
      date: '2026-06-21',
      rise: ['06:59', 62],
      set: ['16:53', 298],
      noon: ['11:56', 32.7],
    },
    {
      name: 'Munich',
      lat: 48.137,
      lon: 11.575,
      zone: 'Europe/Berlin',
      date: '2026-12-21',
      rise: ['08:01', 125],
      set: ['16:22', 235],
      noon: ['12:11', 18.5],
    },
    {
      name: 'Singapore',
      lat: 1.2897,
      lon: 103.8501,
      zone: 'Asia/Singapore',
      date: '2026-03-20',
      rise: ['07:08', 90],
      set: ['19:15', 270],
      noon: ['13:12', 88.6],
    },
  ] as const;

  test.each(places)('$name: sunrise, sunset and noon within 0.5° of the published values', (p) => {
    const sun = (time: string) => solarPosition(utc(p.date, time, p.zone), p.lat, p.lon);
    // A minute of rounding moves the sun by at most 0.25° at these latitudes.
    expect(Math.abs(sun(p.rise[0]).geometric + 0.833)).toBeLessThan(0.5);
    expect(Math.abs(sun(p.set[0]).geometric + 0.833)).toBeLessThan(0.5);
    expect(Math.abs(sun(p.noon[0]).elevation - p.noon[1])).toBeLessThan(0.5);
    // Published azimuths are whole degrees: within their rounding and the half-degree.
    expect(Math.abs(sun(p.rise[0]).azimuth - p.rise[1])).toBeLessThan(1);
    expect(Math.abs(sun(p.set[0]).azimuth - p.set[1])).toBeLessThan(1);
  });

  test("NREL's SPA example: Golden, Colorado, 17 October 2003 12:30:30 MST", () => {
    // Reda and Andreas (2004), table A5.1: topocentric zenith 50.11162°, azimuth 194.34024°.
    const sun = solarPosition(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786);
    expect(Math.abs(90 - sun.elevation - 50.11162)).toBeLessThan(0.5);
    expect(Math.abs(sun.azimuth - 194.34024)).toBeLessThan(0.5);
  });

  test('local clock time follows daylight saving through Intl', () => {
    expect(utc('2026-01-15', '12:00', 'Europe/Berlin')).toBe(Date.UTC(2026, 0, 15, 11));
    expect(utc('2026-07-15', '12:00', 'Europe/Berlin')).toBe(Date.UTC(2026, 6, 15, 10));
    expect(utc('2026-07-15', '12:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 15, 16));
    expect(utc('2026-07-15', '12:00', 'Australia/Sydney')).toBe(Date.UTC(2026, 6, 15, 2));
  });

  test("the derived zone: the nearest standard offset in the longitude's region", () => {
    expect(zoneFor(11.575, 48.137)).toBe('Europe/Berlin');
    expect(zoneFor(0.05, 51.5)).toBe('Europe/London');
    expect(zoneFor(-75.16, 39.95)).toBe('America/New_York');
    expect(zoneFor(151.2, -33.87)).toBe('Australia/Sydney');
    expect(zoneFor(139.7, 35.7)).toBe('Asia/Tokyo');
  });

  test("Clock follows the project's location, Day does not", () => {
    const clock = { ...defaultVisual, mode: 'clock' as const, date: '2026-12-21' };
    // 16:00 in December: Munich's sun is still up, Helsinki's has set.
    const munich = sceneLight(clock, 16 * 3600, undefined, { lat: 48.137, lon: 11.575 });
    const helsinki = sceneLight(clock, 16 * 3600, undefined, { lat: 60.17, lon: 24.94 });
    expect(munich.shadows).toBe(true);
    expect(helsinki.shadows).toBe(false);
    const day = { ...defaultVisual };
    expect(sceneLight(day, 16 * 3600, undefined, { lat: 60.17, lon: 24.94 })).toEqual(
      sceneLight(day, 16 * 3600),
    );
    // Fixed reads its own time, not the simulation clock.
    const fixed = { ...clock, mode: 'fixed' as const, time: '12:00' };
    expect(sceneLight(fixed, 0)).toEqual(sceneLight(fixed, 20 * 3600));
    expect(sceneLight(fixed, 0).shadows).toBe(true);
  });
});

describe('V341 light by source', () => {
  test('each source scales its own light, and the defaults leave the light as it was', () => {
    const night = { ...defaultVisual, mode: 'night' as const };
    const base = sceneLight(night, 0);
    expect(base).toMatchObject({ lamps: 1, windowGlow: 1, vehicleLights: 1, railLights: 1 });
    const tuned = sceneLight(
      { ...night, lampIntensity: 2, vehicleLights: 0, windowShare: 2, sunIntensity: 0.5 },
      0,
    );
    expect(tuned.lamps).toBe(2);
    expect(tuned.vehicleLights).toBe(0);
    expect(tuned.windows).toBeCloseTo(base.windows * 2);
    expect(tuned.sunIntensity).toBeCloseTo(base.sunIntensity / 2);
    expect(tuned.airfieldLights).toBe(base.airfieldLights);
    // Lamps can stay on by day or off at night.
    expect(sceneLight({ ...defaultVisual, lampMode: 'always' }, 0).lamps).toBe(1);
    expect(sceneLight({ ...night, lampMode: 'off' }, 0).lamps).toBe(0);
    // A colour temperature replaces the preset's sun colour: warm is red-heavy.
    const warm = sceneLight({ ...defaultVisual, sunKelvin: 2500 }, 0).sunColor;
    expect(warm >> 16).toBeGreaterThan(warm & 255);
  });
});

describe('V341 climate zones and foliage', () => {
  test.each([
    ['Munich', 48.14, 11.58, 'temperate'],
    ['London', 51.5, 0.05, 'temperate'],
    ['Philadelphia', 39.95, -75.16, 'temperate'],
    ['Sydney', -33.87, 151.2, 'temperate'],
    ['Barcelona', 41.39, 2.17, 'mediterranean'],
    ['Los Angeles', 34.05, -118.24, 'mediterranean'],
    ['Perth', -31.95, 115.86, 'mediterranean'],
    ['Cairo', 30.04, 31.24, 'arid'],
    ['Phoenix', 33.45, -112.07, 'arid'],
    ['Dubai', 25.2, 55.27, 'arid'],
    ['Singapore', 1.29, 103.85, 'tropical'],
    ['Rio de Janeiro', -22.9, -43.2, 'tropical'],
    ['Helsinki', 60.17, 24.94, 'boreal'],
    ['Moscow', 55.75, 37.62, 'temperate'],
    ['Montreal', 45.5, -73.57, 'temperate'],
    ['Winnipeg', 49.9, -97.14, 'temperate'],
    ['Edmonton', 53.55, -113.49, 'boreal'],
  ] as const)('%s is %s', (_, lat, lon, zone) => {
    expect(climateZone({ lat, lon })).toBe(zone);
  });

  test('Auto foliage takes the season of the date in the hemisphere', () => {
    const on = (date: string, lat: number, lon: number) =>
      foliageSeason({ ...defaultVisual, date }, { lat, lon });
    expect(on('2026-03-21', 48.14, 11.58)).toBe('spring');
    expect(on('2026-07-01', 48.14, 11.58)).toBe('summer');
    expect(on('2026-12-21', 48.14, 11.58)).toBe('winter');
    expect(on('2026-03-21', -33.87, 151.2)).toBe('autumn');
    expect(on('2026-07-01', -33.87, 151.2)).toBe('winter');
    // The tropics keep their leaves.
    expect(on('2026-12-21', 1.29, 103.85)).toBe('summer');
  });
});

describe('V341 settings', () => {
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
    expect(loadVisual(storage)).toEqual(defaultVisual);
    const changed: VisualSettings = {
      ...defaultVisual,
      mode: 'fixed',
      exposure: 2.5,
      date: '2026-08-02',
      time: '19:45',
      location: { lat: -33.87, lon: 151.2 },
      timeZone: 'Australia/Sydney',
      shadowResolution: 8192,
      casters: { ...defaultVisual.casters, trees: true },
      speciesMix: 'custom',
      kitWeights: { ...defaultVisual.kitWeights, palm: 1 },
      renderScale: 1.5,
    };
    saveVisual(storage, changed);
    expect(JSON.parse(storage.values.get(visualKey)!)).toEqual(changed);
    expect(loadVisual(storage)).toEqual(changed);
  });

  test('lighting stored before TASK-341 migrates, its season becoming a date', () => {
    const storage = memory();
    storage.values.set(lightingKey, '{"mode":"clock","exposure":0.8,"season":"winter"}');
    expect(loadVisual(storage)).toEqual({
      ...defaultVisual,
      mode: 'clock',
      exposure: 0.8,
      date: '2026-12-21',
    });
    expect(parseVisual({ season: 'summer' }).date).toBe('2026-06-21');
    expect(parseVisual({ season: 'equinox' }).date).toBe('2026-03-21');
    // Before TASK-184 there was no season.
    storage.values.set(lightingKey, '{"mode":"clock","exposure":0.9}');
    expect(loadVisual(storage)).toEqual({ ...defaultVisual, mode: 'clock', exposure: 0.9 });
    // The new key wins once written.
    saveVisual(storage, { ...defaultVisual, mode: 'night' });
    expect(loadVisual(storage).mode).toBe('night');
  });

  test('missing, broken or throwing storage falls back to the defaults', () => {
    expect(loadVisual(undefined)).toEqual(defaultVisual);
    const broken = memory();
    broken.values.set(visualKey, '{not json');
    expect(loadVisual(broken)).toEqual(defaultVisual);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadVisual(throwing)).toEqual(defaultVisual);
    expect(() => saveVisual(throwing, defaultVisual)).not.toThrow();
  });

  test('each malformed field falls back on its own', () => {
    expect(parseVisual(null)).toEqual(defaultVisual);
    expect(parseVisual('evening')).toEqual(defaultVisual);
    const parsed = parseVisual({
      mode: 'dusk',
      exposure: 9,
      date: '2026-02-30',
      time: '25:00',
      location: { lat: 95, lon: 0 },
      timeZone: 'Mars/Olympus',
      sunIntensity: -1,
      lampMode: 'sometimes',
      shadowResolution: 3000,
      casters: { trees: true, buildings: 'yes' },
      speciesMix: 'jungle',
      kitWeights: { palm: 4 },
      colourVariation: Number.NaN,
      renderScale: 3,
      dropLines: 0,
      shadowRange: 'far',
    });
    expect(parsed).toEqual({
      ...defaultVisual,
      exposure: 3,
      sunIntensity: 0,
      casters: { ...defaultVisual.casters, trees: true },
      kitWeights: { ...defaultVisual.kitWeights, palm: 1 },
      shadowRange: 'far',
    });
  });

  test('presets: Balanced is the default, a change shows Custom, Cinematic is offline', () => {
    expect(currentPreset(defaultVisual)).toBe('balanced');
    for (const [name, preset] of Object.entries(qualityPresets))
      expect(currentPreset({ ...defaultVisual, ...preset })).toBe(name);
    expect(currentPreset({ ...defaultVisual, shadowSoft: true })).toBe('custom');
    expect(
      currentPreset({ ...defaultVisual, casters: { ...defaultVisual.casters, people: false } }),
    ).toBe('custom');
    // The light is the viewer's: presets keep it.
    expect(currentPreset({ ...defaultVisual, mode: 'night', exposure: 2 })).toBe('balanced');
    const cinematic = { ...defaultVisual, ...qualityPresets.cinematic };
    expect(addsOffline(defaultVisual, cinematic)).toBe(true);
    expect(addsOffline(cinematic, { ...cinematic, shadowSoft: false })).toBe(false);
    expect(addsOffline(defaultVisual, { ...defaultVisual, ...qualityPresets.ultra })).toBe(false);
  });
});
