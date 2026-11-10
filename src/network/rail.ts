import Flatbush from 'flatbush';
import { cumulativeLengths, distance, polylineCrossings, polylineLength } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City } from '../schema';
import type { RailNode, RailTrack, RailPlatform } from '../schema/rail';

export interface RailGraph {
  nodes: (RailNode & { idx: number; tracks: number[] })[];
  tracks: (RailTrack & {
    idx: number;
    fromNode: number;
    toNode: number;
    lengthM: number;
    cumulative: Float64Array;
  })[];
  platforms: RailPlatform[];
  connections: { node: number; from: number; to: number }[];
  components: number[][];
  crossings: { roadId: string; track: number; pos: Vec2; roadM: number; trackM: number }[];
}

// Thirty degrees accommodates shallow turnout frogs, while excluding corners and reversals.
export const railDeflectionDeg = 30;
export function compileRail(city: City): RailGraph | undefined {
  if (!city.rail) return undefined;
  const nodes = Object.values(city.rail.nodes)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n, idx) => ({ ...n, idx, tracks: [] as number[] }));
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
    components,
    crossings,
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
