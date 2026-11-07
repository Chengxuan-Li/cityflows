import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { ATTACH_GAP_M, CONVERGING, sameStreet, smoothstep, taperLength } from '../../network/lanes';
import type { City, Road } from '../../schema';
import { JUNCTION_ZONE_M, resample, vertexNormals } from './relax';
import type { OsmRoad } from './roads';

/** Gap between the lane blocks of a separated coincident pair (owner, 2026-11-06). */
export const MEDIAN_M = 0.5;
const cosine30 = Math.cos(Math.PI / 6);
const SAMPLE_M = 1;
/** TASK-095: carriageways opening at more than 20 degrees part. */
const PART_SLOPE = Math.tan(Math.PI / 9);
/** TASK-099 (B54): the corridors `attachCarriageways` attaches, the owner's round 6 findings
 * (Arnulfstraße, Munich). The rule runs on any corridor of two chains; on the other eligible ones
 * it is not applied yet, because together they cost the traffic gate (see the TASK-099 report). */
const ATTACHED: Record<string, string> = {
  'corridor:54200280+151784481': 'Arnulfstraße r:386/r:716, n:138 west to n:407',
  'corridor:134171421+134583817': 'Arnulfstraße r:654+r:698/r:680, n:638 east to n:696',
};
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
  // TASK-093 (B49): a carriageway drawn as two ways meeting at a node of two road ends pairs one
  // of them with the opposite carriageway; the other (n:967's r:961, which continues r:1368 beside
  // r:1276) joins that corridor after the realignment, which keeps treating it as an arm of its
  // own, as before.
  for (const { pair } of dual) {
    const [loose, held] = paired.has(pair[0]) ? [pair[1], pair[0]] : pair;
    if (paired.has(loose) || !paired.has(held) || loose.road.name === null) continue;
    const id = held.road.corridorId;
    const partner = roads.find((o) => o !== held && o.road.corridorId === id);
    const node =
      partner?.road.to === loose.road.from
        ? loose.road.from
        : partner?.road.from === loose.road.to
          ? loose.road.to
          : null;
    if (
      node === null ||
      roads.filter(({ road }) => road.from === node || road.to === node).length !== 2
    )
      continue;
    paired.add(loose);
    thirdWay.set(loose.road, id!);
  }
  const unnamed = duals.filter(([a]) => a.road.name === null);
  // TASK-089: a pair pushable only because its continuation converges with its own other
  // carriageway joins its corridor after the realignment (`separateDual`), which bends a
  // corridor's carriageways as one arm: as two arms there, the realignment and the turns it
  // classifies stay as before the pair was pushed.
  const kept = pushable(city, roads, closePairs(roads), false);
  for (const pair of unnamed)
    if (!kept.has(pair[0].road))
      for (const { road } of pair) {
        if (road.corridorId) deferredCorridor.set(road, road.corridorId);
        road.corridorId = null;
      }
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
/** Corridor ids of unnamed pairs that may join their corridor after the realignment. */
const deferredCorridor = new WeakMap<Road, string>();
/** Corridor ids of the second ways of carriageways drawn as two (`assignCorridors`). */
const thirdWay = new WeakMap<Road, string>();

function pushable(
  city: City,
  roads: OsmRoad[],
  pairs: [OsmRoad, OsmRoad][],
  exempt = true,
): Set<Road> {
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
            if (exempt && converging(other, node, pair)) return false;
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
 * source line, unless their median is narrower than `ATTACH_GAP_M` (TASK-093, B45, TASK-095,
 * B54: pulled together to the median, eased over the taper where it widens past that). Pairs meeting at one
 * node only are left alone: one lateral offset per road cannot put them side by side at that node
 * without moving their lanes at the other, and so are pairs whose through lanes would jog at a
 * node (`pushable`). Topology, ids and node positions are unchanged; provenance records
 * `separated`. Third ways (`assignCorridors`) join their corridors here, after the realignment.
 */
export function separateDual(city: City, roads: OsmRoad[]): void {
  const side = city.drivingSide === 'right' ? 1 : -1;
  for (const { road } of roads) road.corridorId = thirdWay.get(road) ?? road.corridorId;
  const pairs = closePairs(roads);
  const pushed = pushable(city, roads, pairs);
  for (const pair of pairs) {
    const [a, b] = pair;
    if (!pushed.has(a.road)) continue;
    for (const { road } of pair) road.corridorId ??= deferredCorridor.get(road) ?? null;
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
    // TASK-093 (B45), TASK-095 (B54): a median void narrower than `ATTACH_GAP_M` (the gap between
    // the two blocks beyond the median) closes too, each road pulled toward the pair's middle line
    // by its share; so does a wider stretch shorter than twice the taper between two such, which
    // easing out and back in would leave as a dent. Where the pair opens from together (within
    // half a metre of the median) past the limit at more than 20 degrees, it parts where it was
    // last together.
    const edges = gaps.map((gap) => gap - clearance + MEDIAN_M);
    const closing = edges.map((edge) => edge < ATTACH_GAP_M);
    for (const order of [1, -1]) {
      const at = (k: number) => (order > 0 ? k : edges.length - 1 - k);
      for (let k = 0; k < edges.length; k++) {
        if (closing[at(k)]) continue;
        let together = k;
        while (together > 0 && edges[at(together)]! > MEDIAN_M + 0.5) together--;
        const run = Math.abs(lengths[at(k)]! - lengths[at(together)]!);
        if ((edges[at(k)]! - edges[at(together)]!) / Math.max(SAMPLE_M, run) > PART_SLOPE)
          for (let m = together + 1; m < k; m++) closing[at(m)] = false;
        while (k < edges.length && !closing[at(k)]) k++;
      }
    }
    const reach = 2 * Math.min(taperLength(a.road), taperLength(b.road));
    for (let i = 0; i < closing.length; i++) {
      if (closing[i] || !closing[i - 1]) continue;
      let j = i;
      while (j < closing.length && !closing[j]) j++;
      if (j < closing.length && lengths[j]! - lengths[i - 1]! < reach) closing.fill(true, i, j);
      i = j;
    }
    const centerlines = [a, b].map(({ road }, k) => {
      // The push this road needs (its share of the shortfall), unclamped and clamped at zero.
      const shortfall = gaps.map((gap) => ((clearance - gap) * shares[k]!) / clearance);
      const needed = shortfall.map((value) => Math.max(0, value));
      const pull = shortfall.map((value, i) => (closing[i] ? Math.min(0, value) : 0));
      // The mean of `values` over `window` about each point (a window shrinking to nothing at the
      // nodes), by the trapezoid integral from station 0.
      const mean = (values: number[], window: number) => {
        const prefix = [0];
        for (let i = 1; i <= points.length; i++)
          prefix.push(
            prefix[i - 1]! +
              (i < points.length
                ? ((values[i - 1]! + values[i]!) / 2) * (lengths[i]! - lengths[i - 1]!)
                : 0),
          );
        const integral = (s: number) => {
          let i = 1;
          while (i < points.length - 1 && lengths[i]! < s) i++;
          const t = (s - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1);
          const value = values[i - 1]! + (values[i]! - values[i - 1]!) * t;
          return prefix[i - 1]! + ((values[i - 1]! + value) / 2) * (s - lengths[i - 1]!);
        };
        return values.map((v, i) => {
          const s = lengths[i]!;
          const half = Math.min(window / 2, s, total - s);
          return half > 1e-9 ? (integral(s + half) - integral(s - half)) / (2 * half) : v;
        });
      };
      const taper = taperLength(road);
      // With a pull, push and pull ease together by two means over half the taper each, so the
      // lanes keep a continuous curvature where one gives way to the other.
      const pushes = pull.some((v) => v < 0)
        ? mean(
            mean(
              needed.map((v, i) => v + pull[i]!),
              taper / 2,
            ),
            taper / 2,
          )
        : mean(needed, taper);
      return points.map((p, i) => {
        const push = pushes[i]!;
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
    // A closed median follows the line midway between the two source lines, whose points step
    // unevenly where the nearest points cross the other line's vertices (a zigzag of a few
    // centimetres): three passes of a [1, 2, 1] filter remove it, moving a 100 m curve by
    // millimetres.
    if (closing.some((c, i) => c && gaps[i]! > clearance))
      for (const line of centerlines)
        for (let pass = 0; pass < 3; pass++) {
          const before = line.map((q) => ({ ...q }));
          for (let i = 1; i < line.length - 1; i++)
            line[i] = {
              x: (before[i - 1]!.x + 2 * before[i]!.x + before[i + 1]!.x) / 4,
              y: (before[i - 1]!.y + 2 * before[i]!.y + before[i + 1]!.y) / 4,
            };
        }
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

/** A carriageway of one corridor as a chain of roads joined at nodes of just the two, sampled
 * about every metre (each road's ends are samples). `median` is the distance from the
 * centerline to the lane block's median-side edge as the network draws it, `share` half the
 * block plus half the median. */
interface Chain {
  roads: Road[];
  points: Vec2[];
  /** The median-side edge of the lane block at each sample, with its normals and stations. */
  edge: Vec2[];
  normals: Vec2[];
  lengths: Float64Array;
  /** Index of each road's last sample. */
  ends: number[];
  median: number[];
  share: number[];
}

function sampleChain(roads: Road[], side: number): Chain {
  const points: Vec2[] = [];
  const ends: number[] = [];
  const owner: number[] = [];
  for (const [k, road] of roads.entries()) {
    const line = road.centerline;
    const lengths = cumulativeLengths(line);
    const total = lengths.at(-1)!;
    const n = Math.max(1, Math.ceil(total / SAMPLE_M));
    for (let i = k ? 1 : 0; i <= n; i++) {
      points.push(i === n ? line.at(-1)! : pointAtDistance(line, lengths, (total * i) / n));
      owner.push(k);
    }
    ends.push(points.length - 1);
  }
  const lengths = cumulativeLengths(points);
  const halves = roads.map(halfBlock);
  // TASK-071: at a joint the network lines up the narrower road's lanes with the wider one's on
  // the median side, laying them along the wider road's line through the node and easing onto
  // their own line over the taper. Their median edge runs on with the wider road's where the
  // narrower road's line lies the difference of the half blocks toward the median, which it
  // reaches over the first five sixths of the taper from the joint (where its lanes still mostly
  // follow the wider road's line; matched to the network's ease within 0.1 m at n:652).
  const median = points.map((_, i) => {
    const k = owner[i]!;
    let half = halves[k]!;
    for (const j of [k - 1, k + 1]) {
      if (j < 0 || j >= roads.length || halves[j]! <= halves[k]!) continue;
      const joint = lengths[j < k ? ends[j]! : ends[k]!]!;
      const away = Math.abs(lengths[i]! - joint);
      half += (halves[j]! - halves[k]!) * (1 - smoothstep((1.2 * away) / taperLength(roads[k]!)));
    }
    return half;
  });
  const normals = vertexNormals(points);
  const edge = points.map((p, i) => ({
    x: p.x - side * normals[i]!.x * median[i]!,
    y: p.y - side * normals[i]!.y * median[i]!,
  }));
  return {
    roads,
    points,
    edge,
    normals,
    lengths: cumulativeLengths(edge),
    ends,
    median,
    share: owner.map((k) => halves[k]! + MEDIAN_M / 2),
  };
}

/** `values` (at `lengths`) at station `s`, linearly interpolated. */
function valueAt(values: number[], lengths: Float64Array, s: number): number {
  let i = 1;
  while (i < lengths.length - 1 && lengths[i]! < s) i++;
  const t = Math.max(0, Math.min(1, (s - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1)));
  return values[i - 1]! + (values[i]! - values[i - 1]!) * t;
}

/** Mean over `half` samples either side, the window shrinking to nothing at either end: exact on
 * a linear stretch. */
function centredMean(values: number[], half: number): number[] {
  const prefix = [0];
  for (const v of values) prefix.push(prefix.at(-1)! + v);
  return values.map((_, i) => {
    const h = Math.min(half, i, values.length - 1 - i);
    return (prefix[i + h + 1]! - prefix[i - h]!) / (2 * h + 1);
  });
}

/** A smooth profile never below `values` (TASK-095's `smoothAbove`): their centred mean, raised
 * where it falls below them by the mean of the running maximum of the shortfall. */
function smoothAbove(values: number[], half: number): number[] {
  const mean = centredMean(values, half);
  const deficit = values.map((v, i) => Math.max(0, v - mean[i]!));
  const dilated = deficit.map((_, i) =>
    Math.max(...deficit.slice(Math.max(0, i - half), Math.min(deficit.length, i + half + 1))),
  );
  const raise = centredMean(dilated, half);
  return mean.map((v, i) => Math.max(values[i]!, v + raise[i]!));
}

/** Where the ray from `p` along the unit `m` first crosses `line` (stations `lengths`): the
 * distance along the ray, the station on the line and the line's direction there. */
function rayHit(p: Vec2, m: Vec2, line: readonly Vec2[], lengths: Float64Array) {
  let best: { t: number; along: number } | undefined;
  for (let i = 1; i < line.length; i++) {
    const dx = line[i]!.x - line[i - 1]!.x,
      dy = line[i]!.y - line[i - 1]!.y;
    const denom = m.x * dy - m.y * dx;
    if (Math.abs(denom) < 1e-12) continue;
    const ax = line[i - 1]!.x - p.x,
      ay = line[i - 1]!.y - p.y;
    const t = (ax * dy - ay * dx) / denom;
    const u = (ax * m.y - ay * m.x) / denom;
    if (u < 0 || u > 1 || t <= 0 || (best && t >= best.t)) continue;
    best = { t, along: lengths[i - 1]! + u * (lengths[i]! - lengths[i - 1]!) };
  }
  return best;
}

/**
 * TASK-099 (B54): one corridor's two carriageways, in opposite directions, are pulled toward each
 * other wherever the gap between their lane blocks' median edges is wider than the 0.5 m median
 * and narrower than `ATTACH_GAP_M` and they run within 30 degrees of opposite (chords over 10 m,
 * as `assignCorridors` pairs them), so they run attached at the median. Only a pull: where the
 * blocks are closer than the median (near a node, where the network's TASK-089 split, when the
 * node has one, follows the shortfall up to the node) the lines stay as drawn, and no road gets a
 * lateral offset, so a continuation across a node keeps its lanes.
 * - A carriageway is a chain of roads joined at nodes with nothing else (a lane-count change);
 *   the joint moves with it. The gap is measured between the median edges the network draws: at
 *   a joint the narrower road's lanes line up with the wider one's on the median side (TASK-071).
 * - The pull is measured along the first chain's median edge (rays along its normals to the
 *   other's), smoothed once never below what closes the gap (`smoothAbove`, a quarter of the
 *   TASK-080 taper either side) and shared: by half block plus half median, as `separateDual`,
 *   except where a side bends away from the other (a flare at a junction mouth), which then comes
 *   back by itself to the pair's median line smoothed over the taper.
 * - It eases in over the taper where the gap jumps (past the gap limit, where the pair opens at
 *   more than 20 degrees from where it ran together, where the other carriageway ends), out to
 *   zero at a chain end the other chain does not reach, and fades out over the junction zone of
 *   every chain end (`move`).
 * - The edges move as translations; twice more, what the drawn edges miss of the intended gap
 *   (a few centimetres where the lines turn) is closed the same way.
 * Applied to the corridors in `ATTACHED` only. Topology and ids are unchanged; provenance records
 * `attached`.
 */
export function attachCarriageways(city: City, roads: OsmRoad[]): void {
  const side = city.drivingSide === 'right' ? 1 : -1;
  const at = new Map<string, Road[]>();
  for (const { road } of roads)
    for (const node of [road.from, road.to]) at.set(node, [...(at.get(node) ?? []), road]);
  const free = (road: Road) =>
    !!road.corridorId?.startsWith('corridor:') &&
    road.lateralOffsetM === 0 &&
    !road.provenance.inferred!.includes('separated');
  // The road continuing `road` through a node joining just the two, one in and one out.
  const next = (road: Road, forward: boolean) => {
    const node = forward ? road.to : road.from;
    const around = at.get(node)!;
    const other = around.find((r) => r !== road);
    if (around.length !== 2 || !other || other.corridorId !== road.corridorId || !free(other))
      return undefined;
    return (forward ? other.from === node : other.to === node) ? other : undefined;
  };
  const corridors = new Map<string, Road[][]>();
  const seen = new Set<Road>();
  for (const { road } of roads) {
    if (!free(road) || seen.has(road)) continue;
    let first = road;
    for (let back = next(first, false); back && back !== road; back = next(first, false))
      first = back;
    const chain = [first];
    for (let on = next(first, true); on && on !== first; on = next(on, true)) chain.push(on);
    for (const r of chain) seen.add(r);
    corridors.set(road.corridorId!, [...(corridors.get(road.corridorId!) ?? []), chain]);
  }
  for (const chains of corridors.values()) {
    if (chains.length !== 2) continue;
    if (!ATTACHED[chains[0]![0]!.corridorId!]) continue;
    const [a, b] = chains.map((chain) => sampleChain(chain, side)) as [Chain, Chain];
    const totalA = a.lengths.at(-1)!,
      totalB = b.lengths.at(-1)!;
    const fraction: number[] = [];
    // The gap between the median edges along A's edge normals (Infinity where B's edge is not
    // beside A's: beyond its ends or on the wrong side), and whether B runs within 30 degrees of
    // opposite there, as `assignCorridors` pairs them (chords over 5 m either side).
    const chord = (chain: Chain, s: number) => {
      const total = chain.lengths.at(-1)!;
      const p = pointAtDistance(chain.edge, chain.lengths, Math.max(0, s - 10));
      const q = pointAtDistance(chain.edge, chain.lengths, Math.min(total, s + 10));
      const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: (q.x - p.x) / length, y: (q.y - p.y) / length };
    };
    const opposite: boolean[] = [];
    const edges = a.edge.map((p, i) => {
      const n = a.normals[i]!;
      // Where the blocks overlap, B's edge lies behind A's.
      const ahead = rayHit(p, { x: -side * n.x, y: -side * n.y }, b.edge, b.lengths);
      const behind = ahead
        ? undefined
        : rayHit(p, { x: side * n.x, y: side * n.y }, b.edge, b.lengths);
      const hit = ahead ?? (behind && { t: -behind.t, along: behind.along });
      const along = hit?.along ?? nearestOnPolyline(b.edge, p).along;
      const [ta, tb] = [chord(a, a.lengths[i]!), chord(b, along)];
      opposite.push(ta.x * tb.x + ta.y * tb.y < -cosine30);
      const shareB = valueAt(b.share, b.lengths, along);
      fraction.push(a.share[i]! / (a.share[i]! + shareB));
      return hit && along > 1e-6 && along < totalB - 1e-6 ? hit.t : Infinity;
    });
    const closing = edges.map((edge, i) => opposite[i]! && edge > MEDIAN_M && edge < ATTACH_GAP_M);
    // As `separateDual`: where the pair opens from together past the limit at more than 20
    // degrees, it parts where it was last together.
    for (const order of [1, -1]) {
      const idx = (k: number) => (order > 0 ? k : edges.length - 1 - k);
      for (let k = 0; k < edges.length; k++) {
        if (closing[idx(k)] || edges[idx(k)] === Infinity || !opposite[idx(k)]) continue;
        let together = k;
        while (together > 0 && edges[idx(together)]! > MEDIAN_M + 0.5) together--;
        const run = Math.abs(a.lengths[idx(k)]! - a.lengths[idx(together)]!);
        if ((edges[idx(k)]! - edges[idx(together)]!) / Math.max(SAMPLE_M, run) > PART_SLOPE)
          for (let m = together + 1; m < k; m++) closing[idx(m)] = false;
        while (k < edges.length && !closing[idx(k)] && edges[idx(k)] !== Infinity) k++;
      }
    }
    if (!closing.some(Boolean)) continue;
    const taper = Math.min(...[...a.roads, ...b.roads].map(taperLength));
    const span = Math.round(taper / SAMPLE_M);
    // The pull that closes the gap, eased out over the taper beyond a jump, never closer than the
    // median.
    const raw = edges.map((edge, i) => {
      if (closing[i]) return edge - MEDIAN_M;
      let eased = 0;
      for (let j = Math.max(0, i - span); j <= Math.min(edges.length - 1, i + span); j++)
        if (closing[j])
          eased = Math.max(
            eased,
            (edges[j]! - MEDIAN_M) *
              (1 - smoothstep(Math.abs(a.lengths[i]! - a.lengths[j]!) / taper)),
          );
      return Math.min(eased, Math.max(0, edge - MEDIAN_M));
    });
    // Chain ends the other chain does not reach stay where they are: the pull eases out there.
    const nodesA = [a.roads[0]!.from, a.roads.at(-1)!.to];
    const nodesB = [b.roads[0]!.from, b.roads.at(-1)!.to];
    const fixed = [
      ...[0, totalA].filter((_, k) => !nodesB.includes(nodesA[k]!)),
      ...[b.edge[0]!, b.edge.at(-1)!]
        .filter((_, k) => !nodesA.includes(nodesB[k]!))
        .map((p) => nearestOnPolyline(a.edge, p).along),
    ];
    const ease = (s: number) => fixed.reduce((w, f) => w * smoothstep(Math.abs(s - f) / taper), 1);
    // Each side's part of the pull: where the gap is closed, what puts its edge on the pair's
    // median line, the point dividing the gap by the shares smoothed over the taper (so a side
    // that bends away from the other, a flare at a junction mouth, comes back by itself and the
    // other keeps its line); elsewhere its share.
    const toward = (n: Vec2, v: number) => ({ x: -side * n.x * v, y: -side * n.y * v });
    const middle = a.edge.map((_, i) =>
      edges[i]! < ATTACH_GAP_M ? toward(a.normals[i]!, fraction[i]! * edges[i]!) : { x: 0, y: 0 },
    );
    const smoothX = centredMean(
      middle.map((v, i) => a.edge[i]!.x + v.x),
      Math.round(span / 2),
    );
    const smoothY = centredMean(
      middle.map((v, i) => a.edge[i]!.y + v.y),
      Math.round(span / 2),
    );
    const parts = raw.map((v, i) => {
      if (v < 0.1 || edges[i]! >= ATTACH_GAP_M) return fraction[i]!;
      const n = a.normals[i]!;
      const along =
        -side * ((smoothX[i]! - a.edge[i]!.x) * n.x + (smoothY[i]! - a.edge[i]!.y) * n.y);
      const own = Math.max(0, Math.min(1, (along - MEDIAN_M / 2) / v));
      return fraction[i]! + (own - fraction[i]!) * smoothstep(v / 2);
    });
    const shares = centredMean(parts, Math.round(span / 4));
    const total = smoothAbove(raw, Math.round(span / 8)).map((v, i) => v * ease(a.lengths[i]!));
    // A's median edge moves along its normals, B's along A's where it lies beside A, so the gap
    // measured along them closes by the whole pull. The lines move as translations of their edges,
    // so where they turn the drawn edges miss by a few centimetres: twice more, what is left of the
    // gap where the pull is set (a push where they overlap) is closed the same way.
    const apply = (x: Chain, y: Chain, at: (s: number) => [number, number]) => {
      move(
        city,
        x,
        x.edge.map((p, i) => {
          const by = toward(x.normals[i]!, at(x.lengths[i]!)[0]);
          return { x: p.x + by.x, y: p.y + by.y };
        }),
      );
      // Each of Y's samples takes the pull of the X stations whose normal rays reach Y's edge on
      // either side of it, interpolated; samples no ray brackets stay.
      const hits = x.edge.map((p, i) => {
        const n = x.normals[i]!;
        return rayHit(p, { x: -side * n.x, y: -side * n.y }, y.edge, y.lengths)?.along;
      });
      const by = y.edge.map(() => ({ x: 0, y: 0 }));
      for (let i = 1; i < hits.length; i++) {
        const [h0, h1] = [hits[i - 1], hits[i]];
        if (h0 === undefined || h1 === undefined || Math.abs(h1 - h0) > 5 * SAMPLE_M) continue;
        const [lo, hi] = [Math.min(h0, h1), Math.max(h0, h1)];
        for (const [j, sj] of y.lengths.entries()) {
          if (sj < lo || sj > hi || by[j]!.x !== 0 || by[j]!.y !== 0) continue;
          const t = hi > lo ? (sj - h0) / (h1 - h0) : 0;
          const s0 = x.lengths[i - 1]!,
            s1 = x.lengths[i]!;
          const v = at(s0 + (s1 - s0) * t)[1];
          const n0 = x.normals[i - 1]!,
            n1 = x.normals[i]!;
          by[j] = toward({ x: n0.x + (n1.x - n0.x) * t, y: n0.y + (n1.y - n0.y) * t }, -v);
        }
      }
      move(
        city,
        y,
        y.edge.map((p, j) => ({ x: p.x + by[j]!.x, y: p.y + by[j]!.y })),
      );
    };
    apply(a, b, (s) => {
      const v = valueAt(total, a.lengths, s);
      const f = valueAt(shares, a.lengths, s);
      return [v * f, v * (1 - f)];
    });
    const intended = edges.map((edge, i) => (Number.isFinite(edge) ? edge - total[i]! : MEDIAN_M));
    for (let pass = 0; pass < 2; pass++) {
      const [x, y] = [sampleChain(a.roads, side), sampleChain(b.roads, side)];
      const stations = x.edge.map((p) => nearestOnPolyline(a.edge, p).along);
      const residual = x.edge.map((p, i) => {
        const weight = smoothstep(valueAt(total, a.lengths, stations[i]!) / 0.5);
        const n = x.normals[i]!;
        const hit = rayHit(p, { x: -side * n.x, y: -side * n.y }, y.edge, y.lengths);
        const miss = hit && hit.t - valueAt(intended, a.lengths, stations[i]!);
        return miss !== undefined && weight > 0 ? weight * Math.max(-1, Math.min(1, miss)) : 0;
      });
      const left = centredMean(residual, Math.round(span / 4));
      apply(x, y, (s) => {
        const v = valueAt(left, x.lengths, s);
        const f = valueAt(shares, a.lengths, s);
        return [v * f, v * (1 - f)];
      });
    }
  }
  for (const { road } of roads) {
    road.centerline[0] = city.nodes[road.from]!.pos;
    road.centerline[road.centerline.length - 1] = city.nodes[road.to]!.pos;
  }
}

/** Moves a chain with its median edge to `edge` (its joints with it); roads that do not move
 * keep their lines. Within the junction zone of its ends (`JUNCTION_ZONE_M`, where roads meet by
 * design) the move fades out, so a chain's end nodes, the headings there, which classify the
 * node's turns (architecture 5.2), and the junction's cuts and corners stay as imported. */
function move(city: City, chain: Chain, edge: Vec2[]): void {
  const total = chain.lengths.at(-1)!;
  const shift = chain.points.map((_, i) => {
    const s = chain.lengths[i]!;
    const keep = smoothstep(Math.min(s, total - s) / JUNCTION_ZONE_M);
    return {
      x: (edge[i]!.x - chain.edge[i]!.x) * keep,
      y: (edge[i]!.y - chain.edge[i]!.y) * keep,
    };
  });
  // As `separateDual`: three passes of a [1, 2, 1] filter over the move take out the centimetre
  // zigzag the samples' rays leave.
  for (let pass = 0; pass < 3; pass++) {
    const before = shift.map((v) => ({ ...v }));
    for (let i = 1; i < shift.length - 1; i++)
      shift[i] = {
        x: (before[i - 1]!.x + 2 * before[i]!.x + before[i + 1]!.x) / 4,
        y: (before[i - 1]!.y + 2 * before[i]!.y + before[i + 1]!.y) / 4,
      };
  }
  const moved = chain.points.map((p, i) => ({ x: p.x + shift[i]!.x, y: p.y + shift[i]!.y }));
  let start = 0;
  for (const [k, road] of chain.roads.entries()) {
    const end = chain.ends[k]!;
    if (shift.slice(start, end + 1).some((v) => Math.hypot(v.x, v.y) > 1e-3)) {
      if (k > 0) city.nodes[road.from]!.pos = moved[start]!;
      if (k < chain.roads.length - 1) city.nodes[road.to]!.pos = moved[end]!;
      road.centerline = moved.slice(start, end + 1);
      if (!road.provenance.inferred!.includes('attached'))
        road.provenance = {
          ...road.provenance,
          inferred: [...road.provenance.inferred!, 'attached'],
        };
    }
    start = end;
  }
}
