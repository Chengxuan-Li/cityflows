# TASK-023 — Multi-select and batch editing

Owner: unassigned
Gate: 2
Depends on: TASK-022

## Goal

Select many streets at once and change lanes, speed, class or direction in one undoable step,
as the brief's batch editing requires (R8).

## In scope

- `src/ui/selection/`: shift-click to add, box select on the map (drag with the Select tool
  while holding Shift), selection summary in the inspector (count by class).
- `src/ui/inspector/batch.tsx`: fields apply to all selected streets; mixed values shown as
  such; apply dispatches one `batch` command.
- `src/editor/commands/batch.ts`: already in the union; ensure one history entry and
  all-or-nothing commit (a structural error anywhere rejects the whole batch).
- `tests/editor/batch.test.ts`, `tests/e2e/gate2-batch.spec.ts`.

## Acceptance

- Headless: a batch of 20 lane-count changes is one history entry; undo restores all; a batch
  containing one invalid command commits nothing.
- e2e: box-select a block of streets, set speed limit, assert the street inspector of one of
  them shows the new value and that undo restores the old one.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with selection, batch inspector and tests.
