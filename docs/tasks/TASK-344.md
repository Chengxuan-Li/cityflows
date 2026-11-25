# TASK-344 — Turnaround and departure start efficiency

Status: started 2026-11-25 in the owner's 6-hour run (A4). Owner: Claude subagent (Opus 5.5).
Branch `task/344-turnaround-start`, worktree `D:\cityflows-wt\344`. Base: `task/340-ring-free-order` at `4b899a51`.

## Finding

Heathrow 06:00–08:00 with the pilot stack + `T330TOW`, seed 1. Departure stages (means, s):

| readinessS | startWaitS | surfaceWaitS | pushbackS | taxiMovingS | holdS | runwayS |
|---|---|---|---|---|---|---|
| ≈1,400 | ≈900 | ≈510 | ≈90 | ≈220 | ≈100 | ≈130 |

- **startWaitS** is the time a ready departure waits at its stand for a start grant. It is the largest
  controllable piece.
- **readinessS** is mostly late inbound aircraft.
- Taxi-out averages 15–22 minutes.
- Each run ends with 12–20 departures still ready for pushback.

`tryStart` refuses a start for several reasons:
- waits on aircraft not started (`waitsForUnstarted`);
- first-leg conflict;
- push sweep not clear;
- `yieldsTo` null;
- the tow rule;
- TASK-339's parked-blocker refusals (`startRefused`, `startHeld`).

Progressive ordering orders only within 300 m.

## Goal

Cut start waits and taxi-out at Heathrow peak without more gridlock, overlaps or go-arounds.

1. **Measure first.** Count start refusals by reason and their summed wait (a bench field or debug counter), for seed 1.
2. **Fix the biggest causes** with general rules. Examples:
   - push a ready departure into a free gap instead of waiting on an unstarted aircraft that will not move soon;
   - sequence pushbacks per stand group;
   - meter starts against the departure queue at 27R, so aircraft wait at the stand rather than on taxiways (a
     TASK-326 departure-metering pilot exists on `task/326-departure-metering`; read it).
3. **Turnaround.** Check that turnaround (arrival to ready) follows the schedule and does not add avoidable waits.

## Scope

`src/sim/aircraft.ts` (`tryStart`, admission, pushback), `src/sim/flight-operations.ts` (readiness, departure timing),
`bench/airside-delay.ts` (a refusal breakdown), tests in `tests/sim/`.

## Out of scope

Runway rules, landing release, `tests/sim/aircraft-checks.ts`, `src/schema`, `docs/architecture.md`.

## Tests (owner's ladder)

1. **Light:** Heathrow 06:00–08:00, seed 1, stack + `T330TOW`. Base: 142 completed, startWaitS ≈ 900 s, taxi-out
   23.7 min. Target: startWaitS and taxi-out down at least 20%, completed not lower, overlaps 0, no new gridlock. Then
   confirm on seed 3 (base 120).
2. The lead runs the wider gates in TASK-346.

`npx tsc --noEmit -p .`, `npx eslint`, the aircraft tests. Commit on the branch with a results table; do not merge.
