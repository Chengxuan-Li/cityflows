import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { CONVERGING, sameStreet, smoothstep, taperLength } from '../../network/lanes';
import type { City, Road } from '../../schema';
import { JUNCTION_ZONE_M, resample, vertexNormals } from './relax';
import type { OsmRoad } from './roads';

/** Gap between the lane blocks of a separated coincident pair (owner, 2026-11-06). */
export const MEDIAN_M = 0.5;
const cosine30 = Math.cos(Math.PI / 6);
const SAMPLE_M = 1;
const halfBlock = (road: Road) => road.lanes.reduce((w, lane) => w + lane.widthM, 0) / 2;

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
 * 50 m (both ways measured) are a dual carriageway. TASK-087: so are two unnamed ones of one class
 * and two ways between the same two nodes (Sindelfingen's `r:574`/`r:971`; two sections of one
 * way are a loop) when `separateDual` can push them apart (`pushable`); otherwise the
 * realignment keeps treating them as two arms. Each road joins at most one pair, the best first.
 * Pair ids are `corridor:` and the sorted way ids, with `/<n>` for a further section of the same
 * ways, as street groups are numbered. Returns the coincident pairs.
 */
export function assignCorridors(city: City, roads: OsmRoad[]): [OsmRoad, OsmRoad][] {
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
        (a.road.name !== null
          ? a.road.name === b.road.name
          : b.road.name === null &&
            a.road.roadClass === b.road.roadClass &&
            a.wayId !== b.wayId &&
            a.road.from === b.road.to &&
            a.road.to === b.road.from) &&
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
  const duals = match(dual);
  const unnamed = duals.filter(([a]) => a.road.name === null);
  const kept = pushable(city, roads, closePairs(roads));
  for (const pair of unnamed)
    if (!kept.has(pair[0].road)) for (const { road } of pair) road.corridorId = null;
  return pairs;
}

/**
 * Same-direction coincident pairs (TASK-087): two one-way roads of one name and grade from the
 * same node to the same node whose centerlines lie within 1 m of each other are one carriageway
 * drawn as two ways (Munich's Landsberger `r:729`/`r:984`, a 1 + 2 lane split of `r:978` that
 * meets again at the signal `n:1181`). They become one corridor on the first road's centerline
 * with their lane blocks side by side, so neither lies on the other (the shadowed end of the
 * TASK-074 rule) and the junction sees one approach. Left to right in road order, as TASK-071's
 * continuation orders two branches leaving a split at one heading. Returns the pairs.
 */
export function pairSameDirection(roads: OsmRoad[]): [OsmRoad, OsmRoad][] {
  const pairs: [OsmRoad, OsmRoad][] = [];
  const paired = new Set<OsmRoad>();
  const oneWay = roads.filter(({ road }) => road.streetGroupId === null && road.name !== null);
  for (const [i, a] of oneWay.entries())
    for (const b of oneWay.slice(i + 1)) {
      const [ra, rb] = [a.road, b.road];
      if (paired.has(a) || paired.has(b) || a.layer !== b.layer || ra.name !== rb.name) continue;
      if (ra.from !== rb.from || ra.to !== rb.to) continue;
      const close = (x: Vec2[], y: Vec2[]) =>
        resample(x, SAMPLE_M).every((p) => nearestOnPolyline(y, p).away < 1);
      if (!close(ra.centerline, rb.centerline) || !close(rb.centerline, ra.centerline)) continue;
      paired.add(a);
      paired.add(b);
      pairs.push([a, b]);
      const ways = [...new Set([ra, rb].flatMap((r) => r.provenance.osmIds!))].sort(
        (x, y) => x - y,
      );
      const total = halfBlock(ra) + halfBlock(rb);
      rb.centerline = [...ra.centerline];
      ra.lateralOffsetM = -total + halfBlock(ra);
      rb.lateralOffsetM = total - halfBlock(rb);
      for (const road of [ra, rb]) {
        road.corridorId = `corridor:${ways.join('+')}`;
        road.provenance = {
          ...road.provenance,
          inferred: [...road.provenance.inferred!, 'separated'],
        };
      }
    }
  return pairs;
}

/** The shared line of each same-direction pair sampled every metre, after smoothing and
 * relaxation: the facing edges of the two blocks then have vertices along their whole run,
 * where the renderer finds the seam between them (TASK-080). */
export function sampleSameDirection(pairs: [OsmRoad, OsmRoad][]): void {
  for (const [a, b] of pairs) {
    a.road.centerline = resample(a.road.centerline, SAMPLE_M);
    b.road.centerline = [...a.road.centerline];
  }
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

/** Dual-carriageway corridors of two zero-offset roads between the same two nodes. */
function closePairs(roads: OsmRoad[]): [OsmRoad, OsmRoad][] {
  const corridors = new Map<string, OsmRoad[]>();
  for (const source of roads) {
    const id = source.road.corridorId;
    if (id?.startsWith('corridor:')) corridors.set(id, [...(corridors.get(id) ?? []), source]);
  }
  return [...corridors.values()].filter(
    (pair): pair is [OsmRoad, OsmRoad] =>
      pair.length === 2 &&
      pair[0]!.road.from === pair[1]!.road.to &&
      pair[0]!.road.to === pair[1]!.road.from &&
      pair.every(({ road }) => road.lateralOffsetM === 0),
  );
}

/**
 * The roads of `pairs` that `separateDual` may push. A road continuing a pushed road straight
 * across a node must carry its block on the same side of the node, its median-side edge within
 * 0.5 m of the pushed one's (a separated pair, a two-way street, another pushed pair): a centred
 * continuation (a dual carriageway meeting the node from one side only, whose far ends lie
 * apart) would make the through lanes jog by the offset across the node, unless the network sets
 * that continuation side by side with its own other carriageway there (TASK-089). Pairs with such
 * a continuation are dropped until none is left.
 */
function pushable(city: City, roads: OsmRoad[], pairs: [OsmRoad, OsmRoad][]): Set<Road> {
  const side = city.drivingSide === 'right' ? 1 : -1;
  const outward = (road: Road, node: string) => {
    const line = road.from === node ? road.centerline : [...road.centerline].reverse();
    const lengths = cumulativeLengths(line);
    const p = pointAtDistance(line, lengths, Math.min(10, lengths.at(-1)! / 2));
    const origin = city.nodes[node]!.pos;
    return Math.atan2(p.y - origin.y, p.x - origin.x);
  };
  // A continuation converging on the node with its other carriageway is set side by side there
  // by the network, lined up with the pushed pair (TASK-089 `convergingShifts`).
  // As the network decides (`convergingShifts`): not where a block would move toward another road
  // end within 60 degrees beside it.
  const crowded = (members: Road[], node: string) =>
    members.some((m) => {
      const heading = outward(m, node);
      // The side the block moves to: its travel right.
      const toward = heading + (side * (m.to === node ? -1 : 1) * Math.PI) / 2;
      return roads.some(
        ({ road: e }) =>
          !members.includes(e) &&
          (e.from === node || e.to === node) &&
          Math.cos(outward(e, node) - heading) > Math.cos(Math.PI / 3) &&
          Math.cos(outward(e, node) - toward) > 0,
      );
    });
  const converging = (other: Road, node: string, pair: [OsmRoad, OsmRoad]) =>
    roads.some(
      ({ road: partner }) =>
        partner !== other &&
        !pair.some((p) => p.road === partner) &&
        (other.to === node ? partner.from === node : partner.to === node) &&
        sameStreet(other, partner) &&
        Math.cos(outward(other, node) - outward(partner, node)) >= CONVERGING &&
        !crowded([other, partner], node),
    );
  const pushed = new Set(pairs.flatMap((pair) => pair.map(({ road }) => road)));
  for (let changed = true; changed;) {
    changed = false;
    for (const pair of pairs) {
      if (!pair.every(({ road }) => pushed.has(road))) continue;
      const jogs = pair.some(({ road }) =>
        [road.from, road.to].some((node) =>
          roads.some(({ road: other }) => {
            if (pair.some((p) => p.road === other)) return false;
            if (!(road.to === node ? other.from === node : other.to === node)) return false;
            if (Math.cos(outward(road, node) - outward(other, node)) > -cosine30) return false;
            if (converging(other, node, pair)) return false;
            const edge = pushed.has(other)
              ? MEDIAN_M / 2
              : side * other.lateralOffsetM - halfBlock(other);
            return Math.abs(edge - MEDIAN_M / 2) > 0.5;
          }),
        ),
      );
      if (jogs) {
        for (const { road } of pair) pushed.delete(road);
        changed = true;
      }
    }
  }
  return pushed;
}

/**
 * Close carriageways (TASK-087, B41): the two opposite carriageways of a dual-carriageway corridor
 * that run between the same two nodes meet at both, so wherever their lane blocks come closer
 * than half of each block plus the `MEDIAN_M` median they overlap. Each block is pushed away from
 * the other, to its own side of travel, by its share of the shortfall (its half block plus half
 * the median over the full clearance: each by half for equal blocks), so the blocks run the
 * median apart; the push is a moving average over the road's taper length (a window shrinking to
 * nothing at the nodes), so it eases off where they part and is kept up to each node, where it is
 * the full share. The road gets that share as `lateralOffsetM` and the centerline that carries
 * its pushed block, so at the nodes both centerlines meet the node and the blocks lie side by
 * side, as a separated coincident pair does; where they are farther apart the lanes stay on the
 * source line. Pairs meeting at one node only are left alone: one lateral offset per road cannot
 * put them side by side at that node without moving their lanes at the other, and so are pairs
 * whose through lanes would jog at a node (`pushable`). Topology, ids and
 * node positions are unchanged; provenance records `separated`.
 */
export function separateDual(city: City, roads: OsmRoad[]): void {
  const side = city.drivingSide === 'right' ? 1 : -1;
  const pairs = closePairs(roads);
  const pushed = pushable(city, roads, pairs);
  for (const pair of pairs) {
    const [a, b] = pair;
    if (!pushed.has(a.road)) continue;
    const shares = [a, b].map(({ road }) => halfBlock(road) + MEDIAN_M / 2);
    const clearance = shares[0]! + shares[1]!;
    // Both roads are sampled at the first one's points p and their nearest points q on the
    // second, so the two centerlines share one middle line where both are fully pushed.
    const points = resample(a.road.centerline, SAMPLE_M);
    const normals = vertexNormals(points);
    const lengths = cumulativeLengths(points);
    const total = lengths.at(-1)!;
    const nearest = points.map((p) => nearestOnPolyline(b.road.centerline, p));
    // The nearest points must run back along b; a pair that folds the map stays as drawn.
    if (nearest.some((n, i) => i > 0 && n.along > nearest[i - 1]!.along + 1e-9)) continue;
    // Signed gap along a's normal, positive when b lies on the side opposite to the push.
    const gaps = points.map(
      (p, i) =>
        -side *
        ((nearest[i]!.point.x - p.x) * normals[i]!.x + (nearest[i]!.point.y - p.y) * normals[i]!.y),
    );
    const centerlines = [a, b].map(({ road }, k) => {
      // The push this road needs (its share of the shortfall), unclamped and clamped at zero.
      const shortfall = gaps.map((gap) => ((clearance - gap) * shares[k]!) / clearance);
      const needed = shortfall.map((value) => Math.max(0, value));
      const prefix = [0];
      for (let i = 1; i <= points.length; i++)
        prefix.push(
          prefix[i - 1]! +
            (i < points.length
              ? ((needed[i - 1]! + needed[i]!) / 2) * (lengths[i]! - lengths[i - 1]!)
              : 0),
        );
      // The trapezoid integral of `needed` from station 0 to `s`.
      const integral = (s: number) => {
        let i = 1;
        while (i < points.length - 1 && lengths[i]! < s) i++;
        const t = (s - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1);
        const value = needed[i - 1]! + (needed[i]! - needed[i - 1]!) * t;
        return prefix[i - 1]! + ((needed[i - 1]! + value) / 2) * (s - lengths[i - 1]!);
      };
      const taper = taperLength(road);
      return points.map((p, i) => {
        const s = lengths[i]!;
        const half = Math.min(taper / 2, s, total - s);
        const push =
          half > 1e-9 ? (integral(s + half) - integral(s - half)) / (2 * half) : needed[i]!;
        // The point dividing p to q by the shares lies half a block plus half the median from
        // where each block goes when fully pushed; the centerline is that point moved by the
        // push beyond full closure, along the road's own normal.
        const q = nearest[i]!.point;
        const t = shares[0]! / clearance;
        const middle = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        const d = nearest[i]!.direction;
        const n = k === 0 ? normals[i]! : { x: -d.y, y: d.x };
        const shift = side * (push - shortfall[i]!);
        return { x: middle.x + n.x * shift, y: middle.y + n.y * shift };
      });
    });
    centerlines[1]!.reverse();
    for (const [k, { road }] of [a, b].entries()) {
      const line = centerlines[k]!;
      line[0] = city.nodes[road.from]!.pos;
      line[line.length - 1] = city.nodes[road.to]!.pos;
      road.centerline = line;
      road.lateralOffsetM = side * shares[k]!;
      road.provenance = {
        ...road.provenance,
        inferred: [...road.provenance.inferred!, 'separated'],
      };
    }
  }
}
