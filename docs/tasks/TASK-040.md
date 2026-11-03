# TASK-040 — Signal editor

Owner: unassigned
Gate: 4
Depends on: TASK-010

## Goal

A readable signal program editor: phases on a timeline, movement groups per phase shown as
arrows on the intersection, conflict warnings as you edit, amber and all-red, offset, and a
preview of the active phase on the map while the run plays (T13 through the UI).

## In scope

- `src/ui/inspector/signal.tsx`: timeline with draggable phase durations, add and remove
  phases, per-phase movement group toggles drawn on a schematic of the node, inline conflict
  detection (uses `compile` diagnostics on a trial city before commit), "generate default
  program" button (same generator as the importer).
- `src/render/layers/signal-preview.ts`: the current green movements highlighted at the
  selected node during a run.
- `tests/e2e/gate4-signals.spec.ts`.

## Acceptance

- Toggling a conflicting movement into a phase shows the conflict and the commit button is
  disabled until resolved; a valid program commits and the restart banner appears.
- Preview shows green arrows matching the engine's phase at the current time (compare with
  `window.cityflows.metrics().timeS` and the compiled signal tables in the test).
- e2e: shorten the main-street phase, restart, assert the queue metric on the side street
  decreases.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with editor, preview, e2e test and screenshots.
