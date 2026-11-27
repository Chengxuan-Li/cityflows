import type { CompiledCity } from '../network';
import type { DebugSnapshot } from '../sim/debug-snapshot';
import { DebugCanvas, type DebugProjector } from './debug-canvas';
import {
  glidePaths,
  heightsLayer,
  networkLayer,
  networkOverlays,
  profileHeights,
  simLayer,
  simOverlays,
  type DebugHeights,
  type DebugItem,
  type DebugLayer,
  type DebugPalette,
  type DebugTarget,
} from './debug-geometry';
import { overlayKeys, type DebugSettings } from './debug-settings';
import type { CityGeometry, Pick, VehicleSnapshot } from './types';

export type DebugViewSnapshot = VehicleSnapshot & { debug?: DebugSnapshot };

/** What the active view gives the overlays each frame. */
export interface DebugFrame {
  city: CompiledCity;
  source: CityGeometry;
  /** Surface heights: flat in 2D, the 3D scene's own in 3D (a new object when it rebuilds). */
  heights: DebugHeights;
  /** The loaded run's city (the snapshot's indices) and heights by its indices: an edit shows
   *  in `city` before a restart reloads the run. */
  simCity: CompiledCity;
  simHeights: DebugHeights;
  view3D: boolean;
  settings: DebugSettings;
  palette: DebugPalette;
  snapshot: DebugViewSnapshot | null;
  selection: Pick | null;
  /** Items the view adds itself (3D detail ranges), with a key that changes with them. */
  extra?: { items: DebugItem[]; key: string };
  /** The stats readout's rows, when it is on. */
  readout: string[] | null;
}

let nextId = 1;
const ids = new WeakMap<object, number>();
const idOf = (value: object | null | undefined) => {
  if (!value) return 0;
  let id = ids.get(value);
  if (id === undefined) ids.set(value, (id = nextId++));
  return id;
};

/**
 * TASK-373: the checked overlays of the active view, built from the city once and from each
 * snapshot as it arrives, and drawn on one canvas over both map canvases.
 */
export class DebugOverlays {
  private readonly canvas: DebugCanvas;
  private readonly built = new Map<string, { layer: DebugLayer; key: string }>();
  private drawnLayers: string[] = [];

  constructor(
    beside: HTMLCanvasElement,
    private readonly report: (dataset: Record<string, string>) => void,
  ) {
    this.canvas = new DebugCanvas(beside);
  }

  /** A layer, rebuilt only when `key` (what it is built from) changes. */
  private layer(name: string, key: string, grounded: boolean, build: () => DebugItem[]) {
    const known = this.built.get(name);
    if (known?.key === key) return known.layer;
    const layer: DebugLayer = { items: build(), grounded };
    this.built.set(name, { layer, key });
    return layer;
  }

  draw(frame: DebugFrame, view: DebugProjector) {
    const { city, source, heights, settings, palette, snapshot, selection } = frame;
    const layers: DebugLayer[] = [];
    const names: string[] = [];
    const base = `${idOf(city)}:${idOf(heights)}`;
    if (settings.rendered && settings.shading === 'heights') {
      // In 2D the roads fill their width over the plain canvas; in 3D the scene is shaded by
      // height, and the lines and grades go over it.
      const fill = !frame.view3D;
      names.push('heights');
      layers.push(
        this.layer('heights', `${base}:${fill}:${palette.ramp.join()}`, true, () =>
          heightsLayer(city, fill ? profileHeights(city) : heights, palette.ramp, fill),
        ),
      );
    }
    for (const overlay of networkOverlays) {
      if (!settings.overlays[overlay]) continue;
      names.push(overlay);
      layers.push(
        this.layer(overlay, base, true, () => networkLayer(overlay, city, source, heights)),
      );
    }
    if (settings.overlays.airsideGraph && frame.view3D && snapshot?.airfield) {
      const { arrivalEnds, glideSlopeDeg } = snapshot.airfield;
      names.push('glidePath');
      layers.push(
        this.layer('glidePath', `${base}:${arrivalEnds.join()}:${glideSlopeDeg}`, false, () =>
          glidePaths(city, heights, arrivalEnds, glideSlopeDeg),
        ),
      );
    }
    const { extra } = frame;
    if (extra) {
      names.push('detailRanges');
      layers.push(this.layer('detailRanges', extra.key, false, () => extra.items));
    }
    for (const overlay of simOverlays) {
      if (!settings.overlays[overlay] || !snapshot) continue;
      names.push(overlay);
      const key = `${idOf(frame.simCity)}:${idOf(frame.simHeights)}:${idOf(snapshot)}:${JSON.stringify(selection)}`;
      layers.push(
        this.layer(overlay, key, overlay !== 'aircraft', () =>
          simLayer(overlay, frame.simCity, snapshot, selection, frame.simHeights),
        ),
      );
    }
    for (const name of this.built.keys()) if (!names.includes(name)) this.built.delete(name);
    const key = names.map((name) => `${name}:${this.built.get(name)!.key}`).join('|');
    if (this.canvas.draw(layers, view, palette, `${key}|${idOf(palette)}`, frame.readout)) {
      this.drawnLayers = names;
      this.report({
        debugLayers: names.join(','),
        debugItems: JSON.stringify(
          Object.fromEntries(names.map((n, i) => [n, this.canvas.counts[i]])),
        ),
      });
    }
  }

  /** The hovered target, for the tooltip. */
  hit(x: number, y: number): DebugTarget | null {
    return this.drawnLayers.length ? this.canvas.hit(x, y) : null;
  }

  clear() {
    this.canvas.clear();
    this.built.clear();
    this.drawnLayers = [];
  }

  destroy() {
    this.canvas.destroy();
  }
}

/** The data attributes a view reports its debug state with (e2e tests read them). */
export function debugDataset(settings: DebugSettings | null) {
  if (!settings) return null;
  return {
    debugRendered: String(settings.rendered),
    debugShading: settings.shading,
    debugOverlays: overlayKeys.filter((key) => settings.overlays[key]).join(','),
  };
}

/** The sim state a snapshot request asks for, from the checked overlays. */
export function debugRequest(settings: DebugSettings | null) {
  if (!settings) return undefined;
  const { vehicles, aircraft, gridlock } = settings.overlays;
  return vehicles || aircraft || gridlock ? { vehicles, aircraft, gridlock } : undefined;
}
