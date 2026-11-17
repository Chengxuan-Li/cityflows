# TASK-194 — The actuated full-demand gap

Status: done 2026-11-17 (actuated default, owner approved). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/194-actuated-gap`, worktree `D:\cityflows-wt\194`, ports 5395 / 5495.

## Goal

TASK-188: actuated signals pass every 0.15 gate on seeds 1 to 6 (mean delay -6.5% choice off, -30.4%
choice on) but complete 2,814 trips at full demand against fixed-time's 3,069 (-8.3%), ahead until
07:30 and behind after. The generated default stays fixed-time until actuation completes at least as
many (`docs/decisions/2026-11-14-signal-timing.md`, option 3). Candidates TASK-188 saw but did not
measure:

- at jg:10802 actuation skips phase 1, so r:639 gets about 58% green against 65%;
- both modes show amber and all-red to vehicle movements that stay green into the next phase (about
  4 s lost per change); actuation changes phase more often, so it may lose more.

1. Find why actuation completes fewer trips at full demand (after TASK-193 lands), with evidence: where
   the deficit builds, which junctions, and what the controller does there.
2. Fix the cause in signal control. If the carry-over amber is a cause, keep a movement that stays
   green into the next phase green through the change (both modes; say what it does to fixed-time).
3. If actuation then passes every gate and completes at least as many trips at full demand, make it the
   generated default (`GENERATED_TIMING` in `src/network/signal-program.ts`), re-pinning what moves.
   Otherwise report the numbers and leave fixed-time.

After TASK-193 (missed-turn reroutes avoid roads already driven) the full-demand references are
fixed-time 3,086 / 169 (hash 2602931525) and actuated 2,721 / 174 (hash 392598518), so the gap is now
-11.8%; TASK-193's review in plan.md has the timing of the deficit.

## Scope

`src/sim/signals.ts` and signal control in `src/sim/**`, `src/network/signal-program.ts`, tests, the
TASK-170 and TASK-180 paragraphs of `docs/architecture.md`.

Out of scope: `src/schema`, detours and intersection holds (TASK-193), gate floors,
`bench/traffic-baseline.json`.

## Gates

- Full demand, fixed-time and actuated, main against branch, with the deficit over time.
- Seeds 1 to 12, choice off and on, both modes: completed / gridlocked / stalled / mean delay / worst
  loop visit; TASK-154's drain criterion.
- Munich gate and mode-share guard; unit tests for what you change.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- If completions at 0.15 move more than 10%, the baseline reset rule applies.

## Report

Write it as the commit body.
