# TASK-376 — Heathrow: stand-access waits behind the helipad and parked aircraft

Status: started 2026-11-27 (owner: "yes", 10 h unsupervised run). Owner: Claude subagent (Opus 5.5). Base: main
`138bf349`.

## Finding (TASK-369)

With TASK-363 on, an arrival whose way to its stand is blocked steps out of the landing order and waits in the air.
Heathrow stepped-out time on main days 1–3: `st:31169` 7,735 / 1,835 / 5,715 s (the aircraft at `st:31168` stands
across its way in); stand 232 1,840 s and stand 412 490 s on day 2. TASK-369's stand reassignment (parked, `10fcf248`)
cut the `st:31169` wait but lost peak landings (689 → 681), and stand 412 then waited 1,200 s behind helipad
`hl:34862`.

## Goal

1. Diagnose every stepped-out or stand-access wait over 300 s on Heathrow main days 1–3 and peaks 1–5: the stand, the
   blocker (parked aircraft, helicopter at or near a helipad, tug, ground vehicle), why it blocks (clearance radius,
   way-in route, pairing), and how long. Table it.
2. Fix the largest cause by rule. Options to weigh: the helipad clearance radius or its shape against the stand's way
   in (check the source of the radius); a way-in route that skips the blocked taxilane; a tow of the blocker under
   the TASK-353 tow rules; stand assignment that avoids a pair the blocker makes. TASK-358's pairing rule (parked
   `1ed91f74`) and TASK-369's reassignment both made days worse: read why before choosing.
3. Keep TASK-363's step-out and approach order, the TASK-339 parked-blocker rules and the TASK-353 tow rules intact.

## Scope

`src/sim/aircraft.ts`, `src/sim/flight-operations.ts`, `src/sim/ground-vehicles.ts` if a tow is involved,
`bench/airside-delay.ts` (counters), tests.

Out of scope: `src/network/**` geometry, the city simulation, gate floors, OSM edits, per-id curation.
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