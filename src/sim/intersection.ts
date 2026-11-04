import { headingAtDistance } from '../geo/polyline';
import type { CMovement, CompiledCity } from '../network';
import type { SimParams } from '../schema';
import { AMBER, GREEN, updateSignals } from './signals';
import { DRIVING, type Vehicles } from './vehicle';

export function createIntersections(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  mergeAllows: (id: number, movement: CMovement) => boolean = () => true,
) {
  const colors = new Uint8Array(compiled.movements.length);
  // Vehicles granted or driving on each movement. Several may share one movement (a platoon
  // through a green); entry is refused only while a conflicting movement is occupied.
  const occupancy = new Uint16Array(compiled.movements.length);
  const grants = new Int32Array(vehicles.count).fill(-1);
  const candidates = compiled.nodes.map((): number[] => []);
  const activeNodes: number[] = [];
  const headings = compiled.lanes.map((lane) =>
    headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM),
  );
  const clearance = params.vehicleLengthM + params.idm.minGapM;

  function signalAllows(id: number, movement: CMovement) {
    if (movement.neverGreen) return false;
    if (!compiled.nodes[movement.node]!.signal || colors[movement.idx] === GREEN) return true;
    const distance = compiled.lanes[movement.fromLane]!.lengthM - vehicles.position[id]!;
    return (
      colors[movement.idx] === AMBER && vehicles.speed[id]! ** 2 > 2 * params.idm.bMps2 * distance
    );
  }

  function release(id: number) {
    occupancy[grants[id]!] = occupancy[grants[id]!]! - 1;
    grants[id] = -1;
  }

  function signals(timeS: number) {
    updateSignals(compiled, timeS, colors);
    // A reservation cannot authorize entry after the light changes.
    for (let id = 0; id < vehicles.count; id++) {
      const idx = grants[id]!;
      if (idx === -1 || vehicles.lane[id]! < 0) continue;
      const movement = compiled.movements[idx]!;
      if (compiled.nodes[movement.node]!.signal && !signalAllows(id, movement)) release(id);
    }
  }

  function request(id: number, movement: CMovement) {
    if (
      compiled.nodes[movement.node]!.control === 'stop' &&
      movement.priority < 10 &&
      vehicles.stopped[id]! < 1 - 1e-9
    )
      return;
    const queue = candidates[movement.node]!;
    if (!queue.length) activeNodes.push(movement.node);
    queue.push(id);
  }

  function canGrant(id: number, movement: CMovement) {
    if (!signalAllows(id, movement)) return false;
    const exitTail = vehicles.last(movement.toLane);
    if (exitTail !== -1 && vehicles.position[exitTail]! < clearance) return false;
    const control = compiled.nodes[movement.node]!.control;
    for (const idx of movement.conflicts) {
      if (occupancy[idx]! > 0) return false;
      if (control !== 'yield' && control !== 'stop') continue;
      const higher = compiled.movements[idx]!;
      if (higher.priority <= movement.priority) continue;
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
          length - vehicles.position[approaching]! <
            vehicles.speed[approaching]! * params.intersection.gapS
        ) {
          return false;
        }
      }
    }
    return mergeAllows(id, movement);
  }

  const movementOf = (id: number) => compiled.movements[vehicles.movement[id]!]!;
  const compare = (a: number, b: number) =>
    movementOf(b).priority - movementOf(a).priority ||
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
        const priority = movementOf(queue[start]!).priority;
        let end = start + 1;
        while (end < queue.length && movementOf(queue[end]!).priority === priority) end++;
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
          occupancy[movement.idx] = occupancy[movement.idx]! + 1;
        }
        start = end;
      }
      queue.length = 0;
    }
    activeNodes.length = 0;
  }

  return { signals, request, resolve, release, grants, occupancy };
}
