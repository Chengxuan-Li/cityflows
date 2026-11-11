# TASK-137 — Tram stops

Owner: the lead, through a Claude Code subagent (owner's orchestration rule, 2026-11-11)
Gate: 10 candidates (owner backlog, 2026-11-11): rail and tram item 6
Branch: `task/137-tram-stops` (created by the lead from main)
Depends on: TASK-126 (rail network), TASK-133 (station furniture), TASK-135 (tram tracks), all
merged.
Runs alongside: TASK-132 (rail heights), in `src/network/rail.ts`, `src/render/rail-geometry.ts`,
`src/render/layers/rail.ts`, `src/render3d/rail.ts` and small functions in
`src/importers/osm/rail.ts`; and TASK-140 (crossing walk links) in `src/network/crossings.ts`,
`walk*.ts` and `conflicts.ts`. Put this task's work in new modules (suggested
`src/importers/osm/tram-stops.ts`, `src/render/layers/tram-stops.ts`, `src/render3d/tram-stops.ts`)
with small hooks; reuse TASK-133's furniture helpers where they fit without changing their output.
Followed by: TASK-138 (tram vehicles), which will stop at these stops.
Design: this file; `docs/architecture.md` sections 4 and 5 (rail network, stations), 11 (rendering).
Read TASK-133's and TASK-135's contracts and reviews in `docs/plan.md`.

## Goal

Tram stops, often in the middle of the street, become visible stops: raised platform islands
beside the tram tracks, shelters, the stop's name, markings and a simple display. Munich's extract
has 19 `railway=tram_stop` nodes and tram `public_transport=platform` features around
Arnulfstraße and Landsberger. Visual only this round: no trams run yet (TASK-138), so the display
shows the stop's name and lines (`route_ref` or the route relations when present), not times.

## Design

1. **Import.** Read `railway=tram_stop` / `public_transport=stop_position` nodes on tram tracks and
   `public_transport=platform` (+`tram=yes`, or `railway=platform` beside a tram track) ways and
   nodes, with `name`, `route_ref`, `shelter`, `bench`, `covered`, `tactile_paving`. Group them into
   tram stops (one per name per side or island), each tied to the tram track sections it serves.
   Store them as an optional part of the rail network (for example `RailNetwork.tramStops`), a
   contract change this task describes: record it in `docs/architecture.md` section 4, optional,
   no version bump. Mapped platform shapes are kept as they are; a stop with only a node gets a
   platform island generated beside its track (about 2.5 m wide, 30 m long, on the side the
   platform node lies, or as a centre island between the two tracks), clipped so it never covers a
   carriageway lane.
2. **2D.** Platform islands with a curb edge and tactile strip, a shelter outline where tagged or
   by default at the island's middle, the stop name at high zoom, and a "tram stop" marking on the
   track (a thin box or the conventional zigzag edge line).
3. **3D.** Raised islands (0.25 m), shelters (reuse TASK-133's canopy builder if it fits), name
   boards, and a small display panel with name and lines; batched per kind.
4. **Walk network.** No change this round; report whether the islands' walk access exists in OSM.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report.

Pre-approved:
- new modules above; a small hook in `src/importers/osm/rail.ts` or `index.ts`;
- `src/schema/rail.ts` and its zod schema (the optional tram stops);
- small hooks in `src/render/scene.ts` and `src/render3d/scene.ts`;
- the rail inspector (`src/ui/inspector/rail.tsx`) to show a stop;
- `docs/architecture.md` sections 4 and 11;
- tests: new `tests/importers/T73-tram-stops.test.ts`, `tests/render/T73-tram-stops.test.ts`, a T73
  shot spec, and pins that move (city hash pins), each with its reason.

## Out of scope

- `src/network/rail.ts`, `src/render/rail-geometry.ts`, `src/render/layers/rail.ts`,
  `src/render3d/rail.ts` (TASK-132); crossings and walk links (TASK-140); station furniture output
  (TASK-133) must not change.
- `src/sim/**`, `src/demand/**`, routing, road geometry.
- Tram vehicles and timetables (TASK-138).

## Gates

1. **Rules.** In T73, on synthetic OSM: stops group by name and side; mapped platforms keep their
   shapes; a node-only stop gets an island beside its track that covers no carriageway lane; same
   import, same hash.
2. **Munich.** Every `railway=tram_stop` in the extract becomes a stop or is listed with a reason;
   report counts of mapped and generated platforms.
3. **No other change.** Simulation hashes and road geometry equal main's; TASK-133's furniture and
   T70 unchanged.
4. **Pictures.** 2D and 3D shots of the Arnulfstraße and Landsberger tram stops near `n:638` and
   `n:247`, compared with the owner's imagery (`C:\Users\cl2749\AppData\Local\Temp\claude\0a54181e9b991e1f\46bd7828-7b2b-4c90-a8d0-e2d5928c54b2\images\1.webp`,
   `2.webp`; reference only, never commit them). Check them yourself.
5. **Performance.** Munich load and frame time within 5% of main.
6. **Checks.** `npm run check`, `npm run test:city` green; `npm run test:e2e:light` plus T62, T64 and
   T70, with `CITYFLOWS_TEST_PORT=5337` and `CITYFLOWS_PRODUCTION_TEST_PORT=5437`.

## Deliverable

A report in the body of your last commit message: the import and grouping rules, counts, shots,
pins changed with reasons, files outside the pre-approved list, and the final lines of
`npm run check`.

Commit on `task/137-tram-stops`; do not push or merge.
