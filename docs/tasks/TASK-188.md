# TASK-188 — Actuated signals as the default again

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/188-actuated-default`, worktree `D:\cityflows-wt\188`, ports 5388 / 5488.

## Goal

TASK-180 made generated signal programs fixed-time (`GENERATED_TIMING = {}` in
`src/network/signal-program.ts`): with mouth joins zipping, actuation cut mean delay at 0.15 by 16%
(choice off) and 31% (choice on), but one seed-6 visit to the Landsberger loop's r:961 lasted 1,042 s
(over TASK-154's 900 s drain limit), and full demand completed 2,875 against 3,015. The seed-6 holdup
is the loop's exit onto trunk r:307 at n:306, not an exit zone or a signal (plan.md, TASK-180 review).

1. Find why that exit drains slowly under actuation and fix it at the cause.
2. Re-measure actuated against fixed-time on seeds 1 to 6 (choice off and on) and full demand, and
   make actuation the generated default only if it passes every gate and completes at least as many
   trips at full demand. Otherwise report the numbers and leave fixed-time.
3. Also fix the TASK-170 open item: actuated walk lights show red during amber and all-red even when
   the next phase keeps that walk green.

This changes the default only if the owner has approved the signal-timing decision
(`docs/decisions/2026-11-14-signal-timing.md`); check its status first.

## Scope

`src/sim/**` (signal control, the loop exit), `src/network/signal-program.ts`, walk-light display in
`src/render/**` and `src/render3d/**` if the state is drawn there, tests, the TASK-170 paragraph of
`docs/architecture.md`.

Out of scope: `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- Seeds 1 to 6 table (completed / gridlocked / stalled / mean delay / worst loop visit), choice off and
  on, and full demand, for fixed-time and actuated.
- TASK-154 drain criterion on all six seeds; the Munich gate and the mode-share guard.
- A walk-light unit test for the amber case.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- If completions at 0.15 move more than 10%, the baseline reset rule applies (log it).

## Report

Write it as the commit body.
