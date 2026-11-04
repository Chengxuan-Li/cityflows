# TASK-053 — Import demand scale

Owner: unassigned
Gate: 5 (owner backlog B13)
Depends on: TASK-021, TASK-048

## Goal

An imported city runs at a demand it can carry. Today the import wizard gives every import
the grid's default scenario at one person per resident (`src/ui/import/wizard.tsx`,
`accept()`), and the Munich reference extract then gridlocks: 30 818 trips still queued at
their origin at 10:00 (plan, "Reference extract and import baseline", TASK-048 column). The
wizard needs a default scale around 0.3 and a control to change it, and the probe needs to
measure at a scale.

## In scope

- `src/ui/import/wizard.tsx` and `src/ui/import/diagnostics-step.tsx`: on the accept step a
  "Demand" range input (0.05 to 1, step 0.05, default 0.3) with a readout of residents ×
  scale = persons, written to `scenario.demand.personsPerResident`; the scenario is otherwise
  the grid default as now. Label and readout in the house style (no explanatory paragraph).
- `bench/import-probe.ts`: an optional `--scale <n>` argument (default 1 so the baseline
  table stays comparable); print the scale with the results.
- `tests/e2e/gate2-import.spec.ts`: additively, the slider defaults to 0.3 and the saved
  scenario carries that value; moving the slider changes the persons readout.
- `src/ui/app.css`: additive block for the control if needed.

## Out of scope

- The importer, the demand model, the bundled fixtures (grid and town stay at 1), the
  Demand panel's regenerate control (it already edits the seed; a scale there is a later
  task).

## Acceptance

- Munich probe at `--scale 0.3`: zero failed trips, every connector pair routable, and the
  origin queue at 10:00 under a quarter of released trips. If 0.3 still gridlocks, find the
  largest scale in steps of 0.05 that passes, make it the default, and say so in the PR.
- The PR carries the probe table at scale 1 and at the default, and the demo D scenario
  still passes with the new default.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.3`

## Deliverable

PR with the wizard control, the probe argument, the e2e additions and both probe tables.
