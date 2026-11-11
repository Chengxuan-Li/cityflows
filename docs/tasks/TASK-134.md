# TASK-134 — Overhead lines

Owner: the lead, through a Claude Code subagent (owner's orchestration rule, 2026-11-11)
Gate: 10 candidates (owner backlog, 2026-11-11): rail and tram item 3
Branch: `task/134-overhead-lines` (created by the lead from main)
Depends on: TASK-126 (rail network), TASK-132 (rail heights), TASK-135 (tram tracks), all merged.
Runs alongside: TASK-137 (tram stops), in new tram-stop modules, `src/schema/rail.ts` (optional tram
stops) and small scene hooks. Put this task's work in new modules (suggested
`src/network/catenary.ts`, `src/render/layers/catenary.ts`, `src/render3d/catenary.ts`) with small
hooks; do not change `src/schema/rail.ts` unless an optional field is unavoidable, and say so.
Design: this file; `docs/architecture.md` sections 4 and 5 (rail network, TASK-132 heights), 11
(rendering). Read TASK-132's and TASK-135's contracts and reviews in `docs/plan.md`.

## Goal

The owner (2026-11-11): overhead power lines for train tracks, but not modelled per track. Where
tracks run parallel or in similar directions close to each other, they share supporting poles with
a truss or portal across the top, and a catenary hangs over each track. If a tag says a track has an
overhead line, draw it; if a tag says it has none, do not; with no tag, draw it anyway.

## Design

1. **Which tracks.** `electrified=contact_line` or `yes` (and `electrified:rail` absent) → wired;
   `electrified=no`, `rail` (third rail) or `4th_rail` → not wired; no tag → wired. Tunnels carry the
   wire on the tube ceiling (drawn only with "See below ground"); bridges carry it on the deck.
   Trams (TASK-135) are wired by the same rule; embedded street trams hang from span wires or
   building fixings in reality, so give them simple side poles with a bracket.
2. **Shared supports.** Group wired track sections into bundles: sections whose centrelines run
   within 30 degrees of each other and within about 25 m of the bundle's edge, along stretches.
   Along each bundle place support positions about every 50 m (60 m on straight track, 40 m on
   curves tighter than 500 m radius), aligned across the bundle's tracks, kept clear of switches'
   frogs, level crossings, road surfaces and platforms (shift along the track up to 10 m to clear
   them). At each position: one mast on each outer side and a portal or headspan truss across, for
   a bundle of three or more tracks; a single mast with a cantilever arm for one or two tracks.
   Use mapped `power=catenary_mast` nodes (and `railway=...` portal ways if present) as fixed
   positions where they exist.
3. **Wires.** Over each wired track a contact wire at 5.5 m above the rail (TASK-132's height) and
   a messenger wire 1.2 m above it, hanging between supports with a slight sag; droppers optional at
   high zoom in 3D.
4. **2D.** Masts as small squares or dots at the bundle's edges, portals as thin lines across, wires
   as hairlines over the tracks at high zoom only; a Rail sub-layer toggle "Overhead lines".
5. **3D.** Masts, portals and arms as batched boxes; wires as thin lines or flat ribbons; one draw
   call per kind. Respect "See below ground" for tunnel sections.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report.

Pre-approved:
- new modules above; small hooks in `src/render/scene.ts`, `src/render3d/scene.ts`, the layers
  panel;
- reading `electrified` tags in `src/importers/osm/rail.ts` (a small function) if they are not kept
  today, with an optional track field;
- `docs/architecture.md` section 11 (and 4 if a field is added);
- tests: new `tests/network/T74-catenary.test.ts`, a T74 shot spec, and pins that move, each with
  its reason.

## Out of scope

- Tram stops (TASK-137); the rail height rules (TASK-132's output must not change).
- `src/sim/**`, `src/demand/**`, routing, road geometry.

## Gates

1. **Rules.** In T74, on synthetic rail: tagged `electrified=no` gets no wire; untagged gets one;
   four parallel tracks share portals at aligned positions; a single track gets cantilever masts;
   supports never stand on a switch frog, a level crossing, a road surface or a platform; same
   import, same placement.
2. **Munich.** Counts of wired and unwired sections, bundles, masts and portals; every mapped
   `power=catenary_mast` used or listed with a reason.
3. **No other change.** Simulation and timetable hashes, road geometry, TASK-132's heights and T70
   equal main's.
4. **Pictures.** 2D and 3D shots of the main-line track field west of Donnersbergerbrücke (portals
   across many tracks), a single or double track with cantilevers, a bridge section, and a tram line
   on Arnulfstraße. Check them yourself.
5. **Performance.** Munich load within 5% of main and the 3D frame time within 5% over the track
   field.
6. **Checks.** `npm run check`, `npm run test:city` green; `npm run test:e2e:light` plus T62, T64 and
   T70, with `CITYFLOWS_TEST_PORT=5334` and `CITYFLOWS_PRODUCTION_TEST_PORT=5434`.

## Deliverable

A report in the body of your last commit message: the wiring rule, bundling and spacing rules,
counts, shots, timings, pins changed with reasons, files outside the pre-approved list, and the
final lines of `npm run check`.

Commit on `task/134-overhead-lines`; do not push or merge.
