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
import {
  crossingArms,
  crossingCentreM,
  crossingEnabled,
  crossingLine,
  crossingPlacement,
  UNMARKED_CENTRE_M,
  type CrossedEnd,
} from './crossings';
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
  infill?: boolean;
};
const SIDES = ['left', 'right'] as const;
const SNAP_M = 4;
const COVER_M = 12;
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
  const geometry = segments.map(([a, b]) => {
    const dx = b!.x - a!.x,
      dy = b!.y - a!.y,
      length = Math.hypot(dx, dy);
    return {
      a: a!,
      dx,
      dy,
      length,
      square: length ** 2,
      box: [Math.min(a!.x, b!.x), Math.min(a!.y, b!.y), Math.max(a!.x, b!.x), Math.max(a!.y, b!.y)],
    };
  });
  return (p: Vec2) => {
    // Best-first over segment boxes: stop once a box is farther than the best exact distance.
    // Same result and tie-break (lowest index) as scanning every segment (lead, TASK-110 merge:
    // a radius box search cost Sindelfingen's compile 8 times main's).
    let index = -1,
      away = Infinity,
      along = 0,
      x = 0,
      y = 0;
    tree.neighbors(p.x, p.y, 1, Infinity, (i) => {
      const segment = geometry[i]!;
      const [x0, y0, x1, y1] = segment.box;
      const dx = Math.max(x0! - p.x, 0, p.x - x1!),
        dy = Math.max(y0! - p.y, 0, p.y - y1!);
      if (dx * dx + dy * dy > away * away) return true;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - segment.a.x) * segment.dx + (p.y - segment.a.y) * segment.dy) / segment.square,
        ),
      );
      const nx = segment.a.x + t * segment.dx,
        ny = segment.a.y + t * segment.dy;
      const d = Math.hypot(p.x - nx, p.y - ny);
      if (d < away || (d === away && i < index)) {
        away = d;
        x = nx;
        y = ny;
        along = t * segment.length;
        index = i;
      }
      return false;
    });
    const segment = geometry[index]!;
    return {
      point: { x, y },
      along,
      away,
      direction: { x: segment.dx / segment.length, y: segment.dy / segment.length },
    };
  };
}

/** Derived after the vehicle compile; never mutates City or vehicle geometry. */
export function compileWalk(source: City, city: CompiledCity): WalkGraph {
  const raw: Raw[] = [];
  const sidewalks = new Map<string, Raw[]>();
  const joins: { a: Raw; b: Raw; link: Omit<Raw, 'cuts'> }[] = [];
  const repairs: typeof joins = [];
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
  const mappedIncident = new Map<string, typeof mappedLinks>();
  for (const link of mappedLinks) {
    if (link.kind === 'crossing') continue;
    for (const id of [link.from, link.to]) {
      const list = mappedIncident.get(id) ?? [];
      list.push(link);
      mappedIncident.set(id, list);
    }
  }
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
          ? uncoveredCurb(line, (p) => {
              const direction = nearestOnPolyline(r.reference, p).direction;
              const parallel = (other: Vec2) =>
                Math.abs(other.x * direction.x + other.y * direction.y) > 0.8;
              return mappedTree
                .search(p.x - COVER_M, p.y - COVER_M, p.x + COVER_M, p.y + COVER_M)
                .some((i) => {
                  const link = mappedLinks[i];
                  if (!link) return false;
                  if (
                    link.kind === 'crossing' ||
                    (link.layer ?? source.walk!.nodes[link.from]!.layer) !== layerOf(r)
                  )
                    return false;
                  const near = nearestOnPolyline(link.line, p);
                  const pastEnd = Math.abs(
                    (p.x - near.point.x) * near.direction.x +
                      (p.y - near.point.y) * near.direction.y,
                  );
                  const end =
                    near.along < 0.01
                      ? link.from
                      : polylineLength(link.line) - near.along < 0.01
                        ? link.to
                        : undefined;
                  const continues =
                    end !== undefined &&
                    mappedIncident
                      .get(end)
                      ?.some(
                        (other) =>
                          other !== link &&
                          (other.layer ?? source.walk!.nodes[other.from]!.layer) === layerOf(r) &&
                          parallel(nearestOnPolyline(other.line, near.point).direction),
                      );
                  return (
                    near.away <= COVER_M &&
                    (near.away <= SNAP_M || pastEnd < 0.01 || continues) &&
                    parallel(near.direction) &&
                    clear(p, near.point, layerOf(r))
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
          infill: tag === 'separate',
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
  {
    const { removed, added } = anchorMappedCrossings(source, city, raw, layerOf);
    raw.splice(0, raw.length, ...raw.filter((link) => !removed.has(link)));
    for (const link of added) add(link);
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
  const separateCurb = (link: Raw) =>
    !link.generated ||
    (link.side !== undefined &&
      source.roads[city.roads[link.road!]!.id]!.sidewalk?.[link.side] === 'separate');
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
      const repair = separateCurb(a) || separateCurb(b);
      const graded = a.layer !== b.layer;
      if (
        graded &&
        !gradeApproach(city.roads[corner.roads[0]]!, city.roads[corner.roads[1]]!, node.idx)
      )
        continue;
      let line = offsetPolyline(curve, 1);
      if (pointInPolygon(line[Math.floor(line.length / 2)]!, node.outline, 0))
        line = offsetPolyline(curve, -1);
      line[0] = repair ? nearestOnPolyline(a.line, line[0]!).point : on(a, line[0]!);
      line[line.length - 1] = repair
        ? nearestOnPolyline(b.line, line.at(-1)!).point
        : on(b, line.at(-1)!);
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
      const link: Omit<Raw, 'cuts'> = {
        id: `corner:${node.id}:${i}`,
        infill: a.infill || b.infill,
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
      };
      if (repair) repairs.push({ a, b, link });
      else add(link);
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
          infill: a.infill || b.infill,
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
      // TASK-140 (B59): along the stripes' centreline of every end of the arm, extended 100 m
      // each way, between its outermost curb hits.
      const across = crossingLine(
        city,
        arm.map((e) => ({
          ...e,
          atM: crossingCentreM(city, e.road, e.atEnd, source) ?? UNMARKED_CENTRE_M,
        })),
      );
      const beyond = (p: Vec2, q: Vec2) => {
        const length = distance(p, q) || 1;
        return { x: p.x + ((p.x - q.x) / length) * 100, y: p.y + ((p.y - q.y) / length) * 100 };
      };
      const ray = [
        beyond(across[0]!, across[1]!),
        ...across,
        beyond(across.at(-1)!, across.at(-2)!),
      ];
      const hits = curb
        .flatMap((s) => polylineCrossings(ray, s.line).map((hit) => ({ s, hit })))
        .sort((a, b) => a.hit.alongA - b.hit.alongA);
      const a = hits[0],
        b = hits.at(-1);
      if (!a || !b || a.s === b.s || a.s.layer !== b.s.layer) continue;
      const repair = separateCurb(a.s) || separateCurb(b.s);
      const link: Omit<Raw, 'cuts'> = {
        id: `crossing:${node.id}:${i}`,
        infill: a.s.infill || b.s.infill,
        line: [
          repair ? a.hit.point : on(a.s, a.hit.point),
          ...trimPolyline(ray, a.hit.alongA, polylineLength(ray) - b.hit.alongA).slice(1, -1),
          repair ? b.hit.point : on(b.s, b.hit.point),
        ],
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
      };
      if (repair) repairs.push({ a: a.s, b: b.s, link });
      else add(link);
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
  const originalRoots = walkRoots(
    source,
    raw.filter((l) => !l.infill),
  );
  const connected = (a: Raw, b: Raw) =>
    !a.infill && !b.infill
      ? originalRoots.root(a.id) === originalRoots.root(b.id)
      : root(a.id) === root(b.id);
  const connect = (a: Raw, b: Raw) => {
    unite(a.id, b.id);
    if (!a.infill && !b.infill) originalRoots.unite(a.id, b.id);
  };
  for (const generated of [false, true]) {
    if (generated) {
      for (const { a, b, link } of repairs) {
        if (connected(a, b)) continue;
        on(a, link.line[0]!);
        on(b, link.line.at(-1)!);
        add(link);
        connect(a, b);
      }
      for (const { a, b, link } of joins.sort(
        (a, b) => polylineLength(a.link.line) - polylineLength(b.link.line),
      )) {
        if (connected(a, b)) continue;
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
        connect(a, b);
      }
    }
    for (let i = 0; i < baseCount; i++) {
      const link = raw[i]!;
      if (link.generated !== generated || (generated && link.kind !== 'sidewalk')) continue;
      const handoff =
        generated &&
        source.roads[city.roads[link.road!]!.id]!.sidewalk?.[link.side!] === 'separate';
      const radius = handoff ? COVER_M : SNAP_M;
      for (const [end, p] of [link.line[0]!, link.line.at(-1)!].entries()) {
        const endpointLayer = link.sourceEnds
          ? source.walk!.nodes[link.sourceEnds[end]!]!.layer
          : (link.endpointLayers?.[end] ?? link.layer);
        const candidates = pathTree
          .neighbors(p.x, p.y, 32, radius, (j) => {
            if (
              j === i ||
              (raw[j]!.layer !== endpointLayer && !raw[j]!.endpointLayers?.includes(endpointLayer))
            )
              return false;
            if (link.generated && connected(link, raw[j]!)) return false;
            if (link.generated && raw[j]!.kind !== 'sidewalk' && raw[j]!.generated) return false;
            // TASK-140: a crossing's kerb link already joins its mapped kerb node.
            if (raw[j]!.kind === 'crossing' && raw[j]!.generated && !raw[j]!.crossing) return false;
            const own = source.walk?.links[link.id]?.provenance.osmIds;
            const other = source.walk?.links[raw[j]!.id]?.provenance.osmIds;
            return !own?.some((id) => other?.includes(id));
          })
          .map((j) => ({ target: raw[j]!, near: prepare(raw[j]!).near(p) }))
          .sort((a, b) => a.near.away - b.near.away);
        for (const best of candidates)
          if (
            (!link.generated || !connected(link, best.target)) &&
            best.near.away <= radius &&
            (best.near.away <= SNAP_M ||
              (!best.target.generated &&
                best.target.kind !== 'crossing' &&
                Math.abs(
                  best.near.direction.x *
                    nearestOnPolyline(city.roads[link.road!]!.reference, p).direction.x +
                    best.near.direction.y *
                      nearestOnPolyline(city.roads[link.road!]!.reference, p).direction.y,
                ) > 0.8)) &&
            layerAt(best.target, best.near.point) === endpointLayer &&
            (link.kind === 'crossing' || clear(p, best.near.point, endpointLayer))
          ) {
            add({
              id: `join:${i}:${end}:${best.target.id}`,
              infill: link.infill || best.target.infill,
              line: [p, on(best.target, p)],
              kind: 'access',
              generated: true,
              widthM: 1.5,
              layer: endpointLayer,
            });
            connect(link, best.target);
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
  const rawId = (id: string) => id.slice(0, id.lastIndexOf('/'));
  const infillIds = new Set(raw.filter((l) => l.infill).map((l) => l.id));
  const infill = preliminary.links.map((l) => infillIds.has(rawId(l.id)));
  const baseComponents = walkComponents(preliminary, (l) => !infill[l.idx]);
  const infillComponents = walkComponents(preliminary, (l) => infill[l.idx]!);
  const baseNodes = preliminary.nodes.map((n) => n.links.some((i) => !infill[i]));
  const infillGroups = new Map<string, number>();
  const connections = new Map<number, Set<number>>();
  for (const link of preliminary.links) {
    if (!infill[link.idx]) continue;
    const group = infillComponents.labels[link.from]!;
    infillGroups.set(rawId(link.id), group);
    const roots = connections.get(group) ?? new Set<number>();
    for (const n of [link.from, link.to]) if (baseNodes[n]) roots.add(baseComponents.labels[n]!);
    connections.set(group, roots);
  }
  // A mapped-sidewalk fallback must fill a connection/access gap, not add an unused branch
  // to an already connected public network. Standalone new networks still get sidewalks.
  const neededInfill = new Set(
    [...connections].filter(([, roots]) => roots.size !== 1).map(([id]) => id),
  );
  const coreLinks = new Set(
    preliminary.links
      .filter((l) => labels[l.from] === core)
      .map((l) => l.id.slice(0, l.id.lastIndexOf('/'))),
  );
  const isCore = (i: number) => coreLinks.has(raw[i]!.id);
  const attached = new Map<string, { pos: Vec2; target: Raw }>();
  const owningCurb = (access: ReturnType<typeof attached.get>, road: CRoad) => {
    if (!access || access.target.layer !== layerOf(road)) return;
    if (access.target.road === road.idx) return access.pos;
    if (access.target.generated) return;
    const along = nearestOnPolyline(road.reference, access.pos),
      direction = nearestOnPolyline(access.target.line, access.pos).direction;
    if (Math.abs(along.direction.x * direction.x + along.direction.y * direction.y) <= 0.8) return;
    const edge = nearestOnPolyline([...road.surface, road.surface[0]!], access.pos);
    if (edge.away <= COVER_M && clear(access.pos, edge.point, layerOf(road))) return access.pos;
  };
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
    let best: { target: Raw; a: Vec2; b: Vec2; away: number; rank: number } | undefined;
    for (const j of candidates.sort((a, b) => a - b)) {
      const target = raw[j]!,
        probes = [...points];
      // Fill missing access without moving an existing main-network entrance onto infill.
      const rank = (isCore(j) ? 0 : 2) + (target.generated && separateCurb(target) ? 1 : 0);
      const prepared = prepare(target);
      if (best) {
        // Every probe lies in the shape's box, so the per-probe tests below would reject this
        // whole target; skip its polygon projections (lead, TASK-110 merge: compile time).
        if (rank > best.rank) continue;
        if (rank === best.rank) {
          const [tx0, ty0, tx1, ty1] = prepared.box as [number, number, number, number];
          const dx = Math.max(tx0 - x1, 0, x0 - tx1),
            dy = Math.max(ty0 - y1, 0, y0 - ty1);
          if (dx * dx + dy * dy > (best.away + (preferred ? 1e-6 : 0)) ** 2) continue;
        }
      }
      if (shape.kind === 'polygon') for (const p of target.line) probes.push(nearShape!(p).point);
      let previousProbe: Vec2 | undefined;
      for (const a of probes) {
        if (previousProbe?.x === a.x && previousProbe.y === a.y) continue;
        previousProbe = a;
        if (best && best.rank === rank) {
          const [x0, y0, x1, y1] = prepared.box as [number, number, number, number];
          const dx = Math.max(x0 - a.x, 0, a.x - x1),
            dy = Math.max(y0 - a.y, 0, a.y - y1);
          if (dx * dx + dy * dy > (best.away + (preferred ? 1e-6 : 0)) ** 2) continue;
        }
        const n = prepared.near(a);
        if (
          n.away > ACCESS_M ||
          (best &&
            (rank > best.rank ||
              (rank === best.rank &&
                (preferred
                  ? n.away > best.away + 1e-6 ||
                    (Math.abs(n.away - best.away) <= 1e-6 &&
                      distance(n.point, preferred) >= distance(best.b, preferred))
                  : n.away >= best.away)))) ||
          !clear(a, n.point, layer)
        )
          continue;
        best = { target, a, b: n.point, away: n.away, rank };
      }
    }
    if (!best) return;
    const group = infillGroups.get(best.target.id);
    if (group !== undefined) neededInfill.add(group);
    const b = on(best.target, best.b);
    attached.set(`${type}:${id}`, { pos: b, target: best.target });
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
      const l = city.lanes[r.lanes[c.lane]!]!,
        preferred = attached.get(`parking:${p.id}`);
      // Generated aisle entries had no walk link. Keep their facility's pedestrian door
      // when saving them, including car-only split exits; a moved arrival can still attach.
      if (p.provenance.inferred?.includes('materializedAisleEntries') && c.direction === 'out')
        continue;
      if (
        p.provenance.inferred?.includes('materializedAisleEntries') &&
        p.aisles?.includes(c.roadId)
      ) {
        const road = source.roads[c.roadId]!;
        const start = p.entries?.includes(road.from) || !p.entries?.length;
        const end = p.entries?.includes(road.to);
        if ((start || end) && Math.abs(c.positionM - (start ? 0 : l.lengthM)) < 1e-9) continue;
      }
      attach(
        c.id,
        'connectors',
        { kind: 'point', pos: pointAtDistance(l.polyline, l.cumulative, c.positionM) },
        layerOf(r),
        owningCurb(preferred, r),
      );
    }
  }
  for (const c of city.connectors) {
    if (c.parking !== undefined && city.parking[c.parking]!.kind !== 'garage') continue;
    const facility = c.parking === undefined ? undefined : city.parking[c.parking]!;
    const preferred =
      (facility && attached.get(`parking:${facility.id}`)) ??
      attached.get(`places:${city.places[c.place]?.id ?? facility?.source.placeId}`);
    // A remote entrance on another path cannot identify this road's owning curb.
    const l = city.lanes[c.lane]!,
      r = city.roads[l.road]!;
    attach(
      c.id,
      'connectors',
      { kind: 'point', pos: pointAtDistance(l.polyline, l.cumulative, c.positionM) },
      layerOf(r),
      owningCurb(preferred, r),
    );
  }
  const { graph, nodeAt } = materializeWalk(
    source,
    raw.filter((link) => {
      const group = infillGroups.get(link.id);
      return group === undefined || neededInfill.has(group);
    }),
  );
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

/** TASK-140: a mapped crossing farther than this from the stripes of a road end it crosses is
 * another crossing along the street (Munich n:16's lies 23 m beyond its stripes). */
const ANCHOR_M = 12;
/** TASK-140: a re-anchored mapped crossing reaches this far beyond the outer road edges, as a
 * generated one reaches the generated sidewalk's centre 1 m beyond the curb. */
const KERB_M = 1;

/**
 * TASK-140 (B59): a mapped crossing at a junction runs along the stripes' centreline. Its links
 * at one junction, joined through nodes no other walk link uses, become one link across the road
 * ends it crosses, each at its `crossingCentreM` (an unmarked end at its own position), reaching
 * 1 m beyond the outer road edges; straight kerb links join its ends to the mapped end nodes.
 * Kerb links are kind `crossing` without crossing data: not drawn, no wait, no span. A crossing
 * stays as mapped if it crosses a lane of a road that does not end at its node, crosses no end
 * with a centre, or lies more than 12 m from one.
 */
function anchorMappedCrossings(
  source: City,
  city: CompiledCity,
  raw: Raw[],
  layerOf: (r: CRoad) => number,
): { removed: Set<Raw>; added: Omit<Raw, 'cuts'>[] } {
  const removed = new Set<Raw>(),
    added: Omit<Raw, 'cuts'>[] = [];
  const degree = new Map<string, number>();
  for (const link of Object.values(source.walk?.links ?? {}))
    for (const id of [link.from, link.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const crossings = raw.filter(
    (l) => l.kind === 'crossing' && !l.generated && l.crossing && l.crossing.arm >= 0,
  );
  const at = new Map<string, Raw[]>();
  for (const link of crossings)
    for (const id of link.sourceEnds!) at.set(id, [...(at.get(id) ?? []), link]);
  // A node only two crossing links of one junction use (OSM splits a crossing way where it meets
  // the road's centreline: Munich n:372's west carriageway, whose halves are nearest to different
  // arms) lies on the road, not on a kerb or an island.
  const through = (id: string) => {
    const links = at.get(id);
    return (
      degree.get(id) === 2 &&
      links?.length === 2 &&
      links[0]!.crossing!.node === links[1]!.crossing!.node
    );
  };
  const other = (link: Raw, id: string) =>
    link.sourceEnds![0] === id ? link.sourceEnds![1] : link.sourceEnds![0];
  const visited = new Set<Raw>();
  const arms = new Map<number, ReturnType<typeof crossingArms>>();
  for (const start of crossings) {
    if (visited.has(start)) continue;
    visited.add(start);
    // The chain of links through pass-through nodes, ordered from `first` to `last`.
    const chain = [start];
    let first = start.sourceEnds![0],
      last = start.sourceEnds![1];
    for (const forward of [false, true]) {
      let link = start,
        id = forward ? last : first;
      while (through(id)) {
        const next = at.get(id)!.find((l) => l !== link)!;
        if (visited.has(next)) break;
        visited.add(next);
        if (forward) chain.push(next);
        else chain.unshift(next);
        id = other(next, id);
        link = next;
      }
      if (forward) last = id;
      else first = id;
    }
    if (first === last) continue;
    const line: Vec2[] = [];
    let cursor = first;
    for (const link of chain) {
      const points = link.sourceEnds![0] === cursor ? link.line : link.line.toReversed();
      line.push(...(line.length ? points.slice(1) : points));
      cursor = other(link, cursor);
    }
    const { node } = start.crossing!;
    let ends = arms.get(node);
    if (!ends) arms.set(node, (ends = crossingArms(city, city.nodes[node]!)));
    const armRoads = [
      ...new Set(chain.flatMap((link) => ends[link.crossing!.arm]!.map((e) => e.road))),
    ];
    const lanes = [...new Set([...lanesNear(city, line), ...armRoads.flatMap((r) => r.lanes)])]
      .filter((i) => layerOf(city.roads[city.lanes[i]!.road]!) === start.layer)
      .sort((a, b) => a - b);
    const spans = crossingSpans(city, line, lanes, { roads: armRoads, node });
    // Each road end crossed, with the mean distance from its cut at which the link meets it.
    const crossed = new Map<number, { road: CRoad; atEnd: boolean; sum: number; count: number }>();
    let elsewhere = false;
    for (const span of spans.values()) {
      const lane = city.lanes[span.lane]!,
        road = city.roads[lane.road]!;
      if (road.from !== node && road.to !== node) elsewhere = true;
      const atEnd = road.to === node && (road.from !== node || span.atM > lane.lengthM / 2);
      const entry = crossed.get(road.idx) ?? { road, atEnd, sum: 0, count: 0 };
      entry.sum += atEnd ? lane.lengthM - span.atM : span.atM;
      entry.count++;
      crossed.set(road.idx, entry);
    }
    if (elsewhere || !crossed.size) continue;
    let marked = false,
      far = false;
    const across: CrossedEnd[] = [...crossed.values()].map(({ road, atEnd, sum, count }) => {
      const centre = crossingCentreM(city, road, atEnd, source);
      if (centre !== null) {
        marked = true;
        far ||= Math.abs(sum / count - centre) > ANCHOR_M;
      }
      return { road, atEnd, atM: centre ?? sum / count };
    });
    if (!marked || far) continue;
    let centre = crossingLine(city, across);
    const beyond = (p: Vec2, q: Vec2) => {
      const length = distance(p, q) || 1;
      return { x: p.x + ((p.x - q.x) / length) * KERB_M, y: p.y + ((p.y - q.y) / length) * KERB_M };
    };
    const kerbs = [first, last].map((id) => source.walk!.nodes[id]!);
    let a = beyond(centre[0]!, centre[1]!),
      b = beyond(centre.at(-1)!, centre.at(-2)!);
    if (
      distance(kerbs[0]!.pos, a) + distance(kerbs[1]!.pos, b) >
      distance(kerbs[0]!.pos, b) + distance(kerbs[1]!.pos, a)
    ) {
      centre = centre.toReversed();
      [a, b] = [b, a];
    }
    for (const link of chain) removed.add(link);
    added.push({ ...start, sourceEnds: undefined, line: [a, ...centre, b] });
    for (const [i, end] of [a, b].entries()) {
      const kerb = kerbs[i]!;
      added.push({
        id: `${start.id}:kerb:${i}`,
        kind: 'crossing',
        generated: true,
        widthM: start.widthM,
        layer: start.layer,
        line: [kerb.pos, end],
        ...(kerb.layer !== start.layer
          ? { endpointLayers: [kerb.layer, start.layer] as [number, number] }
          : {}),
      });
    }
  }
  return { removed, added };
}

const STRIPES_HALF_M = 1.25;
const EXTEND_M = 12;

const segmentLanes = new WeakMap<CompiledCity, number[]>();
/** The lanes whose polylines `line`'s bounding box touches (`laneSpatial` holds lane segments). */
function lanesNear(city: CompiledCity, line: readonly Vec2[]): number[] {
  let lanes = segmentLanes.get(city);
  if (!lanes) {
    lanes = city.lanes.flatMap((lane) => lane.polyline.slice(1).map(() => lane.idx));
    segmentLanes.set(city, lanes);
  }
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
  return [...new Set(city.laneSpatial.search(x0, y0, x1, y1).map((i) => lanes[i]!))].sort(
    (a, b) => a - b,
  );
}

/** TASK-111: where `line` (a crossing link) meets each of the `direct` lanes, and, for the lanes of
 * `extend.roads` among them it does not meet, their straight extension up to 12 m beyond their end
 * at `extend.node` (a mapped crossing in a junction mouth beyond a trimmed lane end; the span then
 * sits at that lane end). */
function crossingSpans(
  city: CompiledCity,
  line: readonly Vec2[],
  direct: readonly number[],
  extend?: { roads: readonly CRoad[]; node: number },
): Map<number, CrossingSpan> {
  const lineLengths = cumulativeLengths(line);
  const meet = (
    path: Vec2[],
    index: number,
    clamp: (along: number) => number,
  ): CrossingSpan | undefined => {
    const lane = city.lanes[index]!;
    const lengths = cumulativeLengths(path);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!,
        b = line[i]!;
      for (let j = 1; j < path.length; j++) {
        const p = path[j - 1]!,
          q = path[j]!;
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
          linkM: lineLengths[i - 1]! + distance(a, point),
          linkHalfM: lane.widthM / 2 / sin,
        };
      }
    }
  };
  const spans = new Map<number, CrossingSpan>();
  for (const index of direct) {
    const hit = meet(city.lanes[index]!.polyline, index, (along) => along);
    if (hit) spans.set(index, hit);
  }
  for (const r of extend?.roads ?? [])
    for (const index of r.lanes) {
      if (spans.has(index) || !direct.includes(index)) continue;
      const lane = city.lanes[index]!;
      const atEnd = r.to === extend!.node;
      const s = atEnd ? lane.lengthM : 0,
        p = pointAtDistance(lane.polyline, lane.cumulative, s),
        h = headingAtDistance(lane.polyline, lane.cumulative, s),
        sign = atEnd ? EXTEND_M : -EXTEND_M;
      const ray = [p, { x: p.x + sign * Math.cos(h), y: p.y + sign * Math.sin(h) }];
      const hit = meet(ray, index, () => s);
      if (hit) spans.set(index, hit);
    }
  return spans;
}

/** TASK-111: the lanes each crossing link crosses, at its grade. A generated crossing crosses the
 * lanes of its arm's roads (both directions of a street, any carriageways of the arm); a mapped
 * one the lanes its line meets, or the extension of its arm's lanes (`crossingSpans`). The vehicle
 * network is not touched. */
function addCrossingSpans(city: CompiledCity, graph: WalkGraph, layerOf: (r: CRoad) => number) {
  const arms = new Map<number, ReturnType<typeof crossingArms>>();
  for (const link of graph.links) {
    if (!link.crossing) continue;
    const { road, node, arm } = link.crossing;
    let ends = node >= 0 ? arms.get(node) : undefined;
    if (node >= 0 && !ends) arms.set(node, (ends = crossingArms(city, city.nodes[node]!)));
    const armRoads = ends ? ends[arm]!.map((e) => e.road) : [city.roads[road]!];
    const sameGrade = (lane: number) => layerOf(city.roads[city.lanes[lane]!.road]!) === link.layer;
    const spans = link.generated
      ? crossingSpans(city, link.line, armRoads.flatMap((r) => r.lanes).filter(sameGrade))
      : crossingSpans(
          city,
          link.line,
          [
            ...new Set([
              ...lanesNear(city, link.line),
              ...(ends ? armRoads.flatMap((r) => r.lanes) : []),
            ]),
          ]
            .filter(sameGrade)
            .sort((a, b) => a - b),
          ends ? { roads: armRoads, node } : undefined,
        );
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
