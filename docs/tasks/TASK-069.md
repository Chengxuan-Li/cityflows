# TASK-069 — Notes instead of warnings, and a deterministic vehicle pick

Owner: unassigned
Gate: 5 (backlog B22, and the e2e pick flake seen in demo B)
Depends on: TASK-055, TASK-058. Design: `docs/architecture.md` section 5.5 (the TASK-069
`info` severity, the badge and the "Notes" group). Read it before the code.

## Goal

The bundled grid opens with "Validation (15)": fifteen `lane_requires_merge` diagnostics
where two-lane streets narrow to one. That is how roads are built, not a problem, and it
teaches a new player to ignore the badge. Make such facts notes: a third severity, `info`,
listed last under "Notes" and not counted in the badge. Separately, e2e scenarios pick a car
by clicking where it was computed to be, which missed once in demo B (wave 11): give the
suite one helper that picks a vehicle deterministically through the real click path.

## In scope

- `src/network/types.ts` (`Diagnostic.severity` adds `'info'`), `src/network/diagnostics.ts`
  (`lane_requires_merge` is an info; a small `info` helper beside `warn`).
- `src/ui`: the run bar's Validation badge counts errors and warnings only; the diagnostics
  panel lists infos last under "Notes"; the import wizard's diagnostics step shows infos
  last and never counts them as warnings; anything else that groups by severity.
- `src/project` only if a saved file carries severities (check; most likely nothing).
- `tests/e2e/helpers.ts`: `clickVehicle(page, id)` that pauses the run, reads the vehicle's
  position from the snapshot the renderer last drew (not from a computed lane position), clicks
  it through the map, and waits for the Vehicle inspector, retrying the click at most once
  after the next frame; use it wherever a scenario clicks a car (demo B, onboarding, and any
  other).
- Tests: a unit test for the severity split and the badge count, the e2e scenarios that read
  "Validation (n)" or click cars, the warning-count table in `tests/importers/munich.test.ts`
  (counts change because `lane_requires_merge` is no longer a warning; TASK-068 may also change
  that table; the lead reconciles it at merge).

## Out of scope

- `src/importers` (TASK-068 runs in parallel there), `src/sim`, `src/routing`, `src/render`,
  the grid fixture's geometry, diagnostics other than `lane_requires_merge`.

## Acceptance

- The bundled grid opens with "Validation (0)" and its panel lists 15 notes; Munich's import
  wizard shows its warnings without the `lane_requires_merge` lines and lists them as notes.
- Every scenario that clicks a car uses `clickVehicle`; demo B passes ten runs in a row
  (`npx playwright test demo-b --repeat-each 10` on a port of your own).
- The four benchmark hashes unchanged; `npm run check` green; `npm run test:e2e` green on a
  port of your own (T16 may be skipped: owner decision).
- Seen in the browser: the grid's badge and notes, and a Munich import's diagnostics step.

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npx playwright test demo-b --repeat-each 10`, `npm run bench`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, the
scenarios changed, the repeat run, what you saw in the browser, and the final lines of
`npm run check`. Commit your work; the lead reviews only commits.
