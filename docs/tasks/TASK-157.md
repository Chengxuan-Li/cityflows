# TASK-157 — Lot exits bound for the far lane: hold clear of the near lane, grant both

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/157-far-lane-exits`, worktree `D:\cityflows-wt\157`, ports 5357 (production 5457).
Queued on 2026-11-13. It starts once TASK-153 has merged, in parallel with TASK-156.

## Problem

TASK-150's hold is the farthest drive-out pose clear of the *exit* lane. A car whose exit is the
far lane of a two-way street therefore holds inside the near lane: Munich 333 bay-to-exit pairs,
Sindelfingen 1,749, mostly pk:1476. Its grant also checks only the far lane's gap, so it cuts
across near-lane traffic without a gap of its own.

## Goal

Before a lot car merges into a far lane:
- it holds clear of every lane it must cross;
- it is granted only when the near lane has a crossing gap and the far lane has its merge gap;
- it reserves both while it crosses.

A crossing car counts as an obstacle for the near lane's followers during its crossing. Through
traffic keeps priority, and no follower brakes harder than the existing insertion limit.

## In scope

- `src/sim/parking.ts`: the hold, the grant and the merge phase.
- `src/sim/manoeuvre.ts`.
- `src/sim/engine.ts`: the exit callback and the gap checks.
- Tests.
- `docs/architecture.md` section 8.

Coordinate with TASK-156, which runs in parallel on lot geometry and the arrival path.

## Out of scope

- Intersections and flow (TASK-154).
- Gateway demand (TASK-155).
- The traffic gate and its floors.

## Gates

1. A census in both cities: holds inside a lane the car must cross go from 333 and 1,749 to 0.
2. A focused regression test:
   - a far-lane exit waits while either lane is occupied;
   - it crosses with no body overlap;
   - near-lane followers stay within the braking limit;
   - it completes.
3. T77, T78, T54, T59, T63 and the lot-access city test pass.
4. Munich seed-1 gate unchanged. Report seeds 2 and 3.
5. `npm run check`, `test:city`, and `test:e2e:light` on port 5357.
6. Shots of a far-lane exit, before and after, saved to `D:\cityflows-wt\157-evidence\`.

## Report

Write it as the commit body: the rule, the census, the gates, hashes moved and why, files touched,
and anything left open.
