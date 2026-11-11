# TASK-132 — Rail heights: tunnels and elevated track

Owner: the lead, through a Claude Code subagent (owner's orchestration rule, 2026-11-11)
Gate: 10 candidates (owner backlog, 2026-11-11): rail and tram item 1
Branch: `task/132-rail-heights` (created by the lead from main)
Depends on: TASK-126 (rail network), TASK-127 (trains), TASK-135 (tram tracks), all merged.
Runs alongside: TASK-137 (tram stops), which adds new tram-stop modules and a small hook in
`src/importers/osm/rail.ts`, and TASK-140 (crossing walk links) in `src/network/crossings.ts`,
`walk*.ts` and `conflicts.ts`. Stay out of their files; keep any edit to `src/importers/osm/rail.ts`
small and in its own functions.
Followed by: TASK-134 (overhead lines), which hangs masts and wires at these heights.
Design: this file; `docs/architecture.md` sections 4 and 5 (rail network), 11 (rendering, 3D
heights and "see below ground"). Read TASK-126's, TASK-127's and TASK-135's contracts and reviews in
`docs/plan.md`.

## Goal

The owner (2026-11-11): train tracks should have their correct height, in a tunnel or on an
elevated overpass; at least one tunnel is not shown in the Munich case.

Today a track keeps OSM `layer`, `bridge` and `tunnel`; 3D places a track at `layer × 5 m` and
interpolates between node layers, and 2D draws a tunnel at 40% opacity. Trains (TASK-127) ride the
track heights.

## Design

1. **Trace first.** List every Munich and Sindelfingen track section with `tunnel`, `bridge`,
   `layer` or `level` tags or a node layer change, with how it is drawn today in 2D and 3D. Find
   the Munich tunnel the owner means (no tunnel drawn where OSM has one): check `tunnel=yes` /
   `tunnel=building_passage` / `covered=yes` ways, the Overpass query and the importer's filters,
   and whether it was dropped, drawn at ground level, or drawn but hidden under roads or ground.
   Report the cause before fixing.
2. **Heights.** A track's height profile comes from its grade: tunnels below ground (at least the
   clearance of a train plus cover, e.g. −7 m for `layer=-1`), bridges and viaducts above (deck at
   `layer × 5 m`, at least train clearance over any road or track below it), ground track at 0.
   Ramps between grades follow a gradient no steeper than 4% for rail (trams 6%), placed on the
   ground-level side, never inside a junction surface or across a level crossing.
3. **3D.** Tunnel track is hidden unless "See below ground" is on, then drawn in its tube with the
   train visible; portals (a simple concrete frame and retaining walls) at each tunnel end where it
   meets the ground; bridges and viaducts on piers (every ~20 m) with a deck and parapets; trains
   follow the new heights.
4. **2D.** Tunnel track drawn dashed or faded consistently, including the one that is missing
   today; portals as a small mark; bridges drawn above the roads they cross with a deck outline.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report.

Pre-approved:
- `src/network/rail.ts` (height profiles), `src/render/rail-geometry.ts`, `src/render/layers/rail.ts`,
  `src/render/layers/trains.ts`, `src/render3d/rail.ts`, `src/render3d/trains.ts`,
  `src/render3d/heights.ts` (rail grades only);
- `src/importers/osm/rail.ts` (tags it drops today, in its own small functions), the Overpass query
  (bump `queryVersion` if it changes);
- `docs/architecture.md` sections 4, 5 and 11;
- tests: new `tests/network/T72-rail-heights.test.ts`, shot specs, pins that move, each with its
  reason.

## Out of scope

- Tram stops (TASK-137), crossings and walk links (TASK-140), station furniture modules (TASK-133),
  overhead lines (TASK-134).
- Road heights and road bridges (unchanged), `src/sim/**`, `src/demand/**`.
- Fixture OSM files: if the tunnel's data is missing from the extract, stop and report.

## Gates

1. **Rules.** In T72, on synthetic rail: a tunnel section sits below ground with portals at its ends;
   a bridge over a road clears it; ramps keep within 4% (6% for trams) and stay off junctions and
   level crossings; same import, same hash.
2. **Munich.** The missing tunnel is drawn, in 2D and (with "See below ground") 3D; every Munich and
   Sindelfingen track section's grade is reported against main.
3. **No other change.** Car, walker and train simulation hashes equal main's (trains keep their
   timetable; only their drawn height may change).
4. **Pictures.** 2D and 3D shots of the tunnel, its portals, a viaduct or bridge with piers, and a
   ramp. Check them yourself.
5. **Performance.** Munich load and 3D frame time within 5% of main.
6. **Checks.** `npm run check`, `npm run test:city` green; `npm run test:e2e:light` plus
   T62-rail-stations, T64-trains and T70-station-furniture, with `CITYFLOWS_TEST_PORT=5332` and
   `CITYFLOWS_PRODUCTION_TEST_PORT=5432`.

## Deliverable

A report in the body of your last commit message: the trace and the tunnel's cause, the height
rules, the grade table, shots, pins changed with reasons, files outside the pre-approved list, and
the final lines of `npm run check`.

Commit on `task/132-rail-heights`; do not push or merge.
