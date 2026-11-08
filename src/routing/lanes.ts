import type { CConnector, CompiledCity } from '../network';
import type { RoadGraph } from './graph';
import type { RouteRequest } from './index';

export function* reachableLanes(
  compiled: CompiledCity,
  allowed: boolean[],
  from: number,
  endM: number,
  changeDistanceM: number,
  startM = 0,
) {
  if (!allowed[from] || startM > endM) return;
  yield { lane: from, changes: 0 };
  for (const side of ['left', 'right'] as const) {
    let lane = from;
    for (let changes = 1; ; changes++) {
      const positionM = startM + changes * changeDistanceM;
      const current = compiled.lanes[lane]!;
      const next = current[side];
      if (
        next === -1 ||
        !allowed[next] ||
        positionM > endM ||
        positionM > current.lengthM ||
        positionM > compiled.lanes[next]!.lengthM
      )
        break;
      yield { lane: next, changes };
      lane = next;
    }
  }
}

export function resolveLanes(
  compiled: CompiledCity,
  graph: RoadGraph,
  roads: number[],
  request: RouteRequest,
  destination: CConnector,
  changeDistanceM: number,
  preferredMovements?: number[],
) {
  const last = roads.length - 1;
  const targetLanes: number[][] = new Array(roads.length);
  // Fewest changes first, then left before right (a stable sort keeps the generator's order).
  const reachable = (lane: number, endM: number, startM = 0) =>
    [...reachableLanes(compiled, graph.allowed, lane, endM, changeDistanceM, startM)].sort(
      (a, b) => a.changes - b.changes,
    );
  const arrivalChanges = (lane: number, startM = 0) =>
    reachable(lane, destination.positionM, startM).find((c) => c.lane === destination.lane)
      ?.changes;

  if (last === 0 && arrivalChanges(request.fromLane, request.fromPosM) === undefined) return null;
  // Lanes of the next road that the route can enter, with the fewest changes each needs to
  // reach that road's target lanes. An arrival uses the connector as its cutoff; there is no
  // extra distance for lane changes.
  let enterable = new Map<number, number>();
  for (const lane of compiled.roads[roads[last]!]!.lanes) {
    const changes = arrivalChanges(lane);
    if (changes !== undefined) enterable.set(lane, changes);
  }
  targetLanes[last] = [destination.lane];

  const choices: Map<number, number>[] = new Array(last);
  for (let i = last - 1; i >= 0; i--) {
    const road = compiled.roads[roads[i]!]!;
    const exits = new Map<number, number>();
    // TASK-076: land where the next road needs the fewest changes, then the lowest penalty.
    const better = (a: number, b: number) => {
      const changes = (idx: number) => enterable.get(compiled.movements[idx]!.toLane)!;
      if (changes(a) !== changes(b)) return changes(a) < changes(b);
      if (graph.penalties[a] !== graph.penalties[b])
        return graph.penalties[a]! < graph.penalties[b]!;
      return a < b;
    };
    for (const lane of road.lanes) {
      for (const idx of graph.outgoing[lane]!) {
        if (!enterable.has(compiled.movements[idx]!.toLane)) continue;
        const best = exits.get(lane);
        if (best === undefined || better(idx, best)) exits.set(lane, idx);
      }
    }
    if (!exits.size) return null;
    choices[i] = exits;
    targetLanes[i] = [...exits.keys()];
    if (i > 0) {
      enterable = new Map<number, number>();
      for (const entry of road.lanes) {
        const exit = reachable(entry, Math.max(0, road.lengthM - 10)).find(({ lane }) =>
          exits.has(lane),
        );
        if (exit) enterable.set(entry, exit.changes);
      }
    }
  }

  const movements: number[] = [];
  let entryLane = request.fromLane;
  for (let i = 0; i < last; i++) {
    const endM =
      i === 0
        ? compiled.lanes[entryLane]!.lengthM
        : Math.max(0, compiled.roads[roads[i]!]!.lengthM - 10);
    const startM = i === 0 ? request.fromPosM : 0;
    let movement = preferredMovements?.[i];
    if (movement === undefined) {
      for (const { lane } of reachable(entryLane, endM, startM)) {
        movement = choices[i]!.get(lane);
        if (movement !== undefined) break;
      }
    }
    if (movement === undefined) return null;
    // Keep the chosen plan first without making its lane compulsory.
    const preferred = compiled.movements[movement]!.fromLane;
    targetLanes[i] = [preferred, ...targetLanes[i]!.filter((lane) => lane !== preferred)];
    movements.push(movement);
    entryLane = compiled.movements[movement]!.toLane;
  }
  return { movements, targetLanes };
}
