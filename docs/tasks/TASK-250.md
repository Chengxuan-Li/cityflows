# TASK-250 — Full demand after TASK-247: four stalled heads and 164 fewer trips

Status: done 2026-11-20 (diagnosis only; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/250-full-demand-stalls`, worktree `D:\cityflows-wt\250`, ports 5450 / 5550.

## Goal

TASK-247 (review in `docs/plan.md`) stopped cars stuck behind a car waiting for another phase from
extending an actuated green. It removed Freiburg's 08:00 flip and left Munich at 0.15 almost unchanged,
but Munich full demand with actuated signals went from 3,591 / 173 with 0 stalled heads to 3,427 / 155
with 4 stalled heads (1,678.3 to 1,705.5 s); fixed time is identical. TASK-247 did not trace it.

1. Find the four stalled heads and the trips lost: where, from when, which signals and lanes, and how
   TASK-247's rule is involved (for example a lane whose blocker never gets its phase because the cars
   behind it no longer call or extend anything, or a TASK-222 keep that no longer fires).
2. The smallest rule that removes the stalls without bringing back Freiburg's flip (Freiburg seed 1 on
   main and with TASK-239's links must stay within a few seconds of 68 to 70 s).
3. Measure everything.

## Scope

`src/sim/signals.ts`, tests.

Out of scope: `src/sim/walkers.ts` (TASK-249), `src/routing/**`, `src/sim/rail-crossings.ts`, the
importer, `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- A test that reproduces the stall on a small network and passes with the rule.
- Full demand both modes against main (completed, gridlocked, stalled heads, mean delay).
- Freiburg seeds 1 to 6; Munich 0.15 seeds 1 to 12, choice off and on, both modes (drain criterion,
  gridlocks, stalled heads); Sindelfingen; the Munich gate and mode-share guard.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the trace, the rule, the tables.
