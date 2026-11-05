# TASK-073 — Exercise the paths nobody has run end to end

Owner: unassigned
Gate: 5 (review-log gaps since TASK-021, TASK-043, TASK-067)
Depends on: TASK-067, TASK-069, TASK-070. No contract change.

## Goal

Several user paths have never been run end to end: the area picker downloading from
Overpass and reusing its cache (only unit-tested with a stubbed fetch), the CSV and GeoJSON
exports (never downloaded and opened), a real-city project saved and reopened after the
recent importer changes, the app on a phone-sized screen, and the published Pages build.
Write the scenarios that exercise them, and report every defect they find.

## In scope

- `tests/e2e/qa-*.spec.ts` (new files), helpers in `tests/e2e/helpers.ts` (additive; TASK-069's
  `clickVehicle` is there), recorded Overpass responses as fixtures under
  `tests/e2e/fixtures/` (derived from bundled OSM data, attribution kept).
- Scenarios:
  1. Area picker → Import with Overpass answered by `page.route` from a recorded response;
     diagnostics, accept, run; the same area again comes from the cache ("Loaded from
     cache"); a failed response shows an error and leaves the current city alone.
  2. Every export after a short run: trips, road metrics and trajectories CSVs and the
     GeoJSON download; each parses, has the documented columns or feature counts, and
     carries the synthetic-traffic provenance line.
  3. Munich imported, edited once (a live edit), saved, reopened in a fresh browser context;
     same city version and same state hash after the same steps; smoothing and realignment
     provenance survive.
  4. A 390 × 844 viewport: open, play, select a car, a street and a junction, open each
     run-bar sheet, import a small file; nothing a scenario needs is covered or off-screen.
  5. A production build with the Pages base path (`CITYFLOWS_BASE_PATH=/cityflows/`) served by
     `npm run preview`: the app loads, the grid plays, `window.cityflows` is undefined, every
     request stays under the base path (a separate Playwright project or config is fine).
- Fixes: none in `src`. Each defect goes in the report with steps, ids and the scenario that
  shows it, and the scenario is marked `test.fixme` with a one-line reason so the suite stays
  green.

## Out of scope

- Every file under `src`, `.github`, `vite.config.ts` (TASK-071 and TASK-072 run in parallel in
  `src/network`, `src/sim` and `src/render`), the existing scenarios except helpers.

## Acceptance

- The new scenarios pass, or are `test.fixme` with a reported defect each.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npm run build`, `npm run preview`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): each scenario and
its result, every defect with steps and ids, and the final lines of `npm run check`. Commit
your work in a git worktree of this repository; the lead reviews only commits.
