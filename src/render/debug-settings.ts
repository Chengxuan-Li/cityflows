export const overlayLabels = {
  roadGraph: 'Road graph',
  lanes: 'Lanes and movements',
  railGraph: 'Rail graph',
  airsideGraph: 'Airside graph',
  walkNetwork: 'Walk network',
  places: 'Places and access',
  wireframe: 'Wireframe',
  detailRanges: 'Detail ranges',
  vehicles: 'Vehicles',
  signals: 'Signals',
  aircraft: 'Aircraft',
  gridlock: 'Gridlock',
  stats: 'Stats readout',
} as const;

export const shadingLabels = {
  normal: 'Normal',
  unlit: 'Unlit colour',
  light: 'Light only',
  heights: 'Heights and grades',
  normals: 'Face direction',
  overdraw: 'Overdraw',
} as const;

export type DebugOverlay = keyof typeof overlayLabels;
export type DebugShading = keyof typeof shadingLabels;
export interface DebugSettings {
  rendered: boolean;
  shading: DebugShading;
  overlays: Record<DebugOverlay, boolean>;
}
export const overlayKeys = Object.keys(overlayLabels) as DebugOverlay[];
export const defaultDebug: DebugSettings = {
  rendered: true,
  shading: 'normal',
  overlays: Object.fromEntries(overlayKeys.map((key) => [key, false])) as Record<
    DebugOverlay,
    boolean
  >,
};

export function parseDebug(value: unknown): DebugSettings {
  if (!value || typeof value !== 'object') return defaultDebug;
  const { rendered, shading, overlays } = value as Partial<DebugSettings>;
  return {
    rendered: rendered !== false,
    shading:
      typeof shading === 'string' && Object.hasOwn(shadingLabels, shading) ? shading : 'normal',
    overlays: Object.fromEntries(
      overlayKeys.map((key) => [key, overlays?.[key] === true]),
    ) as Record<DebugOverlay, boolean>,
  };
}

export function debugIn2D(settings: DebugSettings): DebugSettings {
  return {
    ...settings,
    shading: settings.shading === 'heights' ? 'heights' : 'normal',
    overlays: { ...settings.overlays, wireframe: false, detailRanges: false },
  };
}
