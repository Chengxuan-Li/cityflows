# TASK-223 — TASK-208 re-measured on the lock fix

Status: parked 2026-11-19 (v1 `f5071e7` and v2 `5fb2693` each miss one limit; review in `docs/plan.md`). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/223-remaining-misses-2`, worktree `D:\cityflows-wt\223`, ports
5423 / 5523.

## Goal

TASK-208 (`task/208-remaining-misses`, `8653e9e`; review in `docs/plan.md`) cut Munich's missed turns
at `r:654` (actuated 93 to 16, fixed 310 to 7) with a `detourHeads` rule, but mean delay rose 1.2 to
3.8% at 0.15 and full demand 1.6% actuated, 4.9% fixed. Bring the rule onto main after TASK-222 (the
crossing and signal lock) and the wave A merges, re-measure, and if it misses the merge rule, try one
variant that keeps most of the miss reduction at lower cost (for example, apply it only when the
detour's next road is the head's own next road). Report both.

## Scope

`src/sim/engine.ts` (`detourHeads`), `src/sim/lane-change.ts`, tests.

Out of scope: `src/network`, the importer, `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- Misses at `r:654` and `r:639`, 12 seeds, choice off, both modes, main against branch.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes
  (means: completed, gridlocked, mean delay, worst visit; drain criterion of TASK-154); full demand
  both modes (references on main when you start: see the latest "full-demand references" in
  `docs/plan.md`); Freiburg's gate; Sindelfingen; the Munich gate and mode-share guard. If nothing
  moves, show the identical hashes instead.
- The owner's merge rule (plan, owner decisions log, 2026-11-19): mean delay no more than 3% worse in
  any Munich configuration, full-demand delay no more than 2%, Freiburg's gate delay no more than
  5 s, drain criterion on every run. If the first version misses, try one variant (say what it
  drops) and report both tables; the lead decides.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

If your change moves the Freiburg project (`fixtures/projects/freiburg.cityflows.json`), rebuild it
(`node --experimental-strip-types --import ./bench/register.ts ./bench/freiburg.ts`) and re-pin in
your branch, saying so; the lead rebuilds again at the merge. No other fixture changes.

## Report

Write it as the commit body: per case, the cause, the rule, the figures; the traffic tables.
