# TASK-259 — Scout more preloaded cities: Lübeck, a UK centre, Philadelphia

Status: downloads approved by the owner 2026-11-21; starts at the next free agent slot. Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/259-city-scout`, worktree `D:\cityflows-wt\259`, ports 5459 / 5559.

## Goal

The owner chose (2026-11-20) a mixed slate of preloaded cities: places that show different road cultures
and stress the reading rules. As TASK-197 did for the landing city, scout three candidates with the app's
own importer, raw (no per-id curation), measured as `docs/decisions/2026-11-17-landing-city.md` does:

1. **Lübeck**, the Altstadt island and the Hbf (TASK-197's polygon). Re-measure with today's importer:
   polygon gateways now exist, so its one-gateway, 121 `no_route` result is out of date.
2. **A UK centre with left-hand traffic and UK markings**: York inside the walls, or Cambridge between
   the river and the inner ring; pick one with evidence (edge, size, rail, signals). It is the first real
   left-hand city: list every left-hand defect found (lanes, turns, roundabouts, markings, signals).
3. **Philadelphia Center City**: the committed `fixtures/osm/downtown.osm` (bbox, 2026-11-03), and a
   polygon re-fetch if approved. US markings and signals; list defects.

## Approved downloads (owner, 2026-11-21)

From `https://overpass-api.de/api/interpreter`, with the app's own query (`buildQuery` in
`src/importers/overpass.ts`, its current `queryVersion`) and each bbox filter replaced by `poly:`, as
`fixtures/osm/ATTRIBUTION.txt` records for Freiburg; one request at a time, `[timeout:180]`:

| File | Area | Expected size |
|---|---|---|
| `luebeck-altstadt.osm` | the Altstadt island and the Hbf (TASK-197's polygon) | 6 to 7 MB |
| `york-walls.osm` | York inside the city walls | 3 to 6 MB |
| `cambridge-centre.osm` | Cambridge between the Cam and the inner ring | 3 to 6 MB |
| `philadelphia-center-city.osm` | Center City as a polygon | 1 to 2 MB |

Nothing else is downloaded (no imagery, no terrain). If a polygon's extract comes out over 10 MB, shrink
the polygon rather than fetch more. Keep the extracts in `D:\cityflows-wt9-data` (not committed);
record each one's query, polygon, snapshot time, size and SHA-256 in the decision document, ready for
`ATTRIBUTION.txt` when a city is bundled.

## Scope

A decision document `docs/decisions/2026-11-20-more-cities.md`, findings and shots under
`docs/findings/2026-11-20-more-cities/`, scratch scripts. Extracts only as the owner approves them
(Overpass, the app's own query, ODbL attribution in `fixtures/osm/ATTRIBUTION.txt`).

Out of scope: source changes of any kind (defects are listed, not fixed), the panel, bundled archives.

## Gates

Per city: import and compile times, counts, the showcase gate at default demand (drain, gridlock, stalled
heads, `no_route`), production load and frame budgets, 3D build time, 2D and 3D shots, ranked defects with
ids. A recommendation per city: bundle now, bundle after named fixes, or drop.
