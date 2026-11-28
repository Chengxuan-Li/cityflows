import { create } from 'zustand';
import {
  debugFromUrl,
  defaultDebug,
  parseDebug,
  type DebugOverlay,
  type DebugSettings,
} from '../render/debug-settings';
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

/** TASK-384: the debug views' choices, a per-viewer preference like the visual settings. */
export const debugKey = 'cityflows.debug';

export function loadDebug(storage: Storage | undefined): DebugSettings {
  try {
    const raw = storage?.getItem(debugKey);
    return raw ? parseDebug(JSON.parse(raw)) : defaultDebug;
  } catch {
    return defaultDebug;
  }
}

export const useDebug = create<{
  debug: DebugSettings;
  /** `?debug` in the address: developer tools are on for this visit, the switch aside. */
  fromUrl: boolean;
  setDebug: (next: Partial<DebugSettings>) => void;
  setOverlay: (key: DebugOverlay, on: boolean) => void;
}>((set, get) => ({
  debug: loadDebug(browserStorage()),
  fromUrl: typeof location !== 'undefined' && debugFromUrl(location.search),
  setDebug: (next) => {
    const debug = parseDebug({ ...get().debug, ...next });
    try {
      browserStorage()?.setItem(debugKey, JSON.stringify(debug));
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
    set({ debug });
  },
  setOverlay: (key, on) => get().setDebug({ overlays: { ...get().debug.overlays, [key]: on } }),
}));

/** Whether developer tools are on: the Visual quality switch, or `?debug`. */
export const developerTools = () =>
  useVisual.getState().visual.developerTools || useDebug.getState().fromUrl;
