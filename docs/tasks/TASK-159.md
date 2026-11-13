# TASK-159 — TASK-128 riders' car cost

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/159-rider-cost`, worktree `D:\cityflows-wt\159`, ports 5359 (production 5459).
It starts after TASK-154 (B56) has merged.

## Problem

TASK-128 (S-Bahn riders at Donnersbergerbrücke) merged onto main (`task/lead-128-remeasure`,
`7182dd9`) costs cars on every seed. Main completes 3,928 / 4,068 / 3,322 on seeds 1 / 2 / 3, and
the branch 3,481 / 3,405 / 3,191 (−11.4%, −16.3%, −3.9%), with gridlock 33, 45 and 52. Riders
themselves are served: 586 walks started by 10:00, 568 completed, 0 failed.

## Goal

1. Re-measure TASK-128 on main after TASK-154. If it passes the gate, report and stop; the lead
   merges it.
2. Otherwise find where riders cost cars: walker crossings near the station, zebra and signal
   waits, zone stops, or the loop. Repair the cause without dropping riders or changing their
   timetable.

## In scope

- `src/demand/stations.ts` and `rider-profile.ts`.
- Walker crossing behaviour in `src/sim/` (walkers, crossings, conflicts).
- Tests.

## Out of scope

- Intersection flow rules (TASK-154).
- Parking (TASK-153, TASK-156, TASK-157).
- The traffic gate and its floors. T53's 6% walker-cost limit stays.

## Gates

1. Munich seed-1 gate unchanged, with riders. Report seeds 2 and 3.
2. T65 and T53 pass. Riders 0 failed, with their counts unchanged.
3. `npm run check`, `test:city`, and `test:e2e:light` on port 5359.

## Report

Write it as the commit body: the mechanism, the fix, the gates, hashes moved, files touched, and
anything left open.
