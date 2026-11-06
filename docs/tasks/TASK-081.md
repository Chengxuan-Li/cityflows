# TASK-081 — Geometry audit and visual regression harness

Owner: unassigned
Gate: 5 (geometry rework, stage 1; owner round 4, 2026-11-06)
Depends on: TASK-074, TASK-078, TASK-079, TASK-080. Design: `docs/plan.md` "Geometry
rework" (the regression cases G1, G2 and the stages that will use this audit), and
`docs/architecture.md` sections 5.1 and 11. Read those before the code.

## Goal

The geometry rework replaces how roads, lanes and junctions are built. Every later stage must
show, in numbers and in pictures, that the owner's cases improved and nothing else got worse.
Build that instrument first and measure `main` with it.

## In scope

- `bench/geometry-audit.ts` (new; may import and extend `bench/junction-audit.ts` and the
  helpers in `tests/network/junction-audit.ts`), with `npm run geometry-audit` in
  `package.json`. For the grid, the town, Sindelfingen and Munich, per city (totals, worst 20
  with ids) and per named case, as a table and as JSON written to a path given on the command
  line:
  1. Corridor width error: for every road, sampled every 0.5 m along the centerline outside
     tapers, the distance from the centerline to each surface edge minus the expected half
     width (`|lateralOffsetM| ± W/2`); max and 95th percentile.
  2. Centre-line gap: for two-way pairs (`streetGroupId`) and opposite carriageways on one
     line, the distance between the two directions' median-side lane edges; max.
  3. Lane folds: lane polylines whose arc length runs backwards against the centerline's
     (a back-step), self-intersections, and segments whose heading turns more than 90 degrees
     in under 1 m; count and length.
  4. Through-road deviation: at every node where two road ends are within 30 degrees of
     opposite and of the highest class there (a through road), the largest distance between
     the drawn road edges across the junction and the edges of the OSM (canonical) centerline
     offset by the road's width, over the junction outline's extent.
  5. Unrelated overlap: area where surfaces of two same-grade roads that share no node (and
     are not one street) overlap.
  6. Junction polygon validity and bulge: self-intersections, and area of the outline plus
     curbs outside the convex hull of the trimmed road ends' corners widened by the curb
     radius.
  7. Discontinuities: at every node, the gap between consecutive road ends' edges that
     should meet (through and continuation joins).
  8. Marking offset error (TASK-079's measure) and marking length outside outlines.
- Named cases from the plan: G1 (`r:917`, `r:921`, `r:1059`, `r:1060`, node `n:919`), G2 (node
  `n:774` and the next side-street junction east on Landsberger Straße), B38's roads, B39's
  nodes (`n:312`, `n:305`, `n:201`, `n:194`), Marsstraße (`r:368`, `r:480`), and the round 3
  screenshots' locations where they can be identified (name them).
- `bench/geometry-shots.ts` (new) with `npm run geometry-shots -- <out-dir>`: starts the dev
  server on a free port, imports Munich through the app (as the e2e helpers do), hides tiles
  and places, and captures each named case at a fixed camera (centre and zoom recorded in the
  script) plus one overview, so before and after images line up exactly. Stops the server.
- `tests/bench/T34-geometry-audit.test.ts`: on small synthetic fixtures, each measure detects
  its defect (a road whose surface is built too narrow, a folded lane, a bulging outline, two
  overlapping unrelated roads, a broken join) and reports zero on clean geometry.

## Out of scope

- Any change to `src/` other than exporting a helper the audit needs (say which). Fixing the
  defects is stages 2 and 3.

## Acceptance

- T34 passes. `npm run geometry-audit` runs on `main` in under two minutes and its baseline
  (tables and JSON) is in the report; G1 and G2 show the owner's defects in numbers (say which
  numbers).
- `npm run geometry-shots` produces the case images on `main` (paths in the report; keep them
  outside `test-results`).
- `npm run check` green; e2e unaffected.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the measures as
implemented (exact definitions), the baseline tables, the case list with ids and camera
settings, the image paths, the final lines of `npm run check`. Commit in your git worktree; the
lead reviews only commits.
