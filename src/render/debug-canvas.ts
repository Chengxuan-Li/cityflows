import type { Bounds } from './camera';
import {
  layerIndex,
  type DebugItem,
  type DebugLayer,
  type DebugPalette,
  type DebugTarget,
} from './debug-geometry';

/** How a view maps world metres to the overlay's CSS pixels. */
export interface DebugProjector {
  /** Changes whenever what `project` gives changes. */
  key: string;
  width: number;
  height: number;
  /** Pixels per metre at the middle of the view. */
  scale: number;
  /** The ground the view shows, for skipping grounded items outside it. */
  bounds: Bounds;
  /** Writes the screen point to `out[0]`, `out[1]`; false behind the camera. */
  project(x: number, y: number, z: number, out: Float64Array): boolean;
}

const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`;
const font = '11px Arimo, sans-serif';
const point = new Float64Array(2);

/** A target as last drawn: its screen points (a dot: one, with its radius). */
interface Drawn {
  target: DebugTarget;
  start: number;
  count: number;
  radius: number;
}

/**
 * TASK-375: the debug overlays on a 2D canvas over the map, the same for the 2D and the 3D view:
 * marks keep their pixel width at any zoom, every mark has a casing in the halo colour so it
 * reads over the rendered scene and on the plain canvas, and labels make room for each other.
 * It redraws only when the view, the layers or the palette change.
 */
export class DebugCanvas {
  readonly element = document.createElement('canvas');
  private drawnKey = '';
  private drawn: Drawn[] = [];
  private coords = new Float32Array(4096);
  private used = 0;
  /** Items drawn in the last frame, by layer, for the canvas's data attributes. */
  counts: number[] = [];

  constructor(beside: HTMLCanvasElement) {
    this.element.className = 'debug-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    beside.after(this.element);
  }

  /** `key` names the layers' content and the palette; the drawing repeats only when it or the
   *  view changes. */
  draw(
    layers: readonly DebugLayer[],
    view: DebugProjector,
    palette: DebugPalette,
    key: string,
    readout: readonly string[] | null,
  ) {
    const next = `${key}|${view.key}|${readout?.join('/') ?? ''}`;
    if (next === this.drawnKey) return false;
    this.drawnKey = next;
    const canvas = this.element;
    canvas.hidden = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(view.width * dpr)),
      h = Math.max(1, Math.round(view.height * dpr));
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'bevel';
    this.drawn = [];
    this.used = 0;
    this.counts = [];
    const texts: { x: number; y: number; text: string; colour: number }[] = [];
    for (const layer of layers) {
      const items = this.visible(layer, view);
      this.counts.push(items.length);
      this.drawLines(ctx, items, view, palette);
      this.drawDots(ctx, items, view, palette);
      for (const item of items) {
        if (item.kind !== 'text') continue;
        const { x, y, z } = item.at;
        if (view.project(x, y, z, point))
          texts.push({
            x: point[0]!,
            y: point[1]!,
            text: item.text,
            colour: this.colour(item, palette),
          });
      }
    }
    this.drawTexts(ctx, texts, palette, view);
    if (readout?.length) this.drawReadout(ctx, readout, palette, view);
    return true;
  }

  /** Forces the next `draw` to repaint (a resize, a new canvas size). */
  invalidate() {
    this.drawnKey = '';
  }

  clear() {
    if (!this.drawnKey) return;
    this.drawnKey = '';
    this.drawn = [];
    this.counts = [];
    this.element.getContext('2d')!.clearRect(0, 0, this.element.width, this.element.height);
    this.element.hidden = true;
  }

  /** The target drawn nearest a screen point, within a few pixels; the topmost wins a tie. */
  hit(x: number, y: number): DebugTarget | null {
    let best: DebugTarget | null = null;
    let nearest = 6;
    const c = this.coords;
    for (let k = this.drawn.length - 1; k >= 0; k--) {
      const { target, start, count, radius } = this.drawn[k]!;
      let d: number;
      if (count === 1) d = Math.max(0, Math.hypot(c[start]! - x, c[start + 1]! - y) - radius);
      else {
        d = Infinity;
        for (let i = 0; i + 1 < count; i++) {
          const ax = c[start + 2 * i]!,
            ay = c[start + 2 * i + 1]!,
            bx = c[start + 2 * i + 2]!,
            by = c[start + 2 * i + 3]!;
          const dx = bx - ax,
            dy = by - ay;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
          );
          d = Math.min(d, Math.hypot(ax + t * dx - x, ay + t * dy - y));
        }
      }
      if (d < nearest) [nearest, best] = [d, target];
    }
    return best;
  }

  destroy() {
    this.element.remove();
  }

  private visible(layer: DebugLayer, view: DebugProjector) {
    const shown = (item: DebugItem) => (item.minScale ?? 0) <= view.scale;
    if (!layer.grounded || !layer.items.length) return layer.items.filter(shown);
    const { minX, minY, maxX, maxY } = view.bounds;
    return layerIndex(layer)
      .search(minX, minY, maxX, maxY)
      .sort((a, b) => a - b)
      .map((i) => layer.items[i]!)
      .filter(shown);
  }

  private colour(item: DebugItem, palette: DebugPalette) {
    return item.colour ?? palette.ink[item.ink];
  }

  private record(target: DebugTarget, xs: readonly number[], radius: number) {
    if (this.used + xs.length > this.coords.length) {
      const grown = new Float32Array(Math.max(this.coords.length * 2, this.used + xs.length));
      grown.set(this.coords);
      this.coords = grown;
    }
    this.coords.set(xs, this.used);
    this.drawn.push({ target, start: this.used, count: xs.length / 2, radius });
    this.used += xs.length;
  }

  private drawLines(
    ctx: CanvasRenderingContext2D,
    items: readonly DebugItem[],
    view: DebugProjector,
    palette: DebugPalette,
  ) {
    // One path per colour, width and dash, stroked first in the halo, then in the ink.
    const buckets = new Map<
      string,
      { path: Path2D; colour: number; width: number; dash: boolean }
    >();
    for (const item of items) {
      if (item.kind !== 'line') continue;
      const width = item.widthM ? Math.max(item.width, item.widthM * view.scale) : item.width;
      const colour = this.colour(item, palette);
      const key = `${colour}|${width.toFixed(1)}|${item.dash ? 1 : 0}`;
      // Projected, with vertices closer than 1.5 px to the last kept one left out (the far
      // view holds thousands of lines a few pixels long); a run breaks behind the camera.
      const xs: number[] = [];
      const runs = new Set<number>();
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      let open = false;
      const last = item.points.length - 1;
      item.points.forEach((p, i) => {
        if (!view.project(p.x, p.y, p.z, point)) {
          open = false;
          return;
        }
        const x = point[0]!,
          y = point[1]!;
        const n = xs.length;
        if (open && i < last && Math.abs(x - xs[n - 2]!) + Math.abs(y - xs[n - 1]!) < 1.5) return;
        if (!open) runs.add(n);
        open = true;
        xs.push(x, y);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
      // A line under 2 px is left out, but not a stretch of a ramp-coloured road (a gap).
      if (xs.length < 4 || (item.colour === undefined && Math.max(maxX - minX, maxY - minY) < 2))
        continue;
      if (maxX < -width || maxY < -width || minX > view.width + width || minY > view.height + width)
        continue;
      let bucket = buckets.get(key);
      if (!bucket)
        buckets.set(key, (bucket = { path: new Path2D(), colour, width, dash: !!item.dash }));
      for (let i = 0; i < xs.length; i += 2) {
        if (runs.has(i)) bucket.path.moveTo(xs[i]!, xs[i + 1]!);
        else bucket.path.lineTo(xs[i]!, xs[i + 1]!);
      }
      if (item.arrow && xs.length >= 4) this.chevron(bucket.path, xs);
      if (item.target && xs.length >= 4) this.record(item.target, xs, 0);
    }
    const sorted = [...buckets.values()].sort((a, b) => b.width - a.width);
    ctx.setLineDash([]);
    ctx.strokeStyle = hex(palette.halo);
    ctx.globalAlpha = 0.85;
    // Hairlines go without a casing: it would double the far view's raster work, and their
    // ink alone keeps 3:1 on the canvas.
    for (const { path, width } of sorted) {
      if (width < 1.5) continue;
      ctx.lineWidth = width + 2.5;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    for (const { path, colour, width, dash } of sorted) {
      ctx.setLineDash(dash ? [5, 4] : []);
      ctx.strokeStyle = hex(colour);
      ctx.lineWidth = width;
      ctx.stroke(path);
    }
    ctx.setLineDash([]);
  }

  /** A chevron at the middle of a screen polyline, pointing along it, where the line is long
   *  enough on screen to carry one. */
  private chevron(path: Path2D, xs: readonly number[]) {
    let length = 0;
    for (let i = 2; i < xs.length; i += 2)
      length += Math.hypot(xs[i]! - xs[i - 2]!, xs[i + 1]! - xs[i - 1]!);
    if (length < 24) return;
    let left = length / 2;
    for (let i = 2; i < xs.length; i += 2) {
      const dx = xs[i]! - xs[i - 2]!,
        dy = xs[i + 1]! - xs[i - 1]!;
      const step = Math.hypot(dx, dy);
      if (step < left) {
        left -= step;
        continue;
      }
      const ux = dx / step,
        uy = dy / step;
      const x = xs[i - 2]! + ux * left,
        y = xs[i - 1]! + uy * left;
      path.moveTo(x - ux * 5 + uy * 3.5, y - uy * 5 - ux * 3.5);
      path.lineTo(x, y);
      path.lineTo(x - ux * 5 - uy * 3.5, y - uy * 5 + ux * 3.5);
      return;
    }
  }

  private drawDots(
    ctx: CanvasRenderingContext2D,
    items: readonly DebugItem[],
    view: DebugProjector,
    palette: DebugPalette,
  ) {
    // Small dots (through nodes, walk nodes, conflict points) go without a casing, as hairlines.
    const buckets = new Map<
      string,
      { path: Path2D; colour: number; hollow: boolean; cased: boolean }
    >();
    for (const item of items) {
      if (item.kind !== 'dot') continue;
      if (!view.project(item.at.x, item.at.y, item.at.z, point)) continue;
      const [x, y] = [point[0]!, point[1]!];
      if (x < -8 || y < -8 || x > view.width + 8 || y > view.height + 8) continue;
      const colour = this.colour(item, palette);
      const cased = item.radius > 2;
      const key = `${colour}|${item.hollow ? 1 : 0}|${cased ? 1 : 0}`;
      let bucket = buckets.get(key);
      if (!bucket)
        buckets.set(key, (bucket = { path: new Path2D(), colour, hollow: !!item.hollow, cased }));
      bucket.path.moveTo(x + item.radius, y);
      bucket.path.arc(x, y, item.radius, 0, 2 * Math.PI);
      if (item.target) this.record(item.target, [x, y], item.radius);
    }
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = hex(palette.halo);
    for (const { path, hollow, cased } of buckets.values()) {
      if (!cased) continue;
      ctx.lineWidth = hollow ? 4 : 2.5;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    for (const { path, colour, hollow } of buckets.values()) {
      if (hollow) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = hex(colour);
        ctx.stroke(path);
      } else {
        ctx.fillStyle = hex(colour);
        ctx.fill(path);
      }
    }
  }

  private drawTexts(
    ctx: CanvasRenderingContext2D,
    texts: readonly { x: number; y: number; text: string; colour: number }[],
    palette: DebugPalette,
    view: DebugProjector,
  ) {
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = hex(palette.halo);
    // Labels that would overlap one already drawn are left out: cells of 8 by 14 pixels.
    const taken = new Set<number>();
    for (const { x, y, text, colour } of texts) {
      if (x < -50 || y < -20 || x > view.width + 50 || y > view.height + 20) continue;
      const width = ctx.measureText(text).width;
      const lx = x + 5,
        ly = y - 7;
      const cells: number[] = [];
      for (let cx = Math.floor(lx / 8); cx <= Math.floor((lx + width) / 8); cx++)
        cells.push(Math.floor(ly / 14) * 4096 + cx);
      if (cells.some((cell) => taken.has(cell))) continue;
      for (const cell of cells) taken.add(cell);
      ctx.strokeText(text, lx, ly);
      ctx.fillStyle = hex(colour);
      ctx.fillText(text, lx, ly);
    }
  }

  private drawReadout(
    ctx: CanvasRenderingContext2D,
    rows: readonly string[],
    palette: DebugPalette,
    view: DebugProjector,
  ) {
    ctx.font = font;
    ctx.textBaseline = 'top';
    const width = Math.max(...rows.map((row) => ctx.measureText(row).width)) + 12;
    const x = view.width - width - 8,
      y = 8;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = hex(palette.halo);
    ctx.beginPath();
    ctx.roundRect(x, y, width, rows.length * 14 + 8, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = hex(palette.ink.grey);
    rows.forEach((row, i) => ctx.fillText(row, x + 6, y + 5 + i * 14));
  }
}
