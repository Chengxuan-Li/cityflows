# TASK-319 — Mapped jet bridges and a ready-for-pushback state

Status: in progress 2026-11-22 (follow-up from TASK-315; owner: start queued work in parallel). Proposed owner:
Codex CLI (gpt-6.2-sol, high). Branch `task/319-bridges-pushback`, worktree `D:\cityflows-wt\319`, ports 5519 / 5619.

## Goal

Two gaps TASK-315 left because they needed schema, importer and sim scope (`docs/plan.md`, TASK-315 review):

1. **Mapped jet bridges.** Import `aeroway=jet_bridge` ways (Boston 111, Heathrow 15 in the extracts) into the airport
   section (a schema field: the bridge's line, its terminal end and the stand it serves by rule), and have TASK-315's
   bridge drawing use them where an airport maps any, docking each to the nearest stand's door. Rebuild the Boston and
   Heathrow archives; London City and Zurich (none mapped) keep TASK-315's rule.
2. **Ready for pushback.** A short sim state before pushback (boarding complete, bridge retracting, tug attached) so
   the bridge retracts before the aircraft moves: a stated duration per type in the operations timeline, exposed in
   the aircraft snapshot; TASK-315's bridge logic retracts on it.

## Scope

`src/schema/airport*.ts`, `src/importers/osm/airport.ts`, `src/sim/aircraft.ts` and `src/sim/flight-operations.ts`
(the pre-pushback state only, small and additive), `src/render3d` bridge logic, archive rebuilds, tests,
`docs/architecture.md`.

Out of scope: throughput logic (TASK-312, running in parallel: keep sim edits minimal and additive), ground vehicles
(TASK-316, parallel), gate floors, `bench/traffic-baseline.json`, any download.

## Gates

- Tests: mapped bridges imported and docked; bridge retracts during the pre-pushback state, never while the aircraft
  moves; London City's flight-day gates kept (the new state adds its duration to departures: report delays before and
  after).
- Bridge counts per airport before and after; screenshots of Boston and Heathrow with mapped bridges docked.
- Existing cities unchanged per the rule bullet; `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
