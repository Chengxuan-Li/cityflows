# TASK-158 — TASK-129's extra gridlock (conditional)

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/158-household-gridlock`, worktree `D:\cityflows-wt\158`, ports 5358 (production 5458).
This task runs only if TASK-129 still fails the gate after TASK-154 (B56) has merged.

## Problem

TASK-129 (household car ownership) merged onto main, in the lead's candidate
`task/lead-129-merge`, gives 4,091 completed, 44 gridlocked, 0 stalled heads and 0 parking
failures at seed 1. Main gives 3,903 / 36. It fails only the gridlock limit, 39. In the default
scenario every resident owns a car, so the trips are main's and only the starting spaces change:
cars start within 400 m of home.

## Goal

Trace where the extra gridlocks form and why moved starting stock creates them: which roads,
which lots, and which departures. Then fix the cause within TASK-129's scope or in parking start
allocation. If the extra gridlock is seed noise on a congested corridor that TASK-154 didn't
drain, report the evidence and stop.

## In scope

- `src/demand/**` households and car stock.
- Initial stock allocation in `src/sim/parking.ts`.
- Tests.

## Out of scope

- Intersections and flow (TASK-154).
- Parking admission and holds (TASK-153, TASK-157).
- The traffic gate and its floors.

## Gates

1. Munich seed-1 gate unchanged, on main with TASK-129 and the fix merged.
2. Seeds 2 and 3 reported.
3. T67 and the parking tests pass.
4. `npm run check`, `test:city`, and `test:e2e:light` on port 5358.

## Report

Write it as the commit body: the mechanism with ids and times, the fix, the gates, hashes moved,
files touched, and anything left open.
