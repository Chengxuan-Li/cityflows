import { compile, type CompileResult, type Diagnostic } from '../network';
import { compileAirside } from '../network/airside';
import { addImplicitGarages } from '../network/parking';
import type { City, HistoryEntry, Patch } from '../schema';
import { airportSchema } from '../schema/airport.schema';
import { dispatch } from './commands';
import { applyPatch, diffCity, invertPatch } from './patch';
import type { CommitResult, Editor } from './types';

/** TASK-305: a patch that edits the airport alone recompiles only the airside: nothing else in
 * the compiled city reads the section (architecture section 5.7). */
function airportOnly(patch: Patch): boolean {
  return (
    patch.airport !== undefined &&
    patch.markingTheme === undefined &&
    !patch.metadata &&
    !Object.keys(patch.set).length &&
    !Object.keys(patch.remove).length
  );
}

function displayOnly(patch: Patch): boolean {
  return (
    patch.markingTheme !== undefined &&
    !patch.metadata &&
    !patch.airport &&
    patch.nextId === undefined &&
    !Object.keys(patch.set).length &&
    !Object.keys(patch.remove).length
  );
}

/** `precompiled`, when given, is `compile(initialCity)` already done by the caller (TASK-198:
 * the landing city compiles once on load); it is used unless implicit garages change the city. */
export function createEditor(initialCity: City, precompiled?: CompileResult): Editor {
  const materialized = { ...initialCity, parking: { ...initialCity.parking } };
  addImplicitGarages(materialized);
  const changed = materialized.nextId !== initialCity.nextId;
  if (changed) initialCity = materialized;
  const initial = precompiled && !changed ? precompiled : compile(initialCity);
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
    // TASK-305: an airport edit must leave a section the project schema accepts.
    if (patch.airport) {
      const check = airportSchema.safeParse(candidate.airport);
      if (!check.success)
        return {
          ok: false,
          diagnostics: check.error.issues.map(({ path, message }) => ({
            severity: 'error' as const,
            code: 'airport_invalid',
            refs: path.filter((part) => typeof part === 'string' && part.includes(':')) as string[],
            message: `Airport ${path.join('.')}: ${message}`,
          })),
        };
    }
    if (airportOnly(patch)) {
      city = candidate;
      compiled = {
        ...compiled,
        version: candidate.version,
        airside: compileAirside(candidate.airport!, candidate, compiled),
      };
      return { ok: true, city, compiled, diagnostics: [...diagnostics, ...warnings] };
    }
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
      const { warnings, ...requested } = dispatch(city, command);
      const draft = applyPatch(city, requested);
      const materialized = { ...draft, parking: { ...draft.parking } };
      addImplicitGarages(materialized);
      const patch = materialized.nextId === draft.nextId ? requested : diffCity(city, materialized);
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
