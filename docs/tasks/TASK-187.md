# TASK-187 — Full-demand step time

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/187-step-time`, worktree `D:\cityflows-wt\187`, ports 5387 / 5487.

## Goal

`tests/traffic/munich-full-demand.test.ts` runs about 974 s locally and 2,043 s on CI after TASK-176
(limit `limit(3_600_000)`). TASK-176's profile left rail crossings (about 300 s), spawning (about
230 s), the walker hold (about 160 s) and lane changes (about 150 s) as the largest costs (plan.md,
TASK-176 review). TASK-180 changed the mouth joins since. Re-profile on current main and cut the two
largest costs, with the simulation's results unchanged.

## Scope

`src/sim/**` (the profiled systems), `bench/` profiling scripts, tests.

Out of scope: behaviour changes, `src/schema`, gate floors, `bench/traffic-baseline.json`, test
limits.

## Gates

- Identical results: Munich 0.15 seeds 1 to 3 (choice off) and full demand give the same completed,
  failed and state hash at 10:00 as main.
- Full demand at least 25% faster locally (report before/after per-system times).
- `npm run check`, `test:city`, `test:traffic:light`, the mode-share guard, T16 stress.

## Report

Write it as the commit body.
