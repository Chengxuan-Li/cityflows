import { headingAtDistance } from '../geo/polyline';
import type { CMovement, CompiledCity } from '../network';
import { railTimetable } from '../network/trams';
import type { SimParams } from '../schema';
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
  options: { onDecision?: IntersectionObserver; acceleration?: (id: number) => number } = {},
) {
  const continuations = compiled.movements.map((movement) => {
    const node = compiled.nodes[movement.node]!;
    return (
      node.control === 'uncontrolled' &&
      !node.signal &&
      movement.conflicts.length === 0 &&
      movement.turn !== 'merge' &&
      !movement.neverGreen &&
      !movement.turnOnRed
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
    onRed(movement) ||
    (compiled.nodes[movement.node]!.control === 'stop' && movement.priority < 10);
  const candidates = compiled.nodes.map((): number[] => []);
  const activeNodes: number[] = [];
  const headings = compiled.lanes.map((lane) =>
    headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM),
  );
  const profiles = createVehicleProfiles(params);
  const profile = (id: number) => profiles[vehicles.vclass[id]!]!;

  function signalAllows(id: number, movement: CMovement) {
    if (movement.neverGreen) return false;
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

  const railBands = compiled.lanes.map(() => [] as { fromM: number; toM: number }[]);
  const rail = compiled.rail;
  if (rail?.facilities?.length) {
    const table = railTimetable(rail);
    const tracks = new Set(
      table.departures.flatMap((d) => table.routes[d.route]!.sections.map((s) => s.track)),
    );
    for (const facility of rail.facilities) {
      if (facility.railSpans?.some((span) => tracks.has(span.track)))
        for (const span of facility.spans ?? [])
          if (span.segment >= 0) railBands[span.segment]!.push(span);
    }
  }
  const maxLength = Math.max(...profiles.map((p) => p.lengthM));
  const exitBands = railBands.map((spans, lane) =>
    spans.some((s) => s.toM >= compiled.lanes[lane]!.stopM - maxLength - params.idm.minGapM),
  );
  const railExits = compiled.movements.map((m) =>
    m.conflicts.flatMap((rival, i) => {
      const exit = compiled.movements[rival]!;
      return exitBands[exit.fromLane] ? [{ exit, end: m.conflictZones[i]![1] }] : [];
    }),
  );
  function onRail(id: number) {
    const front = vehicles.position[id]!;
    return railBands[vehicles.lane[id]!]!.some(
      (span) => front >= span.fromM && front - profile(id).lengthM <= span.toM,
    );
  }
  function usesRailExit(exit: CMovement) {
    const lane = compiled.lanes[exit.fromLane]!;
    const front = vehicles.first(lane.idx);
    if (front !== -1 && vehicles.movement[front] === exit.idx && onRail(front)) return true;
    for (const m of lane.in) {
      const entering = vehicles.first(-m - 1);
      if (entering === -1) continue;
      const step = vehicles.routeStep[entering]! + 1;
      const route = vehicles.route[entering];
      if (
        route?.movements[step] === exit.idx &&
        route.roads[step + 1] === compiled.lanes[exit.toLane]!.road &&
        railBands[lane.idx]!.some(
          (span) => span.fromM <= profile(entering).lengthM + params.idm.minGapM,
        )
      )
        return true;
    }
    return false;
  }
  function obstructsRailExit(id: number, movement: CMovement) {
    let end = -Infinity;
    for (const rival of railExits[movement.idx]!)
      if (usesRailExit(rival.exit)) end = Math.max(end, rival.end);
    if (end === -Infinity) return false;
    // A stopped candidate and vehicles already promised this exit must fit beyond its last shared zone.
    const lane = compiled.lanes[movement.toLane]!,
      tail = vehicles.last(lane.idx);
    const gap = params.idm.minGapM;
    let storage =
      movement.lengthM +
      Math.min(
        lane.stopM,
        tail === -1 ? Infinity : vehicles.position[tail]! - profile(tail).lengthM,
      ) -
      end;
    for (const m of lane.in) {
      for (let v = vehicles.first(-m - 1); v !== -1; v = vehicles.next[v]!)
        if (v !== id) storage -= profile(v).lengthM + gap;
      for (let v = vehicles.first(compiled.movements[m]!.fromLane); v !== -1; v = vehicles.next[v]!)
        if (v !== id && grants[v] === m) storage -= profile(v).lengthM + gap;
    }
    return storage < profile(id).lengthM + gap;
  }
  function blockedExit(id: number, movement: CMovement): 'exit-full' | 'box' | null {
    const clearance = profile(id).lengthM + params.idm.minGapM;
    const exitTail = vehicles.last(movement.toLane);
    if (exitTail !== -1) {
      const space =
        vehicles.stopped[id]! >= params.intersection.boxWaitS
          ? vehicles.position[exitTail]!
          : vehicles.position[exitTail]! -
            profile(exitTail).lengthM +
            vehicles.speed[exitTail]! * candidateTime(id, movement, movement.lengthM);
      if (space < clearance) return vehicles.position[exitTail]! < clearance ? 'exit-full' : 'box';
    }
    return null;
  }

  function canGrant(id: number, movement: CMovement) {
    if (!signalAllows(id, movement)) return refuse(id, movement, 'signal');
    const blocked = blockedExit(id, movement) ?? (obstructsRailExit(id, movement) ? 'box' : null);
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
      if (control !== 'yield' && control !== 'stop' && !onRed(movement)) continue;
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
  const clearingRails = (id: number) => {
    const movement = movementOf(id);
    return (
      onRail(id) &&
      signalAllows(id, movement) &&
      !blockedExit(id, movement) &&
      !obstructsRailExit(id, movement)
    );
  };
  const compare = (a: number, b: number) =>
    Number(onRed(movementOf(a))) - Number(onRed(movementOf(b))) ||
    Number(clearingRails(b)) - Number(clearingRails(a)) ||
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
