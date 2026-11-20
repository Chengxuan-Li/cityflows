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

// Scratch for `sortedReachable`: resolveLanes reads each list before it asks for the next.
const sideLanes: number[] = [];
const sortedLanes: number[] = [];
const sortedChanges: number[] = [];
// resolveLanes' enterable lanes of the next road: a lane is in the set while its stamp is the
// current one, with the fewest changes it needs in `enterChanges` (TASK-243: was a Map per road).
let enterStamps = new Uint32Array(0);
let enterChanges = new Int32Array(0);
let enterStamp = 0;

function nextEnterable(laneCount: number) {
  if (enterStamps.length < laneCount) {
    enterStamps = new Uint32Array(laneCount);
    enterChanges = new Int32Array(laneCount);
    enterStamp = 0;
  }
  if (enterStamp === 0xffffffff) {
    enterStamps.fill(0);
    enterStamp = 0;
  }
  return ++enterStamp;
}

/**
 * TASK-243: `[...reachableLanes(...)].sort((a, b) => a.changes - b.changes)` into `sortedLanes`
 * and `sortedChanges` without the generator, its objects or the sort; returns the count. The
 * generator yields the lane itself, then k lanes to the left with 1..k changes, then m to the
 * right with 1..m; the stable sort interleaves the two sides, left first at each count.
 */
function sortedReachable(
  compiled: CompiledCity,
  allowed: boolean[],
  from: number,
  endM: number,
  changeDistanceM: number,
  startM: number,
) {
  if (!allowed[from] || startM > endM) return 0;
  let left = 0;
  let right = 0;
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
      sideLanes[left + right] = next;
      if (side === 'left') left++;
      else right++;
      lane = next;
    }
  }
  sortedLanes[0] = from;
  sortedChanges[0] = 0;
  let count = 1;
  for (let changes = 1; changes <= left || changes <= right; changes++) {
    if (changes <= left) {
      sortedLanes[count] = sideLanes[changes - 1]!;
      sortedChanges[count++] = changes;
    }
    if (changes <= right) {
      sortedLanes[count] = sideLanes[left + changes - 1]!;
      sortedChanges[count++] = changes;
    }
  }
  return count;
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
    sortedReachable(compiled, graph.allowed, lane, endM, changeDistanceM, startM);
  const arrivalChanges = (lane: number, startM = 0) => {
    const count = reachable(lane, destination.positionM, startM);
    for (let k = 0; k < count; k++)
      if (sortedLanes[k] === destination.lane) return sortedChanges[k]!;
    return undefined;
  };

  if (last === 0 && arrivalChanges(request.fromLane, request.fromPosM) === undefined) return null;
  // Lanes of the next road that the route can enter, with the fewest changes each needs to
  // reach that road's target lanes. An arrival uses the connector as its cutoff; there is no
  // extra distance for lane changes.
  let enterable = nextEnterable(compiled.lanes.length);
  for (const lane of compiled.roads[roads[last]!]!.lanes) {
    const changes = arrivalChanges(lane);
    if (changes === undefined) continue;
    enterStamps[lane] = enterable;
    enterChanges[lane] = changes;
  }
  targetLanes[last] = [destination.lane];

  // Per road, the lanes with an exit in road-lane order and each one's chosen movement.
  const choices: { lanes: number[]; movements: number[] }[] = new Array(last);
  const { toLane, penalties } = graph;
  for (let i = last - 1; i >= 0; i--) {
    const road = compiled.roads[roads[i]!]!;
    const lanes: number[] = [];
    const movements: number[] = [];
    // TASK-076: land where the next road needs the fewest changes, then the lowest penalty.
    const better = (a: number, b: number) => {
      const changesA = enterChanges[toLane[a]!]!;
      const changesB = enterChanges[toLane[b]!]!;
      if (changesA !== changesB) return changesA < changesB;
      if (penalties[a] !== penalties[b]) return penalties[a]! < penalties[b]!;
      return a < b;
    };
    for (const lane of road.lanes) {
      let best = -1;
      for (const idx of graph.outgoing[lane]!) {
        if (enterStamps[toLane[idx]!] !== enterable) continue;
        if (best === -1 || better(idx, best)) best = idx;
      }
      if (best === -1) continue;
      lanes.push(lane);
      movements.push(best);
    }
    if (!lanes.length) return null;
    choices[i] = { lanes, movements };
    targetLanes[i] = lanes.slice();
    if (i > 0) {
      enterable = nextEnterable(compiled.lanes.length);
      for (const entry of road.lanes) {
        const count = reachable(entry, Math.max(0, road.lengthM - 10));
        for (let k = 0; k < count; k++)
          if (lanes.includes(sortedLanes[k]!)) {
            enterStamps[entry] = enterable;
            enterChanges[entry] = sortedChanges[k]!;
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
    let movement = preferredMovements?.[i];
    if (movement === undefined) {
      const { lanes, movements: chosen } = choices[i]!;
      const count = reachable(entryLane, endM, startM);
      for (let k = 0; k < count; k++) {
        const at = lanes.indexOf(sortedLanes[k]!);
        if (at === -1) continue;
        movement = chosen[at];
        break;
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
