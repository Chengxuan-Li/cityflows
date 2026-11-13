import Flatbush from 'flatbush';
import { lonLatToLocal } from '../geo/projection';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  polylineCrossings,
  polylineLength,
  preparePolygon,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City } from '../schema';
import type { CompiledCity } from './types';
import type { CatenaryMast, RailNode, RailTrack, RailPlatform, TramStop } from '../schema/rail';
import { compileLevelCrossings, type LevelCrossing } from './level-crossings';

export interface RailGraph {
  nodes: (RailNode & { idx: number; tracks: number[]; boundary: boolean })[];
  tracks: (RailTrack & {
    idx: number;
    fromNode: number;
    toNode: number;
    lengthM: number;
    cumulative: Float64Array;
  })[];
  platforms: RailPlatform[];
  tramStops?: TramStop[];
  connections: { node: number; from: number; to: number }[];
  components: number[][];
  crossings: { roadId: string; track: number; pos: Vec2; roadM: number; trackM: number }[];
  /** TASK-134: mapped catenary masts, when the import found any. */
  masts?: CatenaryMast[];
  facilities?: LevelCrossing[];
}

// Thirty degrees accommodates shallow turnout frogs, while excluding corners and reversals.
export const railDeflectionDeg = 30;
export function compileRail(city: City, geometry?: CompiledCity): RailGraph | undefined {
  if (!city.rail) return undefined;
  const nodes = Object.values(city.rail.nodes)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n, idx) => ({ ...n, idx, tracks: [] as number[], boundary: false }));
  const index = new Map(nodes.map((n) => [n.id, n.idx]));
  const tracks = Object.values(city.rail.tracks)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t, idx) => ({
      ...t,
      idx,
      fromNode: index.get(t.from)!,
      toNode: index.get(t.to)!,
      lengthM: polylineLength(t.line),
      cumulative: cumulativeLengths(t.line),
    }));
  for (const t of tracks) {
    nodes[t.fromNode]!.tracks.push(t.idx);
    nodes[t.toNode]!.tracks.push(t.idx);
  }
  const points = city.geo
    ? [
        lonLatToLocal(city.geo, { lon: city.geo.bbox[0], lat: city.geo.bbox[3] }),
        lonLatToLocal(city.geo, { lon: city.geo.bbox[2], lat: city.geo.bbox[1] }),
      ]
    : nodes.map((n) => n.pos);
  const x0 = Math.min(...points.map((p) => p.x)),
    x1 = Math.max(...points.map((p) => p.x)),
    y0 = Math.min(...points.map((p) => p.y)),
    y1 = Math.max(...points.map((p) => p.y));
  for (const n of nodes)
    n.boundary =
      n.kind !== 'buffer_stop' &&
      n.tracks.length === 1 &&
      Math.min(
        Math.abs(n.pos.x - x0),
        Math.abs(n.pos.x - x1),
        Math.abs(n.pos.y - y0),
        Math.abs(n.pos.y - y1),
      ) < 0.1;
  const connections: RailGraph['connections'] = [];
  const outward = (t: RailTrack, id: string) => {
    const start = t.from === id;
    const line = start ? t.line : [...t.line].reverse();
    const a = line[0]!,
      b = line.find((p) => distance(p, a) > 0)!;
    const length = distance(a, b);
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  for (const n of nodes) {
    if (n.kind === 'buffer_stop') continue;
    for (const from of n.tracks)
      for (const to of n.tracks) {
        if (from === to) continue;
        const a = outward(tracks[from]!, n.id),
          b = outward(tracks[to]!, n.id);
        if (-a.x * b.x - a.y * b.y >= Math.cos((railDeflectionDeg * Math.PI) / 180) - 1e-9)
          connections.push({ node: n.idx, from, to });
      }
  }
  const components: number[][] = [];
  const seen = new Set<number>();
  for (const t of tracks) {
    if (seen.has(t.idx)) continue;
    const group = [t.idx];
    seen.add(t.idx);
    for (const i of group)
      for (const n of [tracks[i]!.fromNode, tracks[i]!.toNode])
        for (const j of nodes[n]!.tracks)
          if (!seen.has(j)) {
            seen.add(j);
            group.push(j);
          }
    components.push(group);
  }
  const crossings: RailGraph['crossings'] = [];
  const box = (line: Vec2[]) =>
    [
      Math.min(...line.map((p) => p.x)),
      Math.min(...line.map((p) => p.y)),
      Math.max(...line.map((p) => p.x)),
      Math.max(...line.map((p) => p.y)),
    ] as const;
  const spatial = new Flatbush(Math.max(1, tracks.length));
  for (const t of tracks) spatial.add(...box(t.line));
  if (!tracks.length) spatial.add(0, 0, 0, 0);
  spatial.finish();
  for (const road of (tracks.length ? Object.values(city.roads) : []).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const layer = road.layer ?? Math.min(city.nodes[road.from]!.layer, city.nodes[road.to]!.layer);
    for (const i of spatial.search(...box(road.centerline)).sort((a, b) => a - b)) {
      const track = tracks[i]!;
      if (layer !== track.layer) continue;
      for (const hit of polylineCrossings(road.centerline, track.line)) {
        const pos = hit.point;
        if (
          !crossings.some(
            (c) => c.roadId === road.id && c.track === track.idx && distance(c.pos, pos) < 0.05,
          )
        )
          crossings.push({
            roadId: road.id,
            track: track.idx,
            pos,
            roadM: hit.alongA,
            trackM: hit.alongB,
          });
      }
    }
  }
  return {
    nodes,
    tracks,
    platforms: Object.values(city.rail.platforms).sort((a, b) => a.id.localeCompare(b.id)),
    connections,
    ...(city.rail.tramStops
      ? { tramStops: Object.values(city.rail.tramStops).sort((a, b) => a.id.localeCompare(b.id)) }
      : {}),
    components,
    crossings,
    facilities: compileLevelCrossings(city, { nodes, tracks }, geometry),
    ...(city.rail.masts ? { masts: city.rail.masts } : {}),
  };
}

export function railCensus(city: City, graph: RailGraph) {
  return {
    nodes: graph.nodes.length,
    tracks: graph.tracks.length,
    byKind: Object.fromEntries(
      [...new Set(graph.tracks.map((t) => t.kind))].map((kind) => {
        const tracks = graph.tracks.filter((t) => t.kind === kind);
        return [
          kind,
          { tracks: tracks.length, lengthM: tracks.reduce((sum, t) => sum + t.lengthM, 0) },
        ];
      }),
    ),
    switches: graph.nodes.filter((n) => n.kind === 'switch').length,
    components: graph.components.length,
    componentTracks: graph.components.map((c) => c.length),
    platforms: graph.platforms.length,
    crossings: graph.crossings.length,
    stations: Object.values(city.places)
      .filter((p) => p.station)
      .map((p) => ({
        id: p.id,
        name: p.name,
        platforms: p.station!.platforms,
        entrances: p.station!.entrances,
      })),
  };
}

/** TASK-132: rail heights above (below) the ground, at the rail top. */
export const railGrade = {
  /** A tunnel at layer -1 (or untagged): a 4.5 m train under 1 m of structure and 1.5 m of cover. */
  tunnelM: -7,
  /** Each further layer below -1, and a bridge deck per layer above the ground. */
  layerM: 5,
  /** Rail top to the underside of a bridge deck. */
  deckM: 1,
  /** Headroom a bridge leaves over a road, and over a track with its overhead line. */
  roadClearanceM: 4.7,
  trackClearanceM: 6,
  /** The steepest ramp: 4% for railways, 6% for trams. */
  maxGrade: (kind: RailTrack['kind']) => (kind === 'tram' ? 0.06 : 0.04),
  /** Profile sample spacing. */
  stepM: 2,
};
export type TrackGrade = 'tunnel' | 'covered' | 'bridge' | 'ground';
/** Tags decide a track's grade; `layer` only orders crossings (a ground track may be layer -1). */
export const trackGrade = (t: Pick<RailTrack, 'tunnel' | 'covered' | 'bridge'>): TrackGrade =>
  t.covered ? 'covered' : t.tunnel ? 'tunnel' : t.bridge ? 'bridge' : 'ground';

export interface RailHeights {
  grades: TrackGrade[];
  /** The height a tunnel or bridge keeps away from pinned ends; 0 for other tracks. */
  levels: number[];
  /** Heights at even stations from 0 to each track's length; a single value when level. */
  profiles: Float64Array[];
  /** Tunnel portals and bridge abutments: a structure's end where it meets another grade. */
  portals: { track: number; node: number; atEnd: boolean; kind: 'tunnel' | 'bridge' }[];
}

export function railHeightAt(heights: RailHeights, track: RailGraph['tracks'][number], s: number) {
  const profile = heights.profiles[track.idx]!;
  if (profile.length === 1) return profile[0]!;
  const t = (Math.max(0, Math.min(track.lengthM, s)) / track.lengthM) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(t));
  return profile[i]! + (profile[i + 1]! - profile[i]!) * (t - i);
}

/** Multi-source shortest paths from `init` values, expanding only below `limit`. */
function spread(
  count: number,
  init: Map<number, number>,
  adjacency: { start: Int32Array; to: Int32Array; cost: Float64Array },
  limit: number,
) {
  const dist = new Float64Array(count).fill(Infinity);
  const heap: [number, number][] = [];
  const push = (key: number, node: number) => {
    let i = heap.push([key, node]) - 1;
    while (i > 0 && heap[(i - 1) >> 1]![0] > key) {
      heap[i] = heap[(i - 1) >> 1]!;
      i = (i - 1) >> 1;
    }
    heap[i] = [key, node];
  };
  const pop = () => {
    const top = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1]![0] < heap[c]![0]) c++;
        if (heap[c]![0] >= last[0]) break;
        heap[i] = heap[c]!;
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  for (const [node, value] of init)
    if (value < dist[node]!) {
      dist[node] = value;
      push(value, node);
    }
  while (heap.length) {
    const [key, node] = pop();
    if (key > dist[node]! || key >= limit) continue;
    for (let e = adjacency.start[node]!; e < adjacency.start[node + 1]!; e++) {
      const next = adjacency.to[e]!,
        d = key + adjacency.cost[e]!;
      if (d < dist[next]!) {
        dist[next] = d;
        push(d, next);
      }
    }
  }
  return dist;
}

const cachedHeights = new WeakMap<RailGraph, RailHeights>();
/**
 * TASK-132: each track's height profile. A tunnel lies at `tunnelM` (5 m deeper per layer below
 * -1), a bridge deck at 5 m per layer and at least `deckM` plus the clearance over every road and
 * track it crosses, other tracks at grade. Heights are sampled every `stepM` along the graph:
 * structures are sources, and ramps spread from them over the ground-level side at most at the
 * track's `maxGrade` (cones, so no sample-to-sample slope exceeds it). Pinned points stay at 0
 * and push a ramp into the structure instead: switches between ground tracks, level crossings,
 * road and junction surfaces, track crossings, platform edges, covered tracks, and a structure's
 * end at a node mapped at ground (`layer` 0) with nothing beyond it.
 */
export function railHeights(
  city: CompiledCity,
  roadGrades: readonly number[],
  nodeGrades: readonly number[],
): RailHeights {
  const rail = city.rail!;
  const cached = cachedHeights.get(rail);
  if (cached) return cached;
  const grades = rail.tracks.map(trackGrade);
  const structure = (i: number) => grades[i] === 'tunnel' || grades[i] === 'bridge';
  const levels = rail.tracks.map((t, i) =>
    grades[i] === 'tunnel'
      ? railGrade.tunnelM - railGrade.layerM * (Math.max(1, -t.layer) - 1)
      : grades[i] === 'bridge'
        ? railGrade.layerM * Math.max(1, t.layer)
        : 0,
  );
  const box = (line: readonly Vec2[]) =>
    [
      Math.min(...line.map((p) => p.x)),
      Math.min(...line.map((p) => p.y)),
      Math.max(...line.map((p) => p.x)),
      Math.max(...line.map((p) => p.y)),
    ] as const;
  const index = <T>(items: T[], line: (item: T) => readonly Vec2[]) => {
    const spatial = new Flatbush(Math.max(1, items.length));
    for (const item of items) spatial.add(...box(line(item)));
    if (!items.length) spatial.add(0, 0, 0, 0);
    spatial.finish();
    return (query: readonly Vec2[]) =>
      spatial.search(...box(query)).filter((i) => i < items.length);
  };
  const trackIndex = index(rail.tracks, (t) => t.line);
  const surfaces = [
    ...city.roads.map((r) => ({ ring: r.surface, grade: roadGrades[r.idx]!, line: r.reference })),
    ...city.nodes.map((n) => ({ ring: n.outline, grade: nodeGrades[n.idx]!, line: [] })),
  ]
    .filter((s) => s.ring.length >= 3 && s.grade >= 0)
    .map((s) => ({ ...s, inside: preparePolygon([...s.ring, s.ring[0]!]) }));
  const surfaceIndex = index(surfaces, (s) => s.ring);
  // Crossings of two tracks away from the nodes they share.
  const crossings = (t: RailGraph['tracks'][number], o: RailGraph['tracks'][number]) => {
    const shared = [o.fromNode, o.toNode]
      .filter((n) => n === t.fromNode || n === t.toNode)
      .map((n) => rail.nodes[n]!.pos);
    return polylineCrossings(t.line, o.line).filter(
      (hit) => !shared.some((q) => distance(q, hit.point) < 1),
    );
  };
  // Bridges clear what they cross, lower layers first so a bridge over a bridge clears its deck.
  for (const t of rail.tracks
    .filter((t) => grades[t.idx] === 'bridge')
    .sort((a, b) => a.layer - b.layer || a.idx - b.idx)) {
    for (const i of surfaceIndex(t.line)) {
      const s = surfaces[i]!;
      if (s.grade < t.layer && s.line.length && polylineCrossings(s.line, t.line).length)
        levels[t.idx] = Math.max(
          levels[t.idx]!,
          railGrade.layerM * s.grade + railGrade.roadClearanceM + railGrade.deckM,
        );
    }
    for (const i of trackIndex(t.line)) {
      const o = rail.tracks[i]!;
      if (o.layer < t.layer && grades[i] !== 'tunnel' && crossings(t, o).length)
        levels[t.idx] = Math.max(
          levels[t.idx]!,
          levels[i]! + railGrade.trackClearanceM + railGrade.deckM,
        );
    }
  }
  // Samples: the rail nodes first, then each track's interior stations.
  const counts = rail.tracks.map((t) => Math.max(1, Math.ceil(t.lengthM / railGrade.stepM)));
  const bases: number[] = [];
  let total = rail.nodes.length;
  for (const n of counts) {
    bases.push(total);
    total += n - 1;
  }
  const point = (t: number, i: number) =>
    i === 0
      ? rail.tracks[t]!.fromNode
      : i === counts[t]
        ? rail.tracks[t]!.toNode
        : bases[t]! + i - 1;
  const points = (t: number) => Array.from({ length: counts[t]! + 1 }, (_, i) => point(t, i));
  const degree = new Int32Array(total);
  for (const t of rail.tracks)
    for (let i = 0; i < counts[t.idx]!; i++) {
      degree[point(t.idx, i)]!++;
      degree[point(t.idx, i + 1)]!++;
    }
  const start = new Int32Array(total + 1);
  for (let i = 0; i < total; i++) start[i + 1] = start[i]! + degree[i]!;
  const fill = start.slice(0, total);
  const to = new Int32Array(start[total]!),
    cost = new Float64Array(start[total]!);
  for (const t of rail.tracks) {
    const step = (t.lengthM / counts[t.idx]!) * railGrade.maxGrade(t.kind);
    for (let i = 0; i < counts[t.idx]!; i++) {
      const a = point(t.idx, i),
        b = point(t.idx, i + 1);
      to[fill[a]!] = b;
      cost[fill[a]!++] = step;
      to[fill[b]!] = a;
      cost[fill[b]!++] = step;
    }
  }
  const adjacency = { start, to, cost };
  const deepest = Math.max(0, ...levels.map(Math.abs));
  const reach = spread(
    total,
    new Map(
      rail.tracks
        .filter((t) => structure(t.idx))
        .flatMap((t) => points(t.idx).map((p): [number, number] => [p, 0])),
    ),
    adjacency,
    deepest,
  );
  const pinned = new Uint8Array(total);
  for (const n of rail.nodes)
    if (
      n.kind === 'level_crossing' ||
      (n.kind === 'switch' && n.tracks.every((i) => !structure(i))) ||
      (n.layer === 0 && n.tracks.length === 1 && structure(n.tracks[0]!))
    )
      pinned[n.idx] = 1;
  for (const t of rail.tracks) {
    if (grades[t.idx] === 'covered') for (const p of points(t.idx)) pinned[p] = 1;
    if (grades[t.idx] !== 'ground' || !points(t.idx).some((p) => reach[p]! < deepest)) continue;
    const n = counts[t.idx]!,
      step = t.lengthM / n;
    const pin = (from: number, until: number) => {
      for (let i = Math.max(0, Math.ceil(from / step)); i <= Math.min(n, until / step); i++)
        pinned[point(t.idx, i)] = 1;
    };
    // Road and junction surfaces at grade or above, one sample beyond each edge.
    const nearby = surfaceIndex(t.line).map((i) => surfaces[i]!);
    for (let i = 0; i <= n; i++) {
      const p = pointAtDistance(t.line, t.cumulative, i * step);
      if (nearby.some((s) => s.inside(p))) pin((i - 1) * step, (i + 1) * step);
    }
    // Track crossings away from shared nodes: at grade, or under a bridge.
    for (const i of trackIndex(t.line)) {
      const o = rail.tracks[i]!;
      if (i === t.idx || grades[i] === 'tunnel') continue;
      for (const hit of crossings(t, o)) pin(hit.alongA - 4, hit.alongA + 4);
    }
  }
  const trackOf = new Map(rail.tracks.map((t) => [t.id, t]));
  for (const p of rail.platforms)
    for (const id of p.tracks) {
      const t = trackOf.get(id);
      if (!t || grades[t.idx] !== 'ground') continue;
      const shape =
        p.shape.kind === 'polygon'
          ? p.shape.ring
          : p.shape.kind === 'line'
            ? p.shape.line
            : [p.shape.pos];
      const along = shape.map((q) => nearestOnPolyline(t.line, q).along);
      const n = counts[t.idx]!,
        step = t.lengthM / n;
      for (let i = 0; i <= n; i++)
        if (i * step >= Math.min(...along) - 5 && i * step <= Math.max(...along) + 5)
          pinned[point(t.idx, i)] = 1;
    }
  // Pins hold first: a structure's level is clamped within its cone from the nearest pin. Then
  // every pin and structure point bounds the profile from above and below by its cone; a track
  // takes its own level (0 at grade) within those bounds, or their midpoint where two
  // structures are too close for both (the bounds cross; their mean still keeps the slope).
  const fromPins = spread(
    total,
    new Map([...pinned.keys()].filter((p) => pinned[p]).map((p): [number, number] => [p, 0])),
    adjacency,
    deepest,
  );
  const upper = new Map<number, number>(),
    lower = new Map<number, number>(),
    desired = new Float64Array(total);
  for (let p = 0; p < total; p++)
    if (pinned[p]) {
      upper.set(p, 0);
      lower.set(p, 0);
    }
  for (const t of rail.tracks) {
    if (!structure(t.idx)) continue;
    for (const p of points(t.idx)) {
      const level = Math.max(-fromPins[p]!, Math.min(fromPins[p]!, levels[t.idx]!));
      upper.set(p, Math.min(upper.get(p) ?? Infinity, level));
      lower.set(p, Math.min(lower.get(p) ?? Infinity, -level));
      desired[p] = levels[t.idx]!;
    }
  }
  const above = spread(total, upper, adjacency, deepest),
    below = spread(total, lower, adjacency, deepest);
  const height = (p: number) => {
    const low = -below[p]!,
      high = above[p]!;
    const h = low <= high ? Math.min(Math.max(desired[p]!, low), high) : (low + high) / 2;
    // Micrometres, without -0: the same profile in Node and every browser.
    return Math.round(h * 1e6) / 1e6 || 0;
  };
  const profiles = rail.tracks.map((t) => {
    const values = Float64Array.from(points(t.idx), height);
    return values.every((v) => v === values[0]) ? values.slice(0, 1) : values;
  });
  const portals: RailHeights['portals'] = [];
  for (const t of rail.tracks) {
    const kind = grades[t.idx]!;
    if (kind !== 'tunnel' && kind !== 'bridge') continue;
    for (const atEnd of [false, true]) {
      const node = rail.nodes[atEnd ? t.toNode : t.fromNode]!;
      if (
        node.tracks.some((i) => grades[i] !== kind) ||
        (node.tracks.length === 1 && pinned[node.idx])
      )
        portals.push({ track: t.idx, node: node.idx, atEnd, kind });
    }
  }
  const heights = { grades, levels, profiles, portals };
  cachedHeights.set(rail, heights);
  return heights;
}
