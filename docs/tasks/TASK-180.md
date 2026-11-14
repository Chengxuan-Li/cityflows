# TASK-180 — Full-demand throughput and the actuation default

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/180-throughput`, worktree
`D:\cityflows-wt\180`, ports 5380 / 5480. It starts after TASK-176 is on main.

## Goal

Two findings from TASK-176 (2026-11-14):

1. **Full demand completes fewer trips since the queue merge.** On munich-full-demand, a183a0b
   completed 3,579 trips at a peak of 4,544 driving; main after TASK-166 to 170 and 174 completes
   2,460 (269 failed) at a peak of 5,191. The 0.15 gate does not see it. Find which merge or
   rule causes the drop (bisect TASK-169 keep clear, TASK-170 actuation, TASK-174 transit and
   TASK-179 by turning each off where a flag exists, or by commit), and why: where the queues
   form (lots, keep-clear stands, rail crossings, signals), with counts.
2. **Actuation's default.** TASK-170's contract made actuation "on by default if it measures
   better". TASK-170 measured it against a base with keep clear (seeds 1 to 6), but TASK-176 found
   that on seed 1 actuation raises mean delay (836 s against 727 s with it off) and adds 12% more
   vehicle-steps. Measure actuated against fixed-time generated programs on current main: Munich
   0.15 seeds 1 to 6, choice off and on, and full demand: completed, gridlocked, mean delay, the
   drain criterion (TASK-154). Keep the default that measures better.

Fix what the diagnosis supports, within the rules: keep TASK-169's and TASK-170's behaviour unless
the numbers show a defect, and say which rule you changed and why. A change of default is a
one-line change in `src/network/signal-program.ts` plus re-pinned hashes.

## Scope

Diagnosis scripts, `src/sim/**`, `src/network/signal-program.ts`, and the tests and pins that move.

## Gates

- Munich 0.15 seeds 1 to 6 and full demand, before and after, in one table.
- The gate (choice off) and the mode-share guard; the drain criterion on all six seeds.
- If completions at 0.15 move by more than 10%, say so: the lead resets the baseline.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the diagnosis with numbers, what changed, hashes, anything left open.
