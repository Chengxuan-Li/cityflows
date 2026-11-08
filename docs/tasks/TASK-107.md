# TASK-107 — Street furniture: lamps, curbs, access signs and BUS lane text

Owner: unassigned
Gate: 8 (more realistic visuals, owner 2026-11-07), feature 8.4; Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/107-street-furniture` (created by the lead from main)
Depends on: TASK-101 (road access, zones, bus lanes), TASK-106 (placement rules for generated
street objects), TASK-108 (marking geometry). Sidewalks moved to TASK-110 (lead, 2026-11-08).
Design: this file; `docs/architecture.md` sections 4 (City), 11 (rendering) and 13 (OSM
import). Read those before the code.

## Goal

Streets have no lamps, no curbs and no visible access rules: TASK-101's closed roads,
local-traffic zones and bus lanes exist in the network but nothing on the map shows them. Add
street lamps (OSM and generated), a raised curb along road edges in 3D, a sign at each access
zone entry and on closed or restricted roads, and `BUS` text on bus-only lanes, in 2D and 3D.

Hard rule (as Gate 6 and 8): the planar geometry built from OSM is untouched. Road, node,
place and movement geometry, ids and the compiled city stay byte for byte as on main. The
simulation never reads the new data.

## Design

1. **Schema (contract change, pre-approved).** Context points gain `street_lamp`
   (`ContextPoint = 'tree' | 'street_lamp'`), with `heightM` from `height` and `sub` from
   `lamp_mount` or `support`. No `schemaVersion` bump. Describe it in section 4.
2. **Import.** `highway=street_lamp` nodes as context points, clipped to the bounds; the
   Overpass surroundings part adds them (keep your change one separate clause).
3. **Placement (one shared, pure module,** new `src/render/street.ts`, used by both renderers,
   deterministic from the city):
   - Generated lamps along streets where OSM has none within 25 m: spacing by class (about 30 m
     residential, 40 m tertiary to primary, none on motorways, trunks and ramps), on the curb
     side (both sides on wide roads, staggered), 0.5 m beyond the outer edge, skipped near
     junction nodes, crossings, place connectors and trees (TASK-106's placement), inside
     buildings and water. Marked generated, never saved.
   - Signs: at every road where a class's access changes from open to `no`, `destination`,
     `delivery` or `private` (zone entries from `CRoad.access` and `CRoad.zone`), one sign at
     the entering end on the curb side, showing the rule (German signs first: Verbot der
     Einfahrt, Anlieger frei, Lieferverkehr frei, Privatweg; the shapes and colours drawn in
     code, no image assets). One sign per entry, not per lane.
   - `BUS` text: on each lane whose `allowed` is bus only, the word `BUS` painted in the lane at
     the start and then about every 50 m, through the TASK-108 marking geometry so 2D and 3D
     read the same shapes.
4. **2D.** New `src/render/layers/street.ts`: lamps as small dots on the verge at street zoom,
   hidden at overview; signs as small icons at street zoom; `BUS` text with the lane markings.
5. **3D.** New `src/render3d/street.ts`: instanced lamp posts with a head, signs on posts at
   the curb, `BUS` paint with the markings (0.025 m clearance like other paint), and a raised
   curb (about 0.12 m) along the outer edge of every ground-level road, broken at crossings,
   place connectors (driveways) and junction corners, following terrain. Optional, low
   priority: lamps light up at night by the simulation clock.
6. **Layers.** "Street lights" (OSM and generated, default on), "Signs" (default on), "Curbs"
   (3D, default on); `BUS` text follows the existing markings toggle.
7. **Measure.** Per city: lamps by source, signs by rule, `BUS` labels, placement time, 2D and 3D
   frame time at both Munich zooms with the new layers on and off.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
view wiring, renderer layers and setters, dev pages, fixture builders, shared types, test
helpers), as long as it is not named under "Out of scope"; list each such file and why in
your report. Stop and ask the lead only for a file named under "Out of scope", a contract
change this task does not describe, or a behaviour change to another feature.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (the `street_lamp`
point); `src/importers/osm/context.ts`, `src/importers/overpass.ts` (surroundings part);
`src/render/street.ts` (new), `src/render/layers/street.ts` (new), `src/render/marking-geometry.ts`
(`BUS` text), `src/render/layers/roads.ts`, `src/render/scene.ts`, `src/render/style.ts`,
`src/render/types.ts`; `src/render3d/street.ts` (new), `src/render3d/markings.ts`,
`src/render3d/geometry.ts` (curb), `src/render3d/scene.ts`; `src/ui/layers.tsx`,
`src/ui/store.ts`, `src/ui/map-view.tsx`; `bench/geometry-shots.ts` (new cameras);
`docs/architecture.md` sections 4, 11 and 13; tests (a new `tests/render/V107-street.test.ts`,
an importer case, an e2e case tagged `@smoke`), and the expectations that move, each named with
its reason.

## Out of scope

`src/network`, `src/sim`, `src/routing`, the road importer's geometry, sidewalks and footways
(TASK-110), marking themes for other countries (TASK-114), trees (TASK-106), buildings
(TASK-109).

## Gates

1. **Network untouched.** For Munich, Sindelfingen, grid and town, `compile(city)` equals main's
   (the pinned hashes in T44, V106, V108 and T47 do not move).
2. **Placement.** In V107: deterministic; no generated lamp on a road surface, junction,
   crossing, connector, building or water polygon, none within 8 m of a tree; every access zone
   entry gets exactly one sign and open roads get none; every bus-only lane gets `BUS` text and
   no other lane does; curbs break at every crossing and connector.
3. **Import.** Lamp counts per city asserted within ±10%; save and open keep lamp points; a
   file without them opens.
4. **Render.** 2D and 3D shots (new cameras `V107-munich-street` on a residential street,
   `V107-munich-bus-lane` on a bus-only lane, `V107-munich-zone` at a local-traffic zone entry,
   and their 3D versions, plus `V106-munich-streets-3d`); read every image yourself: lamps on
   the verge, signs readable at street zoom, `BUS` upright in the lane in the travel direction,
   curbs continuous along the edge and open at crossings, roads still the strongest element.
5. **Performance.** Frame time with the new layers on within 20% of off, in 2D at the Munich
   overview and in 3D at both Munich zooms (owner allowance, TASK-097); report all.
6. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Heavy e2e cases need
   `test.setTimeout(420_000)` for CI's software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5307`;
   never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, the full `npm run test:e2e` or
  `npm run bench`; the lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5307`), import
Munich, look at a residential street, a bus lane and a zone entry in 2D and 3D, set a street to
"Local traffic only" in the street inspector and see its signs appear; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): sources and placement
rules as implemented, counts per city, times, image paths, files changed outside the
pre-approved list and why, expectations changed with their reasons, and the final lines of
`npm run check`. Write any Markdown or docs as UTF-8.

Commit on `task/107-street-furniture`; do not push or merge. The lead reviews only commits.
