# TASK-222 — The lock between a tram crossing and two actuated signals (Freiburg n:18, n:39)

Status: in progress (unsupervised run, owner 2026-11-19; started when TASK-220 finished). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/222-crossing-signal-lock`, worktree `D:\cityflows-wt\222`, ports
5422 / 5522.

## Goal

TASK-208 found a latent fault (its review in `docs/plan.md`, item 3): at Freiburg the tram crossing at
`r:1337`/`n:39` reaches `n:18`'s stop line; a held car needs two controllers green together, and
TASK-199's upstream calls lock both at their maximum in opposite phase (3.5 minutes on main with
TASK-204's second rule off; it gridlocked Freiburg under TASK-204's first rule). It does not show on
main today only because traffic happens not to arrive that way.

1. Reproduce it (TASK-208's branch `task/208-remaining-misses`, `8653e9e`, and its evidence say how)
   and trace the cycle.
2. The smallest general rule that breaks it: for example, actuated controllers whose stop lines a
   crossing or a short link joins coordinate (one serves the call the other holds), or a call from a
   car that cannot clear is not extended. Say which and why.
3. Show the lock gone in the reproduction, and that nothing else moves more than the merge rule allows.

## Scope

`src/sim/signals*` or wherever actuated control lives, `src/sim/rail-crossings.ts` where it feeds
calls, `src/network/signal-program.ts`, tests.

Out of scope: `src/network` geometry, the importer, markings, `src/schema`, gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test that reproduces the lock on main and passes on the branch.
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
