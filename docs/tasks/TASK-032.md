# TASK-032 — Ramps, merging and expressway construction

Owner: unassigned (sequenced with any other `src/sim` task)
Gate: 3
Depends on: TASK-004, TASK-022

## Goal

Players build expressways with on-ramps and off-ramps that vehicles actually use, and
merging behaves plausibly: T07 in full and the handoff's demo C.

## In scope

- `src/sim/merge.ts`: at `merge` movements, gap acceptance against the target lane with
  cooperative deceleration of the mainline follower within MOBIL's safety bound; lane-drop
  handling (vehicles in a dropped lane treated as mandatory changers before the drop).
- `src/editor/commands/ramp.ts`: `addRamp` from a point on a road (splits it, creates a
  `diverge` at the split node) to a point on another road (splits it, creates a `merge`),
  class `ramp`, one lane, speed from the target class; the inverse removes the ramp and
  re-merges the split roads.
- `src/ui/tools/ramp.tsx`: pick start on a road, pick end on a road, preview, confirm.
- `src/fixtures/ramp.ts` adjustments if needed; `tests/sim/T07-lane-aware-ramp.test.ts`
  (full), `tests/editor/ramp.test.ts`, `tests/e2e/gate3-bypass.spec.ts`.

## Acceptance

- T07: on `ramp`, every mainline entry from the on-ramp happens through the merge movement
  with a safe gap; no mainline vehicle decelerates below `-safeDecelMps2` because of a merge;
  exiting vehicles are in the exit lane before the diverge; nothing is stranded.
- Editor: `addRamp` then undo restores the city deep-equal except `version`.
- e2e (demo C): on `grid5x5`, draw a two-lane expressway across the grid with an on-ramp and
  an off-ramp, restart, and assert that at least 20 percent of inspected vehicle routes use
  the expressway and that the mean travel time metric decreases against the baseline run.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with merge behavior, ramp command and tool, tests and a screenshot of a built
interchange.
