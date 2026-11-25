import { create } from 'zustand';
import { defaultVisual, parseVisual, type VisualSettings } from '../render/lighting';

/** TASK-163, TASK-341: the scene lighting and render quality are a per-viewer view preference,
 * kept apart from the project. Lighting stored before TASK-341 under its own key migrates. */
export const visualKey = 'cityflows.visual';
export const lightingKey = 'cityflows.lighting';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

// Storage can be missing or throw (private windows, blocked site data): the settings then start
// at their defaults and last for this visit only.
export function loadVisual(storage: Storage | undefined): VisualSettings {
  try {
    const raw = storage?.getItem(visualKey) ?? storage?.getItem(lightingKey);
    return raw ? parseVisual(JSON.parse(raw)) : defaultVisual;
  } catch {
    return defaultVisual;
  }
}

export function saveVisual(storage: Storage | undefined, settings: VisualSettings) {
  try {
    storage?.setItem(visualKey, JSON.stringify(settings));
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

export const useVisual = create<{
  visual: VisualSettings;
  /** An offline (category 4) value was confirmed in this session; not stored. */
  offlineConfirmed: boolean;
  setVisual: (next: Partial<VisualSettings>) => void;
}>((set, get) => ({
  visual: loadVisual(browserStorage()),
  offlineConfirmed: false,
  setVisual: (next) => {
    const visual = parseVisual({ ...get().visual, ...next });
    saveVisual(browserStorage(), visual);
    set({ visual });
  },
}));
