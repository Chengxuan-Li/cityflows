import {
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type DirectionalLight,
  type WebGLRenderer,
} from 'three';
import type { CompiledCity } from '../network';
import {
  dynamicDebugGeometry,
  heightDebugGeometry,
  staticDebugGeometry,
} from '../render/debug-geometry';
import { overlayKeys, type DebugOverlay, type DebugSettings } from '../render/debug-settings';
import type { CityGeometry, Pick, VehicleSnapshot } from '../render/types';
import { DebugBatch } from './debug-batch';
import { DebugPasses } from './debug-passes';
import { DebugRanges } from './debug-ranges';
import type { Terrain } from './terrain';

const dynamic = new Set<DebugOverlay>(['vehicles', 'signals', 'aircraft', 'gridlock']);
type Key = DebugOverlay | 'heights';

export class DebugView3D {
  private readonly overlay = new Scene();
  private readonly passes = new DebugPasses();
  private readonly batches = new Map<Key, DebugBatch>();
  private ranges?: DebugRanges;
  private surface?: HTMLCanvasElement;
  private city?: CompiledCity;
  private terrain?: Terrain;
  private source?: CityGeometry;
  private snapshot: VehicleSnapshot | null = null;
  private selection: Pick | null = null;
  private readonly ray = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly projected = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    public settings: DebugSettings,
  ) {
    this.configure(settings);
  }

  configure(settings: DebugSettings) {
    this.settings = settings;
    const { dataset } = this.canvas;
    dataset.debugRendered = String(settings.rendered);
    dataset.debugShading = settings.shading;
    dataset.debugOverlays = overlayKeys.filter((k) => settings.overlays[k]).join(',');
    if (!settings.overlays.stats) delete dataset.debugStats;
    for (const key of this.batches.keys()) if (!this.enabled(key)) this.drop(key);
    if (this.ranges && !settings.overlays.detailRanges) {
      this.ranges.lines.removeFromParent();
      this.ranges.dispose();
      this.ranges = undefined;
    }
  }

  private enabled(key: Key) {
    return key === 'heights'
      ? this.settings.rendered && this.settings.shading === 'heights'
      : this.settings.overlays[key];
  }

  private drop(key: Key) {
    this.batches.get(key)?.dispose();
    this.batches.delete(key);
  }

  sync(
    city: CompiledCity,
    source: CityGeometry,
    terrain: Terrain,
    snapshot: VehicleSnapshot | null,
    selection: Pick | null,
  ) {
    if (city !== this.city || source !== this.source || terrain !== this.terrain) {
      for (const key of this.batches.keys()) this.drop(key);
      this.city = city;
      this.source = source;
      this.terrain = terrain;
    }
    if (snapshot !== this.snapshot) {
      if (snapshot?.airfield?.glideSlopeDeg !== this.snapshot?.airfield?.glideSlopeDeg)
        this.drop('airsideGraph');
      for (const key of dynamic) this.drop(key);
      this.snapshot = snapshot;
    }
    if (selection !== this.selection) {
      this.drop('signals');
      this.drop('vehicles');
      this.selection = selection;
    }
    this.passes.datum.value = terrain.grid?.baseM ?? 0;
    const build = (key: Key) => {
      if (!this.enabled(key) || this.batches.has(key)) return;
      const primitives =
        key === 'heights'
          ? heightDebugGeometry(city, terrain.grid ? source : { ...source, terrain: undefined })
          : dynamic.has(key)
            ? dynamicDebugGeometry(key, city, snapshot, selection)
            : staticDebugGeometry(key, city, source, snapshot?.airfield?.glideSlopeDeg);
      const batch = new DebugBatch(primitives, terrain);
      this.overlay.add(batch.group);
      this.batches.set(key, batch);
    };
    build('heights');
    for (const key of overlayKeys)
      if (key !== 'stats' && key !== 'wireframe' && key !== 'detailRanges') build(key);
  }

  hit(camera: PerspectiveCamera, x: number, y: number) {
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    this.pointer.set((x * 2) / width - 1, 1 - (y * 2) / height);
    this.ray.setFromCamera(this.pointer, camera);
    let best: { id: string; pick?: Pick; distance: number } | undefined;
    for (const [key, batch] of this.batches) {
      if (key === 'heights') continue;
      const hit = batch.hit(camera, this.ray, x, y, width, height, best?.distance ?? 7);
      if (hit) best = hit;
    }
    return best ?? null;
  }

  draw(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    sun: DirectionalLight,
    centre: Vector3,
    frameMs: number,
  ) {
    const { rendered, shading, overlays } = this.settings;
    const autoClear = renderer.autoClear,
      autoReset = renderer.info.autoReset;
    try {
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.autoClear = false;
      renderer.clear();
      if (rendered) {
        if (shading === 'normal') renderer.render(scene, camera);
        else this.passes.draw(renderer, scene, camera, shading);
      }
      if (overlays.wireframe) this.passes.draw(renderer, scene, camera, 'wireframe');
      if (overlays.detailRanges) {
        if (!this.ranges) {
          this.ranges = new DebugRanges();
          this.overlay.add(this.ranges.lines);
        }
        this.ranges.update(scene, camera, sun, centre, this.canvas.clientHeight);
      }
      if (this.overlay.children.length) renderer.render(this.overlay, camera);
      this.drawLabels(camera);
      if (overlays.stats) {
        const { render, memory } = renderer.info;
        this.canvas.dataset.debugStats = JSON.stringify({
          frameMs,
          fps: 1000 / Math.max(0.01, frameMs),
          calls: render.calls,
          triangles: render.triangles,
          geometries: memory.geometries,
          textures: memory.textures,
        });
      }
    } finally {
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
  }

  private drawLabels(camera: PerspectiveCamera) {
    if (![...this.batches.values()].some((b) => b.labels.length)) {
      this.surface?.remove();
      this.surface = undefined;
      return;
    }
    if (!this.surface) {
      this.surface = document.createElement('canvas');
      this.surface.className = 'debug-map-overlay';
      this.surface.setAttribute('aria-hidden', 'true');
      this.canvas.after(this.surface);
    }
    const dpr = Math.min(devicePixelRatio, 2),
      width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (
      this.surface.width !== Math.round(width * dpr) ||
      this.surface.height !== Math.round(height * dpr)
    ) {
      this.surface.width = Math.round(width * dpr);
      this.surface.height = Math.round(height * dpr);
    }
    const ctx = this.surface.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = 'bold 11px Arimo, sans-serif';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    const occupied = new Set<number>();
    for (const multiline of [false, true]) {
      for (const batch of this.batches.values()) {
        for (const label of batch.labels) {
          if (label.text.includes('\n') !== multiline) continue;
          const p = this.projected.copy(label.at).project(camera);
          if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) continue;
          let x = ((p.x + 1) * width) / 2 + 4,
            y = ((1 - p.y) * height) / 2 - 4;
          const bucket = Math.floor(y / 16) * 65536 + Math.floor(x / 48);
          if (!multiline && occupied.has(bucket)) continue;
          occupied.add(bucket);
          const rows = label.text.split('\n');
          if (multiline) {
            const w = Math.min(
              width,
              Math.max(...rows.map((row) => ctx.measureText(row).width)) + 12,
            );
            x = Math.min(x, width - w + 4);
            y = Math.max(12, Math.min(y, height - rows.length * 13 + 8));
            ctx.fillStyle = '#fff';
            ctx.fillRect(x - 4, y - 12, w, rows.length * 13 + 4);
          }
          ctx.fillStyle = label.color;
          for (const row of rows) {
            ctx.strokeText(row, x, y);
            ctx.fillText(row, x, y);
            y += 13;
          }
        }
      }
    }
  }

  dispose() {
    for (const key of this.batches.keys()) this.drop(key);
    this.ranges?.dispose();
    this.passes.dispose();
    this.surface?.remove();
    for (const key of ['debugRendered', 'debugOverlays', 'debugShading', 'debugStats'])
      delete this.canvas.dataset[key];
  }
}
