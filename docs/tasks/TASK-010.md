# TASK-010 — Editing UI and restart policy

Owner: unassigned (sequential after TASK-009 in `src/ui`)
Gate: 1
Depends on: TASK-007, TASK-009

## Goal

The user changes the network and controls from the inspector and sees the consequence after
a restart: Gate 1 checklist items 5 and 6, and the T17 edit-while-running policy.

## In scope

- `src/ui/inspector/street.tsx`: lane count per direction, speed limit, street direction
  (both, one way each direction), road class; edits dispatch editor commands.
- `src/ui/inspector/node.tsx`: control type; turn toggles rendered as the node's road pairs
  with per-lane arrows that can be clicked to allow or ban (writes `TurnRule`s); signal phase
  durations, amber and all-red editable in place; validation errors from a rejected commit
  shown inline, with the commit refused.
- `src/ui/inspector/place.tsx`: population, jobs, capacity, connector throughput.
- `src/ui/run-bar.tsx`: when `editor.city.version` is ahead of the loaded run, pause the run
  (if playing) and show "Restart to apply changes" with a Restart button; the old run stays
  paused and inspectable until restart. Regeneration of trips on restart uses the same seed.
- `src/ui/top-bar.tsx`: Undo and Redo wired.
- `tests/e2e/gate1-edit.spec.ts`.

## Out of scope

- Drawing roads (TASK-022), batch selection (TASK-023), the full signal editor (TASK-040),
  place profiles and events (TASK-033).

## Acceptance

- T17 (e2e): while playing, ban a turn: the run pauses, the banner appears, vehicles stay
  where they were; Restart reloads with the edited network and the banner clears.
- Behavior change (e2e): on `grid5x5`, ban the turn that the vehicle route of the first
  departing trip uses (read via `window.cityflows.inspect`), restart, step the same number of
  steps, and assert that no inspected route contains the banned movement and that the state
  hash differs from the pre-edit run.
- Signal timing (e2e): set one phase to 5 s, restart, and assert the queue count metric at a
  fixed time differs from the baseline.
- Undo after a rejected commit leaves the history unchanged; undo after a successful commit
  restores the inspector values.
- `npm run check` and `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with the inspectors, run-bar policy, e2e test and screenshots of the street and node
inspectors.
