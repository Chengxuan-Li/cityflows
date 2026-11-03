# TASK-044 — Performance and benchmark harness

Owner: unassigned (coordinates with whoever owns `src/sim` and `src/render` at the time)
Gate: 4 (can start right after Gate 1)
Depends on: TASK-003, TASK-004, TASK-005, TASK-006

## Goal

Measured numbers against the targets in architecture section 15, a repeatable benchmark,
and the optimizations those numbers justify. No optimization without a measurement.

## In scope

- `bench/sim.ts` (Node script run with `npm run bench`): steps per second on `grid5x5` with
  300 and 3 000 vehicles and on a generated 20 by 20 grid with 3 000 vehicles; routes per
  second; memory after a simulated day.
- `tests/e2e/T16-performance.spec.ts`: frame time distribution and achieved multiplier at
  10x on `grid5x5` and on the 20 by 20 grid, heap size before and after the morning peak;
  thresholds are soft (reported) except "no unbounded growth".
- Optimizations in `src/sim`, `src/routing`, `src/render` justified by the numbers:
  typically dense arrays for vehicles, sorted lane arrays with insertion instead of re-sorts,
  spatial LOD in the renderer, snapshot buffer reuse.
- `docs/plan.md`: a performance table with the measurements.

## Acceptance

- `npm run bench` prints a table; the e2e test produces a JSON report attached to CI.
- Targets of section 15 met or the gap documented with the next step.
- Determinism tests still pass after every optimization.

## Commands

`npm run check`, `npm run bench`, `npm run test:e2e`

## Deliverable

PR per optimization with before and after numbers.
