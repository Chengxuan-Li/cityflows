# TASK-377 — Heathrow: a landed aircraft stops with its tail on the runway

Status: started 2026-11-27 (owner: "yes", 10 h unsupervised run). Owner: Codex (gpt-6.2-sol, high). Base: main
`138bf349`.

## Finding (TASK-366)

On main (TASK-363 on), Heathrow peak seed 5 has one landed A20N standing 12 s with its tail on the runway. It is held
by a claim 26 m short of vacating, behind a chain of arrivals standing on the exit. A runway must be vacated without
stopping (ICAO Doc 4444 7.10, ICAO Doc 9643 / Doc 9870 runway incursion prevention; CAP 493). TASK-366 (parked
`e78c618b`) added a behaviour-neutral counter `arrivalCauses.tailOnRunway` (seconds and aircraft); port it to main.

## Goal

1. Port the counter; measure it on Heathrow peaks 1–5 and days 1–3, Zurich, Boston and London City days on main.
2. Fix by rule so that no landed aircraft stops with its tail before the vacating point: for example, a lander
   takes an exit only if the space beyond the runway holding position can take its whole body, otherwise the next
   free exit; or the vehicles on the exit chain move up before the lander commits. TASK-366's far-exit swaps made it
   85 s and added runway crossings; keep its `s` guard (no added runway crossing).
3. The counter is 0 on every gate run.

## Scope

`src/sim/aircraft.ts`, `bench/airside-delay.ts` (counter), tests.

Out of scope: the city simulation, `src/network/**` geometry, gate floors, OSM edits, per-id curation.
## Gates (owner ladder; airside merges on gates)

1. Heathrow 06:00–08:00 seed 1, `--checks`.
2. Heathrow peaks seeds 1–5 against main (`D:\cityflows-wt\330-pilot\R\t363\m-p1..p5`: 145/130/133/135/146 = 689,
   go-arounds 4/2/0/4/8): completed not lower in sum, go-arounds not higher in sum, zero overlaps, zero real runway
   conflicts, no gridlock.
3. Full days: Heathrow seeds 1–3 (`R\t363\m-d1..d3`: 871/869/827), Zurich `--daily 730` seeds 1–3
   (`R\t360\irm-zrh-d1..d3`: 729/727/746), Boston seeds 1–3 (re-run main: TASK-370 changed Boston), London City day
   seed 1 (`R\t360\irm-lcy-d1`: 150). Not worse.
4. Cities byte-identical: Munich and Freiburg state hashes.
5. `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

Realism changes need a cited rule (ICAO, CAP, Heathrow operating instructions or similar). Behind a switch while
measuring; on by default only if every gate passes.