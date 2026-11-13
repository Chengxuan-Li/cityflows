import { cumulativeLengths, distance, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { cityGrades } from './grades';
import type { CityGeometry } from './types';

/**
 * TASK-167: map labels. Candidates are built once per city; `placeLabels` lays them out for one
 * zoom over the whole city, so the result does not depend on where the camera looks and labels
 * do not jitter while panning. Text sizes are screen pixels; positions are world metres.
 */
export type LabelStyle = 'major' | 'minor' | 'station' | 'stop' | 'place' | 'area';
/** Font sizes in pixels. Street names grow with the map from 2 px/m, as (zoom / 2)^0.3, up to
 * `maxPx`: 11 to 16 px for minor streets, 12 to 17 px for major ones. */
export const labelFonts: Record<LabelStyle, { sizePx: number; maxPx: number; bold: boolean }> = {
  station: { sizePx: 13, maxPx: 13, bold: true },
  major: { sizePx: 12, maxPx: 17, bold: true },
  stop: { sizePx: 11, maxPx: 11, bold: false },
  place: { sizePx: 11, maxPx: 11, bold: true },
  minor: { sizePx: 11, maxPx: 16, bold: false },
  area: { sizePx: 11, maxPx: 11, bold: false },
};
/** The factor a style's text is drawn at, relative to `sizePx`, at `zoom`. */
export function labelScale(style: LabelStyle, zoom: number) {
  const { sizePx, maxPx } = labelFonts[style];
  return Math.min(maxPx / sizePx, Math.max(1, (zoom / 2) ** 0.3));
}

/** Glyph metrics of one text in one style, in pixels: each glyph's left edge and width. */
export interface TextMetrics {
  glyphs: string[];
  offsets: number[];
  widths: number[];
  width: number;
  height: number;
}
export type Measure = (text: string, style: LabelStyle) => TextMetrics;

interface Common {
  text: string;
  style: LabelStyle;
  /** Placement order: lower first. Ties are broken by `key`, so the order is total. */
  rank: number;
  key: string;
}
export interface StreetCandidate extends Common {
  kind: 'street';
  line: Vec2[];
  lengths: Float64Array;
  /** The carriageway width of each segment of `line`. */
  widths: number[];
  /** Junction surfaces on `line`, by distance along it. */
  junctions: { atM: number; radiusM: number }[];
  anchorM: number;
  /** 0 for the first label of a street; 1, 2, 3 for the repeats added at closer zooms. */
  level: number;
}
export interface PointCandidate extends Common {
  kind: 'station' | 'stop' | 'place';
  pos: Vec2;
  minZoom: number;
  maxZoom: number;
  /** For an unnamed place: the size of its outline, which the text must fit inside. */
  areaM?: { width: number; height: number };
}
export type LabelCandidate = StreetCandidate | PointCandidate;

export interface PlacedGlyph {
  char: string;
  x: number;
  y: number;
  rotation: number;
}
export interface PlacedLabel {
  candidate: LabelCandidate;
  /** Glyph centres in world metres; one horizontal run for point labels. */
  glyphs: PlacedGlyph[];
  alpha: number;
  /** The text's size relative to its style's `sizePx` (`labelScale`). */
  scale: number;
  /** World bounds of the label, for culling. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const labelRules = {
  /** A street is labelled at its middle and every 400 m from it; gaps fill from anchors at 200,
   * 100, 50 and 25 m (levels 1 to 4) where the labels of one street stay `repeat(zoom)` apart:
   * 300 m up to 2 px/m (450 px on screen at most), 600 px on screen closer in. Twin carriageways
   * get one label. */
  repeatM: 400,
  maxLevel: 4,
  repeat: (zoom: number) => Math.max(450 / zoom, Math.min(300, 600 / zoom)),
  /** A street label shows where the street is at least this many times the font size wide on
   * screen (about Arimo's cap height, 0.72 em); it fades in up to `fadeFit`. */
  minFit: 0.75,
  fadeFit: 1.05,
  /** Largest turn between neighbouring glyphs, and over a whole label (radians). */
  maxGlyphTurn: (24 * Math.PI) / 180,
  maxLabelTurn: (60 * Math.PI) / 180,
  /** Point labels of the same text and kind stay this far apart on screen (the platforms of
   * one stop). */
  sameTextPx: 260,
  /** Clear space around each glyph or label box, in pixels. */
  paddingPx: 2,
  /** Point labels fade in over this zoom factor above their minimum. */
  pointFade: 1.3,
  /** Pieces of one street join where their ends meet within this many metres and turn less. */
  joinM: 1.5,
  /** A street label moves up to this far along its street to clear a junction surface. */
  nudgeM: 25,
  joinTurn: Math.PI / 4,
};

const tiers = { station: 0, major: 1, stop: 2, place: 3, minor: 4, area: 5 } as const;

function polygonBox(ring: readonly Vec2[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
const mean = (points: readonly Vec2[]): Vec2 => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});
const angleOf = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

interface Piece {
  line: Vec2[];
  widthM: number;
  rank: number;
  idx: number;
  /** The junction radius at the start and end of `line`: 0 where no junction surface is. */
  junctions: [number, number];
}

/** Joins the pieces of one street end to end, straightest continuation first, in index order. */
function chains(pieces: Piece[]): Piece[][] {
  const used = new Set<Piece>();
  const result: Piece[][] = [];
  const extend = (chain: Piece[], forward: boolean) => {
    for (;;) {
      const edge = forward ? chain.at(-1)!.line : chain[0]!.line;
      const end = forward ? edge.at(-1)! : edge[0]!;
      const heading = forward ? angleOf(edge.at(-2)!, end) : angleOf(end, edge[1]!);
      let best: { piece: Piece; line: Vec2[]; turn: number } | undefined;
      for (const piece of pieces) {
        if (used.has(piece)) continue;
        for (const line of [piece.line, [...piece.line].reverse()]) {
          const start = forward ? line[0]! : line.at(-1)!;
          if (distance(start, end) > labelRules.joinM) continue;
          const next = forward ? angleOf(line[0]!, line[1]!) : angleOf(line.at(-2)!, line.at(-1)!);
          const t = turn(heading, next);
          if (t <= labelRules.joinTurn && (!best || t < best.turn)) best = { piece, line, turn: t };
        }
      }
      if (!best) return;
      used.add(best.piece);
      const flipped = best.line !== best.piece.line;
      const [a, b] = best.piece.junctions;
      const joined: Piece = {
        ...best.piece,
        line: best.line,
        junctions: flipped ? [b, a] : [a, b],
      };
      if (forward) chain.push(joined);
      else chain.unshift(joined);
    }
  };
  for (const piece of pieces) {
    if (used.has(piece)) continue;
    used.add(piece);
    const chain = [piece];
    extend(chain, true);
    extend(chain, false);
    result.push(chain);
  }
  return result;
}

function streetCandidates(city: CompiledCity, source: CityGeometry): StreetCandidate[] {
  const { roadGrades } = cityGrades(city, source);
  const junction = city.nodes.map((node) =>
    node.outline.length ? Math.max(...node.outline.map((p) => distance(p, node.pos))) : 0,
  );
  const width = (road: CompiledCity['roads'][number]) =>
    road.lanes.reduce((s, lane) => s + city.lanes[lane]!.widthM, 0);
  // A street's visual width is its corridor's: both directions of a two-way street, or both
  // carriageways of a divided one.
  const corridorWidth = new Map<string, number>();
  for (const road of city.roads)
    if (road.corridorId)
      corridorWidth.set(road.corridorId, (corridorWidth.get(road.corridorId) ?? 0) + width(road));
  const byName = new Map<string, Piece[]>();
  for (const road of city.roads) {
    const name = source.roads?.[road.id]?.name;
    if (!name || roadGrades[road.idx]! < 0) continue;
    const pieces = byName.get(name) ?? [];
    byName.set(name, pieces);
    // The two directions of a corridor drawn on one reference make one piece.
    const twin = pieces.some(
      (p) =>
        distance(p.line[0]!, road.reference.at(-1)!) < 0.01 &&
        distance(p.line.at(-1)!, road.reference[0]!) < 0.01,
    );
    if (twin) continue;
    pieces.push({
      line: road.reference,
      widthM: road.corridorId ? corridorWidth.get(road.corridorId)! : width(road),
      rank: road.classRank,
      idx: road.idx,
      junctions: [junction[road.from]!, junction[road.to]!],
    });
  }
  const result: StreetCandidate[] = [];
  for (const name of [...byName.keys()].sort()) {
    const pieces = byName.get(name)!;
    pieces.sort((a, b) => a.idx - b.idx);
    for (const chain of chains(pieces)) {
      const line: Vec2[] = [];
      const widths: number[] = [];
      const radii: number[] = [];
      for (const piece of chain) {
        radii.push(...piece.junctions);
        for (let i = 0; i < piece.line.length; i++) {
          const p = piece.line[i]!;
          if (line.length && distance(line.at(-1)!, p) < 1e-6) continue;
          if (line.length)
            widths.push(i === 0 ? Math.min(piece.widthM, widths.at(-1)!) : piece.widthM);
          line.push(p);
        }
      }
      if (line.length < 2) continue;
      const lengths = cumulativeLengths(line);
      const length = lengths.at(-1)!;
      // Junction surfaces along the chain, as distances along it: labels move off them.
      let along = 0;
      const junctions: { atM: number; radiusM: number }[] = [];
      chain.forEach((piece, i) => {
        if (radii[2 * i]) junctions.push({ atM: along, radiusM: radii[2 * i]! });
        along += cumulativeLengths(piece.line).at(-1)!;
        if (radii[2 * i + 1]) junctions.push({ atM: along, radiusM: radii[2 * i + 1]! });
      });
      const rank = Math.max(...chain.map((p) => p.rank));
      const style: LabelStyle = rank >= 5 ? 'major' : 'minor';
      const idx = Math.min(...chain.map((p) => p.idx));
      // Anchors at the middle, then every `repeatM` / 2^level from it; each keeps the level it
      // first appears at, so a repeat shown at one zoom stays at every closer zoom.
      const step = labelRules.repeatM / 2 ** labelRules.maxLevel;
      const count = Math.floor(length / 2 / step);
      for (let k = -count; k <= count; k++) {
        let level = labelRules.maxLevel;
        while (level > 0 && k % 2 ** (labelRules.maxLevel - level + 1) === 0) level--;
        result.push({
          kind: 'street',
          text: name,
          style,
          rank:
            tiers[style] * 1e6 + level * 1e4 + (8 - rank) * 1e3 + Math.max(0, 999 - length / 10),
          key: `${name}/${String(idx).padStart(6, '0')}/${String(k + 10000).padStart(5, '0')}`,
          line,
          lengths,
          widths,
          junctions,
          anchorM: length / 2 + k * step,
          level,
        });
      }
    }
  }
  return result;
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every label the city can show, in placement order. */
export function labelCandidates(city: CompiledCity, source: CityGeometry): LabelCandidate[] {
  const result: LabelCandidate[] = streetCandidates(city, source);
  for (const place of city.places) {
    const sourcePlace = source.places[place.id];
    if (!sourcePlace || place.kind === 'gateway') continue;
    // The importer names an untagged place by its kind or, for aggregated buildings, by their
    // use ("Homes", "Workplaces"): show those smaller, and only where the text fits the outline.
    const generic =
      sourcePlace.name.toLowerCase() === place.kind ||
      !!sourcePlace.provenance.inferred?.includes('blockAggregation');
    const station = place.kind === 'station';
    const style: LabelStyle = station ? 'station' : generic ? 'area' : 'place';
    const box = sourcePlace.shape.kind === 'polygon' ? polygonBox(sourcePlace.shape.ring) : null;
    result.push({
      kind: station ? 'station' : 'place',
      text: capitalised(sourcePlace.name),
      style,
      rank:
        tiers[style] * 1e6 -
        Math.min(1e5, box ? (box.maxX - box.minX) * (box.maxY - box.minY) : 0) / 10,
      key: `${sourcePlace.name}/${place.id}`,
      pos: place.centroid,
      minZoom: station ? 0.1 : generic ? (box ? 0.8 : 1.5) : 0.6,
      maxZoom: Infinity,
      ...(generic && box
        ? { areaM: { width: box.maxX - box.minX, height: box.maxY - box.minY } }
        : {}),
    });
  }
  const rail = city.rail;
  for (const stop of rail?.tramStops ?? []) {
    if (stop.layer < 0) continue;
    const platform =
      stop.platform?.kind === 'mapped'
        ? rail!.platforms.find((p) => p.id === (stop.platform as { platform: string }).platform)
        : undefined;
    const pos = platform
      ? platform.shape.kind === 'point'
        ? platform.shape.pos
        : mean(platform.shape.kind === 'polygon' ? platform.shape.ring : platform.shape.line)
      : stop.platform?.kind === 'generated'
        ? mean(stop.platform.ring)
        : stop.halts.length
          ? mean(stop.halts.map((h) => h.pos))
          : null;
    if (!pos) continue;
    result.push({
      kind: 'stop',
      text: stop.name,
      style: 'stop',
      rank: tiers.stop * 1e6,
      key: `${stop.name}/${stop.id}`,
      pos,
      // From 12 px/m the stop's own name boards take over (layers/tram-stops.ts).
      minZoom: 1.2,
      maxZoom: 12,
    });
  }
  return result.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Axis-aligned boxes in screen-scaled coordinates (world metres times zoom), hashed on a grid. */
class Occupancy {
  private cells = new Map<number, number[][]>();
  private static size = 48;
  private keys(box: number[]) {
    const s = Occupancy.size;
    const keys: number[] = [];
    for (let i = Math.floor(box[0]! / s); i <= Math.floor(box[2]! / s); i++)
      for (let j = Math.floor(box[1]! / s); j <= Math.floor(box[3]! / s); j++)
        keys.push(i * 1048576 + j);
    return keys;
  }
  free(box: number[]) {
    for (const key of this.keys(box))
      for (const other of this.cells.get(key) ?? [])
        if (
          box[0]! < other[2]! &&
          other[0]! < box[2]! &&
          box[1]! < other[3]! &&
          other[1]! < box[3]!
        )
          return false;
    return true;
  }
  add(box: number[]) {
    for (const key of this.keys(box)) {
      const list = this.cells.get(key);
      if (list) list.push(box);
      else this.cells.set(key, [box]);
    }
  }
}

function layoutStreet(c: StreetCandidate, m: TextMetrics, zoom: number, scale: number) {
  const length = c.lengths.at(-1)!;
  const textM = m.width / zoom;
  if (textM > length) return null;
  let s0 = Math.min(length - textM, Math.max(0, c.anchorM - textM / 2));
  // Off a junction surface: to the nearer side where the text clears every junction, if any.
  const clear = (a: number) =>
    a >= 0 &&
    a + textM <= length &&
    c.junctions.every((j) => a >= j.atM + j.radiusM || a + textM <= j.atM - j.radiusM);
  if (!clear(s0)) {
    const options = c.junctions
      .flatMap((j) => [j.atM + j.radiusM, j.atM - j.radiusM - textM])
      .filter(clear)
      .sort((a, b) => Math.abs(a - s0) - Math.abs(b - s0) || a - b);
    if (options.length && Math.abs(options[0]! - s0) <= labelRules.nudgeM) s0 = options[0]!;
  }
  const s1 = s0 + textM;
  // The street's width under the text, averaged by length: short narrow links at junctions do
  // not hide the name of a wide street.
  let area = 0;
  for (let i = 0; i < c.widths.length; i++)
    area +=
      Math.max(0, Math.min(s1, c.lengths[i + 1]!) - Math.max(s0, c.lengths[i]!)) * c.widths[i]!;
  const fit = ((area / textM) * zoom) / (labelFonts[c.style].sizePx * scale);
  if (fit < labelRules.minFit) return null;
  const at = (s: number) => pointAtDistance(c.line, c.lengths, s);
  // Upright: read along the line or against it, whichever runs left to right on screen.
  const reverse = Math.cos(angleOf(at(s0), at(s1))) < 0;
  const half = m.height / 2 / zoom;
  const glyphs: PlacedGlyph[] = [];
  let previous = NaN,
    low = Infinity,
    high = -Infinity;
  for (let i = 0; i < m.glyphs.length; i++) {
    const offset = (m.offsets[i]! + m.widths[i]! / 2) / zoom;
    const s = reverse ? s1 - offset : s0 + offset;
    // The tangent over a chord at least the text height long smooths the line's corners.
    const reach = Math.max(m.widths[i]! / 2 / zoom, half);
    const a = at(s - reach),
      b = at(s + reach);
    const rotation = angleOf(a, b) + (reverse ? Math.PI : 0);
    const r = Math.atan2(Math.sin(rotation), Math.cos(rotation));
    if (!Number.isNaN(previous) && turn(previous, r) > labelRules.maxGlyphTurn) return null;
    previous = r;
    const unwrapped = glyphs.length
      ? glyphs.at(-1)!.rotation +
        Math.atan2(Math.sin(r - glyphs.at(-1)!.rotation), Math.cos(r - glyphs.at(-1)!.rotation))
      : r;
    low = Math.min(low, unwrapped);
    high = Math.max(high, unwrapped);
    if (high - low > labelRules.maxLabelTurn) return null;
    const p = at(s);
    glyphs.push({ char: m.glyphs[i]!, x: p.x, y: p.y, rotation: unwrapped });
  }
  const alpha = Math.min(1, (fit - labelRules.minFit) / (labelRules.fadeFit - labelRules.minFit));
  return { glyphs, alpha };
}

/** Lays out `candidates` (in placement order) at `zoom`: collision-free and deterministic. */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  zoom: number,
  measure: Measure,
): PlacedLabel[] {
  const occupied = new Occupancy();
  const seen = new Map<string, Vec2[]>();
  const pad = labelRules.paddingPx;
  const placed: PlacedLabel[] = [];
  const same = (c: LabelCandidate, p: Vec2) =>
    (seen.get(`${c.kind}/${c.text}`) ?? []).some(
      (q) =>
        Math.hypot(q.x - p.x, q.y - p.y) * zoom <
        (c.kind === 'street' ? labelRules.repeat(zoom) * zoom : labelRules.sameTextPx),
    );
  for (const c of candidates) {
    if (
      c.kind === 'street'
        ? same(c, pointAtDistance(c.line, c.lengths, c.anchorM))
        : zoom < c.minZoom || zoom >= c.maxZoom
    )
      continue;
    const scale = labelScale(c.style, zoom);
    const base = measure(c.text, c.style);
    const m =
      scale === 1
        ? base
        : {
            ...base,
            offsets: base.offsets.map((o) => o * scale),
            widths: base.widths.map((w) => w * scale),
            width: base.width * scale,
            height: base.height * scale,
          };
    let glyphs: PlacedGlyph[];
    let alpha: number;
    let boxes: number[][];
    if (c.kind === 'street') {
      const layout = layoutStreet(c, m, zoom, scale);
      if (!layout) continue;
      ({ glyphs, alpha } = layout);
      boxes = glyphs.map((g, i) => {
        const a = m.widths[i]! / 2 + pad,
          b = m.height / 2 + pad;
        const cos = Math.abs(Math.cos(g.rotation)),
          sin = Math.abs(Math.sin(g.rotation));
        const hw = cos * a + sin * b,
          hh = sin * a + cos * b;
        return [g.x * zoom - hw, g.y * zoom - hh, g.x * zoom + hw, g.y * zoom + hh];
      });
    } else {
      if (
        c.areaM &&
        (m.width > c.areaM.width * zoom * 0.9 || m.height > c.areaM.height * zoom * 0.6)
      )
        continue;
      const left = c.pos.x - m.width / 2 / zoom;
      glyphs = m.glyphs.map((char, i) => ({
        char,
        x: left + (m.offsets[i]! + m.widths[i]! / 2) / zoom,
        y: c.pos.y,
        rotation: 0,
      }));
      alpha = Math.min(1, (zoom / c.minZoom - 1) / (labelRules.pointFade - 1));
      const x = c.pos.x * zoom,
        y = c.pos.y * zoom;
      boxes = [
        [
          x - m.width / 2 - pad,
          y - m.height / 2 - pad,
          x + m.width / 2 + pad,
          y + m.height / 2 + pad,
        ],
      ];
    }
    const centre = glyphs[Math.floor(glyphs.length / 2)]!;
    if (same(c, centre) || !boxes.every((box) => occupied.free(box))) continue;
    for (const box of boxes) occupied.add(box);
    const key = `${c.kind}/${c.text}`;
    seen.set(key, [...(seen.get(key) ?? []), { x: centre.x, y: centre.y }]);
    const bounds = boxes.reduce(
      (b, box) => ({
        minX: Math.min(b.minX, box[0]! / zoom),
        minY: Math.min(b.minY, box[1]! / zoom),
        maxX: Math.max(b.maxX, box[2]! / zoom),
        maxY: Math.max(b.maxY, box[3]! / zoom),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    placed.push({ candidate: c, glyphs, alpha, scale, bounds });
  }
  return placed;
}
