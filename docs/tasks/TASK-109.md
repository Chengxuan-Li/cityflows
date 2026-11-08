# TASK-109 — Building details: closed terrain footprints, roof shapes, colours and windows

Owner: unassigned
Gate: 8 (more realistic visuals, owner 2026-11-07); Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/109-building-details` (created by the lead from main)
Depends on: TASK-096 (context), TASK-098 (3D view), TASK-105 (terrain). Design: this file;
`docs/architecture.md` sections 4 (City), 11 (rendering) and 13 (OSM import). Read those before
the code.

## Goal

Buildings in 3D are plain extruded boxes in one colour (`src/render3d/context.ts`), placed at
the lowest ground of their footprint since TASK-105. Two things to do:

1. **Close the terrain footprints (first, a known TASK-105 defect).** TASK-105 digs each
   building and water footprint out of the ground mesh and lays a flat floor at the
   footprint's lowest ground (`cutGround` and the patches in `src/render3d/terrain.ts`). On a
   slope the floor sits below the surrounding ground on the uphill side, and nothing fills the
   vertical gap between the floor's edge and the ground. With Buildings switched off in 3D,
   or where a footprint has no building mesh, the hillside shows open pits and the background
   shows through. The building's walls hide the gap only while the building is drawn.
2. **Building details (owner, Gate 8.1).** OSM `roof:shape`, `roof:height`, `roof:levels`,
   `roof:colour`, `roof:material`, `roof:orientation`, `building:colour`, `building:material`,
   `min_height` and `building:min_level`; window bands per level on the facades.

The Munich extract has 359 tagged roof shapes (gabled 170, flat 92, hipped 27, mansard 26,
gambrel 22, a few skillion, round and quadruple saltbox), 248 `roof:levels`, 67 `roof:colour`,
27 `building:colour`, 22 `building:material` and 709 `building:levels`; Sindelfingen has 16
flat roofs, 15 `building=roof` canopies and six `building:min_level`.

Hard rule (as Gate 6 and 8): the planar geometry built from OSM is untouched. Road, node,
place and movement geometry, ids and the compiled city stay byte for byte as on main. The
simulation never reads the new data. 2D draws buildings as today.

## Design

1. **Footprint closure.** Every excavated footprint is closed in the ground mesh itself, so it
   is closed whether or not a building is drawn on it: a wall (a skirt) from the floor's edge
   up to the ground surface along each footprint ring, inner rings included, coloured as the
   building base or as earth, plus the floor. Water footprints get the same skirt as a bank.
   Choose the cheapest geometry that leaves no gap; an alternative that is equally gap-free
   (for example not excavating a footprint whose building is hidden) is fine if it does not
   rebuild the scene on a toggle. Footprints without a building mesh (clipped, canopies,
   features the extrusion skips) are covered by the same rule.
2. **Schema (contract change, pre-approved).** Extend the `area` variant of `ContextFeature` in
   `src/schema/city.ts` and `city.schema.ts`, described in `docs/architecture.md` section 4:

   ```ts
   export type RoofShape =
     | 'flat' | 'gabled' | 'hipped' | 'pyramidal' | 'skillion' | 'mansard' | 'gambrel'
     | 'half-hipped' | 'round' | 'dome' | 'onion';
   // area features gain, for buildings only:
   roof?: { shape: RoofShape; heightM?: number; levels?: number; colour?: string;
            material?: string; orientation?: 'along' | 'across'; directionDeg?: number };
   colour?: string;      // building:colour, normalised to '#rrggbb'
   material?: string;    // building:material
   minHeightM?: number;  // min_height, or building:min_level × 3 m
   ```

   Unknown roof shapes map to the nearest supported one (`quadruple_saltbox` → `hipped`,
   `saltbox` → `gabled`) or to `flat`, and the import reports the counts. Colour names and
   hex values are normalised; unknown colours are dropped. No `schemaVersion` bump; files
   without these fields load unchanged. Adjust the names if a better fit appears, and
   describe the final form in section 4.
3. **Import.** `src/importers/osm/context.ts` reads the tags above from building ways and
   multipolygons. `building=roof` (canopies) becomes a roof slab with `minHeightM` from its
   tags or 3 m default and no walls. The Overpass query already fetches buildings with all
   their tags; change `src/importers/overpass.ts` only if a tag is missing. `building:part`
   stays out (see Out of scope).
4. **Roof geometry.** New `src/render3d/roofs.ts`, pure and deterministic:
   - The wall height is `height − roof height` (roof height from `roof:height`, else
     `roof:levels × 3 m`, else a default by shape and footprint size, for example 35 degrees
     pitch across the short side, capped).
   - Gabled, hipped, half-hipped, pyramidal, skillion, mansard and gambrel on footprints that
     are close to a rectangle (minimum oriented rectangle, area ratio at least about 0.85),
     with the ridge along the long side unless `roof:orientation=across` or
     `roof:direction` says otherwise. Gable ends get wall triangles.
   - Other footprints: hipped and pyramidal through a straight skeleton if you implement or
     adopt one (a GPL-compatible dependency is allowed; justify it and add `NOTICE` if code is
     copied), otherwise flat; round, dome and onion as a simple dome over the footprint
     centroid or flat. Report how many roofs fell back to flat and why.
   - Untagged roofs stay flat. Do not infer shapes.
5. **Colours and windows.** Wall colour from `building:colour`, else from `building:material`
   (brick, plaster, concrete, glass, wood, metal) through a small palette in `style.ts`, else
   today's building colour with a small seeded per-building variation so a block does not read
   as one mass; roof colour from `roof:colour`, else `roof:material` (tiles, metal, concrete,
   slate, glass, gravel), else a muted default by shape (pitched roofs a tile tone, flat roofs
   grey). Keep the palette restrained so roads stay the strongest element (`AGENTS.md`
   design direction). Window bands per level on walls only: a procedural pattern in the
   building material (for example `onBeforeCompile` on the existing Lambert material) from
   the world height and the distance along the wall, with levels from `building:levels` or
   the height; none on roofs, canopies, garages, sheds and industrial walls taller than a
   level without levels tagged; faded out with distance so the overview does not shimmer.
6. **Layers.** "Building details" (default on, shown when Buildings is shown): off draws today's
   boxes in today's colour. The terrain closure is not behind this toggle; it always applies.
7. **Measure.** Per city: buildings by roof shape as drawn, fallbacks to flat, 3D build time of
   the context, triangle count of the buildings mesh, 3D frame time at both Munich zooms with
   Building details on and off, and against main.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
view wiring, scene setters, dev pages, fixture builders, shared types, test helpers), as long
as it is not named under "Out of scope"; list each such file and why in your report. Stop and
ask the lead only for a file named under "Out of scope", a contract change this task does not
describe, or a behaviour change to another feature.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (the fields above);
`src/importers/osm/context.ts` and `buildings.ts`, `src/importers/overpass.ts` (surroundings
part only); `src/render3d/context.ts`, `terrain.ts` (the footprint closure), `roofs.ts` (new),
`scene.ts`, `materials` or texture helpers under `src/render3d/`; `src/render/style.ts`,
`src/render/types.ts`; `src/ui/layers.tsx`, `src/ui/store.ts` and `src/ui/map-view.tsx` (the
new toggle); `bench/geometry-shots.ts` (new cameras); `docs/architecture.md` sections 4, 11
and 13 (describe what you built); tests (a new `tests/render/V109-buildings.test.ts`, an
importer case, an e2e case tagged `@smoke`), and the expectations that move, each named with
its reason (pinned compile hashes must not move; context counts and snapshots may).

## Out of scope

`src/network`, `src/sim`, `src/routing`, the road importer's geometry, the 2D renderer's
building drawing, `building:part` (detailed multi-part buildings; the outline is drawn as
today), roof furniture (chimneys, dormers, solar panels), textures from images, night
lighting (TASK-107), trees (TASK-106), road markings (TASK-108).

## Gates

1. **Network untouched.** For Munich, Sindelfingen, grid and town, `compile(city)` equals main's
   (the pinned hashes in T44, V106 and V108 do not move). The lead checks the benchmark
   hashes and the traffic gate at merge.
2. **No pits.** In V109: on a sloped synthetic terrain with a building on it, with the
   building hidden, every vertical ray dropped inside and within 1 m around the footprint hits
   the ground mesh, and the footprint ring's edges are covered from the floor to the ground
   surface (no gap wider than 2 cm). Same for a water footprint and a canopy. In the app, on
   Sindelfingen with terrain on, switch Buildings off and look for pits.
3. **Roofs.** In V109: per supported shape on a rectangle, the ridge height equals the wall
   height plus the roof height, the ridge runs along the long side (and across with
   `roof:orientation=across`), the roof covers the footprint with no gap at the eaves, and
   geometry is deterministic (two builds equal). Courtyard holes stay open (T44's courtyard
   case still passes).
4. **Import and project.** Counts per shape for Munich asserted within ±10%; colours normalised;
   save and open keep the fields; a file without them opens.
5. **Render.** 3D shots before and after: new cameras `V109-munich-roofs` (oblique, street
   level, a block of gabled and hipped roofs), `V109-munich-overview` (3D overview),
   `V109-sindelfingen-terrain` (terrain on, Buildings off, a slope with buildings) and
   `V109-sindelfingen-canopies`; plus `V106-munich-streets-3d` and `R6-n138-3d`. Read every
   image yourself: roofs sit on their walls, no roof floats or sinks into a neighbour, the
   overview is calm, roads stay the strongest element, no pit is visible with Buildings off.
6. **Performance.** 3D frame time with Building details on within 20% of main at both Munich
   zooms (owner allowance, TASK-097); 3D context build time reported against main.
7. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Heavy e2e cases need
   `test.setTimeout(420_000)` for CI's software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5309`;
   never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, `npm run bench` or the full
  `npm run test:e2e`; the lead runs them at merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5309`), import
Munich and Sindelfingen (terrain on), look at a block of pitched roofs, the overview and a
slope in 3D, toggle Buildings and Building details; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): how footprints are
closed; tags read and how they map; roof shapes drawn and fallbacks per city; colour rules;
the window pattern; build times, triangle counts and frame times; image paths; files changed
outside the pre-approved list and why; expectations changed, each with its reason; the final
lines of `npm run check`.

Commit on `task/109-building-details`; do not push or merge. The lead reviews only commits.
