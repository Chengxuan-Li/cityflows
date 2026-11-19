# TASK-230 — Step time, third pass: full demand and the Freiburg landing city

Status: done 2026-11-19 (merged; review in `docs/plan.md`). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/230-step-time-3`, worktree `D:\cityflows-wt\230`,
ports 5430 / 5530.

## Goal

TASK-187 and TASK-211 made Munich full demand about 23% faster each with identical results; TASK-211
left the following pass, spawn's blocked-origin scan, the rail hold, reroute routing and commit. Since
then TASK-222 (actuated keep for crossing-held cars), TASK-225 (held services) and TASK-217 to 227
landed. The Freiburg landing page runs its simulation in the browser's worker at the showcase demand,
so its step time is what a visitor feels.

1. Profile Munich full demand (seed 1, choice off, both signal modes) and Freiburg's gate run (0.15,
   seed 1) on main with the bench timers TASK-187 and TASK-211 used; list the phases.
2. Make total stepping at least 10% faster on Munich full demand, and report Freiburg's change, with
   exactly the same results: every state hash identical. Prefer exact cuts (work skipped only when it
   provably cannot change the outcome); a test for any new invariant a cut relies on.
3. Report the phase tables before and after.

## Scope

`src/sim/**` (performance only) except `src/sim/rail-crossings.ts` (TASK-228 is changing it now),
bench profiling scripts, tests.

Out of scope: any change to results, `src/sim/rail-crossings.ts`, `src/schema`, `src/network/**`,
`src/importers/**`, gate floors, `bench/traffic-baseline.json`, fixtures.

## Gates

- Identical state hashes, main against branch: Munich 0.15 seeds 1 to 3, choice off and on, both
  modes; full demand both modes (references actuated 3,759 / 143, hash 4028429784; fixed 3,501 / 168,
  hash 2888500527); Freiburg's gate (4038635547); Sindelfingen (3472231659).
- Stepping time main against branch, interleaved, at least two pairs per mode, with machine load
  reported (other agents run at the same time).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the phase tables, each cut, the hashes, the timings.
