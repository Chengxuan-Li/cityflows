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
import { cumulativeLengths, nearestOnPolyline, preparePolygon } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, WalkGraph } from '../network';
import { profileHeightAt } from '../network/heights';
import {
  labelCandidates,
  labelFont,
  labelFonts,
  labelInk,
  labelScale,
  measureText,
  placeLabels,
  type LabelCandidate,
  type LabelFrame,
  type LabelStyle,
  type Measure,
  type PlacedLabel,
  type StreetCandidate,
  type TextMetrics,
} from '../render/labels';
import { style, type MapPalette } from '../render/style';
import type { CityGeometry } from '../render/types';
import type { ContextFeature } from '../schema';
import { heightAt, type cityHeights } from './heights';
import { buildingPieces } from './roofs';
import { elevatorLandings, elevatorTopM, isElevator } from './elevators';
import { lowestGround } from './terrain';

/**
 * TASK-183: TASK-167's labels in the 3D view. When the camera settles, every candidate is
 * projected to the screen and `placeLabels` lays them out there with the 2D rules: a street along
 * its projected line (the name must fit its length on screen and its width at the map scale of
 * its depth, and reads left to right on screen), a point at its projected position, each with the
 * map scale at its own depth.
 * TASK-192: a stretch of street hidden from the camera by a building or a road deck carries no
 * label, and a station, stop or place whose point is hidden is dropped (`Occluders`, tested once
 * per placement). Visible labels draw on top of the scene and the lighting does not darken them.
 * While the camera moves, a point label hangs screen-sized from its world point, and each glyph of
 * a street label sits on its own road point, turned along the road on screen and sized for its
 * distance (`glyphsOnScreen`), until the camera settles and the labels are placed again.
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
/** A street's sight line ends this far above its surface, so the road's own deck does not hide
 * it. */
const clearM = 0.5;
/** Deck prisms are cut this short along their road, so a ramp's prism stays under the sight
 * lines to its own surface. */
const deckPieceM = 4;
/** Below this height above the ground a deck hides nothing under it. */
const deckMinM = 1;
/** Street samples are tested for occlusion at most this often on screen, and the edges of what
 * hides them found this closely. */
const testPx = 6;
const edgePx = 2;
/** The occluder grid's cell size. */
const cellM = 32;
/** A hidden point label tries at most about this many points of its own area, this far apart at
 * the closest. */
const spotCount = 64;
const spotM = 4;

interface Spot {
  x: number;
  y: number;
  h: number;
}

/** A plan outline (closed rings, even-odd) standing between two heights. */
export interface Prism {
  rings: readonly (readonly Vec2[])[];
  bottom: number;
  top: number;
}

/** TASK-192: prisms that hide labels from the camera: the buildings, or the road decks. */
export class Occluders {
  /** A grid of cells holding the prisms over them and the highest top among those. */
  private readonly originX: number = 0;
  private readonly originY: number = 0;
  private readonly cols: number = 0;
  private readonly rows: number = 0;
  private readonly cells: number[][] = [];
  private readonly cellTop: Float64Array = new Float64Array(0);
  private readonly seen: Uint32Array;
  private stamp = 0;
  private readonly crossings: number[] = [];
  /** The highest top: a sight line above it meets nothing. */
  private readonly top: number;

  constructor(private readonly prisms: readonly Prism[]) {
    this.seen = new Uint32Array(prisms.length);
    this.top = prisms.reduce((top, p) => Math.max(top, p.top), -Infinity);
    if (!prisms.length) return;
    const boxes = prisms.map((prism) => {
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const ring of prism.rings)
        for (const p of ring) {
          box[0] = Math.min(box[0]!, p.x);
          box[1] = Math.min(box[1]!, p.y);
          box[2] = Math.max(box[2]!, p.x);
          box[3] = Math.max(box[3]!, p.y);
        }
      return box as [number, number, number, number];
    });
    this.originX = Math.min(...boxes.map((b) => b[0]));
    this.originY = Math.min(...boxes.map((b) => b[1]));
    this.cols = Math.floor((Math.max(...boxes.map((b) => b[2])) - this.originX) / cellM) + 1;
    this.rows = Math.floor((Math.max(...boxes.map((b) => b[3])) - this.originY) / cellM) + 1;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.cellTop = new Float64Array(this.cols * this.rows).fill(-Infinity);
    boxes.forEach(([minX, minY, maxX, maxY], i) => {
      for (let cy = this.row(minY); cy <= this.row(maxY); cy++)
        for (let cx = this.col(minX); cx <= this.col(maxX); cx++) {
          const k = cy * this.cols + cx;
          this.cells[k]!.push(i);
          this.cellTop[k] = Math.max(this.cellTop[k]!, prisms[i]!.top);
        }
    });
  }

  private col(x: number) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.originX) / cellM)));
  }
  private row(y: number) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.originY) / cellM)));
  }

  /** Whether the sight line from `eye` to (x, y) at height h passes through a prism. With `own`,
   * prisms whose outline holds (x, y) do not count: a place inside a building is seen where its
   * building is. The line walks the grid from the camera, skipping cells it passes above. */
  blocked(eye: Spot, x: number, y: number, h: number, own = false) {
    if (!this.prisms.length) return false;
    // Only the part of the line below the highest top can meet a prism.
    let t0 = 0,
      t1 = 1;
    if (eye.h > this.top) {
      if (h >= this.top) return false;
      t0 = (eye.h - this.top) / (eye.h - h);
    }
    let dx = x - eye.x;
    const dy = y - eye.y;
    // Straight down: any horizontal direction finds the outlines around the point.
    if (dx === 0 && dy === 0) dx = 1e-9;
    // Within the grid.
    const maxX = this.originX + this.cols * cellM,
      maxY = this.originY + this.rows * cellM;
    if (dx !== 0) {
      const a = (this.originX - eye.x) / dx,
        b = (maxX - eye.x) / dx;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    } else if (eye.x < this.originX || eye.x > maxX) return false;
    if (dy !== 0) {
      const a = (this.originY - eye.y) / dy,
        b = (maxY - eye.y) / dy;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    } else if (eye.y < this.originY || eye.y > maxY) return false;
    if (t0 >= t1) return false;
    const dh = h - eye.h;
    let cx = this.col(eye.x + dx * t0),
      cy = this.row(eye.y + dy * t0);
    const stepX = dx > 0 ? 1 : -1,
      stepY = dy > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : cellM / Math.abs(dx),
      tdy = dy === 0 ? Infinity : cellM / Math.abs(dy);
    let tx = dx === 0 ? Infinity : (this.originX + (cx + (dx > 0 ? 1 : 0)) * cellM - eye.x) / dx,
      ty = dy === 0 ? Infinity : (this.originY + (cy + (dy > 0 ? 1 : 0)) * cellM - eye.y) / dy;
    let enter = t0;
    const stamp = ++this.stamp;
    for (;;) {
      const exit = Math.min(tx, ty, t1),
        k = cy * this.cols + cx;
      if (Math.min(eye.h + dh * enter, eye.h + dh * exit) <= this.cellTop[k]!)
        for (const i of this.cells[k]!) {
          if (this.seen[i] === stamp) continue;
          this.seen[i] = stamp;
          if (this.meets(this.prisms[i]!, eye, dx, dy, dh, t0, own)) return true;
        }
      if (exit >= t1) return false;
      if (tx < ty) {
        cx += stepX;
        enter = tx;
        tx += tdx;
      } else {
        cy += stepY;
        enter = ty;
        ty += tdy;
      }
      if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return false;
    }
  }

  /** Whether eye + t (dx, dy, dh), t0 <= t <= 1, passes through `prism`. */
  private meets(
    prism: Prism,
    eye: Spot,
    dx: number,
    dy: number,
    dh: number,
    t0: number,
    own: boolean,
  ) {
    // Where the whole line crosses the outline; it is inside between alternate crossings.
    const ts = this.crossings;
    ts.length = 0;
    for (const ring of prism.rings)
      for (let i = 0; i + 1 < ring.length; i++) {
        const c = ring[i]!,
          d = ring[i + 1]!;
        const fx = d.x - c.x,
          fy = d.y - c.y;
        const den = dx * fy - dy * fx;
        if (den === 0) continue;
        const cx = c.x - eye.x,
          cy = c.y - eye.y;
        const s = (cx * dy - cy * dx) / den;
        if (s >= 0 && s < 1) ts.push((cx * fy - cy * fx) / den);
      }
    ts.sort((a, b) => a - b);
    if (own)
      for (let k = 0; k + 1 < ts.length; k += 2) if (ts[k]! <= 1 && ts[k + 1]! >= 1) return false;
    for (let k = 0; k + 1 < ts.length; k += 2) {
      const u = Math.max(t0, ts[k]!),
        v = Math.min(1, ts[k + 1]!);
      if (u >= v) continue;
      const hu = eye.h + dh * u,
        hv = eye.h + dh * v;
      if (Math.max(hu, hv) >= prism.bottom && Math.min(hu, hv) <= prism.top) return true;
    }
    return false;
  }
}

/** The buildings as drawn (TASK-109's walls from the minimum height to the top, on the lowest
 * ground under them). */
export function buildingPrisms(
  features: readonly ContextFeature[],
  terrain: ReturnType<typeof cityHeights>['terrain'],
  walk?: WalkGraph,
): Prism[] {
  const prisms: Prism[] = [];
  for (const f of features) {
    if (f.kind !== 'area' || f.class !== 'building') continue;
    const base = terrain.grid ? lowestGround(f.rings, terrain, true) : 0;
    for (const piece of buildingPieces(f)) {
      const minimum = piece.minHeightM ?? (piece.sub === 'roof' ? 3 : 0);
      const height =
        piece.sub === 'roof'
          ? Math.max(piece.heightM ?? 0, minimum + 0.2)
          : isElevator(piece)
            ? elevatorTopM(piece, elevatorLandings(piece.rings, walk))
            : (piece.heightM ?? (piece.levels === undefined ? 10 : piece.levels * 3));
      prisms.push({ rings: piece.rings, bottom: base + minimum, top: base + height });
    }
  }
  return prisms;
}

/** Road decks and raised junctions with their 0.8 m slab, where they stand clear of the ground. */
export function deckPrisms(city: CompiledCity, heights: ReturnType<typeof cityHeights>): Prism[] {
  const prisms: Prism[] = [];
  const mix = (a: Vec2, b: Vec2, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  for (const road of city.roads) {
    const height = heights.roads[road.idx]!;
    if (Math.max(height.fromM, height.toM, height.deckM) < deckMinM) continue;
    const count = road.surface.length / 2;
    for (let i = 1; i < count; i++) {
      const s0 = road.stations[i - 1]! - road.stations[0]!,
        s1 = road.stations[i]! - road.stations[0]!;
      const steps = Math.max(1, Math.ceil((s1 - s0) / deckPieceM));
      const left0 = road.surface[i - 1]!,
        left1 = road.surface[i]!,
        right0 = road.surface[2 * count - i]!,
        right1 = road.surface[2 * count - i - 1]!;
      for (let j = 0; j < steps; j++) {
        const a = s0 + ((s1 - s0) * j) / steps,
          b = s0 + ((s1 - s0) * (j + 1)) / steps;
        if (Math.max(profileHeightAt(height, a), profileHeightAt(height, b)) < deckMinM) continue;
        const za = heightAt(height, a),
          zb = heightAt(height, b);
        const p = mix(left0, left1, j / steps),
          q = mix(left0, left1, (j + 1) / steps),
          r = mix(right0, right1, (j + 1) / steps),
          t = mix(right0, right1, j / steps);
        prisms.push({
          rings: [[p, q, r, t, p]],
          bottom: Math.min(za, zb) - 0.8,
          top: Math.max(za, zb),
        });
      }
    }
  }
  for (const node of city.nodes) {
    const z = heights.nodes[node.idx]!;
    if (node.outline.length < 3 || z - heights.terrain.groundAt(node.pos.x, node.pos.y) < deckMinM)
      continue;
    prisms.push({ rings: [[...node.outline, node.outline[0]!]], bottom: z - 0.8, top: z });
  }
  return prisms;
}

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

/** A street glyph's road point, the road points its reading direction runs between there
 * (`placeLabels`' tangent chord), and the point's view depth when placed. */
export interface GlyphPath {
  at: Spot;
  back: Spot;
  ahead: Spot;
  depth: number;
}

/** A label placed on screen (`label`, in pixels), the world point it hangs from, and each glyph's
 * offset from that point's projection. */
export interface Placed3D {
  label: PlacedLabel;
  anchor: Spot;
  offsets: Vec2[];
  /** Whether the anchor was inside the view when placed. */
  inView: boolean;
  /** A street label's glyphs along the road as placed, and as they would read the other way
   * round. */
  along?: { placed: GlyphPath[]; flipped: GlyphPath[] };
}

/** Projects world points for one camera to screen pixels and view depth. */
class Projector {
  private readonly m: number[];
  readonly focal: number;
  readonly near: number;
  readonly eye: Spot;
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
    const e = camera.matrixWorld.elements;
    this.eye = { x: e[12]!, y: e[14]!, h: e[13]! };
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

/** The stretches of a street line in front of the camera, near the view and not hidden from it,
 * on screen. A segment's width is the carriageway's at the map scale of its depth, as the flat map
 * would show it at that scale: a pitched view does not narrow it, since the text faces the
 * camera. */
function projectLine(samples: LineSamples, p: Projector, hidden: Occluders[]): Run[] {
  const runs: Run[] = [];
  let run = null as Run | null;
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
  type Point = Spot & { s: number };
  const sample = (k: number): Point => ({
    x: samples.x[k]!,
    y: samples.y[k]!,
    h: samples.h[k]!,
    s: samples.s[k]!,
  });
  const seen = (q: Point) => !hidden.some((o) => o.blocked(p.eye, q.x, q.y, q.h + clearM));
  const screen = (q: Point) => (p.project(q.x, q.y, q.h), { x: p.sx, y: p.sy });
  /** TASK-195: where a stretch starts or ends between a seen point and a hidden one, the seen
   * point within `edgePx` on screen of the edge, so a stretch reaches as far as the road shows. */
  const edge = (from: Point, to: Point) => {
    for (;;) {
      const a = screen(from),
        b = screen(to);
      if (Math.hypot(a.x - b.x, a.y - b.y) < edgePx) return from;
      const mid = {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        h: (from.h + to.h) / 2,
        s: (from.s + to.s) / 2,
      };
      if (!p.project(mid.x, mid.y, mid.h)) return from;
      if (seen(mid)) from = mid;
      else to = mid;
    }
  };
  const push = (q: Point, widthM: number) => {
    p.project(q.x, q.y, q.h);
    const last = run?.line.at(-1);
    if (last && Math.hypot(p.sx - last.x, p.sy - last.y) < 0.05) return;
    run ??= { line: [], lengths: new Float64Array(0), widths: [], s: [], depth: [], world: [] };
    run.line.push({ x: p.sx, y: p.sy });
    run.widths.push(widthM);
    run.s.push(q.s);
    run.depth.push(p.depth);
    run.world.push({ x: q.x, y: q.y, h: q.h });
  };
  // The last sample tested for occlusion and whether it was seen: samples closer than `testPx`
  // to a seen one on screen go with it, and the vertices of the run up to it.
  let tested: { point: Point; at: Vec2; seen: boolean; vertices: number } | null = null;
  for (let k = 0; k < samples.x.length; k++) {
    const q = sample(k);
    if (!p.project(q.x, q.y, q.h)) {
      finish();
      tested = null;
      continue;
    }
    const at = { x: p.sx, y: p.sy };
    if (run && tested?.seen && Math.hypot(at.x - tested.at.x, at.y - tested.at.y) < testPx) {
      push(q, samples.widthM[k]!);
      continue;
    }
    const visible = seen(q);
    if (!visible && run && tested?.seen) {
      // Back to the last tested sample, then on to the edge.
      run.line.length = run.widths.length = run.s.length = run.depth.length = tested.vertices;
      run.world.length = tested.vertices;
      push(edge(tested.point, q), samples.widthM[k]!);
      finish();
    } else if (visible && !run && tested && !tested.seen)
      push(edge(q, tested.point), samples.widthM[k - 1]!);
    if (visible) push(q, samples.widthM[k]!);
    tested = { point: q, at, seen: visible, vertices: run?.line.length ?? 0 };
  }
  finish();
  return runs;
}

/** Index i with s[i] <= v <= s[i + 1], for an ascending s. */
function bracket(s: ArrayLike<number>, v: number) {
  let lo = 0,
    hi = s.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The run segment `along` pixels along a run's screen line, and how far along it in the world
 * (perspective-correct). */
function segmentAt(run: Run, along: number) {
  const L = run.lengths;
  const v = Math.min(L.at(-1)!, Math.max(0, along));
  const i = bracket(L, v);
  const t = (v - L[i]!) / (L[i + 1]! - L[i]!);
  const w0 = run.depth[i]!,
    w1 = run.depth[i + 1]!;
  return { i, u: (t * w0) / ((1 - t) * w1 + t * w0) };
}

/** The world point `along` pixels along a run's screen line. */
function worldAt(run: Run, along: number): Spot {
  const { i, u } = segmentAt(run, along);
  const a = run.world[i]!,
    b = run.world[i + 1]!;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, h: a.h + (b.h - a.h) * u };
}

/** The view depth and the distance along the street line `along` pixels along a run. */
function depthAt(run: Run, along: number) {
  const { i, u } = segmentAt(run, along);
  return {
    depth: run.depth[i]! + (run.depth[i + 1]! - run.depth[i]!) * u,
    s: run.s[i]! + (run.s[i + 1]! - run.s[i]!) * u,
  };
}

/** The longest part of a run inside the view, in pixels along it. */
function partInView(run: Run, width: number, height: number): [number, number] | null {
  let best: [number, number] | null = null;
  let part: [number, number] | null = null;
  const close = () => {
    if (part && (!best || part[1] - part[0] > best[1] - best[0])) best = part;
    part = null;
  };
  for (let i = 0; i + 1 < run.line.length; i++) {
    const a = run.line[i]!,
      b = run.line[i + 1]!;
    // Liang-Barsky: the segment's parameters inside the view rectangle.
    let t0 = 0,
      t1 = 1;
    for (const [d, q] of [
      [a.x - b.x, a.x],
      [b.x - a.x, width - a.x],
      [a.y - b.y, a.y],
      [b.y - a.y, height - a.y],
    ] as const) {
      if (d === 0) {
        if (q < 0) t1 = -1;
      } else if (d < 0) t0 = Math.max(t0, q / d);
      else t1 = Math.min(t1, q / d);
    }
    if (t0 >= t1) {
      close();
      continue;
    }
    const L0 = run.lengths[i]!,
      length = run.lengths[i + 1]! - L0;
    if (!part || t0 > 0) {
      close();
      part = [L0 + t0 * length, L0 + t1 * length];
    } else part[1] = L0 + t1 * length;
    if (t1 < 1) close();
  }
  close();
  return best;
}

/** TASK-195: the open ground of a label's own area nearest its point that the camera sees, tried
 * on a grid of at most about `spotCount` points. */
function visibleSpot(
  ring: readonly Vec2[],
  from: Vec2,
  p: Projector,
  hidden: Occluders[],
  pointHeight: (p: Vec2) => number,
): Spot | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const q of ring) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  const step = Math.max(spotM, Math.sqrt(((maxX - minX) * (maxY - minY)) / spotCount));
  const inside = preparePolygon(ring);
  const spots: Vec2[] = [];
  for (let x = minX + step / 2; x < maxX; x += step)
    for (let y = minY + step / 2; y < maxY; y += step) if (inside({ x, y })) spots.push({ x, y });
  spots.sort(
    (a, b) =>
      Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y) ||
      a.x - b.x ||
      a.y - b.y,
  );
  for (const { x, y } of spots) {
    const h = pointHeight({ x, y });
    // Not inside a building, unlike a label's own point: no name comes back on a roof.
    if (p.project(x, y, h) && !hidden.some((o) => o.blocked(p.eye, x, y, h))) return { x, y, h };
  }
  return null;
}

/** TASK-195: the area of each station, stop and place label that has one (its place's outline,
 * its platform's or island's ring), closed. A candidate's key ends in its place's or stop's id. */
export function pointAreas(
  city: CompiledCity,
  source: CityGeometry,
  candidates: readonly LabelCandidate[],
): Map<LabelCandidate, readonly Vec2[]> {
  const result = new Map<LabelCandidate, readonly Vec2[]>();
  const stops = new Map((city.rail?.tramStops ?? []).map((s) => [s.id, s]));
  const platforms = new Map((city.rail?.platforms ?? []).map((p) => [p.id, p]));
  for (const c of candidates) {
    if (c.kind === 'street') continue;
    const id = c.key.slice(c.key.lastIndexOf('/') + 1);
    let ring: readonly Vec2[] | undefined;
    if (c.kind === 'stop') {
      const platform = stops.get(id)?.platform;
      if (platform?.kind === 'generated') ring = platform.ring;
      else if (platform?.kind === 'mapped') {
        const shape = platforms.get(platform.platform)?.shape;
        if (shape?.kind === 'polygon') ring = shape.ring;
      }
    } else {
      const shape = source.places[id]?.shape;
      if (shape?.kind === 'polygon') ring = shape.ring;
    }
    if (!ring || ring.length < 3) continue;
    const first = ring[0]!,
      last = ring.at(-1)!;
    result.set(c, first.x === last.x && first.y === last.y ? ring : [...ring, first]);
  }
  return result;
}

/** Lays out `candidates` (in placement order) for the camera in `view`: TASK-167's rules on
 * screen, collision-free and deterministic for a camera. Nothing is placed where `hidden` hides
 * it from the camera.
 * TASK-195: when a street's name comes up (its first candidate), it is first tried on each
 * visible stretch of every line of that name, the stretch with the most road in view first: at
 * the street's own anchor nearest the middle of that part (else the middle itself), then against
 * either end of it. Where a stretch is too short for the name at its size, the name is tried
 * there at a smaller size, down to TASK-167's smallest, after every other label of its style. A
 * hidden point label moves to a visible point of its own area in `areas`, if it has one. */
export function placeLabels3D(
  candidates: readonly LabelCandidate[],
  lines: LabelLines,
  pointHeight: (p: Vec2) => number,
  view: LabelView,
  measure: Measure,
  hidden: Occluders[] = [],
  areas: ReadonlyMap<LabelCandidate, readonly Vec2[]> = new Map(),
): Placed3D[] {
  const p = new Projector(view);
  const runs = new Map<readonly Vec2[], Run[]>();
  const runOf = new Map<readonly Vec2[], Run>();
  const runsOf = (line: readonly Vec2[]) => {
    let list = runs.get(line);
    if (!list) {
      list = projectLine(lines.get(line)!, p, hidden);
      runs.set(line, list);
      for (const run of list) runOf.set(run.line, run);
    }
    return list;
  };
  const points = new Map<LabelCandidate, Vec2>();
  /** The pixels along a run and the map scale at `v` metres along its street line. */
  const at = (run: Run, v: number) => {
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
  /** A street candidate on a run, its anchor `along` pixels along it, at the text size of
   * `zoom`. */
  const onRun = (c: StreetCandidate, run: Run, along: number, zoom: number) => {
    // Junction surfaces on the visible stretch, in pixels along it.
    run.junctions ??= c.junctions
      .filter((j) => j.atM + j.radiusM >= run.s[0]! && j.atM - j.radiusM <= run.s.at(-1)!)
      .map((j) => {
        const a = at(run, Math.min(run.s.at(-1)!, Math.max(run.s[0]!, j.atM)));
        return { atM: a.along, radiusM: j.radiusM * a.zoom };
      });
    return {
      candidate: {
        ...c,
        line: run.line,
        lengths: run.lengths,
        widths: run.widths,
        junctions: run.junctions,
        anchorM: along,
      },
      zoom,
    };
  };

  // The lines of each street name, with their candidates.
  const streets = new Map<string, Map<readonly Vec2[], StreetCandidate[]>>();
  for (const c of candidates) {
    if (c.kind !== 'street') continue;
    const byLine = streets.get(c.text) ?? new Map<readonly Vec2[], StreetCandidate[]>();
    streets.set(c.text, byLine);
    const list = byLine.get(c.line) ?? [];
    byLine.set(c.line, list);
    list.push(c);
  }
  // The tries made for this camera (TASK-195), already on screen: copies of their streets' candidates.
  const framed = new Map<LabelCandidate, NonNullable<ReturnType<LabelFrame>>>();
  const extra = (c: StreetCandidate, run: Run, along: number, zoom?: number) => {
    const tried = { ...c };
    framed.set(tried, onRun(tried, run, along, zoom ?? p.focal / depthAt(run, along).depth));
    return tried;
  };
  const stretches = (name: string) => {
    const first: LabelCandidate[] = [];
    const smaller: LabelCandidate[] = [];
    const parts: { run: Run; part: [number, number]; list: StreetCandidate[] }[] = [];
    for (const [line, list] of streets.get(name)!) {
      for (const run of runsOf(line)) {
        const part = partInView(run, view.width, view.height);
        if (part) parts.push({ run, part, list });
      }
    }
    parts.sort((a, b) => b.part[1] - b.part[0] - (a.part[1] - a.part[0]));
    for (const { run, part, list } of parts) {
      const c = list[0]!;
      const m = measure(c.text, c.style);
      const length = run.lengths.at(-1)!;
      // Too short even at the smallest size.
      if (m.width > length) continue;
      const middle = (part[0] + part[1]) / 2;
      const { depth, s } = depthAt(run, middle);
      const zoom = p.focal / depth;
      const scale = labelScale(c.style, zoom);
      const text = m.width * scale;
      if (text > length) {
        // At the size whose zoom fits the name in the stretch, as TASK-167 grows names with zoom.
        const fit = Math.max(1, (0.99 * length) / m.width);
        smaller.push(extra(c, run, length / 2, 2 * fit ** (1 / 0.3)));
        continue;
      }
      // The street's own anchor nearest the middle, so a small move of the camera keeps it.
      let own: StreetCandidate | undefined;
      for (const o of list)
        if (
          o.anchorM >= run.s[0]! &&
          o.anchorM <= run.s.at(-1)! &&
          (!own || Math.abs(o.anchorM - s) < Math.abs(own.anchorM - s))
        )
          own = o;
      first.push(own ?? extra(c, run, middle));
      if (part[1] - part[0] > text)
        first.push(extra(c, run, part[0] + text / 2), extra(c, run, part[1] - text / 2));
    }
    return { first, smaller };
  };
  // Every candidate in order, each street name's tries before its first candidate, and its
  // smaller tries after the last candidate of its style.
  const order: LabelCandidate[] = [];
  const later = new Map<LabelStyle, LabelCandidate[]>();
  const named = new Set<string>();
  for (const c of candidates) {
    for (const [s, list] of later)
      if (s !== c.style) {
        order.push(...list);
        later.delete(s);
      }
    if (c.kind === 'street' && !named.has(c.text)) {
      named.add(c.text);
      const { first, smaller } = stretches(c.text);
      order.push(...first);
      if (smaller.length) later.set(c.style, [...(later.get(c.style) ?? []), ...smaller]);
    }
    order.push(c);
  }
  for (const list of later.values()) order.push(...list);

  const placed = placeLabels(order, 1, measure, (c) => {
    const ready = framed.get(c);
    if (ready) return ready;
    if (c.kind !== 'street') {
      let pos = c.pos;
      let h = pointHeight(pos);
      if (!p.project(pos.x, pos.y, h)) return null;
      if (hidden.some((o) => o.blocked(p.eye, pos.x, pos.y, h, true))) {
        const area = areas.get(c);
        const zoom = p.focal / p.depth;
        // Out of its zoom range it would not be placed anyway.
        const spot =
          area && zoom >= c.minZoom && zoom < c.maxZoom
            ? visibleSpot(area, pos, p, hidden, pointHeight)
            : null;
        if (!spot) return null;
        pos = { x: spot.x, y: spot.y };
        h = spot.h;
        p.project(pos.x, pos.y, h);
      }
      const framedPoint = { ...c, pos: { x: p.sx, y: p.sy } };
      points.set(framedPoint, pos);
      return { candidate: framedPoint, zoom: p.focal / p.depth };
    }
    const run = runsOf(c.line).find((r) => c.anchorM >= r.s[0]! && c.anchorM <= r.s.at(-1)!);
    if (!run) return null;
    const anchor = at(run, c.anchorM);
    return onRun(c, run, anchor.along, anchor.zoom);
  });
  const result = placed.map((label): Placed3D => {
    const c = label.candidate;
    let anchor: Spot;
    let along: Placed3D['along'];
    if (c.kind === 'street') {
      // Each glyph's road point, and the chord placeLabels turns it along (half its width or
      // half the text height either side), for this reading direction and the other one.
      const run = runOf.get(c.line)!;
      const m = measure(c.text, c.style);
      const s = label.glyphs.map((g) => nearestOnPolyline(run.line, g).along);
      const half = s.map((_, i) => (m.widths[i]! * label.scale) / 2);
      const reach = half.map((w) => Math.max(w, (m.height * label.scale) / 2));
      const reverse = s.at(-1)! < s[0]!;
      const ends =
        Math.min(...s.map((v, i) => v - half[i]!)) + Math.max(...s.map((v, i) => v + half[i]!));
      const path = (v: number, r: number, back: boolean): GlyphPath => {
        const at = worldAt(run, v);
        p.project(at.x, at.y, at.h);
        return {
          at,
          back: worldAt(run, back ? v + r : v - r),
          ahead: worldAt(run, back ? v - r : v + r),
          depth: p.depth,
        };
      };
      const glyphs = s.map((v, i) => path(v, reach[i]!, reverse));
      along = { placed: glyphs, flipped: s.map((v, i) => path(ends - v, reach[i]!, !reverse)) };
      anchor = glyphs[Math.floor(glyphs.length / 2)]!.at;
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
      ...(along && { along }),
    };
  });
  // Between tested samples a sliver of a stretch may be hidden: a glyph on one is dropped with its
  // label, so no placed glyph is hidden.
  return result.filter(
    ({ along }) =>
      !along?.placed.some(({ at }) =>
        hidden.some((o) => o.blocked(p.eye, at.x, at.y, at.h + clearM)),
      ),
  );
}

/** A glyph for a camera: its world point, screen position, rotation and size factor (0 where it
 * is behind the camera). */
export interface GlyphPose {
  at: Spot;
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

/** A placed street label's glyphs for another camera (TASK-192): each on its road point, turned
 * along the road on screen and sized for its distance, reading the other way round once the road
 * has turned past upright. At the placement camera this is the placement. */
export function glyphsOnScreen(placed: Placed3D, view: LabelView): GlyphPose[] {
  const p = new Projector(view);
  const { placed: glyphs, flipped } = placed.along!;
  const screen = (s: Spot) => (p.project(s.x, s.y, s.h), { x: p.sx, y: p.sy, w: p.depth });
  const start = screen(glyphs[0]!.back),
    end = screen(glyphs.at(-1)!.ahead);
  // A little past upright before flipping, so a road placed upright never flips in place.
  const flip =
    end.x - start.x < -0.1 * Math.hypot(end.x - start.x, end.y - start.y) &&
    start.w > p.near &&
    end.w > p.near;
  return (flip ? flipped : glyphs).map(({ at, back, ahead, depth }) => {
    const a = screen(back),
      b = screen(ahead),
      c = screen(at);
    const behind = Math.min(a.w, b.w, c.w) <= p.near;
    return {
      at,
      x: c.x,
      y: c.y,
      rotation: Math.atan2(b.y - a.y, b.x - a.x),
      scale: behind ? 0 : depth / c.w,
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
  private areas = new Map<LabelCandidate, readonly Vec2[]>();
  private visible = true;
  /** The camera's world matrix, field of view and viewport, as last seen. */
  private readonly viewKey = new Float64Array(19);
  private placedCurrent = false;
  private movedAt = 0;
  private stillFrames = 0;
  private placed: Placed3D[] = [];
  /** What hides labels: the buildings (while their layer shows) and the road decks. */
  private buildings = new Occluders([]);
  private decks = new Occluders([]);
  private buildingsShown = true;
  /** The drawn glyphs, in instance order, with their size on screen when placed. */
  private glyphs: { placed: Placed3D; i: number; width: number; height: number }[] = [];
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
    if (city !== this.city || source !== this.source) {
      this.candidates = labelCandidates(city, source);
      this.areas = pointAreas(city, source, this.candidates);
    }
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
    this.buildings = new Occluders(
      buildingPrisms(source.context?.features ?? [], heights.terrain, city.walk),
    );
    this.decks = new Occluders(deckPrisms(city, heights));
    this.placed = [];
    this.placedCurrent = false;
    this.fill();
  }

  /** Whether the buildings are drawn, and so hide labels; the next settled frame places again. */
  setBuildings(shown: boolean) {
    if (shown === this.buildingsShown) return;
    this.buildingsShown = shown;
    this.placedCurrent = false;
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

  /** Places the labels again once the camera has settled somewhere new; true when it did. While
   * the camera moves, street labels follow their roads. */
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
      this.pose(view);
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
      this.buildingsShown ? [this.buildings, this.decks] : [this.decks],
      this.areas,
    );
    this.fill(view);
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

  private fill(view?: LabelView) {
    const atlas = this.atlas;
    const glyphs: { placed: Placed3D; i: number; width: number; height: number }[] = [];
    for (const placed of this.placed)
      placed.label.glyphs.forEach((g, i) => {
        if (g.char.trim() !== '') glyphs.push({ placed, i, width: 0, height: 0 });
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
      const cell = attribute('cell'),
        ink = attribute('ink');
      glyphs.forEach((glyph, k) => {
        const { label } = glyph.placed;
        const c = cells[k]!;
        glyph.width = c.width * label.scale;
        glyph.height = c.height * label.scale;
        cell.setXYZW(
          k,
          c.x / atlas!.width,
          c.y / atlas!.height,
          (c.x + c.width) / atlas!.width,
          (c.y + c.height) / atlas!.height,
        );
        ink.setXY(k, inkIndex[labelInk[label.candidate.style]], label.alpha);
      });
      for (const a of [cell, ink]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, glyphs.length * a.itemSize);
        a.needsUpdate = true;
      }
    }
    this.glyphs = glyphs;
    if (view) this.pose(view);
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

  /** Each glyph's world point, rotation and size for the camera in `view`: point labels as
   * placed, street glyphs along their road (`glyphsOnScreen`). */
  private pose(view: LabelView) {
    if (!this.glyphs.length) return;
    const geometry = this.meshes[0]!.geometry;
    const anchor = geometry.getAttribute('anchor') as InstancedBufferAttribute,
      box = geometry.getAttribute('box') as InstancedBufferAttribute;
    let last: Placed3D | undefined, poses: GlyphPose[] | undefined;
    this.glyphs.forEach(({ placed, i, width, height }, k) => {
      if (!placed.along) {
        const a = placed.anchor;
        anchor.setXYZW(k, a.x, a.h, a.y, placed.label.glyphs[i]!.rotation);
        box.setXYZW(k, placed.offsets[i]!.x, placed.offsets[i]!.y, width, height);
        return;
      }
      if (placed !== last) poses = glyphsOnScreen((last = placed), view);
      const { at, rotation, scale } = poses![i]!;
      anchor.setXYZW(k, at.x, at.h, at.y, rotation);
      box.setXYZW(k, 0, 0, width * scale, height * scale);
    });
    for (const a of [anchor, box]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.glyphs.length * a.itemSize);
      a.needsUpdate = true;
    }
  }

  destroy() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.atlas?.texture.dispose();
  }
}
