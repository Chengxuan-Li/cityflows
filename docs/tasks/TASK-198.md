# TASK-198 — The showcase landing city: Freiburg

Status: done 2026-11-17 (fixed-time signals until TASK-199). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/198-landing-city`, worktree `D:\cityflows-wt\198`, ports 5399 / 5499.

## Goal

Build Freiburg im Breisgau (Altstadt and Hauptbahnhof inside the rail line, the rings and the Dreisam)
as a curated bundled project and make it the landing view. The scouting, numbers, OSM ids and the
polygon are in `docs/decisions/2026-11-17-landing-city.md` ("What the importer cannot do", "What
TASK-198 must build", "Data sources"); read it first. The owner wants a showcase: richer rather than
small, a natural edge rather than a square, and it need not be busy when it opens.

The extract TASK-197 downloaded is `D:\cityflows-wt\197-data\extracts\freiburg\freiburg.osm` (SHA-256
`b3af79c9…3241882`, polygon and source in the decision document). Use it; downloading anything else
(a fresh extract with `building:part`, AWS Terrain Tiles) needs the owner's go-ahead, which the lead
passes on. Until then, build without it.

Work in phases, one commit or more each, so the lead can merge after any phase:

1. **Polygon boundaries.** `ImportOptions.polygon` (a WGS84 ring) clips roads, rail, walk links,
   parking, buildings, land use and water to the ring, with the local frame and `geo.bbox` from its
   bounding box. Ways are cut where they cross the ring, not kept to their ends, so the cut leaves no
   disconnected fragment or dead end. Tests: a polygon import keeps no road, track or feature outside
   the ring, and compiles with no `disconnected_component` from the cut. The bbox path stays
   byte-identical (existing pins do not move).
2. **Entry points.** Gateways where each drivable road of tertiary class or above crosses the ring
   (paired carriageways paired as `addGateways` does today), and rail and tram boundary nodes where
   tracks cross it, so `src/network/rail.ts` starts services there. Test: Freiburg's gateway set
   equals a curated entry list (the decision document names the entries), and every entry carries
   trips in and out by 10:00.
3. **Trams that run.** Find why `buildTimetable(rail, 'tram')` builds no Freiburg route from a
   connected 6.65 km network and fix it (the wrong-way share test in `routesFor` is the first suspect,
   not verified). Trams run on the main lines through Bertoldsbrunnen. Say whether the fix moves any
   existing city's timetable (Munich, Sindelfingen); if it does, re-pin with the reason.
4. **The bundled project.** `fixtures/projects/freiburg.cityflows.json` built by a script from the
   committed extract (`fixtures/osm/freiburg-altstadt.osm`, with its entry in
   `fixtures/osm/ATTRIBUTION.txt`), so it changes only when rebuilt on purpose. Curate in the project:
   the Münster (way 110404213) with a capped body height and its spire rather than a 116 m block (parts
   if a `building:part` extract is approved), other landmark heights checked;
   `tunnel=building_passage` at grade; junctions, lanes, turn rules and names checked in 2D and 3D;
   a showcase camera for 2D and 3D. A terrain fixture for the Schlossberg only if the owner approves
   the download; otherwise flat, and say so.
5. **Load budget.** Measure production load from page open to first frame. TASK-197 measured 10.6 to
   10.9 s from opening the project, far too slow for a landing view. Target: first frame within 3 s of
   page load on this machine, idle, in the production bundle; 3D within a further 5 s. If the project
   format cannot reach it, make the smallest change that does (for example shipping the compiled city
   or deferring the walk network and buildings until after the first frame), and stop and report
   before changing `src/schema` beyond what is described below.
6. **Open it by default.** `open('freiburg')` in `src/ui/store.ts`, paused at the scenario start (not
   busy on open); the grid, town and the other test cities stay under New city. Every e2e spec that
   relied on the grid opening by default opens it by name (about 31 specs mention `grid5x5`). Only
   after phase 5 meets its budget.
7. **Its own gate.** `tests/city/` (or the traffic tier, whichever fits the run time): the project's
   city hash pinned; at 0.15 with mode choice on, 0 gridlocked, 0 stalled heads, no `no_route`
   failures, worst single road visit under 900 s, parking failures under 2% of local arrivals; the
   load budget and a 2D and 3D frame budget (render CPU p95) in an e2e spec.

## Scope

`src/importers/**`, `src/network/rail.ts` and the timetable code, `src/ui/store.ts`, the project
loader, `fixtures/osm/`, `fixtures/projects/`, `fixtures/terrain/` (if approved), a build script under
`scripts/` or `bench/`, tests and e2e specs, the README's opening paragraph and the importer section of
`docs/architecture.md`.

Contract changes this task may make: `ImportOptions.polygon`; an optional boundary ring in the
project's `geo` so the views can draw the natural edge (describe it in `docs/architecture.md`).
Anything else in `src/schema`, stop and report.

Out of scope: traffic behaviour (signals, routing, lane changes), gate floors,
`bench/traffic-baseline.json`, the Munich and Sindelfingen fixtures' extracts.

TASK-194 (actuated default) may merge while this runs; it changes generated signal programs, so
re-pin Freiburg's hashes after rebasing if it lands first.

## Gates

- Each phase's tests; `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- Munich gate and mode-share guard unchanged (phases 1 to 3 must not move them unless phase 3's timetable
  fix does, with the reason).
- Screenshots of the landing view in 2D and 3D, Light and Dark, Day, in
  `docs/findings/2026-11-17-landing-city/` (`freiburg-landing-*.png`), from the production bundle.

## Report

Write it as the commit body of the last commit, with the per-phase numbers.
