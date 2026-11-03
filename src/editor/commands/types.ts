import type { Diagnostic } from '../../network';
import type { Patch } from '../../schema';

export interface CommandPatch extends Patch {
  warnings?: Diagnostic[];
}

export function requireEntity<T>(entities: Record<string, T>, id: string): T {
  const entity = entities[id];
  if (!entity) throw new Error(`Unknown entity: ${id}`);
  return entity;
}
