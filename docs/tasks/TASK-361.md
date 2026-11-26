# TASK-361 — Zurich ground vehicles: dropped and late tugs, vehicles queued at day's end

Status: started 2026-11-26 (owner defaults; bounded, Codex). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-356, 2026-11-26)

Zurich seed 1 (`--daily 730`, `--vehicles --checks`) still has 179 of 441 pushes without a vehicle tug, and ground
service is 60.6%. The tugs were either dropped or late on the way: held off, cleared by a push, or stuck in Zurich's
crowded service lanes.

The number of vehicles still queued on lanes at the end of the Zurich day rose from 13 to 29 with TASK-356. London
City is at 3, 3 and 9 pushes without a tug, with service at 92–95%.

## Goal

1. Find out why Zurich's tugs and service vehicles are dropped or late. Count each by cause:
   - held off by an aircraft;
   - cleared by a push;
   - lane queue;
   - no route;
   - and others.
2. Fix the largest causes with general rules in the ground-vehicle layer. Possible rules:
   - lane priority or passing places;
   - dispatch from the nearest free depot;
   - giving up and re-routing after a bounded wait;
   - not entering a lane whose exit is blocked.
3. Bring the end-of-day lane queue at or below main's before TASK-356 (13), or explain what holds the rest.

Aircraft must not change: the vehicles follow the aircraft, never the reverse.

## Scope

`src/sim/ground-vehicles.ts`, its tests, and the vehicle fields of `bench/airside-delay.ts`.

## Out of scope

`src/sim/aircraft.ts` and `src/sim/flight-operations.ts` (other agents are changing them), `src/schema`, the importer.

## Gates

- Full days with `--vehicles --checks`: Zurich seeds 1–3 (`--daily 730`) and London City seeds 1–3:
  - aircraft fields identical to the same seed with `--roads --checks` on main;
  - 0 vehicle overlaps with aircraft and with one another;
  - Zurich pushes without a tug down from 179 on seed 1 (report every seed);
  - served share not lower;
  - end-of-day queued vehicles down;
  - London City not worse.
- `npm run check`, `npm run test:city`, `npm run test:traffic:light`, `npm run test:e2e:light`.
