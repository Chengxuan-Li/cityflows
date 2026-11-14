# TASK-179 — Full-tier specs after the queue merge

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/179-full-tier-queue`, worktree
`D:\cityflows-wt\179`, ports 5379 / 5479. It runs beside TASK-176 at low load (one spec at a time).

## Goal

Full run 43528001134 on dec1c8a (after TASK-166 to 170, 174 and 167) failed two Full-tier specs:

1. **T65 station riders:** 7 riders drawn where 4 were expected. Since TASK-174, riders leave the
   S-Bahn at its doors and cross the platform before their walk starts. Update T65 to check that
   model just as strictly, or fix the app if it is wrong.
2. **T16 grid5x5-stress:** 2,692 active against the 2,700 floor, after actuated signals (TASK-170).
   Keep the floor; restore the workload's size in `bench/workloads.ts`.

## Scope

`tests/e2e/T65-station-riders.spec.ts`, `tests/e2e/T16-performance.spec.ts`, `bench/workloads.ts`,
and app fixes if a spec shows a real defect.

## Gates

- Both specs pass three runs each.
- `npm run check`; `test:traffic:light` if `src/` or `bench/` changes.
- A manual Full run after the merge.

## Report

Write it as the commit body.
