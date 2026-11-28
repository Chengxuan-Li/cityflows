import {
  cumulativeLengths,
  nearestOnPolyline,
  pointAtDistance,
  polylineLength,
  segmentsIntersect,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { CONVERGING, sameStreet, smoothstep, taperLength } from '../../network/lanes';
import type { City, Road } from '../../schema';
import type { OsmData, OsmTags } from './parse';
import { JUNCTION_ZONE_M, resample, vertexNormals } from './relax';
import { osmLayer, placementOffset, type OsmRoad } from './roads';

/** Gap between the lane blocks of a separated coincident pair (owner, 2026-11-06). */
export const MEDIAN_M = 0.5;
/** TASK-231 (TASK-216 D5, TASK-218's rule): opposite carriageways of one street whose lane
 * blocks, on their OSM lines, leave less than this between them over most of their run (20 m or
 * more) are the two halves of one carriageway: RASt 06's narrowest median strip is 2 m, so a
 * narrower one is paint, which OSM drew as two ways (Freiburg's Bismarckallee before the
 * Hauptbahnhof, `r:1251`/`r:2215`). They are pulled together to `MEDIAN_M`, where B54 (owner,
 * 2026-11-10) would keep them as drawn, except where a mapped median lies between their lines
 * (TASK-238, `mappedMedians`). */
export const HALVES_GAP_M = 2;
/** Where halves part by more than this (toward a junction) they are not pulled. */
const HALVES_PART_M = 3;
/** Halves run beside each other over at least this, and are pulled over at least this. */
const HALVES_RUN_M = 20;
/** Motorway, trunk and ramp carriageways are kept apart by a barrier, never halves. */
const separated = (...roads: Road[]) =>
  roads.some((road) => ['motorway', 'trunk', 'ramp'].includes(road.roadClass));
/** TASK-238: what marks a median strip where it lies between two carriageways: a barrier, a
 * planted or grass area, or a traffic island (Munich's Marsstraße `r:845`/`r:944`: way 71822752,
 * `landuse=grass` with `barrier=green`, about 2 m wide, filling the 0.9 to 1.9 m between the
 * blocks). */
const medianTag = (tag: OsmTags) =>
  !tag.highway &&
  (!!tag.barrier ||
    !!tag.landcover ||
    tag['area:highway'] === 'traffic_island' ||
    ['grass', 'meadow', 'flowerbed', 'village_green'].includes(tag.landuse ?? '') ||
    ['grassland', 'scrub', 'shrubbery', 'tree_row', 'wood'].includes(tag.natural ?? ''));

/** TASK-238: the at-grade OSM ways (`medianTag`) that keep two halves of a street apart where
 * they lie between them, as lines (an area as its closed ring) in the city's frame. */
export function mappedMedians(data: OsmData, positions: ReadonlyMap<number, Vec2>): Vec2[][] {
  return data.way.flatMap(({ tag, nd }) => {
    if (!medianTag(tag) || osmLayer(tag) !== 0) return [];
    const line = nd.flatMap((id) => (positions.has(id) ? [positions.get(id)!] : []));
    return line.length >= 2 ? [line] : [];
  });
}

/** Whether segment `p`-`q` crosses any of `lines`. */
const crosses = (p: Vec2, q: Vec2, lines: readonly Vec2[][]) =>
  lines.some((line) => line.some((a, i) => i > 0 && segmentsIntersect(p, q, line[i - 1]!, a)));
/** The median of `values` (non-empty). */
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
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
 * TASK-242: a one-way way's OSM `placement` puts its line on a lane boundary instead of the middle
 * of its lanes (`placementOffset`): the road's lane block is set that far off the line
 * (`lateralOffsetM`), before the corridor rules, which measure the blocks where they lie. A road
 * keeps one offset, and the network draws no offset taper where a road runs on into the next
 * (across a node of only their two ends, or straight across a junction): there a placed road's
 * block must meet the next road's as the network lines lanes up (left edges together, TASK-071,
 * TASK-083), else the road is left centred, until every placed road meets its neighbours.
 * `placement=transition` ways (whose line moves between the placements of the ways they join),
 * roads of several ways placed differently and two-way ways (`placement:forward`, whose blocks
 * the network keeps beside their centre line) keep the default.
 */
export function placeRoads(city: City, roads: OsmRoad[], data: OsmData): void {
  const tags = new Map(data.way.map(({ id, tag }) => [id, tag]));
  const ends = new Map<string, Road[]>();
  for (const { road } of roads)
    for (const node of [road.from, road.to]) ends.set(node, [...(ends.get(node) ?? []), road]);
  const offsets = new Map<Road, number>();
  const transitions = new Set<Road>();
  for (const { road } of roads) {
    if (road.streetGroupId !== null) continue;
    const placements = new Set(road.provenance.osmIds!.map((id) => tags.get(id)!.placement));
    if (placements.size !== 1) continue;
    if (placements.has('transition')) transitions.add(road);
    const offset = placementOffset(
      [...placements][0],
      road.lanes.map((lane) => lane.widthM),
    );
    if (offset !== undefined) offsets.set(road, offset);
  }
  const leftEdge = (road: Road) => (offsets.get(road) ?? road.lateralOffsetM) - halfBlock(road);
  // The unit direction away from `node` along `road`, over its first 5 m.
  const outward = (road: Road, node: string) => {
    const line = road.from === node ? road.centerline : [...road.centerline].reverse();
    const lengths = cumulativeLengths(line);
    const p = pointAtDistance(line, lengths, Math.min(5, lengths.at(-1)!));
    const o = city.nodes[node]!.pos;
    const d = Math.hypot(p.x - o.x, p.y - o.y) || 1;
    return { x: (p.x - o.x) / d, y: (p.y - o.y) / d };
  };
  // The one-way road `road` runs on into at `node`: the other road end there, or at a junction
  // the one running straight on (within 30 degrees, the straightest; TASK-083's through pairs)
  // unless that is a transition, whose line OSM leaves free there.
  const next = (road: Road, node: string) => {
    const at = ends.get(node)!;
    const on = at.filter(
      (o) =>
        o !== road && o.streetGroupId === null && (node === road.from ? o.to : o.from) === node,
    );
    if (at.length === 2) return on[0];
    const d = outward(road, node);
    let best: { road: Road; cos: number } | undefined;
    for (const o of on) {
      const e = outward(o, node);
      const cos = d.x * e.x + d.y * e.y;
      if (cos < -cosine30 && (!best || cos < best.cos)) best = { road: o, cos };
    }
    return best && !transitions.has(best.road) ? best.road : undefined;
  };
  // A lane-gain merge (or its reverse, a ramp split) has to meet the outer slice too. If
  // placement makes the ramp's jog larger, keep the centred block when the ramp is not an
  // acute continuation or even the full mapped link is too short for the jog. A smoothstep
  // has peak slope 1.5 * offset / length; use the layout's 30-degree continuation limit.
  const rampDoesNotFit = (road: Road, node: string, main: Road) => {
    const at = ends.get(node)!;
    if (at.length !== 3 || road.roadClass === 'ramp' || main.roadClass === 'ramp') return false;
    const ramp = at.find((r) => r !== road && r !== main)!;
    const merge = road.from === node;
    if (
      ramp.roadClass !== 'ramp' ||
      ramp.streetGroupId !== null ||
      (merge ? ramp.to : ramp.from) !== node ||
      road.lanes.length !== main.lanes.length + ramp.lanes.length
    )
      return false;
    const d = outward(road, node);
    const r = outward(ramp, node);
    const side = (merge ? 1 : -1) * Math.sign(d.x * r.y - d.y * r.x);
    if (!side) return false;
    const slice =
      side > 0 ? road.lanes.slice(-ramp.lanes.length) : road.lanes.slice(0, ramp.lanes.length);
    const centred = side * (halfBlock(road) - slice.reduce((w, l) => w + l.widthM, 0) / 2);
    const jog = centred - (offsets.get(ramp) ?? ramp.lateralOffsetM);
    const placedJog = Math.abs(jog + offsets.get(road)!);
    return (
      placedJog > Math.abs(jog) &&
      (d.x * r.x + d.y * r.y > -cosine30 ||
        1.5 * placedJog > polylineLength(ramp.centerline) * Math.tan(Math.PI / 6))
    );
  };
  for (;;) {
    let changed = false;
    for (const road of offsets.keys()) {
      const step = [road.from, road.to].some((node) => {
        const other = next(road, node);
        return other !== undefined && Math.abs(leftEdge(other) - leftEdge(road)) > 1e-6;
      });
      if (!step) continue;
      offsets.delete(road);
      changed = true;
    }
    if (changed) continue;
    // Check the ramp against its surviving placement, then propagate any new seam steps.
    const unfit = [...offsets.keys()].filter((road) =>
      [road.from, road.to].some((node) => {
        const other = next(road, node);
        return other !== undefined && rampDoesNotFit(road, node, other);
      }),
    );
    if (!unfit.length) break;
    for (const road of unfit) offsets.delete(road);
  }
  for (const [road, offset] of offsets) road.lateralOffsetM = offset;
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
        (a.road.name !== null && a.road.name === b.road.name
          ? true
          : a.road.roadClass === b.road.roadClass &&
            a.wayId !== b.wayId &&
            ((a.road.name === null &&
              b.road.name === null &&
              a.road.from === b.road.to &&
              a.road.to === b.road.from) ||
              sameRef(a, b))) &&
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
  const unnamed = duals.filter(
    ([a, b]) =>
      a.road.name === null &&
      b.road.name === null &&
      a.road.from === b.road.to &&
      a.road.to === b.road.from,
  );
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

const refOf = ({ attributes }: OsmRoad) =>
  (JSON.parse(attributes) as string[][]).find(([key]) => key === 'ref')?.[1];
/** TASK-131: one road's carriageways by their `ref` where at most one is named (Sindelfingen's
 * A 81 `r:464`/`r:543`; Munich's Trappentreutunnel `r:687` beside the unnamed B 2R `r:1030`). */
const sameRef = (a: OsmRoad, b: OsmRoad) =>
  (a.road.name === null || b.road.name === null) && refOf(a) !== undefined && refOf(a) === refOf(b);

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

/** The mean of `values` (at stations `lengths`) over `window` about each point, a window
 * shrinking to nothing at the ends, by the trapezoid integral from station 0. */
function movingMean(values: number[], lengths: Float64Array, window: number): number[] {
  const total = lengths[lengths.length - 1]!;
  const prefix = [0];
  for (let i = 1; i < values.length; i++)
    prefix.push(
      prefix[i - 1]! + ((values[i - 1]! + values[i]!) / 2) * (lengths[i]! - lengths[i - 1]!),
    );
  const integral = (s: number) => {
    let i = 1;
    while (i < values.length - 1 && lengths[i]! < s) i++;
    const t = (s - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1);
    const value = values[i - 1]! + (values[i]! - values[i - 1]!) * t;
    return prefix[i - 1]! + ((values[i - 1]! + value) / 2) * (s - lengths[i - 1]!);
  };
  return values.map((v, i) => {
    const s = lengths[i]!;
    const half = Math.min(window / 2, s, total - s);
    return half > 1e-9 ? (integral(s + half) - integral(s - half)) / (2 * half) : v;
  });
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
      // TASK-242: a block set aside by its `placement` still takes part; one a pair set aside
      // (`separated`) does not.
      pair.every(({ road }) => !road.provenance.inferred!.includes('separated')),
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

/** The corridor a road belongs to once the realignment has run: its own, or the one it joins
 * then (a carriageway's second way, an unnamed pair that `separateDual` may push). */
export function finalCorridor(road: Road): string | null {
  return thirdWay.get(road) ?? road.corridorId ?? deferredCorridor.get(road) ?? null;
}

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
  const crowded = (members: Road[], node: string) => {
    const headings = members.map((road) => outward(road, node));
    const axis = Math.atan2(
      headings.reduce((sum, h) => sum + Math.sin(h), 0),
      headings.reduce((sum, h) => sum + Math.cos(h), 0),
    );
    return members.some((m) => {
      const heading = outward(m, node);
      // The side the block moves to: its travel right.
      const toward = heading + (side * (m.to === node ? -1 : 1) * Math.PI) / 2;
      return roads.some(
        ({ road: e }) =>
          !members.includes(e) &&
          (e.from === node || e.to === node) &&
          Math.cos(outward(e, node) - axis) > Math.cos(Math.PI / 3) &&
          Math.cos(outward(e, node) - toward) > 0,
      );
    });
  };
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
export function separateDual(city: City, roads: OsmRoad[], medians: readonly Vec2[][]): void {
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
    const nearest = points.map((p) => nearestOnPolyline(b.road.centerline, p));
    // The nearest points must run back along b; a pair that folds the map stays as drawn.
    if (nearest.some((n, i) => i > 0 && n.along > nearest[i - 1]!.along + 1e-9)) continue;
    // The centres of the two lane blocks at p and at its nearest point on b: the centerlines
    // moved by their `placement` offsets (TASK-242; zero elsewhere), to the right of travel.
    const blockA = points.map((p, i) => ({
      x: p.x + normals[i]!.x * a.road.lateralOffsetM,
      y: p.y + normals[i]!.y * a.road.lateralOffsetM,
    }));
    const blockB = nearest.map(({ point, direction: d }) => ({
      x: point.x - d.y * b.road.lateralOffsetM,
      y: point.y + d.x * b.road.lateralOffsetM,
    }));
    // Signed gap along a's normal, positive when b lies on the side opposite to the push.
    const gaps = blockA.map(
      (p, i) =>
        -side * ((blockB[i]!.x - p.x) * normals[i]!.x + (blockB[i]!.y - p.y) * normals[i]!.y),
    );
    // TASK-131 (owner, checkpoint 0): only where the blocks overlap or leave less than the
    // median; a pair with space between its blocks everywhere stays where it is drawn, unless it
    // is one carriageway's two halves (TASK-231, `HALVES_GAP_M`): those close to the median
    // wherever they run within `HALVES_PART_M` and no mapped median lies between them (TASK-238).
    const blockGap = (gap: number) => gap - clearance + MEDIAN_M;
    const halves =
      !separated(a.road, b.road) &&
      gaps.length >= HALVES_RUN_M / SAMPLE_M &&
      median(gaps.map(blockGap)) < HALVES_GAP_M;
    if (!halves && gaps.every((gap) => gap >= clearance)) continue;
    const closing = gaps.map(
      (gap, i) =>
        halves && blockGap(gap) < HALVES_PART_M && !crosses(points[i]!, nearest[i]!.point, medians),
    );
    const centerlines = [a, b].map(({ road }, k) => {
      // The push this road needs (its share of the shortfall), unclamped and clamped at zero.
      const shortfall = gaps.map((gap) => ((clearance - gap) * shares[k]!) / clearance);
      const needed = shortfall.map((value) => Math.max(0, value));
      const pull = shortfall.map((value, i) => (closing[i] ? Math.min(0, value) : 0));
      const mean = (values: number[], window: number) => movingMean(values, lengths, window);
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
      return blockA.map((p, i) => {
        const push = pushes[i]!;
        // The point dividing p to q by the shares lies half a block plus half the median from
        // where each block goes when fully pushed; the centerline is that point moved by the
        // push beyond full closure, along the road's own normal.
        const q = blockB[i]!;
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
  pushOverlapping(city, roads, medians);
}

/**
 * TASK-131 (owner decision 2): opposite carriageways of one road that share no node (one
 * corridor, one name, or one class and `ref` with at most one named: Sindelfingen's A 81) and
 * whose lane blocks overlap or leave less than `MEDIAN_M` are pushed apart there, each block to its
 * own side of travel by its share of the shortfall, as `separateDual` shares it. The push is a
 * moving average over the road's taper length and eases to nothing over the taper toward each
 * end, so no node and no road end moves; elsewhere both keep their OSM lines. A road is measured
 * against every such opposite road (a carriageway drawn as several ways), on the lines as they
 * were before any of them moved. Returns the pairs pushed.
 */
export function pushOverlapping(
  city: City,
  roads: OsmRoad[],
  medians: readonly Vec2[][],
): [OsmRoad, OsmRoad][] {
  const side = city.drivingSide === 'right' ? 1 : -1;
  const street = (a: OsmRoad, b: OsmRoad) =>
    (!!a.road.corridorId && a.road.corridorId === b.road.corridorId) ||
    (a.road.name !== null && a.road.name === b.road.name) ||
    (a.road.roadClass === b.road.roadClass && sameRef(a, b));
  // Not a pair `separateCoincident` or `separateDual` already set apart.
  const oneWay = roads.filter(
    ({ road }) => road.streetGroupId === null && !road.provenance.inferred!.includes('separated'),
  );
  const boxes = new Map(oneWay.map((source) => [source, boxOf(source.road.centerline)]));
  const medianBoxes = medians.map(boxOf);
  const lines = new Map(oneWay.map(({ road }) => [road, road.centerline]));
  const pushes = new Map<OsmRoad, number[]>();
  const pulls = new Map<OsmRoad, number[]>();
  const pairs: [OsmRoad, OsmRoad][] = [];
  // The push `x` needs against `y`, per point of `points` (x's line every metre), the pull toward
  // `y` if they are halves of one carriageway, and the gaps between the two lane blocks where they
  // run beside each other.
  const needed = (x: OsmRoad, y: OsmRoad, points: Vec2[], normals: Vec2[]) => {
    const share = halfBlock(x.road) + MEDIAN_M / 2;
    const clearance = share + halfBlock(y.road) + MEDIAN_M / 2;
    const other = lines.get(y.road)!;
    const lengthY = cumulativeLengths(other).at(-1)!;
    const lengthsX = cumulativeLengths(points);
    const totalX = lengthsX.at(-1)!;
    // The medians near x, found once x has a sample that could close.
    let nearby: Vec2[][] | undefined;
    const local = () =>
      (nearby ??= medians.filter((_, k) => near(medianBoxes[k]!, boxes.get(x)!, 25)));
    const beside = points.map((p, i) => {
      const q = nearestOnPolyline(other, p);
      const n = normals[i]!;
      // Beside and travelling the other way: y's direction within 30 degrees of x's reversed.
      if (
        q.along <= 0 ||
        q.along >= lengthY ||
        q.direction.y * n.x - q.direction.x * n.y < cosine30
      )
        return null;
      // Signed gap along x's normal between the lane blocks, positive when y lies on the side
      // opposite to the push; a block set aside by its `placement` (TASK-242) moves the gap.
      const gap =
        -side * ((q.point.x - p.x) * n.x + (q.point.y - p.y) * n.y) +
        side * (x.road.lateralOffsetM + y.road.lateralOffsetM);
      // TASK-231: halves are pulled only where both lie outside the junction zones at their ends,
      // so no node's junction changes shape, and (TASK-238) where no mapped median (a grass strip,
      // a barrier, an island) lies between their lines: that is the median, not paint.
      const s = lengthsX[i]!;
      const inner =
        Math.min(s, totalX - s) >= JUNCTION_ZONE_M &&
        Math.min(q.along, lengthY - q.along) >= JUNCTION_ZONE_M;
      const closes =
        inner && gap - clearance + MEDIAN_M < HALVES_PART_M && !crosses(p, q.point, local());
      return { gap, closes };
    });
    const shortfall = (gap: number) => ((clearance - gap) * share) / clearance;
    return {
      push: beside.map((b) => (b && b.gap > 0 ? Math.max(0, shortfall(b.gap)) : 0)),
      // TASK-231: toward the other half of one carriageway (negative), as far as the median.
      pull: beside.map((b) => (b?.closes ? Math.min(0, shortfall(b.gap)) : 0)),
      blockGaps: beside.flatMap((b) => (b ? [b.gap - clearance + MEDIAN_M] : [])),
    };
  };
  const sampled = new Map(
    oneWay.map((source) => {
      const points = resample(source.road.centerline, SAMPLE_M);
      return [source, { points, normals: vertexNormals(points) }];
    }),
  );
  for (const [i, a] of oneWay.entries())
    for (const b of oneWay.slice(i + 1)) {
      if (a.layer !== b.layer || !near(boxes.get(a)!, boxes.get(b)!, 25)) continue;
      const ends = [b.road.from, b.road.to];
      if (ends.includes(a.road.from) || ends.includes(a.road.to) || !street(a, b)) continue;
      const found = ([a, b] as const).map((x, k) => {
        const y = k === 0 ? b : a;
        const { points, normals } = sampled.get(x)!;
        return needed(x, y, points, normals);
      });
      // TASK-231: halves of one carriageway (`HALVES_GAP_M`) beside each other over at least
      // `HALVES_RUN_M` both ways, whose blocks are clear of each other everywhere (TASK-131 left
      // them as drawn), are pulled together where they leave more than the median, over a run of
      // at least `HALVES_RUN_M` on each.
      const halves =
        !separated(a.road, b.road) &&
        found.every(
          ({ blockGaps, push, pull }) =>
            blockGaps.length >= HALVES_RUN_M / SAMPLE_M &&
            median(blockGaps) < HALVES_GAP_M &&
            push.every((v) => v < 0.05) &&
            pull.filter((v) => v < 0).length >= HALVES_RUN_M / SAMPLE_M,
        );
      // Pushes under 5 cm (blocks touching within rounding) leave both lines as drawn.
      if (!halves && found.every(({ push }) => push.every((v) => v < 0.05))) continue;
      pairs.push([a, b]);
      for (const [k, x] of [a, b].entries()) {
        const { pull } = found[k]!;
        // Halves need no push: theirs are under 5 cm, which leave a pair as drawn.
        const push = halves ? pull.map(() => 0) : found[k]!.push;
        const before = pushes.get(x);
        pushes.set(x, before ? before.map((v, j) => Math.max(v, push[j]!)) : push);
        if (!halves) continue;
        const pulled = pulls.get(x);
        pulls.set(x, pulled ? pulled.map((v, j) => Math.min(v, pull[j]!)) : pull);
      }
    }
  for (const [source, pushed] of pushes) {
    const { road } = source;
    const { points, normals } = sampled.get(source)!;
    const lengths = cumulativeLengths(points);
    const total = lengths.at(-1)!;
    const taper = taperLength(road);
    const means = movingMean(pushed, lengths, taper);
    // TASK-231: a pull (where no push is needed) eases in over the taper beyond the junction zone.
    const pulled = pulls.get(source);
    const pullMeans =
      pulled &&
      movingMean(
        pulled.map((v, j) => (pushed[j]! > 0 ? 0 : v)),
        lengths,
        taper,
      );
    road.centerline = points.map((p, i) => {
      const d = Math.min(lengths[i]!, total - lengths[i]!);
      const push =
        side *
        (means[i]! * smoothstep(d / taper) +
          (pullMeans ? pullMeans[i]! * smoothstep((d - JUNCTION_ZONE_M) / taper) : 0));
      return { x: p.x + normals[i]!.x * push, y: p.y + normals[i]!.y * push };
    });
    road.centerline[0] = city.nodes[road.from]!.pos;
    road.centerline[road.centerline.length - 1] = city.nodes[road.to]!.pos;
    road.provenance = {
      ...road.provenance,
      inferred: [...road.provenance.inferred!, 'separated'],
    };
  }
  return pairs;
}
