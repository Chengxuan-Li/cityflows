# TASK-034 — Place painting and demand regeneration

Owner: unassigned
Gate: 3
Depends on: TASK-050 (the redesigned UI), TASK-011

## Goal

The player shapes demand directly on the map: paint a residential, work, retail or school
area, set how many people live or work there, connect it to the street, and regenerate the
population to see the new commute. This is the "place-paint workflow" of the brief.

## In scope

- `src/ui/tools/place-paint.tsx`: a Place tool in the floating toolbox; pick a kind, then
  drag on the map to paint a polygon (a soft brush that grows a shape, or click-to-outline;
  pick one and make it tactile); on release the place is created with a default
  population or jobs scaled by its area, and its first connector snapped to the nearest lane
  (`setConnectors` after `addPlace`). Dragging a connector handle re-snaps it. Painting
  over an existing place of the same kind extends it.
- Contextual controls on a selected place: population or jobs as a slider with the number,
  capacity, a connector list with add and remove. Reuse the inspector from TASK-050.
- "Regenerate demand" in the run controls' overflow: new seed, `generatePopulation` with
  the current places, trips rescheduled, run marked stale; the current seed shown so it can
  be typed back. Keeping the same seed regenerates deterministically.
- A compact demand readout when a place is selected: residents or jobs and the trips this
  place produces and attracts in the current schedule (from `demandSummary`).
- `tests/e2e/gate3-paint.spec.ts`: paint a work place on an empty block, regenerate, restart,
  assert vehicles arrive there (inspect shows the new place as a destination).

## Out of scope

- Hourly profiles and events (TASK-033), through traffic (TASK-030), polygon editing beyond
  extend and delete.

## Acceptance

- Painting creates a compiled place with a valid connector on the first try in the common
  case; the failure case (no lane within the snap distance) shows a short hint, never a
  dangling place.
- Regenerate changes the schedule and the stale banner appears; Restart replays it.
- `npm run check` and `npm run test:e2e` green; screenshots of painting and of the place
  controls.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with the tool, controls, regenerate action, e2e test and screenshots.
