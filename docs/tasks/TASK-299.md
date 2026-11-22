# TASK-299 — Flight operations: seeded schedule, stands, turnarounds, tows, hangars, helicopters

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-298). Proposed owner: Codex CLI
(gpt-6.2-sol, high). Branch `task/299-flight-ops`, worktree `D:\cityflows-wt\299`, ports 5499 / 5599.

## Goal

An airport runs a day of operations on its own (`docs/decisions/2026-11-22-airports.md`), through TASK-298's API.

- **Schedule.** A seeded daily schedule sized to the airport: movements per hour from the stand count and a
  daily profile (morning and evening peaks, a night curfew window per airport where stated), a type mix per
  airport from what its stands and runway admit (London City: regional, propeller, A220, private; larger
  airports all classes), each arrival paired with its departure after the type's turnaround time.
- **Stands.** Allocation with gate limits by code (a stand admits a type only up to its code), contact before
  remote for passenger flights, cargo and general aviation to their stand kinds; a flight that finds no stand
  holds at a stated place or diverts, and is counted.
- **Turnarounds.** At the stand for the type's turnaround time; overnight aircraft are towed to remote stands or
  hangars and back before their morning departure; a seeded share of maintenance and irregular moves (stand to
  hangar, stand to stand) through the day; long turnarounds free a contact stand by towing to a remote one.
- **Helicopters** use helipads and their own short schedule where the airport has helipads.
- **UI.** The airport's day in the run bar like the city's (time, movements so far), a departures and arrivals
  list in the inspector with each flight's stand, state and delay; picking a stand shows its code, kind and
  occupancy.

## Scope

`src/demand` or a new operations module (schedule generation), `src/sim` (operations driving TASK-298's
aircraft), `src/ui` (run bar, inspector lists), `docs/architecture.md`, tests.

Out of scope: runway configuration changes (TASK-300), lights and 3D (TASK-301), person demand (no passengers
are generated), gate floors, `bench/traffic-baseline.json`, any download.

## Gates

- Tests on the synthetic airport: schedule determinism by seed; no stand over its code; an overnight tow out and
  back; a maintenance tow to the hangar; a flight with no free stand holds and is counted.
- London City, a full day at the default seed: movements completed of scheduled (floor 98%), mean and worst
  delays, stand occupancy peak, no overlap, no runway conflict, no stuck aircraft; screenshots at the morning
  peak and at night.
- Existing archives and state hashes byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
