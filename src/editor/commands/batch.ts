import type { City, Command } from '../../schema';
import { compile } from '../../network';
import { applyPatch, diffCity } from '../patch';
import type { CommandPatch } from './types';

export function batch(
  city: City,
  commands: Command[],
  dispatch: (city: City, command: Command) => CommandPatch,
): CommandPatch {
  let draft = city;
  const warnings: NonNullable<CommandPatch['warnings']> = [];
  for (const command of commands) {
    const patch = dispatch(draft, command);
    draft = applyPatch(draft, patch);
    if (patch.warnings) warnings.push(...patch.warnings);
    // Preserve the first invalid draft so the editor rejects the entire batch,
    // even when a later member would repair or remove the invalid entity.
    if (!compile(draft).ok) break;
  }
  return { ...diffCity(city, draft), warnings };
}
