# TASK-294 — "Anlieger frei" pockets in Lübeck: residents' access by zone, through traffic barred

Status: in progress 2026-11-21 (wave C, owner's go). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch `task/294-anlieger-zones`, worktree
`D:\cityflows-wt\294`, ports 5494 / 5594.

## Goal

TASK-281 left 24 Lübeck facilities out behind "Anlieger frei" pockets (`access=destination` streets): their
lots have no reachable aisle under today's zone rule. The router lets a car use a destination or private road only
when its zone is the trip's origin or destination zone (`roadAccessFilter`). Find why these pockets fail (zones cut
at the wrong place, nested or adjoining destination zones, lot aisles on a different zone than their street, the
lot reachability test in TASK-281) and fix it by general rule, so trips to and from places inside a pocket reach
them and through traffic stays out. Then say how many of the 24 facilities come back and rebuild the archives.

## Scope

Zone assignment (`src/network/compile.ts` zones), the router's access filter (`src/routing`), lot reachability
(TASK-281's rule in the importer), tests, the bundled projects' rebuild.

Out of scope: `src/schema`, `src/sim/parking.ts` (TASK-289), gate floors, `bench/traffic-baseline.json`, OSM edits or per-id curation.

## Gates

- Tests that fail without the change: a pocket reached by its own trips, crossed by none.
- Lübeck: facilities restored, `no_route` 0, gate; the same counts in York and Freiburg.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full demand on
  seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; every bundled city's showcase gate; the
  Munich gate and the mode-share guard.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
