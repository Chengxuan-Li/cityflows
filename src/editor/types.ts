import type { CompiledCity, Diagnostic } from '../network';
import type { City, Command, HistoryEntry } from '../schema';

export type { Command, HistoryEntry, Patch } from '../schema';

export type CommitResult =
  | { ok: true; city: City; compiled: CompiledCity; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export interface Editor {
  readonly city: City;
  readonly compiled: CompiledCity;
  apply(command: Command): CommitResult;
  undo(): CommitResult | null;
  redo(): CommitResult | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly history: readonly HistoryEntry[];
}
