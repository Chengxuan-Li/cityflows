# TASK-108 — Lane marking realism: hatched gores with chevrons, channelizing lines, a marking theme, standard arrows

Owner: unassigned
Gate: 8 (more realistic visuals, owner 2026-11-07); Phase 1 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/108-lane-markings` (created by the lead from main)
Depends on: TASK-079, TASK-088, TASK-091 (markings), TASK-098 (3D markings). Design: this file;
`docs/architecture.md` section 11 (rendering, markings). Read it and the marking code before
changing anything.

## Goal

The owner: "realistic lane marking: chevron + white channelizing lines, yellow vs white, lane
marking themes (by region/country e.g. usa, uk, germany ... low priority), more realistic arrow
shapes". Today:

- The area between a ramp and its motorway where they part or join is plain asphalt (or a
  TASK-063/TASK-092 gore surface in `src/network/junctions.ts`) with no hatching.
- Tapering lanes get two chevrons (`src/render/layers/transitions.ts`); nothing else does.
- Every marking colour and dash length is a single constant in `src/render/style.ts`.
- Arrows are simple shapes (`approachMarkings`, `drawMovementArrow` in
  `src/render/layers/roads.ts`); the 3D view (`src/render3d/markings.ts`) has lines but no
  arrows.

Make these look like German road markings first, behind a marking theme that later carries the
US and UK styles (TASK-114, low priority), and draw the same geometry in 2D and 3D.

Hard rule (as Gate 6): the planar geometry built from OSM is untouched. Road, node, place and
movement geometry, ids and the compiled city stay byte for byte as on main. Markings are drawn
from the compiled city; they never change it.

## Design

1. **One marking geometry module.** New `src/render/marking-geometry.ts`: pure functions from
   the compiled city to marking shapes in world metres (polylines with a width and a dash
   pattern, and filled polygons), with a colour role per shape (`edge`, `lane`, `centre`,
   `channel`, `hatch`, `arrow`, `stop`). `src/render/layers/roads.ts`,
   `junction-markings.ts`, `transitions.ts` and `src/render3d/markings.ts` draw from it, so 2D
   and 3D cannot disagree. Move existing marking geometry into it rather than duplicating it,
   and delete what it replaces.
2. **Theme.** A `MarkingTheme` in `src/render/style.ts`: a colour per role, line widths, and
   dash patterns per road class and role; and an arrow set. One theme, `de`, now, following
   the German RMS in spirit (widths 0.12 m in town, 0.15 m on motorways, 0.30 m for broad
   edge lines; lane dashes 3 m on, 6 m off in town and 6 m on, 12 m off on motorways and
   trunks; white everywhere). The theme is chosen in one place, so TASK-114 can add `us`
   (yellow centre lines between opposing traffic) and `uk` without touching the geometry.
3. **Gores and channelizing lines.** Where a ramp leaves or joins a motorway, trunk or another
   multi-lane road (the split and merge nodes TASK-071, TASK-080 and TASK-085 handle; the gore
   pieces in `src/network/junctions.ts`), take the area between the two lane edges from the
   physical nose back to where they are one line width apart:
   - outline it with solid channelizing lines (role `channel`);
   - fill it with chevron hatching (role `hatch`): stripes 0.5 m wide every 2 m (in town) or
     4 m (motorways), angled 45° and pointing against traffic, as on German exits;
   - where the gore is a raised nose (TASK-092), hatch only the painted part in front of it.
   The same applies to the taper areas `transitions.ts` marks with chevrons today, which become
   short hatched triangles.
4. **Arrows.** Replace the arrow shapes with standard ones: elongated straight, left, right,
   straight-and-left, straight-and-right, left-and-right arrows (5 m long in town, 7.5 m on
   roads with a limit of 70 km/h or more), and the diagonal lane-ending arrow before a lane
   drop or merge. Shapes are polygons in metres defined in the theme's arrow set; placement
   rules (TASK-079: where lanes differ, behind crossings) stay as they are.
5. **3D.** `src/render3d/markings.ts` draws everything from the module, arrows included, at the
   road surface height `heights.ts` gives (TASK-105 adds terrain in parallel; read heights
   only through it).
6. **No toggle needed**: markings are part of the road style. If a frame-time gate fails,
   simplify hatching at low zoom (drop stripes below a pixel threshold), not the geometry.

## In scope

`src/render/marking-geometry.ts` (new), `src/render/layers/roads.ts`,
`src/render/layers/junction-markings.ts`, `src/render/layers/transitions.ts`,
`src/render/style.ts` (theme), `src/render3d/markings.ts`, `src/render3d/scene.ts` (wiring
only); read-only use of `src/network/junctions.ts` gore pieces (add an export there only if the
gore outline is not reachable otherwise, and say so); `bench/geometry-shots.ts` (new cameras);
`docs/architecture.md` section 11 (describe what you built); tests (a new
`tests/render/V108-markings.test.ts` and updates to the marking tests that move: T28, T32, T40,
T41), each change named.

## Out of scope

`src/network` behaviour, `src/sim`, `src/routing`, the importer, access signs and `BUS` lane
text (TASK-107), the US and UK themes (TASK-114), crossing stripes' placement (TASK-091/094),
vehicles (TASK-100), terrain (TASK-105).

## Gates

1. **Network untouched.** For Munich, Sindelfingen, grid and town, `compile(city)` equals main's
   (a stable hash, in V108). The lead checks the benchmark hashes and the traffic gate at merge.
2. **One geometry.** In V108: the 2D layer and the 3D markings draw the same set of shapes from
   the module for a sample of roads and junctions (compare counts and bounding boxes).
3. **Gores.** Every motorway and trunk exit and entry in Munich and Sindelfingen gets a hatched
   gore with channelizing lines; no hatch stripe or arrow lies outside the road and junction
   surfaces; none crosses a travel lane's centreline.
4. **Arrows.** Each lane that showed an arrow on main shows the standard arrow for the same
   turns at the same place; the lane-ending arrow appears before each lane drop the network
   has.
5. **Render.** Shots before and after in 2D and 3D: new cameras `V108-munich-exit` (a ramp at
   the Mittlerer Ring), `V108-sindelfingen-exit` (an A81 exit), `V108-munich-arrows` (an
   approach with several turn lanes), plus `T93-n967`, `R6-n138` and `B53-sindelfingen-n110`.
   Read every image yourself: hatching sits inside the gore, chevrons point against traffic,
   arrows read clearly at street zoom and do not clutter the overview.
6. **Performance.** 2D frame time at both Munich zooms and 3D frame time within 20% of main
   (owner allowance, TASK-097); report all.
7. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5308`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, `npm run bench` or the full
  `npm run test:e2e`; the lead runs them at merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5308`), import Munich
and Sindelfingen, look at motorway exits and a multi-lane approach in 2D and 3D; describe what
you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the theme values and
arrow set as implemented; what moved into the marking module and what was deleted; gore counts
per city; times; image paths; expectations changed, each with its reason; the final lines of
`npm run check`.

Commit on `task/108-lane-markings`; do not push or merge. The lead reviews only commits.
