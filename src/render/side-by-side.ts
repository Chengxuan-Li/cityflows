import Flatbush from 'flatbush';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import {
  cumulativeLengths,
  nearestOnPolyline,
  pointAtDistance,
  preparePolygon,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import type { CityGeometry } from './types';

/** Within this angle the two roads run side by side (B55, TASK-131 checkpoint 2: 30 degrees takes
 * in n:68's fire-station road, 26 degrees off the main road over the stretch they share). */
const SIDE_BY_SIDE_RAD = (30 * Math.PI) / 180;
/** Surfaces this close count as touching: a curb strip fits between them. */
const NEAR_M = 0.5;
/** Beside each other at least this far outside the junctions: shorter is a junction mouth, the
 * junction's business (an ordinary acute Y arm). */
const MIN_BESIDE_M = 1;
/** At most this much of the line inside a junction per metre beside it outside. */
const INSIDE_PER_BESIDE = 2;
const STEP_M = 1;
const COARSE_M = 8;
type Box = readonly [number, number, number, number];
/** The edge line's width: a narrow curb strip. */
export const SIDE_BY_SIDE_EDGE_M = 0.5;

export interface SideBySideEdge {
  roads: [number, number];
  /** Midway between the two OSM lines where both surfaces cover it or come within `NEAR_M` of it,
   * on into a junction both roads meet at until a movement surface covers it. */
  line: Vec2[];
  /** The pair's surface overlap, the line's length outside the junctions, and the angle between
   * the two roads' lines across it. */
  areaM2: number;
  besideM: number;
  angleDeg: number;
}

/** TASK-131 (B55): two different streets (named differently, or a street and a service road) on
 * one grade whose OSM lines run within 30 degrees of each other closer than their widths, for at
 * least `MIN_BESIDE_M` outside the junctions. Both keep their OSM lines; an edge line midway
 * between the lines draws them side by side (a narrow curb strip), on into a junction both meet
 * at as far as no movement crosses it (n:68: up to where the two merges meet). A junction group's
 * inner roads and a corridor's carriageways are left out. */
export function sideBySideEdges(city: CompiledCity, source?: CityGeometry): SideBySideEdge[] {
  if (!source?.roads) return [];
  const hit = cache.get(city);
  if (hit?.roads === source.roads) return hit.edges;
  const edges = measure(city, source, source.roads);
  cache.set(city, { roads: source.roads, edges });
  return edges;
}

/** Once per compiled city (and source roads): the 2D scene and the 3D street share it. */
const cache = new WeakMap<CompiledCity, { roads: object; edges: SideBySideEdge[] }>();

function measure(
  city: CompiledCity,
  source: CityGeometry,
  sourceRoads: NonNullable<CityGeometry['roads']>,
): SideBySideEdge[] {
  const name = (r: CRoad) => sourceRoads[r.id]?.name ?? null;
  const grade = (r: CRoad) =>
    sourceRoads[r.id]?.layer ?? source.nodes[sourceRoads[r.id]!.from]!.layer;
  const different = (a: CRoad, b: CRoad) =>
    (name(a) !== null && name(b) !== null && name(a) !== name(b)) ||
    (a.roadClass === 'service') !== (b.roadClass === 'service');
  const boxes = city.roads.map((r) => {
    const xs = r.surface.map((p) => p.x),
      ys = r.surface.map((p) => p.y);
    return [
      Math.min(...xs) - NEAR_M,
      Math.min(...ys) - NEAR_M,
      Math.max(...xs) + NEAR_M,
      Math.max(...ys) + NEAR_M,
    ] as const;
  });
  const covered = (node: number, p: Vec2) =>
    city.nodes[node]!.movements.some((i) => {
      const m = city.movements[i]!;
      const half = Math.min(city.lanes[m.fromLane]!.widthM, city.lanes[m.toLane]!.widthM) / 2;
      return m.polyline.length > 1 && nearestOnPolyline(m.polyline, p).away < half;
    });
  const roads = city.roads.filter(
    (r) => r.group === undefined && sourceRoads[r.id] && r.surface.length >= 3,
  );
  const index = new Flatbush(Math.max(1, roads.length));
  for (const r of roads) index.add(...boxes[r.idx]!);
  index.finish();
  // A road's surface width, about: a sample farther from the other road's line than both widths
  // cannot lie beside it.
  const width = city.roads.map((r) => r.lanes.reduce((sum, l) => sum + city.lanes[l]!.widthM, 0));
  // Each line in chunks of 16 segments with their boxes: the nearest point within `reach` looks
  // only at the chunks whose boxes come that close.
  const chunked = (line: Vec2[]) => {
    const out: { points: Vec2[]; box: Box }[] = [];
    for (let k = 0; k < line.length - 1; k += 16) {
      const points = line.slice(k, k + 17);
      const xs = points.map((p) => p.x),
        ys = points.map((p) => p.y);
      out.push({
        points,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      });
    }
    return out;
  };
  type Chunks = ReturnType<typeof chunked>;
  // Built on demand: most roads have no candidate.
  const referenceLengths: Float64Array[] = [];
  const lines: Chunks[] = [];
  const chunksOf = (road: number) => (lines[road] ??= chunked(city.roads[road]!.reference));
  const nearestWithin = (road: number, p: Vec2, reach: number, of?: Chunks[]) => {
    let best: { point: Vec2; away: number } | undefined;
    for (const { points, box } of of ? of[road]! : chunksOf(road)) {
      if (
        p.x < box[0] - reach ||
        p.x > box[2] + reach ||
        p.y < box[1] - reach ||
        p.y > box[3] + reach
      )
        continue;
      const hit = nearestOnPolyline(points, p);
      if (hit.away <= reach && (!best || hit.away < best.away)) best = hit;
    }
    return best?.point;
  };
  // Within `NEAR_M` of a road's surface: inside it, or near its boundary (both built on demand).
  const insides: ((p: Vec2) => boolean)[] = [];
  const outlines: ((p: Vec2) => boolean)[] = [];
  const boundaries: Chunks[] = [];
  const touches = (road: number, p: Vec2) => {
    const ring = [...city.roads[road]!.surface, city.roads[road]!.surface[0]!];
    insides[road] ??= preparePolygon(ring);
    boundaries[road] ??= chunked(ring);
    return insides[road](p) || nearestWithin(road, p, NEAR_M, boundaries) !== undefined;
  };
  const edges: SideBySideEdge[] = [];
  for (const a of roads) {
    for (const k of index.search(...boxes[a.idx]!)) {
      const b = roads[k]!;
      if (b.idx <= a.idx) continue;
      if (!different(a, b) || grade(a) !== grade(b)) continue;
      if (a.corridorId && a.corridorId === b.corridorId) continue;
      const shared = [a.from, a.to].filter((n) => n === b.from || n === b.to);
      const ends = [...new Set([a.from, a.to, b.from, b.to])].filter(
        (n) => city.nodes[n]!.outline.length,
      );
      const lengths = (referenceLengths[a.idx] ??= cumulativeLengths(a.reference));
      const total = lengths.at(-1)!;
      // Only a's segments within reach of one of b's are sampled (chunk boxes first, then the
      // segments in them); most candidate pairs have none.
      const gap = width[a.idx]! + width[b.idx]! + 2 * NEAR_M;
      const meets = (box: Box, o: Box) =>
        box[2] >= o[0] - gap &&
        box[0] <= o[2] + gap &&
        box[3] >= o[1] - gap &&
        box[1] <= o[3] + gap;
      const segmentBox = (line: Vec2[], k: number): Box => {
        const p = line[k]!,
          q = line[k + 1]!;
        return [Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y)];
      };
      const spans: [number, number][] = [];
      chunksOf(a.idx).forEach(({ box }, c) => {
        const near = chunksOf(b.idx)
          .map((o, d) => [o, d] as const)
          .filter(([o]) => meets(box, o.box));
        if (!near.length) return;
        for (let k = c * 16; k < Math.min((c + 1) * 16, a.reference.length - 1); k++) {
          const sa = segmentBox(a.reference, k);
          const hit = near.some(([o, d]) =>
            o.points.slice(0, -1).some((_, e) => meets(sa, segmentBox(b.reference, d * 16 + e))),
          );
          if (!hit) continue;
          const last = spans.at(-1);
          if (last && last[1] >= lengths[k]! - STEP_M) last[1] = lengths[k + 1]!;
          else spans.push([lengths[k]!, lengths[k + 1]!]);
        }
      });
      if (!spans.length) continue;
      type Sample = { m: Vec2; p: Vec2; q: Vec2; outside: boolean };
      const runs: Sample[][] = [];
      let run: Sample[] = [];
      const flush = () => {
        if (run.length >= 2) runs.push(run);
        run = [];
      };
      for (const [from, to] of spans) {
        const end = Math.min(total, to);
        for (let s = Math.floor(from); s <= end + 1e-6; s += STEP_M) {
          // A window of `COARSE_M` whose middle is farther than `gap` and half the window from b
          // has no sample within `gap`: skipped whole.
          if ((s - Math.floor(from)) % COARSE_M === 0) {
            const middle = pointAtDistance(a.reference, lengths, Math.min(s + COARSE_M / 2, end));
            if (!nearestWithin(b.idx, middle, gap + COARSE_M / 2)) {
              flush();
              s += COARSE_M - STEP_M;
              continue;
            }
          }
          const p = pointAtDistance(a.reference, lengths, Math.min(s, total));
          const q = nearestWithin(b.idx, p, gap);
          if (!q) {
            flush();
            continue;
          }
          const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          const junction = ends.find((n) =>
            (outlines[n] ??= preparePolygon(city.nodes[n]!.outline))(m),
          );
          const valid =
            junction === undefined
              ? touches(a.idx, m) && touches(b.idx, m)
              : shared.includes(junction) && !covered(junction, m);
          if (valid) run.push({ m, p, q, outside: junction === undefined });
          else flush();
        }
        flush();
      }
      for (const samples of runs) {
        const beside = samples.filter((x) => x.outside);
        let besideM = 0;
        for (let k = 1; k < samples.length; k++)
          if (samples[k]!.outside && samples[k - 1]!.outside)
            besideM += Math.hypot(
              samples[k]!.m.x - samples[k - 1]!.m.x,
              samples[k]!.m.y - samples[k - 1]!.m.y,
            );
        let lineM = 0;
        for (let k = 1; k < samples.length; k++)
          lineM += Math.hypot(
            samples[k]!.m.x - samples[k - 1]!.m.x,
            samples[k]!.m.y - samples[k - 1]!.m.y,
          );
        // Mostly inside the junction: an acute arm's mouth (Munich r:636 x r:933, 1 m beside).
        if (besideM < MIN_BESIDE_M || lineM - besideM > INSIDE_PER_BESIDE * besideM) continue;
        // Each road's direction beside the other: the chord of its line over the stretch.
        const chord = (points: Vec2[]) => {
          const p = points[0]!,
            q = points.at(-1)!;
          const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
          return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
        };
        const da = chord(beside.map((x) => x.p)),
          db = chord(beside.map((x) => x.q));
        const angle = Math.acos(Math.min(1, Math.abs(da.x * db.x + da.y * db.y)));
        if (angle > SIDE_BY_SIDE_RAD) continue;
        const overlap = booleanOpD(
          ClipType.Intersection,
          [a.surface],
          [b.surface],
          FillRule.NonZero,
          3,
        );
        edges.push({
          roads: [a.idx, b.idx],
          line: samples.map((x) => x.m),
          areaM2: overlap.reduce((sum, ring) => sum + Math.abs(areaD(ring)), 0),
          besideM,
          angleDeg: (angle * 180) / Math.PI,
        });
      }
    }
  }
  return edges;
}
