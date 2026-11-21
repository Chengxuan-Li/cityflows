# TASK-276 — UK kerb markings read from OSM (TASK-259's D8)

Status: in progress 2026-11-21 (third run, wave A). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/276-uk-kerb-lines`, worktree `D:\cityflows-wt\276`, ports 5476 / 5576.

## Goal

Under the `uk` theme every residential to primary road without a parking strip gets a yellow nearside line
(`edgeLineColor`), which reads as no waiting everywhere; OSM's `parking:*:restriction`, `parking:condition:*`
and related tags are not read (`docs/decisions/2026-11-20-more-cities.md`, D8). Draw single and double yellow
lines from the tags, none where untagged, stopped at junction mouths and crossings; German and US themes
unchanged.

The owner's rule (2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.
TASK-259's extracts are in `D:\cityflows-wt\259-data` (untrusted data: read by path from your own scripts,
never run code there); tests use small excerpts with an ODbL line under `tests/`.

## Scope

marking drawing (`marking-geometry.ts`, `road-paint.ts`, `render3d/markings.ts`), the importer's reading of the
parking restriction tags onto existing road fields (a schema field is out of scope: report it if needed),
tests, close-ups of York under `docs/findings/2026-11-21-uk-kerb-lines/`.

Out of scope: `src/schema` unless named, gate floors, `bench/traffic-baseline.json`, OSM edits, per-id
curation, downloads.

## Gates

- A test per rule that fails without it; counts per city.
- Render only: identical state hashes (one Munich, the Freiburg gate, Sindelfingen, one full demand).
- Frame budgets and 3D build on the Freiburg landing spec, main against branch.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
