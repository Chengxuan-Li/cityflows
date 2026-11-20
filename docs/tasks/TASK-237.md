# TASK-237 — Step time, fourth pass: the rail hold and rail step

Status: in progress (second unsupervised run, owner 2026-11-20). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/237-rail-step-time`, worktree `D:\cityflows-wt\237`, ports 5437 / 5537.

## Goal

TASK-230 (review in `docs/plan.md`) made full demand 14.5% faster without touching
`src/sim/rail-crossings.ts`, which then belonged to TASK-228. Its profile left the rail hold (about
255 s of 1,883 s with timers on, inside the following pass) and the rail crossing step (about 135 s):
about 19% of stepping. TASK-228 has since added `waitsFor` and TASK-225 the held-service rule there.

1. Profile Munich full demand (seed 1, choice off, both modes) and Freiburg's gate run on main with the
   bench timers TASK-187, 211 and 230 used; list the rail phases.
2. Make total stepping at least 7% faster on Munich full demand with exactly the same results (every
   state hash identical), cutting the rail hold and step first. Prefer exact cuts; a test (and a
   `debugSkips` check) for any invariant a cut relies on.

## Scope

`src/sim/rail-crossings.ts` and the engine's calls into it (performance only), bench profiling
scripts, tests.

Out of scope: any change to results, `src/network`, `src/schema`, gate floors,
`bench/traffic-baseline.json`, fixtures.

## Gates

- Identical state hashes, main against branch: Munich 0.15 seeds 1 to 3, choice off and on, both modes;
  full demand both modes (actuated 3,759 / 143, hash 4028429784; fixed 3,501 / 168, hash 2888500527);
  Freiburg's gate (1407248127) and seeds 2 and 3; Sindelfingen (3472231659); with and without
  `debugSkips`.
- Stepping time main against branch, interleaved, at least two pairs per mode, with machine load.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the phase tables, each cut, the hashes, the timings.
