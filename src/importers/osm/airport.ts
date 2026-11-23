import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineLength,
  segmentDistance,
  segmentIntersection,
  segmentsIntersect,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Diagnostic } from '../../network';
import {
  airsideObstacles,
  airsideRules,
  largestCode as largest,
  shapeGap,
  standCode,
  standShape,
  taxiEdgeCodes,
} from '../../network/airside-codes';
import { allocateId, type City, type Road } from '../../schema';
import type { AircraftCode } from '../../schema/aircraft';
import {
  type AirsideEdgeKind,
  type AirsideSurface,
  type Airport,
  type HoldingPosition,
  type RoadCrossing,
  type RunwayEnd,
  type StandKind,
} from '../../schema/airport';
import { polygonSources } from './buildings';
import { drivableClass, isJetBridge } from './filter';
import { contains, type Bounds } from './clip';
import type { OsmData, OsmTags, OsmWay } from './parse';
import { osmLayer } from './roads';

// TASK-295: an airport's airside, read by rule (architecture sections 4 and 13); the code rules
// live in network/airside-codes.ts, which the editor shares (TASK-305).
export { airsideRules, shapeGap, standShape };
const rules = airsideRules;

const graphKinds: Record<string, AirsideEdgeKind> = {
  runway: 'runway',
  taxiway: 'taxiway',
  taxilane: 'taxilane',
};
const metres = (value: string | undefined) => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*m?\s*$/.exec(value ?? '');
  return match ? Number(match[1]) : undefined;
};
const close = (ring: Vec2[]) => [...ring, ring[0]!];
const heading = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);
/** Compass bearing in degrees of a local direction (x east, y south). */
const bearing = (angle: number) =>
  ((((Math.atan2(Math.cos(angle), -Math.sin(angle)) * 180) / Math.PI) % 360) + 360) % 360;
const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};
const norm = (ref: string | undefined) => ref?.trim().toLowerCase();
const reversed = (edge: { line: Vec2[]; from: string; to: string }) => {
  edge.line.reverse();
  [edge.from, edge.to] = [edge.to, edge.from];
};

/** Distance from a point to an open ring, 0 inside it. */
export function pointToRing(p: Vec2, ring: Vec2[]): number {
  if (pointInPolygon(p, close(ring))) return 0;
  return Math.min(...ring.map((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length]!)));
}

/** Distance between two open rings, 0 where they overlap. */
export function ringDistance(a: Vec2[], b: Vec2[]): number {
  if (pointInPolygon(a[0]!, close(b)) || pointInPolygon(b[0]!, close(a))) return 0;
  let min = Infinity;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!,
      q = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const r = b[j]!,
        s = b[(j + 1) % b.length]!;
      if (segmentsIntersect(p, q, r, s)) return 0;
      min = Math.min(min, segmentDistance(p, r, s), segmentDistance(r, p, q));
    }
  }
  return min;
}

interface DraftNode {
  key: string;
  pos: Vec2;
  osmId?: number;
  generated?: boolean;
}
interface DraftEdge {
  from: string;
  to: string;
  line: Vec2[];
  kind: AirsideEdgeKind;
  layer: number;
  tag: OsmTags;
  osmIds: number[];
  generated?: boolean;
  stand?: DraftStand;
  runway?: DraftRunway;
  code?: AircraftCode | null;
}
interface DraftStand {
  ref?: string;
  pos: Vec2;
  heading: number;
  leadIn: DraftEdge[];
  tag: OsmTags;
  osmIds: number[];
  kind?: StandKind;
  gate?: number;
  code?: AircraftCode | null;
  id?: string;
}
interface DraftRunway {
  ref: string;
  refInferred: boolean;
  edges: DraftEdge[];
  ways: number[];
  designators: string[];
  endKeys: [string, string];
  thresholds: { key: string; along: number }[];
  widthM: number;
  widthInferred: boolean;
  surface?: string;
  stopways: Vec2[][];
  code: AircraftCode | null;
}
type Area = { id: number; tag: OsmTags; rings: Vec2[][] };

/** Runs after every other import step, so no other entity's id moves. A city without aeroway
 * features (an aerodrome outline alone counts as none) gets no `airport` section. */
export function importAirport(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  diagnostics: Diagnostic[],
) {
  const source = new Map(data.node.map((n) => [n.id, n]));
  const inside = (ref: number) => {
    const p = positions.get(ref);
    return p !== undefined && contains(bounds, p);
  };
  // The airside is not clipped: a feature with a node inside the area is kept whole, so a
  // runway keeps both its ends.
  const aeroNodes = (value: string) =>
    data.node.filter((n) => n.tag.aeroway === value && inside(n.id));
  const isLine = (w: OsmWay) => w.tag.area !== 'yes' && w.nd.length >= 2;
  const graphWays = data.way.filter(
    (w) => graphKinds[w.tag.aeroway ?? ''] && isLine(w) && w.nd.some(inside),
  );
  const standWays = data.way.filter(
    (w) =>
      w.tag.aeroway === 'parking_position' &&
      isLine(w) &&
      w.nd[0] !== w.nd.at(-1) &&
      w.nd.every((r) => positions.has(r)) &&
      w.nd.some(inside),
  );
  const aeroway = (tag: OsmTags) => tag.aeroway !== undefined && tag.aeroway !== 'aerodrome';
  if (
    !data.node.some((n) => aeroway(n.tag) && inside(n.id)) &&
    !data.way.some((w) => aeroway(w.tag) && w.nd.some(inside)) &&
    !data.relation.some((r) => aeroway(r.tag))
  )
    return;

  const areas = (accepts: (tag: OsmTags) => boolean): Area[] =>
    polygonSources(data, accepts).flatMap(({ id, tag, rings }) => {
      if (!rings.some(({ ids }) => ids.some(inside))) return [];
      const projected = rings.map(({ role, ids }) => ({
        role,
        ring: ids.slice(0, -1).map((r) => positions.get(r)!),
      }));
      if (projected.some(({ ring }) => ring.some((p) => !p))) return [];
      const holes = projected.filter(({ role }) => role === 'inner').map(({ ring }) => ring);
      return projected
        .filter(({ role }) => role === 'outer')
        .map(({ ring }) => ({
          id,
          tag,
          rings: [ring, ...holes.filter((hole) => pointInPolygon(hole[0]!, close(ring)))],
        }));
    });

  // The graph: runway, taxiway and taxilane centrelines, split at every node two ways share and
  // at the nodes that mark something (holds, thresholds, turn pads, stands and their lead-ins,
  // drivable roads).
  const nodes = new Map<string, DraftNode>();
  const edges: DraftEdge[] = [];
  const aliases = new Map<string, string>();
  const graphKey = (ref: number) => {
    let key = String(ref);
    while (aliases.has(key)) key = aliases.get(key)!;
    return key;
  };
  const addNode = (r: number) => {
    const key = graphKey(r);
    if (!nodes.has(key)) nodes.set(key, { key, pos: positions.get(r)!, osmId: r });
    return key;
  };
  const incidence = new Map<number, number>();
  for (const w of graphWays)
    for (const r of new Set(w.nd)) incidence.set(r, (incidence.get(r) ?? 0) + 1);
  const marks = new Set<number>([
    ...data.node
      .filter((n) =>
        ['holding_position', 'threshold', 'turn_pad', 'parking_position'].includes(
          n.tag.aeroway ?? '',
        ),
      )
      .map((n) => n.id),
    ...standWays.flatMap((w) => w.nd),
    // Road crossings at grade (`roadCrossings`) become graph nodes.
    ...data.way.filter((w) => drivableClass(w)).flatMap((w) => w.nd),
  ]);
  const pieces = new Map<number, DraftEdge[]>();
  for (const w of graphWays) {
    const layer = osmLayer(w.tag) ?? 0;
    const runs: number[][] = [];
    let run: number[] = [];
    for (const r of [...w.nd, NaN]) {
      if (positions.has(r)) {
        if (run.at(-1) !== r) run.push(r);
      } else {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    if (w.nd.some((r) => !positions.has(r)))
      diagnostics.push({
        severity: 'warning',
        code: 'airport_incomplete_way',
        refs: [`way/${w.id}`],
        message: `Aeroway ${w.id} is broken at nodes missing from the extract`,
      });
    const list: DraftEdge[] = [];
    for (const ids of runs) {
      let start = 0;
      for (let j = 1; j < ids.length; j++) {
        const r = ids[j]!;
        if (
          j < ids.length - 1 &&
          (incidence.get(r) ?? 0) < 2 &&
          !marks.has(r) &&
          !(ids[0] === ids.at(-1) && j === Math.floor(ids.length / 2))
        )
          continue;
        const part = ids.slice(start, j + 1);
        start = j;
        const line = part.map((id) => positions.get(id)!);
        if (polylineLength(line) < 0.01) continue;
        const edge: DraftEdge = {
          from: addNode(part[0]!),
          to: addNode(part.at(-1)!),
          line,
          kind: graphKinds[w.tag.aeroway!]!,
          layer,
          tag: w.tag,
          osmIds: [w.id],
        };
        if (w.tag.oneway === '-1') reversed(edge);
        edges.push(edge);
        list.push(edge);
      }
    }
    pieces.set(w.id, list);
  }
  const ends = (edge: DraftEdge) => [edge.from, edge.to];
  const onGraph = (r: number) => {
    const key = graphKey(r);
    return edges.some((e) => e.from === key || e.to === key);
  };
  /** Splits `edge` at `along` metres; the node there (an end within 1 m by default). */
  const splitAt = (
    edge: DraftEdge,
    along: number,
    key: string,
    tolerance = 1,
    wayPieces?: DraftEdge[],
  ): string => {
    const lengths = cumulativeLengths(edge.line);
    if (along < tolerance) return edge.from;
    if (along > lengths.at(-1)! - tolerance) return edge.to;
    const point = nodes.get(key)?.pos ?? pointAtDistance(edge.line, lengths, along);
    let i = 1;
    while (lengths[i]! < along) i++;
    if (!nodes.has(key)) nodes.set(key, { key, pos: point, generated: true });
    const next = distance(point, edge.line[i]!) < 1e-7 ? i + 1 : i;
    const second: DraftEdge = { ...edge, from: key, line: [point, ...edge.line.slice(next)] };
    const prev = distance(point, edge.line[i - 1]!) < 1e-7 ? i - 1 : i;
    edge.line = [...edge.line.slice(0, prev), point];
    edge.to = key;
    edges.splice(edges.indexOf(edge) + 1, 0, second);
    wayPieces?.splice(wayPieces.indexOf(edge) + 1, 0, second);
    return key;
  };
  /** The nearest point on a taxi edge (not a runway or lead-in) of `layer` within `limit`. */
  const nearestTaxi = (
    p: Vec2,
    limit: number,
    layer: number,
    accepts?: (q: Vec2, edge: DraftEdge) => boolean,
  ) => {
    let found: { edge: DraftEdge; along: number; away: number; point: Vec2 } | undefined;
    for (const edge of edges) {
      if ((edge.kind !== 'taxiway' && edge.kind !== 'taxilane') || edge.layer !== layer) continue;
      const near = nearestOnPolyline(edge.line, p);
      if (near.away > limit || (found && near.away >= found.away)) continue;
      if (accepts && !accepts(near.point, edge)) continue;
      found = { edge, along: near.along, away: near.away, point: near.point };
    }
    return found;
  };

  // Runways: runway ways joined end to end in line, with one `ref` between them; a mapped
  // `runway=displaced_threshold` way is part of the runway it continues.
  const runwayWays = graphWays.filter((w) => w.tag.aeroway === 'runway');
  // Distinct runway centrelines at grade share a graph node even if the ways did not share an
  // OSM node. Split before ordering the runway chains so both own their complete edge lists.
  const exactM = 1e-5;
  const atEnd = (edge: DraftEdge, p: Vec2) =>
    ends(edge).find((key) => distance(nodes.get(key)!.pos, p) < exactM);
  const unify = (keep: string, discard: string) => {
    if (keep === discard) return;
    aliases.set(discard, keep);
    const p = nodes.get(keep)!.pos;
    for (const edge of edges) {
      if (edge.from === discard) {
        edge.from = keep;
        edge.line[0] = p;
      }
      if (edge.to === discard) {
        edge.to = keep;
        edge.line[edge.line.length - 1] = p;
      }
    }
  };
  for (const [i, a] of runwayWays.entries())
    for (const b of runwayWays.slice(i + 1)) {
      if (norm(a.tag.ref) && norm(a.tag.ref) === norm(b.tag.ref)) continue;
      const as = pieces.get(a.id)!;
      const bs = pieces.get(b.id)!;
      const crossings: Vec2[] = [];
      for (const e of as)
        for (const f of bs) {
          if (e.layer !== f.layer) continue;
          for (let j = 1; j < e.line.length; j++)
            for (let k = 1; k < f.line.length; k++) {
              const u = e.line[j - 1]!,
                v = e.line[j]!;
              const x = f.line[k - 1]!,
                y = f.line[k]!;
              const p = segmentIntersection(u, v, x, y);
              if (p && !crossings.some((q) => distance(p, q) < exactM)) crossings.push(p);
            }
        }
      for (const [j, p] of crossings.entries()) {
        const crossingOf = (list: DraftEdge[]) =>
          list
            .map((edge) => ({ edge, ...nearestOnPolyline(edge.line, p) }))
            .find(({ away }) => away < exactM)!;
        const left = crossingOf(as),
          right = crossingOf(bs);
        const leftKey = atEnd(left.edge, p),
          rightKey = atEnd(right.edge, p);
        const key = leftKey ?? rightKey ?? `runway-crossing/${a.id}/${b.id}/${j}`;
        if (!leftKey) splitAt(left.edge, left.along, key, exactM, as);
        if (!rightKey) splitAt(right.edge, right.along, key, exactM, bs);
        if (leftKey && rightKey) unify(leftKey, rightKey);
      }
    }
  const parent = new Map(runwayWays.map((w) => [w.id, w.id]));
  const find = (id: number): number => (parent.get(id) === id ? id : find(parent.get(id)!));
  const outward = (w: OsmWay, at: number) => {
    const ids = w.nd[0] === at ? w.nd : [...w.nd].reverse();
    return heading(positions.get(ids[0]!)!, positions.get(ids[1]!)!);
  };
  for (const a of runwayWays)
    for (const b of runwayWays) {
      if (a.id >= b.id) continue;
      const shared = [a.nd[0], a.nd.at(-1)].find((r) => r === b.nd[0] || r === b.nd.at(-1));
      if (shared === undefined || (a.tag.ref && b.tag.ref && norm(a.tag.ref) !== norm(b.tag.ref)))
        continue;
      const bend = Math.PI - angleBetween(outward(a, shared), outward(b, shared));
      if (bend <= (rules.runwayJoinDeg * Math.PI) / 180) parent.set(find(b.id), find(a.id));
    }
  const groups = new Map<number, OsmWay[]>();
  for (const w of runwayWays) groups.set(find(w.id), [...(groups.get(find(w.id)) ?? []), w]);
  const runways: DraftRunway[] = [];
  for (const ways of groups.values()) {
    const endUse = new Map<number, number>();
    for (const w of ways)
      for (const r of [w.nd[0]!, w.nd.at(-1)!]) endUse.set(r, (endUse.get(r) ?? 0) + 1);
    const starts = [...endUse].filter(([, n]) => n === 1).map(([r]) => r);
    const chain: DraftEdge[] = [];
    const left = new Set(ways);
    let at: number | undefined = Math.min(...starts);
    while (starts.length === 2 && at !== undefined) {
      const next: OsmWay | undefined = [...left].find((w) => w.nd[0] === at || w.nd.at(-1) === at);
      if (!next) break;
      left.delete(next);
      const forward: boolean = next.nd[0] === at;
      const list = [...pieces.get(next.id)!];
      if (!forward) list.reverse();
      for (const edge of list) {
        if (!forward) reversed(edge);
        chain.push(edge);
      }
      at = forward ? next.nd.at(-1) : next.nd[0];
    }
    if (starts.length !== 2 || left.size || !chain.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'airport_runway_unordered',
        refs: ways.map((w) => `way/${w.id}`),
        message: `Runway ways ${ways.map((w) => w.id).join(', ')} do not form one line from end to end: taxiable, but no runway`,
      });
      continue;
    }
    // Designator n takes off towards n x 10 degrees, so its end is where that heading starts.
    const named =
      ways.find((w) => w.tag.ref && w.tag.runway !== 'displaced_threshold') ??
      ways.find((w) => w.tag.ref);
    const along = heading(nodes.get(chain[0]!.from)!.pos, nodes.get(chain.at(-1)!.to)!.pos);
    const given = named?.tag.ref?.split('/').map((d) => d.trim());
    const helicopterOnly = given?.length === 2 && given.every((d) => /^H\d{1,2}$/.test(d));
    const valid =
      helicopterOnly || (given?.length === 2 && given.every((d) => /^\d{1,2}[LRC]?$/.test(d)));
    const derive = (angle: number) =>
      String(Math.round(bearing(angle) / 10) || 36).padStart(2, '0');
    const designators = valid ? given! : [derive(along), derive(along + Math.PI)];
    const first = (Number(/\d+/.exec(designators[0]!)![0]) * 10 * Math.PI) / 180;
    if (angleBetween(first, (bearing(along) * Math.PI) / 180) > Math.PI / 2) {
      chain.reverse();
      chain.forEach(reversed);
    }
    const main = ways.filter((w) => w.tag.runway !== 'displaced_threshold');
    const mapped = Math.max(0, ...main.map((w) => metres(w.tag.width) ?? 0));
    const lengthM = chain.reduce((sum, e) => sum + polylineLength(e.line), 0);
    const widthM = mapped || rules.runwayWidthByLength.find(([min]) => lengthM >= min)![1];
    // Thresholds: a mapped `aeroway=threshold` node in the half nearer the end (its `ref` first),
    // else the inner end of a displaced-threshold way at the end, else the end itself.
    const keys = [chain[0]!.from, ...chain.map((e) => e.to)];
    const stations = [0];
    for (const edge of chain) stations.push(stations.at(-1)! + polylineLength(edge.line));
    const thresholds = designators.map((designator, i) => {
      const fromEnd = (k: number) => (i === 0 ? stations[k]! : lengthM - stations[k]!);
      const mappedThreshold = keys
        .map((key, k) => ({ key, along: fromEnd(k), tag: source.get(Number(key))?.tag }))
        .filter(({ tag, along }) => tag?.aeroway === 'threshold' && along <= lengthM / 2)
        .sort(
          (a, b) =>
            Number(norm(b.tag!.ref) === norm(designator)) -
              Number(norm(a.tag!.ref) === norm(designator)) || a.along - b.along,
        )[0];
      if (mappedThreshold) return { key: mappedThreshold.key, along: mappedThreshold.along };
      const fromThisEnd = i === 0 ? chain : [...chain].reverse();
      const firstMain = fromThisEnd.findIndex((e) => e.tag.runway !== 'displaced_threshold');
      if (firstMain > 0) {
        const k = i === 0 ? firstMain : chain.length - firstMain;
        return { key: keys[k]!, along: fromEnd(k) };
      }
      return { key: i === 0 ? keys[0]! : keys.at(-1)!, along: 0 };
    });
    const runway: DraftRunway = {
      ref: designators.join('/'),
      refInferred: !valid,
      edges: chain,
      ways: ways.map((w) => w.id).sort((a, b) => a - b),
      designators,
      endKeys: [keys[0]!, keys.at(-1)!],
      thresholds,
      widthM,
      widthInferred: !mapped,
      ...((main[0] ?? ways[0]!).tag.surface ? { surface: (main[0] ?? ways[0]!).tag.surface } : {}),
      stopways: data.way
        .filter(
          (w) =>
            w.tag.aeroway === 'stopway' &&
            isLine(w) &&
            w.nd.every((r) => positions.has(r)) &&
            [keys[0], keys.at(-1)].some((k) => [w.nd[0]!, w.nd.at(-1)!].map(graphKey).includes(k!)),
        )
        .map((w) => w.nd.map((r) => positions.get(r)!)),
      code: helicopterOnly ? null : largest((code) => rules.runwayWidthM[code] <= widthM),
    };
    for (const edge of chain) edge.runway = runway;
    runways.push(runway);
  }

  // Buildings, as obstacles: every building outline, terminals and hangars included.
  const buildings = areas(
    (tag) =>
      (tag.building !== undefined && tag.building !== 'no') ||
      tag.aeroway === 'terminal' ||
      tag.aeroway === 'hangar',
  ).map(({ rings }) => rings[0]!);
  const obstacles = airsideObstacles(buildings);
  const { containing, crossesBuilding } = obstacles;

  const incidentEdges = () => {
    const byNode = new Map<string, DraftEdge[]>();
    for (const edge of edges)
      for (const key of ends(edge)) byNode.set(key, [...(byNode.get(key) ?? []), edge]);
    return byNode;
  };
  // Repair a short gap at the end of an isolated taxilane or taxiway before attaching stands.
  // Larger gaps remain diagnostic: a nearby apron does not establish a route across it.
  const byNode = incidentEdges();
  const flood = (starts: string[]) => {
    const seen = new Set(starts);
    const queue = [...seen];
    while (queue.length)
      for (const edge of byNode.get(queue.pop()!)!)
        for (const key of ends(edge))
          if (!seen.has(key)) {
            seen.add(key);
            queue.push(key);
          }
    return seen;
  };
  const connected = flood(runways.filter((r) => r.code !== null).flatMap((r) => r.endKeys));
  const visited = new Set(connected);
  for (const key of byNode.keys()) {
    if (visited.has(key)) continue;
    const group = flood([key]);
    let best:
      | { key: string; dangling: DraftEdge; near: NonNullable<ReturnType<typeof nearestTaxi>> }
      | undefined;
    for (const candidate of group) {
      visited.add(candidate);
      const incident = byNode.get(candidate)!;
      const dangling = incident[0]!;
      if (incident.length !== 1 || dangling.kind === 'runway') continue;
      const p = nodes.get(candidate)!.pos;
      const near = nearestTaxi(
        p,
        rules.taxiGapM,
        dangling.layer,
        (q, e) => connected.has(e.from) && !crossesBuilding(p, q),
      );
      if (near && (!best || near.away < best.near.away)) best = { key: candidate, dangling, near };
    }
    if (!best) continue;
    const { key: from, dangling, near } = best;
    const to = splitAt(near.edge, near.along, `${from}/join`, exactM);
    const p = nodes.get(from)!.pos;
    const q = nodes.get(to)!.pos;
    if (distance(p, q) < exactM) unify(to, from);
    else
      edges.push({
        from,
        to,
        line: [p, q],
        kind: dangling.kind,
        layer: dangling.layer,
        tag: {},
        osmIds: [...new Set([...dangling.osmIds, ...near.edge.osmIds])],
        generated: true,
      });
    connected.add(to);
  }

  // Holding positions: on the graph, or snapped onto the nearest taxi edge within 20 m.
  const unjoined: string[] = [];
  const holdKeys = new Map<number, string>();
  for (const n of aeroNodes('holding_position')) {
    if (onGraph(n.id)) holdKeys.set(n.id, graphKey(n.id));
    else {
      const near = nearestTaxi(positions.get(n.id)!, rules.holdJoinM, osmLayer(n.tag) ?? 0);
      if (near) holdKeys.set(n.id, splitAt(near.edge, near.along, `hold/${n.id}`));
      else unjoined.push(`node/${n.id}`);
    }
  }

  // Stands: `parking_position` lead-in ways, which end at the stop position, and stop nodes. A
  // node is the stop of a lead-in way of its ref ending within 30 m or passing through it, else a
  // stand of its own. A stand or lead-in off the graph is joined to the nearest taxi edge within
  // 150 m by a generated lead-in that crosses no building.
  const stands: DraftStand[] = [];
  const standWay = new Map<DraftStand, OsmWay>();
  const join = (stand: DraftStand, target: string) => {
    const p = nodes.get(target)!.pos;
    const skip = containing([stand.pos]);
    const near = nearestTaxi(p, rules.standJoinM, 0, (q) => !crossesBuilding(q, p, skip));
    if (!near) return false;
    const root = splitAt(near.edge, near.along, `${target}/root`);
    if (root !== target) {
      const edge: DraftEdge = {
        from: root,
        to: target,
        line: [nodes.get(root)!.pos, p],
        kind: 'lead_in',
        layer: 0,
        tag: {},
        osmIds: stand.osmIds,
        generated: true,
        stand,
      };
      edges.push(edge);
      stand.leadIn.unshift(edge);
    }
    return true;
  };
  for (const w of standWays) {
    const ids = w.nd.filter((r, i) => r !== w.nd[i - 1]);
    const on = ids.flatMap((r, i) => (onGraph(r) ? [i] : []));
    // The lead-in runs from the graph to the stop: from the graph node nearest a free end.
    let path = ids;
    let pass = false;
    if (!on.length) {
      const to = (r: number) => nearestTaxi(positions.get(r)!, Infinity, 0)?.away ?? Infinity;
      if (to(ids.at(-1)!) < to(ids[0]!)) path = [...ids].reverse();
    } else if (on.at(-1)! < ids.length - 1 && on[0]! > 0) {
      const head = ids.slice(0, on[0]! + 1).reverse(),
        tail = ids.slice(on.at(-1));
      const length = (p: number[]) => polylineLength(p.map((r) => positions.get(r)!));
      path = length(head) > length(tail) ? head : tail;
    } else if (on.at(-1)! < ids.length - 1) path = ids.slice(on.at(-1));
    else if (on[0]! > 0) path = ids.slice(0, on[0]! + 1).reverse();
    else {
      path = ids.slice(on[0], on[1]! + 1);
      pass = true;
    }
    const line = path.map((r) => positions.get(r)!);
    const stand: DraftStand = {
      ...(w.tag.ref ? { ref: w.tag.ref } : {}),
      pos: pass
        ? pointAtDistance(line, cumulativeLengths(line), polylineLength(line) / 2)
        : line.at(-1)!,
      heading: heading(line.at(-2)!, line.at(-1)!),
      leadIn: [],
      tag: w.tag,
      osmIds: [w.id],
    };
    const edge: DraftEdge = {
      from: addNode(path[0]!),
      to: addNode(path.at(-1)!),
      line,
      kind: 'lead_in',
      layer: osmLayer(w.tag) ?? 0,
      tag: w.tag,
      osmIds: [w.id],
      stand,
    };
    stand.leadIn.push(edge);
    if (!on.length && !join(stand, edge.from)) {
      unjoined.push(`way/${w.id}`);
      continue;
    }
    edges.push(edge);
    stands.push(stand);
    standWay.set(stand, w);
  }
  for (const n of aeroNodes('parking_position')) {
    const p = positions.get(n.id)!;
    const match = stands
      .filter(
        (s) => s.osmIds.length === 1 && (s.ref === undefined || norm(s.ref) === norm(n.tag.ref)),
      )
      .map((s) => ({ s, away: distance(s.pos, p) }))
      .filter(({ s, away }) => away <= rules.standMatchM || standWay.get(s)?.nd.includes(n.id))
      .sort(
        (a, b) => Number(b.s.ref !== undefined) - Number(a.s.ref !== undefined) || a.away - b.away,
      )[0];
    if (match) {
      match.s.osmIds.push(n.id);
      match.s.tag = { ...match.s.tag, ...n.tag };
      if (n.tag.ref) match.s.ref = n.tag.ref;
      continue;
    }
    const stand: DraftStand = {
      ...(n.tag.ref ? { ref: n.tag.ref } : {}),
      pos: p,
      heading: 0,
      leadIn: [],
      tag: n.tag,
      osmIds: [n.id],
    };
    const key = graphKey(n.id);
    if (onGraph(n.id)) {
      const edge = edges.find((e) => e.to === key) ?? edges.find((e) => e.from === key)!;
      stand.heading = edge.to === key ? heading(edge.line.at(-2)!, p) : heading(edge.line[1]!, p);
    } else {
      addNode(n.id);
      if (!join(stand, key)) {
        nodes.delete(key);
        unjoined.push(`node/${n.id}`);
        continue;
      }
      stand.heading = heading(stand.leadIn[0]!.line[0]!, p);
    }
    stands.push(stand);
  }
  if (unjoined.length)
    diagnostics.push({
      severity: 'warning',
      code: 'airport_unjoined',
      refs: unjoined.slice(0, 20),
      message: `${unjoined.length} stands or holding positions lie beyond the join distance of every taxi edge (stands ${rules.standJoinM} m, holds ${rules.holdJoinM} m) and are left out`,
    });

  // Surfaces, terminals and their detached groups, gates, hangars.
  const surfaceAreas = areas(
    (tag) =>
      tag.aeroway === 'apron' ||
      (tag.aeroway === 'helipad' && tag.area !== 'no') ||
      ((tag.area === 'yes' || tag.type === 'multipolygon') &&
        ['runway', 'taxiway', 'taxilane', 'turn_pad', 'helipad'].includes(tag.aeroway ?? '')),
  );
  const surfaces: AirsideSurface[] = surfaceAreas.map(({ id, tag, rings }) => ({
    kind: tag.aeroway as AirsideSurface['kind'],
    rings,
    ...(tag.name ? { name: tag.name } : {}),
    ...(tag.ref ? { ref: tag.ref } : {}),
    ...(tag.surface ? { surface: tag.surface } : {}),
    osmId: id,
  }));
  const terminalAreas = areas((tag) => tag.aeroway === 'terminal' || tag.building === 'terminal');
  const group = terminalAreas.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : root(group[i]!));
  for (let i = 0; i < terminalAreas.length; i++)
    for (let j = i + 1; j < terminalAreas.length; j++)
      if (
        ringDistance(terminalAreas[i]!.rings[0]!, terminalAreas[j]!.rings[0]!) <=
        rules.terminalGroupM
      )
        group[root(j)] = root(i);
  const groupNumber = new Map<number, number>();
  terminalAreas.forEach((_, i) => {
    if (!groupNumber.has(root(i))) groupNumber.set(root(i), groupNumber.size);
  });
  const gates = aeroNodes('gate').map((n) => {
    const pos = positions.get(n.id)!;
    const terminal = terminalAreas
      .map((t, i) => ({ i, away: pointToRing(pos, t.rings[0]!) }))
      .filter(({ away }) => away <= 100)
      .sort((a, b) => a.away - b.away)[0]?.i;
    return { n, pos, terminal };
  });
  const hangars = areas((tag) => tag.aeroway === 'hangar' || tag.building === 'hangar').map(
    ({ id, tag, rings }) => ({
      rings,
      ...(tag.name ? { name: tag.name } : {}),
      ...(tag.ref ? { ref: tag.ref } : {}),
      osmId: id,
    }),
  );

  // Stand kinds: cargo or general aviation by the stand's or its apron's tags and name; then
  // contact where a gate of its ref lies within 250 m; maintenance by tags, name or within 60 m
  // of a hangar; else remote.
  const aprons = surfaceAreas.filter(({ tag }) => tag.aeroway === 'apron');
  const reads = (tag: OsmTags, kind: 'cargo' | 'general_aviation' | 'maintenance') => {
    const words = `${tag.name ?? ''} ${tag.description ?? ''}`;
    if (kind === 'cargo')
      return tag.cargo === 'yes' || tag.apron === 'cargo' || /\b(cargo|freight)\b/i.test(words);
    if (kind === 'general_aviation')
      return (
        tag.apron === 'general_aviation' ||
        /\b(GA|general aviation|business aviation|executive|FBO)\b/i.test(words)
      );
    return tag.apron === 'maintenance' || /\b(maintenance|hangar)\b/i.test(words);
  };
  for (const stand of stands) {
    const tags = [
      stand.tag,
      ...aprons.filter((a) => pointInPolygon(stand.pos, close(a.rings[0]!))).map((a) => a.tag),
    ];
    const gate = gates
      .map((g, i) => ({ i, g, away: distance(g.pos, stand.pos) }))
      .filter(
        ({ g, away }) =>
          stand.ref !== undefined && norm(g.n.tag.ref) === norm(stand.ref) && away <= rules.gateM,
      )
      .sort((a, b) => a.away - b.away)[0];
    if (gate) stand.gate = gate.i;
    stand.kind = tags.some((t) => reads(t, 'cargo'))
      ? 'cargo'
      : tags.some((t) => reads(t, 'general_aviation'))
        ? 'general_aviation'
        : gate
          ? 'contact'
          : tags.some((t) => reads(t, 'maintenance')) ||
              hangars.some((h) => pointToRing(stand.pos, h.rings[0]!) <= rules.hangarM)
            ? 'maintenance'
            : 'remote';
  }

  // A stand's code: the largest whose aircraft keeps the stand clearance from the same code's
  // aircraft on every other stand and from every building but one it stands in.
  for (const stand of stands) stand.code = standCode(stand, stands, obstacles);

  // A taxi edge's code: the lower of what its mapped width allows and the largest code whose
  // separations hold along it (`taxiEdgeCodes`).
  const nodeEdges = incidentEdges();
  const inferredCode = largest((c) => runways.some((r) => r.code === c)) ?? 'F';
  const coded = edges.map((edge) => ({ ...edge, mappedWidthM: metres(edge.tag.width), edge }));
  for (const [{ edge }, code] of taxiEdgeCodes(coded, obstacles, inferredCode, coded))
    edge.code = code;

  // What stays apart from the runways' component, and why.
  const component = new Map<string, number>();
  let count = 0;
  for (const key of nodeEdges.keys()) {
    if (component.has(key)) continue;
    const queue = [key];
    component.set(key, count);
    while (queue.length)
      for (const edge of nodeEdges.get(queue.pop()!)!)
        for (const next of ends(edge))
          if (!component.has(next)) {
            component.set(next, count);
            queue.push(next);
          }
    count++;
  }
  const runwayLength = new Array<number>(count).fill(0);
  for (const runway of runways)
    for (const edge of runway.edges)
      runwayLength[component.get(edge.from)!]! += polylineLength(edge.line);
  const main = runwayLength.indexOf(Math.max(...runwayLength));
  const apart = new Map<number, DraftEdge[]>();
  for (const edge of edges) {
    const c = component.get(edge.from)!;
    if (c !== main) apart.set(c, [...(apart.get(c) ?? []), edge]);
  }
  for (const list of apart.values()) {
    let gap = Infinity,
      crossing = false;
    for (const edge of list)
      for (const other of edges) {
        if (component.get(other.from) !== main) continue;
        for (const p of edge.line) gap = Math.min(gap, nearestOnPolyline(other.line, p).away);
        for (let i = 1; i < edge.line.length; i++)
          for (let j = 1; j < other.line.length; j++)
            crossing ||=
              other.layer === edge.layer &&
              segmentsIntersect(
                edge.line[i - 1]!,
                edge.line[i]!,
                other.line[j - 1]!,
                other.line[j]!,
              );
      }
    const ids = [...new Set(list.flatMap((e) => e.osmIds))];
    diagnostics.push({
      severity: 'warning',
      code: 'airport_disconnected',
      refs: ids.slice(0, 20).map((id) => `way/${id}`),
      message: `${list.length} airside edges (OSM ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ' and more' : ''}) are apart from the runways' network: ${crossing ? 'they cross it without a shared node' : `${gap.toFixed(1)} m away at the closest`}`,
    });
  }

  // Ids, in a fixed order: terminals, gates, runways, stands, nodes, edges, holds, helipads.
  const airport: Airport = {
    name: null,
    nodes: {},
    edges: {},
    runways: {},
    holdingPositions: {},
    stands: {},
    gates: {},
    terminals: {},
    helipads: {},
    surfaces,
    hangars,
    windsocks: [],
    approachAids: [],
    turnPads: [],
    roadCrossings: [],
  };
  const aerodrome = areas((tag) => tag.aeroway === 'aerodrome')
    .map((a) => ({ ...a, size: Math.abs(signedArea(a.rings[0]!)) }))
    .sort((a, b) => b.size - a.size)[0];
  if (aerodrome) {
    airport.name = aerodrome.tag.name ?? null;
    if (aerodrome.tag.iata) airport.iata = aerodrome.tag.iata;
    if (aerodrome.tag.icao) airport.icao = aerodrome.tag.icao;
    airport.boundary = aerodrome.rings;
  }
  const terminalIds = terminalAreas.map(({ id, tag, rings }, i) => {
    const tid = allocateId(city, 'tm');
    airport.terminals[tid] = {
      id: tid,
      ...(tag.name ? { name: tag.name } : {}),
      rings,
      group: groupNumber.get(root(i))!,
      osmId: id,
    };
    return tid;
  });
  const gateIds = gates.map(({ n, pos, terminal }) => {
    const gid = allocateId(city, 'gt');
    airport.gates[gid] = {
      id: gid,
      ...(n.tag.ref ? { ref: n.tag.ref } : {}),
      pos,
      terminal: terminal === undefined ? null : terminalIds[terminal]!,
      osmId: n.id,
    };
    return gid;
  });
  const runwayIds = new Map(runways.map((r) => [r, allocateId(city, 'rw')]));
  for (const stand of stands) stand.id = allocateId(city, 'st');
  const nodeIds = new Map<string, string>();
  for (const node of nodes.values()) {
    const incident = nodeEdges.get(node.key);
    if (!incident) continue;
    const nid = allocateId(city, 'an');
    nodeIds.set(node.key, nid);
    const tag = node.osmId === undefined ? undefined : source.get(node.osmId)!.tag;
    const layers = incident.map((e) => e.layer);
    airport.nodes[nid] = {
      id: nid,
      pos: node.pos,
      layer:
        tag?.layer !== undefined
          ? (osmLayer(tag) ?? 0)
          : layers.includes(0)
            ? 0
            : Math.min(...layers),
      ...(node.osmId === undefined ? {} : { osmId: node.osmId }),
      provenance: node.generated
        ? { source: 'generated' }
        : { source: 'osm', osmIds: [node.osmId!] },
    };
  }
  const edgeIds = new Map<DraftEdge, string>();
  for (const edge of edges) {
    const eid = allocateId(city, 'ae');
    edgeIds.set(edge, eid);
    const mapped = metres(edge.tag.width);
    const code =
      edge.kind === 'runway'
        ? edge.runway
          ? edge.runway.code
          : largest((c) => rules.runwayWidthM[c] <= (mapped ?? 0))
        : edge.kind === 'lead_in'
          ? edge.stand!.code!
          : edge.code!;
    const widthM =
      edge.kind === 'runway'
        ? (edge.runway?.widthM ?? mapped ?? rules.runwayWidthM.C)
        : (mapped ?? rules.taxiwayWidthM[code ?? 'A']);
    const widthMapped =
      edge.kind === 'runway' && edge.runway ? !edge.runway.widthInferred : mapped !== undefined;
    const inferred = [...(widthMapped ? [] : ['widthM']), 'maxCode'];
    airport.edges[eid] = {
      id: eid,
      from: nodeIds.get(edge.from)!,
      to: nodeIds.get(edge.to)!,
      line: edge.line,
      kind: edge.kind,
      layer: edge.layer,
      widthM,
      maxCode: code,
      ...(edge.tag.ref ? { ref: edge.tag.ref } : {}),
      ...(edge.tag.name ? { name: edge.tag.name } : {}),
      ...(edge.tag.surface ? { surface: edge.tag.surface } : {}),
      ...(['yes', '-1'].includes(edge.tag.oneway ?? '') ? { oneway: true as const } : {}),
      ...(edge.runway ? { runway: runwayIds.get(edge.runway)! } : {}),
      ...(edge.stand ? { stand: edge.stand.id! } : {}),
      provenance: { source: edge.generated ? 'generated' : 'osm', osmIds: edge.osmIds, inferred },
    };
  }
  for (const runway of runways) {
    const rid = runwayIds.get(runway)!;
    airport.runways[rid] = {
      id: rid,
      ref: runway.ref,
      ends: runway.designators.map((designator, i) => {
        const at = nodes.get(runway.endKeys[i]!)!.pos,
          other = nodes.get(runway.endKeys[1 - i]!)!.pos;
        const threshold = runway.thresholds[i]!;
        return {
          designator,
          node: nodeIds.get(runway.endKeys[i]!)!,
          pos: at,
          threshold: { node: nodeIds.get(threshold.key)!, pos: nodes.get(threshold.key)!.pos },
          displacedM: threshold.along,
          heading: heading(at, other),
        };
      }) as [RunwayEnd, RunwayEnd],
      edges: runway.edges.map((e) => edgeIds.get(e)!),
      lengthM: runway.edges.reduce((sum, e) => sum + polylineLength(e.line), 0),
      widthM: runway.widthM,
      ...(runway.surface ? { surface: runway.surface } : {}),
      maxCode: runway.code,
      stopways: runway.stopways,
      osmIds: runway.ways,
      provenance: {
        source: 'osm',
        osmIds: runway.ways,
        inferred: [
          ...(runway.refInferred ? ['ref'] : []),
          ...(runway.widthInferred ? ['widthM'] : []),
          'maxCode',
        ],
      },
    };
  }

  // A runway hold protects the runway the graph reaches first from it (within 1 km), on the side
  // of that runway it lies; `toward` is its first edge on the way. An untyped hold is a runway
  // hold when that runway is within 300 m of travel.
  const runwayAt = new Map<string, DraftRunway>();
  for (const runway of runways)
    for (const edge of runway.edges) for (const key of ends(edge)) runwayAt.set(key, runway);
  const firstRunway = (start: string) => {
    const found = new Map([[start, 0]]);
    const via = new Map<string, DraftEdge>();
    const queue = [start];
    while (queue.length) {
      queue.sort((a, b) => found.get(b)! - found.get(a)!);
      const at = queue.pop()!;
      if (at !== start && runwayAt.has(at))
        return { runway: runwayAt.get(at)!, edge: via.get(at)!, travel: found.get(at)! };
      for (const edge of nodeEdges.get(at) ?? []) {
        if (edge.kind === 'lead_in') continue;
        const next = edge.from === at ? edge.to : edge.from;
        const d = found.get(at)! + polylineLength(edge.line);
        if (d > rules.holdSearchM || d >= (found.get(next) ?? Infinity)) continue;
        found.set(next, d);
        via.set(next, via.get(at) ?? edge);
        queue.push(next);
      }
    }
    return undefined;
  };
  for (const n of aeroNodes('holding_position')) {
    const key = holdKeys.get(n.id);
    if (key === undefined) continue;
    const hid = allocateId(city, 'hp');
    const typed = n.tag['holding_position:type'];
    const on = runwayAt.get(key);
    const reached = typed === 'intermediate' || on ? undefined : firstRunway(key);
    const runway =
      typed === 'intermediate'
        ? undefined
        : (on ??
          (typed === 'runway' || (reached && reached.travel <= rules.untypedHoldM)
            ? reached?.runway
            : undefined));
    let side: HoldingPosition['side'] = null;
    if (runway) {
      const a = nodes.get(runway.endKeys[0])!.pos,
        b = nodes.get(runway.endKeys[1])!.pos,
        p = nodes.get(key)!.pos;
      side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0 ? 'right' : 'left';
    }
    const inferred = typed === 'runway' || typed === 'intermediate' ? [] : ['kind'];
    airport.holdingPositions[hid] = {
      id: hid,
      node: nodeIds.get(key)!,
      ...(n.tag.ref ? { ref: n.tag.ref } : {}),
      kind: runway ? 'runway' : 'intermediate',
      runway: runway ? runwayIds.get(runway)! : null,
      side,
      toward: runway && reached ? edgeIds.get(reached.edge)! : null,
      osmId: n.id,
      provenance: nodes.get(key)!.generated
        ? { source: 'generated', osmIds: [n.id], inferred: ['node', ...inferred] }
        : { source: 'osm', osmIds: [n.id], inferred },
    };
  }
  for (const stand of stands)
    airport.stands[stand.id!] = {
      id: stand.id!,
      ...(stand.ref ? { ref: stand.ref } : {}),
      kind: stand.kind!,
      pos: stand.pos,
      heading: stand.heading,
      leadIn: stand.leadIn.map((e) => edgeIds.get(e)!),
      gate: stand.gate === undefined ? null : gateIds[stand.gate]!,
      maxCode: stand.code!,
      osmIds: stand.osmIds,
      provenance: { source: 'osm', osmIds: stand.osmIds, inferred: ['kind', 'maxCode'] },
    };
  for (const n of aeroNodes('helipad')) {
    const hid = allocateId(city, 'hl');
    airport.helipads[hid] = {
      id: hid,
      pos: positions.get(n.id)!,
      ...(n.tag.ref ? { ref: n.tag.ref } : {}),
      ...(n.tag.name ? { name: n.tag.name } : {}),
      osmId: n.id,
    };
  }
  for (const s of surfaces.filter((s) => s.kind === 'helipad')) {
    const hid = allocateId(city, 'hl');
    const ring = s.rings[0]!;
    airport.helipads[hid] = {
      id: hid,
      pos: {
        x: ring.reduce((t, p) => t + p.x, 0) / ring.length,
        y: ring.reduce((t, p) => t + p.y, 0) / ring.length,
      },
      ring,
      ...(s.ref ? { ref: s.ref } : {}),
      ...(s.name ? { name: s.name } : {}),
      osmId: s.osmId,
    };
  }
  airport.windsocks = aeroNodes('windsock').map((n) => ({
    pos: positions.get(n.id)!,
    ...(n.tag.lit ? { lit: n.tag.lit === 'yes' } : {}),
    osmId: n.id,
  }));
  const thresholds = runways.flatMap((runway) =>
    runway.designators.map((designator, i) => ({
      runway,
      designator,
      pos: nodes.get(runway.thresholds[i]!.key)!.pos,
    })),
  );
  airport.approachAids = aeroNodes('navigationaid').map((n) => {
    const pos = positions.get(n.id)!;
    const facing = (Number(n.tag.direction) * Math.PI) / 180;
    const end = thresholds
      .map((t) => ({ t, away: distance(t.pos, pos) }))
      .filter(({ away }) => away <= rules.aidM)
      .sort((a, b) => a.away - b.away)[0]?.t;
    return {
      kind: n.tag.navigationaid ?? 'unknown',
      pos,
      ...(Number.isFinite(facing) && n.tag.direction?.trim()
        ? { facing: Math.atan2(-Math.cos(facing), Math.sin(facing)) }
        : {}),
      ...(end ? { runway: runwayIds.get(end.runway)!, end: end.designator } : {}),
      osmId: n.id,
    };
  });
  airport.roadCrossings = roadCrossings(city, data, airport);
  airport.turnPads = aeroNodes('turn_pad').map((n) => ({
    pos: positions.get(n.id)!,
    ...(nodeIds.has(graphKey(n.id)) ? { node: nodeIds.get(graphKey(n.id))! } : {}),
    osmId: n.id,
  }));
  const jetBridges = readJetBridges(data, positions, bounds, airport);
  if (jetBridges.length) airport.jetBridges = jetBridges;
  city.airport = airport;
}

/** TASK-319: orient each mapped bridge from its gate or terminal toward the apron. */
export function readJetBridges(
  data: OsmData,
  positions: ReadonlyMap<number, Vec2>,
  bounds: Bounds,
  airport: Pick<Airport, 'terminals' | 'stands' | 'gates'>,
): NonNullable<Airport['jetBridges']> {
  const ways = data.way.filter((w) => isJetBridge(w) && w.tag.area !== 'yes');
  if (!ways.length) return [];
  const gates = new Set(data.node.filter((n) => n.tag.aeroway === 'gate').map((n) => n.id));
  const importedGates = new Map(Object.values(airport.gates).map((gate) => [gate.osmId, gate.id]));
  const terminals = Object.values(airport.terminals);
  const stands = Object.values(airport.stands);
  const terminalDistance = (p: Vec2) =>
    terminals.reduce((d, t) => Math.min(d, pointToRing(p, t.rings[0]!)), Infinity);
  const nearestStand = (p: Vec2, gate?: string) => {
    let id: string | null = null;
    let away = Infinity;
    for (const stand of stands) {
      if (gate && stand.gate !== gate) continue;
      const d = distance(p, stand.pos);
      if (d < away) {
        away = d;
        id = stand.id;
      }
    }
    return { id, away };
  };
  return ways.flatMap((w) => {
    const points = w.nd.map((id) => positions.get(id));
    if (points.some((p) => !p) || !points.some((p) => contains(bounds, p!))) return [];
    const line = (points as Vec2[]).filter((p, i, all) => i === 0 || distance(p, all[i - 1]!) > 0);
    if (line.length < 2 || distance(line[0]!, line.at(-1)!) === 0) return [];
    const firstGate = gates.has(w.nd[0]!);
    const lastGate = gates.has(w.nd.at(-1)!);
    const firstTerminal = terminalDistance(line[0]!);
    const lastTerminal = terminalDistance(line.at(-1)!);
    const firstStand = nearestStand(line[0]!);
    const lastStand = nearestStand(line.at(-1)!);
    const reverse =
      firstGate !== lastGate
        ? lastGate
        : lastTerminal < firstTerminal ||
          (lastTerminal === firstTerminal && firstStand.away < lastStand.away);
    if (reverse) line.reverse();
    const gate = importedGates.get(reverse ? w.nd.at(-1)! : w.nd[0]!);
    // The mapped gate distinguishes adjacent stands whose noses are close to the bridge tip.
    const stand =
      (gate ? nearestStand(line.at(-1)!, gate).id : null) ?? (reverse ? firstStand : lastStand).id;
    return [{ osmId: w.id, line, stand }];
  });
}

/** Roads crossing airside edges at grade: at a node a road's OSM way shares with an edge's, the
 * directed roads of that way passing within 5 m of it; then where a road's centreline crosses an
 * edge's line on the same layer, at least 5 m from a crossing already found on that edge (1 m
 * from one on another: the node two edges share). */
function roadCrossings(city: City, data: OsmData, airport: Airport): RoadCrossing[] {
  const crossings: RoadCrossing[] = [];
  const roads = Object.values(city.roads);
  const layerOf = (road: Road) =>
    road.layer ?? Math.min(city.nodes[road.from]!.layer, city.nodes[road.to]!.layer);
  const edges = Object.values(airport.edges);
  const roadIndex = new Flatbush(Math.max(1, roads.length));
  for (const road of roads) {
    const xs = road.centerline.map((p) => p.x),
      ys = road.centerline.map((p) => p.y);
    roadIndex.add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  if (!roads.length) roadIndex.add(0, 0, 0, 0);
  roadIndex.finish();
  const add = (edge: string, pos: Vec2, found: Road[], osmId?: number) => {
    const near = (c: RoadCrossing) => distance(c.pos, pos) < (c.edge === edge ? 5 : 1);
    if (crossings.some(near)) return;
    const ids = [...new Set(found.map((r) => r.id))].sort();
    crossings.push({
      edge,
      pos,
      roads: ids,
      roadOsmIds: [...new Set(found.flatMap((r) => r.provenance.osmIds ?? []))].sort(
        (a, b) => a - b,
      ),
      ...(osmId === undefined ? {} : { osmId }),
    });
  };
  const graphOsm = new Map<number, string>();
  for (const edge of edges)
    if (edge.kind !== 'lead_in')
      for (const node of [airport.nodes[edge.from]!, airport.nodes[edge.to]!])
        if (node.osmId !== undefined && !graphOsm.has(node.osmId))
          graphOsm.set(node.osmId, edge.id);
  for (const way of data.way) {
    if (!way.tag.highway) continue;
    for (const ref of way.nd) {
      const edge = graphOsm.get(ref);
      if (!edge) continue;
      const pos = Object.values(airport.nodes).find((n) => n.osmId === ref)!.pos;
      const found = roadIndex
        .search(pos.x - 5, pos.y - 5, pos.x + 5, pos.y + 5)
        .map((i) => roads[i]!)
        .filter(
          (r) =>
            r.provenance.osmIds?.includes(way.id) && nearestOnPolyline(r.centerline, pos).away <= 5,
        );
      if (found.length) add(edge, pos, found, ref);
    }
  }
  for (const edge of edges) {
    if (edge.kind === 'lead_in') continue;
    const xs = edge.line.map((p) => p.x),
      ys = edge.line.map((p) => p.y);
    const hits: { pos: Vec2; road: Road }[] = [];
    for (const i of roadIndex.search(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    )) {
      const road = roads[i];
      if (!road || layerOf(road) !== edge.layer) continue;
      for (let j = 1; j < edge.line.length; j++)
        for (let k = 1; k < road.centerline.length; k++) {
          const pos = segmentIntersection(
            edge.line[j - 1]!,
            edge.line[j]!,
            road.centerline[k - 1]!,
            road.centerline[k]!,
          );
          if (pos) hits.push({ pos, road });
        }
    }
    // The directed roads of one street cross a few metres apart: one crossing for them all.
    for (const hit of hits) {
      if (crossings.some((c) => c.edge === edge.id && distance(c.pos, hit.pos) < 5)) continue;
      add(
        edge.id,
        hit.pos,
        hits.filter((h) => distance(h.pos, hit.pos) < 15).map((h) => h.road),
      );
    }
  }
  return crossings;
}

function signedArea(ring: Vec2[]) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
