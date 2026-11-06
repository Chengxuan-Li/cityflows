import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { smoothstep, taperLength } from '../../network/lanes';
import type { City } from '../../schema';
import { JUNCTION_ZONE_M, resample, vertexNormals } from './relax';
import type { OsmRoad } from './roads';

/** Gap between the lane blocks of a separated coincident pair (owner, 2026-11-06). */
export const MEDIAN_M = 0.5;
const cosine30 = Math.cos(Math.PI / 6);
const SAMPLE_M = 1;

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const boxOf = (line: readonly Vec2[]): Box => ({
  minX: Math.min(...line.map((p) => p.x)),
  minY: Math.min(...line.map((p) => p.y)),
  maxX: Math.max(...line.map((p) => p.x)),
  maxY: Math.max(...line.map((p) => p.y)),
});
const near = (a: Box, b: Box, reach: number) =>
  a.minX - reach <= b.maxX &&
  b.minX - reach <= a.maxX &&
  a.minY - reach <= b.maxY &&
  b.minY - reach <= a.maxY;

/** How `a` runs beside `b` travelling the other way: samples every metre along `a` whose
 * nearest point on `b` lies within `b`'s ends and whose headings are within 30 degrees of
 * opposite; `within1` counts those closer than 1 m, `within25` the length closer than 25 m. */
function beside(a: readonly Vec2[], b: readonly Vec2[]) {
  const lengths = cumulativeLengths(a);
  const total = lengths.at(-1)!;
  const lengthB = cumulativeLengths(b).at(-1)!;
  let samples = 0,
    within1 = 0,
    within25 = 0;
  for (let s = SAMPLE_M / 2; s < total; s += SAMPLE_M) {
    samples++;
    const p = pointAtDistance(a, lengths, s);
    const ahead = pointAtDistance(a, lengths, Math.min(total, s + 0.5));
    const behind = pointAtDistance(a, lengths, Math.max(0, s - 0.5));
    const hx = ahead.x - behind.x,
      hy = ahead.y - behind.y;
    const nearest = nearestOnPolyline(b, p);
    if (nearest.along <= 0 || nearest.along >= lengthB) continue;
    const dot = (hx * nearest.direction.x + hy * nearest.direction.y) / (Math.hypot(hx, hy) || 1);
    if (dot > -cosine30) continue;
    if (nearest.away < 1) within1++;
    if (nearest.away < 25) within25 += SAMPLE_M;
  }
  return { samples, within1, within25 };
}

/**
 * `Road.corridorId` (architecture 4, TASK-084): the two directions of a two-way way keep their
 * street group; two opposite one-way roads of one grade whose centerlines lie within 1 m of each
 * other over at least 80 percent of the shorter one are a coincident pair; two opposite one-way
 * roads of one name and grade running within 30 degrees of opposite at under 25 m over at least
 * 50 m (both ways measured) are a dual carriageway. Each road joins at most one pair, the best
 * first. Pair ids are `corridor:` and the sorted way ids, with `/<n>` for a further section of
 * the same ways, as street groups are numbered. Returns the coincident pairs.
 */
export function assignCorridors(roads: OsmRoad[]): [OsmRoad, OsmRoad][] {
  for (const { road } of roads) road.corridorId = road.streetGroupId;
  const oneWay = roads.filter(({ road }) => road.streetGroupId === null);
  const boxes = new Map(oneWay.map((source) => [source, boxOf(source.road.centerline)]));
  const coincident: { pair: [OsmRoad, OsmRoad]; score: number }[] = [];
  const dual: { pair: [OsmRoad, OsmRoad]; score: number }[] = [];
  for (const [i, a] of oneWay.entries())
    for (const b of oneWay.slice(i + 1)) {
      if (a.layer !== b.layer || !near(boxes.get(a)!, boxes.get(b)!, 25)) continue;
      const ab = beside(a.road.centerline, b.road.centerline);
      const ba = beside(b.road.centerline, a.road.centerline);
      const shorter = ab.samples <= ba.samples ? ab : ba;
      const fraction = shorter.within1 / shorter.samples;
      if (fraction >= 0.8) coincident.push({ pair: [a, b], score: fraction });
      else if (
        a.road.name !== null &&
        a.road.name === b.road.name &&
        Math.min(ab.within25, ba.within25) >= 50
      )
        dual.push({ pair: [a, b], score: Math.min(ab.within25, ba.within25) });
    }
  const paired = new Set<OsmRoad>();
  const used = new Map<string, number>();
  const match = (candidates: typeof coincident) =>
    candidates
      .sort((x, y) => y.score - x.score)
      .flatMap(({ pair }) => {
        if (pair.some((source) => paired.has(source))) return [];
        for (const source of pair) paired.add(source);
        const ways = [...new Set(pair.flatMap(({ road }) => road.provenance.osmIds!))].sort(
          (x, y) => x - y,
        );
        const base = `corridor:${ways.join('+')}`;
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        for (const { road } of pair) road.corridorId = n === 0 ? base : `${base}/${n}`;
        return [pair];
      });
  const pairs = match(coincident);
  match(dual);
  return pairs;
}

/**
 * Separates each coincident pair into a divided pair with a `MEDIAN_M` median, each lane block
 * on its own side (right of travel under right-hand traffic). A pair that runs between the same
 * two nodes keeps one shared centerline (the first road's) and gets lateral offsets, as a two-way
 * street does, so the blocks stay apart up to the junctions. Otherwise each centerline moves
 * along its normals to the pair's mean middle line and aside where the pair is coincident, eased
 * in over the junction zone at a node and over the road's taper length where the pair parts.
 * Topology and ids are unchanged; provenance records `separated`.
 */
export function separateCoincident(city: City, pairs: [OsmRoad, OsmRoad][]): void {
  const side = city.drivingSide === 'right' ? 1 : -1;
  const shift = (road: OsmRoad['road']) =>
    road.lanes.reduce((w, lane) => w + lane.widthM, 0) / 2 + MEDIAN_M / 2;
  for (const [a, b] of pairs) {
    if (a.road.from === b.road.to && a.road.to === b.road.from) {
      b.road.centerline = [...a.road.centerline].reverse();
      for (const { road } of [a, b]) road.lateralOffsetM = side * shift(road);
    } else {
      const originals = [a.road.centerline, b.road.centerline];
      for (const [k, { road }] of [a, b].entries()) {
        const partner = originals[1 - k]!;
        const points = resample(originals[k]!);
        const normals = vertexNormals(points);
        const lengths = cumulativeLengths(points);
        const total = lengths.at(-1)!;
        const nearest = points.map((p) => nearestOnPolyline(partner, p));
        const run = points.flatMap((p, i) => {
          const { point: q, away } = nearest[i]!;
          // Half the partner's signed distance along the normal: toward the pair's middle line.
          const half = ((q.x - p.x) * normals[i]!.x + (q.y - p.y) * normals[i]!.y) / 2;
          return away < 1 ? [{ s: lengths[i]!, half }] : [];
        });
        const first = run[0]!.s,
          last = run.at(-1)!.s;
        const offset =
          side * shift(road) + run.reduce((sum, { half }) => sum + half, 0) / run.length;
        const taper = taperLength(road);
        road.centerline = points.map((p, i) => {
          const s = lengths[i]!;
          const weight =
            smoothstep(
              s < first ? 1 - (first - s) / taper : s > last ? 1 - (s - last) / taper : 1,
            ) * smoothstep(Math.min(s, total - s) / JUNCTION_ZONE_M);
          return {
            x: p.x + normals[i]!.x * weight * offset,
            y: p.y + normals[i]!.y * weight * offset,
          };
        });
      }
    }
    for (const { road } of [a, b])
      road.provenance = {
        ...road.provenance,
        inferred: [...road.provenance.inferred!, 'separated'],
      };
  }
}
