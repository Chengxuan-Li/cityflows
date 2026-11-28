import type { LonLat } from '../geo/projection';
import type { CompiledCity } from '../network';
import { platformRing, spine } from './station-furniture';
import { style } from './style';
import type { TramStopPlacement } from './tram-stops';

/** TASK-163, TASK-341: view-only scene lighting and render quality, a per-viewer preference.
 * Nothing here reaches the simulation or the project. */
export type LightingMode = 'day' | 'evening' | 'night' | 'clock' | 'fixed';
export type LampMode = 'auto' | 'always' | 'off';
export type ShadowRange = 'near' | 'medium' | 'far';
export type ShadowResolution = 1024 | 2048 | 4096 | 8192;
export type Caster = 'buildings' | 'trees' | 'vehicles' | 'aircraft' | 'people' | 'furniture';
export type TreeKit = 'round' | 'spreading' | 'columnar' | 'palm' | 'cone' | 'cypress' | 'umbrella';
export type ClimateZone = 'tropical' | 'arid' | 'mediterranean' | 'temperate' | 'boreal';
export type SpeciesMix = 'map' | 'auto' | ClimateZone | 'street' | 'custom';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type FoliageColour = 'natural' | 'vivid' | 'muted' | 'map';
export type RenderScale = 1 | 1.5 | 2;
export type QualityPreset = 'low' | 'balanced' | 'high' | 'ultra' | 'cinematic';

export interface VisualSettings {
  mode: LightingMode;
  /** Multiplies the scene's light: sun, sky, unlit surfaces and the background. */
  exposure: number;
  /** The day Clock and Fixed light, `YYYY-MM-DD`; Auto foliage takes its season from it. */
  date: string;
  /** Fixed's local clock time, `HH:MM`. */
  time: string;
  /** Overrides the project's geo origin. */
  location: LonLat | null;
  /** An IANA zone; null derives one from the longitude. */
  timeZone: string | null;
  sunIntensity: number;
  /** The sun's colour temperature in kelvin; null keeps the preset's colour. */
  sunKelvin: number | null;
  skyIntensity: number;
  lampIntensity: number;
  lampMode: LampMode;
  /** Multiplies the share of windows lit after dark, and their brightness. */
  windowShare: number;
  windowBrightness: number;
  vehicleLights: number;
  airfieldLights: number;
  railLights: number;
  shadows: boolean;
  shadowRange: ShadowRange;
  shadowResolution: ShadowResolution;
  shadowSoft: boolean;
  casters: Record<Caster, boolean>;
  speciesMix: SpeciesMix;
  /** Custom mix weights, 0 to 1 per kit. */
  kitWeights: Record<TreeKit, number>;
  foliageSeason: Season | 'auto';
  foliageColour: FoliageColour;
  /** Colour difference between trees, 0 (all alike) to 1; 0.3 is the map palette's spread. */
  colourVariation: number;
  /** Times the device pixel ratio (itself capped at 2). */
  renderScale: RenderScale;
  dropLines: boolean;
  /** TASK-384: shows the sidebar's Debug section. */
  developerTools: boolean;
}

export const lightingModes: readonly LightingMode[] = ['day', 'evening', 'night', 'clock', 'fixed'];
export const exposureRange = { min: 0.5, max: 3, step: 0.05 } as const;
export const intensityRange = { min: 0, max: 2, step: 0.05 } as const;
export const casters: readonly Caster[] = [
  'buildings',
  'trees',
  'vehicles',
  'aircraft',
  'people',
  'furniture',
];
export const treeKits: readonly { kit: TreeKit; needle: boolean }[] = [
  { kit: 'round', needle: false },
  { kit: 'spreading', needle: false },
  { kit: 'columnar', needle: false },
  { kit: 'palm', needle: false },
  { kit: 'cone', needle: true },
  { kit: 'cypress', needle: true },
  { kit: 'umbrella', needle: true },
];
const weights = (w: Partial<Record<TreeKit, number>>): Record<TreeKit, number> => ({
  round: 0,
  spreading: 0,
  columnar: 0,
  palm: 0,
  cone: 0,
  cypress: 0,
  umbrella: 0,
  ...w,
});
/** Weights over the kits. Broadleaved trees pick among the broadleaf kits, needleleaved trees
 * among the conifers, so the mapped leaf type always holds. Map is the map's two shapes. */
export const speciesMixes: Record<
  Exclude<SpeciesMix, 'auto' | 'custom'>,
  Record<TreeKit, number>
> = {
  map: weights({ round: 1, cone: 1 }),
  temperate: weights({ round: 0.45, spreading: 0.35, columnar: 0.2, cone: 1 }),
  boreal: weights({ round: 0.5, columnar: 0.5, cone: 0.6, cypress: 0.4 }),
  mediterranean: weights({
    round: 0.45,
    spreading: 0.25,
    columnar: 0.15,
    palm: 0.15,
    cypress: 0.5,
    umbrella: 0.5,
  }),
  tropical: weights({ palm: 0.45, spreading: 0.35, round: 0.2, umbrella: 0.5, cone: 0.5 }),
  arid: weights({ palm: 0.4, spreading: 0.4, round: 0.2, umbrella: 0.6, cypress: 0.4 }),
  street: weights({ round: 0.6, columnar: 0.4, cypress: 0.5, cone: 0.5 }),
};

const allCasters = {
  buildings: true,
  trees: true,
  vehicles: true,
  aircraft: true,
  people: true,
  furniture: true,
};
/** Today's casters: trees and aircraft cast no shadow in the map look. */
const mapCasters = { ...allCasters, trees: false, aircraft: false };
const munich: LonLat = { lon: 11.575, lat: 48.137 };

export const defaultVisual: VisualSettings = {
  mode: 'day',
  exposure: 1,
  date: '2026-03-21',
  time: '12:00',
  location: null,
  timeZone: null,
  sunIntensity: 1,
  sunKelvin: null,
  skyIntensity: 1,
  lampIntensity: 1,
  lampMode: 'auto',
  windowShare: 1,
  windowBrightness: 1,
  vehicleLights: 1,
  airfieldLights: 1,
  railLights: 1,
  shadows: true,
  shadowRange: 'near',
  shadowResolution: 2048,
  shadowSoft: false,
  casters: mapCasters,
  speciesMix: 'map',
  kitWeights: speciesMixes.temperate,
  foliageSeason: 'auto',
  foliageColour: 'map',
  colourVariation: 0.3,
  renderScale: 1,
  dropLines: true,
  developerTools: false,
};

type PresetFields = Pick<
  VisualSettings,
  | 'shadows'
  | 'shadowRange'
  | 'shadowResolution'
  | 'shadowSoft'
  | 'casters'
  | 'speciesMix'
  | 'foliageColour'
  | 'renderScale'
>;
/** Quality presets move the settings whose cost or look is a matter of quality. Balanced is the
 * look before TASK-341; the light itself (mode, date, sources) is the viewer's and stays. */
export const qualityPresets: Record<QualityPreset, PresetFields> = {
  low: {
    shadows: false,
    shadowRange: 'near',
    shadowResolution: 1024,
    shadowSoft: false,
    casters: mapCasters,
    speciesMix: 'map',
    foliageColour: 'map',
    renderScale: 1,
  },
  balanced: {
    shadows: true,
    shadowRange: 'near',
    shadowResolution: 2048,
    shadowSoft: false,
    casters: mapCasters,
    speciesMix: 'map',
    foliageColour: 'map',
    renderScale: 1,
  },
  high: {
    shadows: true,
    shadowRange: 'medium',
    shadowResolution: 4096,
    shadowSoft: true,
    casters: allCasters,
    speciesMix: 'auto',
    foliageColour: 'natural',
    renderScale: 1,
  },
  ultra: {
    shadows: true,
    shadowRange: 'far',
    shadowResolution: 4096,
    shadowSoft: true,
    casters: allCasters,
    speciesMix: 'auto',
    foliageColour: 'natural',
    renderScale: 1.5,
  },
  cinematic: {
    shadows: true,
    shadowRange: 'far',
    shadowResolution: 8192,
    shadowSoft: true,
    casters: allCasters,
    speciesMix: 'auto',
    foliageColour: 'natural',
    renderScale: 2,
  },
};

/** The preset the settings match, or 'custom' once any of its settings changed. */
export function currentPreset(settings: VisualSettings): QualityPreset | 'custom' {
  const match = Object.entries(qualityPresets).find(([, preset]) =>
    Object.entries(preset).every(([key, value]) =>
      key === 'casters'
        ? casters.every((c) => settings.casters[c] === (value as Record<Caster, boolean>)[c])
        : settings[key as keyof PresetFields] === value,
    ),
  );
  return match ? (match[0] as QualityPreset) : 'custom';
}

/** Shipping category of a value (TASK-341): 3 experimental, lowers the frame rate; 4 offline
 * rendering, very slow. 1 and 2 need no marking. */
export function category(settings: Pick<VisualSettings, 'shadowResolution' | 'renderScale'>) {
  return {
    shadowResolution: settings.shadowResolution === 8192 ? 4 : 2,
    renderScale: settings.renderScale === 2 ? 4 : settings.renderScale === 1.5 ? 3 : 2,
  } as const;
}
/** Whether `next` turns on an offline (category 4) value that `previous` did not have. */
export function addsOffline(previous: VisualSettings, next: VisualSettings) {
  const before = category(previous),
    after = category(next);
  return (Object.keys(after) as (keyof typeof after)[]).some(
    (key) => after[key] === 4 && before[key] !== 4,
  );
}

const finite = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const oneOf = <T>(value: unknown, values: readonly T[], fallback: T) =>
  values.includes(value as T) ? (value as T) : fallback;
const validDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const validTime = (value: unknown) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validZone(zone: unknown): zone is string {
  if (typeof zone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
/** The three seasons Clock had before TASK-341 become days of the year. */
const seasonDates: Record<string, string> = {
  summer: '2026-06-21',
  equinox: '2026-03-21',
  winter: '2026-12-21',
};

/** Settings from storage or any other untrusted source, including the lighting stored before
 * TASK-341 ({mode, exposure, season}); each malformed field falls back on its own. */
export function parseVisual(value: unknown): VisualSettings {
  if (typeof value !== 'object' || value === null) return defaultVisual;
  const v = value as Record<string, unknown>;
  const d = defaultVisual;
  const record = <K extends string, T>(
    input: unknown,
    keys: readonly K[],
    fallback: Record<K, T>,
    parse: (value: unknown, fallback: T) => T,
  ) =>
    Object.fromEntries(
      keys.map((k) => [
        k,
        parse(
          typeof input === 'object' && input ? (input as Record<K, unknown>)[k] : undefined,
          fallback[k],
        ),
      ]),
    ) as Record<K, T>;
  const location = v.location as Record<string, unknown> | null | undefined;
  const intensity = (key: keyof VisualSettings) =>
    finite(v[key], intensityRange.min, intensityRange.max, d[key] as number);
  return {
    mode: oneOf(v.mode, lightingModes, d.mode),
    exposure: finite(v.exposure, exposureRange.min, exposureRange.max, d.exposure),
    date: validDate(v.date) ? (v.date as string) : (seasonDates[v.season as string] ?? d.date),
    time: validTime(v.time) ? (v.time as string) : d.time,
    location:
      location &&
      typeof location.lat === 'number' &&
      typeof location.lon === 'number' &&
      Math.abs(location.lat) <= 90 &&
      Math.abs(location.lon) <= 180
        ? { lat: location.lat, lon: location.lon }
        : null,
    timeZone: validZone(v.timeZone) ? v.timeZone : null,
    sunIntensity: intensity('sunIntensity'),
    sunKelvin:
      v.sunKelvin === null || v.sunKelvin === undefined
        ? null
        : finite(v.sunKelvin, 1500, 12000, 5500),
    skyIntensity: intensity('skyIntensity'),
    lampIntensity: intensity('lampIntensity'),
    lampMode: oneOf(v.lampMode, ['auto', 'always', 'off'] as const, d.lampMode),
    windowShare: intensity('windowShare'),
    windowBrightness: intensity('windowBrightness'),
    vehicleLights: intensity('vehicleLights'),
    airfieldLights: intensity('airfieldLights'),
    railLights: intensity('railLights'),
    shadows: typeof v.shadows === 'boolean' ? v.shadows : d.shadows,
    shadowRange: oneOf(v.shadowRange, ['near', 'medium', 'far'] as const, d.shadowRange),
    shadowResolution: oneOf(
      v.shadowResolution,
      [1024, 2048, 4096, 8192] as const,
      d.shadowResolution,
    ),
    shadowSoft: typeof v.shadowSoft === 'boolean' ? v.shadowSoft : d.shadowSoft,
    casters: record(v.casters, casters, d.casters, (x, f) => (typeof x === 'boolean' ? x : f)),
    speciesMix: oneOf(
      v.speciesMix,
      [
        'map',
        'auto',
        'temperate',
        'boreal',
        'mediterranean',
        'tropical',
        'arid',
        'street',
        'custom',
      ] as const,
      d.speciesMix,
    ),
    kitWeights: record(
      v.kitWeights,
      treeKits.map((k) => k.kit),
      d.kitWeights,
      (x, f) => finite(x, 0, 1, f),
    ),
    foliageSeason: oneOf(
      v.foliageSeason,
      ['auto', 'spring', 'summer', 'autumn', 'winter'] as const,
      d.foliageSeason,
    ),
    foliageColour: oneOf(
      v.foliageColour,
      ['natural', 'vivid', 'muted', 'map'] as const,
      d.foliageColour,
    ),
    colourVariation: finite(v.colourVariation, 0, 1, d.colourVariation),
    renderScale: oneOf(v.renderScale, [1, 1.5, 2] as const, d.renderScale),
    dropLines: typeof v.dropLines === 'boolean' ? v.dropLines : d.dropLines,
    developerTools: v.developerTools === true,
  };
}

// --- Place, time zone and sun ---------------------------------------------------------------

/** Where the light is computed: the override, else the project's origin, else Munich (synthetic
 * cities carry no location; Munich's was the only sun before TASK-341). */
export function lightPlace(settings: VisualSettings, origin: LonLat | undefined) {
  const at = settings.location ?? origin ?? munich;
  return { ...at, timeZone: settings.timeZone ?? zoneFor(at.lon, at.lat) };
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** Minutes the zone's clock runs ahead of UTC at `utcMs`, daylight saving included. */
export function zoneOffset(zone: string, utcMs: number) {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(zone, format);
  }
  const part = Object.fromEntries(
    format.formatToParts(new Date(utcMs)).map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(
    part.year!,
    part.month! - 1,
    part.day!,
    part.hour!,
    part.minute!,
    part.second!,
  );
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
}
/** The UTC instant of a local clock reading: `date` at `seconds` past its local midnight. */
export function localToUtc(date: string, seconds: number, zone: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d) + seconds * 1000;
  let utc = wall - zoneOffset(zone, wall) * 60000;
  utc = wall - zoneOffset(zone, utc) * 60000;
  return utc;
}

/** Zones to prefer when several share the nearest standard offset in a region. */
const preferredZones = [
  'Europe/London',
  'Europe/Berlin',
  'Europe/Athens',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Africa/Lagos',
  'Africa/Johannesburg',
];
const zones = new Map<number, string>();
/** TASK-341: with no zone recorded, the zone whose standard offset is nearest to longitude / 15,
 * among the zones of the longitude's continent, a major city's zone first. The standard offset is
 * the smaller of January's and July's, which drops daylight saving in either hemisphere. */
export function zoneFor(lon: number, lat = 45) {
  const key = Math.round(lon * 10) * 1000 + Math.round(lat);
  const cached = zones.get(key);
  if (cached) return cached;
  const region =
    lon < -30
      ? 'America/'
      : lon < 60 && lat > 35
        ? 'Europe/'
        : lon < 35 && lat <= 35
          ? 'Africa/'
          : lon > 110 && lat < -10
            ? 'Australia/'
            : 'Asia/';
  const standard = (zone: string) =>
    Math.min(zoneOffset(zone, Date.UTC(2026, 0, 15)), zoneOffset(zone, Date.UTC(2026, 6, 15))) / 60;
  const all = Intl.supportedValuesOf('timeZone');
  const candidates = all.filter((z) => z.startsWith(region));
  const pool = candidates.length ? candidates : all;
  const nearest = Math.min(...pool.map((z) => Math.abs(standard(z) - lon / 15)));
  const matching = pool.filter((z) => Math.abs(standard(z) - lon / 15) === nearest);
  const zone = preferredZones.find((z) => matching.includes(z)) ?? matching.sort()[0]!;
  zones.set(key, zone);
  return zone;
}

const rad = Math.PI / 180;
/** The sun's position by the NOAA solar calculator's equations (Meeus): `elevation` in degrees
 * above the horizon with atmospheric refraction, as NOAA reports it, and compass `azimuth`. */
export function solarPosition(utcMs: number, lat: number, lon: number) {
  const jd = utcMs / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * rad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparent = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const obliquity =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 +
    0.00256 * Math.cos(omega * rad);
  const declination = Math.asin(Math.sin(obliquity * rad) * Math.sin(apparent * rad));
  const y = Math.tan((obliquity / 2) * rad) ** 2;
  const equationOfTime =
    (4 *
      (y * Math.sin(2 * l0 * rad) -
        2 * e * Math.sin(m * rad) +
        4 * e * y * Math.sin(m * rad) * Math.cos(2 * l0 * rad) -
        0.5 * y * y * Math.sin(4 * l0 * rad) -
        1.25 * e * e * Math.sin(2 * m * rad))) /
    rad;
  const minutes = (((utcMs / 60000) % 1440) + 1440) % 1440;
  const solarTime = (((minutes + equationOfTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (solarTime / 4 < 0 ? solarTime / 4 + 180 : solarTime / 4 - 180) * rad;
  const phi = lat * rad;
  const cosZenith = Math.min(
    1,
    Math.max(
      -1,
      Math.sin(phi) * Math.sin(declination) +
        Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
    ),
  );
  const zenith = Math.acos(cosZenith);
  const geometric = 90 - zenith / rad;
  const tanE = Math.tan(geometric * rad);
  const refraction =
    geometric > 85
      ? 0
      : geometric > 5
        ? 58.1 / tanE - 0.07 / tanE ** 3 + 0.000086 / tanE ** 5
        : geometric > -0.575
          ? 1735 +
            geometric * (-518.2 + geometric * (103.4 + geometric * (-12.79 + geometric * 0.711)))
          : -20.772 / tanE;
  const cosAzimuth =
    (Math.sin(phi) * Math.cos(zenith) - Math.sin(declination)) / (Math.cos(phi) * Math.sin(zenith));
  const fromNorth = Math.acos(Math.min(1, Math.max(-1, cosAzimuth))) / rad;
  const azimuth = hourAngle > 0 ? (fromNorth + 180) % 360 : (540 - fromNorth) % 360;
  return { elevation: geometric + refraction / 3600, geometric, azimuth };
}

/** The sun for Clock (`seconds` of simulation time past midnight on the settings' date) or Fixed
 * (the settings' time): elevation in degrees, 0 at sunrise and sunset (the upper limb, with
 * refraction: the geometric elevation plus 0.833), compass azimuth and the local clock hour. */
export function sunAt(settings: VisualSettings, seconds: number, origin?: LonLat) {
  const place = lightPlace(settings, origin);
  const local =
    settings.mode === 'fixed'
      ? Number(settings.time.slice(0, 2)) * 3600 + Number(settings.time.slice(3)) * 60
      : seconds;
  const { geometric, azimuth } = solarPosition(
    localToUtc(settings.date, local, place.timeZone),
    place.lat,
    place.lon,
  );
  return { elevation: geometric + 0.833, azimuth, hour: (((local / 3600) % 24) + 24) % 24 };
}

/** TASK-341: a climate zone from a location by a few rules, no dataset: the dry belts and the
 * Mediterranean-climate coasts by boxes, then latitude. */
export function climateZone({ lat, lon }: LonLat): ClimateZone {
  const box = (lat0: number, lat1: number, lon0: number, lon1: number) =>
    lat >= lat0 && lat <= lat1 && lon >= lon0 && lon <= lon1;
  if (
    box(31, 45, -10, 40) || // the Mediterranean basin
    box(32, 42, -125, -117) || // California
    box(-38, -30, -75, -70) || // central Chile
    box(-36, -30, 113, 120) || // south-western Australia
    box(-35, -32, 17, 21) // the Cape
  )
    return 'mediterranean';
  if (
    box(15, 31, -17, 35) || // the Sahara
    box(12, 38, 35, 62) || // Arabia, Mesopotamia and Iran
    box(35, 48, 50, 110) || // the Central Asian steppe and deserts
    box(23, 37, -117, -100) || // the American south-west
    box(-32, -18, 117, 148) || // inland Australia
    box(-30, -15, -75, -68) || // the Atacama
    box(-30, -17, 12, 25) // Namib and Kalahari
  )
    return 'arid';
  if (Math.abs(lat) <= 23.5) return 'tropical';
  if (Math.abs(lat) >= 58 || (lat >= 50 && (lon < -60 || lon > 40))) return 'boreal';
  return 'temperate';
}

/** The season foliage shows: the chosen one, or the date's in the place's hemisphere. The tropics
 * and dry belts keep their leaves. */
export function foliageSeason(settings: VisualSettings, origin?: LonLat): Season {
  if (settings.foliageSeason !== 'auto') return settings.foliageSeason;
  const place = lightPlace(settings, origin);
  const zone = climateZone(place);
  if (zone === 'tropical' || zone === 'arid') return 'summer';
  const month = Number(settings.date.slice(5, 7));
  const shifted = place.lat < 0 ? ((month + 5) % 12) + 1 : month;
  return shifted >= 3 && shifted <= 5
    ? 'spring'
    : shifted >= 6 && shifted <= 8
      ? 'summer'
      : shifted >= 9 && shifted <= 11
        ? 'autumn'
        : 'winter';
}

/** The kit weights a species choice draws from at a place. */
export function mixWeights(settings: VisualSettings, origin?: LonLat): Record<TreeKit, number> {
  const mix = settings.speciesMix;
  if (mix === 'custom') return settings.kitWeights;
  return speciesMixes[mix === 'auto' ? climateZone(lightPlace(settings, origin)) : mix];
}

/** An sRGB colour for a black body at `kelvin`, by Tanner Helland's fit to the CIE 1964 data. */
export function kelvinToHex(kelvin: number) {
  const t = kelvin / 100;
  const clamp = (c: number) => Math.round(Math.min(255, Math.max(0, c)));
  const r = t <= 66 ? 255 : clamp(329.698727446 * (t - 60) ** -0.1332047592);
  const g =
    t <= 66
      ? clamp(99.4708025861 * Math.log(t) - 161.1195681661)
      : clamp(288.1221695283 * (t - 60) ** -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return (r << 16) | (g << 8) | b;
}

export type Rgb = readonly [number, number, number];
interface Preset {
  /** Unit vector towards the sun (or moon) in the 3D frame: x east, y up, z south. */
  sun: Rgb;
  sunColor: number;
  sunIntensity: number;
  sky: number;
  ground: number;
  skyIntensity: number;
  background: number;
}

/** The resolved light for one frame. Colours are sRGB hex; `ambient` is linear. */
export interface SceneLight {
  sun: Rgb;
  sunColor: number;
  sunIntensity: number;
  /** The sun (not the moon) is up and casts shadows. */
  shadows: boolean;
  sky: number;
  ground: number;
  skyIntensity: number;
  background: number;
  /** Light on a flat, upward surface relative to the Day preset, per linear channel: it shades
   * the unlit 3D surfaces (rail paint, wires, sign faces) and tints the 2D map. */
  ambient: Rgb;
  /** 0 by day, 1 when street lamps, windows and vehicle lights are on. */
  artificial: number;
  /** Share of facade windows lit. */
  windows: number;
  /** TASK-341: each source's level, `artificial` times its intensity (street lamps by their mode). */
  lamps: number;
  windowGlow: number;
  vehicleLights: number;
  airfieldLights: number;
  railLights: number;
}

const toward = (elevationDeg: number, azimuthDeg: number): Rgb => {
  const e = (elevationDeg * Math.PI) / 180,
    a = (azimuthDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};
const dayLength = Math.hypot(1, 1.5, 1);
/** TASK-162's light, unchanged: a white sun from the north-west and a strong white sky. */
const dayPreset: Preset = {
  sun: [-1 / dayLength, 1.5 / dayLength, -1 / dayLength],
  sunColor: 0xffffff,
  sunIntensity: 0.95,
  sky: 0xffffff,
  ground: 0xd9dad6,
  skyIntensity: 2,
  background: style.background,
};
/** Low warm sun in the west-north-west, a dim blue sky. */
const evening: Preset = {
  sun: toward(8, 290),
  sunColor: 0xff9548,
  sunIntensity: 2,
  sky: 0x7489bd,
  ground: 0x34343c,
  skyIntensity: 1,
  background: 0x4a5680,
};
/** Moonlight and a dark blue sky; the moon casts no shadow. */
const night: Preset = {
  sun: toward(38, 200),
  sunColor: 0xa9bcff,
  sunIntensity: 0.3,
  sky: 0x2c3a62,
  ground: 0x0e1017,
  skyIntensity: 0.85,
  background: 0x0f1424,
};

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
export function hexToLinear(hex: number): Rgb {
  return [
    linear(((hex >> 16) & 255) / 255),
    linear(((hex >> 8) & 255) / 255),
    linear((hex & 255) / 255),
  ];
}
export function linearToHex([r, g, b]: Rgb): number {
  const byte = (c: number) => Math.round(Math.min(1, Math.max(0, srgb(c))) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
const mixHex = (a: number, b: number, t: number) => {
  const x = hexToLinear(a),
    y = hexToLinear(b);
  return linearToHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as unknown as Rgb);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const scaleHex = (hex: number, k: number) =>
  k === 1 ? hex : linearToHex(hexToLinear(hex).map((c) => c * k) as unknown as Rgb);

function irradiance(sky: number, skyIntensity: number, sun: Rgb, color: number, intensity: number) {
  const s = hexToLinear(sky),
    c = hexToLinear(color),
    up = Math.max(0, sun[1]);
  return [0, 1, 2].map((i) => s[i]! * skyIntensity + c[i]! * intensity * up) as unknown as Rgb;
}
const dayIrradiance = irradiance(
  dayPreset.sky,
  dayPreset.skyIntensity,
  dayPreset.sun,
  dayPreset.sunColor,
  dayPreset.sunIntensity,
);

/** Share of windows lit through the day: offices by day, homes in the evening, few after midnight. */
function windowShare(hour: number) {
  const points: [number, number][] = [
    [0, 0.2],
    [2, 0.1],
    [5, 0.12],
    [7, 0.3],
    [9, 0.15],
    [17, 0.2],
    [19, 0.45],
    [22, 0.4],
    [24, 0.2],
  ];
  const i = points.findIndex(([h]) => h > hour);
  const [h0, s0] = points[i - 1]!,
    [h1, s1] = points[i]!;
  return mix(s0, s1, (hour - h0) / (h1 - h0));
}

function resolve(
  preset: Preset,
  shadows: boolean,
  artificial: number,
  windows: number,
  settings: VisualSettings,
): SceneLight {
  const { exposure } = settings;
  const sunColor = settings.sunKelvin === null ? preset.sunColor : kelvinToHex(settings.sunKelvin);
  const sunIntensity = preset.sunIntensity * settings.sunIntensity,
    skyIntensity = preset.skyIntensity * settings.skyIntensity;
  const lit = irradiance(preset.sky, skyIntensity, preset.sun, sunColor, sunIntensity);
  const lamps = settings.lampMode === 'off' ? 0 : settings.lampMode === 'always' ? 1 : artificial;
  return {
    sun: preset.sun,
    sunColor,
    sunIntensity: sunIntensity * exposure,
    shadows,
    sky: preset.sky,
    ground: preset.ground,
    skyIntensity: skyIntensity * exposure,
    background: scaleHex(preset.background, exposure),
    ambient: lit.map((v, i) => (v / dayIrradiance[i]!) * exposure) as unknown as Rgb,
    artificial,
    windows: Math.min(1, windows * settings.windowShare),
    lamps: lamps * settings.lampIntensity,
    windowGlow: artificial * settings.windowBrightness,
    vehicleLights: artificial * settings.vehicleLights,
    airfieldLights: artificial * settings.airfieldLights,
    railLights: artificial * settings.railLights,
  };
}

/** The light for `settings` at simulation time `timeS` (seconds since midnight). `canvas` is the
 * map's canvas under the Day light (TASK-166: the dark appearance's canvas); `origin` is the
 * project's geo origin, where Clock and Fixed put the sun (TASK-341). */
export function sceneLight(
  settings: VisualSettings,
  timeS: number,
  canvas: number = style.background,
  origin?: LonLat,
): SceneLight {
  const { mode } = settings;
  const day = canvas === dayPreset.background ? dayPreset : { ...dayPreset, background: canvas };
  if (mode === 'day') return resolve(day, true, 0, 0, settings);
  if (mode === 'evening') return resolve(evening, true, 1, 0.45, settings);
  if (mode === 'night') return resolve(night, false, 1, 0.22, settings);
  const { elevation, azimuth, hour } = sunAt(settings, timeS, origin);
  // Day above 20°, golden light to evening at the horizon, night below -12° (past nautical
  // twilight).
  const [from, to, t] =
    elevation >= 0
      ? [evening, day, clamp01(elevation / 20)]
      : [evening, night, clamp01(-elevation / 12)];
  const up = elevation > 0;
  const sunIntensity = up
    ? mix(evening.sunIntensity, day.sunIntensity, t) * clamp01(elevation / 3)
    : night.sunIntensity * t;
  const artificial = clamp01((4 - elevation) / 4);
  return resolve(
    {
      sun: up ? toward(elevation, azimuth) : night.sun,
      sunColor: up ? mixHex(evening.sunColor, day.sunColor, t) : night.sunColor,
      sunIntensity,
      sky: mixHex(from.sky, to.sky, t),
      ground: mixHex(from.ground, to.ground, t),
      skyIntensity: mix(from.skyIntensity, to.skyIntensity, t),
      background: mixHex(from.background, to.background, t),
    },
    up,
    artificial,
    artificial * windowShare(hour),
    settings,
  );
}

/** A stable key: equal keys draw the same light. */
export const lightKey = (light: SceneLight) =>
  [
    ...light.sun.map((v) => v.toFixed(3)),
    light.sunColor,
    light.sunIntensity.toFixed(3),
    light.shadows,
    light.sky,
    light.ground,
    light.skyIntensity.toFixed(3),
    light.background,
    ...light.ambient.map((v) => v.toFixed(3)),
    ...[
      light.artificial,
      light.windows,
      light.lamps,
      light.windowGlow,
      light.vehicleLights,
      light.airfieldLights,
      light.railLights,
    ].map((v) => v.toFixed(3)),
  ].join(',');

/** Warm street lamps, cool platform lights, as sRGB hex. */
export const lampColors = { street: 0xffc47e, platform: 0xe4ecff, window: 0xffcf8f } as const;

/** 32-bit integer mix (lowbias32). `windowLitGlsl` runs the same arithmetic on the GPU. */
export function mix32(x: number) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** A building's window seed: 24 bits, so it survives a float32 vertex attribute exactly. Context
 * buildings carry no id, so the outer ring stands in for one (as in the wall tint's hash). */
export function buildingSeed(ring: readonly { x: number; y: number }[]) {
  return buildingRingHash(ring) >>> 8;
}
/** FNV-1a over the outer ring at 10 cm; the wall tint in 3D uses the same hash. */
export function buildingRingHash(ring: readonly { x: number; y: number }[]) {
  let hash = 2166136261;
  for (const p of ring)
    for (const n of [p.x, p.y]) hash = Math.imul(hash ^ Math.round(n * 10), 16777619);
  return hash >>> 0;
}

/** Whether the window at `level` (0 at the bottom) and `column` (along the facade) of the
 * building with `seed` is lit when `share` of all windows are. */
export function windowLit(seed: number, level: number, column: number, share: number) {
  const cell = mix32((Math.imul(level, 0x9e3779b1) + column) >>> 0);
  return (mix32((seed ^ cell) >>> 0) & 0xffff) / 65536 < share;
}

export const windowLitGlsl = `
uint cfMix32(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
uint cfWindowHash(uint seed, uint level, uint column) {
  return cfMix32(seed ^ cfMix32(level * 0x9e3779b1u + column));
}`;

/** Where platform lighting falls: along railway platforms about every 12 m, and at each tram
 * shelter. `island` points sit on a raised tram island. */
export function platformLights(
  city: CompiledCity,
  tramStops: readonly TramStopPlacement[],
): { x: number; y: number; layer: number; radiusM: number; island: boolean }[] {
  const lights: ReturnType<typeof platformLights> = [];
  for (const platform of city.rail?.platforms ?? []) {
    if (platform.mode !== 'rail') continue;
    const ring = platformRing(platform.shape);
    const line = ring && spine(ring);
    if (!line) continue;
    for (let i = 2; i < line.line.length; i += 6) {
      const p = line.line[i]!;
      lights.push({
        x: p.x,
        y: p.y,
        layer: platform.layer,
        radiusM: Math.max(4.5, line.half[i]! * 1.8),
        island: false,
      });
    }
  }
  for (const stop of tramStops)
    for (const box of stop.shelters)
      lights.push({ x: box.x, y: box.y, layer: stop.layer, radiusM: 5, island: true });
  return lights;
}
