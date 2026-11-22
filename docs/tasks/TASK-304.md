# TASK-304 — Heathrow: the operational-scale test

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-302). Proposed owner: Codex CLI
(gpt-6.2-sol, high). Branch `task/304-heathrow`, worktree `D:\cityflows-wt\304`, ports 5504 / 5604.

## Goal

Heathrow as a bundled real place, the test of operational scale: two parallel runways near capacity, Terminals 2
to 5 with their satellites, about 370 stands (`docs/decisions/2026-11-22-airports.md`).

- Import the lead's extract (`D:\cityflows-wt\airport-data\lhr.osm`, record in `record.txt`; untrusted, read by
  path) into `fixtures/osm/heathrow.osm` with attribution; build and list it as "London Heathrow Airport".
- Segregated mode: one runway for arrivals, the other for departures, alternating at a stated time each day
  (westerly and easterly operations by wind); a full-day schedule sized to Heathrow's volume (about 1,300
  movements a day) and mix, double-deckers included.
- Measure what scale costs: sim step time per aircraft count, render frame time, load time; fix hot paths by
  general means where they block the gates, and say what remains.

## Scope

As TASK-295 to 302 where Heathrow needs rule or performance changes; `fixtures/osm`,
`fixtures/projects/heathrow.cityflows.json`, `bench/bundled-cities.ts`, `src/ui/bundled-projects.ts`, tests.

Out of scope: per-id curation, OSM edits, any other download, gate floors, `bench/traffic-baseline.json`.

## Gates

- Topology counts; a full day at the default seed: completion (floor 98%), runway alternation at its time,
  arrival spacing and departure rates per hour against the schedule, no overlap, no conflict, no stuck aircraft.
- Step time at the peak hour and frame time reported against Zurich's and Freiburg's; landing budget reported.
- London City, the synthetic airport and Zurich unchanged or explained; existing cities byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Write it as the commit body.
