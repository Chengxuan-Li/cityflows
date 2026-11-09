import type { Metrics } from './types';
import type { Vehicles } from './vehicle';
import type { Walkers } from './walkers';
import type { createPersons } from './persons';

// Hash signed or unsigned fields as four little-endian bytes.
function word(hash: number, value: number): number {
  for (let i = 0; i < 4; i++) {
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193);
    value >>>= 8;
  }
  return hash;
}

export function stateHash(
  timeS: number,
  vehicles: Vehicles,
  trips: Metrics['trips'],
  parking?: number,
  walkers?: Walkers,
  persons?: ReturnType<typeof createPersons>,
): number {
  let hash = word(0x811c9dc5, Math.round(timeS * 10));
  for (let id = 0; id < vehicles.count; id++) {
    if (Number.isNaN(vehicles.departed[id])) continue;
    hash = word(hash, id + 1);
    hash = word(hash, vehicles.lane[id]!);
    hash = word(hash, Math.round(vehicles.position[id]! * 100));
    hash = word(hash, Math.round(vehicles.speed[id]! * 100));
  }
  for (const count of [
    trips.pending,
    trips.queuedOrigin,
    trips.driving,
    trips.queuedDestination,
    trips.completed,
    trips.failed,
  ]) {
    hash = word(hash, count);
  }
  if (parking !== undefined) hash = word(hash, parking);
  // TASK-111: walkers enter the hash only once one has spawned.
  if (walkers?.spawned) hash = walkers.hash(word, hash);
  if (persons) hash = persons.hash(word, hash);
  return hash >>> 0;
}

export function parkingHash(fields: readonly (Uint32Array | Int32Array)[]): number {
  let hash = 0x811c9dc5;
  for (const values of fields) for (const value of values) hash = word(hash, value);
  return hash >>> 0;
}
