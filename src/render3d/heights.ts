import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  polylineNearest,
  type NearestOnPolyline,
} from '../geo/polyline';
import Flatbush from 'flatbush';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import { gradeProfiles, profileAt, profileHeightAt, type RoadProfile } from '../network/heights';
import { railGrade, railHeightAt, type RailGraph, type RailHeights } from '../network/rail';
import type { CityGeometry } from '../render/types';
import { MinHeap } from '../routing/heap';
import { createTerrain } from './terrain';

const nearest = new WeakMap<readonly Vec2[], (p: Vec2) => NearestOnPolyline>();

/** `roadStation` of `network/heights`, the station on `road`'s reference line abreast of `point`,
 * to the bit, from an index of the line built on first use (TASK-278: the walk network's height
 * lookups on Sindelfingen's A 81 ramps were 3.4 s of its 3D build in TASK-266's profile). */
export function roadStation(road: CRoad, point: Vec2): number {
  let find = nearest.get(road.reference);
  if (!find) nearest.set(road.reference, (find = polylineNearest(road.reference)));
  return find(point).along - road.stations[0]!;
}

export interface RoadHeight extends RoadProfile {
  ground?: (s: number) => number;
  crossfall?: (s: number, p: Vec2) => number;
}

export function heightAt(road: RoadHeight, s: number): number {
  const grade = profileHeightAt(road, s);
  return road.ground ? road.ground(s) + grade : grade;
}

/** A road at grade with no terrain under it: its surface is 0 at every station. */
export function levelRoad(road: RoadHeight): boolean {
  return (
    !road.ground &&
    !road.deckM &&
    !road.fromM &&
    !road.toM &&
    !road.fromSlope &&
    !road.toSlope &&
    road.lengthM > 0
  );
}

/** The surface height of `road` abreast of `p`, with the terrain's crossfall. TASK-206: on a level
 * road the station search (a nearest point on the reference line, half of Freiburg's 3D build) is
 * skipped; the height is the 0 it would give. */
export function roadSurfaceAt(road: CRoad, height: RoadHeight, p: Vec2): number {
  if (levelRoad(height)) return 0;
  const s = roadStation(road, p);
  return heightAt(height, s) + (height.crossfall?.(s, p) ?? 0);
}

export function heightSlopeAt(road: RoadHeight, s: number): number {
  if (s < 0 || s > road.lengthM) return 0;
  const { fromM, toM, fromSlope, toSlope, lengthM, t } = profileAt(road, s);
  return (
    (road.ground
      ? (road.ground(Math.min(road.lengthM, s + 0.1)) - road.ground(Math.max(0, s - 0.1))) /
        (Math.min(road.lengthM, s + 0.1) - Math.max(0, s - 0.1))
      : 0) +
    ((toM - fromM) * 6 * t * (1 - t)) / lengthM +
    fromSlope * (1 - t) * (1 - 3 * t) +
    toSlope * t * (3 * t - 2)
  );
}

export function cityHeights(city: CompiledCity, source: CityGeometry) {
  const profiles = gradeProfiles(city);
  const nodeGrades = city.nodes.map((n) => n.grade),
    roadGrades = city.roads.map((r) => r.grade);
  const nodes = profiles.nodes.slice();
  const roads = profiles.roads.map((road): RoadHeight => ({ ...road }));
  const terrain = createTerrain(source.terrain, source.context?.features);
  if (source.terrain) {
    for (const road of city.roads) {
      const height = roads[road.idx]!;
      const cumulative = cumulativeLengths(road.reference);
      const at = (s: number) => {
        const p = pointAtDistance(road.reference, cumulative, s + road.stations[0]!);
        return terrain.groundAt(p.x, p.y);
      };
      const fromNode = city.nodes[road.from]!,
        toNode = city.nodes[road.to]!;
      const from = nodeGrades[road.from] ? terrain.groundAt(fromNode.pos.x, fromNode.pos.y) : at(0);
      const to = nodeGrades[road.to]
        ? terrain.groundAt(toNode.pos.x, toNode.pos.y)
        : at(height.lengthM);
      const linear = (s: number) =>
        from + (to - from) * Math.max(0, Math.min(1, s / height.lengthM));
      const amplitude = Math.max(
        Math.abs(height.deckM),
        Math.abs(height.fromM),
        Math.abs(height.toM),
      );
      const blend = (s: number) =>
        amplitude ? Math.min(1, Math.abs(profileHeightAt(height, s)) / amplitude) : 0;
      height.ground = amplitude ? (s) => at(s) * (1 - blend(s)) + linear(s) * blend(s) : at;
      if (roadGrades[road.idx] === 0)
        height.crossfall = (s, p) => (terrain.surfaceAt(p.x, p.y) - at(s)) * (1 - blend(s));
    }
    for (const node of city.nodes) nodes[node.idx]! += terrain.groundAt(node.pos.x, node.pos.y);
  }
  return { nodes, roads, terrain, nodeGrades };
}

/** Apply the road's transverse terrain slope, or the ground junction's local surface. */
export function terrainVehicleOffset(
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
  segment: number,
  point: Vec2,
) {
  if (!heights.terrain.grid) return 0;
  if (segment >= 0) {
    const road = city.roads[city.lanes[segment]!.road]!;
    return heights.roads[road.idx]!.crossfall?.(roadStation(road, point), point) ?? 0;
  }
  const node = city.nodes[city.movements[-segment - 1]!.node]!;
  return heights.nodeGrades[node.idx] === 0
    ? heights.terrain.surfaceAt(point.x, point.y) - heights.terrain.groundAt(node.pos.x, node.pos.y)
    : 0;
}

export interface RailClearanceFloor {
  p: Vec2;
  layer: number;
  height: number;
}

export const railSheetReachM = 5;

/** A render-only lower envelope, falling away from each clearance floor at the rail's grade
 * limit. It joins at rail nodes and follows nearby parallel beds on the same layer. The network
 * profile (including its pins and its copy used in 2D) is left intact. */
export function raiseRailProfiles(
  graph: RailGraph,
  base: RailHeights,
  floors: readonly RailClearanceFloor[],
  sharedRoadDecks: ReadonlySet<number>,
  atPavement: (t: RailGraph['tracks'][number], p: Vec2, h: number) => boolean,
): RailHeights {
  if (!floors.length) return base;
  const samples: { track: number; p: Vec2; s: number; heading: number }[] = [];
  const starts: number[] = [],
    steps: number[] = [],
    counts: number[] = [];
  for (const t of graph.tracks) {
    starts[t.idx] = samples.length;
    const usable =
      !sharedRoadDecks.has(t.idx) &&
      (base.grades[t.idx] === 'bridge' ||
        (base.grades[t.idx] === 'ground' &&
          !(t.kind === 'tram' && (t.form ?? 'embedded') === 'embedded')));
    const n = usable ? Math.max(1, Math.ceil(t.lengthM / railGrade.stepM)) : -1;
    counts[t.idx] = n;
    const step = (steps[t.idx] = t.lengthM / n);
    for (let i = 0; i <= n; i++) {
      const s = i * step;
      samples.push({
        track: t.idx,
        s,
        p: pointAtDistance(t.line, t.cumulative, s),
        heading: headingAtDistance(t.line, t.cumulative, s),
      });
    }
  }
  const spatial = new Flatbush(samples.length);
  for (const { p } of samples) spatial.add(p.x, p.y, p.x, p.y);
  spatial.finish();
  const near = (p: Vec2, r: number) => spatial.search(p.x - r, p.y - r, p.x + r, p.y + r);
  const pinned = (node: RailGraph['nodes'][number]) =>
    node.kind === 'level_crossing' ||
    node.tracks.some((i) => counts[i]! < 0) ||
    (node.tracks.length === 1 && node.layer === 0 && !node.boundary);
  const fixed = new Set<number>();
  for (const crossing of graph.facilities ?? [])
    for (const { track, fromM, toM } of crossing.railSpans ?? []) {
      if (counts[track]! < 0) continue;
      const start = starts[track]!,
        step = steps[track]!;
      for (
        let i = Math.max(0, Math.floor(fromM / step));
        i <= Math.min(counts[track]!, Math.ceil(toM / step));
        i++
      )
        fixed.add(start + i);
    }
  const trackById = new Map(graph.tracks.map((t) => [t.id, t]));
  for (const platform of graph.platforms)
    for (const id of platform.tracks) {
      const t = trackById.get(id);
      if (!t || base.grades[t.idx] !== 'ground' || counts[t.idx]! < 0) continue;
      const shape = platform.shape;
      const line =
        shape.kind === 'polygon' ? shape.ring : shape.kind === 'line' ? shape.line : [shape.pos];
      const find = polylineNearest(t.line);
      const along = line.map((p) => find(p).along);
      const start = starts[t.idx]!,
        step = steps[t.idx]!;
      for (
        let i = Math.max(0, Math.ceil((Math.min(...along) - 5) / step));
        i <= Math.min(counts[t.idx]!, (Math.max(...along) + 5) / step);
        i++
      )
        fixed.add(start + i);
    }
  const original = Float64Array.from(samples, ({ track, s }) =>
    railHeightAt(base, graph.tracks[track]!, s),
  );
  const floor = new Float64Array(samples.length).fill(-Infinity);
  const anchors = new Set<number>();
  const heap = new MinHeap();
  const lift = (i: number, height: number) => {
    if (height <= floor[i]! || height <= original[i]! || anchors.has(i)) return;
    const { track, p } = samples[i]!;
    const t = graph.tracks[track]!;
    const endpoint =
      i === starts[track]
        ? graph.nodes[t.fromNode]
        : i === starts[track]! + counts[track]!
          ? graph.nodes[t.toNode]
          : undefined;
    if (
      fixed.has(i) ||
      (endpoint && pinned(endpoint)) ||
      (base.grades[track] === 'ground' && atPavement(t, p, original[i]!))
    ) {
      anchors.add(i);
      return;
    }
    floor[i] = height;
    heap.push(i, -height);
  };
  // The deck sheet blends samples up to 5 m away. Include their interpolation neighbours.
  const reach = railSheetReachM + railGrade.stepM;
  for (const { p, height, layer } of floors)
    for (const i of near(p, reach)) {
      const q = samples[i]!;
      const t = graph.tracks[q.track]!;
      if (
        t.layer === layer &&
        (base.grades[t.idx] === 'bridge' || original[i]! > 0.2) &&
        Math.hypot(q.p.x - p.x, q.p.y - p.y) <= reach
      )
        lift(i, height);
    }
  const parallel = Math.cos(Math.PI / 6);
  const ties = new Map<number, { i: number; d: number }>();
  const neighbors = (i: number, visit: (j: number, cost: number) => void) => {
    const a = samples[i]!,
      t = graph.tracks[a.track]!,
      start = starts[t.idx]!,
      end = start + counts[t.idx]!,
      cost = steps[t.idx]! * railGrade.maxGrade(t.kind);
    if (i > start) visit(i - 1, cost);
    if (i < end) visit(i + 1, cost);
    if (i === start || i === end) {
      const node = i === start ? t.fromNode : t.toNode;
      for (const j of graph.nodes[node]!.tracks)
        if (counts[j]! >= 0)
          visit(starts[j]! + (graph.tracks[j]!.fromNode === node ? 0 : counts[j]!), 0);
    }
    ties.clear();
    const shared = railGrade.sharedBedM;
    for (const j of near(a.p, shared + railGrade.stepM / 2)) {
      const b = samples[j]!;
      if (b.track === a.track || graph.tracks[b.track]!.layer !== t.layer) continue;
      const dx = a.p.x - b.p.x,
        dy = a.p.y - b.p.y,
        ux = Math.cos(b.heading),
        uy = Math.sin(b.heading),
        along = dx * ux + dy * uy,
        d = dx * dx + dy * dy;
      if (
        d >= (ties.get(b.track)?.d ?? Infinity) ||
        Math.abs(dx * uy - dy * ux) >= shared ||
        b.s + along < 0 ||
        b.s + along > graph.tracks[b.track]!.lengthM ||
        Math.abs(Math.cos(a.heading - b.heading)) < parallel
      )
        continue;
      ties.set(b.track, { i: j, d });
    }
    for (const { i: j } of ties.values()) visit(j, 0);
  };
  for (let i = heap.pop(); i !== undefined; i = heap.pop()) {
    const h = -heap.cost;
    if (h === floor[i]) neighbors(i, (j, cost) => lift(j, h - cost));
  }
  // Propagate the cap from a fixed surface or portal back into the raised profile. A low
  // crossing near an anchor may have too little room for the ramp; keep the gradient there.
  for (const i of anchors) heap.push(i, original[i]!);
  for (let i = heap.pop(); i !== undefined; i = heap.pop()) {
    const h = heap.cost;
    if (h !== Math.max(original[i]!, floor[i]!)) continue;
    neighbors(i, (j, cost) => {
      const cap = Math.max(original[j]!, h + cost);
      if (cap >= floor[j]!) return;
      floor[j] = cap;
      heap.push(j, cap);
    });
  }
  const profiles = graph.tracks.map((t) => {
    const start = starts[t.idx]!,
      count = counts[t.idx]!;
    if (count < 0 || !floor.subarray(start, start + count + 1).some(Number.isFinite))
      return base.profiles[t.idx]!;
    return Float64Array.from(floor.subarray(start, start + count + 1), (h, i) =>
      Math.max(h, original[start + i]!),
    );
  });
  return { ...base, profiles };
}
