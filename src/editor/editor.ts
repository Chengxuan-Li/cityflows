import { compile, type Diagnostic } from '../network';
import type { City, HistoryEntry, Patch } from '../schema';
import { dispatch } from './commands';
import { applyPatch, invertPatch } from './patch';
import type { CommitResult, Editor } from './types';

function displayOnly(patch: Patch): boolean {
  return (
    patch.markingTheme !== undefined &&
    !patch.metadata &&
    patch.nextId === undefined &&
    !Object.keys(patch.set).length &&
    !Object.keys(patch.remove).length
  );
}

export function createEditor(initialCity: City): Editor {
  const initial = compile(initialCity);
  if (!initial.ok) {
    throw new Error(
      `Cannot edit invalid city: ${initial.diagnostics.map(({ message }) => message).join('; ')}`,
    );
  }

  let city = initialCity;
  let compiled = initial.compiled;
  let diagnostics = initial.diagnostics;
  let history: readonly HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];

  function commit(patch: Patch, warnings: Diagnostic[] = []): CommitResult {
    const candidate = applyPatch(city, patch);
    if (displayOnly(patch)) {
      city = candidate;
      return { ok: true, city, compiled, diagnostics };
    }
    candidate.version = city.version + 1;
    const result = compile(candidate);
    if (!result.ok) return result;
    city = candidate;
    compiled = result.compiled;
    diagnostics = result.diagnostics;
    return { ok: true, city, compiled, diagnostics: [...result.diagnostics, ...warnings] };
  }

  return {
    get city() {
      return city;
    },
    get compiled() {
      return compiled;
    },
    get canUndoDisplayOnly() {
      return Boolean(history.at(-1) && displayOnly(history.at(-1)!.inverse));
    },
    get canRedoDisplayOnly() {
      return Boolean(redoStack.at(-1) && displayOnly(redoStack.at(-1)!.patch));
    },
    get history() {
      return history;
    },
    get canUndo() {
      return history.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    apply(command) {
      const { warnings, ...patch } = dispatch(city, command);
      const inverse = invertPatch(city, patch);
      const result = commit(patch, warnings);
      if (result.ok) {
        const label = command.kind === 'batch' ? command.label : command.kind;
        history = [...history, { label, patch, inverse, version: city.version }];
        redoStack.length = 0;
      }
      return result;
    },
    undo() {
      const entry = history.at(-1);
      if (!entry) return null;
      const result = commit(entry.inverse);
      if (result.ok) {
        history = history.slice(0, -1);
        redoStack.push(entry);
      }
      return result;
    },
    redo() {
      const entry = redoStack.at(-1);
      if (!entry) return null;
      const result = commit(entry.patch);
      if (result.ok) {
        redoStack.pop();
        history = [...history, entry];
      }
      return result;
    },
  };
}
