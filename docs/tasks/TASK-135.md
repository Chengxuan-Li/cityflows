# TASK-135 — Trams as their own kind of track

Owner: the lead, through a Claude Code subagent (owner's orchestration rule, 2026-11-11)
Gate: 10 candidates (owner backlog, 2026-11-11): rail and tram item 4
Branch: `task/135-tram-tracks` (created by the lead from main)
Depends on: TASK-126 (rail network), TASK-127 (trains), TASK-131 (junction groups, merged first).
Runs alongside:
- **TASK-133** (station furniture) adds new modules for platforms and stations.
- **TASK-140** (crossing walk links) changes `src/network/crossings.ts`, `walk.ts` and
  `walk-joins.ts`.

Stay out of their files.
Followed by: TASK-132 (rail heights), TASK-137 (tram stops), TASK-136 (level crossings) and
TASK-138 (tram vehicles).
Design: this file; `docs/architecture.md` sections 4 and 5 (rail network, TASK-126), 11
(rendering), 13 (OSM import). Read TASK-126's and TASK-127's contracts and reviews in
`docs/plan.md`.

## Goal

The owner (2026-11-11):

> "we may want to model them as a different type with distinct visual quality"

Today a tram track is a `RailKind` value. It is drawn almost like a railway: a narrower bed and
twin street-running rails above road surfaces in 2D, the same vertex-coloured bed in 3D. Make the
tram a distinct track type with its own look, so a viewer tells a tram line from a railway at a
glance, in 2D and 3D.

## Design

1. **Data.** Keep `kind: 'tram'`, and read the OSM tags that set a tram track's form:
   - **Where it runs:** `embedded=yes|no` on `railway=tram`, and `embedded_rails=tram` on a
     highway that carries the tram. An embedded track runs in the road; otherwise it has its own
     bed.
   - **Its surface:** `surface=grass` or `railway:track_ballast=no` for a grass track,
     `surface=asphalt` or `paving_stones` for a paved own bed, and otherwise ballast.
   - **Inference when untagged:** a tram track whose centreline lies within a drivable road's
     surface over at least 80% of its length is embedded. Otherwise it gets its own bed.

   Store the result as optional track fields (for example
   `form?: 'embedded' | 'grass' | 'paved' | 'ballast'`, with provenance `inferred` when no tag
   decided it). This is a contract change this task describes: record it in
   `docs/architecture.md` section 4, as an optional field without a version bump.
2. **2D look.**
   - **Embedded:** two thin dark grooved-rail lines flush with the road surface, at the 1 435 mm
     gauge, with no bed and no sleepers, drawn above road and junction surfaces and below
     crossing paint, as street-running rails are today.
   - **Own bed:** a narrow bed (about 3.2 m per track) in the bed's colour (green for grass, warm
     grey for paved, stone grey for ballast), with the two rails and no visible sleepers on grass
     or paved beds.
   - **Railways keep their look.** The tram palette goes in `src/render/style.ts`, in the light
     and dark themes.
3. **3D look.**
   - **Embedded:** rails as thin raised strips on the road surface.
   - **Own bed:** a low bed, grass-textured or coloured, with rails on top.
   - **Railways keep their ballast bed and sleepers.**
   - **Detail:** keep to the existing vertex-colour batching; no new textures beyond a simple
     procedural grass tone.
4. **Inspection.** Hovering or selecting a tram track (if rail tracks are pickable today) shows
   "Tram" and its form. If tracks are not pickable, skip this.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report.

Pre-approved:
- `src/schema/rail.ts` and its zod schema;
- `src/importers/osm/rail.ts`;
- `src/network/rail.ts` (if compile carries the form);
- `src/render/rail-geometry.ts`, `src/render/layers/rail.ts`, `src/render/style.ts`;
- `src/render3d/rail.ts`, `src/render3d/geometry.ts` (rail parts only);
- `docs/architecture.md` sections 4 and 11;
- tests: new `tests/importers/T69-tram-tracks.test.ts` and `tests/render/T69-tram-tracks.test.ts`
  (or names that fit the layout), shot specs, and pins that move, each with its reason.

## Out of scope

- `src/network/crossings.ts`, `walk.ts`, `walk-joins.ts` (TASK-140).
- Station and platform drawing (TASK-133).
- `src/sim/**`, `src/demand/**`.
- Road geometry and junctions (TASK-131).
- Overhead lines (TASK-134).
- Track heights (TASK-132).
- Level crossings (TASK-136).
- Tram stops (TASK-137).
- Tram vehicles (TASK-138).

## Gates

1. **Rules.** In T69, on synthetic OSM:
   - tagged forms import as tagged;
   - an untagged tram inside a road is embedded, and one outside is ballast;
   - railways are unchanged;
   - same import, same city hash.
2. **No other change.**
   - Car, walker and train simulation hashes equal main's.
   - Road geometry equals main's.
   - Every non-tram rail track imports as on main.
3. **Pictures.**
   - 2D and 3D shots of Munich's tram lines: Arnulfstraße's tram median by `n:638`, Landsberger
     by `n:247`, and one embedded street-running stretch if Munich has one. Compare them with the
     aerial imagery the owner sent (`C:\Users\cl2749\AppData\Local\Temp\claude\0a54181e9b991e1f\46bd7828-7b2b-4c90-a8d0-e2d5928c54b2\images\1.webp`
     and `2.webp`; reference only, do not commit them).
   - A railway track beside a tram track in one shot, to show the two clearly differ.
   - Check them yourself.
4. **Performance.** Munich load time and frame time within 5% of main.
5. **Checks.**
   - `npm run check` and `npm run test:city` are green.
   - `npm run test:e2e:light` passes, plus T62-rail-stations and T64-trains, with
     `CITYFLOWS_TEST_PORT=5335` and `CITYFLOWS_PRODUCTION_TEST_PORT=5435`.

## Deliverable

A report in the body of your last commit message:
- the forms and the inference rule, and the counts per city;
- the shots;
- every changed pin with its reason;
- files outside the pre-approved list;
- the final lines of `npm run check`.

Commit on `task/135-tram-tracks`; do not push or merge.
