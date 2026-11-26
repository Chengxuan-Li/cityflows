import type { CompiledCity } from '../network';
import type { Vec2 } from '../geo/vec2';
import { boundsOf, type Bounds, type Camera } from './camera';
import {
  dynamicDebugGeometry,
  staticDebugGeometry,
  heightDebugGeometry,
  heightDebugColor,
  pickDebugGeometry,
  type DebugPrimitive,
} from './debug-geometry';
import { overlayKeys, type DebugOverlay, type DebugSettings } from './debug-settings';
import type { CityGeometry, Pick, VehicleSnapshot } from './types';

type Layer = { items: DebugPrimitive[]; bounds: Bounds[] };
const layer = (items: DebugPrimitive[]): Layer => ({
  items,
  bounds: items.map((p) => boundsOf(p.points)),
});
const css = (rgb: number) => '#' + rgb.toString(16).padStart(6, '0');
const dynamics: DebugOverlay[] = ['vehicles', 'signals', 'aircraft', 'gridlock'];

function terrainRaster(grid: NonNullable<CityGeometry['terrain']>) {
  const raster = document.createElement('canvas');
  raster.width = grid.cols;
  raster.height = grid.rows;
  const context = raster.getContext('2d')!;
  const image = context.createImageData(grid.cols, grid.rows);
  const heights = new DataView(Uint8Array.from(atob(grid.heights), (c) => c.charCodeAt(0)).buffer);
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    const rgb = heightDebugColor(heights.getInt16(2 * i, true) / 10);
    image.data.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], 4 * i);
  }
  context.putImageData(image, 0, 0);
  return raster;
}

/** Static geometry survives pans and snapshots; strokes and labels stay in CSS pixels. */
export class DebugMap {
  private surface = document.createElement('canvas');
  private ctx = this.surface.getContext('2d')!;
  private layers = new Map<DebugOverlay | 'heights', Layer>();
  private terrain?: HTMLCanvasElement;
  private city?: CompiledCity;
  private source?: CityGeometry;
  private snapshot: VehicleSnapshot | null = null;
  private selection: Pick | null = null;
  private slope?: number;
  private dirty = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private settings: DebugSettings,
  ) {
    this.surface.className = 'debug-map-overlay';
    this.surface.setAttribute('aria-hidden', 'true');
    this.canvas.after(this.surface);
  }
  configure(settings: DebugSettings) {
    this.settings = settings;
    this.canvas.dataset.debugRendered = String(settings.rendered);
    this.canvas.dataset.debugShading = settings.shading;
    this.canvas.dataset.debugOverlays = overlayKeys.filter((k) => settings.overlays[k]).join(',');
    for (const key of this.layers.keys()) {
      if (key === 'heights' ? !this.showHeights : !settings.overlays[key]) this.layers.delete(key);
    }
    if (!this.showHeights) this.terrain = undefined;
    this.dirty = true;
  }
  get showHeights() {
    return this.settings.rendered && this.settings.shading === 'heights';
  }
  setCity(city: CompiledCity, source?: CityGeometry) {
    this.city = city;
    this.source = source;
    this.layers.clear();
    this.terrain = undefined;
    this.updateSnapshot(null);
    this.dirty = true;
  }
  updateSnapshot(snapshot: VehicleSnapshot | null) {
    this.snapshot = snapshot;
    if (snapshot?.airfield?.glideSlopeDeg !== this.slope) {
      this.slope = snapshot?.airfield?.glideSlopeDeg;
      this.layers.delete('airsideGraph');
    }
    for (const key of dynamics) {
      if (this.settings.overlays[key]) {
        this.layers.delete(key);
        this.dirty = true;
      }
    }
  }
  select(selection: Pick | null) {
    this.selection = selection;
    for (const key of ['signals', 'vehicles'] as const)
      if (this.settings.overlays[key]) {
        this.layers.delete(key);
        this.dirty = true;
      }
  }
  invalidate() {
    this.dirty = true;
  }
  hit(point: Vec2, tolerance: number) {
    for (const [key, data] of [...this.layers].reverse()) {
      if (key === 'heights') continue;
      const hit = pickDebugGeometry(data.items, point, tolerance);
      if (hit?.id) return { id: hit.id, pick: hit.pick };
    }
    return null;
  }
  draw(camera: Camera) {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const dpr = devicePixelRatio;
    if (this.surface.width !== Math.round(w * dpr) || this.surface.height !== Math.round(h * dpr)) {
      this.surface.width = Math.round(w * dpr);
      this.surface.height = Math.round(h * dpr);
      this.dirty = true;
    }
    if (!this.dirty || !this.city) return;
    this.dirty = false;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const visible: Layer[] = [];
    if (this.showHeights) {
      const grid = this.source?.terrain;
      if (grid) {
        this.terrain ??= terrainRaster(grid);
        const p = camera.worldToScreen({
          x: grid.originM.x - grid.cellM / 2,
          y: grid.originM.y - grid.cellM / 2,
        });
        ctx.drawImage(
          this.terrain,
          p.x,
          p.y,
          grid.cols * grid.cellM * camera.zoom,
          grid.rows * grid.cellM * camera.zoom,
        );
      }
      if (!this.layers.has('heights'))
        this.layers.set('heights', layer(heightDebugGeometry(this.city, this.source)));
      visible.push(this.layers.get('heights')!);
    }
    for (const key of overlayKeys) {
      if (!this.settings.overlays[key] || key === 'stats') continue;
      if (!this.layers.has(key)) {
        const items = dynamics.includes(key)
          ? dynamicDebugGeometry(key, this.city, this.snapshot, this.selection)
          : staticDebugGeometry(key, this.city, this.source, this.slope);
        this.layers.set(key, layer(items.filter((p) => !p.only3d)));
      }
      visible.push(this.layers.get(key)!);
    }
    const top = camera.screenToWorld({ x: -8, y: -8 }),
      bottom = camera.screenToWorld({ x: w + 8, y: h + 8 });
    const occupied = new Set<string>();
    const origin = camera.worldToScreen({ x: 0, y: 0 });
    const zoom = camera.zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = 'bold 11px Arimo, sans-serif';
    for (const { items, bounds } of visible) {
      const lines = new Map<number, Path2D>();
      const dots = new Map<number, Path2D>();
      const labels: DebugPrimitive[] = [];
      for (let i = 0; i < items.length; i++) {
        const b = bounds[i]!;
        if (b.maxX < top.x || b.maxY < top.y || b.minX > bottom.x || b.minY > bottom.y) continue;
        const item = items[i]!;
        const p = item.points[0]!;
        const x = origin.x + zoom * p.x,
          y = origin.y + zoom * p.y;
        if (item.kind === 'label') {
          labels.push(item);
          continue;
        }
        const batch = item.kind === 'point' ? dots : lines;
        const path = (!item.fill && batch.get(item.color)) || new Path2D();
        if (item.kind === 'point') {
          const radius = Math.min(3.6, Math.max(1.35, 2.5 * zoom));
          path.moveTo(x + radius, y);
          path.arc(x, y, radius, 0, Math.PI * 2);
        } else {
          path.moveTo(x, y);
          for (let j = 1; j < item.points.length; j++) {
            const q = item.points[j]!;
            path.lineTo(origin.x + zoom * q.x, origin.y + zoom * q.y);
          }
        }
        if (item.fill) {
          ctx.fillStyle = css(item.color);
          ctx.fill(path);
        } else batch.set(item.color, path);
      }
      for (const [color, path] of lines) {
        ctx.strokeStyle = 'rgba(20,25,33,.8)';
        ctx.lineWidth = zoom < 0.4 ? 1.7 : 3.2;
        ctx.stroke(path);
        ctx.strokeStyle = css(color);
        ctx.lineWidth = zoom < 0.4 ? 1 : 1.65;
        ctx.stroke(path);
      }
      for (const [color, path] of dots) {
        ctx.fillStyle = css(color);
        ctx.fill(path);
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = '#18202c';
        ctx.stroke(path);
      }
      for (const item of labels) {
        const { x, y } = camera.worldToScreen(item.points[0]!);
        const cell = Math.floor(x / 65) + ',' + Math.floor(y / 16);
        if (!item.text || occupied.has(cell)) continue;
        occupied.add(cell);
        ctx.strokeStyle = '#18202c';
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 3;
        item.text.split('\n').forEach((line, i) => {
          ctx.strokeText(line, x + 4, y - 3 + i * 13);
          ctx.fillText(line, x + 4, y - 3 + i * 13);
        });
      }
    }
  }
  destroy() {
    this.surface.remove();
    delete this.canvas.dataset.debugRendered;
    delete this.canvas.dataset.debugShading;
    delete this.canvas.dataset.debugOverlays;
  }
}
