# TASK-045 — Gameplay acceptance demos and onboarding

Owner: lead or an agent under lead review
Gate: 4
Depends on: all Gate 1 to 4 tasks

## Goal

The brief's four acceptance demonstrations as deterministic Playwright scenarios with
recorded artifacts, and a minimal first-run orientation so a new user learns the loop without
documentation.

## In scope

- `tests/e2e/demo-a-commute.spec.ts`, `demo-b-airport.spec.ts`, `demo-c-bypass.spec.ts`,
  `demo-d-import-edit-share.spec.ts`, each producing a short video and a metrics JSON.
- `src/ui/onboarding.tsx`: a dismissible first-run hint sequence (choose a city, press play,
  click a car, edit a street, restart, compare) shown once; no tutorial engine, no modal
  walls.
- `docs/plan.md`: Gate 4 verification note.

## Acceptance

- Demo A: morning rush visible in metrics and heat; demo B: airport waves with a dedicated
  access road reducing the queue; demo C: expressway with interchange preferred by vehicles;
  demo D: import a fixture, fix a restriction, save ZIP, open it in a fresh browser context,
  replay with equal hashes.
- A user following only the hints completes the loop in the e2e test (the hints' targets
  exist and are clickable).

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with the demos, onboarding and artifacts linked from the plan.
