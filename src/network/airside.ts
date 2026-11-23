import { boxOf, cumulativeLengths, nearestOnPolyline, pointInPolygon } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { aircraftCodes, codeSpanLimitM, type AircraftCode } from '../schema/aircraft';
import type { AirsideEdgeKind, Airport, RunwayOperations, StandKind } from '../schema/airport';
import type { City } from '../schema';
import type { CompiledCity } from './types';

// TASK-298: the airside graph in dense indices, for routing and moving aircraft. Edges are
// undirected; an arc is an edge in one direction, `2 * edge` along its line and `2 * edge + 1`
// against it. Codes are indices into `aircraftCodes` (-1: admits none).

export interface AirsideNodeC {
  idx: number;
  id: string;
  pos: Vec2;
  /** Incident edges, ascending. */
  edges: number[];
  /** The runways whose edges meet here. */
  runways: number[];
}

export interface AirsideEdgeC {
  idx: number;
  id: string;
  from: number;
  to: number;
  line: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
  kind: AirsideEdgeKind;
  widthM: number;
  maxCode: number;
  ref?: string;
  oneway: boolean;
  runway: number;
  stand: number;
}

export interface AirsideRunwayEndC {
  designator: string;
  node: number;
  threshold: number;
  /** Stations from `ends[0]` along the runway. */
  stationM: number;
  thresholdM: number;
  heading: number;
}

export interface AirsideRunwayC {
  idx: number;
  id: string;
  ref: string;
  ends: [AirsideRunwayEndC, AirsideRunwayEndC];
  /** Edges in order from `ends[0]`, and the nodes between them with their stations. */
  edges: number[];
  nodes: number[];
  stationsM: number[];
  /** The centreline from `ends[0]` to `ends[1]`. */
  line: Vec2[];
  lengthM: number;
  widthM: number;
  maxCode: number;
}

export interface AirsideHoldC {
  idx: number;
  id: string;
  ref?: string;
  node: number;
  runway: number;
  /** The edge at the hold leading to the protected runway, or -1. */
  toward: number;
}

export interface AirsideStandC {
  idx: number;
  id: string;
  ref?: string;
  kind: StandKind;
  pos: Vec2;
  heading: number;
  /** Lead-in edges from the taxi network to the stop; `root` and `stop` are their end nodes. */
  leadIn: number[];
  root: number;
  stop: number;
  maxCode: number;
  /** TASK-320: where apron service roads cross the stand's line, as merged [from, to] distances
   * back from the stop along it (negative: ahead of it), and the paved room ahead of the stop
   * (to the edge of the airside surfaces or a terminal or hangar wall, at most 30 m). */
  roadBandsM: [number, number][];
  aheadM: number;
}

export interface AirsideCrossingC {
  idx: number;
  edge: number;
  pos: Vec2;
  /** Station of the crossing along its edge's line. */
  stationM: number;
  /** Where road traffic stops short of it: lanes and the stop's position on each. */
  stops: { lane: number; positionM: number }[];
}

export interface AirsideGraph {
  name: string | null;
  icao?: string;
  nodes: AirsideNodeC[];
  edges: AirsideEdgeC[];
  runways: AirsideRunwayC[];
  holds: AirsideHoldC[];
  stands: AirsideStandC[];
  helipads: { id: string; ref?: string; pos: Vec2 }[];
  /** Each hangar's centroid and the graph node nearest it that a taxi edge reaches. */
  hangars: { pos: Vec2; node: number }[];
  crossings: AirsideCrossingC[];
  /** The aircraft size the largest stand admits: its span limit. */
  maxSpanM: number;
  /** TASK-305: the airport's own runway configuration table, where it has one. */
  runwayOperations?: RunwayOperations;
  index: { node: Map<string, number>; edge: Map<string, number>; stand: Map<string, number> };
}

const codeIndex = (code: AircraftCode | null) => (code ? aircraftCodes.indexOf(code) : -1);

/** Road traffic stops this far short of an airside edge's centreline: the larger of half the
 * edge's width and half the span its code admits, plus 7.5 m. */
export function crossingClearanceM(edge: AirsideEdgeC) {
  const code = aircraftCodes[edge.maxCode];
  return Math.max(edge.widthM / 2, code ? codeSpanLimitM[code] / 2 : 0) + 7.5;
}

function ringCentroid(ring: readonly Vec2[]) {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

export function compileAirside(
  airport: Airport,
  city: Pick<City, 'roads'>,
  compiled: Pick<CompiledCity, 'lanes' | 'roads' | 'movements' | 'index'>,
): AirsideGraph {
  const sorted = <T>(record: Record<string, T>) =>
    Object.keys(record)
      .sort()
      .map((id) => record[id]!);
  const nodes: AirsideNodeC[] = sorted(airport.nodes).map((node, idx) => ({
    idx,
    id: node.id,
    pos: node.pos,
    edges: [],
    runways: [],
  }));
  const nodeIndex = new Map(nodes.map((n) => [n.id, n.idx]));
  const runwayIds = Object.keys(airport.runways).sort();
  const standIds = Object.keys(airport.stands).sort();
  const runwayIndex = new Map(runwayIds.map((id, i) => [id, i]));
  const standIndex = new Map(standIds.map((id, i) => [id, i]));
  const edges: AirsideEdgeC[] = sorted(airport.edges).map((edge, idx) => {
    const cumulative = cumulativeLengths(edge.line);
    return {
      idx,
      id: edge.id,
      from: nodeIndex.get(edge.from)!,
      to: nodeIndex.get(edge.to)!,
      line: edge.line,
      cumulative,
      lengthM: cumulative.at(-1)!,
      kind: edge.kind,
      widthM: edge.widthM,
      maxCode: codeIndex(edge.maxCode),
      ref: edge.ref,
      oneway: !!edge.oneway,
      runway: edge.runway ? runwayIndex.get(edge.runway)! : -1,
      stand: edge.stand ? standIndex.get(edge.stand)! : -1,
    };
  });
  const edgeIndex = new Map(edges.map((e) => [e.id, e.idx]));
  for (const edge of edges) {
    nodes[edge.from]!.edges.push(edge.idx);
    if (edge.to !== edge.from) nodes[edge.to]!.edges.push(edge.idx);
    if (edge.runway >= 0)
      for (const node of [nodes[edge.from]!, nodes[edge.to]!])
        if (!node.runways.includes(edge.runway)) node.runways.push(edge.runway);
  }
  const runways: AirsideRunwayC[] = runwayIds.map((id, idx) => {
    const runway = airport.runways[id]!;
    const order = runway.edges.map((e) => edgeIndex.get(e)!);
    const runwayNodes = [nodeIndex.get(runway.ends[0].node)!];
    const stationsM = [0];
    const line: Vec2[] = [];
    for (const e of order) {
      const edge = edges[e]!;
      const at = runwayNodes.at(-1)!;
      const forward = edge.from === at;
      const points = forward ? edge.line : edge.line.toReversed();
      line.push(...(line.length ? points.slice(1) : points));
      runwayNodes.push(forward ? edge.to : edge.from);
      stationsM.push(stationsM.at(-1)! + edge.lengthM);
    }
    const station = (node: string) => stationsM[runwayNodes.indexOf(nodeIndex.get(node)!)]!;
    const ends = runway.ends.map((end) => ({
      designator: end.designator,
      node: nodeIndex.get(end.node)!,
      threshold: nodeIndex.get(end.threshold.node)!,
      stationM: station(end.node),
      thresholdM: station(end.threshold.node),
      heading: end.heading,
    })) as [AirsideRunwayEndC, AirsideRunwayEndC];
    return {
      idx,
      id,
      ref: runway.ref,
      ends,
      edges: order,
      nodes: runwayNodes,
      stationsM,
      line,
      lengthM: stationsM.at(-1)!,
      widthM: runway.widthM,
      maxCode: codeIndex(runway.maxCode),
    };
  });
  const holds: AirsideHoldC[] = sorted(airport.holdingPositions).map((hold, idx) => ({
    idx,
    id: hold.id,
    ref: hold.ref,
    node: nodeIndex.get(hold.node)!,
    runway: hold.runway ? runwayIndex.get(hold.runway)! : -1,
    toward: hold.toward ? edgeIndex.get(hold.toward)! : -1,
  }));
  // TASK-320: apron service roads (TASK-316's reading: `service` roads closed to cars) and the
  // paved airside surfaces with the walls on them, for where a parked aircraft may stand.
  const serviceLanes = compiled.roads
    .filter((road) => road.roadClass === 'service' && ['no', 'private'].includes(road.access[0]!))
    .flatMap((road) => road.lanes.map((lane) => compiled.lanes[lane]!));
  const rings = (list: { rings: Vec2[][] }[]) =>
    list.map(({ rings }) => ({ rings, box: boxOf(rings[0]!) }));
  const paved = rings(airport.surfaces.filter((s) => s.kind !== 'runway' && s.kind !== 'helipad'));
  const walls = rings([...Object.values(airport.terminals), ...airport.hangars]);
  const inside = (p: Vec2, area: { rings: Vec2[][]; box: ReturnType<typeof boxOf> }) =>
    p.x >= area.box.minX &&
    p.x <= area.box.maxX &&
    p.y >= area.box.minY &&
    p.y <= area.box.maxY &&
    pointInPolygon(p, area.rings[0]!) &&
    !area.rings.slice(1).some((hole) => pointInPolygon(p, hole));
  const STAND_LINE_BACK_M = 100,
    STAND_LINE_AHEAD_M = 30;
  function roadBands(pos: Vec2, heading: number): [number, number][] {
    const ux = Math.cos(heading),
      uy = Math.sin(heading);
    const bands: [number, number][] = [];
    for (const lane of serviceLanes) {
      const line = lane.polyline;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1]!,
          b = line[i]!;
        const ex = b.x - a.x,
          ey = b.y - a.y;
        const den = ux * ey - uy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const wx = a.x - pos.x,
          wy = a.y - pos.y;
        // pos - d u = a + k (b - a): d back from the stop, k along the lane's segment.
        const d = (ex * wy - ey * wx) / den;
        const k = (uy * wx - ux * wy) / den;
        if (k < 0 || k > 1 || d < -STAND_LINE_AHEAD_M || d > STAND_LINE_BACK_M) continue;
        // The lane's width along the stand line, a shallow crossing counted at most three widths.
        const sin = Math.abs(den) / Math.hypot(ex, ey);
        const half = Math.min(lane.widthM / 2 / sin, 1.5 * lane.widthM);
        bands.push([d - half, d + half]);
      }
    }
    bands.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const band of bands)
      if (merged.length && band[0] <= merged.at(-1)![1])
        merged.at(-1)![1] = Math.max(merged.at(-1)![1], band[1]);
      else merged.push([...band]);
    return merged;
  }
  function roomAhead(pos: Vec2, heading: number) {
    const ux = Math.cos(heading),
      uy = Math.sin(heading);
    let m = 0;
    for (; m <= STAND_LINE_AHEAD_M; m += 0.5) {
      const p = { x: pos.x + m * ux, y: pos.y + m * uy };
      if (!paved.some((area) => inside(p, area)) || walls.some((area) => inside(p, area))) break;
    }
    return Math.max(0, Math.min(STAND_LINE_AHEAD_M, m - 0.5));
  }
  const stands: AirsideStandC[] = standIds.map((id, idx) => {
    const stand = airport.stands[id]!;
    const leadIn = stand.leadIn.map((e) => edgeIndex.get(e)!);
    const first = edges[leadIn[0]!]!;
    const last = edges[leadIn.at(-1)!]!;
    const near = (node: number) =>
      Math.hypot(nodes[node]!.pos.x - stand.pos.x, nodes[node]!.pos.y - stand.pos.y);
    const stop = near(last.from) < near(last.to) ? last.from : last.to;
    // The root is the first edge's end away from the second edge (or from the stop).
    const next = leadIn.length > 1 ? edges[leadIn[1]!]! : null;
    const root = next
      ? first.from === next.from || first.from === next.to
        ? first.to
        : first.from
      : first.from === stop
        ? first.to
        : first.from;
    return {
      idx,
      id,
      ref: stand.ref,
      kind: stand.kind,
      pos: stand.pos,
      heading: stand.heading,
      leadIn,
      root,
      stop,
      maxCode: codeIndex(stand.maxCode),
      roadBandsM: roadBands(stand.pos, stand.heading),
      aheadM: roomAhead(stand.pos, stand.heading),
    };
  });
  const taxiNodes = nodes.filter((n) =>
    n.edges.some((e) => edges[e]!.kind !== 'runway' && edges[e]!.maxCode >= 0),
  );
  const hangars = airport.hangars.map((hangar) => {
    const pos = ringCentroid(hangar.rings[0]!);
    let best = -1,
      bestM = Infinity;
    for (const n of taxiNodes) {
      const d = Math.hypot(n.pos.x - pos.x, n.pos.y - pos.y);
      if (d < bestM) [best, bestM] = [n.idx, d];
    }
    return { pos, node: best };
  });
  const crossings = airport.roadCrossings.map((crossing, idx) => {
    const edge = edges[edgeIndex.get(crossing.edge)!]!;
    const clearanceM = crossingClearanceM(edge);
    const stops: AirsideCrossingC['stops'] = [];
    for (const roadId of crossing.roads) {
      const road = compiled.index.road.get(roadId);
      if (road === undefined || !city.roads[roadId]) continue;
      for (const lane of compiled.roads[road]!.lanes) {
        const near = nearestOnPolyline(compiled.lanes[lane]!.polyline, crossing.pos);
        // A crossing inside a junction, off this lane's drawn line, holds no traffic here.
        if (near.away > compiled.lanes[lane]!.widthM) continue;
        const positionM = near.along - clearanceM;
        if (positionM >= 0) stops.push({ lane, positionM });
        // A stop before the lane's start falls on the lanes leading in.
        else
          for (const m of compiled.lanes[lane]!.in) {
            const movement = compiled.movements[m]!;
            const at = compiled.lanes[movement.fromLane]!.lengthM + movement.lengthM + positionM;
            if (at >= 0) stops.push({ lane: movement.fromLane, positionM: at });
          }
      }
    }
    return {
      idx,
      edge: edge.idx,
      pos: crossing.pos,
      stationM: nearestOnPolyline(edge.line, crossing.pos).along,
      stops,
    };
  });
  let maxSpanM = 0;
  for (const stand of stands)
    if (stand.maxCode >= 0)
      maxSpanM = Math.max(maxSpanM, codeSpanLimitM[aircraftCodes[stand.maxCode]!]);
  return {
    name: airport.name,
    icao: airport.icao,
    nodes,
    edges,
    runways,
    holds,
    stands,
    helipads: sorted(airport.helipads).map((h) => ({ id: h.id, ref: h.ref, pos: h.pos })),
    hangars,
    crossings,
    maxSpanM,
    ...(airport.runwayOperations ? { runwayOperations: airport.runwayOperations } : {}),
    index: { node: nodeIndex, edge: edgeIndex, stand: standIndex },
  };
}
