# TASK-273 — City walls and gates: fetched, read and drawn (TASK-259's D5, York)

Status: in progress 2026-11-21 (third run; owner approved the query change and York's re-fetch). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/273-city-walls`, worktree `D:\cityflows-wt\273`,
ports 5473 / 5573.

## Goal

York's defining edge is its walls and bars (Bootham, Monk, Walmgate and Micklegate Bars). The app's Overpass
query (`buildQuery` in `src/importers/overpass.ts`, `queryVersion` 10) does not fetch `barrier=city_wall`
or `historic=city_gate`, so they are invisible in 2D and 3D (`docs/decisions/2026-11-20-more-cities.md`, D5).

1. Bump the query version and add `barrier=city_wall` ways (with `historic=citywalls` and
   `wall`/`height`/`width` tags) and `historic=city_gate` / `building` gate nodes and ways.
2. Read them into the city as context features. A schema value for the wall kind is approved if needed.
   Keep it to what the existing context feature types need; say what you added.
3. Draw them: a stone wall in 3D of its tagged `height` (default about 4 m) and `width` (default about
   2 m), with a walkway on top where a `highway=footway` runs on the wall; gates as gatehouses where
   OSM maps the building, or as an arch over the road where only the node is mapped. In 2D, a wall band.
4. Re-fetch York only (the owner's 2026-11-21 approval), from overpass-api.de with the new query and
   the polygon recorded in `docs/decisions/2026-11-20-more-cities.md`. One request, to
   `D:\cityflows-wt\259-data\york-walls-v11.osm`. If it comes out over 10 MB, stop and report.
   Freiburg, Munich and Sindelfingen are not re-fetched. Their existing extracts lack walls, so the change
   must leave their imports identical.

## Scope

`src/importers/overpass.ts`, the context importer, `src/schema` (a wall kind if needed),
`docs/architecture.md` (the feature), 2D and 3D context drawing, tests (a small York excerpt with
ODbL attribution under `tests/`), close-ups under `docs/findings/2026-11-21-city-walls/`.

Out of scope: roads and walks on the wall beyond drawing the walkway, `src/sim/**`, gate floors, any other
download.

## Gates

- A test per reading and drawing rule that fails without it. York's walls in km and its gates by name.
- Close-ups of Micklegate and Bootham Bar in 2D and 3D, day and night.
- Freiburg, Munich and Sindelfingen import byte-identical, and their state hashes are identical.
- Frame budgets and 3D build on the Freiburg landing spec, and York's 3D build.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the query change, the download (size, SHA-256, snapshot), the reading, the
drawing, the counts, the identity checks.
