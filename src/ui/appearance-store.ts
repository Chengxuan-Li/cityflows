import { create } from 'zustand';
import { sceneLight, type LightingSettings } from '../render/lighting';

/** TASK-166: the window's appearance, a per-viewer view preference kept apart from the project. */
export type AppearanceMode = 'system' | 'light' | 'dark';
export interface AppearanceSettings {
  appearance: AppearanceMode;
  /** Switch to dark while the scene lighting is Evening or Night, or the clock is past dusk. */
  matchLighting: boolean;
}
export const appearanceKey = 'cityflows.appearance';
export const defaultAppearance: AppearanceSettings = { appearance: 'system', matchLighting: false };
const modes: readonly AppearanceMode[] = ['system', 'light', 'dark'];
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export function parseAppearance(value: unknown): AppearanceSettings {
  if (typeof value !== 'object' || value === null) return defaultAppearance;
  const { appearance, matchLighting } = value as Record<string, unknown>;
  return {
    appearance: modes.includes(appearance as AppearanceMode)
      ? (appearance as AppearanceMode)
      : 'system',
    matchLighting: matchLighting === true,
  };
}

// Storage can be missing or throw (private windows, blocked site data): the appearance then
// follows the system and lasts for this visit only.
export function loadAppearance(storage: Storage | undefined): AppearanceSettings {
  try {
    const raw = storage?.getItem(appearanceKey);
    return raw ? parseAppearance(JSON.parse(raw)) : defaultAppearance;
  } catch {
    return defaultAppearance;
  }
}

export function saveAppearance(storage: Storage | undefined, settings: AppearanceSettings) {
  try {
    storage?.setItem(appearanceKey, JSON.stringify(settings));
  } catch {
    return;
  }
}

/** Night lighting: the street lamps are on (Evening, Night, or the clock from about the sun's
 * setting, 2° above the horizon, to its rising). Before a run starts the clock reads as day. */
export function nightLighting(lighting: LightingSettings, timeS: number | undefined) {
  if (lighting.mode === 'clock' && timeS === undefined) return false;
  return sceneLight(lighting, timeS ?? 0).artificial >= 0.5;
}

/** Which appearance the window shows, and whether the map takes its dark variant. The map follows
 * the chosen appearance only: Match lighting darkens the chrome, while the Evening and Night scenes
 * already darken the map by their light. So a lighting change never rebuilds the map. */
export function resolveAppearance(
  settings: AppearanceSettings,
  systemDark: boolean,
  lighting: LightingSettings,
  timeS: number | undefined,
) {
  const chosen = settings.appearance === 'dark' || (settings.appearance === 'system' && systemDark);
  return {
    dark: chosen || (settings.matchLighting && nightLighting(lighting, timeS)),
    darkMap: chosen,
  };
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const scheme =
  typeof window === 'undefined' ? undefined : window.matchMedia('(prefers-color-scheme: dark)');

export const useAppearance = create<{
  settings: AppearanceSettings;
  systemDark: boolean;
  setAppearance: (next: Partial<AppearanceSettings>) => void;
}>((set, get) => ({
  settings: loadAppearance(browserStorage()),
  systemDark: scheme?.matches ?? false,
  setAppearance: (next) => {
    const settings = parseAppearance({ ...get().settings, ...next });
    saveAppearance(browserStorage(), settings);
    set({ settings });
  },
}));
scheme?.addEventListener('change', (event) =>
  useAppearance.setState({ systemDark: event.matches }),
);
