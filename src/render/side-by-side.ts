import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import {
  cumulativeLengths,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
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
  const sourceRoads = source.roads;
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
  const rings = city.roads.map((r) => [...r.surface, r.surface[0]!]);
  const away = (ring: Vec2[], p: Vec2) =>
    pointInPolygon(p, ring) ? 0 : nearestOnPolyline(ring, p).away;
  const covered = (node: number, p: Vec2) =>
    city.nodes[node]!.movements.some((i) => {
      const m = city.movements[i]!;
      const half = Math.min(city.lanes[m.fromLane]!.widthM, city.lanes[m.toLane]!.widthM) / 2;
      return m.polyline.length > 1 && nearestOnPolyline(m.polyline, p).away < half;
    });
  const order = city.roads
    .filter((r) => r.group === undefined && sourceRoads[r.id] && r.surface.length >= 3)
    .sort((a, b) => boxes[a.idx]![0] - boxes[b.idx]![0]);
  const edges: SideBySideEdge[] = [];
  for (let i = 0; i < order.length; i++) {
    const a = order[i]!;
    const [, ay0, ax1, ay1] = boxes[a.idx]!;
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]!;
      const [bx0, by0, bx1, by1] = boxes[b.idx]!;
      if (bx0 > ax1) break;
      if (by1 < ay0 || ay1 < by0) continue;
      if (!different(a, b) || grade(a) !== grade(b)) continue;
      if (a.corridorId && a.corridorId === b.corridorId) continue;
      const shared = [a.from, a.to].filter((n) => n === b.from || n === b.to);
      const ends = [...new Set([a.from, a.to, b.from, b.to])].filter(
        (n) => city.nodes[n]!.outline.length,
      );
      const lengths = cumulativeLengths(a.reference);
      const total = lengths.at(-1)!;
      type Sample = { m: Vec2; p: Vec2; q: Vec2; outside: boolean };
      const runs: Sample[][] = [];
      let run: Sample[] = [];
      const flush = () => {
        if (run.length >= 2) runs.push(run);
        run = [];
      };
      for (let s = 0; s <= total + 1e-6; s += STEP_M) {
        const p = pointAtDistance(a.reference, lengths, Math.min(s, total));
        if (p.x < bx0 - 10 || p.x > bx1 + 10 || p.y < by0 - 10 || p.y > by1 + 10) {
          flush();
          continue;
        }
        const q = nearestOnPolyline(b.reference, p).point;
        const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const junction = ends.find((n) => pointInPolygon(m, city.nodes[n]!.outline));
        const valid =
          junction === undefined
            ? away(rings[a.idx]!, m) <= NEAR_M && away(rings[b.idx]!, m) <= NEAR_M
            : shared.includes(junction) && !covered(junction, m);
        if (valid) run.push({ m, p, q, outside: junction === undefined });
        else flush();
      }
      flush();
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
