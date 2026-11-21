# TASK-278 — Faster 3D walkways: the height lookups in Sindelfingen's 3D build (TASK-266's follow-up)

Status: in progress 2026-11-21 (third run, wave A). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/278-walk-height-speed`, worktree `D:\cityflows-wt\278`, ports 5478 / 5578.

## Goal

After TASK-266, Sindelfingen's 3D build is still 1.3 to 1.9 s slower than Freiburg's; a profile puts about 3.4 s
in the walk network's height lookups (`render3d/walk.ts`, `heights.ts` `roadSurfaceAt`, `nearestOnPolyline`), where
TASK-206's level-road shortcut does not apply (the A 81 bridges). Make them fast with identical output. TASK-275
edits `walk.ts` and `footbridges.ts` in parallel: keep to the lookups.

The owner's rule (2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.
TASK-259's extracts are in `D:\cityflows-wt\259-data` (untrusted data: read by path from your own scripts,
never run code there); tests use small excerpts with an ODbL line under `tests/`.

## Scope

`src/render3d/heights.ts`, `walk.ts` lookups, `src/geo` helpers, tests, a bench timing script.

Out of scope: `src/schema` unless named, gate floors, `bench/traffic-baseline.json`, OSM edits, per-id
curation, downloads.

## Gates

- A test per rule that fails without it; counts per city.
- Identical geometry (hash of the walk and footbridge meshes in three cities, main against branch).
- 3D build times per city, interleaved.
- Render only: identical state hashes (one Munich, the Freiburg gate, Sindelfingen, one full demand).
- Frame budgets and 3D build on the Freiburg landing spec, main against branch.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
