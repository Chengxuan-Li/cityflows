# TASK-066 — Smooth road curves on import

Owner: unassigned
Gate: 5 (owner backlog B29)
Depends on: TASK-048, TASK-054, TASK-056, TASK-061. Design: `docs/architecture.md` section 13
step 11 (fillets, class radii, the 2 m deviation bound, fixed junction nodes, moved
degree-two nodes, sampling), section 14 (T23). Read those before the code.

## Goal

Imported roads keep the shape exported from OpenStreetMap: straight segments meeting at
kinks wherever a mapper placed a vertex. The owner wants roads with realistic curvature.
Replace each interior kink, and each kink at a node that only joins two sections of one
street, with a circular arc tangent to both segments, with a radius that suits the road
class and never strays more than 2 m from the mapped vertex. Junctions stay exactly where
they are. Lanes, movements, markings and the junction outlines all follow from the
centerline, so nothing downstream changes.

## In scope

- `src/importers/osm/**`: a smoothing pass after topology, consolidation and splitting (a
  new `smooth.ts` is fine), called from the import pipeline; provenance `smoothed:<count>`.
- `src/geo/polyline.ts`, additive helpers only.
- Tests: `tests/importers/T23-smooth-import.test.ts` (new); `tests/importers/munich.test.ts`
  and the other importer baselines; `tests/network/junction-audit.ts` and
  `tests/network/T20-imported-junctions.test.ts` for the imported lane-pair lists, which carry
  lane ids and source-overlap reasons that the new geometry may change (update with reasons).

## Out of scope

- `src/network`, `src/sim`, `src/routing`, `src/render`, `src/ui`, the editor, hand-drawn and
  GeoJSON roads, the synthetic fixtures, roundabout ring geometry. TASK-065 runs in parallel
  in `src/sim`; TASK-067 in `.github`, `vite.config.ts` and the README.

## T23 (unit)

1. On Munich, Sindelfingen and downtown: every junction node keeps its position exactly; every
   smoothed road's centerline stays within 2 m of its original polyline; at every fillet the
   heading is continuous within 1 degree; at every moved degree-two node joining two sections
   of one street, the two sections meet with headings within 1 degree.
2. Radii: no fillet is tighter than its class radius unless the segment-length or deviation
   bound forced it, and the test reports the count of forced fillets per class on Munich.
3. Determinism: importing the same file twice gives identical cities.
4. Unchanged roads: a road with no interior vertices, a roundabout ring, and every road of the
   synthetic fixtures keep their centerlines.

## Acceptance

- T23 passes; the existing importer tests pass with their baselines updated and each change
  named (warning counts, dead-end and short-road lists by id, lane-pair overlap lists).
- Munich import probe at `--scale 0.15`: every connector pair routable, zero failed trips;
  report the probe table next to wave 12's (2 231 completed, 959 queued, peak 2 124).
- `npm run route-audit` zero on Munich and Sindelfingen; the four benchmark hashes unchanged
  (synthetic fixtures are not imported).
- Screenshots: a Munich curve (the Arnulfstraße bend or a Mittlerer Ring ramp) before and
  after, at a zoom where lane markings show.
- `npm run check` green; `npm run test:e2e` green on a port of your own.

## Commands

`npm run check`, `npm run test:e2e` (set `CITYFLOWS_TEST_PORT`), `npm run bench`,
`npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the T23 results and forced-fillet counts, the probe table, the baseline
changes and why, the screenshot paths, the final lines of `npm run check`, and anything found
on another surface.
