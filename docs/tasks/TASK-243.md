# TASK-243 — Step time, fifth pass: routing and reroutes, results identical

Status: in progress (second unsupervised run, owner 2026-11-20). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/243-routing-step-time`, worktree `D:\cityflows-wt\243`, ports 5443 / 5543.

## Goal

TASK-230 and TASK-237 (reviews in `docs/plan.md`) cut the engine and the rail code with identical
results. TASK-230's profile left routing at about 10% of full-demand stepping (route requests,
reroutes, walk and lane searches). Profile Munich full demand (seed 1, choice off, both modes, and
choice on at 0.15 where reroutes dominate) and Freiburg's gate on main; make total stepping at least
5% faster on Munich full demand, or route time at least 25% lower, with every state hash identical.
Prefer exact cuts (same search, less overhead: allocation, heap, cost lookups, repeated graph builds);
a test and a `debugSkips` check for any cache or invariant a cut relies on. No change to route choice.

## Scope

`src/routing/**`, the engine's calls into it (performance only), bench profiling scripts, tests.

Out of scope: any change to results, `src/sim/rail-crossings.ts`, `src/network`, `src/schema`, gate
floors, `bench/traffic-baseline.json`, fixtures.

## Gates

- Identical state hashes, main against branch: Munich 0.15 seeds 1 to 3, choice off and on, both modes;
  both full demands; Freiburg's gate and seeds 2 and 3; Sindelfingen; with and without `debugSkips`;
  the routing benchmark's route hash.
- Stepping and route time main against branch, interleaved, at least two pairs per mode, with load.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the phase and routing tables, each cut, the hashes, the timings.
