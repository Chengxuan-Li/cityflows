import {
  distance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  segmentIntersection,
  cumulativeLengths,
  polylineCrossings,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City } from '../schema';
import type { CompiledCity, Diagnostic, LotCirculation } from './types';

const closed = (ring: Vec2[]) => [...ring, ring[0]!];
// A stall's access point joins the nearest aisle point over a clear link up to one stall
// length away (a single row whose aisle runs beside it, not through its access points).
export const STALL_LINK_M = 5;
const mix = (a: Vec2, b: Vec2, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Split at polygon edges, not at a sampling interval (narrow exclusions must still cut). */
function cuts(a: Vec2, b: Vec2, rings: Vec2[][]) {
  const ts = [0, 1],
    length = distance(a, b);
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const hit = segmentIntersection(a, b, ring[i - 1]!, ring[i]!);
      if (hit && length > 0) ts.push(distance(a, hit) / length);
    }
  return [...new Set(ts)].sort((a, b) => a - b);
}

export function compileLotPaths(city: City, compiled: CompiledCity, diagnostics: Diagnostic[]) {
  for (const lot of compiled.lots ?? []) {
    const facility = compiled.parking[compiled.index.parking.get(lot.id)!];
    const source = city.parking![lot.id]!;
    if (source.shape?.kind !== 'polygon') continue;
    const boundary = closed(source.shape.ring),
      exclusions = (source.exclusions ?? []).map(closed);
    const bays = lot.stalls.map((s) => closed(s.corners));
    const obstacles = [...exclusions, ...bays];
    const inside = (p: Vec2) =>
      pointInPolygon(p, boundary) && !obstacles.some((r) => pointInPolygon(p, r));
    // `passage`: an entry link may run under a building exclusion (a courtyard lot reached
    // through a building passage, Munich pk:2037, Sindelfingen pk:1475), never over a bay.
    const clear = (a: Vec2, b: Vec2, entry = false, passage = false) => {
      const ts = cuts(a, b, [boundary, ...obstacles]);
      const blocking = passage ? bays : obstacles;
      let entered = false;
      for (let i = 1; i < ts.length; i++) {
        if (ts[i]! - ts[i - 1]! < 1e-8) continue;
        const p = mix(a, b, (ts[i]! + ts[i - 1]!) / 2);
        if (blocking.some((r) => pointInPolygon(p, r))) return false;
        if (pointInPolygon(p, boundary)) entered = true;
        else if (!entry || entered) return false;
      }
      return (
        entered || distance(a, b) < 1e-6 || (entry && nearestOnPolyline(boundary, b).away < 1e-6)
      );
    };
    const mappedLanes = lot.aisles.flatMap((id) => {
      const road = compiled.roads[compiled.index.road.get(id)!];
      return road && !['no', 'delivery'].includes(road.access[0]!)
        ? road.lanes.map((i) => compiled.lanes[i]!).filter((l) => l.allowed.includes('car'))
        : [];
    });
    const laneIds = new Set(mappedLanes.map((l) => l.idx));
    // Reuse the actual paved aisle paths, including every split section and its joins.
    // Canonical reference lines can lie outside a lot when its lane block is offset.
    const directed = !!source.mappedPortals?.length;
    const paths = [
      ...mappedLanes.map((l) => ({ line: l.polyline, directed })),
      ...compiled.movements
        .filter((m) => !m.neverGreen && laneIds.has(m.fromLane) && laneIds.has(m.toLane))
        .map((m) => ({ line: m.polyline, directed })),
      ...(lot.aislePaths ?? []).map((line) => ({ line, directed: false })),
    ];
    const segments: { a: Vec2; b: Vec2; points: Vec2[]; directed: boolean }[] = [];
    const ends: Vec2[] = [];
    for (const { line: path, directed } of paths) {
      const first = segments.length;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!,
          b = path[i]!;
        if (distance(a, b) < 1e-8) continue;
        const ts = cuts(a, b, [boundary, ...obstacles]);
        for (let j = 1; j < ts.length; j++) {
          if (ts[j]! - ts[j - 1]! < 1e-8 || !inside(mix(a, b, (ts[j]! + ts[j - 1]!) / 2))) continue;
          const p = mix(a, b, ts[j - 1]!),
            q = mix(a, b, ts[j]!);
          segments.push({ a: p, b: q, points: [p, q], directed });
        }
      }
      const pieces = segments.slice(first);
      if (pieces.length) {
        ends.push(pieces[0]!.a, pieces.at(-1)!.b);
        for (let i = 1; i < pieces.length; i++)
          if (distance(pieces[i - 1]!.b, pieces[i]!.a) > 1e-5)
            ends.push(pieces[i - 1]!.b, pieces[i]!.a);
      }
    }
    for (let i = 0; i < segments.length; i++)
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i]!,
          b = segments[j]!;
        if (
          Math.max(a.a.x, a.b.x) + 1e-5 < Math.min(b.a.x, b.b.x) ||
          Math.max(b.a.x, b.b.x) + 1e-5 < Math.min(a.a.x, a.b.x) ||
          Math.max(a.a.y, a.b.y) + 1e-5 < Math.min(b.a.y, b.b.y) ||
          Math.max(b.a.y, b.b.y) + 1e-5 < Math.min(a.a.y, a.b.y)
        )
          continue;
        const hit = segmentIntersection(a.a, a.b, b.a, b.b);
        if (hit) {
          a.points.push(hit);
          b.points.push(hit);
        }
        // Collinear overlaps share endpoints as well.
        for (const p of [a.a, a.b])
          if (nearestOnPolyline([b.a, b.b], p).away < 1e-5) b.points.push(p);
        for (const p of [b.a, b.b])
          if (nearestOnPolyline([a.a, a.b], p).away < 1e-5) a.points.push(p);
      }
    const graph: LotCirculation = {
      nodes: [],
      edges: [],
      adjacency: [],
      stallNodes: [],
      entries: [],
      unreachable: [],
    };
    lot.circulation = graph;
    const indices = new Map<string, number>();
    const node = (p: Vec2) => {
      const key = `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)}`;
      let idx = indices.get(key);
      if (idx === undefined) {
        idx = graph.nodes.length;
        indices.set(key, idx);
        graph.nodes.push(p);
        graph.adjacency.push([]);
      }
      return idx;
    };
    const link = (from: number, to: number, directed = false) => {
      if (
        from === to ||
        graph.adjacency[from]!.some((i) => {
          const e = graph.edges[i]!;
          return (
            (e.from === from && e.to === to) || (!e.directed && e.from === to && e.to === from)
          );
        })
      )
        return;
      const idx = graph.edges.length;
      graph.edges.push({
        from,
        to,
        lengthM: distance(graph.nodes[from]!, graph.nodes[to]!),
        ...(directed && { directed }),
      });
      graph.adjacency[from]!.push(idx);
      if (!directed) graph.adjacency[to]!.push(idx);
    };
    const attach = (p: Vec2, entry: boolean) => {
      const choices = segments
        .map((s) => ({ s, hit: nearestOnPolyline([s.a, s.b], p) }))
        .sort((a, b) => a.hit.away - b.hit.away);
      // Entries prefer a clear link; only when none exists may the link take a passage.
      for (const passage of entry ? [false, true] : [false])
        for (const { s, hit } of choices) {
          const target = mix(s.a, s.b, hit.along / distance(s.a, s.b));
          if (
            distance(p, target) > (entry ? Infinity : STALL_LINK_M) ||
            !clear(p, target, entry, passage)
          )
            continue;
          s.points.push(target);
          const from = node(p),
            to = node(target);
          link(from, to);
          return from;
        }
      return -1;
    };
    for (const stall of lot.stalls) {
      if (mappedLanes.length && !lot.aislePaths?.length) {
        const candidate = mappedLanes
          .map((lane) => ({ lane, hit: nearestOnPolyline(lane.polyline, stall.position) }))
          .sort((a, b) => a.hit.away - b.hit.away || a.lane.idx - b.lane.idx)[0]!;
        stall.access = pointAtDistance(
          candidate.lane.polyline,
          candidate.lane.cumulative,
          candidate.hit.along,
        );
      }
      const access = stall.access ?? stall.position;
      const at = attach(access, false);
      graph.stallNodes.push(at);
      const group = city.roads[stall.aisleRoad]?.streetGroupId;
      if (directed && at !== -1 && group && !lot.aislePaths?.length) {
        // A bay on a two-way aisle can be entered or left from either travel
        // direction. This short manoeuvre is not a reverse edge on a one-way lane.
        for (const lane of mappedLanes.filter(
          (l) => city.roads[compiled.roads[l.road]!.id]!.streetGroupId === group,
        )) {
          const hit = nearestOnPolyline(lane.polyline, access);
          if (hit.away > STALL_LINK_M || !clear(access, hit.point)) continue;
          const other = attach(hit.point, false);
          if (other !== -1) link(at, other);
        }
      }
    }
    for (const idx of [
      ...new Set([...(facility?.connectorsIn ?? []), ...(facility?.connectorsOut ?? [])]),
    ]) {
      const c = compiled.connectors[idx]!,
        lane = compiled.lanes[c.lane]!;
      const p = pointAtDistance(lane.polyline, lane.cumulative, c.positionM);
      const portals = source.mappedPortals?.filter((portal) => portal.connectorId === c.id);
      if (portals?.length) {
        for (const portal of portals) {
          const road = compiled.roads[compiled.index.road.get(portal.aisleRoadId)!];
          if (!road) continue; // Invalid external records are reported by compileParking.
          const mouth = road.lanes
            .map((i) => compiled.lanes[i]!)
            .filter((l) => l.allowed.includes('car'))[0];
          if (!mouth) continue;
          const path = portal.direction === 'in' ? mouth.polyline : mouth.polyline.toReversed();
          const prefix = [p];
          const lengths = cumulativeLengths(path);
          const cuts = [
            0,
            ...polylineCrossings(path, boundary).map((hit) => hit.alongA),
            lengths.at(-1)!,
          ].sort((a, b) => a - b);
          let end = lengths.at(-1)!;
          for (let i = 1; i < cuts.length; i++)
            if (
              cuts[i]! - cuts[i - 1]! > 1e-6 &&
              pointInPolygon(
                pointAtDistance(path, lengths, (cuts[i]! + cuts[i - 1]!) / 2),
                boundary,
                0,
              )
            ) {
              end = Math.min(cuts[i]!, cuts[i - 1]! + 0.25);
              break;
            }
          prefix.push(
            ...path.filter((_, i) => lengths[i]! < end),
            pointAtDistance(path, lengths, end),
          );
          const target = attach(prefix.at(-1)!, true);
          if (target === -1) continue;
          // Keep the source throat directional and private to this entry. Sharing its
          // graph edges would let an inbound path borrow an adjacent outbound stub.
          const approach = prefix.slice(0, -1).map((point) => {
            const at = graph.nodes.length;
            graph.nodes.push(point);
            graph.adjacency.push([]);
            return at;
          });
          approach.push(target);
          graph.entries.push({
            connector: idx,
            direction: portal.direction,
            approach,
            node: target,
            distances: new Float64Array(),
            previous: new Int32Array(),
          });
        }
        continue;
      }
      const start = attach(p, true);
      if (start !== -1)
        for (const direction of directed ? (['in', 'out'] as const) : [undefined]) {
          if (
            (direction === 'in' && c.direction === 'out') ||
            (direction === 'out' && c.direction === 'in')
          )
            continue;
          graph.entries.push({
            connector: idx,
            ...(direction && { direction }),
            node: start,
            distances: new Float64Array(),
            previous: new Int32Array(),
          });
        }
    }
    for (const s of segments) {
      s.points.sort((a, b) => distance(s.a, a) - distance(s.a, b));
      for (let i = 1; i < s.points.length; i++)
        link(node(s.points[i - 1]!), node(s.points[i]!), s.directed);
    }
    // A mapped lot may exclude its access spine. Join clear aisle ends on the lot's
    // own pavement, using the shortest visible bridges between disconnected pieces.
    const endNodes = [...new Set(ends.map(node))],
      parent = Int32Array.from(graph.nodes, (_, i) => i);
    const root = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const join = (a: number, b: number) => {
      parent[root(a)] = root(b);
    };
    for (const e of graph.edges) join(e.from, e.to);
    const bridges: { a: number; b: number; lengthM: number }[] = [];
    for (let i = 0; i < endNodes.length; i++)
      for (let j = i + 1; j < endNodes.length; j++) {
        const a = endNodes[i]!,
          b = endNodes[j]!;
        if (root(a) !== root(b) && clear(graph.nodes[a]!, graph.nodes[b]!))
          bridges.push({ a, b, lengthM: distance(graph.nodes[a]!, graph.nodes[b]!) });
      }
    bridges.sort((a, b) => a.lengthM - b.lengthM || a.a - b.a || a.b - b.b);
    for (const bridge of bridges) {
      if (root(bridge.a) === root(bridge.b)) continue;
      const a = graph.nodes[bridge.a]!,
        b = graph.nodes[bridge.b]!;
      const crosses = graph.edges.some((e) => {
        const c = graph.nodes[e.from]!,
          d = graph.nodes[e.to]!,
          hit = segmentIntersection(a, b, c, d);
        const interior = (p: Vec2) => distance(a, p) > 1e-5 && distance(b, p) > 1e-5;
        return (
          (hit && interior(hit)) ||
          [c, d].some((p) => interior(p) && nearestOnPolyline([a, b], p).away < 1e-5)
        );
      });
      if (crosses) continue;
      link(bridge.a, bridge.b);
      join(bridge.a, bridge.b);
    }
    const reverse = graph.nodes.map((): number[] => []);
    for (const [i, edge] of graph.edges.entries()) {
      reverse[edge.to]!.push(i);
      if (!edge.directed) reverse[edge.from]!.push(i);
    }
    // Outbound distances run backward through the directed source graph. Generated
    // circulation and bay links remain bidirectional; legacy lots keep their paths.
    for (const entry of graph.entries) {
      entry.distances = new Float64Array(graph.nodes.length).fill(Infinity);
      entry.previous = new Int32Array(graph.nodes.length).fill(-1);
      entry.distances[entry.node] = (entry.approach ?? [])
        .slice(1)
        .reduce(
          (sum, at, i) => sum + distance(graph.nodes[entry.approach![i]!]!, graph.nodes[at]!),
          0,
        );
      const visited = new Uint8Array(graph.nodes.length);
      for (;;) {
        let current = -1,
          best = Infinity;
        for (let i = 0; i < visited.length; i++)
          if (!visited[i] && entry.distances[i]! < best) {
            current = i;
            best = entry.distances[i]!;
          }
        if (current === -1) break;
        visited[current] = 1;
        for (const idx of (entry.direction === 'out' ? reverse : graph.adjacency)[current]!) {
          const e = graph.edges[idx]!,
            next = e.from === current ? e.to : e.from,
            cost = best + e.lengthM;
          if (cost < entry.distances[next]!) {
            entry.distances[next] = cost;
            entry.previous[next] = current;
          }
        }
      }
    }
    graph.unreachable = graph.stallNodes.flatMap((n, i) =>
      n === -1 ||
      !graph.entries.some(
        (e) =>
          e.direction !== 'out' &&
          facility?.connectorsIn.includes(e.connector) &&
          Number.isFinite(e.distances[n]),
      ) ||
      !graph.entries.some(
        (e) =>
          e.direction !== 'in' &&
          facility?.connectorsOut.includes(e.connector) &&
          Number.isFinite(e.distances[n]),
      )
        ? [i]
        : [],
    );
    if (facility)
      facility.capacity = (facility.spaces ?? []).filter(
        (i) => !graph.unreachable.includes(compiled.parkingSpaces![i]!.lotStall!),
      ).length;
    if (graph.unreachable.length)
      diagnostics.push({
        severity: 'warning',
        code: 'lot_stalls_unreachable',
        refs: [lot.id],
        message: `Lot ${lot.id}: ${graph.unreachable.length} of ${lot.stallCount} stalls lack an entry or exit path`,
      });
  }
}

export function lotPath(
  graph: LotCirculation,
  connector: number,
  stall: number,
  direction: 'in' | 'out' = 'in',
): number[] | null {
  const entry = graph.entries.find(
      (e) => e.connector === connector && (!e.direction || e.direction === direction),
    ),
    target = graph.stallNodes[stall];
  if (!entry || target === undefined || target === -1 || !Number.isFinite(entry.distances[target]))
    return null;
  const path = [target];
  while (path.at(-1)! !== entry.node) path.push(entry.previous[path.at(-1)!]!);
  return [...(entry.approach?.slice(0, -1) ?? []), ...path.reverse()];
}
