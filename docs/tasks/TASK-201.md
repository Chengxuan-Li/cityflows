# TASK-201 — Freiburg in detail: building parts and the Schlossberg

Status: done 2026-11-18 (Freiburg flat by the owner; terrain fixture kept, unused). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/201-freiburg-detail`, worktree `D:\cityflows-wt\201`, ports 5401 / 5501.

## Goal

The owner approved both downloads TASK-198 deferred (2026-11-18): a fresh Overpass extract of
Freiburg's polygon with `building:part`, and AWS Terrain Tiles for the Schlossberg. Use them so the
landing city shows its landmarks and its hill.

1. **The extract.** Download the polygon (`freiburgPolygon` in `bench/freiburg.ts`, from
   `docs/decisions/2026-11-17-landing-city.md`) from Overpass with the same query as
   `fixtures/osm/freiburg-altstadt.osm` plus `building:part` ways and relations. Commit it in place of
   (or beside) the current extract, with SHA-256, date and source in `fixtures/osm/ATTRIBUTION.txt`.
   Say how much the file and the project grow. One download per source; keep the raw responses in
   `D:\cityflows-wt\201-data\` (not committed), and do not loop requests.
2. **Building parts.** The importer reads `building:part` (`height`, `min_height`, `building:levels`,
   `building:min_level`, `roof:shape` where the 3D view already draws that shape). A building that
   has parts draws its parts in 3D instead of its outline extrusion; 2D keeps the outline. The
   Münster (way 110404213) shows its nave, choir and openwork spire from its parts instead of
   TASK-198's capped 30 m body plus 116 m tower; drop that curation if the parts make it unnecessary.
   Check other landmarks (Martinstor, Schwabentor, St. Martin, the Kaufhaus) in 3D.
3. **The Schlossberg.** A terrain fixture `fixtures/terrain/freiburg.json` made the way
   `fixtures/terrain/munich-donnersberger.json` is (`bench/terrain-fetch.ts`), loaded by
   `bench/freiburg.ts` into the project. Roads, rail, buildings and the polygon-shaped ground follow it
   in 3D; the hillshade shows it in 2D. Say whether any road grade or traffic result moves.
4. **Rebuild** `fixtures/projects/freiburg.cityflows.json` with `bench/freiburg.ts`, byte-identical on
   a second run. Re-pin Freiburg's hashes with the reason.

Leave the showcase camera values in `bench/freiburg.ts` as they are: TASK-203 changes how cameras
frame cities and reports any new values for the lead to apply.

## Scope

`src/importers/**` (building parts), the 3D building code in `src/render3d/**` (`roofs.ts`,
`geometry.ts`, `scene.ts` where parts are drawn), `fixtures/osm/`, `fixtures/terrain/freiburg.json`,
`fixtures/projects/freiburg.cityflows.json`, `bench/freiburg.ts`, `bench/terrain-fetch.ts`, tests.

Contract change this task may make: an optional building-parts field on the city's buildings in
`src/schema` (describe it in `docs/architecture.md`). Anything else in `src/schema`, stop and report.

Out of scope: traffic behaviour, the tram timetable (TASK-202), cameras and panel insets (TASK-203),
gate floors, `bench/traffic-baseline.json`, the Munich and Sindelfingen extracts. Munich and
Sindelfingen city hashes must not move unless their extracts contain parts the importer now reads;
if they do, say so and stop before re-pinning them.

TASK-202 runs at the same time and may re-pin Freiburg's tram census; the lead merges in order and
the later task re-pins after rebasing.

## Gates

- Importer tests: a part with `min_height` draws from that height; a building with parts draws no
  outline extrusion in 3D; a building without parts is unchanged.
- Freiburg's gate (`tests/city/freiburg.city.test.ts`) passes; load budget: first frame within 3 s
  of page load in the production bundle, 3D within a further 5 s (TASK-198's measure); render CPU
  p95 2D under 4 ms, 3D under 6 ms.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- Screenshots in 3D, Light and Dark, Day: the Münster close up, the Schlossberg from the Dreisam, the
  landing view; in `docs/findings/2026-11-18-freiburg-detail/`.

## Report

Write it as the commit body of the last commit: download sizes and SHA-256, parts imported, the
Münster before and after, the terrain range, the load and frame numbers, and what moved.
