# TASK-300 — Runway configurations: time-of-day concepts, a wind control, reconfiguration

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-299). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/300-runway-config`, worktree `D:\cityflows-wt\300`, ports 5500 / 5600.

## Goal

Aircraft navigate the runways and taxiways correctly when the runway direction changes
(`docs/decisions/2026-11-22-airports.md`).

- **Configurations.** Per airport, a set of configurations, each naming the runway ends used for arrivals and for
  departures (and, at airports with crossing runways, which crossings are active). Derived by rule from the
  runways (each end alone, and pairs a stated rule allows), plus an optional per-airport concept table:
  configurations by time of day (London City: 27 or 09 by wind only; Zurich and the later airports set theirs in
  their own tasks).
- **Wind.** A wind direction and speed control in the UI; the active configuration keeps each used end's
  tailwind within a stated limit (5 kt) and crosswind within the type's figure; a wind change outside the limits,
  or a concept's time boundary, triggers a reconfiguration.
- **Reconfiguration.** No new line-ups or approaches on the old ends after the switch begins; aircraft on the
  runway complete; arrivals already on final land; taxiing aircraft re-route to the new departure ends and their
  holding positions; the new configuration opens when the old ends are clear. Count and report the transition
  time and the aircraft re-routed.
- Taxi routes follow the configuration's flows (a stated preferred direction on parallel taxiways where mapped
  or derivable), so opposite-direction taxiing is avoided where an alternative exists.

## Scope

`src/sim` (configuration state and the switch procedure), the airside routing, `src/ui` (wind control, active
configuration display), `docs/architecture.md`, tests.

Out of scope: lights (TASK-301), Zurich's concepts (TASK-302), gate floors, `bench/traffic-baseline.json`, any
download.

## Gates

- Tests on the synthetic airport: a wind reversal mid-morning switches 09 to 27 with no runway conflict, every
  taxiing departure re-routed to the new end, no aircraft stuck; tailwind limit respected; determinism.
- London City, a day with two wind changes at the default seed: transition times, aircraft re-routed, completion
  of scheduled (floor 98%), no overlap or conflict; screenshots before, during and after a switch.
- Existing archives and state hashes byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
