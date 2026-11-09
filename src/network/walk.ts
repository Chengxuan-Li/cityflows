import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  nearestOnPolyline,
  offsetPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineCrossings,
  polylineLength,
  segmentIntersection,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City, WalkKind } from '../schema';
import { crossingArms, crossingEnabled, crossingPlacement } from './crossings';
import { junctionCorners } from './junctions';
import { curbJoin, walkComponents, walkRoots, uncoveredCurb } from './walk-joins';
import type { CompiledCity, CRoad } from './types';

export interface CWalkNode {
  idx: number;
  pos: Vec2;
  layer: number;
  links: number[];
  sourceIds: string[];
}
export interface CWalkLink {
  idx: number;
  id: string;
  from: number;
  to: number;
  line: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
  widthM: number;
  layer: number;
  kind: WalkKind | 'sidewalk' | 'corner' | 'access';
  generated: boolean;
  road?: number;
  side?: 'left' | 'right';
  node?: number;
  crossing?: {
    road: number;
    end: 'start' | 'end' | 'midblock';
    control: 'zebra' | 'signal';
    /** TASK-111: the node and its arm (`crossingArms` index) the crossing serves; -1 for a
     * midblock zebra. */
    node: number;
    arm: number;
    /** TASK-111: where this link crosses each lane it crosses, in compiled lane order. */
    spans: CrossingSpan[];
  };
}
/** TASK-111: a crossing link over one lane. `atM` is along the lane where the link meets its
 * centreline, `halfM` half the stripes' extent along the lane; `linkM` and `linkHalfM` the same
 * along the link for the lane's width. */
export interface CrossingSpan {
  lane: number;
  atM: number;
  halfM: number;
  linkM: number;
  linkHalfM: number;
}
export interface WalkGraph {
  nodes: CWalkNode[];
  links: CWalkLink[];
  places: Map<string, number[]>;
  parking: Map<string, number[]>;
  connectors: Map<string, number>;
  sourceNodes: Map<string, number>;
}
type Raw = Omit<CWalkLink, 'idx' | 'from' | 'to' | 'cumulative' | 'lengthM'> & {
  cuts: number[];
  sourceEnds?: [string, string];
  endpointLayers?: [number, number];
};
const SIDES = ['left', 'right'] as const;
const SNAP_M = 4;
const ACCESS_M = 150;
export const emptyWalkGraph = (): WalkGraph => ({
  nodes: [],
  links: [],
  places: new Map(),
  parking: new Map(),
  connectors: new Map(),
  sourceNodes: new Map(),
});

function spatial(lines: readonly Vec2[][]) {
  const tree = new Flatbush(Math.max(1, lines.length));
  for (const line of lines) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of line) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    tree.add(x0, y0, x1, y1);
  }
  if (!lines.length) tree.add(0, 0, 0, 0);
  tree.finish();
  return tree;
}

/** Exact nearest-point queries for the repeated polygon/curb projections used by access. */
function prepareNearest(line: Vec2[]) {
  if (line.length < 8) return (p: Vec2) => nearestOnPolyline(line, p);
  const segments = line
    .slice(1)
    .flatMap((b, i) => (b.x === line[i]!.x && b.y === line[i]!.y ? [] : [[line[i]!, b]]));
  if (!segments.length) return (p: Vec2) => nearestOnPolyline(line, p);
  const tree = spatial(segments);
  const boxes = segments.map(([a, b]) => [
    Math.min(a!.x, b!.x),
    Math.min(a!.y, b!.y),
    Math.max(a!.x, b!.x),
    Math.max(a!.y, b!.y),
  ]);
  return (p: Vec2) => {
    // Best-first over segment boxes: stop once a box is farther than the best exact distance.
    // Same result and tie-break (lowest index) as scanning every segment (lead, TASK-110 merge:
    // a radius box search cost Sindelfingen's compile 8 times main's).
    let index = -1;
    let best: ReturnType<typeof nearestOnPolyline> | undefined;
    tree.neighbors(p.x, p.y, 1, Infinity, (i) => {
      const [x0, y0, x1, y1] = boxes[i]!;
      const dx = Math.max(x0! - p.x, 0, p.x - x1!),
        dy = Math.max(y0! - p.y, 0, p.y - y1!);
      if (best && Math.hypot(dx, dy) > best.away) return true;
      const n = nearestOnPolyline(segments[i]!, p);
      if (!best || n.away < best.away || (n.away === best.away && i < index)) {
        best = n;
        index = i;
      }
      return false;
    });
    return best!;
  };
}

/** Derived after the vehicle compile; never mutates City or vehicle geometry. */
export function compileWalk(source: City, city: CompiledCity): WalkGraph {
  const raw: Raw[] = [];
  const sidewalks = new Map<string, Raw[]>();
  const joins: { a: Raw; b: Raw; link: Omit<Raw, 'cuts'> }[] = [];
  const layers = city.roads.map(
    (r) =>
      source.roads[r.id]!.layer ??
      Math.min(
        source.nodes[city.nodes[r.from]!.id]!.layer,
        source.nodes[city.nodes[r.to]!.id]!.layer,
      ),
  );
  const layerOf = (r: CRoad) => layers[r.idx]!;
  const incident = city.nodes.map((): CRoad[] => []);
  for (const road of city.roads) {
    incident[road.from]!.push(road);
    incident[road.to]!.push(road);
  }
  // A mapped deck/portal can meet its explicitly shared approach, just as mapped walk
  // links do. This does not infer grade changes between nearby, unrelated roads.
  const gradeApproach = (a: CRoad, b: CRoad, node: number) => {
    const ground = source.nodes[city.nodes[node]!.id]!.layer;
    return (
      layerOf(a) !== layerOf(b) &&
      [layerOf(a), layerOf(b)].includes(ground) &&
      [a, b].some((r) => {
        const original = source.roads[r.id]!;
        return (
          original.layer !== undefined &&
          original.layer !== 0 &&
          original.provenance.source === 'osm'
        );
      })
    );
  };
  const endpointGrade = (r: CRoad, node: number) =>
    incident[node]!.some((other) => gradeApproach(r, other, node))
      ? source.nodes[city.nodes[node]!.id]!.layer
      : layerOf(r);
  const layerAt = (link: Raw, pos: Vec2) => {
    if (!link.sourceEnds && !link.endpointLayers) return link.layer;
    const along = nearestOnPolyline(link.line, pos).along;
    const end = along < 0.05 ? 0 : polylineLength(link.line) - along < 0.05 ? 1 : undefined;
    return end === undefined
      ? link.layer
      : link.sourceEnds
        ? source.walk!.nodes[link.sourceEnds[end]!]!.layer
        : link.endpointLayers![end]!;
  };
  const add = (link: Omit<Raw, 'cuts'>) => {
    const length = polylineLength(link.line);
    if (length < 0.01) return;
    const result = { ...link, cuts: [0, length] };
    raw.push(result);
    return result;
  };
  const on = (link: Raw, pos: Vec2) => {
    const n = nearestOnPolyline(link.line, pos);
    link.cuts.push(n.along);
    return n.point;
  };
  const nearestCache = new Map<Raw, { near: ReturnType<typeof prepareNearest>; box: number[] }>();
  const prepare = (link: Raw) => {
    let prepared = nearestCache.get(link);
    if (!prepared) {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const p of link.line) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      prepared = { near: prepareNearest(link.line), box: [x0, y0, x1, y1] };
      nearestCache.set(link, prepared);
    }
    return prepared;
  };
  const roadTree = spatial(city.roads.map((r) => r.reference));
  const clear = (a: Vec2, b: Vec2, layer: number) => {
    const length = distance(a, b);
    return roadTree
      .search(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))
      .every((i) => {
        const r = city.roads[i];
        // Access may cross a driveway/service aisle; an ordinary street needs a crossing.
        if (!r || r.roadClass === 'service' || layerOf(r) !== layer) return true;
        // polylineCrossings([a, b], reference) without its cumulative lengths of the reference.
        const ref = r.reference;
        for (let j = 1; j < ref.length; j++) {
          const p = ref[j - 1]!,
            q = ref[j]!;
          if (
            Math.max(a.x, b.x) < Math.min(p.x, q.x) ||
            Math.max(p.x, q.x) < Math.min(a.x, b.x) ||
            Math.max(a.y, b.y) < Math.min(p.y, q.y) ||
            Math.max(p.y, q.y) < Math.min(a.y, b.y)
          )
            continue;
          const point = segmentIntersection(a, b, p, q);
          if (!point) continue;
          const along = distance(a, point);
          if (along > 0.2 && along < length - 0.2) return false;
        }
        return true;
      });
  };

  const mappedLinks = Object.values(source.walk?.links ?? {})
    .filter((l) => polylineLength(l.line) >= 0.01)
    .sort((a, b) => a.id.localeCompare(b.id));
  const mappedTree = spatial(mappedLinks.map((l) => l.line));
  const mappedRaw = new Map<string, Raw>();
  const groups = new Map<string, CRoad[]>();
  for (const r of city.roads) {
    const key = r.corridorId ?? r.streetGroupId ?? r.id;
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }
  for (const r of city.roads)
    for (const side of SIDES) {
      const original = source.roads[r.id]!,
        tag = original.sidewalk?.[side];
      if (
        tag === 'no' ||
        ((!tag || tag === 'separate') &&
          ['motorway', 'trunk', 'ramp', 'service'].includes(r.roadClass))
      )
        continue;
      const half = r.surface.length / 2;
      const edge = side === 'left' ? r.surface.slice(0, half) : r.surface.slice(half).reverse();
      const mid = pointAtDistance(edge, cumulativeLengths(edge), polylineLength(edge) / 2);
      const near = nearestOnPolyline(city.lanes[r.lanes[0]!]!.polyline, mid);
      const normal = { x: -near.direction.y, y: near.direction.x },
        sign = side === 'left' ? -1 : 1;
      // Suppress inner sides even when sidewalk=both was copied to both directed roads.
      const internal = groups.get(r.corridorId ?? r.streetGroupId ?? r.id)!.some((other) => {
        if (other === r || layerOf(other) !== layerOf(r)) return false;
        const hit = nearestOnPolyline(city.lanes[other.lanes[0]!]!.polyline, mid);
        const lateral =
          ((hit.point.x - mid.x) * normal.x + (hit.point.y - mid.y) * normal.y) * sign;
        const along = Math.abs(
          (hit.point.x - mid.x) * near.direction.x + (hit.point.y - mid.y) * near.direction.y,
        );
        return (
          lateral > 0.1 &&
          along < 5 &&
          Math.abs(hit.direction.x * near.direction.x + hit.direction.y * near.direction.y) > 0.8
        );
      });
      if (internal) continue;
      const line = (() => {
        const bands = city.strips?.filter((s) => s.road === r.idx && s.side === side) ?? [];
        if (!bands.length) return offsetPolyline(edge, sign);
        const edgeLengths = cumulativeLengths(edge),
          length = edgeLengths.at(-1)!;
        const points = Array.from({ length: Math.ceil(length / 2) + 1 }, (_, i) =>
          pointAtDistance(edge, edgeLengths, Math.min(length, i * 2)),
        );
        return points.map((p) => {
          const station = nearestOnPolyline(r.reference, p).along;
          const width = Math.max(
            0,
            ...bands.filter((s) => station >= s.fromM && station <= s.toM).map((s) => s.widthM),
          );
          const hit = nearestOnPolyline(edge, p);
          return {
            x: p.x - hit.direction.y * sign * (1 + width),
            y: p.y + hit.direction.x * sign * (1 + width),
          };
        });
      })();
      const lines =
        tag === 'separate'
          ? uncoveredCurb(line, (p, heading) => {
              return mappedTree
                .search(p.x - SNAP_M, p.y - SNAP_M, p.x + SNAP_M, p.y + SNAP_M)
                .some((i) => {
                  const link = mappedLinks[i];
                  if (!link) return false;
                  if (
                    link.kind === 'crossing' ||
                    (link.layer ?? source.walk!.nodes[link.from]!.layer) !== layerOf(r)
                  )
                    return false;
                  const near = nearestOnPolyline(link.line, p);
                  return (
                    near.away <= 4 &&
                    Math.abs(
                      near.direction.x * Math.cos(heading) + near.direction.y * Math.sin(heading),
                    ) > 0.8
                  );
                });
            })
          : [line];
      const parts = lines.flatMap((part, i) => {
        const endpointLayers: [number, number] = [
          distance(part[0]!, line[0]!) < 0.05 ? endpointGrade(r, r.from) : layerOf(r),
          distance(part.at(-1)!, line.at(-1)!) < 0.05 ? endpointGrade(r, r.to) : layerOf(r),
        ];
        const s = add({
          id: `sidewalk:${r.id}:${side}${lines.length > 1 ? `:${i}` : ''}`,
          kind: 'sidewalk',
          generated: true,
          road: r.idx,
          side,
          layer: layerOf(r),
          widthM: 2,
          line: part,
          ...(endpointLayers.some((l) => l !== layerOf(r)) ? { endpointLayers } : {}),
        });
        return s ? [s] : [];
      });
      sidewalks.set(`${r.idx}:${side}`, parts);
    }
  for (const link of mappedLinks) {
    const layer = link.layer ?? source.walk!.nodes[link.from]!.layer;
    let crossing: CWalkLink['crossing'];
    if (link.kind === 'crossing') {
      const p = pointAtDistance(
        link.line,
        cumulativeLengths(link.line),
        polylineLength(link.line) / 2,
      );
      const nearest = roadTree
        .neighbors(
          p.x,
          p.y,
          16,
          50,
          (i) => city.roads[i] !== undefined && layerOf(city.roads[i]!) === layer,
        )
        .map((i) => ({
          road: city.roads[i]!,
          near: nearestOnPolyline(city.roads[i]!.reference, p),
        }))
        .sort((a, b) => a.near.away - b.near.away)[0];
      if (nearest) {
        const { road, near } = nearest,
          length = polylineLength(road.reference),
          atEnd = near.along > length / 2;
        const node = city.nodes[atEnd ? road.to : road.from]!;
        const end =
          Math.min(near.along, length - near.along) > 30 ? 'midblock' : atEnd ? 'end' : 'start';
        const control = node.signal && distance(node.pos, p) < 40 ? 'signal' : 'zebra';
        const junction = end !== 'midblock' || control === 'signal';
        crossing = {
          road: road.idx,
          end,
          control,
          node: junction ? node.idx : -1,
          arm: junction
            ? crossingArms(city, node).findIndex((arm) =>
                arm.some((e) => e.road.idx === road.idx && e.atEnd === atEnd),
              )
            : -1,
          spans: [],
        };
      }
    }
    const compiled = add({
      id: link.id,
      line: link.line,
      kind: link.kind,
      generated: false,
      widthM: link.widthM ?? (link.kind === 'pedestrian' ? 3 : 1.5),
      layer,
      ...(crossing ? { crossing, road: crossing.road } : {}),
      sourceEnds: [link.from, link.to],
    });
    if (compiled) mappedRaw.set(link.id, compiled);
  }

  const walkSide = (road: CRoad, side: 'left' | 'right', p: Vec2) => {
    const parts = sidewalks.get(`${road.idx}:${side}`);
    if (source.roads[road.id]!.sidewalk?.[side] !== 'separate') return parts?.[0];
    const generated = parts
      ?.map((s) => ({ s, away: nearestOnPolyline(s.line, p).away }))
      .filter(({ away }) => away <= SNAP_M)
      .sort((a, b) => a.away - b.away)[0]?.s;
    if (generated || source.roads[road.id]!.sidewalk?.[side] !== 'separate') return generated;
    if (!mappedLinks.length) return;
    return mappedTree
      .search(p.x - SNAP_M, p.y - SNAP_M, p.x + SNAP_M, p.y + SNAP_M)
      .map((i) => mappedRaw.get(mappedLinks[i]!.id)!)
      .filter((l) => l.kind !== 'crossing' && l.layer === layerOf(road))
      .map((l) => ({ l, near: nearestOnPolyline(l.line, p) }))
      .filter(({ near }) => near.away <= SNAP_M && clear(p, near.point, layerOf(road)))
      .sort((a, b) => a.near.away - b.near.away)[0]?.l;
  };
  for (const node of city.nodes) {
    const joined = new Set<string>();
    const ends = incident[node.idx]!.flatMap((r) =>
      SIDES.flatMap((side) => {
        const half = r.surface.length / 2;
        const p =
          side === 'left'
            ? r.surface[r.from === node.idx ? 0 : half - 1]!
            : r.surface[r.from === node.idx ? r.surface.length - 1 : half]!;
        const s = walkSide(r, side, p);
        if (!s) return [];
        const pos = s.generated
          ? r.from === node.idx
            ? s.line[0]!
            : s.line.at(-1)!
          : nearestOnPolyline(s.line, p).point;
        return [{ s, r, pos }];
      }),
    );
    for (const [i, corner] of junctionCorners(node).entries()) {
      if (!corner.curve || corner.kind === 'nose' || corner.kind === 'gore') continue;
      const curve = corner.curve;
      const curbSide = (road: number, first: boolean) => {
        const from = city.roads[road]!.from === node.idx;
        return walkSide(
          city.roads[road]!,
          from === first ? 'right' : 'left',
          first ? curve[0]! : curve.at(-1)!,
        );
      };
      const a = curbSide(corner.roads[0], true),
        b = curbSide(corner.roads[1], false);
      if (!a || !b || a === b) continue;
      const graded = a.layer !== b.layer;
      if (
        graded &&
        !gradeApproach(city.roads[corner.roads[0]]!, city.roads[corner.roads[1]]!, node.idx)
      )
        continue;
      let line = offsetPolyline(curve, 1);
      if (pointInPolygon(line[Math.floor(line.length / 2)]!, node.outline, 0))
        line = offsetPolyline(curve, -1);
      line[0] = on(a, line[0]!);
      line[line.length - 1] = on(b, line.at(-1)!);
      const endpointLayers: [number, number] = [layerAt(a, line[0]!), layerAt(b, line.at(-1)!)];
      if (
        graded &&
        line.some(
          (p, i) => i && (!clear(line[i - 1]!, p, a.layer) || !clear(line[i - 1]!, p, b.layer)),
        )
      )
        continue;
      joined.add([a.id, b.id].sort().join('|'));
      const deck = [a, b].find((l) => l.layer !== source.nodes[node.id]!.layer);
      add({
        id: `corner:${node.id}:${i}`,
        line,
        kind: 'corner',
        generated: true,
        widthM: 2,
        layer: graded ? deck!.layer : a.layer,
        node: node.idx,
        ...(graded ? { road: deck!.road } : {}),
        ...(endpointLayers.some((l) => l !== (graded ? deck!.layer : a.layer))
          ? { endpointLayers }
          : {}),
      });
    }
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const { s: a, r: ra, pos: pa } = ends[i]!,
          { s: b, r: rb, pos: pb } = ends[j]!;
        if (a === b) continue;
        if (
          (a.layer !== b.layer && !gradeApproach(ra, rb, node.idx)) ||
          joined.has([a.id, b.id].sort().join('|'))
        )
          continue;
        if (distance(pa, pb) > 12) continue;
        const line = [pa, pb];
        const deck =
          a.layer === b.layer
            ? undefined
            : [a, b].find((l) => l.layer !== source.nodes[node.id]!.layer);
        const link: Omit<Raw, 'cuts'> = {
          id: `seam:${node.id}:${i}:${j}`,
          line,
          kind: 'corner',
          generated: true,
          widthM: 2,
          layer: deck?.layer ?? a.layer,
          node: node.idx,
          ...(deck ? { road: deck.road } : {}),
          ...(a.endpointLayers || b.endpointLayers || a.layer !== b.layer
            ? { endpointLayers: [layerAt(a, pa), layerAt(b, pb)] as [number, number] }
            : {}),
        };
        if (!node.outline.length && ra !== rb && a.layer === b.layer && distance(pa, pb) <= 2.1)
          add(link);
        else joins.push({ a, b, link });
      }
    for (const [i, arm] of crossingArms(city, node).entries()) {
      if (
        arm.some((e) => ['motorway', 'trunk', 'ramp'].includes(e.road.roadClass)) ||
        arm.some((e) => source.roads[e.road.id]!.crossings?.[e.atEnd ? 'end' : 'start'] === false)
      )
        continue;
      const served = arm.find(
        (e) =>
          crossingEnabled(city, e.road, e.atEnd, source) &&
          crossingPlacement(city, e.road, e.atEnd).stripes.length,
      );
      if (!served) continue;
      const { road, atEnd } = served,
        curb = [
          ...new Set(
            ends.filter(({ r }) => arm.some((e) => e.road.idx === r.idx)).map(({ s }) => s),
          ),
        ];
      const placement = crossingPlacement(city, road, atEnd),
        lane = city.lanes[road.lanes[0]!]!;
      const d = (placement.nearM + placement.farM) / 2,
        s = atEnd ? lane.lengthM - d : d;
      const p = pointAtDistance(lane.polyline, lane.cumulative, s),
        heading = headingAtDistance(lane.polyline, lane.cumulative, s);
      const normal = { x: -Math.sin(heading), y: Math.cos(heading) };
      const ray = [-100, 100].map((v) => ({ x: p.x + normal.x * v, y: p.y + normal.y * v }));
      const hits = curb
        .flatMap((s) => polylineCrossings(ray, s.line).map((hit) => ({ s, hit })))
        .sort((a, b) => a.hit.alongA - b.hit.alongA);
      const a = hits[0],
        b = hits.at(-1);
      if (!a || !b || a.s === b.s || a.s.layer !== b.s.layer) continue;
      add({
        id: `crossing:${node.id}:${i}`,
        line: [on(a.s, a.hit.point), on(b.s, b.hit.point)],
        kind: 'crossing',
        generated: true,
        widthM: 2.5,
        layer: a.s.layer,
        crossing: {
          road: road.idx,
          end: atEnd ? 'end' : 'start',
          control: node.signal ? 'signal' : 'zebra',
          node: node.idx,
          arm: i,
          spans: [],
        },
      });
    }
  }
  if (!raw.length) return materializeWalk(source, raw).graph;

  // Segment boxes keep local joins cheap even for long, curved OSM ways.
  const segments = raw.flatMap((link, r) => {
    const lengths = cumulativeLengths(link.line);
    return link.line.slice(1).map((b, i) => ({ r, a: link.line[i]!, b, start: lengths[i]! }));
  });
  const tree = spatial(segments.map((s) => [s.a, s.b]));
  for (const [i, s] of segments.entries())
    for (const j of tree
      .search(
        Math.min(s.a.x, s.b.x),
        Math.min(s.a.y, s.b.y),
        Math.max(s.a.x, s.b.x),
        Math.max(s.a.y, s.b.y),
      )
      .sort((a, b) => a - b)) {
      if (j <= i) continue;
      const t = segments[j]!,
        a = raw[s.r]!,
        b = raw[t.r]!;
      if (a === b || a.layer !== b.layer || (a.kind === 'sidewalk' && b.kind === 'sidewalk'))
        continue;
      const hit = segmentIntersection(s.a, s.b, t.a, t.b);
      if (hit) {
        a.cuts.push(s.start + distance(s.a, hit));
        b.cuts.push(t.start + distance(t.a, hit));
      }
    }
  const pathTree = spatial(raw.map((l) => l.line)),
    baseCount = raw.length;
  const { root, unite } = walkRoots(source, raw);
  for (const generated of [false, true]) {
    if (generated) {
      for (const { a, b, link } of joins.sort(
        (a, b) => polylineLength(a.link.line) - polylineLength(b.link.line),
      )) {
        if (root(a.id) === root(b.id)) continue;
        const line = curbJoin(
          city.nodes[link.node!]!.outline,
          link.line[0]!,
          link.line[1]!,
          (p, q) => clear(p, q, a.layer) && (a.layer === b.layer || clear(p, q, b.layer)),
        );
        if (!line) continue;
        line[0] = on(a, line[0]!);
        line[line.length - 1] = on(b, line.at(-1)!);
        add({ ...link, line });
        unite(a.id, b.id);
      }
    }
    for (let i = 0; i < baseCount; i++) {
      const link = raw[i]!;
      if (link.generated !== generated || (generated && link.kind !== 'sidewalk')) continue;
      for (const [end, p] of [link.line[0]!, link.line.at(-1)!].entries()) {
        const endpointLayer = link.sourceEnds
          ? source.walk!.nodes[link.sourceEnds[end]!]!.layer
          : (link.endpointLayers?.[end] ?? link.layer);
        const candidates = pathTree
          .neighbors(p.x, p.y, 32, SNAP_M, (j) => {
            if (
              j === i ||
              (raw[j]!.layer !== endpointLayer && !raw[j]!.endpointLayers?.includes(endpointLayer))
            )
              return false;
            if (link.generated && root(link.id) === root(raw[j]!.id)) return false;
            if (link.generated && raw[j]!.kind !== 'sidewalk' && raw[j]!.generated) return false;
            const own = source.walk?.links[link.id]?.provenance.osmIds;
            const other = source.walk?.links[raw[j]!.id]?.provenance.osmIds;
            return !own?.some((id) => other?.includes(id));
          })
          .map((j) => ({ target: raw[j]!, near: prepare(raw[j]!).near(p) }))
          .sort((a, b) => a.near.away - b.near.away);
        for (const best of candidates)
          if (
            (!link.generated || root(link.id) !== root(best.target.id)) &&
            best.near.away <= SNAP_M &&
            layerAt(best.target, best.near.point) === endpointLayer &&
            (link.kind === 'crossing' || clear(p, best.near.point, endpointLayer))
          ) {
            add({
              id: `join:${i}:${end}:${best.target.id}`,
              line: [p, on(best.target, p)],
              kind: 'access',
              generated: true,
              widthM: 1.5,
              layer: endpointLayer,
            });
            unite(link.id, best.target.id);
          }
      }
    }
  }
  const anchors: {
    pos: Vec2;
    layer: number;
    type: 'places' | 'parking' | 'connectors';
    id: string;
  }[] = [];
  // Prefer the connected public network for access, as the importer already does for car
  // connectors. Retain isolated mapped paths, but do not strand a door on a courtyard stub
  // when a reachable path is also within the short access radius.
  const preliminary = materializeWalk(source, raw).graph;
  const { labels, core } = walkComponents(preliminary);
  const coreLinks = new Set(
    preliminary.links
      .filter((l) => labels[l.from] === core)
      .map((l) => l.id.slice(0, l.id.lastIndexOf('/'))),
  );
  const isCore = (i: number) => coreLinks.has(raw[i]!.id);
  const attached = new Map<string, Vec2>();
  const attach = (
    id: string,
    type: 'places' | 'parking' | 'connectors',
    shape: { kind: 'point'; pos: Vec2 } | { kind: 'polygon'; ring: Vec2[] },
    layer = 0,
    preferred?: Vec2,
  ) => {
    const points = shape.kind === 'point' ? [shape.pos] : [...shape.ring, shape.ring[0]!];
    const nearShape = shape.kind === 'polygon' ? prepareNearest(points) : undefined;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const candidates = pathTree
      .search(x0 - ACCESS_M, y0 - ACCESS_M, x1 + ACCESS_M, y1 + ACCESS_M)
      .filter((j) => raw[j]!.layer === layer && raw[j]!.kind !== 'crossing');
    let best: { target: Raw; a: Vec2; b: Vec2; away: number; core: boolean } | undefined;
    for (const j of candidates.sort((a, b) => a - b)) {
      const target = raw[j]!,
        probes = [...points];
      const targetCore = isCore(j);
      const prepared = prepare(target);
      if (best) {
        // Every probe lies in the shape's box, so the per-probe tests below would reject this
        // whole target; skip its polygon projections (lead, TASK-110 merge: compile time).
        if (best.core && !targetCore) continue;
        if (best.core === targetCore) {
          const [tx0, ty0, tx1, ty1] = prepared.box as [number, number, number, number];
          const dx = Math.max(tx0 - x1, 0, x0 - tx1),
            dy = Math.max(ty0 - y1, 0, y0 - ty1);
          if (dx * dx + dy * dy > (best.away + (preferred ? 1e-6 : 0)) ** 2) continue;
        }
      }
      if (shape.kind === 'polygon') for (const p of target.line) probes.push(nearShape!(p).point);
      for (const a of probes) {
        if (best && best.core === targetCore) {
          const [x0, y0, x1, y1] = prepared.box as [number, number, number, number];
          const dx = Math.max(x0 - a.x, 0, a.x - x1),
            dy = Math.max(y0 - a.y, 0, a.y - y1);
          if (dx * dx + dy * dy > (best.away + (preferred ? 1e-6 : 0)) ** 2) continue;
        }
        const n = prepared.near(a);
        if (
          n.away > ACCESS_M ||
          (best &&
            ((!targetCore && best.core) ||
              (targetCore === best.core &&
                (preferred
                  ? n.away > best.away + 1e-6 ||
                    (Math.abs(n.away - best.away) <= 1e-6 &&
                      distance(n.point, preferred) >= distance(best.b, preferred))
                  : n.away >= best.away)))) ||
          !clear(a, n.point, layer)
        )
          continue;
        best = { target, a, b: n.point, away: n.away, core: targetCore };
      }
    }
    if (!best) return;
    const b = on(best.target, best.b);
    attached.set(`${type}:${id}`, b);
    anchors.push({ id, type, pos: best.a, layer });
    add({
      id: `access:${type}:${id}:${anchors.length}`,
      line: [best.a, b],
      kind: 'access',
      generated: true,
      widthM: 1,
      layer,
    });
  };
  const entrances = Object.values(source.walk?.nodes ?? {}).filter((n) => n.entrance?.placeId);
  for (const p of Object.values(source.places).sort((a, b) => a.id.localeCompare(b.id))) {
    const road =
      p.kind === 'gateway'
        ? city.roads[city.index.road.get(p.connectors[0]?.roadId ?? '')!]
        : undefined;
    const doors = entrances.filter((n) => n.entrance!.placeId === p.id);
    const before = anchors.length;
    for (const d of doors) attach(p.id, 'places', { kind: 'point', pos: d.pos }, d.layer);
    if (anchors.length === before) attach(p.id, 'places', p.shape, road ? layerOf(road) : 0);
  }
  for (const p of Object.values(source.parking ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.shape) attach(p.id, 'parking', p.shape);
    else if (p.strip) {
      const road = city.roads[city.index.road.get(p.strip.roadId)!]!;
      const half = road.surface.length / 2;
      const edge =
        p.strip.side === 'left' ? road.surface.slice(0, half) : road.surface.slice(half).reverse();
      const lane = city.lanes[road.lanes[0]!]!;
      const point = pointAtDistance(
        lane.polyline,
        lane.cumulative,
        (p.strip.fromM + p.strip.toM) / 2,
      );
      attach(
        p.id,
        'parking',
        { kind: 'point', pos: nearestOnPolyline(edge, point).point },
        layerOf(road),
      );
    }
    for (const c of p.connectors) {
      const r = city.roads[city.index.road.get(c.roadId)!];
      if (!r) continue;
      const l = city.lanes[r.lanes[c.lane]!]!;
      attach(
        c.id,
        'connectors',
        { kind: 'point', pos: pointAtDistance(l.polyline, l.cumulative, c.positionM) },
        layerOf(r),
        attached.get(`parking:${p.id}`),
      );
    }
  }
  for (const c of city.connectors) {
    if (c.parking !== undefined && city.parking[c.parking]!.kind !== 'garage') continue;
    const facility = c.parking === undefined ? undefined : city.parking[c.parking]!;
    const preferred =
      (facility && attached.get(`parking:${facility.id}`)) ??
      attached.get(`places:${city.places[c.place]?.id ?? facility?.source.placeId}`);
    const l = city.lanes[c.lane]!,
      r = city.roads[l.road]!;
    attach(
      c.id,
      'connectors',
      { kind: 'point', pos: pointAtDistance(l.polyline, l.cumulative, c.positionM) },
      layerOf(r),
      preferred,
    );
  }
  const { graph, nodeAt } = materializeWalk(source, raw);
  addCrossingSpans(city, graph, layerOf);
  for (const a of anchors) {
    const idx = nodeAt(a.pos, a.layer);
    if (a.type === 'connectors') graph.connectors.set(a.id, idx);
    else {
      const list = graph[a.type].get(a.id) ?? [];
      list.push(idx);
      graph[a.type].set(a.id, list);
    }
  }
  return graph;
}

const STRIPES_HALF_M = 1.25;
const EXTEND_M = 12;

/** TASK-111: the lanes each crossing link crosses, at its grade. A generated crossing crosses the
 * lanes of its arm's roads (both directions of a street, any carriageways of the arm); a mapped
 * one the lanes its line meets. A mapped crossing in a junction mouth can lie beyond a trimmed
 * lane end of its arm: the lane's straight extension (up to 12 m) then meets it, and the span sits
 * at that lane end. The vehicle network is not touched. */
function addCrossingSpans(city: CompiledCity, graph: WalkGraph, layerOf: (r: CRoad) => number) {
  const arms = new Map<number, ReturnType<typeof crossingArms>>();
  const segmentLanes = city.lanes.flatMap((lane) => lane.polyline.slice(1).map(() => lane.idx));
  const meet = (
    link: CWalkLink,
    line: Vec2[],
    index: number,
    clamp: (along: number) => number,
  ): CrossingSpan | undefined => {
    const lane = city.lanes[index]!;
    const lengths = cumulativeLengths(line);
    for (let i = 1; i < link.line.length; i++) {
      const a = link.line[i - 1]!,
        b = link.line[i]!;
      for (let j = 1; j < line.length; j++) {
        const p = line[j - 1]!,
          q = line[j]!;
        const point = segmentIntersection(a, b, p, q);
        if (!point) continue;
        const sin = Math.max(
          0.3,
          Math.abs((b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x)) /
            (distance(a, b) * distance(p, q)),
        );
        return {
          lane: index,
          atM: clamp(lengths[j - 1]! + distance(p, point)),
          halfM: STRIPES_HALF_M / sin,
          linkM: link.cumulative[i - 1]! + distance(a, point),
          linkHalfM: lane.widthM / 2 / sin,
        };
      }
    }
  };
  for (const link of graph.links) {
    if (!link.crossing) continue;
    const { road, node, arm } = link.crossing;
    let ends = node >= 0 ? arms.get(node) : undefined;
    if (node >= 0 && !ends) arms.set(node, (ends = crossingArms(city, city.nodes[node]!)));
    const armRoads = ends ? ends[arm]!.map((e) => e.road) : [city.roads[road]!];
    const sameGrade = (lane: number) => layerOf(city.roads[city.lanes[lane]!.road]!) === link.layer;
    let direct: number[];
    if (link.generated) direct = armRoads.flatMap((r) => r.lanes);
    else {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const p of link.line) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      direct = [
        ...new Set(city.laneSpatial.search(x0, y0, x1, y1).map((i) => segmentLanes[i]!)),
      ].sort((a, b) => a - b);
    }
    const spans = new Map<number, CrossingSpan>();
    for (const index of direct.filter(sameGrade)) {
      const hit = meet(link, city.lanes[index]!.polyline, index, (along) => along);
      if (hit) spans.set(index, hit);
    }
    if (ends && !link.generated)
      for (const r of armRoads)
        for (const index of r.lanes) {
          if (spans.has(index) || !sameGrade(index)) continue;
          const lane = city.lanes[index]!;
          const atEnd = r.to === node;
          const s = atEnd ? lane.lengthM : 0,
            p = pointAtDistance(lane.polyline, lane.cumulative, s),
            h = headingAtDistance(lane.polyline, lane.cumulative, s),
            sign = atEnd ? EXTEND_M : -EXTEND_M;
          const ray = [p, { x: p.x + sign * Math.cos(h), y: p.y + sign * Math.sin(h) }];
          const hit = meet(link, ray, index, () => s);
          if (hit) spans.set(index, hit);
        }
    link.crossing = {
      ...link.crossing,
      spans: [...spans.values()].sort((a, b) => a.lane - b.lane),
    };
  }
}

function materializeWalk(source: City, raw: Raw[]) {
  const graph = emptyWalkGraph();
  const buckets = new Map<string, number[]>();
  const nodeAt = (pos: Vec2, layer: number) => {
    const x = Math.floor(pos.x * 20),
      y = Math.floor(pos.y * 20);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const idx of buckets.get(`${x + dx}:${y + dy}:${layer}`) ?? [])
          if (distance(graph.nodes[idx]!.pos, pos) < 0.05) return idx;
    const idx = graph.nodes.length,
      key = `${x}:${y}:${layer}`;
    graph.nodes.push({ idx, pos, layer, links: [], sourceIds: [] });
    const ids = buckets.get(key) ?? [];
    ids.push(idx);
    buckets.set(key, ids);
    return idx;
  };
  for (const n of Object.values(source.walk?.nodes ?? {}).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const idx = nodeAt(n.pos, n.layer);
    graph.sourceNodes.set(n.id, idx);
    graph.nodes[idx]!.sourceIds.push(n.id);
  }
  for (const link of raw) {
    const length = polylineLength(link.line),
      cuts = link.cuts
        .sort((a, b) => a - b)
        .filter((s, i, all) => i === 0 || s - all[i - 1]! > 0.05);
    for (let i = 1; i < cuts.length; i++) {
      const line = trimPolyline(link.line, cuts[i - 1]!, length - cuts[i]!),
        from =
          link.sourceEnds && cuts[i - 1]! < 0.05
            ? graph.sourceNodes.get(link.sourceEnds[0])!
            : nodeAt(
                line[0]!,
                cuts[i - 1]! < 0.05 ? (link.endpointLayers?.[0] ?? link.layer) : link.layer,
              ),
        to =
          link.sourceEnds && length - cuts[i]! < 0.05
            ? graph.sourceNodes.get(link.sourceEnds[1])!
            : nodeAt(
                line.at(-1)!,
                length - cuts[i]! < 0.05 ? (link.endpointLayers?.[1] ?? link.layer) : link.layer,
              );
      if (from === to) continue;
      const idx = graph.links.length;
      graph.links.push({
        kind: link.kind,
        generated: link.generated,
        widthM: link.widthM,
        layer: link.layer,
        road: link.road,
        side: link.side,
        node: link.node,
        crossing: link.crossing,
        id: `${link.id}/${i}`,
        idx,
        from,
        to,
        line,
        cumulative: cumulativeLengths(line),
        lengthM: polylineLength(line),
      });
      graph.nodes[from]!.links.push(idx);
      graph.nodes[to]!.links.push(idx);
    }
  }
  return { graph, nodeAt };
}
