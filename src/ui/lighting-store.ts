import { create } from 'zustand';
import { defaultLighting, parseLighting, type LightingSettings } from '../render/lighting';

/** TASK-163: the scene lighting is a per-viewer view preference, kept apart from the project. */
export const lightingKey = 'cityflows.lighting';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

// Storage can be missing or throw (private windows, blocked site data): the lighting then starts
// at Day and lasts for this visit only.
export function loadLighting(storage: Storage | undefined): LightingSettings {
  try {
    const raw = storage?.getItem(lightingKey);
    return raw ? parseLighting(JSON.parse(raw)) : defaultLighting;
  } catch {
    return defaultLighting;
  }
}

export function saveLighting(storage: Storage | undefined, settings: LightingSettings) {
  try {
    storage?.setItem(lightingKey, JSON.stringify(settings));
  } catch {
    return;
  }
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const useLighting = create<{
  lighting: LightingSettings;
  setLighting: (next: Partial<LightingSettings>) => void;
}>((set, get) => ({
  lighting: loadLighting(browserStorage()),
  setLighting: (next) => {
    const lighting = parseLighting({ ...get().lighting, ...next });
    saveLighting(browserStorage(), lighting);
    set({ lighting });
  },
}));
