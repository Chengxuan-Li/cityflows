/** TASK-380: the developer debug views, a per-viewer view preference (local storage). Nothing
 * here reaches the simulation, its hashes or the project. */
export const overlayGroups = [
  {
    heading: 'Networks',
    overlays: [
      ['roadGraph', 'Road graph'],
      ['lanes', 'Lanes and movements'],
      ['railGraph', 'Rail graph'],
      ['airsideGraph', 'Airside graph'],
      ['walkNetwork', 'Walk network'],
      ['places', 'Places and access'],
    ],
  },
  {
    heading: 'Geometry',
    overlays: [
      ['wireframe', 'Wireframe'],
      ['detailRanges', 'Detail ranges'],
    ],
  },
  {
    heading: 'Sim state',
    overlays: [
      ['vehicles', 'Vehicles'],
      ['signals', 'Signals'],
      ['aircraft', 'Aircraft'],
      ['gridlock', 'Gridlock'],
      ['stats', 'Stats readout'],
    ],
  },
] as const;

export type DebugOverlay = (typeof overlayGroups)[number]['overlays'][number][0];
export const overlayKeys: readonly DebugOverlay[] = overlayGroups.flatMap(({ overlays }) =>
  overlays.map(([key]) => key),
);

/** "Contact shadows only" joins once ambient occlusion exists (a later TASK-341 phase). */
export const shadings = [
  ['normal', 'Normal'],
  ['unlit', 'Unlit colour'],
  ['light', 'Light only'],
  ['heights', 'Heights and grades'],
  ['normals', 'Face direction'],
  ['overdraw', 'Overdraw'],
] as const;
export type DebugShading = (typeof shadings)[number][0];

/** Views that exist only in 3D; they are hidden in 2D. */
export const only3D: ReadonlySet<DebugOverlay | DebugShading> = new Set([
  'wireframe',
  'detailRanges',
  'unlit',
  'light',
  'normals',
  'overdraw',
]);

export interface DebugSettings {
  rendered: boolean;
  shading: DebugShading;
  overlays: Record<DebugOverlay, boolean>;
}

export const defaultDebug: DebugSettings = {
  rendered: true,
  shading: 'normal',
  overlays: Object.fromEntries(overlayKeys.map((key) => [key, false])) as Record<
    DebugOverlay,
    boolean
  >,
};

/** Settings from storage; each malformed field falls back on its own. */
export function parseDebug(value: unknown): DebugSettings {
  if (typeof value !== 'object' || value === null) return defaultDebug;
  const { rendered, shading, overlays } = value as Record<string, unknown>;
  const checked = (typeof overlays === 'object' && overlays) as Record<string, unknown> | false;
  return {
    rendered: typeof rendered === 'boolean' ? rendered : defaultDebug.rendered,
    shading: shadings.some(([key]) => key === shading)
      ? (shading as DebugShading)
      : defaultDebug.shading,
    overlays: Object.fromEntries(
      overlayKeys.map((key) => [key, checked ? checked[key] === true : false]),
    ) as Record<DebugOverlay, boolean>,
  };
}

/** What a view draws: 3D-only views drop out in 2D, and nothing is on without developer tools. */
export function activeDebug(settings: DebugSettings, enabled: boolean, view3D: boolean) {
  if (!enabled) return null;
  const overlays = { ...settings.overlays };
  if (!view3D) for (const key of overlayKeys) if (only3D.has(key)) overlays[key] = false;
  const plain = !settings.rendered || (!view3D && only3D.has(settings.shading));
  return {
    rendered: settings.rendered,
    shading: plain ? 'normal' : settings.shading,
    overlays,
  } satisfies DebugSettings;
}

/** `?debug` in the address turns developer tools on for the visit, as the switch does. */
export function debugFromUrl(search: string) {
  return new URLSearchParams(search).has('debug');
}
