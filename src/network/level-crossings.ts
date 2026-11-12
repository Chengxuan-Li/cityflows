import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineCrossings,
  polylineLength,
  segmentDistance,
  segmentIntersection,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City, Road } from '../schema';
import type { RailNode, RailTrack } from '../schema/rail';
import { trackGrade, type RailGraph } from './rail';
import type { CompiledCity } from './types';

export interface LevelCrossing {
  nodes: string[];
  kind: 'rail' | 'tram';
  layer: number;
  /** Sim segment encoding: lane >= 0, movement = -index - 1. */
  spans?: { segment: number; fromM: number; toM: number }[];
  stops?: { lane: number; stopM: number }[];
  /** Track metres occupied by the road surface, including a clearance margin. */
  railSpans?: { track: number; fromM: number; toM: number }[];
  approaches: {
    roadId: string;
    /** Stop marking centre; heading points toward the tracks. */
    pos: Vec2;
    heading: number;
    halfWidthM: number;
    /** Roadside post on the driving side, clear of every carriageway and running track. */
    post: Vec2;
    barrier: boolean;
    lights: boolean;
    bell: boolean;
  }[];
}

/** Exact minimum distance between a full stop-marking segment and a track polyline. */
export function crossingSegmentClear(a: Vec2, b: Vec2, line: readonly Vec2[], clearM = 3) {
  for (let i = 1; i < line.length; i++) {
    const c = line[i - 1]!,
      d = line[i]!;
    if (
      segmentIntersection(a, b, c, d) ||
      Math.min(
        segmentDistance(a, c, d),
        segmentDistance(b, c, d),
        segmentDistance(c, a, b),
        segmentDistance(d, a, b),
      ) < clearM
    )
      return false;
  }
  return true;
}
const sameRoad = (a: Road, b: Road) =>
  a.id === b.id || a.provenance.osmIds?.some((id) => b.provenance.osmIds?.includes(id));
const atGrade = (track: RailTrack) => {
  const grade = trackGrade(track);
  return grade === 'ground' || grade === 'covered';
};

/** Mapped facilities only. Geometric intersections alone never invent crossing equipment. */
export function compileLevelCrossings(
  city: City,
  graph: Pick<RailGraph, 'nodes' | 'tracks'>,
  geometry?: CompiledCity,
): LevelCrossing[] {
  type Arm = { node: RailNode; road: Road; along: number; direction: Vec2 };
  const roads = Object.values(city.roads);
  const candidates = graph.nodes.flatMap((node) => {
    if (!node.crossing || node.crossing.kind === 'pedestrian') return [];
    const tracks = graph.tracks.filter(
      (t) => (t.from === node.id || t.to === node.id) && atGrade(t),
    );
    if (!tracks.length) return [];
    const arms: Arm[] = [];
    for (const road of roads) {
      const mappedRoad = road.provenance.osmIds?.some((id) =>
        node.crossing!.roadOsmIds?.includes(id),
      );
      // Known OSM topology wins over proximity, even when its highway was excluded at import.
      if (node.crossing.roadOsmIds !== undefined && !mappedRoad) continue;
      const layer =
        road.layer ?? Math.min(city.nodes[road.from]!.layer, city.nodes[road.to]!.layer);
      // Ground tracks may carry layer=-1 without being tunnels (TASK-132).
      if (layer !== node.layer && layer !== 0) continue;
      let hit = nearestOnPolyline(road.centerline, node.pos);
      if (hit.away > 1 && mappedRoad) {
        const crossing = tracks
          .flatMap((t) => polylineCrossings(road.centerline, t.line))
          .filter((h) => Math.hypot(h.point.x - node.pos.x, h.point.y - node.pos.y) < 20)
          .sort(
            (a, b) =>
              Math.hypot(a.point.x - node.pos.x, a.point.y - node.pos.y) -
              Math.hypot(b.point.x - node.pos.x, b.point.y - node.pos.y),
          )[0];
        if (crossing) hit = nearestOnPolyline(road.centerline, crossing.point);
      }
      if (hit.away > 1 || hit.along < 0.1) continue;
      if (
        !mappedRoad &&
        !tracks.some((t) => {
          const d = nearestOnPolyline(t.line, node.pos).direction;
          return Math.abs(d.x * hit.direction.y - d.y * hit.direction.x) > 0.35;
        })
      )
        continue;
      arms.push({
        node,
        road,
        along: hit.along,
        direction: { x: -hit.direction.x, y: -hit.direction.y },
      });
    }
    return arms.length ? [{ node, arms }] : [];
  });
  if (!candidates.length) return [];
  const seen = new Set<string>(),
    result: LevelCrossing[] = [];
  const surface = geometry
    ? [...geometry.roads.map((r) => r.surface), ...geometry.nodes.map((n) => n.outline)]
        .filter((p) => p.length)
        .map((r) => [...r, r[0]!])
    : [];
  const spatial = new Flatbush(Math.max(1, surface.length));
  for (const ring of surface) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    spatial.add(minX, minY, maxX, maxY);
  }
  if (!surface.length) spatial.add(0, 0, 0, 0);
  spatial.finish();
  const onSurface = (p: Vec2) =>
    surface.length > 0 &&
    spatial.search(p.x - 0.4, p.y - 0.4, p.x + 0.4, p.y + 0.4).some((i) => {
      const r = surface[i]!;
      return (
        pointInPolygon(p, r) ||
        r.some((v, j) => segmentDistance(p, v, r[(j + 1) % r.length]!) < 0.4)
      );
    });
  for (const first of candidates) {
    if (seen.has(first.node.id)) continue;
    const group = [first];
    seen.add(first.node.id);
    // Adjacent tracks group only along the same mapped road, never by proximity alone.
    for (const item of group)
      for (const other of candidates) {
        if (seen.has(other.node.id) || other.node.crossing!.kind !== item.node.crossing!.kind)
          continue;
        const dx = other.node.pos.x - item.node.pos.x,
          dy = other.node.pos.y - item.node.pos.y;
        if (
          Math.hypot(dx, dy) > 22 ||
          !item.arms.some(
            (a) =>
              Math.abs(dx * a.direction.y - dy * a.direction.x) < 2 &&
              other.arms.some((b) => sameRoad(a.road, b.road)),
          )
        )
          continue;
        group.push(other);
        seen.add(other.node.id);
      }
    const arms: Arm[][] = [];
    for (const arm of group.flatMap((g) => g.arms)) {
      const same = arms.find(
        (a) =>
          a[0]!.direction.x * arm.direction.x + a[0]!.direction.y * arm.direction.y > 0.94 &&
          sameRoad(a[0]!.road, arm.road),
      );
      if (same) same.push(arm);
      else arms.push([arm]);
    }
    const firstRoad = first.arms[0]!.road;
    const facility: LevelCrossing = {
      nodes: group.map((g) => g.node.id),
      kind: first.node.crossing!.kind as 'rail' | 'tram',
      layer:
        firstRoad.layer ??
        Math.min(city.nodes[firstRoad.from]!.layer, city.nodes[firstRoad.to]!.layer),
      approaches: [],
    };
    const tracks = graph.tracks.filter(atGrade);
    for (const options of arms) {
      options.sort(
        (a, b) =>
          (b.node.pos.x - a.node.pos.x) * a.direction.x +
          (b.node.pos.y - a.node.pos.y) * a.direction.y,
      );
      const arm = options[0]!;
      let road = arm.road,
        along = arm.along,
        travelled = 0;
      const visited = new Set<string>();
      let placed = false;
      // Walk backward through straight incoming roads to the actual approach outside a wide junction.
      while (!placed && travelled < 100 && !visited.has(road.id)) {
        visited.add(road.id);
        const cumulative = cumulativeLengths(road.centerline),
          width = road.lanes.reduce((n, l) => n + l.widthM, 0),
          side = city.drivingSide === 'left' ? -1 : 1;
        for (let d = Math.max(0, 5 - travelled); d <= along; d += 0.5) {
          const s = along - d,
            p = pointAtDistance(road.centerline, cumulative, s),
            heading = headingAtDistance(road.centerline, cumulative, s),
            normal = { x: -Math.sin(heading), y: Math.cos(heading) };
          const pos = {
            x: p.x + normal.x * road.lateralOffsetM,
            y: p.y + normal.y * road.lateralOffsetM,
          };
          const a = { x: pos.x - (normal.x * width) / 2, y: pos.y - (normal.y * width) / 2 },
            b = { x: pos.x + (normal.x * width) / 2, y: pos.y + (normal.y * width) / 2 };
          if (!tracks.every((t) => crossingSegmentClear(a, b, t.line))) continue;
          // Posts stand outside the whole carriageway, including the opposite directed road.
          const across = roads
            .filter((r) => sameRoad(r, road))
            .map((r) => {
              const h = nearestOnPolyline(r.centerline, p),
                dot = h.direction.x * Math.cos(heading) + h.direction.y * Math.sin(heading);
              return h.away < 1 && Math.abs(dot) > 0.9
                ? side * (r.lateralOffsetM * Math.sign(dot)) +
                    r.lanes.reduce((n, l) => n + l.widthM, 0) / 2
                : -Infinity;
            });
          const edge = Math.max(...across, side * road.lateralOffsetM + width / 2);
          const post = {
            x: p.x + normal.x * side * (edge + 0.8),
            y: p.y + normal.y * side * (edge + 0.8),
          };
          if (tracks.some((t) => nearestOnPolyline(t.line, post).away < 3) || onSurface(post))
            continue;
          const gate = { x: post.x + Math.cos(heading) * 0.8, y: post.y + Math.sin(heading) * 0.8 };
          if (
            first.node.crossing!.kind === 'rail' &&
            (onSurface(gate) || tracks.some((t) => nearestOnPolyline(t.line, gate).away < 3))
          )
            continue;
          if (
            geometry?.nodes.some(
              (n) => n.outline.length && pointInPolygon(pos, [...n.outline, n.outline[0]!]),
            )
          )
            continue;
          const mapped = arm.node.crossing!;
          facility.approaches.push({
            roadId: road.id,
            pos,
            heading,
            halfWidthM: width / 2,
            post,
            barrier: facility.kind === 'rail',
            lights: true,
            bell: mapped.bell !== undefined && mapped.bell !== 'no',
          });
          placed = true;
          break;
        }
        if (placed) break;
        travelled += along;
        const direction = nearestOnPolyline(road.centerline, road.centerline[0]!).direction;
        const previous = roads
          .filter((r) => r.to === road.from && r.from !== road.to)
          .filter((r) => {
            const d = nearestOnPolyline(r.centerline, r.centerline.at(-1)!).direction;
            return d.x * direction.x + d.y * direction.y > 0.87;
          });
        if (previous.length !== 1) break;
        road = previous[0]!;
        along = polylineLength(road.centerline);
      }
    }
    if (facility.approaches.length) {
      if (geometry) compileProtection(facility, graph, geometry, city);
      result.push(facility);
    }
  }
  return result;
}

function compileProtection(
  facility: LevelCrossing,
  rail: Pick<RailGraph, 'nodes' | 'tracks'>,
  city: CompiledCity,
  source: City,
) {
  const nodes = rail.nodes.filter((n) => facility.nodes.includes(n.id));
  const tracks = rail.tracks.filter(
    (t) => atGrade(t) && nodes.some((n) => t.from === n.id || t.to === n.id),
  );
  facility.stops = facility.approaches.flatMap((a) => {
    const road = city.roads.find((r) => r.id === a.roadId)!;
    return road.lanes.map((lane) => ({
      lane,
      stopM: nearestOnPolyline(city.lanes[lane]!.polyline, a.pos).along,
    }));
  });
  facility.spans = [];
  facility.railSpans = [];
  const sameGrade = (lane: number) => {
    const road = source.roads[city.roads[city.lanes[lane]!.road]!.id]!;
    return (road.layer ?? source.nodes[road.from]!.layer) === facility.layer;
  };
  const segments = [
    ...city.lanes
      .filter((l) => sameGrade(l.idx))
      .map((l) => ({ ...l, segment: l.idx, halfWidth: l.widthM / 2 })),
    ...city.movements
      .filter((m) => sameGrade(m.fromLane) && sameGrade(m.toLane))
      .map((m) => ({
        ...m,
        segment: -m.idx - 1,
        halfWidth: Math.max(city.lanes[m.fromLane]!.widthM, city.lanes[m.toLane]!.widthM) / 2,
      })),
  ].filter((s) => nodes.some((n) => nearestOnPolyline(s.polyline, n.pos).away <= 30));
  const localTracks = tracks.map((t) => {
    const at = nodes
      .filter((n) => t.from === n.id || t.to === n.id)
      .map((n) => nearestOnPolyline(t.line, n.pos).along);
    const low = Math.max(0, Math.min(...at) - 30),
      high = Math.min(t.lengthM, Math.max(...at) + 30);
    return {
      ...t,
      line: trimPolyline(t.line, low, t.lengthM - high),
      low,
      high,
      halfWidth: t.kind === 'tram' ? 1.2 : 1.5,
    };
  });
  const active = new Set<number>();
  for (const s of segments)
    if (
      localTracks.some((t) =>
        polylineCrossings(s.polyline, t.line).some((h) =>
          nodes.some((n) => Math.hypot(n.pos.x - h.point.x, n.pos.y - h.point.y) <= 30),
        ),
      )
    )
      active.add(s.segment);
  // A body-width cross section, sampled at <=25 cm; the margin covers the sample interval.
  const contact = (
    line: readonly Vec2[],
    cumulative: Float64Array,
    lengthM: number,
    halfWidth: number,
    other: readonly Vec2[],
    otherHalfWidth: number,
  ) => {
    let low = Infinity,
      high = -Infinity;
    const count = Math.max(1, Math.ceil(lengthM / 0.25));
    for (let i = 0; i <= count; i++) {
      const at = (i * lengthM) / count,
        p = pointAtDistance(line, cumulative, at),
        heading = headingAtDistance(line, cumulative, at);
      const nx = -Math.sin(heading) * halfWidth,
        ny = Math.cos(heading) * halfWidth;
      if (
        crossingSegmentClear(
          { x: p.x - nx, y: p.y - ny },
          { x: p.x + nx, y: p.y + ny },
          other,
          otherHalfWidth + 0.25,
        )
      )
        continue;
      low = Math.min(low, Math.max(0, at - 0.25));
      high = Math.max(high, Math.min(lengthM, at + 0.25));
    }
    return low <= high ? { fromM: low, toM: high } : undefined;
  };
  const contacts = new Map(
    segments.flatMap((s) => {
      const intervals = localTracks.flatMap((t) => {
        const hit = contact(s.polyline, s.cumulative, s.lengthM, s.halfWidth, t.line, t.halfWidth);
        return hit ? [hit] : [];
      });
      return intervals.length
        ? [
            [
              s.segment,
              {
                fromM: Math.min(...intervals.map((i) => i.fromM)),
                toM: Math.max(...intervals.map((i) => i.toM)),
              },
            ] as const,
          ]
        : [];
    }),
  );
  const neighbours = (segment: number) =>
    segment >= 0
      ? [...city.lanes[segment]!.in, ...city.lanes[segment]!.out].map((m) => -m - 1)
      : [city.movements[-segment - 1]!.fromLane, city.movements[-segment - 1]!.toLane];
  // Only actual crossing paths and the touching ends of their connected lanes/movements count.
  // Proximity to a parallel street does not invent an additional crossing.
  const queue = [...active];
  for (const segment of queue)
    for (const next of neighbours(segment))
      if (!active.has(next) && contacts.has(next)) {
        active.add(next);
        queue.push(next);
      }
  facility.spans = segments.flatMap((s) =>
    active.has(s.segment) && contacts.has(s.segment)
      ? [{ segment: s.segment, ...contacts.get(s.segment)! }]
      : [],
  );
  for (const t of localTracks) {
    const cumulative = cumulativeLengths(t.line),
      lengthM = polylineLength(t.line);
    const intervals = segments
      .filter((s) => active.has(s.segment))
      .flatMap((s) => {
        const hit = contact(t.line, cumulative, lengthM, t.halfWidth, s.polyline, s.halfWidth);
        return hit ? [hit] : [];
      });
    if (intervals.length)
      facility.railSpans.push({
        track: t.idx,
        fromM: t.low + Math.min(...intervals.map((i) => i.fromM)),
        toM: t.low + Math.max(...intervals.map((i) => i.toM)),
      });
  }
  const spans = new Map(facility.spans.map((s) => [s.segment, s]));
  const stops = new Map(facility.stops.map((s) => [s.lane, s.stopM]));
  const seen = new Set<number>();
  const entry = (segment: number) => {
    if (seen.has(segment)) return;
    seen.add(segment);
    if (segment < 0) {
      entry(city.movements[-segment - 1]!.fromLane);
      return;
    }
    const lane = city.lanes[segment]!,
      span = spans.get(segment);
    if (span && span.fromM < 0.5) {
      for (const m of lane.in) entry(-m - 1);
      return;
    }
    const stopM = Math.max(0, Math.min(lane.stopM, span ? span.fromM - 0.5 : lane.lengthM));
    stops.set(segment, Math.min(stops.get(segment) ?? Infinity, stopM));
  };
  for (const span of facility.spans) entry(span.segment);
  facility.stops = [...stops].sort(([a], [b]) => a - b).map(([lane, stopM]) => ({ lane, stopM }));
}
