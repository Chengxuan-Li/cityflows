# TASK-068 — Realign acute approaches on import, and find what smoothing cost

Owner: unassigned
Gate: 5 (owner backlog B31, B30; the route to B26 and B21 now that the setback cap stays)
Depends on: TASK-061, TASK-063, TASK-065, TASK-066. Design: `docs/architecture.md` section
13 step 12 (which pairs, which arm, `L`, the 60 degree target, the 8 m shift bound, what is
left alone), section 5.1 (setbacks and the permanent 10 m cap), section 14 (T24). Read those
before the code.

## Goal

At acute junctions cars stop well before the junction (B26). A lane meeting another at a
sharp angle only clears its neighbour far out, and following that geometry by lifting the
setback cap cut Munich's approach lanes to stubs and cost a quarter of the morning (TASK-065
review). Real roads are built differently: a minor street that would meet another at a
sharp angle is bent in its last stretch so it meets at a usable angle. Do that on import:
the realigned approach clears its neighbour close to the node, its setback is short, its
lane keeps its queue storage, and its stop line sits at the junction. Merges and diverges
are acute by design and stay as they are.

First, find what TASK-066's smoothing cost (B30): Munich at scale 0.15 completes 2 005 trips
by 10:00 on main with smoothing against 2 231 before it, with routes, junction headings and
warning lists unchanged. Attribute it before changing geometry again, so the two effects
are not confused, and fix it if the cause is in the importer.

## In scope

- `src/importers/osm/**`: the realignment pass after smoothing (a new `realign.ts` is fine),
  wired into the pipeline; `realigned:<degrees>` provenance; the `realign_limited` warning.
  Any importer-side fix for B30, with the evidence.
- `src/geo/polyline.ts`, additive helpers only.
- `fixtures/osm/`: a small hand-written acute-Y extract for T24, with `ATTRIBUTION.txt`
  updated if it derives from OSM data.
- Tests: `tests/importers/T24-acute-approaches.test.ts` (new), `tests/importers` baselines,
  the imported lane-pair lists in `tests/network/junction-audit.ts` and
  `tests/network/T20-imported-junctions.test.ts`, `tests/routing/throughput-routes.json`
  (capture again if imported geometry changes, after checking the change is only geometric).
- `bench/` for an attribution script if useful.

## Out of scope

- `src/network` (the setback rule and the cap stay), `src/sim`, `src/routing`, `src/render`,
  `src/ui`, the editor, the synthetic fixtures. TASK-069 runs in parallel in
  `src/network/types.ts`, `src/network/diagnostics.ts`, `src/ui` and `tests/e2e`; it also
  changes the warning-count table in `tests/importers/munich.test.ts`. Change that table only
  for your own geometry; the lead reconciles it at merge.

## B30 first

Report, before any realignment code: Munich at 0.15 on main with smoothing on and with it
off (the pass skipped, nothing else changed), completed, queued and peak; then which
junctions gained or lost queue (`bench/zone-probe.ts` from TASK-065 samples refusals by
movement), and what in the smoothed geometry differs there (approach headings at seams,
setbacks, movement lengths, lane lengths). Fix it in the importer if the cause is there;
otherwise report it with ids.

## T24 (unit)

1. On the acute-Y fixture: the minor approach meets the major road at 60 degrees or more
   after import; its lateral shift stays within 8 m; the node and the major road are exactly
   where they were; both directions of the minor street are realigned identically.
2. Merges untouched: a motorway on-ramp and a diverge in Munich and Sindelfingen keep their
   centerlines exactly.
3. Setbacks: on Munich, count the road ends whose setback reaches the cap and the approach
   lanes shorter than 10 m, before and after; both counts fall.
4. Determinism: importing twice gives identical cities.

## Acceptance

- T24 passes; T20, T23 and the importer tests pass with baselines updated and each change
  named.
- Munich at `--scale 0.15`: every connector pair routable, zero failed trips, completed by
  10:00 at least 2 023 (main today); report against 2 005, 2 023 and 2 231, and the T24
  counts. `npm run route-audit` zero on Munich and Sindelfingen.
- The four benchmark hashes unchanged (synthetic fixtures are not imported).
- Screenshots on Munich: an acute approach before and after, with a queue at its stop line.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped:
  owner decision).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npm run bench`, `npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the B30
attribution and any fix, what works, what is not supported, the T24 results and counts, the
probe table, each baseline change and why, the screenshot paths, the final lines of
`npm run check`, and anything found on another surface. Commit your work; the lead reviews
only commits.
