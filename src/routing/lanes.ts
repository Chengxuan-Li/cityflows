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
) {
  const last = roads.length - 1;
  const targetLanes: number[][] = new Array(roads.length);
  const reachable = (lane: number, endM: number, startM = 0) =>
    reachableLanes(compiled, graph.allowed, lane, endM, changeDistanceM, startM);
  const canArrive = (lane: number, startM = 0) => {
    for (const candidate of reachable(lane, destination.positionM, startM)) {
      if (candidate.lane === destination.lane) return true;
    }
    return false;
  };

  targetLanes[last] = compiled.roads[roads[last]!]!.lanes.filter((lane) => canArrive(lane));
  if (last === 0 && !canArrive(request.fromLane, request.fromPosM)) return null;

  const choices: Map<number, number>[] = new Array(last);
  // An arrival uses the connector as its cutoff; there is no extra distance for lane changes.
  let enterable = new Set(targetLanes[last]);
  for (let i = last - 1; i >= 0; i--) {
    const road = compiled.roads[roads[i]!]!;
    const exits = new Map<number, number>();
    for (const lane of road.lanes) {
      for (const idx of graph.outgoing[lane]!) {
        if (!enterable.has(compiled.movements[idx]!.toLane)) continue;
        const best = exits.get(lane);
        if (best === undefined || graph.penalties[idx]! < graph.penalties[best]!)
          exits.set(lane, idx);
      }
    }
    if (!exits.size) return null;
    choices[i] = exits;
    targetLanes[i] = [...exits.keys()];
    if (i > 0) {
      enterable = new Set<number>();
      for (const entry of road.lanes) {
        for (const { lane } of reachable(entry, Math.max(0, road.lengthM - 10))) {
          if (!exits.has(lane)) continue;
          enterable.add(entry);
          break;
        }
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
    let movement: number | undefined;
    for (const { lane } of reachable(entryLane, endM, startM)) {
      movement = choices[i]!.get(lane);
      if (movement !== undefined) break;
    }
    if (movement === undefined) return null;
    movements.push(movement);
    entryLane = compiled.movements[movement]!.toLane;
  }
  return { movements, targetLanes };
}
