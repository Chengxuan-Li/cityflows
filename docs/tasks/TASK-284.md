# TASK-284 — Lübeck and York as preloaded cities

Status: in progress 2026-11-21 (third run, wave B). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/284-bundle-luebeck-york`, worktree `D:\cityflows-wt\284`, ports 5484 / 5584.

## Goal

The owner chose a mixed slate of preloaded cities (2026-11-20). TASK-259's scout recommended Lübeck (after D7 and
D17) and York (after D1, D3, D4, D11, better with D5, D6, D8, D12). On main now: D1 (TASK-267), D3/D11/D15 (268,
282), D4 and zig-zags (269), D7 (270), D17 (281), D5 walls (273), D8 kerb lines (276). TASK-271 (D6 passages, D12
conditional access) is finishing and lands soon; rebuild the archives once it does (the staleness test tells you).

Add Lübeck (the Altstadt island and the Hbf) and York (inside the walls, with the station) to the bundled cities
with TASK-258's builder (`bench/bundled-cities.ts`): the raw import, no per-id curation, the showcase scenario.
Commit their extracts under `fixtures/osm/` from `D:\cityflows-wt\259-data` (`luebeck-altstadt.osm`;
`york-walls-v11.osm`, the query-11 re-fetch with walls), with full entries in `fixtures/osm/ATTRIBUTION.txt`
(source, query, polygon, snapshot, size, SHA-256, as the Freiburg entry does). Add them to the New city panel's
"Real places" with one-line notes, and `?city=luebeck|york`. Each must pass the showcase gate (drain, no
gridlock, no stalled heads, `no_route` 0, parking failures under 2%) and stay within load and frame budgets
(measured as TASK-258 did; a city over budget is reported with its numbers and kept out of the panel). Terrain:
flat, as the other cities.

## Scope

`bench/bundled-cities.ts`, `fixtures/osm/` (two extracts and attribution), `fixtures/projects/` (two archives),
`src/ui/bundled-projects.ts`, the panel list, tests (staleness, gate per city, the real-places e2e spec), screenshots.

Out of scope: importer or simulation changes (report defects found, with ids, as follow-ups), `src/schema`, other
downloads.

## Gates

- The showcase gate per city and its numbers; budgets per city.
- The staleness test covers both; the real-places spec opens both from the panel and by `?city=`.
- Existing state hashes unchanged.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`; open the app with the preview tooling and
  exercise the panel; screenshots of each city's first view in 2D and 3D.

## Report

Write it as the commit body.
