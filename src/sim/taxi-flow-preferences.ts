import { MinHeap } from '../geo/heap';
import type { AirsideGraph } from '../network/airside';
import { arcEdge, arcEnd, arcForward, arcStart, arcsFrom } from '../routing/airside';

const wrongWayCost = 3;
const cache = new WeakMap<AirsideGraph, Map<string, Int8Array>>();

/** Soft directional bias on taxi edges for the currently open runway ends. */
export function taxiFlowPreferences(
  graph: AirsideGraph,
  configuration: { arrivalEnds: string[]; departureEnds: string[] },
): { preferred: Int8Array; wrongWayCost: number } {
  const arrivalEnds = new Set(configuration.arrivalEnds);
  const departureEnds = new Set(configuration.departureEnds);
  const key = JSON.stringify([[...arrivalEnds].sort(), [...departureEnds].sort()]);
  let configurations = cache.get(graph);
  if (!configurations) cache.set(graph, (configurations = new Map()));
  let preferred = configurations.get(key);
  if (!preferred) {
    preferred = orient(graph, arrivalEnds, departureEnds);
    configurations.set(key, preferred);
  }
  return { preferred: preferred.slice(), wrongWayCost };
}

function orient(graph: AirsideGraph, arrivalEnds: Set<string>, departureEnds: Set<string>) {
  const outgoing = graph.nodes.map(({ idx }) =>
    arcsFrom(graph, idx).filter((arc) => {
      const { kind, from, to, maxCode } = graph.edges[arcEdge(arc)]!;
      return (kind === 'taxiway' || kind === 'taxilane') && from !== to && maxCode >= 0;
    }),
  );
  const incoming: number[][] = graph.nodes.map(() => []);
  for (const arcs of outgoing) for (const arc of arcs) incoming[arcEnd(graph, arc)]!.push(arc);

  const exits = new Set<number>();
  const lineUps = new Set<number>();
  for (const runway of graph.runways) {
    if (runway.maxCode < 0) continue;
    for (const [i, end] of runway.ends.entries()) {
      const direction = i === 0 ? 1 : -1;
      if (arrivalEnds.has(end.designator)) {
        const access = runway.nodes
          .map((node, j) => ({ node, rollM: direction * (runway.stationsM[j]! - end.thresholdM) }))
          .filter(({ node, rollM }) => outgoing[node]!.length > 0 && rollM >= 0);
        // TASK-321's representative roll-out window. On a short runway use the far exits.
        const inWindow = access.filter(({ rollM }) => rollM >= 1400 && rollM <= 2800);
        const candidates = inWindow.length
          ? inWindow
          : access.sort((a, b) => Math.abs(a.rollM - 2000) - Math.abs(b.rollM - 2000)).slice(0, 2);
        for (const { node } of candidates) exits.add(node);
      }
      if (departureEnds.has(end.designator)) {
        const nodes = i === 0 ? runway.nodes : runway.nodes.toReversed();
        const entry = nodes.find((node) => incoming[node]!.length > 0);
        if (entry !== undefined) lineUps.add(entry);
      }
    }
  }

  const count = graph.edges.length * 2;
  const flow = new Int32Array(count);
  const lengths = Float64Array.from(
    { length: count },
    (_, arc) => graph.edges[arcEdge(arc)]!.lengthM,
  );
  const best = new Float64Array(graph.nodes.length);
  const via = new Int32Array(graph.nodes.length);
  const heap = new MinHeap();
  const roots = graph.stands.filter(({ maxCode }) => maxCode >= 0).map(({ root }) => root);

  // Multi-source Dijkstra tries every candidate exit in one search. For departures it walks
  // incoming arcs from the line-ups so both directions use the same search.
  function search(arrival: boolean, weight: (arc: number) => number, goal?: number) {
    const seeds = arrival ? exits : lineUps;
    const adjacent = arrival ? outgoing : incoming;
    const next = arrival ? arcEnd : arcStart;
    best.fill(Infinity);
    via.fill(-1);
    heap.clear();
    for (const node of seeds) {
      best[node] = 0;
      heap.push(node, 0);
    }
    for (let node = heap.pop(); node !== undefined; node = heap.pop()) {
      const cost = heap.cost;
      if (cost > best[node]!) continue;
      if (node === goal) break;
      for (const arc of adjacent[node]!) {
        const to = next(graph, arc);
        const reached = cost + lengths[arc]! * weight(arc);
        if (reached >= best[to]!) continue;
        best[to] = reached;
        via[to] = arc;
        heap.push(to, reached);
      }
    }
  }

  function route(root: number, arrival: boolean) {
    const previous = arrival ? arcStart : arcEnd;
    const arcs: number[] = [];
    for (let node = root; via[node]! >= 0;) {
      const arc = via[node]!;
      arcs.push(arc);
      node = previous(graph, arc);
    }
    return arcs;
  }

  // Policy C: reassign each stand's arrival and departure in turn, pricing against the
  // flows already assigned to the opposite direction. Remove the old route before voting again.
  const routes = roots.flatMap((root) => [
    { root, arrival: true, arcs: [] as number[] },
    { root, arrival: false, arcs: [] as number[] },
  ]);
  const flowWeight = (arc: number) => {
    const against = flow[arc ^ 1]!;
    return 1 + ((wrongWayCost - 1) * against) / (against + flow[arc]! + 1);
  };
  for (let pass = 0; pass < 4; pass++) {
    for (const trip of routes) {
      for (const arc of trip.arcs) flow[arc]! -= 1;
      search(trip.arrival, flowWeight, trip.root);
      trip.arcs = route(trip.root, trip.arrival);
      for (const arc of trip.arcs) flow[arc]! += 1;
    }
  }

  const preferred = new Int8Array(graph.edges.length);
  for (const { idx } of graph.edges)
    preferred[idx] = Math.sign(flow[idx * 2]! - flow[idx * 2 + 1]!);

  // An edge used against its vote on a shortest soft-cost route has no clear direction.
  // Clear such votes and check again because the routes can change.
  const againstPreference = (arc: number) => preferred[arcEdge(arc)] === (arcForward(arc) ? -1 : 1);
  const preferredWeight = (arc: number) => (againstPreference(arc) ? wrongWayCost : 1);
  for (;;) {
    const mixed = new Set<number>();
    for (const arrival of [true, false]) {
      search(arrival, preferredWeight);
      for (const root of roots)
        for (const arc of route(root, arrival)) if (againstPreference(arc)) mixed.add(arcEdge(arc));
    }
    if (mixed.size === 0) return preferred;
    for (const edge of mixed) preferred[edge] = 0;
  }
}
