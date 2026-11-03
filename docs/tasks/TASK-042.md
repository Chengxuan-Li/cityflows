# TASK-042 — Scenario comparison

Owner: unassigned
Gate: 4
Depends on: TASK-008, TASK-041

## Goal

Baseline versus variant with the same seed and demand, so the player can see what an edit
did: mean travel time, 90th percentile delay, failed trips, per-road usage difference.

## In scope

- `src/project/scenarios.ts`: a variant is a `Scenario` plus a `cityVersion` reference; the
  project stores the baseline `City` snapshot and the current city; switching restores the
  editor to the chosen snapshot.
- `src/ui/panels/compare.tsx`: "Save as baseline", "Run comparison" (runs both scenarios in
  the worker sequentially to `endS`, shows progress), results table, and a per-road
  difference layer (usage up or down).
- `src/host`: a `runHeadless` request that runs a loaded scenario to the end and returns the
  metrics series and per-road totals without snapshots.
- `tests/e2e/gate4-compare.spec.ts`.

## Acceptance

- Same city and seed compared with itself gives identical numbers (proof the comparison is
  controlled).
- e2e: ban a turn, run comparison, assert the table shows different mean travel time and the
  difference layer highlights at least one road.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with panel, host request, project changes and e2e test.
