import type { Scene3D } from '../render3d/scene';
import { activeDebug } from '../render/debug-settings';
import { flatHeights, inks, type DebugPalette } from '../render/debug-geometry';
import {
  DebugOverlays,
  debugDataset,
  debugRequest,
  type DebugViewSnapshot,
} from '../render/debug-view';
import type { createScene } from '../render/scene';
import type { Pick } from '../render/types';
import { developerTools, useDebug } from './lighting-store';
import type { Session } from './store';

type Scene2D = ReturnType<typeof createScene>;

let palette: { appearance: string; palette: DebugPalette } | undefined;
/** The `--debug-*` tokens of the current appearance, as map colours. */
function debugPalette(): DebugPalette {
  const appearance = document.documentElement.dataset.appearance ?? 'light';
  if (palette?.appearance === appearance) return palette.palette;
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => parseInt(css.getPropertyValue(name).trim().slice(1), 16);
  const value: DebugPalette = {
    ink: Object.fromEntries(
      inks.map((ink) => [ink, token(`--debug-${ink}`)]),
    ) as DebugPalette['ink'],
    halo: token('--debug-halo'),
    ramp: [0, 1, 2, 3, 4].map((i) => token(`--debug-ramp-${i}`)),
  };
  palette = { appearance, palette: value };
  return value;
}

/**
 * TASK-376: the debug views in the map's frame loop: the active view's settings, the overlay
 * canvas, the stats readout, the hover tooltip and the data attributes. Nothing is created and
 * no scene changes until developer tools are turned on.
 */
export function createDebugFrame(canvas2D: HTMLCanvasElement, canvas3D: HTMLCanvasElement) {
  let overlays: DebugOverlays | undefined;
  let tooltip: HTMLElement | undefined;
  let pointer: { x: number; y: number } | null = null;
  let hovered = '';
  let reported = false;
  let frameMs = 0;
  let fps = 0;
  let lastFrame = 0;
  let readoutAt = 0;
  let readout: string[] | null = null;

  let surface = canvas2D;
  const clearDataset = (canvas: HTMLCanvasElement) => {
    for (const key of Object.keys(canvas.dataset))
      if (key.startsWith('debug')) delete canvas.dataset[key];
  };
  /** The active canvas carries the debug state as data attributes; the other none. */
  const report = (values: Record<string, string>) => {
    clearDataset(surface === canvas2D ? canvas3D : canvas2D);
    Object.assign(surface.dataset, values);
  };
  const move = (event: PointerEvent) => {
    const box = canvas2D.getBoundingClientRect();
    pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const leave = () => (pointer = null);
  for (const surface of [canvas2D, canvas3D]) {
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerleave', leave);
  }

  function hideTooltip() {
    hovered = '';
    if (tooltip) tooltip.hidden = true;
  }

  return {
    /** The settings in force for the view: null with developer tools off. */
    settings(view3D: boolean) {
      return activeDebug(useDebug.getState().debug, developerTools(), view3D);
    },
    request(view3D: boolean) {
      return debugRequest(this.settings(view3D));
    },
    /** Before the scene draws: what it should draw. */
    prepare(view: Scene2D, three: Scene3D | undefined, view3D: boolean) {
      const settings = this.settings(view3D);
      const colours = settings ? debugPalette() : null;
      view.setDebugScene(
        view3D || !settings || (settings.rendered && settings.shading !== 'heights'),
      );
      three?.setDebug(view3D ? settings : null, colours);
    },
    /** After the scene drew: the overlays, the readout and the tooltip. `startMs`: when the
     *  frame's work began, for the readout's frame time. */
    draw(
      view: Scene2D,
      three: Scene3D | undefined,
      view3D: boolean,
      session: Session,
      snapshot: DebugViewSnapshot | null,
      selection: Pick | null,
      startMs: number,
    ) {
      const settings = this.settings(view3D);
      const now = performance.now();
      if (!settings) {
        overlays?.clear();
        hideTooltip();
        if (reported) for (const canvas of [canvas2D, canvas3D]) clearDataset(canvas);
        reported = false;
        return;
      }
      reported = true;
      if (lastFrame) {
        frameMs = frameMs * 0.9 + (now - startMs) * 0.1;
        fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
      }
      lastFrame = now;
      surface = view3D ? canvas3D : canvas2D;
      overlays ??= new DebugOverlays(canvas3D, report);
      if (settings.overlays.stats && now - readoutAt > 250) {
        readoutAt = now;
        const stats = view3D && three ? three.debugStats() : view.debugStats();
        readout = [
          `Frame ${frameMs.toFixed(1)} ms · ${fps.toFixed(0)} fps`,
          `Draw calls ${stats.calls} · triangles ${Math.round(stats.triangles).toLocaleString('en')}`,
          'geometries' in stats
            ? `Geometries ${stats.geometries} · textures ${stats.textures}`
            : `Buffers ${stats.buffers} · textures ${stats.textures}`,
        ];
        surface.dataset.debugStats = JSON.stringify({ frameMs, fps, ...stats });
      } else if (!settings.overlays.stats) readout = null;
      const { compiled, loadedCompiled } = session;
      const heights = view3D && three ? three.debugHeights(compiled) : flatHeights;
      const projector = view3D && three ? three.debugProjector() : view.debugProjector();
      overlays.draw(
        {
          city: compiled,
          simCity: loadedCompiled,
          source: session.project.city,
          heights,
          // The run's indices are the loaded city's; the scene's heights follow the edited one.
          simHeights: compiled === loadedCompiled ? heights : flatHeights,
          view3D,
          settings,
          palette: debugPalette(),
          snapshot,
          selection,
          extra:
            view3D && three && settings.overlays.detailRanges ? three.debugRanges() : undefined,
          readout,
        },
        projector,
      );
      report(debugDataset(settings)!);
      const target = pointer && overlays.hit(pointer.x, pointer.y);
      if (!target) return hideTooltip();
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip debug-tip';
        tooltip.setAttribute('role', 'tooltip');
        canvas3D.after(tooltip);
      }
      if (hovered !== target.label) tooltip.textContent = hovered = target.label;
      tooltip.hidden = false;
      tooltip.style.translate = `${pointer!.x + 12}px ${pointer!.y + 14}px`;
    },
    destroy() {
      for (const surface of [canvas2D, canvas3D]) {
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerleave', leave);
      }
      overlays?.destroy();
      tooltip?.remove();
    },
  };
}
