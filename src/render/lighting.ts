import type { CompiledCity } from '../network';
import { platformRing, spine } from './station-furniture';
import { style } from './style';
import type { TramStopPlacement } from './tram-stops';

/** TASK-163: view-only scene lighting. Nothing here reaches the simulation or the project. */
export type LightingMode = 'day' | 'evening' | 'night' | 'clock';
export interface LightingSettings {
  mode: LightingMode;
  /** Multiplies the scene's light: sun, sky, unlit surfaces and the background. */
  exposure: number;
}
export const lightingModes: readonly LightingMode[] = ['day', 'evening', 'night', 'clock'];
export const exposureRange = { min: 0.5, max: 1.5, step: 0.05 } as const;
export const defaultLighting: LightingSettings = { mode: 'day', exposure: 1 };

/** Settings from storage or any other untrusted source; anything malformed falls back. */
export function parseLighting(value: unknown): LightingSettings {
  if (typeof value !== 'object' || value === null) return defaultLighting;
  const { mode, exposure } = value as Record<string, unknown>;
  return {
    mode: lightingModes.includes(mode as LightingMode) ? (mode as LightingMode) : 'day',
    exposure:
      typeof exposure === 'number' && Number.isFinite(exposure)
        ? Math.min(exposureRange.max, Math.max(exposureRange.min, exposure))
        : 1,
  };
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
}

const toward = (elevationDeg: number, azimuthDeg: number): Rgb => {
  const e = (elevationDeg * Math.PI) / 180,
    a = (azimuthDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};
const dayLength = Math.hypot(1, 1.5, 1);
/** TASK-162's light, unchanged: a white sun from the north-west and a strong white sky. */
const day: Preset = {
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
  day.sky,
  day.skyIntensity,
  day.sun,
  day.sunColor,
  day.sunIntensity,
);

/** A simple Munich-like day for "Follow simulation clock": sunrise 06:00, sunset 20:00, the sun
 * 52° high at 13:00, rising in the east-north-east and setting in the west-north-west. */
export function sunAt(timeS: number) {
  const hour = (((timeS / 3600) % 24) + 24) % 24;
  if (hour >= 6 && hour <= 20) {
    const t = (hour - 6) / 14;
    return { elevation: 52 * Math.sin(Math.PI * t), azimuth: 70 + 220 * t, hour };
  }
  const t = (hour >= 20 ? hour - 20 : hour + 4) / 10;
  return { elevation: -35 * Math.sin(Math.PI * t), azimuth: 290 + 140 * t, hour };
}

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
  preset: Omit<Preset, 'sun'> & { sun: Rgb },
  shadows: boolean,
  artificial: number,
  windows: number,
  exposure: number,
): SceneLight {
  const lit = irradiance(
    preset.sky,
    preset.skyIntensity,
    preset.sun,
    preset.sunColor,
    preset.sunIntensity,
  );
  return {
    sun: preset.sun,
    sunColor: preset.sunColor,
    sunIntensity: preset.sunIntensity * exposure,
    shadows,
    sky: preset.sky,
    ground: preset.ground,
    skyIntensity: preset.skyIntensity * exposure,
    background: scaleHex(preset.background, exposure),
    ambient: lit.map((v, i) => (v / dayIrradiance[i]!) * exposure) as unknown as Rgb,
    artificial,
    windows,
  };
}

/** The light for `settings` at simulation time `timeS` (seconds since midnight). */
export function sceneLight(settings: LightingSettings, timeS: number): SceneLight {
  const { mode, exposure } = settings;
  if (mode === 'day') return resolve(day, true, 0, 0, exposure);
  if (mode === 'evening') return resolve(evening, true, 1, 0.45, exposure);
  if (mode === 'night') return resolve(night, false, 1, 0.22, exposure);
  const { elevation, azimuth, hour } = sunAt(timeS);
  // Day above 10°, evening at the horizon, night below -12° (past nautical twilight).
  const [from, to, t] =
    elevation >= 0
      ? [evening, day, clamp01(elevation / 10)]
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
    exposure,
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
    light.artificial.toFixed(3),
    light.windows.toFixed(3),
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
