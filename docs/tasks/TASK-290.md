# TASK-290 — Parking garage entrances read from OSM (`amenity=parking_entrance`)

Status: in progress 2026-11-21 (wave C, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch `task/290-parking-entrances`, worktree
`D:\cityflows-wt\290`, ports 5490 / 5590.

## Goal

Garages and underground lots are reached today through `entrance=garage` nodes, building outlines and the
nearest road. OSM maps where cars actually enter and leave a garage with `amenity=parking_entrance` nodes (often
with `parking=underground|multi-storey`, `access`, `entrance`); the bundled extracts carry them (Freiburg 31,
Munich 23, Lübeck 37, York 11, Philadelphia 62 tag values). Read them by general rule: an entrance node on or
next to a road becomes the facility's car connector (and its exit, unless tagged otherwise), linked to the garage
or lot it belongs to (enclosing or nearest facility within a few metres). Add the node query to the Overpass
fetch for future imports (no new download: the extracts already hold the nodes). TASK-281 left facilities with no
reachable aisle out; say how many come back. Rebuild the bundled projects.

## Scope

`src/importers/osm/parking.ts`, `lots.ts`, `places.ts` where connectors are placed, `src/importers/overpass.ts`
(the node query), tests, the bundled projects' rebuild (`bench/bundled-cities.ts`, staleness pins).

Out of scope: `src/schema`, `src/sim`, routing rules, gate floors, `bench/traffic-baseline.json`, OSM edits or per-id curation.

## Gates

- Tests that fail without the change: entrance read, connector placed at it, facility link.
- Counts per bundled city: entrances read, linked, unlinked (and why), facilities restored.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full demand on
  seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; every bundled city's showcase gate; the
  Munich gate and the mode-share guard.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
