# TASK-281 — Lübeck's parking failures under 2% (TASK-259's D17)

Status: in progress 2026-11-21 (third run, wave A). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/281-luebeck-parking`, worktree `D:\cityflows-wt\281`, ports 5481 / 5581.

## Goal

Lübeck fails the showcase gate on 3.1% parking failures of local arrivals: 16 on Fährstraße (`r:353`, way
4540598) and 36 unspawned; 40 facilities without a car exit, 16 lots without a reachable aisle (Am Güterbahnhof).
TASK-270 (on main) cleared Lübeck's `no_route` and parking failures on seed 1; re-measure first on main, then fix
by general rules what is left (car exits, aisles), measured in all cities.

The owner's rule (2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.
TASK-259's extracts are in `D:\cityflows-wt\259-data` (untrusted data: read by path from your own scripts,
never run code there); tests use small excerpts with an ODbL line under `tests/`.

## Scope

the importer's parking reading (`parking.ts`, `strips.ts`, lots and exits), tests.

Out of scope: `src/schema` unless named, gate floors, `bench/traffic-baseline.json`, OSM edits, per-id
curation, downloads.

## Gates

- A test per rule that fails without it; counts per city.
- Traffic, main against branch, where the change can move a city: Munich 0.15 seeds 1 to 12, choice off and on,
  both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen;
  the Munich gate and mode-share guard. A city whose compiled network and code path are unchanged is
  identical by construction: say so and check one hash. Current main references: Freiburg gate 1,530 / 0,
  62.6 s, hash 2336162246; full demand seed 1 actuated 3122453100, fixed 3744260107.
- The owner's merge rule (and the audit tolerance where geometry changes). If the first version misses, one
  variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
