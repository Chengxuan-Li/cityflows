import { headingAtDistance } from '../geo/polyline';
import type { CMovement, CompiledCity } from '../network';
import type { SimParams } from '../schema';
import { AMBER, GREEN, RED, updateSignals } from './signals';
import { DRIVING, type Vehicles } from './vehicle';

/** Travel at maximum acceleration, then at the speed cap. */
function travelTime(distance: number, speed: number, cap: number, acceleration: number) {
  if (distance <= 0) return 0;
  speed = Math.min(speed, cap);
  const acceleratingDistance = (cap * cap - speed * speed) / (2 * acceleration);
  if (distance <= acceleratingDistance)
    return (2 * distance) / (Math.sqrt(speed * speed + 2 * acceleration * distance) + speed);
  return (cap - speed) / acceleration + (distance - acceleratingDistance) / cap;
}

export function createIntersections(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  mergeAllows: (id: number, movement: CMovement) => boolean = () => true,
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
  const onRed = (movement: CMovement) => !!movement.turnOnRed && colors[movement.idx] === RED;
  const needsStop = (movement: CMovement) =>
    onRed(movement) ||
    (compiled.nodes[movement.node]!.control === 'stop' && movement.priority < 10);
  const candidates = compiled.nodes.map((): number[] => []);
  const activeNodes: number[] = [];
  const headings = compiled.lanes.map((lane) =>
    headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM),
  );
  const clearance = params.vehicleLengthM + params.idm.minGapM;

  function signalAllows(id: number, movement: CMovement) {
    if (movement.neverGreen) return false;
    if (!compiled.nodes[movement.node]!.signal || colors[movement.idx] === GREEN) return true;
    if (onRed(movement)) return !!redGrants[id] || vehicles.stopped[id]! >= 1 - 1e-9;
    const distance = compiled.lanes[movement.fromLane]!.lengthM - vehicles.position[id]!;
    return (
      colors[movement.idx] === AMBER && vehicles.speed[id]! ** 2 > 2 * params.idm.bMps2 * distance
    );
  }

  function release(id: number) {
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
    if (needsStop(movement) && vehicles.stopped[id]! < 1 - 1e-9) return;
    const queue = candidates[movement.node]!;
    if (!queue.length) activeNodes.push(movement.node);
    queue.push(id);
  }

  const movementSpeed = (movement: CMovement) =>
    Math.min(
      compiled.lanes[movement.fromLane]!.speedLimitMps,
      compiled.lanes[movement.toLane]!.speedLimitMps,
    );
  const candidateTime = (id: number, movement: CMovement, distance: number) =>
    travelTime(
      compiled.lanes[movement.fromLane]!.lengthM - vehicles.position[id]! + distance,
      vehicles.speed[id]!,
      movementSpeed(movement),
      params.idm.aMps2,
    );

  function canGrant(id: number, movement: CMovement) {
    if (!signalAllows(id, movement)) return false;
    const exitTail = vehicles.last(movement.toLane);
    if (exitTail !== -1) {
      const space =
        vehicles.stopped[id]! >= params.intersection.boxWaitS
          ? vehicles.position[exitTail]!
          : vehicles.position[exitTail]! -
            params.vehicleLengthM +
            vehicles.speed[exitTail]! * candidateTime(id, movement, movement.lengthM);
      if (space < clearance) return false;
    }
    const control = compiled.nodes[movement.node]!.control;
    for (let i = 0; i < movement.conflicts.length; i++) {
      const idx = movement.conflicts[i]!;
      const other = compiled.movements[idx]!;
      const [start, end] = opposingZones[movement.idx]![i]!;
      const exit =
        candidateTime(id, movement, movement.conflictZones[i]![1] + params.vehicleLengthM) +
        params.intersection.zoneMarginS;
      for (let car = vehicles.first(-idx - 1); car !== -1; car = vehicles.next[car]!) {
        if (vehicles.position[car]! >= end + params.vehicleLengthM) continue;
        if (
          travelTime(
            start - vehicles.position[car]!,
            vehicles.speed[car]!,
            movementSpeed(other),
            params.idm.aMps2,
          ) < exit
        )
          return false;
      }
      if (occupancy[idx]! > 0) {
        const lane = compiled.lanes[other.fromLane]!;
        for (let car = vehicles.first(lane.idx); car !== -1; car = vehicles.next[car]!) {
          if (grants[car] !== idx) continue;
          if (
            travelTime(
              lane.lengthM - vehicles.position[car]! + start,
              vehicles.speed[car]!,
              lane.speedLimitMps,
              params.idm.aMps2,
            ) < exit
          )
            return false;
        }
      }
      if (control !== 'yield' && control !== 'stop' && !onRed(movement)) continue;
      const higher = compiled.movements[idx]!;
      if (onRed(movement)) {
        if (colors[idx] === RED && !higher.turnOnRed) continue;
      } else if (higher.priority <= movement.priority) continue;
      const length = compiled.lanes[higher.fromLane]!.lengthM;
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
          return false;
        }
      }
    }
    return mergeAllows(id, movement);
  }

  function zoneStop(movement: CMovement, position: number) {
    let stop = Infinity;
    for (let i = 0; i < movement.conflicts.length; i++) {
      const start = movement.conflictZones[i]![0];
      if (position > start || start >= stop) continue;
      const [otherStart, otherEnd] = opposingZones[movement.idx]![i]!;
      for (
        let car = vehicles.first(-movement.conflicts[i]! - 1);
        car !== -1;
        car = vehicles.next[car]!
      ) {
        const front = vehicles.position[car]!;
        if (front <= otherStart) break;
        if (front < otherEnd + params.vehicleLengthM) {
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
    request,
    resolve,
    release,
    zoneStop,
    grants,
    redGrants,
    occupancy,
    continuations,
  };
}
