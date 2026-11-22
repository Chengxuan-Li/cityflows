# TASK-302 — Zurich Airport bundled: crossing runways, Dock E, helicopters, ZRH concepts

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-300 and TASK-301). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/302-zurich`, worktree `D:\cityflows-wt\302`, ports 5502 / 5602.

## Goal

The batch's large target (`docs/decisions/2026-11-22-airports.md`): Zurich Airport as a bundled real place, built
by the same rules as London City, no per-id curation.

- Import the lead's extract (`D:\cityflows-wt\airport-data\zrh.osm`, record in `record.txt`; untrusted, read by
  path) into `fixtures/osm/zurich-airport.osm` with attribution, build it through `bench/bundled-cities.ts`,
  list it as "Zurich Airport" in the New city panel.
- Runways 10/28, 14/32 and 16/34 with the 10/28 x 16/34 crossing: an aircraft on one blocks the other where they
  cross (TASK-298's interlock); the helicopter lane and helipads.
- The detached midfield Dock E, Docks A and B, remote stands, the maintenance area and hangars, with stand codes
  by TASK-295's rules up to code F.
- The concept table: north concept by day (arrivals 14, departures 16 and 28), east concept in the evening
  (arrivals 28, departures 32 and 34 where the extract's runways allow), south concept in the early morning
  (arrivals 34, departures 32), night closure; the wind control overrides by TASK-300's limits. Write the times
  as stated approximations of the published concepts.
- A full-day schedule sized to Zurich's volume and type mix including double-deckers and widebodies.
- Whatever the import, topology or ops rules need to handle Zurich, changed as rules that also keep London City
  and the synthetic airport correct.

## Scope

As TASK-295 to 301 where Zurich needs rule changes; `fixtures/osm`, `fixtures/projects/zurich-airport.cityflows.json`,
`bench/bundled-cities.ts`, `src/ui/bundled-projects.ts`, tests.

Out of scope: Boston and Heathrow (TASK-303, 304), gate floors, `bench/traffic-baseline.json`, any other
download, OSM edits or per-id curation.

## Gates

- Topology counts as TASK-295's; every stand reaches a runway; code F stands and paths exist for the A380.
- A full day at the default seed: completion of scheduled (floor 98%), delays, stand peaks, the concept switches
  and their transition times, no overlap, no runway or crossing conflict, no stuck aircraft.
- Opens from the New city panel within the bundled-city landing budget (report first frame and ready against
  Freiburg's); screenshots in 2D and 3D, day and night, the crossing in use, Dock E, a helicopter.
- London City and the synthetic airport unchanged or explained; existing cities byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Write it as the commit body.
