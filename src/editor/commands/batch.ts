import type { City, Command } from '../../schema';
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
  }
  return { ...diffCity(city, draft), warnings };
}
