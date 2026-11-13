import { headingAtDistance } from '../geo/polyline';
import type { CMovement, CompiledCity } from '../network';
import { vehicleClasses, type SimParams } from '../schema';
import { reachableLanes, type Route } from '../routing';
import { AMBER, GREEN, RED, updateSignals } from './signals';
import { createVehicleProfiles, DRIVING, type Vehicles } from './vehicle';

/** Constant current acceleration, then the speed cap; a stop short of the target is unreachable. */
function travelTime(distance: number, speed: number, cap: number, acceleration: number) {
  if (distance <= 0) return 0;
  speed = Math.min(speed, cap);
  if (Math.abs(acceleration) < 1e-9) return speed > 0 ? distance / speed : Infinity;
  if (acceleration < 0) {
    const squared = speed * speed + 2 * acceleration * distance;
    return squared < 0 ? Infinity : (2 * distance) / (speed + Math.sqrt(squared));
  }
  const acceleratingDistance = (cap * cap - speed * speed) / (2 * acceleration);
  if (distance <= acceleratingDistance)
    return (2 * distance) / (Math.sqrt(speed * speed + 2 * acceleration * distance) + speed);
  return (cap - speed) / acceleration + (distance - acceleratingDistance) / cap;
}

export type IntersectionObserver = (
  id: number,
  movement: CMovement,
  reason:
    'signal' | 'stop' | 'box' | 'exit-full' | 'movement' | 'approach' | 'gap' | 'merge' | 'granted',
  other?: CMovement,
) => void;

export function createIntersections(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  mergeAllows: (id: number, movement: CMovement) => boolean = () => true,
  options: {
    onDecision?: IntersectionObserver;
    acceleration?: (id: number) => number;
    groupRoute?: (id: number, movement: CMovement) => { route: Route; step: number } | null;
    routeVersion?: () => number;
  } = {},
) {
  const inner = (movement: CMovement) =>
    compiled.roads[compiled.lanes[movement.fromLane]!.road]!.group !== undefined;
  const continuations = compiled.movements.map((movement) => {
    const node = compiled.nodes[movement.node]!;
    return (
      node.control === 'uncontrolled' &&
      !node.signal &&
      movement.conflicts.length === 0 &&
      movement.turn !== 'merge' &&
      !movement.neverGreen &&
      !movement.turnOnRed &&
      compiled.nodes[movement.node]!.group === undefined
    );
  });
  const colors = new Uint8Array(compiled.movements.length);
  const opposingZones = compiled.movements.map((movement) =>
    movement.conflicts.map((idx) => {
      const other = compiled.movements[idx]!;
      return other.conflictZones[other.conflicts.indexOf(movement.idx)]!;
    }),
  );
  // Grants persist to the movement exit, even after the rear clears a particular conflict.
  const occupancy = new Uint16Array(compiled.movements.length);
  const grants = new Int32Array(vehicles.count).fill(-1);
  const redGrants = new Uint8Array(vehicles.count);
  // Retain provenance until the rear clears the exit, without treating same-path leaders as conflicts.
  const exitedFrom = new Int32Array(vehicles.count).fill(-1);
  const onRed = (movement: CMovement) => !!movement.turnOnRed && colors[movement.idx] === RED;
  const needsStop = (movement: CMovement) =>
    !inner(movement) &&
    (onRed(movement) ||
      (compiled.nodes[movement.node]!.control === 'stop' && movement.priority < 10));
  const candidates = compiled.nodes.map((): number[] => []);
  const activeNodes: number[] = [];
  const headings = compiled.lanes.map((lane) =>
    headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM),
  );
  const profiles = createVehicleProfiles(params);
  const profile = (id: number) => profiles[vehicles.vclass[id]!]!;
  const allowedLanes = vehicleClasses.map((name) =>
    compiled.lanes.map((lane) => lane.allowed.includes(name)),
  );
  const reservedSpace = new Float64Array(compiled.lanes.length);
  type GroupPath = { movements: number[]; route: Route; step: number };
  const groupPaths: (GroupPath | undefined)[] = [];
  const groupOccupants = compiled.groups?.map(() => new Set<number>()) ?? [];

  function leaveGroup(id: number, lane?: number) {
    const chain = groupPaths[id];
    if (!chain) return;
    const exit = compiled.movements[chain.movements.at(-1)!]!.toLane;
    if (lane !== undefined && lane !== exit) return;
    reservedSpace[exit] = Math.max(
      0,
      reservedSpace[exit]! - profile(id).lengthM - params.idm.minGapM,
    );
    const first = compiled.movements[chain.movements[0]!]!;
    groupOccupants[compiled.nodes[first.node]!.group!]!.delete(id);
    groupPaths[id] = undefined;
  }
  const chainCache: (
    | {
        route: Route | null;
        step: number;
        version: number;
        chains: Map<number, GroupPath | undefined>;
      }
    | undefined
  )[] = [];

  function entryChain(id: number, movement: CMovement) {
    const route = vehicles.route[id]!;
    const step = vehicles.routeStep[id]!;
    const version = options.routeVersion?.() ?? 0;
    let cache = chainCache[id];
    if (cache?.route !== route || cache.step !== step || cache.version !== version) {
      cache = { route, step, version, chains: new Map() };
      chainCache[id] = cache;
    }
    if (cache.chains.has(movement.idx)) return cache.chains.get(movement.idx);
    const group = compiled.groups![compiled.nodes[movement.node]!.group!]!;
    const plan = options.groupRoute ? options.groupRoute(id, movement) : { route, step };
    let chain: GroupPath | undefined;
    if (plan) {
      const lastRoad = plan.route.roads.at(-1)!;
      const endsInside = compiled.roads[lastRoad]!.group === group.idx;
      const remaining = plan.route.roads.length - 1 - plan.step;
      const usableExit = (movements: number[]) => {
        const exit = compiled.lanes[compiled.movements[movements.at(-1)!]!.toLane]!;
        const exitStep = plan.step + movements.length;
        const final = exitStep === plan.route.roads.length - 1;
        const cutoff = final
          ? compiled.connectors[vehicles.destination[id]!]!.positionM
          : Math.max(0, compiled.roads[exit.road]!.lengthM - 10);
        const targets = final
          ? [compiled.connectors[vehicles.destination[id]!]!.lane]
          : plan.route.targetLanes[exitStep]!;
        return [
          ...reachableLanes(
            compiled,
            allowedLanes[vehicles.vclass[id]!]!,
            exit.idx,
            cutoff,
            params.laneChangeDistanceM,
          ),
        ].some((candidate) => targets.includes(candidate.lane));
      };
      for (const candidate of group.chains) {
        if (candidate.movements[0] !== movement.idx) continue;
        const movements = endsInside
          ? candidate.movements.slice(0, remaining)
          : candidate.movements;
        if (
          movements.every((m, i) => {
            const lane = compiled.lanes[compiled.movements[m]!.toLane]!;
            return (
              lane.road === plan.route.roads[plan.step + i + 1] &&
              lane.allowed.includes(vehicleClasses[vehicles.vclass[id]!]!) &&
              !compiled.movements[m]!.neverGreen
            );
          })
        ) {
          if (usableExit(movements)) {
            chain = { movements, ...plan };
            break;
          }
        }
      }
      // The road router also permits a lane change on a sufficiently long inner road.
      // Such a route need not have a lane-contiguous compiled chain.
      if (!chain) {
        const movements = [movement.idx];
        let lane = compiled.lanes[movement.toLane]!;
        while (compiled.roads[lane.road]!.group === group.idx) {
          const next = compiled.movements[plan.route.movements[plan.step + movements.length] ?? -1];
          if (!next) break;
          if (
            next.neverGreen ||
            compiled.lanes[next.fromLane]!.road !== lane.road ||
            !allowedLanes[vehicles.vclass[id]!]![next.toLane] ||
            ![
              ...reachableLanes(
                compiled,
                allowedLanes[vehicles.vclass[id]!]!,
                lane.idx,
                Math.max(0, compiled.roads[lane.road]!.lengthM - 10),
                params.laneChangeDistanceM,
              ),
            ].some((candidate) => candidate.lane === next.fromLane)
          )
            break;
          movements.push(next.idx);
          lane = compiled.lanes[next.toLane]!;
        }
        if (compiled.roads[lane.road]!.group !== group.idx || lane.road === lastRoad)
          if (usableExit(movements)) chain = { movements, ...plan };
      }
      if (chain) {
        const movements = [...chain.movements];
        let lane = compiled.lanes[compiled.movements[movements.at(-1)!]!.toLane]!;
        while (lane.lengthM < profile(id).lengthM + params.idm.minGapM) {
          const step = plan.step + movements.length;
          if (step === plan.route.roads.length - 1) break;
          const next = lane.out.find(
            (m) =>
              continuations[m] &&
              compiled.lanes[compiled.movements[m]!.toLane]!.road === plan.route.roads[step + 1] &&
              allowedLanes[vehicles.vclass[id]!]![compiled.movements[m]!.toLane],
          );
          if (next === undefined) break;
          movements.push(next);
          lane = compiled.lanes[compiled.movements[next]!.toLane]!;
        }
        chain = { ...chain, movements };
      }
    }
    cache.chains.set(movement.idx, chain);
    return chain;
  }

  function signalAllows(id: number, movement: CMovement) {
    if (movement.neverGreen) return false;
    if (inner(movement)) return true;
    if (!compiled.nodes[movement.node]!.signal || colors[movement.idx] === GREEN) return true;
    if (onRed(movement)) return !!redGrants[id] || vehicles.stopped[id]! >= 1 - 1e-9;
    const distance = compiled.lanes[movement.fromLane]!.stopM - vehicles.position[id]!;
    return (
      colors[movement.idx] === AMBER &&
      vehicles.speed[id]! ** 2 > 2 * profile(id).idm.bMps2 * distance
    );
  }

  function release(id: number) {
    if (vehicles.lane[id]! < 0) exitedFrom[id] = grants[id]!;
    occupancy[grants[id]!] = occupancy[grants[id]!]! - 1;
    grants[id] = -1;
    redGrants[id] = 0;
  }

  function signals(timeS: number) {
    updateSignals(compiled, timeS, colors);
    // A reservation cannot authorize entry after the light changes.
    for (let id = 0; id < vehicles.count; id++) {
      const idx = grants[id]!;
      if (idx === -1 || vehicles.lane[id]! < 0) continue;
      const movement = compiled.movements[idx]!;
      if (colors[idx] === GREEN) redGrants[id] = 0;
      if (compiled.nodes[movement.node]!.signal && !signalAllows(id, movement)) release(id);
    }
  }

  function request(id: number, movement: CMovement) {
    if (needsStop(movement) && vehicles.stopped[id]! < 1 - 1e-9) {
      options.onDecision?.(id, movement, 'stop');
      return;
    }
    const queue = candidates[movement.node]!;
    if (!queue.length) activeNodes.push(movement.node);
    queue.push(id);
  }

  const movementSpeed = (movement: CMovement, id: number) =>
    Math.min(
      compiled.lanes[movement.fromLane]!.speedLimitMps,
      compiled.lanes[movement.toLane]!.speedLimitMps,
      profile(id).maxSpeedMps,
    );
  const candidateTime = (id: number, movement: CMovement, distance: number) =>
    travelTime(
      compiled.lanes[movement.fromLane]!.lengthM - vehicles.position[id]! + distance,
      vehicles.speed[id]!,
      movementSpeed(movement, id),
      profile(id).idm.aMps2,
    );

  function refuse(
    id: number,
    movement: CMovement,
    reason: Parameters<IntersectionObserver>[2],
    other?: CMovement,
  ) {
    options.onDecision?.(id, movement, reason, other);
    return false;
  }

  function exitRear(tail: number, horizon: number) {
    const lane = compiled.lanes[vehicles.lane[tail]!]!;
    let space = Infinity;
    let behind = profile(tail).lengthM;
    for (let car = tail; car !== -1; car = vehicles.previous[car]!) {
      let front = vehicles.position[car]! + vehicles.speed[car]! * horizon;
      const destination = compiled.connectors[vehicles.destination[car]!];
      if (destination?.lane === lane.idx && destination.positionM >= vehicles.position[car]!)
        front = Math.min(front, destination.positionM);
      const next = compiled.movements[vehicles.movement[car]!];
      if (next && !signalAllows(car, next))
        front = Math.min(front, Math.max(vehicles.position[car]!, lane.stopM - params.idm.minGapM));
      space = Math.min(space, front - behind);
      if (vehicles.position[car]! - behind >= space) break;
      const ahead = vehicles.previous[car]!;
      if (ahead !== -1) behind += profile(ahead).lengthM + params.idm.minGapM;
    }
    return space;
  }

  /** Whether admitted car `id` still holds a member movement that conflicts with `path`. With a
   * `requester` entering by `entry`, a conflict the holder has not yet reached is held only if
   * the holder could arrive there before the requester's rear clears it (canGrant's timing). */
  function conflictsWithClearance(
    path: GroupPath,
    id: number,
    requester?: number,
    entry?: CMovement,
  ) {
    const held = groupPaths[id]!;
    const field = vehicles.lane[id]!;
    const at = held.movements.findIndex((m) =>
      field < 0
        ? m === -field - 1
        : compiled.lanes[compiled.movements[m]!.toLane]!.road === compiled.lanes[field]!.road,
    );
    const cleared = at + Number(field >= 0 && vehicles.position[id]! >= profile(id).lengthM);
    let ahead = 0;
    for (const m of path.movements) {
      const movement = compiled.movements[m]!;
      for (let i = 0; i < movement.conflicts.length; i++) {
        const k = held.movements.indexOf(movement.conflicts[i]!);
        if (k < Math.max(0, cleared)) continue;
        if (requester === undefined || at === -1 || k <= at) return true;
        // The holder's front to the start of member k, then into the conflict zone.
        let distance =
          (field < 0
            ? compiled.movements[held.movements[at]!]!.lengthM +
              compiled.lanes[compiled.movements[held.movements[at]!]!.toLane]!.lengthM
            : compiled.lanes[field]!.lengthM) - vehicles.position[id]!;
        for (let j = at + 1; j < k; j++) {
          const member = compiled.movements[held.movements[j]!]!;
          distance += member.lengthM + compiled.lanes[member.toLane]!.lengthM;
        }
        const [start] = opposingZones[movement.idx]![i]!;
        const arrival = travelTime(
          distance + start,
          vehicles.speed[id]!,
          profile(id).maxSpeedMps,
          profile(id).idm.aMps2,
        );
        const exit = candidateTime(
          requester,
          entry!,
          ahead + movement.conflictZones[i]![1] + profile(requester).lengthM,
        );
        if (arrival < exit + params.intersection.zoneMarginS) return true;
      }
      ahead += movement.lengthM + compiled.lanes[movement.toLane]!.lengthM;
    }
    return false;
  }

  function blockedExit(id: number, movement: CMovement): 'exit-full' | 'box' | null {
    const groupIndex = compiled.nodes[movement.node]!.group;
    if (groupIndex !== undefined && !inner(movement)) {
      const chain = entryChain(id, movement);
      if (!chain) return 'box';
      for (const car of groupOccupants[groupIndex]!) {
        if (car === id) continue;
        if (conflictsWithClearance(chain, car, id, movement)) return 'box';
      }
      let distance = 0;
      for (const idx of chain.movements) {
        const part = compiled.movements[idx]!;
        if (
          idx !== movement.idx &&
          compiled.movements[chain.movements[chain.movements.indexOf(idx) - 1]!]!.toLane !==
            part.fromLane &&
          vehicles.last(part.fromLane) !== -1
        )
          return 'box';
        distance += part.lengthM;
        const tail = vehicles.last(part.toLane);
        const clearance = profile(id).lengthM + params.idm.minGapM + reservedSpace[part.toLane]!;
        if (reservedSpace[part.toLane]! > 0 && compiled.lanes[part.toLane]!.lengthM < clearance)
          return 'exit-full';
        if (tail !== -1) {
          const horizon = Math.min(
            params.intersection.boxWaitS,
            candidateTime(id, movement, distance),
          );
          const space = exitRear(tail, horizon);
          if (space < clearance) return 'exit-full';
        }
        distance += compiled.lanes[part.toLane]!.lengthM;
      }
      return null;
    }
    const clearance = profile(id).lengthM + params.idm.minGapM;
    const horizon =
      vehicles.stopped[id]! >= params.intersection.boxWaitS
        ? 0
        : Math.min(params.intersection.boxWaitS, candidateTime(id, movement, movement.lengthM));
    const exitTail = vehicles.last(movement.toLane);
    if (exitTail !== -1) {
      const space = exitRear(exitTail, horizon);
      if (space < clearance) return vehicles.position[exitTail]! < clearance ? 'exit-full' : 'box';
    }
    for (const idx of compiled.lanes[movement.toLane]!.in) {
      const incoming = compiled.movements[idx]!;
      for (let car = vehicles.first(-idx - 1); car !== -1; car = vehicles.next[car]!) {
        const front = vehicles.position[car]! - incoming.lengthM + vehicles.speed[car]! * horizon;
        if (idx !== movement.idx && front < 0) continue;
        if (front - profile(car).lengthM < clearance) return 'box';
      }
    }
    return null;
  }

  function canGrant(id: number, movement: CMovement) {
    if (!signalAllows(id, movement)) return refuse(id, movement, 'signal');
    const blocked = blockedExit(id, movement);
    if (blocked) return refuse(id, movement, blocked);
    const control = compiled.nodes[movement.node]!.control;
    for (let i = 0; i < movement.conflicts.length; i++) {
      const idx = movement.conflicts[i]!;
      const other = compiled.movements[idx]!;
      const [start, end] = opposingZones[movement.idx]![i]!;
      const entry = candidateTime(id, movement, movement.conflictZones[i]![0]);
      const exit = candidateTime(id, movement, movement.conflictZones[i]![1] + profile(id).lengthM);
      const overlaps = (car: number, remaining: number) => {
        const acceleration = options.acceleration?.(car) ?? profile(car).idm.aMps2;
        let speed = vehicles.speed[car]!;
        let approachTime = 0;
        if (vehicles.lane[car]! >= 0) {
          const cap = Math.min(
            compiled.lanes[other.fromLane]!.speedLimitMps,
            profile(car).maxSpeedMps,
          );
          approachTime = travelTime(remaining, speed, cap, acceleration);
          if (!Number.isFinite(approachTime)) return false;
          speed = Math.max(0, Math.min(cap, speed + acceleration * approachTime));
          remaining = 0;
        }
        const cap = movementSpeed(other, car);
        const arrival = approachTime + travelTime(remaining + start, speed, cap, acceleration);
        if (arrival >= exit + params.intersection.zoneMarginS) return false;
        const clearance =
          approachTime +
          travelTime(remaining + end + profile(car).lengthM, speed, cap, acceleration);
        return entry < clearance + params.intersection.zoneMarginS;
      };
      for (let car = vehicles.first(-idx - 1); car !== -1; car = vehicles.next[car]!) {
        if (vehicles.position[car]! >= end + profile(car).lengthM) continue;
        if (overlaps(car, -vehicles.position[car]!)) return refuse(id, movement, 'movement', other);
      }
      if (occupancy[idx]! > 0) {
        const lane = compiled.lanes[other.fromLane]!;
        for (let car = vehicles.first(lane.idx); car !== -1; car = vehicles.next[car]!) {
          if (grants[car] !== idx) continue;
          if (overlaps(car, lane.lengthM - vehicles.position[car]!))
            return refuse(id, movement, 'approach', other);
        }
      }
      if (inner(movement) || (control !== 'yield' && control !== 'stop' && !onRed(movement)))
        continue;
      const higher = compiled.movements[idx]!;
      if (onRed(movement)) {
        if (colors[idx] === RED && !higher.turnOnRed) continue;
      } else if (higher.priority <= movement.priority) continue;
      const length = compiled.lanes[higher.fromLane]!.stopM;
      for (
        let approaching = vehicles.first(higher.fromLane);
        approaching !== -1;
        approaching = vehicles.next[approaching]!
      ) {
        if (
          vehicles.state[approaching] === DRIVING &&
          vehicles.movement[approaching] === idx &&
          vehicles.speed[approaching]! > 0 &&
          length - vehicles.position[approaching]! + start <
            vehicles.speed[approaching]! * params.intersection.gapS
        ) {
          return refuse(id, movement, 'gap', higher);
        }
      }
    }
    return mergeAllows(id, movement) || refuse(id, movement, 'merge');
  }

  function zoneStop(movement: CMovement, position: number) {
    let stop = Infinity;
    for (let i = 0; i < movement.conflicts.length; i++) {
      const start = movement.conflictZones[i]![0];
      if (position > start || start >= stop) continue;
      const [otherStart, otherEnd] = opposingZones[movement.idx]![i]!;
      const other = compiled.movements[movement.conflicts[i]!]!;
      const exitTail = vehicles.last(other.toLane);
      // A front on the exit lane can leave its rear in an end-reaching zone.
      if (
        exitTail !== -1 &&
        exitedFrom[exitTail] === other.idx &&
        other.lengthM + vehicles.position[exitTail]! > otherStart &&
        other.lengthM + vehicles.position[exitTail]! < otherEnd + profile(exitTail).lengthM
      ) {
        stop = start;
        continue;
      }
      for (
        let car = vehicles.first(-movement.conflicts[i]! - 1);
        car !== -1;
        car = vehicles.next[car]!
      ) {
        const front = vehicles.position[car]!;
        if (front <= otherStart) break;
        if (front < otherEnd + profile(car).lengthM) {
          stop = start;
          break;
        }
      }
    }
    return stop;
  }

  const movementOf = (id: number) => compiled.movements[vehicles.movement[id]!]!;
  const priority = (id: number) => (onRed(movementOf(id)) ? -1 : movementOf(id).priority);
  const compare = (a: number, b: number) =>
    priority(b) - priority(a) ||
    vehicles.junctionWaiting[b]! - vehicles.junctionWaiting[a]! ||
    a - b;

  function yieldsTo(id: number, other: number) {
    const angle = headings[vehicles.lane[id]!]! - headings[vehicles.lane[other]!]!;
    const side = Math.sin(angle);
    return compiled.drivingSide === 'right' ? side > 1e-9 : side < -1e-9;
  }

  function resolve() {
    activeNodes.sort((a, b) => a - b);
    for (const node of activeNodes) {
      const queue = candidates[node]!;
      queue.sort(compare);
      for (let start = 0; start < queue.length;) {
        const rank = priority(queue[start]!);
        let end = start + 1;
        while (end < queue.length && priority(queue[end]!) === rank) end++;
        // Give way to a contender on the favored side. A circular tie uses wait time and id.
        for (let remaining = end - start; remaining > 0; remaining--) {
          let first = -1;
          let winner = -1;
          for (let i = start; i < end; i++) {
            const id = queue[i]!;
            if (id === -1) continue;
            if (first === -1) first = i;
            let yields = false;
            for (let j = start; j < end; j++) {
              const other = queue[j]!;
              if (other !== -1 && i !== j && yieldsTo(id, other)) {
                yields = true;
                break;
              }
            }
            if (!yields) {
              winner = i;
              break;
            }
          }
          if (winner === -1) winner = first;
          const id = queue[winner]!;
          queue[winner] = -1;
          const movement = movementOf(id);
          if (!canGrant(id, movement)) continue;
          options.onDecision?.(id, movement, 'granted');
          grants[id] = movement.idx;
          redGrants[id] = Number(onRed(movement));
          occupancy[movement.idx] = occupancy[movement.idx]! + 1;
        }
        start = end;
      }
      queue.length = 0;
    }
    activeNodes.length = 0;
  }

  return {
    signals,
    blockedExit,
    reservedSpace,
    exitLane(id: number, movement: CMovement) {
      if (compiled.nodes[movement.node]!.group === undefined || inner(movement))
        return movement.toLane;
      const chain = entryChain(id, movement);
      return chain ? compiled.movements[chain.movements.at(-1)!]!.toLane : -1;
    },
    groupPaths,
    invalidatePlan(id: number) {
      chainCache[id] = undefined;
    },
    blocksEntry(id: number, requester: number, movement: CMovement) {
      const held = groupPaths[id];
      if (!held || grants[requester] !== -1 || inner(movement)) return false;
      const group = compiled.nodes[movement.node]!.group;
      if (
        group === undefined ||
        compiled.nodes[compiled.movements[held.movements[0]!]!.node]!.group !== group
      )
        return false;
      const path = entryChain(requester, movement);
      return !!path && conflictsWithClearance(path, id);
    },
    enterGroup(id: number, movement: CMovement) {
      if (compiled.nodes[movement.node]!.group === undefined || inner(movement)) return;
      const chain = entryChain(id, movement)!;
      const exit = compiled.movements[chain.movements.at(-1)!]!.toLane;
      groupPaths[id] = chain;
      groupOccupants[compiled.nodes[movement.node]!.group!]!.add(id);
      reservedSpace[exit] = reservedSpace[exit]! + profile(id).lengthM + params.idm.minGapM;
    },
    leaveGroup,
    /** TASK-077: the movement's signal does not show green (no movement, or no signal: false). */
    red: (movement: number) =>
      movement !== -1 &&
      !!compiled.nodes[compiled.movements[movement]!.node]!.signal &&
      colors[movement] !== GREEN,
    request,
    resolve,
    release,
    zoneStop,
    grants,
    redGrants,
    exitedFrom,
    occupancy,
    continuations,
  };
}
