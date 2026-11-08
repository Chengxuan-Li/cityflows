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
  crossing?: { road: number; end: 'start' | 'end' | 'midblock'; control: 'zebra' | 'signal' };
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
  const sidewalks = new Map<string, Raw>();
  const layerOf = (r: CRoad) =>
    source.roads[r.id]!.layer ??
    Math.min(
      source.nodes[city.nodes[r.from]!.id]!.layer,
      source.nodes[city.nodes[r.to]!.id]!.layer,
    );
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
        tag === 'separate' ||
        (!tag && ['motorway', 'trunk', 'ramp', 'service'].includes(r.roadClass))
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
      const s = add({
        id: `sidewalk:${r.id}:${side}`,
        kind: 'sidewalk',
        generated: true,
        road: r.idx,
        side,
        layer: layerOf(r),
        widthM: 2,
        line: (() => {
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
        })(),
      });
      if (s) sidewalks.set(`${r.idx}:${side}`, s);
    }
  for (const node of city.nodes) {
    const ends = [...sidewalks.values()].filter((s) => {
      const r = city.roads[s.road!]!;
      return r.from === node.idx || r.to === node.idx;
    });
    for (const [i, corner] of junctionCorners(node).entries()) {
      if (!corner.curve || corner.kind === 'nose' || corner.kind === 'gore') continue;
      const curve = corner.curve;
      const curbSide = (road: number, first: boolean) => {
        const from = city.roads[road]!.from === node.idx;
        return sidewalks.get(`${road}:${from === first ? 'right' : 'left'}`);
      };
      const a = curbSide(corner.roads[0], true),
        b = curbSide(corner.roads[1], false);
      if (!a || !b || a === b || a.layer !== b.layer) continue;
      let line = offsetPolyline(curve, 1);
      if (pointInPolygon(line[Math.floor(line.length / 2)]!, node.outline, 0))
        line = offsetPolyline(curve, -1);
      line[0] = on(a, line[0]!);
      line[line.length - 1] = on(b, line.at(-1)!);
      add({
        id: `corner:${node.id}:${i}`,
        line,
        kind: 'corner',
        generated: true,
        widthM: 2,
        layer: a.layer,
        node: node.idx,
      });
    }
    if (!node.outline.length)
      for (let i = 0; i < ends.length; i++)
        for (let j = i + 1; j < ends.length; j++) {
          const a = ends[i]!,
            b = ends[j]!,
            ra = city.roads[a.road!]!,
            rb = city.roads[b.road!]!;
          if (ra.idx === rb.idx || a.layer !== b.layer) continue;
          const pa = ra.from === node.idx ? a.line[0]! : a.line.at(-1)!,
            pb = rb.from === node.idx ? b.line[0]! : b.line.at(-1)!;
          if (distance(pa, pb) > 2.1) continue;
          add({
            id: `seam:${node.id}:${i}:${j}`,
            line: [pa, pb],
            kind: 'corner',
            generated: true,
            widthM: 2,
            layer: a.layer,
            node: node.idx,
          });
        }
    for (const [i, arm] of crossingArms(city, node).entries()) {
      if (
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
        curb = ends.filter((s) => arm.some((e) => e.road.idx === s.road));
      if (curb.length < 2) continue;
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
        },
      });
    }
  }
  const roadTree = spatial(city.roads.map((r) => r.reference));
  for (const link of Object.values(source.walk?.links ?? {}).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
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
        crossing = {
          road: road.idx,
          end:
            Math.min(near.along, length - near.along) > 30 ? 'midblock' : atEnd ? 'end' : 'start',
          control: node.signal && distance(node.pos, p) < 40 ? 'signal' : 'zebra',
        };
      }
    }
    add({
      id: link.id,
      line: link.line,
      kind: link.kind,
      generated: false,
      widthM: link.widthM ?? (link.kind === 'pedestrian' ? 3 : 1.5),
      layer,
      ...(crossing ? { crossing, road: crossing.road } : {}),
      sourceEnds: [link.from, link.to],
    });
  }

  if (!raw.length) return materializeWalk(source, raw).graph;

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
  for (let i = 0; i < baseCount; i++) {
    const link = raw[i]!;
    if (link.generated) continue;
    for (const [end, p] of [link.line[0]!, link.line.at(-1)!].entries()) {
      const endpointLayer = link.sourceEnds
        ? source.walk!.nodes[link.sourceEnds[end]!]!.layer
        : link.layer;
      const candidates = pathTree
        .neighbors(p.x, p.y, 32, SNAP_M, (j) => {
          if (j === i || raw[j]!.layer !== endpointLayer) return false;
          const own = source.walk?.links[link.id]?.provenance.osmIds;
          const other = source.walk?.links[raw[j]!.id]?.provenance.osmIds;
          return !own?.some((id) => other?.includes(id));
        })
        .map((j) => ({ target: raw[j]!, near: nearestOnPolyline(raw[j]!.line, p) }))
        .sort((a, b) => a.near.away - b.near.away);
      for (const best of candidates)
        if (
          best.near.away <= SNAP_M &&
          (link.kind === 'crossing' || clear(p, best.near.point, endpointLayer))
        )
          add({
            id: `join:${i}:${p.x}:${p.y}`,
            line: [p, on(best.target, p)],
            kind: 'access',
            generated: true,
            widthM: 1.5,
            layer: endpointLayer,
          });
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
  const labels = new Int32Array(preliminary.nodes.length).fill(-1),
    sizes: number[] = [];
  for (const node of preliminary.nodes) {
    if (labels[node.idx] !== -1) continue;
    const component = sizes.length,
      queue = [node.idx];
    labels[node.idx] = component;
    for (const n of queue)
      for (const i of preliminary.nodes[n]!.links) {
        const l = preliminary.links[i]!,
          next = l.from === n ? l.to : l.from;
        if (labels[next] !== -1) continue;
        labels[next] = component;
        queue.push(next);
      }
    sizes.push(queue.length);
  }
  const core = sizes.indexOf(Math.max(0, ...sizes));
  const coreLinks = new Set(
    preliminary.links
      .filter((l) => labels[l.from] === core)
      .map((l) => l.id.slice(0, l.id.lastIndexOf('/'))),
  );
  const isCore = (i: number) => coreLinks.has(raw[i]!.id);
  const nearestCache = new Map<Raw, { near: ReturnType<typeof prepareNearest>; box: number[] }>();
  const attach = (
    id: string,
    type: 'places' | 'parking' | 'connectors',
    shape: { kind: 'point'; pos: Vec2 } | { kind: 'polygon'; ring: Vec2[] },
    layer = 0,
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
      let prepared = nearestCache.get(target);
      if (!prepared) {
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        for (const p of target.line) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
        prepared = { near: prepareNearest(target.line), box: [x0, y0, x1, y1] };
        nearestCache.set(target, prepared);
      }
      if (best) {
        // Every probe lies in the shape's box, so the per-probe tests below would reject this
        // whole target; skip its polygon projections (lead, TASK-110 merge: compile time).
        if (best.core && !targetCore) continue;
        if (best.core === targetCore) {
          const [tx0, ty0, tx1, ty1] = prepared.box as [number, number, number, number];
          const dx = Math.max(tx0 - x1, 0, x0 - tx1),
            dy = Math.max(ty0 - y1, 0, y0 - ty1);
          if (dx * dx + dy * dy >= best.away * best.away) continue;
        }
      }
      if (shape.kind === 'polygon') for (const p of target.line) probes.push(nearShape!(p).point);
      for (const a of probes) {
        if (best && best.core === targetCore) {
          const [x0, y0, x1, y1] = prepared.box as [number, number, number, number];
          const dx = Math.max(x0 - a.x, 0, a.x - x1),
            dy = Math.max(y0 - a.y, 0, a.y - y1);
          if (dx * dx + dy * dy >= best.away * best.away) continue;
        }
        const n = prepared.near(a);
        if (
          n.away > ACCESS_M ||
          (best &&
            ((!targetCore && best.core) || (targetCore === best.core && n.away >= best.away))) ||
          !clear(a, n.point, layer)
        )
          continue;
        best = { target, a, b: n.point, away: n.away, core: targetCore };
      }
    }
    if (!best) return;
    const b = on(best.target, best.b);
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
      );
    }
  }
  for (const c of city.connectors) {
    if (c.parking !== undefined && city.parking[c.parking]!.kind !== 'garage') continue;
    const l = city.lanes[c.lane]!,
      r = city.roads[l.road]!;
    attach(
      c.id,
      'connectors',
      { kind: 'point', pos: pointAtDistance(l.polyline, l.cumulative, c.positionM) },
      layerOf(r),
    );
  }
  const { graph, nodeAt } = materializeWalk(source, raw);
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
            : nodeAt(line[0]!, link.layer),
        to =
          link.sourceEnds && length - cuts[i]! < 0.05
            ? graph.sourceNodes.get(link.sourceEnds[1])!
            : nodeAt(line.at(-1)!, link.layer);
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
