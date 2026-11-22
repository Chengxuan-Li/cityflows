import { pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { AirsideGraph } from '../network/airside';
import { MinHeap } from './heap';

// TASK-298: aircraft routes on the airside graph. An arc is an edge in one direction: `2 * edge`
// along its line, `2 * edge + 1` against it. A route is a sequence of arcs, each turn between
// them within the aircraft's turning radius, every edge admitting its code.

export const arcEdge = (arc: number) => arc >> 1;
export const arcForward = (arc: number) => (arc & 1) === 0;
export const reverseArc = (arc: number) => arc ^ 1;
export const arcOf = (edge: number, forward: boolean) => 2 * edge + (forward ? 0 : 1);

export function arcStart(graph: AirsideGraph, arc: number) {
  const edge = graph.edges[arcEdge(arc)]!;
  return arcForward(arc) ? edge.from : edge.to;
}
export function arcEnd(graph: AirsideGraph, arc: number) {
  const edge = graph.edges[arcEdge(arc)]!;
  return arcForward(arc) ? edge.to : edge.from;
}
export function arcLine(graph: AirsideGraph, arc: number): Vec2[] {
  const line = graph.edges[arcEdge(arc)]!.line;
  return arcForward(arc) ? line : line.toReversed();
}

/** Arcs leaving `node`; a oneway edge only along its line. */
export function arcsFrom(graph: AirsideGraph, node: number) {
  const arcs: number[] = [];
  for (const e of graph.nodes[node]!.edges) {
    const edge = graph.edges[e]!;
    if (edge.from === node) arcs.push(arcOf(e, true));
    if (edge.to === node && !edge.oneway) arcs.push(arcOf(e, false));
  }
  return arcs;
}

/** Direction of travel over the first (or last) `windowM` of an arc. */
function arcDirection(graph: AirsideGraph, arc: number, atEnd: boolean, windowM: number) {
  const { line, cumulative, lengthM } = graph.edges[arcEdge(arc)]!;
  const window = Math.min(windowM, lengthM);
  const at = (travelM: number) =>
    pointAtDistance(line, cumulative, arcForward(arc) ? travelM : lengthM - travelM);
  const a = at(atEnd ? lengthM - window : 0);
  const b = at(atEnd ? lengthM : window);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export const arcStartHeading = (graph: AirsideGraph, arc: number, windowM = 10) =>
  arcDirection(graph, arc, false, windowM);
export const arcEndHeading = (graph: AirsideGraph, arc: number, windowM = 10) =>
  arcDirection(graph, arc, true, windowM);

export const deflection = (from: number, to: number) =>
  Math.abs(Math.atan2(Math.sin(to - from), Math.cos(to - from)));

/** A turn from arc `a` into arc `b` at their node: its deflection, measured over a turning
 * radius on each side, needs a tangent `R tan(θ/2)` no longer than the shorter of the two edges
 * or 1.5 R, whichever is more; a deflection of 165 degrees or more is never taken. */
export function turnAllowed(graph: AirsideGraph, a: number, b: number, radiusM: number) {
  if (b === reverseArc(a)) return false;
  const theta = deflection(arcEndHeading(graph, a, radiusM), arcStartHeading(graph, b, radiusM));
  if (theta >= (165 * Math.PI) / 180) return false;
  const available = Math.max(
    Math.min(graph.edges[arcEdge(a)]!.lengthM, graph.edges[arcEdge(b)]!.lengthM),
    1.5 * radiusM,
  );
  return radiusM * Math.tan(theta / 2) <= available;
}

export interface AirsideRouteQuery {
  /** The aircraft's code, an index into `aircraftCodes`. */
  code: number;
  turnRadiusM: number;
  /** The arc the aircraft is on (the route continues from its end), or a node to leave. */
  from: { arc: number } | { node: number };
  /** The route ends with the first arc for which this holds. */
  goal: (arc: number) => boolean;
  /** The stand whose lead-in the route may enter; others' lead-ins are closed. */
  stand?: number;
  /** From `from.arc` on a runway, the first arc must leave the runway (a landing's exit). */
  exitRunway?: boolean;
  /** Extra cost factor of an arc (1 by default; runway arcs cost four times their length). */
  factor?: (arc: number) => number;
}

/** Least-cost route by length times each arc's factor; null when the goal cannot be reached. */
export function routeAirside(graph: AirsideGraph, query: AirsideRouteQuery) {
  const count = graph.edges.length * 2;
  const cost = new Float64Array(count).fill(Infinity);
  const previous = new Int32Array(count).fill(-1);
  const heap = new MinHeap();
  const admits = (arc: number) => {
    const edge = graph.edges[arcEdge(arc)]!;
    if (edge.maxCode < query.code) return false;
    if (edge.kind === 'lead_in' && edge.stand !== query.stand) return false;
    return !edge.oneway || arcForward(arc);
  };
  const weight = (arc: number) => {
    const edge = graph.edges[arcEdge(arc)]!;
    return edge.lengthM * (edge.kind === 'runway' ? 4 : 1) * (query.factor?.(arc) ?? 1);
  };
  const relax = (arc: number, from: number, base: number) => {
    const next = base + weight(arc);
    if (next < cost[arc]!) {
      cost[arc] = next;
      previous[arc] = from;
      heap.push(arc, next);
    }
  };
  const start = 'arc' in query.from ? query.from.arc : -1;
  if ('arc' in query.from) {
    const runway = graph.edges[arcEdge(start)]!.kind === 'runway';
    for (const b of arcsFrom(graph, arcEnd(graph, start)))
      if (
        admits(b) &&
        turnAllowed(graph, start, b, query.turnRadiusM) &&
        !(query.exitRunway && runway && graph.edges[arcEdge(b)]!.kind === 'runway')
      )
        relax(b, -1, 0);
  } else for (const b of arcsFrom(graph, query.from.node)) if (admits(b)) relax(b, -1, 0);
  for (let arc = heap.pop(); arc !== undefined; arc = heap.pop()) {
    const reached = heap.cost;
    if (reached > cost[arc]!) continue;
    if (query.goal(arc)) {
      const route = [arc];
      while (previous[route[0]!]! !== -1) route.unshift(previous[route[0]!]!);
      return { arcs: route, cost: reached };
    }
    for (const b of arcsFrom(graph, arcEnd(graph, arc)))
      if (admits(b) && turnAllowed(graph, arc, b, query.turnRadiusM)) relax(b, arc, reached);
  }
  return null;
}
