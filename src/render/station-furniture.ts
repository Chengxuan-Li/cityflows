import {
  cumulativeLengths,
  deepInside,
  headingAtDistance,
  offsetPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineLength,
} from '../geo/polyline';
import { createRandom } from '../geo/random';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import type { RailGraph } from '../network/rail';
import type { RailPlatform } from '../schema/rail';
import { platformDepartures, type TrainTimetable } from '../network/trains';
import type { CityGeometry } from './types';

/** An oriented rectangle: `length` runs along `heading`, `width` across it. Metres, local frame. */
export interface FurnitureBox {
  x: number;
  y: number;
  heading: number;
  length: number;
  width: number;
}
export interface PlatformFurniture {
  platform: string;
  station: string;
  name: string;
  ref?: string;
  layer: number;
  boards: FurnitureBox[];
  /** Canopy bays. `mapped` bays lie under a roof OSM maps over the platform: the 3D view
   * already draws that roof, so it adds only the posts. */
  shelters: { box: FurnitureBox; mapped: boolean }[];
  benches: FurnitureBox[];
  bins: FurnitureBox[];
  display: FurnitureBox | null;
}
export interface EntranceSign {
  station: string;
  name: string;
  x: number;
  y: number;
  layer: number;
  /** Direction the sign faces: away from the station. */
  facing: number;
}
export interface StationFurniture {
  platforms: PlatformFurniture[];
  entrances: EntranceSign[];
}

export const furnitureSize = {
  /** Furniture stays this far inside the platform edge. */
  clearM: 0.6,
  board: { length: 4.4, width: 0.9 },
  display: { length: 5.2, width: 2.4 },
  bench: { length: 1.7, width: 0.5 },
  bin: { length: 0.5, width: 0.5 },
  bayM: 12,
  shelterM: 10,
  shelterWidthM: 4.2,
  /** Spacing of boards and of bench/bin slots along a platform. */
  boardSpacingM: 40,
  slotSpacingM: 25,
};
const minCoveredM = 3;
const { clearM } = furnitureSize;

function hash32(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The platform's centreline and half width at each of its vertices, from slices across its
 * principal axis. The axis points east (or south) so placement never depends on ring order. */
export function spine(ring: readonly Vec2[]) {
  const pts = ring.slice(0, -1);
  const c = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const p of pts) {
    xx += (p.x - c.x) ** 2;
    xy += (p.x - c.x) * (p.y - c.y);
    yy += (p.y - c.y) ** 2;
  }
  const phi = 0.5 * Math.atan2(2 * xy, xx - yy);
  let u = { x: Math.cos(phi), y: Math.sin(phi) };
  if (u.x < -1e-9 || (Math.abs(u.x) <= 1e-9 && u.y < 0)) u = { x: -u.x, y: -u.y };
  const v = { x: -u.y, y: u.x };
  const along = pts.map((p) => (p.x - c.x) * u.x + (p.y - c.y) * u.y);
  const across = pts.map((p) => (p.x - c.x) * v.x + (p.y - c.y) * v.y);
  const s0 = Math.min(...along),
    s1 = Math.max(...along),
    n = Math.max(1, Math.ceil((s1 - s0) / 2));
  const line: Vec2[] = [],
    half: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = s0 + ((k + 0.5) * (s1 - s0)) / n,
      ts: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if ((along[i]! - s) * (along[j]! - s) < 0)
        ts.push(
          across[i]! + ((s - along[i]!) / (along[j]! - along[i]!)) * (across[j]! - across[i]!),
        );
    }
    ts.sort((a, b) => a - b);
    let best = [0, 0];
    for (let i = 0; i + 1 < ts.length; i += 2)
      if (ts[i + 1]! - ts[i]! > best[1]! - best[0]!) best = [ts[i]!, ts[i + 1]!];
    if (best[1]! - best[0]! <= 0) continue;
    const t = (best[0]! + best[1]!) / 2;
    line.push({ x: c.x + s * u.x + t * v.x, y: c.y + s * u.y + t * v.y });
    half.push((best[1]! - best[0]!) / 2);
  }
  return line.length >= 2 ? { line, half } : null;
}

export function platformRing(shape: RailPlatform['shape']): Vec2[] | null {
  if (shape.kind === 'polygon') return shape.ring;
  if (shape.kind === 'point') return null;
  // A mapped platform edge draws 2 m wide (rail-geometry).
  const left = offsetPolyline(shape.line, 1),
    right = offsetPolyline(shape.line, -1).reverse();
  return [...left, ...right, left[0]!];
}

/** Placement is a pure function of the platform shapes, the mapped roofs and the platform id. */
export function placeStationFurniture(city: CompiledCity, source: CityGeometry): StationFurniture {
  const result: StationFurniture = { platforms: [], entrances: [] };
  const rail = city.rail;
  if (!rail) return result;
  const roofs = (source.context?.features ?? []).flatMap((f) =>
    f.kind === 'area' && f.class === 'building' && (f.sub === 'roof' || f.sub === 'train_station')
      ? [f.rings]
      : [],
  );
  const stations = new Map<string, string>();
  for (const place of city.places) {
    const station = source.places[place.id]?.station;
    if (!station) continue;
    const name = source.places[place.id]!.name;
    stations.set(place.id, name);
    for (const id of station.entrances) {
      const node = city.walk.nodes[city.walk.sourceNodes.get(id) ?? -1];
      if (!node) continue;
      result.entrances.push({
        station: place.id,
        name,
        x: node.pos.x,
        y: node.pos.y,
        layer: node.layer,
        facing: Math.atan2(node.pos.y - place.centroid.y, node.pos.x - place.centroid.x),
      });
    }
  }
  for (const platform of rail.platforms) {
    if (platform.mode !== 'rail' || platform.station === null || !stations.has(platform.station))
      continue;
    const ring = platformRing(platform.shape);
    const s = ring && spine(ring);
    if (!ring || !s) continue;
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
      for (const [i, j] of [
        [0, 0],
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const dx = (i * b.length) / 2,
          dy = (j * b.width) / 2;
        if (!deepInside({ x: b.x + dx * c - dy * sn, y: b.y + dx * sn + dy * c }, ring, clearM))
          return false;
      }
      return true;
    };
    const keep = (b: FurnitureBox) => (fits(b) ? [b] : []);

    const boardAs =
      length < 8
        ? []
        : length < 14
          ? [length / 2]
          : (() => {
              const n = Math.max(1, Math.round((length - 8) / furnitureSize.boardSpacingM));
              return Array.from({ length: n + 1 }, (_, i) => 4 + (i * (length - 8)) / n);
            })();
    const boards = boardAs.flatMap((a) =>
      keep(box(a, 0, furnitureSize.board.length, furnitureSize.board.width)),
    );

    const covered: [number, number][] = [];
    const inRoof = (p: Vec2) =>
      roofs.some(([outer, ...holes]) => {
        const closed = (r: Vec2[]) => (r.at(-1) === r[0] ? r : [...r, r[0]!]);
        return (
          pointInPolygon(p, closed(outer!)) && !holes.some((h) => pointInPolygon(p, closed(h)))
        );
      });
    if (roofs.length) {
      let from: number | null = null;
      for (let a = 0; a <= length + 0.5; a += 0.5) {
        const on = a <= length && inRoof(pointAtDistance(s.line, cumulative, a));
        if (on && from === null) from = a;
        if (!on && from !== null) {
          if (a - 0.5 - from >= minCoveredM) covered.push([from, a - 0.5]);
          from = null;
        }
      }
    }
    const shelters: PlatformFurniture['shelters'] = [];
    const spans: [number, number][] = [];
    const bay = (a0: number, a1: number, mapped: boolean) => {
      const middle = (a0 + a1) / 2;
      let width = Math.min(
        furnitureSize.shelterWidthM,
        2 * (Math.min(halfAt(a0), halfAt(middle), halfAt(a1)) - clearM),
      );
      for (; width >= 1.2; width -= 0.2) {
        const b = box(middle, 0, a1 - a0, width);
        if (!fits(b)) continue;
        shelters.push({ box: b, mapped });
        spans.push([a0, a1]);
        return;
      }
    };
    for (const [a0, a1] of covered) {
      const n = Math.ceil((a1 - a0) / furnitureSize.bayM);
      for (let i = 0; i < n; i++)
        bay(a0 + ((a1 - a0) * i) / n, a0 + ((a1 - a0) * (i + 1)) / n, true);
    }
    if (!covered.length && length >= 6) {
      // No mapped roof: a short shelter at the middle, clear of the boards.
      const size = Math.min(furnitureSize.shelterM, length - 4);
      const clear = (a: number) => boardAs.every((b) => Math.abs(a - b) >= size / 2 + 2.2 + 0.5);
      let a = length / 2;
      for (let d = 1; !clear(a) && d <= length / 4; d++)
        a = length / 2 + (d % 2 ? (d + 1) / 2 : -d / 2);
      bay(a - size / 2, a + size / 2, false);
    }

    // One display, as near the middle as it can stand clear of boards and canopies.
    const halfDisplay = furnitureSize.display.length / 2;
    const free = (a: number, underCanopy: boolean) =>
      a >= halfDisplay + 1 &&
      a <= length - halfDisplay - 1 &&
      boardAs.every((b) => Math.abs(a - b) >= halfDisplay + furnitureSize.board.length / 2 + 0.5) &&
      (underCanopy ||
        spans.every(([a0, a1]) => a < a0 - halfDisplay - 1 || a > a1 + halfDisplay + 1));
    let display: FurnitureBox | null = null,
      displayA = 0;
    for (const underCanopy of [false, true])
      for (let d = 0; d <= length / 2 && !display; d += 1)
        for (const a of [length / 2 + d, length / 2 - d]) {
          if (display || !free(a, underCanopy)) continue;
          display =
            keep(box(a, 0, furnitureSize.display.length, furnitureSize.display.width))[0] ?? null;
          displayA = a;
        }

    // Benches and bins every 25 m, jittered by the platform's own seed.
    const rng = createRandom(hash32(platform.id));
    const benches: FurnitureBox[] = [],
      bins: FurnitureBox[] = [];
    for (
      let slot = furnitureSize.slotSpacingM / 2;
      slot <= length - 8;
      slot += furnitureSize.slotSpacingM
    ) {
      const a = slot + rng.uniform(-3, 3),
        side = rng.next() < 0.5 ? -1 : 1,
        paired = rng.next() < 0.6;
      const usable = halfAt(a) - clearM,
        lateral = Math.min(1.2, usable / 2);
      if (usable < 1) continue;
      const keepOff = (x: number, size: number) =>
        !display || Math.abs(x - displayA) >= halfDisplay + size / 2 + 0.5;
      if (keepOff(a, furnitureSize.bench.length))
        benches.push(
          ...keep(box(a, side * lateral, furnitureSize.bench.length, furnitureSize.bench.width)),
        );
      const binA = paired ? a + furnitureSize.bench.length / 2 + 0.9 : a;
      if (keepOff(binA, furnitureSize.bin.length))
        bins.push(
          ...keep(
            box(
              binA,
              (paired ? side : -side) * lateral,
              furnitureSize.bin.length,
              furnitureSize.bin.width,
            ),
          ),
        );
    }
    result.platforms.push({
      platform: platform.id,
      station: platform.station,
      name: stations.get(platform.station)!,
      ...(platform.ref ? { ref: platform.ref } : {}),
      layer: platform.layer,
      boards,
      shelters,
      benches,
      bins,
      display,
    });
  }
  return result;
}

export const noFurniture = {
  boards: 0,
  shelters: 0,
  benches: 0,
  bins: 0,
  displays: 0,
  entrances: 0,
};

export function furnitureCounts(furniture: StationFurniture) {
  const sum = (pick: (p: PlatformFurniture) => number) =>
    furniture.platforms.reduce((n, p) => n + pick(p), 0);
  return {
    boards: sum((p) => p.boards.length),
    shelters: sum((p) => p.shelters.length),
    benches: sum((p) => p.benches.length),
    bins: sum((p) => p.bins.length),
    displays: sum((p) => (p.display ? 1 : 0)),
    entrances: furniture.entrances.length,
  };
}

export const displayRowCount = 3;
export interface DepartureDisplay {
  header: string;
  /** Fixed-width rows: line, direction of travel, minutes to departure. */
  rows: string[];
}
const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const kindLabel = { sbahn: 'S-Bahn', mainline: 'Train' } as const;

/** What a platform's display shows at `timeS`: the next three departures from the timetable.
 * The timetable names no destinations, so rows give the direction the train leaves in. */
export function departureDisplay(
  rail: RailGraph,
  table: TrainTimetable,
  platform: string,
  timeS: number,
): DepartureDisplay {
  const ref = rail.platforms.find((p) => p.id === platform)?.ref;
  const rows = platformDepartures(rail, table, platform, timeS, displayRowCount).map((d) => {
    // North is -y in the local frame.
    const bearing = Math.atan2(Math.cos(d.heading), -Math.sin(d.heading));
    const to = compass[((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8]!;
    const when = d.arrivalS <= timeS ? 'now' : `${Math.ceil((d.departureS - timeS) / 60)} min`;
    return `${kindLabel[d.kind].padEnd(7)}${to.padEnd(3)}${when.padStart(6)}`;
  });
  while (rows.length < displayRowCount) rows.push('');
  return { header: ref ? `Platform ${ref.replaceAll(';', '/')}` : 'Departures', rows };
}
