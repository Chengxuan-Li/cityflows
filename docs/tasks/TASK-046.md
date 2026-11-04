# TASK-046 — Simulation hotspots from the TASK-044 profile

Owner: unassigned
Gate: 4
Depends on: TASK-044, TASK-032

## Goal

Spend the engine time where the profile says it goes. TASK-044 measured the engine but was
not allowed to touch `src/sim` while TASK-032 owned it; its profile (plan.md, Performance,
hotspot table) is the brief. Every change is justified by a before and after number from
`npm run bench` and keeps T02 determinism bit for bit.

## In scope

- `src/sim/reroute.ts` and its call in `src/sim/engine.ts`: the reroute check scans every
  trip every step (50 to 70 percent of engine time on the grid and the town). Keep only due,
  driving vehicles to visit, for example a time-ordered queue of next-check times, preserving
  id order among equal times and the existing stagger, so routes and hashes are unchanged.
- `src/sim/engine.ts` travel preparation: measure an ordered active-vehicle list against the
  scan over all lane and movement heads before changing it.
- `src/sim/lane-change.ts`: fewer per-vehicle temporary arrays and closures in proposals,
  same MOBIL decisions.
- `src/host/headless.ts` (comparison runs) and `src/host/export-data.ts` (export recorder):
  both inspect or snapshot vehicles per step or per second; make them read what they need
  from the engine without per-vehicle `inspect` calls.
- The stress grid (bench workload `grid5x5-stress`, seed 1) strands one trip over the day;
  find why and fix it in the engine if it is an engine defect, or report it with a minimal
  reproduction if it is a demand or fixture artefact.
- `bench/`: only what the measurements need.

## Out of scope

- Renderer, UI, editor, importers. New SimParams. Any change to routing results, lane-change
  decisions or hashes: the tests below are the gate.

## Acceptance

- `npm run bench` before and after each change, numbers in the commit message; the normal
  grid and the town both gain at least 30 percent on 24 h steps per second overall.
- T02, T03, T04, T06, T07, T10, the town tests and the full unit suite pass unchanged;
  `tests/e2e/gate4-compare.spec.ts` and the export tests pass.
- `npm run check` green; the Performance table in `docs/plan.md` gets an "after TASK-046"
  row set.

## Commands

`npm run check`, `npm run bench`, `npx playwright test tests/e2e/gate4-compare.spec.ts`

## Deliverable

One commit per optimization with before and after numbers, and the updated table.
