# TASK-378 — London City: mean road delay nearly doubled with TASK-279

Status: started 2026-11-27 (lead, 10 h unsupervised run; city work merges under the traffic merge rule and the audit
tolerance). Owner: Codex (gpt-6.2-sol, high). Base: main `8aa8063e`.

## Finding (TASK-279, TASK-372)

TASK-279 (unmarked crossings: walkers yield except to drivers turning into the arm) raised London City's showcase
mean delay from 210.2 to 385.7 s. The worst visit moved from 801.5 s on `r:2253` to 822.3 s on `r:274`, close to the
900 s limit. Fewer walker priorities should not slow vehicles this much. TASK-372's UK turn-out yield then gridlocked
one trip (worst visit 1,472.7 s on `r:6`).

## Goal

1. Find where the extra delay comes from: per road and node, main before TASK-279 (`cf907113^1`) against main, the
   vehicle seconds lost by cause (walker yields, signal, conflict, queue spill-back, parking search). Name the top
   five places, with what holds the vehicles there.
2. Fix the largest cause by an app rule that holds for every city (OSM rule: no per-id curation, no OSM edits). If the
   cause is a defect in TASK-279's gap or turn-into rule, fix it there. Report whether the UK turn-out yield of
   TASK-372 (branch `task/372-walker-country`, `ec1ebd5d`) would then pass, as a measurement only.

## Scope

`src/sim/walkers.ts`, `src/sim/**` where the cause lies, `src/network/walk.ts`, tests, re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, signal programs unless the cause
is one (then stop and report).

## Gates

- The owner's merge rule: Munich 0.15 seeds 1–12, four configurations, within 3%; full demand within 2% on the mean of
  seeds 1–5, both modes; Freiburg within 5 s; drain; Sindelfingen; all showcases pass.
- London City mean delay and worst visit against main (target: well under 900 s, mean toward 210 s).
- If the compiled network changes: the geometry audit within tolerance.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.