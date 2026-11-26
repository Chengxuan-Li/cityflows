import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CLane, CompiledCity } from '../network';
import { gradeHeightM, gradeProfiles, laneHeightAt, profileHeightAt } from '../network/heights';
import { railHeights, railHeightAt } from '../network/rail';
import type { CityGeometry, Pick } from './types';
import { connectorPosition } from './picking';
import type { DebugOverlay } from './debug-settings';
import {
  arrow,
  closed,
  dot,
  elevated,
  ink,
  line,
  type DebugPrimitive,
} from './debug-geometry-primitives';

export {
  pickDebugGeometry,
  type DebugPoint,
  type DebugPrimitive,
} from './debug-geometry-primitives';
export { dynamicDebugGeometry } from './debug-geometry-sim';
export { heightDebugColor, heightDebugGeometry } from './debug-geometry-heights';

function laneGeometry(city: CompiledCity, lane: CLane) {
  const road = city.roads[lane.road]!;
  const profile = gradeProfiles(city).roads[road.idx]!;
  if (!profile.fromM && !profile.toM && !profile.deckM) return lane.polyline;
  return lane.polyline.map((p, i) =>
    elevated(p, profileHeightAt(profile, road.stations[i]! - road.stations[0]!)),
  );
}

function roadGraph(city: CompiledCity, source?: CityGeometry) {
  const out: DebugPrimitive[] = [];
  const adjacent = city.nodes.map(() => new Set<number>());
  const gateways = new Set<number>(),
    ring = new Set<number>();
  for (const place of city.places) {
    if (place.kind !== 'gateway') continue;
    for (const idx of [...place.connectorsIn, ...place.connectorsOut]) {
      const c = city.connectors[idx]!,
        lane = city.lanes[c.lane]!,
        road = city.roads[lane.road]!;
      gateways.add(c.positionM < lane.lengthM / 2 ? road.from : road.to);
    }
  }
  for (const node of Object.values(source?.nodes ?? {})) {
    for (const id of node.roundabout?.ringRoads ?? []) {
      const road = city.roads[city.index.road.get(id)!]!;
      if (road) {
        ring.add(road.from);
        ring.add(road.to);
      }
    }
  }
  for (const road of city.roads) {
    adjacent[road.from]!.add(road.to);
    adjacent[road.to]!.add(road.from);
    const first = city.lanes[road.lanes[0]!]!;
    const last = city.lanes[road.lanes.at(-1)!]!;
    const middle = laneGeometry(city, first).map((p, i) =>
      elevated(
        { x: (p.x + last.polyline[i]!.x) / 2, y: (p.y + last.polyline[i]!.y) / 2 },
        'z' in p ? Number(p.z) : 0,
      ),
    );
    const start = city.nodes[road.from]!,
      end = city.nodes[road.to]!;
    const points = [
      elevated(start.pos, start.grade * gradeHeightM),
      ...middle,
      elevated(end.pos, end.grade * gradeHeightM),
    ];
    out.push(
      line(points, ink.blue, road.id, { kind: 'lane', road: road.idx, lane: first.idx }),
      arrow(points, ink.blue, 5),
    );
  }
  for (const n of city.nodes) {
    const color = gateways.has(n.idx)
      ? ink.purple
      : n.signal
        ? ink.red
        : n.miniRoundabout || ring.has(n.idx) || source?.nodes[n.id]?.roundabout
          ? ink.amber
          : adjacent[n.idx]!.size <= 1
            ? ink.slate
            : ink.green;
    out.push(
      dot(elevated(n.pos, n.grade * gradeHeightM), color, n.id, { kind: 'node', node: n.idx }),
    );
  }
  return out;
}

function crossbar(p: Vec2, heading: number, widthM: number, z = 0) {
  const dx = (-Math.sin(heading) * widthM) / 2,
    dy = (Math.cos(heading) * widthM) / 2;
  return [elevated({ x: p.x + dx, y: p.y + dy }, z), elevated({ x: p.x - dx, y: p.y - dy }, z)];
}

function laneGraph(city: CompiledCity) {
  const out: DebugPrimitive[] = [];
  for (const lane of city.lanes) {
    const points = laneGeometry(city, lane);
    const pick: Pick = { kind: 'lane', lane: lane.idx, road: lane.road };
    const stop = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM);
    out.push(line(points, ink.cyan, lane.id, pick), arrow(points, ink.cyan, 2.5));
    if (lane.out.length)
      out.push(
        line(
          crossbar(
            stop,
            headingAtDistance(lane.polyline, lane.cumulative, lane.stopM),
            lane.widthM,
            laneHeightAt(city, lane, stop),
          ),
          ink.red,
        ),
      );
  }
  for (const m of city.movements) {
    const z = city.nodes[m.node]!.grade * gradeHeightM;
    out.push(
      line(z ? m.polyline.map((p) => elevated(p, z)) : m.polyline, ink.purple, m.id, {
        kind: 'node',
        node: m.node,
      }),
    );
    for (let i = 0; i < m.conflicts.length; i++) {
      if (m.conflicts[i]! <= m.idx) continue;
      const [from, to] = m.conflictZones[i]!;
      out.push(
        dot(elevated(pointAtDistance(m.polyline, m.cumulative, (from + to) / 2), z), ink.amber),
      );
    }
  }
  return out;
}

function railGraph(city: CompiledCity) {
  const out: DebugPrimitive[] = [];
  const g = city.rail;
  if (!g) return out;
  const heights = railHeights(
    city,
    city.roads.map((r) => r.grade),
    city.nodes.map((n) => n.grade),
  );
  const blocks = [ink.purple, ink.cyan, ink.blue, ink.pink];
  // The timetable reserves complete track sections. Colour adjoining blocks separately.
  const blockIndex: number[] = [];
  for (const track of g.tracks) {
    const neighbours = new Set(
      [...g.nodes[track.fromNode]!.tracks, ...g.nodes[track.toNode]!.tracks].map(
        (t) => blockIndex[t],
      ),
    );
    const block = blocks.findIndex((_, i) => !neighbours.has(i));
    blockIndex[track.idx] = block >= 0 ? block : track.idx % blocks.length;
    const points = track.line.map((p, i) =>
      elevated(p, railHeightAt(heights, track, track.cumulative[i]!)),
    );
    out.push(
      line(points, blocks[blockIndex[track.idx]!]!, track.id, { kind: 'track', track: track.idx }),
    );
  }
  for (const n of g.nodes) {
    const track = g.tracks[n.tracks[0]!];
    const z = track
      ? railHeightAt(heights, track, track.fromNode === n.idx ? 0 : track.lengthM)
      : n.layer * gradeHeightM;
    out.push(
      dot(
        elevated(n.pos, z),
        n.signal ? ink.red : n.kind === 'switch' ? ink.amber : ink.slate,
        n.id,
        track ? { kind: 'track', track: track.idx } : undefined,
      ),
    );
  }
  for (const [idx, p] of g.platforms.entries()) {
    const pick: Pick = { kind: 'platform', platform: idx },
      shape = p.shape,
      z = p.layer * gradeHeightM;
    out.push(
      shape.kind === 'point'
        ? dot(elevated(shape.pos, z), ink.green, p.id, pick)
        : line(
            (shape.kind === 'line' ? shape.line : closed(shape.ring)).map((at) => elevated(at, z)),
            ink.green,
            p.id,
            pick,
          ),
    );
  }
  // Trace the legal pairings at turnouts locally, separate from the longer section lines.
  for (const c of g.connections) {
    const n = g.nodes[c.node]!;
    if (c.from >= c.to || (n.kind !== 'switch' && n.tracks.length < 3)) continue;
    const at = (idx: number) => {
      const t = g.tracks[idx]!,
        d = Math.min(t.lengthM / 2, 9);
      const s = t.fromNode === n.idx ? d : t.lengthM - d;
      return elevated(pointAtDistance(t.line, t.cumulative, s), railHeightAt(heights, t, s));
    };
    const t = g.tracks[c.from]!;
    out.push(
      line(
        [
          at(c.from),
          elevated(n.pos, railHeightAt(heights, t, t.fromNode === n.idx ? 0 : t.lengthM)),
          at(c.to),
        ],
        ink.amber,
      ),
    );
  }
  return out;
}

function airsideGraph(city: CompiledCity, glideSlopeDeg: number) {
  const out: DebugPrimitive[] = [];
  const g = city.airside;
  if (!g) return out;
  for (const e of g.edges)
    if (e.kind !== 'runway')
      out.push(line(e.line, ink.cyan, e.id, { kind: 'taxiway', edge: e.idx }));
  for (const n of g.nodes) out.push(dot(n.pos, ink.slate, n.id));
  for (const r of g.runways) {
    out.push(line(r.line, ink.blue, r.id));
    for (const [i, end] of r.ends.entries()) {
      const threshold = g.nodes[end.threshold]!.pos,
        tip = g.nodes[end.node]!.pos;
      const id = r.id + ' ' + end.designator;
      out.push(
        line(crossbar(tip, end.heading, r.widthM), ink.red, id),
        line(crossbar(threshold, end.heading, r.widthM * 0.85), ink.green, id),
      );
      const remaining = i === 0 ? r.lengthM - end.thresholdM : end.thresholdM;
      const aim = Math.min(300, 0.2 * remaining),
        slope = Math.tan((glideSlopeDeg * Math.PI) / 180);
      const approach = (m: number) => ({
        x: threshold.x - m * Math.cos(end.heading),
        y: threshold.y - m * Math.sin(end.heading),
        z: (m + aim) * slope,
      });
      out.push({ ...line([approach(-aim), approach(10_000)], ink.pink), only3d: true });
    }
  }
  for (const h of g.holds)
    out.push(dot(g.nodes[h.node]!.pos, ink.red, h.id, { kind: 'hold', hold: h.idx }));
  for (const s of g.stands) out.push(dot(s.pos, ink.amber, s.id, { kind: 'stand', stand: s.idx }));
  return out;
}

function walkGraph(city: CompiledCity, source?: CityGeometry) {
  const out: DebugPrimitive[] = [];
  const entrances = new Set<number>();
  for (const anchors of city.walk.places.values()) for (const node of anchors) entrances.add(node);
  const doors = new Set(
    Object.values(source?.walk?.nodes ?? {})
      .filter((n) => n.entrance)
      .map((n) => n.id),
  );
  for (const p of Object.values(source?.places ?? {}))
    for (const door of p.station?.entrances ?? []) doors.add(door);
  for (const l of city.walk.links) {
    const z = l.layer * gradeHeightM;
    out.push(
      line(
        z ? l.line.map((p) => elevated(p, z)) : l.line,
        l.crossing ? ink.amber : l.kind === 'access' ? ink.purple : ink.green,
        l.id,
      ),
    );
  }
  for (const n of city.walk.nodes) {
    const door = entrances.has(n.idx) || n.sourceIds.some((id) => doors.has(id));
    out.push(
      dot(
        elevated(n.pos, n.layer * gradeHeightM),
        door ? ink.pink : ink.cyan,
        n.sourceIds.join(' / ') || 'Walk node ' + n.idx,
      ),
    );
  }
  return out;
}

function places(city: CompiledCity, source?: CityGeometry) {
  const out: DebugPrimitive[] = [];
  for (const p of city.places) {
    const shape = source?.places[p.id]?.shape;
    const pick: Pick = { kind: 'place', place: p.idx };
    out.push(
      shape?.kind === 'polygon'
        ? line(closed(shape.ring), ink.purple, p.id, pick)
        : dot(p.centroid, ink.purple, p.id, pick),
    );
  }
  for (const c of city.connectors) {
    const lane = city.lanes[c.lane]!,
      p = connectorPosition(city, c);
    const point = elevated(p, laneHeightAt(city, lane, p));
    const color = c.direction === 'both' ? ink.cyan : c.direction === 'in' ? ink.green : ink.amber;
    out.push(dot(point, color, c.id, { kind: 'connector', connector: c.idx }));
    if (c.parking === undefined) {
      const target = city.places[c.place]!.centroid;
      const path = c.direction === 'out' ? [target, point] : [point, target];
      out.push(line(path, color), arrow(path, color, 3));
      if (c.direction === 'both') out.push(arrow(path.toReversed(), color, 3));
    }
  }
  const lots = new Map((city.lots ?? []).map((l) => [l.id, l]));
  for (const lot of lots.values()) {
    const graph = lot.circulation;
    if (graph)
      for (const e of graph.edges)
        out.push(line([graph.nodes[e.from]!, graph.nodes[e.to]!], ink.cyan));
    for (const p of lot.aislePaths ?? []) out.push(line(p, ink.blue));
    for (const s of lot.stalls) out.push(line(closed(s.corners), ink.amber));
  }
  for (const p of city.parking) {
    const shape = p.source.shape;
    if (shape?.kind === 'polygon')
      out.push(line(closed(shape.ring), ink.purple, p.id, { kind: 'parking', parking: p.idx }));
    else out.push(dot(p.centroid, ink.purple, p.id, { kind: 'parking', parking: p.idx }));
  }
  for (const space of city.parkingSpaces ?? []) {
    const facility = city.parking[space.parking]!;
    const lot = lots.get(facility.id);
    const stall = space.lotStall !== undefined ? lot?.stalls[space.lotStall] : undefined;
    const z = laneHeightAt(city, city.lanes[space.lane]!, space.position);
    const pos = elevated(space.position, z);
    const pick: Pick = { kind: 'parking', parking: space.parking };
    out.push(dot(pos, ink.amber, facility.id + ' / ' + space.idx, pick));
    const access =
      stall?.access ??
      (stall && lot?.circulation
        ? lot.circulation.nodes[lot.circulation.stallNodes[space.lotStall!]!]
        : undefined);
    if (access) out.push(line([pos, elevated(access, z)], ink.green));
    else if (!stall) {
      const lane = city.lanes[space.lane]!;
      out.push(
        line(
          [pos, elevated(pointAtDistance(lane.polyline, lane.cumulative, space.positionM), z)],
          ink.green,
        ),
      );
    }
  }
  return out;
}

export function staticDebugGeometry(
  overlay: DebugOverlay,
  city: CompiledCity,
  source?: CityGeometry,
  glideSlopeDeg = 3,
): DebugPrimitive[] {
  switch (overlay) {
    case 'roadGraph':
      return roadGraph(city, source);
    case 'lanes':
      return laneGraph(city);
    case 'railGraph':
      return railGraph(city);
    case 'airsideGraph':
      return airsideGraph(city, glideSlopeDeg);
    case 'walkNetwork':
      return walkGraph(city, source);
    case 'places':
      return places(city, source);
    default:
      return [];
  }
}
