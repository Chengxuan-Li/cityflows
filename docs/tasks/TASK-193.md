# TASK-193 — The jam ring behind jg:10802

Status: approved by the owner 2026-11-17; in progress. Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/193-jam-ring`, worktree `D:\cityflows-wt\193`, ports 5394 / 5494.

## Goal

TASK-188 found that the slow Landsberger loop visits (seed 6 actuated 1,042 s; fixed-time seed 7 933 s,
actuated seed 10 942 s, all over TASK-154's 900 s drain limit) are not the loop's exit. They are
spill-back from jg:10802, about 400 m down r:639. Lane 0 of r:639 has a single movement; its head cars,
going round the group to r:663, were held "exit-full" for up to 1,755 s, and the through traffic waited
behind them. r:663 drains into a ring of about 1.5 km (r:679/r:735, r:1258, jg:10784, r:264, n:263, where
it meets the loop's exit r:703). In both signal modes about half the cars entering r:676 and r:663 had
been rerouted (missed turns, mostly TASK-121 queue-head detours), and they fed the ring (plan.md,
TASK-188 review).

1. Confirm the mechanism on main, then fix it at the cause. Two candidates from TASK-188 (pick by
   evidence; others are fine if the evidence points elsewhere):
   - a detour (TASK-121 head detour or a missed-turn reroute) should not choose a route that leads back
     into the queue it is leaving or through the ring it feeds;
   - the exit-full hold at a group entry (`blockedExit` in `src/sim/intersection.ts`) on a lane with a
     single movement, where the held head blocks everything behind it.
2. Show the ring no longer forms: seeds 1 to 12, choice off and on, fixed-time and actuated.

## Scope

`src/sim/**` (detours, rerouting, intersection holds), tests, the TASK-121 paragraph of
`docs/architecture.md` if its rule changes.

Out of scope: `src/schema`, signal timing and the generated default (TASK-194), gate floors,
`bench/traffic-baseline.json`, the city data.

## Gates

- Seeds 1 to 12, choice off and on, fixed-time and actuated: completed / gridlocked / stalled / mean
  delay / worst loop visit, main against branch. TASK-154's 900 s criterion on all of them in both modes
  is the target; report any seed that still fails and why.
- Full demand, fixed-time and actuated: completed at least main's (fixed-time 3,069 / 165, hash
  2427576212; actuated 2,814).
- Munich gate and mode-share guard; a unit test for the rule you change.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- If completions at 0.15 move more than 10%, the baseline reset rule applies (report it; the lead logs
  it).

## Report

Write it as the commit body.
