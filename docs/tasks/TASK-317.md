# TASK-317 — Taxi speeds against the real world, and where airside delay comes from

Status: in progress 2026-11-22 (owner: "start with the taxi speed increase and measure delays etc. if that may be
the cause"). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch `task/317-taxi-speeds`, worktree
`D:\cityflows-wt\317`, ports 5517 / 5617.

## Goal

Find out whether slow taxiing is a cause of the airside delays, and raise taxi speeds to realistic values where the sim
is slower than real.

1. **Delay attribution.** Instrument a full day and split each movement's time into: taxi in motion (and its achieved
   speed), waiting for a reservation or route lock, waiting at a holding position, waiting for a stand, pushback,
   runway occupancy and sequencing, airborne, and diversion or go-around. Report per airport: London City (main),
   and Boston and Heathrow held out of the panel (take only their bundling from the parked `dacf5ae` and `c0b4b2f` with
   `git checkout <commit> -- <paths>`; never merge those branches).
2. **Taxi speed realism.** Compare achieved speeds and taxi-in and taxi-out times with published operating figures
   (straight taxiways roughly 15 to 25 kt, turns about 10 kt, rapid exits up to about 50 kt, aprons and taxilanes
   slower, pushback 2 to 3 kt; typical taxi-out a few minutes at London City and longer at large hubs; state sources
   as type-level or operator figures). Where profiles, curvature limits, acceleration, or start-stop from
   reservations make the sim slower than real, fix them (the catalogue figures in `src/schema/aircraft.ts`, the
   profiles in `src/sim/aircraft-motion.ts`, reservation release timing).
3. **Verdict.** Say how much of the delay at each airport was taxi speed, before and after, and what the dominant
   remaining causes are, for TASK-312 (throughput at scale).

## Scope

`src/schema/aircraft.ts` (figures), `src/sim/aircraft-motion.ts`, `src/sim/aircraft.ts` (reservation timing only,
small), instrumentation in tests or bench scripts, tests.

Out of scope: throughput redesign (TASK-312), load and render (TASK-310, 311), Zurich (TASK-302), schema beyond the
figures, gate floors, `bench/traffic-baseline.json`, any download.

## Gates

- Delay attribution tables per airport, before and after.
- Achieved taxi speeds and taxi times against the published figures, before and after.
- London City's full-day gates kept (completion, mean at most 300 s, worst at most 1,800 s, go-arounds 0, zero overlaps
  and conflicts), seeds 1 to 3.
- Existing cities unchanged per the rule bullet.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
