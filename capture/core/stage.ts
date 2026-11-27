import { version as appVersion } from '../../package.json';
import { defaultVisual, parseVisual, type VisualSettings } from '../../src/render/lighting';
import type { LayerVisibility } from '../../src/render/types';
import { useAppearance } from '../../src/ui/appearance-store';
import { useVisual } from '../../src/ui/lighting-store';
import { exposureSplit, installLayers, type InstalledLayers, type Site } from '../layers';
import {
  frameOf,
  sunAt,
  titleAlpha,
  titleBaseline,
  view,
  windowTop,
  type FormatName,
  type Frame,
  type Shot,
} from './shot';
import { drawTitle, prepareTitle, type SubtitleImage } from './title';

// Capture: the shot on the running app, in the page. The render CLI (capture/core/render.ts)
// loads this module into the app through the dev server; the Capture panel uses it directly.
// It sets the app up as the shot asks (3D, map layers, light), installs the scene layers and the
// location's site, poses the camera and the sun for a video time, and grabs frames with the title.

const sites = import.meta.glob<{ site: Site }>('../locations/*/site.ts');

function debug() {
  const api = window.cityflows;
  if (!api?.appStore || !api.scene3D || !api.setView3D || !api.capture3D || !api.city)
    throw new Error('The capture needs the app built in dev or test mode');
  return api as typeof api & Required<Pick<typeof api, 'appStore' | 'scene3D' | 'city'>>;
}

export interface Stage {
  readonly shot: Shot;
  readonly frame: Frame;
  /** Changes the shot: the light and map at once, the layers and title when they changed. */
  setShot(shot: Shot, format?: FormatName): Promise<void>;
  /** Poses the camera, the sun and the layers' clocks for video time `t`. */
  show(t: number): void;
  /** One video frame at the current pose: the window of the canvas, scaled, with the title. */
  grab(t: number, type?: 'image/png' | 'image/jpeg'): Promise<string>;
  /** The title at video time `t` on a canvas the size of the frame (`top` rows of canvas above). */
  drawTitle(g: CanvasRenderingContext2D, t: number, top?: number): void;
  setLayersEnabled(on: boolean): void;
  dispose(): void;
}

/** Loads a file the dev server serves (the Capture endpoints in capture/core/dev-server.ts). */
export async function fetchFile(path: string) {
  const response = await fetch(`/__capture/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  return response.arrayBuffer();
}

export async function createStage(shot: Shot, format: FormatName): Promise<Stage> {
  const api = debug();
  const store = api.appStore;
  const previousVisual = useVisual.getState().visual;
  const previousAppearance = useAppearance.getState().settings;
  const previousLayers = store.getState().layers;
  let previousFov = 45;
  let current = shot;
  let frame = frameOf(shot, format);
  let layers: InstalledLayers | undefined;
  let layersKey = '';
  // The scene's built geometry the layers patched: a rebuild (terrain, palette) drops them.
  let builtOn: unknown;
  const built = () => (api.scene3D() as { geometry?: unknown } | null)?.geometry;
  let layersOn = true;
  let subtitle: SubtitleImage | undefined;
  let titleKey = '';

  const site = async () => {
    const load = sites[`../locations/${current.location}/site.ts`];
    return load ? (await load()).site : undefined;
  };
  const applyApp = () => {
    const state = store.getState();
    // The map's colours follow the appearance: the render draws the light map.
    useAppearance.getState().setAppearance({ appearance: 'light', matchLighting: false });
    if (state.viewMode !== '3d') state.toggleView();
    if (!state.buildings) state.toggleBuildings();
    store.setState({
      layers: { ...store.getState().layers, ...(current.map as Partial<LayerVisibility>) },
    });
    // The shot's light over the defaults, so the panel shows what the render draws.
    const visual: VisualSettings = parseVisual({
      ...defaultVisual,
      mode: 'clock',
      exposure: exposureSplit(current).app,
      ...(current.light.date ? { date: current.light.date } : {}),
      ...current.light.visual,
    });
    useVisual.getState().setVisual(visual);
  };
  let installing: Promise<void> = Promise.resolve();
  const applyLayers = () => (installing = installing.then(installNow));
  const installNow = async () => {
    const key = JSON.stringify([current.location, current.layers, current.focus, layersOn]);
    if (key !== layersKey || built() !== builtOn) {
      await settle();
      layers?.dispose();
      layers = undefined;
      layersKey = key;
      builtOn = built();
      if (layersOn) layers = installLayers(api.scene3D(), api.city(), current, await site());
    }
    layers?.setGain(exposureSplit(current).gain);
  };
  const applyTitle = async () => {
    const title = current.title;
    const key = JSON.stringify(title);
    if (key === titleKey) return;
    titleKey = key;
    subtitle = title
      ? await prepareTitle(
          title,
          title.subtitleFont ? await fetchFile(title.subtitleFont) : undefined,
        )
      : undefined;
  };

  /** Waits until the 3D scene has built and kept its geometry for a few frames. */
  async function settle() {
    // Timers, not animation frames: a hidden page stops the frames but not the scene's build.
    for (let i = 0, still = 0, last: unknown; still < 8; i++) {
      if (i > 3600) throw new Error('The 3D scene did not settle');
      await new Promise((r) => setTimeout(r, 30));
      const now = built();
      still = now && now === last && !store.getState().busy ? still + 1 : 0;
      last = now;
    }
  }

  applyApp();
  await settle();
  previousFov = (api.scene3D() as { camera: { fov: number } }).camera.fov;
  await applyLayers();
  await applyTitle();

  const lockup = () =>
    current.title && {
      ...current.title,
      version: current.title.version === 'auto' ? `v${appVersion}` : current.title.version,
    };
  const stage: Stage = {
    get shot() {
      return current;
    },
    get frame() {
      return frame;
    },
    async setShot(next, nextFormat) {
      current = next;
      frame = frameOf(next, nextFormat ?? format);
      format = nextFormat ?? format;
      applyApp();
      await applyLayers();
      await applyTitle();
    },
    show(t) {
      if (layersOn && built() !== builtOn && builtOn) {
        builtOn = undefined;
        void applyLayers();
      }
      const v = view(frame.keys, t);
      layers?.setTime(t);
      api.setSunTime3D?.(sunAt(current, t));
      api.setView3D!(v.centre, v.zoom, v.pitch, v.bearing, frame.fov);
    },
    async grab(t, type = 'image/png') {
      const [shotImage] = await api.capture3D!();
      const image = new Image();
      image.src = shotImage!;
      await image.decode();
      const { width: W, height: H } = frame;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const scale = image.width / W;
      const top = Math.round(windowTop(frame, t));
      g.imageSmoothingQuality = 'high';
      g.drawImage(image, 0, top * scale, image.width, H * scale, 0, 0, W, H);
      stage.drawTitle(g, t);
      return c.toDataURL(type, 0.95);
    },
    drawTitle(g, t, top = 0) {
      const title = lockup();
      if (!title) return;
      const alpha = titleAlpha(title, t);
      if (alpha <= 0) return;
      const pitch = view(frame.keys, t).pitch;
      drawTitle(
        g,
        title,
        frame.titleX,
        top + titleBaseline(title, frame, t, pitch),
        alpha,
        subtitle,
      );
    },
    setLayersEnabled(on) {
      layersOn = on;
      void applyLayers();
    },
    dispose() {
      layers?.dispose();
      layers = undefined;
      api.setSunTime3D?.(null);
      useVisual.getState().setVisual(previousVisual);
      useAppearance.getState().setAppearance(previousAppearance);
      store.setState({ layers: previousLayers });
      const v = api.view3D?.();
      if (v) api.setView3D!(v.centre, v.zoom, v.pitch, v.bearing, previousFov);
    },
  };
  return stage;
}
