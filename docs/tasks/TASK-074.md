# TASK-074 — Junction shapes: no overlapping road ends, smooth curbs, measured on the real cities

Owner: unassigned
Gate: 5 (owner findings B16, B21, B23 and 2026-11-05 point 1, round 2 point 2)
Depends on: TASK-061, TASK-063, TASK-068, TASK-071, TASK-072. Design: `docs/architecture.md`
section 5.1 (TASK-063 outline, TASK-074 junction shapes), section 11, section 14 (T27). Read
those before the code.

## Goal

Junctions improved with TASK-063 and TASK-068, but the owner still finds many far from
satisfactory: road ends that overlap each other or poke past the junction, curbs that kink,
markings that run into a neighbouring road. 101 Munich road ends still sit at the 10 m
setback cap, which is where most of the overlap comes from. The cap stays (lifting it cut
approach lanes to stubs, TASK-065 review). Build the junction shape the way SUMO's
netconvert computes node shapes, measure every junction of the four cities before and
after, and fix the worst classes of defect.

SUMO is EPL-2.0 or GPL-2.0-or-later, so its node-shape algorithm (`NBNodeShapeComputer` in
`src/netbuild/NBNodeShapeComputer.cpp`) may be read and adapted; add an entry to `NOTICE`
naming what was adapted. Do not copy code verbatim.

## In scope

- `bench/junction-audit.ts` (new, first commit): for every node of the grid, the town,
  Sindelfingen and Munich, the section 5.1 TASK-074 defect measures, a per-city summary, and
  the 20 worst nodes by overlap area with their ids. Run it on `main` before any other
  change and put the baseline in the report.
- `src/network/junctions.ts`: setbacks and the outline per section 5.1 TASK-074.
- `src/geo/polyline.ts`: helpers, additively.
- `src/render/layers/nodes.ts`, and in `src/render/layers/roads.ts` only the lane-marking
  clip of section 11 (TASK-074) inside `drawRoad`. TASK-075 adds a separate layer for
  markings across junctions in parallel; do not add markings inside junctions.
- `NOTICE`, one entry.
- Tests: `tests/network/T27-junction-shapes.test.ts`, and the existing T25 hashes and
  geometry expectations that move (name each, with the reason, in the report).

## Out of scope

- `src/importers` (no change to the smoothing or realignment), `src/sim`, `src/routing`,
  `src/ui`, `src/render/scene.ts` and the new junction-markings layer (TASK-075).
- The setback cap (`SETBACK_CAP_M` stays 10 m) and continuation nodes (TASK-071: setbacks 0,
  no outline; T25's continuation assertions must hold unchanged).
- If the junction shape needs a schema change or a change to how movements are built, stop
  and report.

## T27 (unit)

1. On the four cities: zero outline self-intersections; every movement surface inside its
   node outline (0.1 m tolerance); every road end's trimmed edge on the outline.
2. Road-end overlap outside outlines (the area where two road surfaces of one node overlap
   and the outline does not cover them) falls by at least half on Munich and Sindelfingen
   against the baseline, and is zero on the grid and the town.
3. Curb continuity: where the outline joins a road edge with a fillet, the tangent turns by
   less than 5 degrees; gore tips are the only corners sharper than 30 degrees.
4. No lane marking of one road is drawn inside another road's surface or inside an outline.
5. Approach lane storage: no Munich lane loses more than 2 m to the new setbacks against
   main (the TASK-065 failure mode), and Munich at `--scale 0.15` completes at least main's
   count by 10:00.

## Acceptance

- T27 passes; T25's continuation assertions hold; other existing geometry tests keep their
  intent.
- The audit's before and after tables in the report, with the 20 worst nodes before and
  their measures after.
- Screenshots, before and after, of the five worst Munich junctions by the audit, and of any
  junction the owner sends to the lead during the wave (the lead forwards them).
- Benchmark hashes: report them; geometry changes may move them, completed may not fall.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`node --experimental-strip-types --import ./bench/register.ts ./bench/junction-audit.ts`,
`npm run bench`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the audit tables, the T27 results, the hashes and Munich numbers, each
changed test expectation and why, the screenshot paths, the final lines of `npm run check`,
and anything found on another surface. Commit your work in a git worktree of this
repository; the lead reviews only commits.
