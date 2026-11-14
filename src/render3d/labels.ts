import {
  CanvasTexture,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { cumulativeLengths } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import {
  labelCandidates,
  labelFont,
  labelFonts,
  labelInk,
  measureText,
  placeLabels,
  type LabelCandidate,
  type LabelStyle,
  type Measure,
  type PlacedLabel,
  type TextMetrics,
} from '../render/labels';
import { style, type MapPalette } from '../render/style';
import type { CityGeometry } from '../render/types';
import { heightAt, type cityHeights } from './heights';

/**
 * TASK-183: TASK-167's labels in the 3D view. When the camera settles, every candidate is
 * projected to the screen and `placeLabels` lays them out there with the 2D rules: a street along
 * its projected line (the name must fit its length on screen and its width at the map scale of
 * its depth, and reads left to right on screen), a point at its projected position, each with the
 * map scale at its own depth.
 * A placed label is drawn as screen-sized glyphs around one world anchor, so it moves with the map
 * while the camera moves and is placed again once the camera stops. Labels draw on top of the
 * scene, buildings included, and the lighting does not darken them.
 */

/** Street lines are sampled this often, so a projected line follows the perspective. */
const sampleM = 8;
/** The camera counts as settled after this long and this many frames without moving: on a slow
 * GPU the frame after a camera change still shows the labels as they were. */
export const settleMs = 120;
export const settleFrames = 3;
/** Labels are placed up to this far outside the view (in normalised device coordinates, where
 * the view spans -1 to 1), so a short pan still finds labels in place. */
const marginNdc = 2;

interface LineSamples {
  /** World position (x east, y south), surface height and distance along the line. */
  x: number[];
  y: number[];
  h: number[];
  s: number[];
  /** The carriageway width there. */
  widthM: number[];
}
export type LabelLines = Map<readonly Vec2[], LineSamples>;

/** A visible stretch of a projected street line, in screen pixels. */
interface Run {
  line: Vec2[];
  lengths: Float64Array;
  widths: number[];
  /** Distance along the world line, view depth and world position of each vertex. */
  s: number[];
  depth: number[];
  world: { x: number; y: number; h: number }[];
  junctions?: { atM: number; radiusM: number }[];
}

export interface LabelView {
  camera: PerspectiveCamera;
  width: number;
  height: number;
}

/** A label placed on screen (`label`, in pixels), the world point it hangs from, and each glyph's
 * offset from that point's projection. */
export interface Placed3D {
  label: PlacedLabel;
  anchor: { x: number; y: number; h: number };
  offsets: Vec2[];
  /** Whether the anchor was inside the view when placed. */
  inView: boolean;
}

/** Projects world points for one camera to screen pixels and view depth. */
class Projector {
  private readonly m: number[];
  readonly focal: number;
  private readonly near: number;
  sx = 0;
  sy = 0;
  depth = 0;
  constructor(private readonly view: LabelView) {
    const { camera } = view;
    this.m = new Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .toArray();
    this.focal = view.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.near = camera.near;
  }
  /** Projects (x, y) at height h; false behind the near plane or far outside the view. */
  project(x: number, y: number, h: number) {
    const m = this.m;
    const w = m[3]! * x + m[7]! * h + m[11]! * y + m[15]!;
    const nx = (m[0]! * x + m[4]! * h + m[8]! * y + m[12]!) / w,
      ny = (m[1]! * x + m[5]! * h + m[9]! * y + m[13]!) / w;
    this.sx = ((nx + 1) * this.view.width) / 2;
    this.sy = ((1 - ny) * this.view.height) / 2;
    this.depth = w;
    return w > this.near && Math.abs(nx) <= marginNdc && Math.abs(ny) <= marginNdc;
  }
}

/** World samples of each street line, with surface heights. */
export function sampleLines(
  candidates: readonly LabelCandidate[],
  heightOf: (p: Vec2) => number,
): LabelLines {
  const result: LabelLines = new Map();
  for (const c of candidates) {
    if (c.kind !== 'street' || result.has(c.line)) continue;
    const samples: LineSamples = { x: [], y: [], h: [], s: [], widthM: [] };
    const heights = c.line.map(heightOf);
    for (let i = 0; i + 1 < c.line.length; i++) {
      const a = c.line[i]!,
        b = c.line[i + 1]!,
        length = c.lengths[i + 1]! - c.lengths[i]!;
      const steps = Math.max(1, Math.ceil(length / sampleM));
      const end = i + 2 === c.line.length ? steps : steps - 1;
      for (let k = 0; k <= end; k++) {
        const t = k / steps;
        samples.x.push(a.x + (b.x - a.x) * t);
        samples.y.push(a.y + (b.y - a.y) * t);
        samples.h.push(heights[i]! + (heights[i + 1]! - heights[i]!) * t);
        samples.s.push(c.lengths[i]! + length * t);
        samples.widthM.push(c.widths[Math.min(i, c.widths.length - 1)]!);
      }
    }
    result.set(c.line, samples);
  }
  return result;
}

/** The stretches of a street line in front of the camera and near the view, on screen. A
 * segment's width is the carriageway's at the map scale of its depth, as the flat map would
 * show it at that scale: a pitched view does not narrow it, since the text faces the camera. */
function projectLine(samples: LineSamples, p: Projector): Run[] {
  const runs: Run[] = [];
  let run: Run | null = null;
  const finish = () => {
    if (run && run.line.length >= 2) {
      run.lengths = cumulativeLengths(run.line);
      for (let i = 0; i + 1 < run.line.length; i++)
        run.widths[i] =
          (run.widths[i]! * p.focal * (1 / run.depth[i]! + 1 / run.depth[i + 1]!)) / 2;
      run.widths.length = run.line.length - 1;
      runs.push(run);
    }
    run = null;
  };
  for (let k = 0; k < samples.x.length; k++) {
    const x = samples.x[k]!,
      y = samples.y[k]!,
      h = samples.h[k]!;
    if (!p.project(x, y, h)) {
      finish();
      continue;
    }
    const last = run?.line.at(-1);
    if (last && Math.hypot(p.sx - last.x, p.sy - last.y) < 0.05) continue;
    run ??= { line: [], lengths: new Float64Array(0), widths: [], s: [], depth: [], world: [] };
    run.line.push({ x: p.sx, y: p.sy });
    run.widths.push(samples.widthM[k]!);
    run.s.push(samples.s[k]!);
    run.depth.push(p.depth);
    run.world.push({ x, y, h });
  }
  finish();
  return runs;
}

/** Index i with s[i] <= v <= s[i + 1], for an ascending s. */
function bracket(s: readonly number[], v: number) {
  let lo = 0,
    hi = s.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Lays out `candidates` (in placement order) for the camera in `view`: TASK-167's rules on
 * screen, collision-free and deterministic for a camera. */
export function placeLabels3D(
  candidates: readonly LabelCandidate[],
  lines: LabelLines,
  pointHeight: (p: Vec2) => number,
  view: LabelView,
  measure: Measure,
): Placed3D[] {
  const p = new Projector(view);
  const runs = new Map<readonly Vec2[], Run[]>();
  const runOf = new Map<readonly Vec2[], Run>();
  const points = new Map<LabelCandidate, Vec2>();
  const placed = placeLabels(candidates, 1, measure, (c) => {
    if (c.kind !== 'street') {
      if (!p.project(c.pos.x, c.pos.y, pointHeight(c.pos))) return null;
      const framed = { ...c, pos: { x: p.sx, y: p.sy } };
      points.set(framed, c.pos);
      return { candidate: framed, zoom: p.focal / p.depth };
    }
    let list = runs.get(c.line);
    if (!list) {
      list = projectLine(lines.get(c.line)!, p);
      runs.set(c.line, list);
      for (const run of list) runOf.set(run.line, run);
    }
    const run = list.find((r) => c.anchorM >= r.s[0]! && c.anchorM <= r.s.at(-1)!);
    if (!run) return null;
    const at = (v: number) => {
      const i = bracket(run.s, v);
      const u = (v - run.s[i]!) / (run.s[i + 1]! - run.s[i]!);
      const w0 = run.depth[i]!,
        w1 = run.depth[i + 1]!;
      // Depth is linear along the world segment; screen distance is linear in u / depth.
      const t = (u * w1) / ((1 - u) * w0 + u * w1);
      return {
        along: run.lengths[i]! + (run.lengths[i + 1]! - run.lengths[i]!) * t,
        zoom: p.focal / (w0 + (w1 - w0) * u),
      };
    };
    // Junction surfaces on the visible stretch, in pixels along it.
    run.junctions ??= c.junctions
      .filter((j) => j.atM + j.radiusM >= run.s[0]! && j.atM - j.radiusM <= run.s.at(-1)!)
      .map((j) => {
        const { along, zoom } = at(Math.min(run.s.at(-1)!, Math.max(run.s[0]!, j.atM)));
        return { atM: along, radiusM: j.radiusM * zoom };
      });
    const anchor = at(c.anchorM);
    return {
      candidate: {
        ...c,
        line: run.line,
        lengths: run.lengths,
        widths: run.widths,
        junctions: run.junctions,
        anchorM: anchor.along,
      },
      zoom: anchor.zoom,
    };
  });
  return placed.map((label) => {
    const c = label.candidate;
    const centre = label.glyphs[Math.floor(label.glyphs.length / 2)]!;
    let anchor: Placed3D['anchor'];
    if (c.kind === 'street') {
      // The world point under the middle glyph: the nearest point of the projected line.
      const run = runOf.get(c.line)!;
      let best = Infinity;
      anchor = run.world[0]!;
      for (let i = 0; i + 1 < run.line.length; i++) {
        const a = run.line[i]!,
          b = run.line[i + 1]!;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const t = Math.max(
          0,
          Math.min(1, ((centre.x - a.x) * dx + (centre.y - a.y) * dy) / (dx * dx + dy * dy)),
        );
        const d = Math.hypot(a.x + dx * t - centre.x, a.y + dy * t - centre.y);
        if (d < best) {
          best = d;
          const a0 = run.world[i]!,
            a1 = run.world[i + 1]!;
          // Back from screen to world: perspective-correct along the segment.
          const w0 = run.depth[i]!,
            w1 = run.depth[i + 1]!;
          const u = (t * w0) / ((1 - t) * w1 + t * w0);
          anchor = {
            x: a0.x + (a1.x - a0.x) * u,
            y: a0.y + (a1.y - a0.y) * u,
            h: a0.h + (a1.h - a0.h) * u,
          };
        }
      }
    } else {
      const pos = points.get(c)!;
      anchor = { ...pos, h: pointHeight(pos) };
    }
    p.project(anchor.x, anchor.y, anchor.h);
    const ox = p.sx,
      oy = p.sy;
    return {
      label,
      anchor,
      offsets: label.glyphs.map((g) => ({ x: g.x - ox, y: g.y - oy })),
      inView: ox >= 0 && ox <= view.width && oy >= 0 && oy <= view.height,
    };
  });
}

/** Glyph cells for the 3D labels: where each glyph sits in `texture`, in the units of `width`. */
export interface LabelAtlas {
  measure: Measure;
  glyph(char: string, s: LabelStyle): { x: number; y: number; width: number; height: number };
  readonly width: number;
  readonly height: number;
  readonly texture: Texture;
  upload(): void;
}

/** One canvas texture holding every glyph with its halo in the red channel and its fill in the
 * green one, so both passes read one texture and the inks stay uniforms. */
class GlyphAtlas implements LabelAtlas {
  // Twice the drawing resolution: street names are drawn up to 1.45 times their atlas size.
  private readonly resolution = 2 * Math.min(2, Math.ceil(window.devicePixelRatio));
  readonly width = 1024;
  height = 0;
  texture = new Texture();
  private canvas = document.createElement('canvas');
  private context = this.canvas.getContext('2d')!;
  private readonly cells = new Map<string, ReturnType<LabelAtlas['glyph']>>();
  private readonly metrics = new Map<string, TextMetrics>();
  private x = 0;
  private y = 0;
  private row = 0;
  private dirty = false;

  constructor() {
    this.grow(256);
  }

  measure = (text: string, s: LabelStyle) => {
    const key = `${s}/${text}`;
    let m = this.metrics.get(key);
    if (!m) {
      m = measureText(this.context, text, s);
      this.metrics.set(key, m);
    }
    return m;
  };

  private grow(height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = this.width * this.resolution;
    canvas.height = height * this.resolution;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (this.height) context.drawImage(this.canvas, 0, 0);
    context.scale(this.resolution, this.resolution);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.globalCompositeOperation = 'lighter';
    this.canvas = canvas;
    this.context = context;
    this.height = height;
    this.texture.dispose();
    const texture = (this.texture = new CanvasTexture(canvas));
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
  }

  glyph(char: string, s: LabelStyle) {
    const key = `${s}/${char}`;
    let cell = this.cells.get(key);
    if (!cell) {
      const halo = style.label.haloPx;
      this.context.font = labelFont(s);
      const width = Math.ceil(this.context.measureText(char).width + 2 * halo + 2);
      const height = Math.ceil(labelFonts[s].sizePx * 1.4 + 2 * halo);
      if (this.x + width > this.width) {
        this.x = 0;
        this.y += this.row;
        this.row = 0;
      }
      while (this.y + height > this.height) this.grow(this.height * 2);
      cell = { x: this.x, y: this.y, width, height };
      // A grown atlas has a new context.
      const c = this.context;
      c.font = labelFont(s);
      c.lineWidth = 2 * halo;
      c.strokeStyle = '#ff0000';
      c.strokeText(char, cell.x + width / 2, cell.y + height / 2);
      c.fillStyle = '#00ff00';
      c.fillText(char, cell.x + width / 2, cell.y + height / 2);
      this.x += width;
      this.row = Math.max(this.row, height);
      this.cells.set(key, cell);
      this.dirty = true;
    }
    return cell;
  }

  upload() {
    if (this.dirty) this.texture.needsUpdate = true;
    this.dirty = false;
  }
}

export async function loadLabelAtlas(): Promise<LabelAtlas> {
  await Promise.all((['station', 'minor'] as const).map((s) => document.fonts.load(labelFont(s))));
  return new GlyphAtlas();
}

const inkIndex = { street: 0, place: 1, area: 2, station: 3 } as const;
/** sRGB components as given: the label shader writes them without colour management, so the
 * inks are exactly the 2D ones. */
const rgb = (hex: number) =>
  new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

const vertexShader = /* glsl */ `
attribute vec4 anchor;
attribute vec4 box;
attribute vec4 cell;
attribute vec2 ink;
uniform vec2 viewport;
uniform vec3 inks[4];
varying vec2 vUv;
varying vec3 vInk;
varying float vAlpha;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(anchor.xyz, 1.0);
  float c = cos(anchor.w), s = sin(anchor.w);
  vec2 corner = position.xy * box.zw;
  vec2 px = box.xy + vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  clip.xy += vec2(px.x, -px.y) * 2.0 / viewport * clip.w;
  // On top of the scene; an anchor behind the camera (w < 0) is clipped with its label.
  clip.z = 0.0;
  gl_Position = clip;
  vUv = mix(cell.xy, cell.zw, position.xy + 0.5);
  vInk = inks[int(ink.x)];
  vAlpha = ink.y;
}`;
const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform vec3 halo;
varying vec2 vUv;
varying vec3 vInk;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, vUv);
#ifdef HALO
  float a = t.r * vAlpha;
  vec3 colour = halo;
#else
  float a = t.g * vAlpha;
  vec3 colour = vInk;
#endif
  // Most of a glyph's cell is empty: skip its blending.
  if (a < 0.004) discard;
  gl_FragColor = vec4(colour, a);
}`;

export type LabelCounts = Record<'street' | 'station' | 'stop' | 'place' | 'glyphs', number>;

/** The 3D label layer: placement when the camera settles, two instanced draws (halos, then
 * fills). */
export class Labels3D {
  readonly group = new Group();
  private atlas: LabelAtlas | undefined;
  private city: CompiledCity | undefined;
  private source: CityGeometry | undefined;
  private candidates: readonly LabelCandidate[] = [];
  private lines: LabelLines = new Map();
  private pointHeight: (p: Vec2) => number = () => 0;
  private visible = true;
  /** The camera's world matrix, field of view and viewport, as last seen. */
  private readonly viewKey = new Float64Array(19);
  private placedCurrent = false;
  private movedAt = 0;
  private stillFrames = 0;
  private placed: Placed3D[] = [];
  private readonly uniforms = {
    map: { value: new Texture() },
    viewport: { value: new Vector2(1, 1) },
    inks: { value: [0, 0, 0, 0].map(() => new Vector3()) },
    halo: { value: new Vector3() },
  };
  private readonly meshes: Mesh<InstancedBufferGeometry, ShaderMaterial>[];
  private capacity = 0;
  private placedCounts: LabelCounts = { street: 0, station: 0, stop: 0, place: 0, glyphs: 0 };

  constructor(atlas: Promise<LabelAtlas>) {
    this.meshes = [true, false].map((halo, i) => {
      const material = new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        defines: halo ? { HALO: '' } : {},
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(new InstancedBufferGeometry(), material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1e6 + i;
      return mesh;
    });
    this.group.add(...this.meshes);
    this.group.visible = false;
    this.setColours(style.label);
    void atlas.then((a) => {
      this.atlas = a;
      this.placedCurrent = false;
    });
  }

  /** The candidates of a new city or source, and the heights of a new 3D build. */
  setCity(city: CompiledCity, source: CityGeometry, heights: ReturnType<typeof cityHeights>) {
    if (city !== this.city || source !== this.source)
      this.candidates = labelCandidates(city, source);
    this.city = city;
    this.source = source;
    // A street label sits on the road surface: decks and ramps at their height.
    const surface = new Map<Vec2, number>();
    for (const road of city.roads) {
      const lengths = cumulativeLengths(road.reference),
        profile = heights.roads[road.idx]!;
      road.reference.forEach((p, i) =>
        surface.set(
          p,
          heightAt(
            profile,
            Math.min(profile.lengthM, Math.max(0, lengths[i]! - road.stations[0]!)),
          ),
        ),
      );
    }
    this.pointHeight = (p) => heights.terrain.groundAt(p.x, p.y);
    this.lines = sampleLines(this.candidates, (p) => surface.get(p) ?? this.pointHeight(p));
    this.placed = [];
    this.placedCurrent = false;
    this.fill();
  }

  setColours(label: MapPalette['label']) {
    for (const [key, i] of Object.entries(inkIndex))
      this.uniforms.inks.value[i]!.copy(rgb(label[key as keyof typeof inkIndex]));
    this.uniforms.halo.value.copy(rgb(label.halo));
  }

  /** The Labels layer; true when that changes what is drawn. */
  setVisible(visible: boolean) {
    if (visible === this.visible) return false;
    this.visible = visible;
    this.group.visible = visible && this.placedCounts.glyphs > 0;
    return true;
  }

  /** Places the labels again once the camera has settled somewhere new; true when it did. */
  update(view: LabelView, now: number) {
    this.uniforms.viewport.value.set(view.width, view.height);
    if (!this.visible || !this.atlas) return false;
    const values = [...view.camera.matrixWorld.elements, view.camera.fov, view.width, view.height];
    let moved = false;
    for (let i = 0; i < 19; i++) {
      const value = values[i]!;
      if (Math.abs(value - this.viewKey[i]!) > 1e-4) moved = true;
      this.viewKey[i] = value;
    }
    if (moved) {
      this.movedAt = now;
      this.stillFrames = 0;
      this.placedCurrent = false;
      return false;
    }
    this.stillFrames++;
    if (this.placedCurrent || now - this.movedAt < settleMs || this.stillFrames < settleFrames)
      return false;
    this.placedCurrent = true;
    this.placed = placeLabels3D(
      this.candidates,
      this.lines,
      this.pointHeight,
      view,
      this.atlas.measure,
    );
    this.fill();
    return true;
  }

  /** The labels placed for the current camera (for tests). */
  get labels(): readonly Placed3D[] {
    return this.visible ? this.placed : [];
  }
  /** Labels whose anchor was in view when placed, by kind, and the glyphs drawn. */
  get counts(): LabelCounts {
    return this.visible
      ? this.placedCounts
      : { street: 0, station: 0, stop: 0, place: 0, glyphs: 0 };
  }

  private fill() {
    const atlas = this.atlas;
    const glyphs: { placed: Placed3D; i: number }[] = [];
    for (const placed of this.placed)
      placed.label.glyphs.forEach((g, i) => {
        if (g.char.trim() !== '') glyphs.push({ placed, i });
      });
    if (!atlas) glyphs.length = 0;
    // Every cell first: the atlas may grow, which moves the texture coordinates.
    const cells = glyphs.map(({ placed, i }) =>
      atlas!.glyph(placed.label.glyphs[i]!.char, placed.label.candidate.style),
    );
    if (glyphs.length > this.capacity) {
      this.capacity = Math.max(1024, 2 * glyphs.length);
      const quad = new PlaneGeometry(1, 1);
      const geometry = new InstancedBufferGeometry();
      geometry.index = quad.index;
      geometry.setAttribute('position', quad.getAttribute('position'));
      for (const [name, size] of [
        ['anchor', 4],
        ['box', 4],
        ['cell', 4],
        ['ink', 2],
      ] as const)
        geometry.setAttribute(
          name,
          new InstancedBufferAttribute(new Float32Array(this.capacity * size), size),
        );
      for (const mesh of this.meshes) {
        mesh.geometry.dispose();
        mesh.geometry = geometry;
      }
    }
    const geometry = this.meshes[0]!.geometry;
    if (this.capacity) {
      const attribute = (name: string) => geometry.getAttribute(name) as InstancedBufferAttribute;
      const [anchor, box, cell, ink] = ['anchor', 'box', 'cell', 'ink'].map(attribute) as [
        InstancedBufferAttribute,
        InstancedBufferAttribute,
        InstancedBufferAttribute,
        InstancedBufferAttribute,
      ];
      glyphs.forEach(({ placed, i }, k) => {
        const { label, anchor: a, offsets } = placed;
        const g = label.glyphs[i]!,
          c = cells[k]!;
        anchor.setXYZW(k, a.x, a.h, a.y, g.rotation);
        box.setXYZW(k, offsets[i]!.x, offsets[i]!.y, c.width * label.scale, c.height * label.scale);
        cell.setXYZW(
          k,
          c.x / atlas!.width,
          c.y / atlas!.height,
          (c.x + c.width) / atlas!.width,
          (c.y + c.height) / atlas!.height,
        );
        ink.setXY(k, inkIndex[labelInk[label.candidate.style]], label.alpha);
      });
      for (const a of [anchor, box, cell, ink]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, glyphs.length * a.itemSize);
        a.needsUpdate = true;
      }
    }
    geometry.instanceCount = glyphs.length;
    if (atlas) {
      atlas.upload();
      this.uniforms.map.value = atlas.texture;
    }
    const counts: LabelCounts = { street: 0, station: 0, stop: 0, place: 0, glyphs: glyphs.length };
    for (const placed of this.placed)
      if (placed.inView && placed.label.alpha > 0) counts[placed.label.candidate.kind]++;
    this.placedCounts = counts;
    this.group.visible = this.visible && glyphs.length > 0;
  }

  destroy() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.atlas?.texture.dispose();
  }
}
