import { CanvasSource, Container, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';
import {
  labelFont as fontOf,
  labelFonts,
  labelInk as ink,
  measureText,
  placeLabels,
  type LabelCandidate,
  type LabelStyle,
  type PlacedLabel,
  type TextMetrics,
} from '../labels';
import { style, type MapPalette } from '../style';
import type { ViewBounds } from './stations';

/** Upright text from a glyph atlas: each glyph once as a white fill and once as a white halo, so
 * the ink and halo colours are sprite tints (`style.label`, or the dark appearance's from
 * `setColours`) and a new palette needs no new glyph textures. */
const PAGE = 512;
const MAX_TEXTURE = 4096;
/** Side in pixels of the squares the label texture is cut into, to draw only those with ink. */
const TILE = 16;

interface Glyph {
  fill: Texture;
  halo: Texture;
}

class GlyphAtlas {
  // Twice the device resolution: street names are drawn up to 1.45 times their atlas size.
  private readonly resolution = 2 * Math.ceil(window.devicePixelRatio);
  private readonly glyphs = new Map<string, Glyph>();
  private readonly metrics = new Map<string, TextMetrics>();
  private readonly measurer = document.createElement('canvas').getContext('2d')!;
  private pages: { context: CanvasRenderingContext2D; source: CanvasSource }[] = [];
  private x = PAGE;
  private y = 0;
  private row = 0;
  private dirty = new Set<CanvasSource>();

  measure(text: string, s: LabelStyle): TextMetrics {
    const key = `${s}/${text}`;
    let m = this.metrics.get(key);
    if (!m) {
      m = measureText(this.measurer, text, s);
      this.metrics.set(key, m);
    }
    return m;
  }

  private cell(width: number, height: number) {
    if (this.x + width > PAGE) {
      this.x = 0;
      this.y += this.row;
      this.row = 0;
    }
    if (!this.pages.length || this.y + height > PAGE) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = PAGE * this.resolution;
      const context = canvas.getContext('2d')!;
      context.scale(this.resolution, this.resolution);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.fillStyle = context.strokeStyle = '#ffffff';
      const source = new CanvasSource({ resource: canvas, resolution: this.resolution });
      this.pages.push({ context, source });
      this.x = this.y = this.row = 0;
    }
    const at = { x: this.x, y: this.y, page: this.pages.at(-1)! };
    this.x += width;
    this.row = Math.max(this.row, height);
    return at;
  }

  glyph(char: string, s: LabelStyle): Glyph {
    const key = `${s}/${char}`;
    let g = this.glyphs.get(key);
    if (!g) {
      const halo = style.label.haloPx;
      this.measurer.font = fontOf(s);
      const width = Math.ceil(this.measurer.measureText(char).width + 2 * halo + 2);
      const height = Math.ceil(labelFonts[s].sizePx * 1.4 + 2 * halo);
      const textures = [0, 1].map((stroke) => {
        const { x, y, page } = this.cell(width, height);
        const { context } = page;
        context.font = fontOf(s);
        context.lineWidth = 2 * halo;
        if (stroke) context.strokeText(char, x + width / 2, y + height / 2);
        else context.fillText(char, x + width / 2, y + height / 2);
        this.dirty.add(page.source);
        return new Texture({ source: page.source, frame: new Rectangle(x, y, width, height) });
      });
      g = { fill: textures[0]!, halo: textures[1]! };
      this.glyphs.set(key, g);
    }
    return g;
  }

  upload() {
    for (const source of this.dirty) source.update();
    this.dirty.clear();
  }

  destroy() {
    for (const { source } of this.pages) source.destroy();
  }
}

const overlaps = (a: ViewBounds, b: ViewBounds) =>
  a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;

export function createLabelLayer() {
  const container = new Container();
  container.eventMode = 'none';
  // The glyph sprites live outside the scene, in a container scaled to texture pixels; the scene
  // holds only sprites of the squares of their texture that contain ink.
  const sheet = new Container(),
    scaled = new Container(),
    halos = new Container(),
    fills = new Container();
  scaled.addChild(halos, fills);
  sheet.addChild(scaled);
  let atlas: GlyphAtlas | undefined;
  let candidates: readonly LabelCandidate[] = [];
  let colours: MapPalette['label'] = style.label;
  let placed: PlacedLabel[] = [];
  let placedZoom = NaN;
  let covered: ViewBounds | null = null;
  let glyphs = 0;
  let drawnRuns = 0;
  let drawnPx = 0;
  let inView: PlacedLabel[] = [];
  let sheetTexture: Texture | undefined;
  const pool: { halo: Sprite; fill: Sprite }[] = [];
  const runs: { sprite: Sprite; texture?: Texture }[] = [];
  const fontsReady =
    typeof document === 'undefined'
      ? Promise.resolve()
      : Promise.all(
          (['station', 'minor'] as const).map((s) => document.fonts.load(fontOf(s))),
        ).then(() => {
          atlas = new GlyphAtlas();
        });

  function draw(zoom: number, view: ViewBounds, renderer: Renderer) {
    // Cover an eighth of a view more on each side: a pan redraws the labels now and then, and
    // their cached texture stays small.
    const w = view.maxX - view.minX,
      h = view.maxY - view.minY;
    covered = {
      minX: view.minX - w / 8,
      minY: view.minY - h / 8,
      maxX: view.maxX + w / 8,
      maxY: view.maxY + h / 8,
    };
    // The labels change only with a zoom step or a pan out of `covered`: drawn once into a texture
    // at screen resolution (at most MAX_TEXTURE px wide).
    const resolution = Math.min(
      zoom * window.devicePixelRatio,
      MAX_TEXTURE / Math.max(covered.maxX - covered.minX, covered.maxY - covered.minY),
    );
    scaled.scale.set(resolution);
    let used = 0;
    for (const label of placed) {
      if (!overlaps(label.bounds, covered)) continue;
      const s = label.candidate.style;
      for (const g of label.glyphs) {
        if (g.char.trim() === '') continue;
        const glyph = atlas!.glyph(g.char, s);
        let sprites = pool[used];
        if (!sprites) {
          sprites = { halo: new Sprite(), fill: new Sprite() };
          for (const sprite of [sprites.halo, sprites.fill]) sprite.anchor.set(0.5);
          halos.addChild(sprites.halo);
          fills.addChild(sprites.fill);
          pool.push(sprites);
        }
        used++;
        for (const [sprite, texture, tint] of [
          [sprites.halo, glyph.halo, colours.halo],
          [sprites.fill, glyph.fill, colours[ink[s]]],
        ] as const) {
          sprite.texture = texture;
          sprite.tint = tint;
          sprite.alpha = label.alpha;
          sprite.position.set(g.x, g.y);
          sprite.rotation = g.rotation;
          sprite.scale.set(label.scale / zoom);
          sprite.visible = true;
        }
      }
    }
    for (let i = used; i < pool.length; i++) pool[i]!.halo.visible = pool[i]!.fill.visible = false;
    glyphs = used;
    atlas!.upload();
    for (const run of runs) run.texture?.destroy();
    sheetTexture?.destroy(true);
    sheetTexture = undefined;
    drawnRuns = 0;
    drawnPx = 0;
    if (used) {
      // The texture holds just the ink, from whole metres (as Pixi's cacheAsTexture bounds were, so
      // the text keeps its pixels). Most of it is transparent and a full-size quad costs fill rate
      // every frame, so each frame draws only runs of its TILE squares that a glyph touches.
      const bounds = sheet.getLocalBounds(),
        left = Math.floor(bounds.minX / resolution),
        top = Math.floor(bounds.minY / resolution),
        frame = new Rectangle(
          left * resolution,
          top * resolution,
          Math.ceil((Math.ceil(bounds.maxX / resolution) - left) * resolution),
          Math.ceil((Math.ceil(bounds.maxY / resolution) - top) * resolution),
        ),
        columns = Math.ceil(frame.width / TILE),
        rows = Math.ceil(frame.height / TILE),
        inked = new Uint8Array(columns * rows);
      for (let i = 0; i < used; i++) {
        const { position, scale, rotation, texture } = pool[i]!.fill;
        // The glyph quad's bounding box, in texture pixels.
        const w = texture.frame.width * scale.x * resolution,
          h = texture.frame.height * scale.x * resolution,
          cos = Math.abs(Math.cos(rotation)),
          sin = Math.abs(Math.sin(rotation)),
          x = position.x * resolution - frame.x,
          y = position.y * resolution - frame.y,
          hw = (cos * w + sin * h) / 2,
          hh = (sin * w + cos * h) / 2;
        for (
          let row = Math.max(0, Math.floor((y - hh) / TILE));
          row < rows && row * TILE < y + hh;
          row++
        )
          for (
            let column = Math.max(0, Math.floor((x - hw) / TILE));
            column < columns && column * TILE < x + hw;
            column++
          )
            inked[row * columns + column] = 1;
      }
      sheetTexture = renderer.textureGenerator.generateTexture({
        target: sheet,
        frame,
        resolution: 1,
        antialias: true,
      });
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          if (!inked[row * columns + column]) continue;
          let end = column + 1;
          while (end < columns && inked[row * columns + end]) end++;
          const x = column * TILE,
            y = row * TILE;
          let run = runs[drawnRuns];
          if (!run) {
            run = { sprite: new Sprite() };
            container.addChild(run.sprite);
            runs.push(run);
          }
          drawnRuns++;
          run.texture = new Texture({
            source: sheetTexture.source,
            frame: new Rectangle(
              x,
              y,
              Math.min(end * TILE, frame.width) - x,
              Math.min(y + TILE, frame.height) - y,
            ),
          });
          run.sprite.texture = run.texture;
          drawnPx += run.texture.frame.width * run.texture.frame.height;
          run.sprite.position.set((frame.x + x) / resolution, (frame.y + y) / resolution);
          run.sprite.scale.set(1 / resolution);
          run.sprite.visible = true;
          column = end;
        }
      }
    }
    for (let i = drawnRuns; i < runs.length; i++) runs[i]!.sprite.visible = false;
  }

  return {
    container,
    fontsReady,
    /** TASK-166: new inks for the appearance; the cached label texture is redrawn on the next
     * update. */
    setColours(next: MapPalette['label']) {
      colours = next;
      covered = null;
    },
    setCandidates(next: readonly LabelCandidate[]) {
      candidates = next;
      placedZoom = NaN;
    },
    /** Places labels for a new zoom step and draws those near the view. */
    update(zoom: number, view: ViewBounds, visible: boolean, renderer: Renderer) {
      container.visible = visible;
      if (!visible || !atlas) return;
      // Placement runs at zoom steps of 2^(1/8): between steps the text scales with the map by
      // at most 4.4 %, and a zoom gesture re-places labels a few times instead of every frame.
      const step = 2 ** (Math.round(Math.log2(zoom) * 8) / 8);
      if (step !== placedZoom) {
        placed = placeLabels(candidates, step, (text, s) => atlas!.measure(text, s));
        placedZoom = step;
        covered = null;
      }
      if (
        !covered ||
        view.minX < covered.minX ||
        view.minY < covered.minY ||
        view.maxX > covered.maxX ||
        view.maxY > covered.maxY
      )
        draw(step, view, renderer);
      inView = placed.filter((label) => label.alpha > 0 && overlaps(label.bounds, view));
    },
    /** Labels visible in the view, by kind, and the glyph sprites drawn around it. */
    get counts() {
      const counts = { street: 0, station: 0, stop: 0, place: 0, glyphs: 0, runs: 0, drawnPx: 0 };
      if (!container.visible || !atlas) return counts;
      for (const label of inView) counts[label.candidate.kind]++;
      counts.glyphs = glyphs;
      counts.runs = drawnRuns;
      counts.drawnPx = drawnPx;
      return counts;
    },
    /** The labels visible in the view (for tests). */
    get visibleLabels() {
      return container.visible ? inView : [];
    },
    destroy() {
      sheetTexture?.destroy(true);
      atlas?.destroy();
    },
  };
}
