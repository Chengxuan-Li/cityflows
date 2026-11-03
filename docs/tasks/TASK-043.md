# TASK-043 — Analysis and interchange exports

Owner: unassigned
Gate: 4
Depends on: TASK-008, TASK-041

## Goal

The brief's three export classes: project exchange (done in TASK-008), interoperability
(GeoJSON from TASK-025 plus a CSV trip list), and analysis (per-road metrics, travel time
distribution, vehicle trajectories sampled every 10 s), all labelled synthetic with seed,
engine version, schema version and time step.

## In scope

- `src/project/export-csv.ts`: trips (id, person, origin, destination, departure, arrival,
  travel time, delay, fail reason), per-road metrics (id, name, class, length, mean speed
  ratio, vehicles passed, max queue), trajectories (vehicle id, time, x, y, lane, speed).
- `src/host`: a `trajectories` toggle that records samples during a run when enabled.
- Export menu entries with file names carrying the project name and scenario.
- `tests/project/export-csv.test.ts`.

## Acceptance

- Each CSV opens in a spreadsheet with a header row; the first line of every file is a
  comment with the synthetic notice and provenance.
- Trip CSV row count equals the trips loaded; delays are non-negative; trajectories exist
  only when the toggle was on.

## Commands

`npm run check`

## Deliverable

PR with exporters, menu entries and tests.
