# TASK-211 — Full-demand step time, results unchanged

Status: done 2026-11-19. Proposed owner: Claude
Code subagent (Opus 5.5, high). Branch `task/211-step-time`, worktree `D:\cityflows-wt\211`, ports 5411 /
5511.

## Goal

TASK-187 made full demand 23.7% faster against a 25% target and listed what was left: the following
pass (376 s), lane-change proposals (107 s), spawn bookkeeping for blocked origins (86 s; "skipping an
origin until something near it changes is the next large exact cut"), rail crossings (175 s), lot
admission. Since then TASK-202 changed the crossing path (encounter liveness) and TASK-204 added
`futureChanges` checks to lane changing; both may cost time.

1. Profile Munich full demand (seed 1, choice off, both signal modes) on main with the bench timers
   TASK-187 used; list the phases.
2. Make it at least 15% faster in total stepping with exactly the same results: every state hash
   identical. Prefer exact cuts (work skipped only when it provably cannot change the outcome).
3. Report the phase table before and after.

## Scope

`src/sim/**` (performance only), bench profiling scripts, tests (a test for any new invariant a cut
relies on, as TASK-187's `lane-order.test.ts`).

Out of scope: any change to results, `src/schema`, `src/network/**` (TASK-213 and 214 run at the same
time), gate floors, `bench/traffic-baseline.json`, fixtures.

## Gates

- Identical state hashes, main against branch: Munich 0.15 seeds 1 to 3 choice off and on, both modes;
  full demand both modes (references actuated 3,345 / 177, hash 2229666949; fixed 3,210 / 166, hash
  2820161686); Freiburg's gate; Sindelfingen.
- Stepping time main against branch, interleaved, at least two pairs per mode, with machine load
  reported (other agents run at the same time).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the phase tables, each cut, the hashes, the timings.
