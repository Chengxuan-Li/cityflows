# TASK-127 — Decorative trains

Owner: unassigned
Gate: 10 candidates (owner backlog, 2026-11-10): rail item, trains on TASK-126's tracks
Branch: `task/127-decorative-trains` (created by the lead from main)
Depends on: TASK-126 (railway tracks and stations).
Runs alongside: TASK-125 (parking claims), which changes `src/sim/parking.ts` and
`src/sim/engine.ts`. This task does not touch `src/sim/**`; the lead reconciles at merge.
Followed by: TASK-128 (stations as trip ends: people leave arriving trains), which will read
this task's arrivals.
Design: this file; `docs/architecture.md` sections 4 and 5 (rail network and graph, TASK-126), 8
(simulation clock), 11 (rendering). Read TASK-126's contract and its review in `docs/plan.md`.

## Goal

Trains run on the tracks TASK-126 imported:
- S-Bahn trains arrive at Donnersbergerbrücke, stop and leave;
- main-line trains pass through without stopping;
- trains enter and leave at the edges of the city.

They are decorative. They follow a simple timetable on the simulation clock and do not interact
with cars, walkers, routing or demand. Their positions are a pure function of the rail graph and
the simulation time, so the simulation, its hash and every traffic count stay exactly as on
main.

What exists today: `City.rail` and `CompiledCity.rail` (TASK-126):
- nodes, track sections with kind, `service`, `usage`, layer, bridge/tunnel, max speed;
- `connections`, the turns a train may take at each node (deflection at most 30°);
- components, platforms with the tracks they serve, and station places with platforms and
  entrances.

Both views receive the simulation time with every snapshot (`VehicleSnapshot.timeS`). The
Munich fixture carries `railway:preferred_direction` on 32 ways (27 forward, 5 backward),
`usage` on 98 and `railway:traffic_mode=mixed` on 55. TASK-126 keeps `usage` but not the
preferred direction.

## Design

1. **Routes.** Build train routes from the compiled rail graph:
   - A route is a path through permitted `connections` from one boundary end to another. A
     boundary end is a track end at the city's edge, not a buffer stop.
   - Prefer running lines (no `service`) and respect `railway:preferred_direction`. Store it on
     the track as an optional field: a contract change this task describes, in
     `docs/architecture.md` section 4, with the same schema and migration rules TASK-126
     followed.
   - Where neither tag nor geometry decides, double track runs on the right in both cities.
   - S-Bahn routes are those that pass a station's rail platforms. Main-line routes are the
     running lines that do not.
   - State the rule, list the routes per city, and report track sections that no route uses.
   - Trams are out of this task: street-running trams would drive through cars.
2. **Timetable.** Each route gets a direction, a headway and an offset:
   - **Defaults:** S-Bahn every 4 minutes per direction, a main-line train every 6 minutes per
     direction.
   - **Constants:** keep them in one module (no settings UI) so the owner can tune them later.
   - **Train lengths:** S-Bahn 135 m (two units), main line 200 m.
   - **Offsets** are deterministic from the route ids, not random per run.
   - **Service hours:** trains run all day.
   - **Collisions:** no two trains may ever occupy the same track section at the same time. Opposite
     directions on single track and merging routes must be spaced by the timetable. A train
     waits at a boundary end before entering rather than overlap.
3. **Motion.**
   - **Speed:** trains run at the track's max speed, else 80 km/h for S-Bahn and 100 km/h for the
     main line.
   - **Stops:** they accelerate at 0.8 m/s² and brake at 0.8 m/s² for stops. An S-Bahn stops
     with its middle at the platform's middle and dwells 40 s.
   - **Function:** position, heading and car poses along the track are a pure function
     `trainsAt(rail, timetable, timeS)`, with no state carried between frames, so seeking, pausing
     and replaying give the same picture.
   - **Module:** put it in a new module (suggested `src/network/trains.ts`). It must not import
     `src/sim/**`.
4. **Drawing.** Draw trains in 2D and 3D on their tracks:
   - **Shape:** articulated cars following the track's curve (S-Bahn red and white, main line grey
     or blue), each car about 25 m.
   - **Grades:** on bridges and in tunnels they use the track's grade drawing. In a tunnel they
     follow "See below ground".
   - **Visibility:** the Rail toggle shows and hides them with the tracks.
   - **Selection:** selecting a train shows its kind, route ends, whether it stops at the
     station, and its next stop or exit.
   - **Pausing:** a paused simulation draws no extra frames for trains (render on demand stays on
     demand). They move only when the clock moves.
5. **Level crossings.** Trains cross roads at grade in Sindelfingen. Cars do not stop for them in
   this task: there are no barriers, and car behaviour must not change. Report how often a train
   occupies each level crossing per hour, so a later task can add barriers.
6. **Measure.** Per city:
   - routes, trains per hour by kind, and the Donnersbergerbrücke stops per hour;
   - track sections in use and level-crossing occupancy per hour;
   - the time to build routes and timetable on import or compile;
   - the frame time with trains running against the Rail layer off, in 2D and 3D, on Munich.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a file
named under "Out of scope", a contract change this task does not describe, or a behaviour change
to another feature.

Pre-approved, no need to ask:
- new modules for routes, timetable and motion, and train layers in `src/render/` and
  `src/render3d/`;
- `src/network/rail.ts` and `src/importers/osm/rail.ts` (the preferred direction and anything the
  routes need), `src/schema/rail.ts`, `rail.schema.ts` (optional fields, with tests);
- `src/render/scene.ts`, `src/render3d/scene.ts`, `src/render/picking.ts`, the rail inspector and
  the Layers UI;
- `docs/architecture.md` sections 4, 5 and 11;
- `bench/import-probe.ts` (a train census);
- tests: a new `tests/network/T64-trains.test.ts`, a new e2e spec
  `tests/e2e/T64-trains.spec.ts`, `T62` tests, plus the hash pins that move, each named with its
  reason.

## Out of scope

- `src/sim/**`, `src/demand/**`, `src/routing/**`: no change to cars, walkers, trips, routes or the
  simulation hash. TASK-125 works in `src/sim` now.
- Road lanes, junctions, parking and connectors. The lanes and movements hash stays equal to main's.
- Trams, level-crossing barriers and car behaviour at crossings.
- People getting on or off trains (TASK-128).
- A timetable editor or settings UI.

## Gates

1. **Rule.** In T64, on synthetic fixtures:
   - **Switches:** a double track with a crossover; trains follow only permitted connections and
     never reverse at a switch.
   - **Preferred direction:** a one-way track is used only in its tagged direction.
   - **Stops:** a station on the route makes an S-Bahn stop for 40 s with its middle at the
     platform's middle, and a main-line train passes it.
   - **No collisions:** sampled every second over 24 hours, no two trains occupy the same section
     at the same time.
   - **Determinism:** `trainsAt` at the same time gives the same poses, whether reached by
     stepping or by seeking.
   - **Hashes:** same input, same timetable hash. Save and load keep the preferred direction.
2. **Traffic unchanged.** `npm run test:traffic:light` passes with every count equal to main's
   at your branch point. The simulation hash and the lanes and movements hash are equal to
   main's.
3. **Munich.**
   - **Donnersbergerbrücke:** S-Bahn trains stop at both S-Bahn platforms; main-line trains pass.
   - **Edges:** every train enters and leaves at the edge.
   - **Census:** report it (Design 6).
4. **Performance.**
   - **Build time:** building routes and timetable adds at most 5% to Munich and Sindelfingen
     compile.
   - **Frame time:** with trains running, Munich frame time is within 10% of the Rail layer off,
     in 2D and 3D. Measure on an idle machine, twice, and report both runs.
   - **On CI:** the frame gate skips there, as T44's and T62's do.
5. **Pictures.**
   - **Shots:** 2D and 3D shots of an S-Bahn standing at Donnersbergerbrücke, a main-line train
     crossing under the Donnersberger bridge, and a Sindelfingen train at a level crossing.
   - **Check them yourself:** cars sit on their tracks, follow curves without cutting corners,
     and are hidden in tunnels unless "See below ground" is on.
6. **Checks.** The light tier (AGENTS.md "Delivering a task"):
   - `npm run check`, `npm run test:city`, `npm run test:traffic:light` and
     `npm run test:e2e:light` are green;
   - so are your T64 spec and `T62-rail-stations`, `gate4-layers` and `V97-grade-shadows`.

   Run e2e with `CITYFLOWS_TEST_PORT=5328` and `CITYFLOWS_PRODUCTION_TEST_PORT=5428`; never use
   port 4173 or 5173. Do not run the whole `npm run test:e2e`, `npm run test:traffic` or
   `npm run bench`; they run at checkpoints.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5328`), import Munich and play from 07:00 at
×5:
- watch S-Bahn trains arrive, stop and leave at Donnersbergerbrücke in 2D and in 3D;
- select one train;
- pause, and check that nothing moves;
- turn the Rail layer off and check that trains and tracks disappear together.

Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the route rule, the routes per city, and the unused track sections;
- the timetable as built: headways, offsets, how collisions are excluded, and where trains wait;
- the census and timings listed under Measure;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main.

Commit on `task/127-decorative-trains`; do not push or merge. The lead reviews only commits.
