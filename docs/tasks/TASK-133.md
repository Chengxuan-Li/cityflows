# TASK-133 — Station furniture: signs, displays, shelters

Owner: the lead, through a Claude Code subagent (owner's orchestration rule, 2026-11-11)
Gate: 10 candidates (owner backlog, 2026-11-11): rail and tram item 2
Branch: `task/133-station-furniture` (created by the lead from main)
Depends on: TASK-126 (stations and platforms), TASK-127 (the timetable).
Runs alongside: TASK-135 (tram tracks), in `src/importers/osm/rail.ts`, `src/schema/rail.ts`,
`src/render/layers/rail.ts`, `src/render/rail-geometry.ts` and `src/render3d/rail.ts`. Put this
task's work in new modules (suggested `src/render/layers/stations.ts`,
`src/render3d/stations.ts`), with only small hooks in the scene files. The lead reconciles at
merge.
Design: this file; `docs/architecture.md` sections 4 and 5 (rail, stations), 11 (rendering).
Read TASK-126's and TASK-127's contracts and reviews in `docs/plan.md`.

## Goal

Stations get the furniture that makes them read as stations, in 2D and 3D:
- **Name boards** along each platform with the station's name, at both ends and every 40 m or so.
- **Shelters** on platforms: a canopy over part of the platform where OSM says the platform is
  covered (`covered=yes`, `shelter=yes`, or a `building=train_station` / `roof` overlapping it),
  else a short shelter near the platform's middle.
- **Benches and bins** along platforms, every 25 m or so, seeded so they don't move between loads.
- **Departure displays:** one per platform, showing the next three departures from TASK-127's
  timetable at the current simulation time (line, destination when the timetable has one, minutes
  to departure), updated as the clock runs.
- **Entrance signs** at the station's entrance nodes. Use a generic rail-station symbol and the
  station name. Do not use any operator's logo or trademark, such as the DB or MVV "S" mark.

Visual only: nothing changes in simulation, routing, demand or walk links.

## Design

1. **Placement.** Place the furniture deterministically from the platform shapes and the station
   place: positions along the platform centreline, kept on the platform polygon and clear of its
   edges by 0.6 m.
2. **2D.** Small symbols at zoom levels where platforms are legible:
   - a board as a thin bar with the name text at high zoom;
   - shelters as hatched roof outlines;
   - displays as small screens with the text shown above a zoom threshold.

   Keep the text count bounded: only boards in view, and one label per board.
3. **3D.**
   - **Boards:** posts with a panel and the name as a canvas texture, cached per station name.
   - **Shelters:** a roof on posts.
   - **Benches:** simple boxes.
   - **Displays:** a panel whose canvas texture redraws at most once per simulated 30 s.

   Batch the meshes per kind.
4. **Timetable.** Read departures through the existing pure `trainsAt` / `trainTimetable`
   helpers. Add a read-only helper in `src/network/trains.ts` if you need departures per platform;
   the trains themselves must not change (same timetable hash).

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report.

Pre-approved:
- new `src/render/layers/stations.ts`, `src/render3d/stations.ts` and a placement module (for
  example `src/render/station-furniture.ts`);
- small hooks in `src/render/scene.ts` and `src/render3d/scene.ts`;
- a read-only helper in `src/network/trains.ts`;
- `docs/architecture.md` section 11;
- tests: new `tests/render/T70-station-furniture.test.ts` and a T70 shot spec.

## Out of scope

- `src/importers/osm/rail.ts`, `src/schema/rail.ts`, `src/render/layers/rail.ts`,
  `src/render/rail-geometry.ts`, `src/render3d/rail.ts` (TASK-135).
- Tram stops (TASK-137).
- `src/network/crossings.ts` and `walk*.ts` (TASK-140).
- `src/sim/**`, `src/demand/**`.
- Any schema change. If OSM data you need isn't in the city today, say so instead of adding it.

## Gates

1. **Rules.** In T70:
   - furniture lies on the platform polygons, clear of the edges;
   - placement is deterministic;
   - the displays show the next three departures for a known time on T64's synthetic rail city;
   - the timetable hash is unchanged.
2. **No other change.** Simulation hashes, the city hash and road geometry equal main's.
3. **Pictures.** 2D and 3D shots of Donnersbergerbrücke's platforms at 07:00 with the displays
   readable, and one close 3D shot of a shelter and a board. Check them yourself.
4. **Performance.** Munich load time within 5% of main, and the 3D frame time within 5% with the
   station in view.
5. **Checks.**
   - `npm run check` and `npm run test:city` are green.
   - `npm run test:e2e:light` passes, plus T62-rail-stations and T64-trains, with
     `CITYFLOWS_TEST_PORT=5333` and `CITYFLOWS_PRODUCTION_TEST_PORT=5433`.

## Deliverable

A report in the body of your last commit message:
- the placement rules;
- the shots;
- the timings;
- files outside the pre-approved list;
- the final lines of `npm run check`.

Commit on `task/133-station-furniture`; do not push or merge.
