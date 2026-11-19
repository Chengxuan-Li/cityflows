# TASK-225 — The Siegesdenkmal box lock (Freiburg jg:13305)

Status: in progress (unsupervised run, owner 2026-11-19; written when TASK-219 was parked). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/225-siegesdenkmal-lock`, worktree
`D:\cityflows-wt\225`, ports 5425 / 5525.

## Goal

TASK-219 (`task/219-group-surfaces`, tip `5bc497a`; review in `docs/plan.md`) found a latent lock in
Freiburg's Siegesdenkmal junction group `jg:13305`: on main at the gate's demand (0.15) seeds 2 and 4
gridlock 5 and 21 trips there, and TASK-219's tip, which changes only the Hauptbahnhof group, moves it
onto seed 1 (24 trips, stalled heads on `r:1789` and `r:1659`). Freiburg's gate pins seed 1, so any
change to the city can surface it on the landing page.

1. Reproduce it on main (seeds 2 and 4; TASK-219's tip at seed 1) and trace the cycle: which heads
   wait on which, and which rule (box blocking, group chains, signal phases, U-turn bans from
   `curateFreiburg`, the tram crossings) closes it.
2. The smallest general rule that breaks it, and why that one. Prefer a rule in the simulation over a
   curation entry; a curation entry is acceptable only if the cause is a data fault, said so.
3. Show it gone on main seeds 1 to 6 and on TASK-219's tip at seed 1, and that nothing else moves more
   than the merge rule allows.

## Scope

`src/sim` (box and group-chain rules, the engine), tests; `bench/freiburg.ts` curation only if the
cause is data.

Out of scope: `src/network` geometry, the importer, markings, `src/schema`, gate floors,
`bench/traffic-baseline.json`. TASK-222 is changing actuated control and rail-crossing calls
(`src/sim/signals*`, `src/sim/rail-crossings.ts`, `src/network/signal-program.ts`): if the fix belongs
there, stop after the diagnosis and the proposed rule, and report; the lead sequences it after
TASK-222.

## Gates

- A test that reproduces the lock on main and passes on the branch.
- Freiburg 0.15 seeds 1 to 6, main against branch: completed, gridlocked, mean delay; and TASK-219's
  tip with the fix at seed 1 (cherry-pick in a scratch worktree, not on your branch).
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

Write it as the commit body: the cycle, the rule, the figures; the traffic tables.
