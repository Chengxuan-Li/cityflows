# TASK-382 — Heathrow: A380 tows that wait 47–98 minutes and stand in the runway way off

Status: started 2026-11-27 (lead, 10 h unsupervised run; airside merges on gates). Owner: Claude subagent (Opus 5.5,
continuing TASK-376 and TASK-380). Base: main.

## Finding (TASK-376, TASK-380)

On Heathrow peak seed 1, two A380 tows (G-JVUS, G-TXFW) take 47–98 minutes from request to tow. While they wait or
move, they stand in the way off runway 27L and hold the arrival queue: landings 08:00–08:30 fell to 0–3 in the TASK-376
and TASK-380 variants. Main has the same tows. Every stand-pairing rule so far only moves the conflict onto them.

## Goal

1. Diagnose the tows on main, peaks 1–5 and days 1–3. For each tow over 20 minutes, or any that stands on a runway
   exit or its way off, give:
   - request time, tug arrival, start and park;
   - where it waits and what holds it;
   - which arrivals it delays.
2. Fix by rule. Options:
   - a tow does not wait or start on a runway exit's way off while arrivals are due on that runway;
   - vacating arrivals take priority over tows;
   - a tow's route keeps clear of the way off;
   - the tug's arrival and the tow's start are admitted only when the route is clear.

   Cite a source (ICAO Doc 4444 7.6 and 7.10; ICAO Doc 9476 SMGCS; CAP 168 or Heathrow towing instructions).
3. Keep the TASK-353 tow rules and TASK-363's sequence intact. Behind a switch while measuring; one variant allowed
   after the first.
4. Measure once with TASK-380's pairing on top (`T380=p`, branch `task/380-stand-pairing`).

## Scope

`src/sim/aircraft.ts`, `src/sim/flight-operations.ts`, `src/sim/ground-vehicles.ts` (tugs), `bench/airside-delay.ts`,
tests.

Out of scope: the city simulation, `src/network/**` geometry, gate floors, OSM edits, per-id curation.

## Gates

TASK-376's ladder:
- Heathrow peak seed 1 `--checks`;
- peaks 1–5 (689, go-arounds 18): completed not lower, go-arounds not higher;
- full days not worse: Heathrow 1–3, Zurich `--daily 730` 1–3, Boston 1–3 (re-run main), London City day 1;
- Munich and Freiburg hashes identical;
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
