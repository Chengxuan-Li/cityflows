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

/** Within this angle the two roads run side by side (B55, TASK-131 checkpoint 2). */
const SIDE_BY_SIDE_RAD = (15 * Math.PI) / 180;
/** Surfaces overlapping by less than this are a junction mouth, not two roads side by side. */
const MIN_OVERLAP_M2 = 1;
const STEP_M = 1;
/** The edge line's width: a narrow curb strip. */
export const SIDE_BY_SIDE_EDGE_M = 0.5;

export interface SideBySideEdge {
  roads: [number, number];
  /** Midway between the two OSM lines where both surfaces cover it, outside the junctions. */
  line: Vec2[];
}

/** TASK-131 (B55): two different streets (named differently, or a street and a service road) on
 * one grade whose OSM lines run within 15 degrees of each other closer than their widths. Both
 * keep their OSM lines, so their surfaces overlap; an edge line midway between the lines draws
 * them side by side (a narrow curb strip). A junction group's inner roads and a corridor's
 * carriageways are left out. */
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
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
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
      const [bx0, by0, , by1] = boxes[b.idx]!;
      if (bx0 > ax1) break;
      if (by1 < ay0 || ay1 < by0) continue;
      if (!different(a, b) || grade(a) !== grade(b)) continue;
      if (a.corridorId && a.corridorId === b.corridorId) continue;
      const overlap = booleanOpD(
        ClipType.Intersection,
        [a.surface],
        [b.surface],
        FillRule.NonZero,
        3,
      );
      if (overlap.reduce((sum, ring) => sum + Math.abs(areaD(ring)), 0) < MIN_OVERLAP_M2) continue;
      const points = overlap.flat();
      // Each road's direction over the overlap: the chord of its line across the overlap's span.
      const span = (line: Vec2[]) => {
        const along = points.map((p) => nearestOnPolyline(line, p).along);
        return [Math.min(...along), Math.max(...along)] as const;
      };
      const chord = (line: Vec2[]) => {
        const [from, to] = span(line);
        const lengths = cumulativeLengths(line);
        const p = pointAtDistance(line, lengths, from),
          q = pointAtDistance(line, lengths, to);
        const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
      };
      const da = chord(a.reference),
        db = chord(b.reference);
      if (Math.acos(Math.min(1, Math.abs(da.x * db.x + da.y * db.y))) > SIDE_BY_SIDE_RAD) continue;
      const ringA = [...a.surface, a.surface[0]!],
        ringB = [...b.surface, b.surface[0]!];
      const outlines = [a.from, a.to, b.from, b.to]
        .map((n) => city.nodes[n]!.outline)
        .filter((o) => o.length);
      const lengths = cumulativeLengths(a.reference);
      const [from, to] = span(a.reference);
      let run: Vec2[] = [];
      const flush = () => {
        if (run.length >= 2) edges.push({ roads: [a.idx, b.idx], line: run });
        run = [];
      };
      for (let s = from; s <= to + 1e-6; s += STEP_M) {
        const p = pointAtDistance(a.reference, lengths, Math.min(s, to));
        const q = nearestOnPolyline(b.reference, p).point;
        const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const inside =
          pointInPolygon(m, ringA) &&
          pointInPolygon(m, ringB) &&
          !outlines.some((o) => pointInPolygon(m, o));
        if (inside) run.push(m);
        else flush();
      }
      flush();
    }
  }
  return edges;
}
