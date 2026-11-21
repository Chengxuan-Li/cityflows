# TASK-259 — Scout more preloaded cities: Lübeck, a UK centre, Philadelphia

Status: waits for the owner's approval of the downloads. Proposed owner: Claude Code subagent (Opus 5.5,
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

## Scope

A decision document `docs/decisions/2026-11-20-more-cities.md`, findings and shots under
`docs/findings/2026-11-20-more-cities/`, scratch scripts. Extracts only as the owner approves them
(Overpass, the app's own query, ODbL attribution in `fixtures/osm/ATTRIBUTION.txt`).

Out of scope: source changes of any kind (defects are listed, not fixed), the panel, bundled archives.

## Gates

Per city: import and compile times, counts, the showcase gate at default demand (drain, gridlock, stalled
heads, `no_route`), production load and frame budgets, 3D build time, 2D and 3D shots, ranked defects with
ids. A recommendation per city: bundle now, bundle after named fixes, or drop.
