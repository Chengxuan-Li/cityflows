import {
  cumulativeLengths,
  deepInside,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  polylineLength,
  vertexNormals,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { platformRing, spine, type FurnitureBox } from './station-furniture';
import type { CityGeometry } from './types';

/** TASK-137: tram stop furniture, in metres. Everything stays `clearM` inside the island's edge. */
export const tramStopSize = {
  clearM: 0.25,
  /** The island's height above its grade in 3D, over the 0.17 m rail tops. */
  islandM: 0.25,
  shelter: { lengthM: 8, coveredM: 12, widthM: 1.6 },
  board: { length: 1.8, width: 0.3 },
  display: { length: 1.2, width: 0.3 },
  /** The marking across the track where the front of a tram stops. */
  mark: { length: 0.45, width: 2.6 },
  tactileWidthM: 0.4,
  /** The kerb-side strip's distance from the island's edge to its middle. */
  tactileInsetM: 0.55,
};

export interface TramMark extends FurnitureBox {
  /** The track runs in the road surface (it has no raised bed). */
  embedded: boolean;
}
export interface TramStopPlacement {
  stop: string;
  name: string;
  lines: string[];
  layer: number;
  mapped: boolean;
  /** The island polygon, closed; empty when the stop has no island. */
  ring: Vec2[];
  /** Which way across the island is its back, away from the tracks: +1 to the right of the
   * heading of its boxes, -1 to the left. */
  back: 1 | -1;
  /** The tactile strip along the kerb facing the track. */
  tactile: Vec2[] | null;
  shelters: FurnitureBox[];
  boards: FurnitureBox[];
  display: FurnitureBox | null;
  /** Where the name and lines are written at high zoom: clear of the shelter. */
  label: FurnitureBox | null;
  marks: TramMark[];
}

export const noTramStops = { stops: 0, islands: 0, shelters: 0, boards: 0, displays: 0, marks: 0 };
export function tramStopCounts(placements: readonly TramStopPlacement[]) {
  const sum = (pick: (p: TramStopPlacement) => number) =>
    placements.reduce((n, p) => n + pick(p), 0);
  return {
    stops: placements.length,
    islands: sum((p) => (p.ring.length ? 1 : 0)),
    shelters: sum((p) => p.shelters.length),
    boards: sum((p) => p.boards.length),
    displays: sum((p) => (p.display ? 1 : 0)),
    marks: sum((p) => p.marks.length),
  };
}

/** Placement is a pure function of the stops, their islands and the tram tracks they serve. */
export function placeTramStops(city: CompiledCity, source: CityGeometry): TramStopPlacement[] {
  const stops = Object.values(source.rail?.tramStops ?? {}).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (!city.rail || !stops.length) return [];
  const tracks = new Map(city.rail.tracks.map((t) => [t.id, t]));
  const platforms = new Map(city.rail.platforms.map((p) => [p.id, p]));
  const { clearM } = tramStopSize;
  return stops.map((stop) => {
    const ring =
      stop.platform?.kind === 'mapped'
        ? (platformRing(platforms.get(stop.platform.platform)!.shape) ?? [])
        : (stop.platform?.ring ?? []);
    const placement: TramStopPlacement = {
      stop: stop.id,
      name: stop.name,
      lines: stop.lines,
      layer: stop.layer,
      mapped: stop.platform?.kind === 'mapped',
      ring,
      back: 1,
      tactile: null,
      shelters: [],
      boards: [],
      display: null,
      label: null,
      marks: stop.halts.flatMap((h) => {
        const track = tracks.get(h.track);
        if (!track) return [];
        const { point, direction } = nearestOnPolyline(track.line, h.pos);
        return [
          {
            x: point.x,
            y: point.y,
            heading: Math.atan2(direction.y, direction.x),
            ...tramStopSize.mark,
            embedded: (track.form ?? 'embedded') === 'embedded',
          },
        ];
      }),
    };
    const s = ring.length ? spine(ring) : null;
    if (!s) return placement;
    const cumulative = cumulativeLengths(s.line),
      length = polylineLength(s.line);
    const halfAt = (a: number) => {
      let i = 1;
      while (i < cumulative.length - 1 && cumulative[i]! < a) i++;
      const f = Math.max(
        0,
        Math.min(1, (a - cumulative[i - 1]!) / (cumulative[i]! - cumulative[i - 1]!)),
      );
      return s.half[i - 1]! + (s.half[i]! - s.half[i - 1]!) * f;
    };
    const box = (a: number, lateral: number, boxLength: number, width: number): FurnitureBox => {
      const p = pointAtDistance(s.line, cumulative, a),
        heading = headingAtDistance(s.line, cumulative, a);
      return {
        x: p.x - Math.sin(heading) * lateral,
        y: p.y + Math.cos(heading) * lateral,
        heading,
        length: boxLength,
        width,
      };
    };
    const fits = (b: FurnitureBox) => {
      const c = Math.cos(b.heading),
        sn = Math.sin(b.heading);
      return [
        [0, 0],
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ].every(([i, j]) => {
        const dx = (i! * b.length) / 2,
          dy = (j! * b.width) / 2;
        return deepInside({ x: b.x + dx * c - dy * sn, y: b.y + dx * sn + dy * c }, ring, clearM);
      });
    };
    // The side of the island facing the tracks it serves; everything else stands at the back.
    const middle = pointAtDistance(s.line, cumulative, length / 2),
      normal = {
        x: -Math.sin(headingAtDistance(s.line, cumulative, length / 2)),
        y: Math.cos(headingAtDistance(s.line, cumulative, length / 2)),
      };
    const nearest = stop.tracks
      .map((id) => nearestOnPolyline(tracks.get(id)!.line, middle))
      .sort((a, b) => a.away - b.away)[0]!;
    const toTrack =
      (nearest.point.x - middle.x) * normal.x + (nearest.point.y - middle.y) * normal.y >= 0
        ? 1
        : -1;
    placement.back = toTrack === 1 ? -1 : 1;
    /** The box as far back as it fits: a mapped island's edges are rarely parallel to its axis. */
    const atBack = (a: number, boxLength: number, width: number) => {
      const furthest = Math.max(0, halfAt(a) - clearM - width / 2 - 0.03);
      for (let lateral = furthest; lateral > -0.01; lateral -= 0.1) {
        const b = box(a, placement.back * lateral, boxLength, width);
        if (fits(b)) return b;
      }
      return null;
    };

    // Tactile strip along the kerb facing the track.
    const normals = vertexNormals(s.line);
    const strip = s.line.flatMap((p, i) =>
      s.half[i]! >= 0.9
        ? [
            {
              x: p.x + toTrack * normals[i]!.x * (s.half[i]! - tramStopSize.tactileInsetM),
              y: p.y + toTrack * normals[i]!.y * (s.half[i]! - tramStopSize.tactileInsetM),
            },
          ]
        : [],
    );
    if (strip.length >= 2 && polylineLength(strip) >= 4) placement.tactile = strip;

    // A shelter at the middle unless the stop says it has none; a covered stop gets a longer one.
    let shelterA = 0,
      shelterLength = 0;
    if (stop.shelter !== false && length >= 8) {
      const full = Math.min(
        stop.covered ? tramStopSize.shelter.coveredM : tramStopSize.shelter.lengthM,
        length - 4,
      );
      // The longest bay, then the widest, that fits; a canopy leaves 0.9 m to walk past it.
      search: for (const size of [full, (full * 3) / 4, full / 2].filter((v) => v >= 3)) {
        const room = Math.min(
          halfAt(length / 2 - size / 2),
          halfAt(length / 2),
          halfAt(length / 2 + size / 2),
        );
        for (
          let width = Math.min(tramStopSize.shelter.widthM, 2 * room - 0.9 - clearM);
          width >= 0.8;
          width -= 0.1
        ) {
          const b = atBack(length / 2, size, width);
          if (!b) continue;
          placement.shelters.push(b);
          shelterA = length / 2;
          shelterLength = size;
          break search;
        }
      }
    }
    // Name boards at both ends.
    if (length >= 6)
      for (const a of [1.4, length - 1.4]) {
        const b = atBack(a, tramStopSize.board.length, tramStopSize.board.width);
        if (b) placement.boards.push(b);
      }
    // One display, next to the shelter.
    const half = tramStopSize.display.length / 2;
    for (const a of shelterLength
      ? [shelterA + shelterLength / 2 + half + 0.6, shelterA - shelterLength / 2 - half - 0.6]
      : [length * 0.7]) {
      if (a < half + 1 || a > length - half - 1) continue;
      const b = atBack(a, tramStopSize.display.length, tramStopSize.display.width);
      if (b) {
        placement.display = b;
        break;
      }
    }
    // The name and lines are written along the longest clear stretch, on the island's back half.
    const spans: [number, number][] = shelterLength
      ? [
          [0, shelterA - shelterLength / 2],
          [shelterA + shelterLength / 2, length],
        ]
      : [[0, length]];
    const clearSpans = spans.flatMap(([a0, a1]) => {
      const d = placement.display;
      if (!d) return [[a0, a1]];
      const at = nearestOnPolyline(s.line, d).along;
      const hole: [number, number] = [at - half - 1, at + half + 1];
      return [
        [a0, Math.min(a1, hole[0])],
        [Math.max(a0, hole[1]), a1],
      ].filter(([x, y]) => y! - x! > 0);
    });
    const [from, to] = clearSpans.sort((a, b) => b[1]! - b[0]! - (a[1]! - a[0]!))[0] ?? [0, 0];
    if (to! - from! >= 5) {
      // Behind the tactile strip: 1.1 m from the kerb facing the track.
      const a = (from! + to!) / 2,
        high = Math.min(2, 2 * halfAt(a) - 1.3);
      if (high >= 0.7)
        placement.label = box(
          a,
          placement.back * (halfAt(a) - 0.2 - high / 2),
          Math.min(to! - from! - 1, 14),
          high,
        );
    }
    return placement;
  });
}
