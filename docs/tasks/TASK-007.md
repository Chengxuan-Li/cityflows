# TASK-007 — Editor core

Owner: unassigned
Gate: 1
Depends on: TASK-001

## Goal

Transactional editing of a `City` through commands that produce patches with inverses,
validated by compile before commit, with undo and redo, as in architecture section 6.
Gate 1 needs the attribute, rule, control, signal and place commands; topology commands come
in TASK-022 but the command union and patch machinery are complete here.

## In scope

- `src/editor/`: `editor.ts` (`createEditor(city): Editor`), `patch.ts` (apply, inverse
  capture, structural sharing), `commands/index.ts` (dispatch), `commands/road.ts`
  (`setRoadLanes`, `setRoadAttributes`, `reverseRoad`, `setStreetDirection`),
  `commands/node.ts` (`setTurnRule`, `clearTurnRule`, `setControl`, `setSignal`),
  `commands/place.ts` (`addPlace`, `updatePlace`, `setConnectors`, `deletePlace`),
  `commands/batch.ts` (`batch` as one history entry).
- `tests/editor/`.

## Out of scope

- `addRoad`, `deleteRoad`, `splitRoad`, `moveNode` (TASK-022): leave them in the union and
  make dispatch throw `not implemented: <kind>` for them.
- UI (TASK-010).

## Interfaces

`Command`, `Patch`, `HistoryEntry`, `CommitResult`, `Editor` from section 6.

## Acceptance tests

- `tests/editor/T12-attributes.test.ts`: for each Gate 1 command on `grid5x5`, apply then
  undo gives a city deep-equal to the original except `version`; redo reproduces the edited
  city; `history` has one entry per commit with the label.
- `tests/editor/T04-ban-turn.test.ts`: `setTurnRule` with `allowed: false` removes the
  movement from `editor.compiled`; `clearTurnRule` restores it.
- `tests/editor/rejection.test.ts`: a command whose result has a structural error (a signal
  with conflicting groups) returns `{ ok: false }` with `signal_conflict`, and city, compiled
  and history are untouched; a command producing only warnings commits.
- `tests/editor/street-direction.test.ts`: `setStreetDirection` to one road deletes the other,
  removes its turn rules and connectors referencing it (reported as warnings), sets
  `lateralOffsetM` to 0; `'both'` recreates the opposite road with a mirrored centerline and
  the default offset.
- `tests/editor/lanes.test.ts`: reducing lane count clamps connectors to the outermost lane
  with a warning and drops lane-level rules that referenced removed lanes.

## Commands

`npm run check`

## Deliverable

PR with editor and tests.

## Integration notes

`Editor.compiled` is what the UI renders and what gets sent to the worker on restart. Keep
`apply` synchronous; compile of `grid5x5` must stay well under a frame.
