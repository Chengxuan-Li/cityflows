# TASK-117 — Visual fixes after Phase 2: sign collisions, UK kerb lines, signs by theme

Owner: unassigned
Gate: 8 (more realistic visuals); Phase 3 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/117-visual-fixes` (created by the lead from main)
Depends on: TASK-107 (access signs, `src/render/street.ts`), TASK-114 (marking themes). Design:
this file; `docs/architecture.md` sections 4 (`City.markingTheme`) and 11 (rendering, the
TASK-107 and TASK-114 notes). Read those before the code.

## Goal

Three visual defects the lead found while reviewing Phase 2, each small, all in the renderer:
access signs at neighbouring zone entries overlap each other; the UK theme paints yellow lines
along every edge, including motorways and medians; and every city shows German access signs,
whatever its marking theme.

## Design

1. **Sign collisions.** `placeStreet` puts one sign 4 m into each entering road on the kerb
   side. Where two entries are close (Munich: an Anlieger frei sign over a Lieferverkehr frei
   label, `V114-munich-us` camera), their faces and labels overlap in 2D and their posts
   collide in 3D. After placing every sign, resolve collisions deterministically: estimate
   each sign's 2D footprint (disc plus label plate at its world size) and move a later sign
   (by road index) further along its own kerb, up to 12 m from the junction, until no
   footprint overlaps and posts are at least 1.5 m apart; when two entries of the same street
   group carry the same rules, keep one sign. A sign that still collides at 12 m stays where
   it is and is counted. Drawing code stays as it is apart from the new positions.
2. **UK kerb lines.** In the UK theme, yellow edge lines mark the kerb (TSRGD no-waiting
   lines, the owner's Gate 8.5 wording); they belong on the kerb side of urban streets only.
   Keep yellow for the kerb (nearside) edge of `residential`, `unclassified`, `tertiary`,
   `secondary`, `primary` and `living_street` roads; motorways, trunks, all ramps and every
   median or offside edge get white edge lines. Germany and the United States are unchanged.
   TASK-103 (in parallel) adds roadside parking strips, and a kerb with parking carries no
   no-waiting line: write the kerb-line choice as one function of the road and side so the
   lead can skip strip runs at merge.
3. **Signs by theme (low priority, last).** Access signs follow `City.markingTheme`:
   - `de`: unchanged (Verbot der Einfahrt, Anlieger frei, Lieferverkehr frei, Privatweg).
   - `us` (MUTCD): DO NOT ENTER (R5-1) for `no`; a white rectangular LOCAL TRAFFIC ONLY,
     DELIVERIES ONLY or PRIVATE ROAD regulatory plate for the others.
   - `uk` (TSRGD): No entry (diagram 616) for `no`; No motor vehicles (diagram 619) with an
     "Except for access", "Except for loading" or "Private road" plate for the others.
   Shapes and colours drawn in code as today, no image assets, the same footprint rule as
   item 1. Switching the theme redraws signs in 2D and 3D (the TASK-115 invalidation rule).
4. **Measure.** Sign collisions before and after per city (2D footprint overlaps and posts
   closer than 1.5 m), signs moved and merged, and placement time against main.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, renderer layers
and setters, dev pages, fixture builders, shared types, test helpers), as long as it is not
named under "Out of scope"; list each such file and why in your report. Stop and ask the lead
only for a file named under "Out of scope", a contract change this task does not describe, or
a behaviour change to another feature.

Pre-approved, no need to ask: `src/render/street.ts` (sign placement), `src/render/layers/street.ts`,
`src/render3d/street.ts`, `src/render/marking-geometry.ts`, `src/render/style.ts`,
`src/render/scene.ts`, `src/render3d/scene.ts` (redraw on theme change);
`bench/geometry-shots.ts` (new cameras); `docs/architecture.md` section 11; tests (a new
`tests/render/V117-visual-fixes.test.ts`, the V107 and V114 cases that move, an e2e case tagged
`@smoke` if the theme switch needs one), and the expectations that move, each named with its
reason.

## Out of scope

`src/network`, `src/sim`, `src/routing`, the importers, the schema (no new fields), roadside
strips and parked cars (TASK-103, in parallel; it also edits `src/render/street.ts` for kerbs
and lamps beside a parking band, and the lead reconciles the two at merge), pedestrians and
pedestrian signals (TASK-111), German marking output, lamp and kerb placement.

## Gates

1. **Nothing else moves.** Compile hashes for grid, town, Munich and Sindelfingen equal
   main's; German and US paint equal main's (V114's German fingerprints and V108 unchanged);
   lamps and curbs from `placeStreet` equal main's (hash them).
2. **Signs.** In V117: two entries 3 m apart get non-overlapping footprints and posts at least
   1.5 m apart; same-rule entries of one street group keep one sign; placement is
   deterministic; Munich and Sindelfingen report zero remaining collisions or name each one
   and why.
3. **UK lines.** In V117: on a synthetic motorway and ramp every UK edge is white; on a
   residential two-way street the kerb edges are yellow and nothing else is; on a divided
   primary the median edges are white.
4. **Signs by theme.** Each theme draws its own sign set for all four rules in 2D and 3D, and
   a theme switch redraws them without a restart.
5. **Render.** 2D and 3D shots: `V117-munich-signs` (the overlapping entries from
   `V114-munich-us`, German theme), `V117-munich-signs-us`, `V117-munich-signs-uk`,
   `V117-munich-motorway-uk` (the Donnersberger motorway section), and the 3D versions of the
   sign cameras; read them yourself: no sign overlaps another, UK yellow only along urban
   kerbs, sign sets match the theme, nothing else moves. Frame time unchanged within noise.
6. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Heavy e2e cases need
   `test.setTimeout(420_000)` for CI's software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5317`;
   never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, the full `npm run test:e2e` or
  `npm run bench`; the lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5317`), import
Munich, look at the zone entries in 2D and 3D, switch the marking style through Germany,
United States and United Kingdom and watch signs and kerb lines change; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the collision rule
and kerb-line rule as implemented, collisions before and after per city, the sign sets per
theme, image paths, files changed outside the pre-approved list and why, expectations changed
with their reasons, and the final lines of `npm run check`. Report every timing that grew
against main, even when no gate covers it. Write any Markdown or docs as UTF-8.

Commit on `task/117-visual-fixes`; do not push or merge. The lead reviews only commits.
