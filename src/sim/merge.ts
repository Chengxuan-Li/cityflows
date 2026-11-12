import type { CMovement, CompiledCity } from '../network';
import type { SimParams } from '../schema';
import { idmAcceleration } from './idm';
import { createVehicleProfiles, DRIVING, type Vehicles } from './vehicle';

export function createMerges(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  waitsForClearance: (id: number, ramp: number, movement: CMovement) => boolean = () => false,
) {
  const { idm, mobil, dtS } = params;
  const profiles = createVehicleProfiles(params);
  const profile = (id: number) => profiles[vehicles.vclass[id]!]!;
  const isRamp = (movement: CMovement) =>
    compiled.roads[compiled.lanes[movement.fromLane]!.road]!.roadClass === 'ramp';
  const remaining = (id: number, movement: CMovement) =>
    compiled.lanes[movement.fromLane]!.stopM - vehicles.position[id]!;
  function canStop(id: number, movement: CMovement) {
    const speed = vehicles.speed[id]!;
    // One step of travel is reserved because grants resolve after acceleration proposals.
    return (
      remaining(id, movement) - idm.minGapM >=
      speed * dtS + (speed * speed) / (2 * mobil.safeDecelMps2)
    );
  }
  function waitingRamp(candidate: number, movement: CMovement) {
    for (const idx of compiled.lanes[movement.toLane]!.in) {
      const other = compiled.movements[idx]!;
      if (other.turn !== 'merge' || other.neverGreen || !isRamp(other)) continue;
      const id = vehicles.first(other.fromLane);
      if (id === -1 || vehicles.state[id] !== DRIVING || vehicles.movement[id] !== idx) continue;
      const speed = vehicles.speed[id]!;
      if (
        remaining(id, other) <=
        Math.max(
          params.intersection.decisionDistanceM,
          (speed * speed) / (2 * profile(id).idm.bMps2) + idm.minGapM,
        )
      )
        if (!waitsForClearance(candidate, id, other)) return true;
    }
    return false;
  }
  function canEnter(id: number, movement: CMovement) {
    if (movement.turn !== 'merge') return true;
    const target = compiled.lanes[movement.toLane]!;
    const leader = vehicles.last(target.idx);
    if (leader !== -1) {
      const gap = vehicles.position[leader]! - profile(leader).lengthM;
      if (
        gap < idm.minGapM ||
        idmAcceleration(
          profile(id).idm,
          vehicles.speed[id]!,
          Math.min(target.speedLimitMps * vehicles.speedFactor[id]!, profile(id).maxSpeedMps),
          vehicles.speed[leader]!,
          gap,
        ) < -mobil.safeDecelMps2
      )
        return false;
    }
    // Signals already allocate the right of way; a ramp on red must not hold a green mainline.
    if (!isRamp(movement))
      return (
        !!compiled.nodes[movement.node]!.signal ||
        !waitingRamp(id, movement) ||
        !canStop(id, movement)
      );
    for (const idx of target.in) {
      const other = compiled.movements[idx]!;
      if (other.idx === movement.idx) continue;
      if (vehicles.first(-idx - 1) !== -1) return false;
      const follower = vehicles.first(other.fromLane);
      if (follower !== -1 && vehicles.movement[follower] === idx && !canStop(follower, other))
        return false;
    }
    return true;
  }
  function stopAcceleration(id: number, movement: CMovement) {
    const lane = compiled.lanes[movement.fromLane]!;
    return Math.max(
      -mobil.safeDecelMps2,
      idmAcceleration(
        profile(id).idm,
        vehicles.speed[id]!,
        Math.min(lane.speedLimitMps * vehicles.speedFactor[id]!, profile(id).maxSpeedMps),
        0,
        remaining(id, movement),
      ),
    );
  }
  return { canEnter, stopAcceleration };
}
