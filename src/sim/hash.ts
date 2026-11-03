import type { Metrics } from './types';
import type { Vehicles } from './vehicle';

// Hash signed or unsigned fields as four little-endian bytes.
function word(hash: number, value: number): number {
  for (let i = 0; i < 4; i++) {
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193);
    value >>>= 8;
  }
  return hash;
}

export function stateHash(timeS: number, vehicles: Vehicles, trips: Metrics['trips']): number {
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
  return hash >>> 0;
}
