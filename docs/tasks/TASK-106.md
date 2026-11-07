# TASK-106 — Vegetation and surfaces: OSM trees, generated street trees, filled woods, ground textures

Owner: unassigned
Gate: 8 (more realistic visuals, owner 2026-11-07); Phase 1 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/106-vegetation` (created by the lead from main)
Depends on: TASK-096 (context), TASK-098 (3D view). Design: this file; `docs/architecture.md`
sections 4 (City), 11 (rendering) and 13 (OSM import). Read those before the code.

## Goal

The owner: "trees on the roadside, trees on open fields, forests, surface texture, grassland".
Today green areas (`City.context`, class `green`) are flat tinted polygons in 2D and 3D, OSM
tree nodes and tree rows are not imported, and streets have no trees.

Import OSM trees and tree rows, generate street trees where OSM has none, fill woods and
forests with trees, and give grass, meadow, forest floor, pavement and asphalt a texture, in
2D and 3D.

Hard rule (as Gate 6): the planar geometry built from OSM is untouched. Road, node, place and
movement geometry, ids and the compiled city stay byte for byte as on main. The simulation
never reads the new data.

## Design

1. **Schema (contract change, owner-approved).** Extend `ContextFeature` in
   `src/schema/city.ts` and `city.schema.ts`, described in `docs/architecture.md` section 4:

   ```ts
   export type ContextPoint = 'tree';
   export type ContextLine = 'rail' | 'tram' | 'waterway' | 'tree_row';
   // ContextFeature gains:
   | { kind: 'point'; class: ContextPoint; pos: Vec2; heightM?: number; crownM?: number; sub?: string }
   ```

   `sub` is `leaf_type` (`broadleaved`, `needleleaved`). `heightM` from `height`, `crownM` from
   `diameter_crown`. No `schemaVersion` bump; files without points load unchanged.
2. **Import.** `src/importers/osm/context.ts`: `natural=tree` nodes as points, `natural=tree_row`
   ways as `tree_row` lines, clipped to the bounds. The Overpass query
   (`src/importers/overpass.ts`) adds `node[natural=tree]` and `way[natural=tree_row]` to the
   surroundings part; the road part of the query stays unchanged and its test still passes.
   Report counts per city.
3. **Placement (one shared, pure module).** New `src/render/vegetation.ts`, used by both
   renderers, deterministic from the city (same city, same trees; no `Math.random`):
   - OSM trees and tree rows (trees every 8 m along a row, unless tagged otherwise).
   - Generated street trees along `residential`, `tertiary`, `secondary` and `primary` roads,
     both sides, offset to 2.5 m beyond the road's outer edge, spaced 12 m by default with a
     seeded jitter of ±2 m. Skipped within 15 m of a junction node, at crossings, near place
     connectors (driveways), inside buildings, water and other roads' surfaces, and within 8 m
     of an OSM tree. A separated pair's median (`corridorId`) gets none. They are never saved.
   - Woods and forests (`green` with `sub` `wood` or `forest`): seeded Poisson-disc fill at one
     tree per 40 m², scrub at one small tree per 60 m², parks one per 300 m² clear of paths and
     pitches; grass, meadow and grassland get none. Total generated trees capped (60 000 per
     city; report the counts and whether the cap was hit).
   - Each tree: position, height (OSM or 8 to 14 m seeded), crown diameter, leaf type.
4. **2D.** New `src/render/layers/vegetation.ts`: canopies as soft, slightly darker green discs
   from above, under the roads and above the surroundings; cached as a texture at overview zoom
   like the context layer. Ground textures: a subtle fine-grain pattern on grass, meadow and
   forest areas, kept faint so roads stay dominant (design direction in `AGENTS.md`).
5. **3D.** New `src/render3d/vegetation.ts`: instanced trees (a trunk and one or two crown
   shapes, broadleaved round, needleleaved conical), drawn as simple billboards or merged
   canopy blobs beyond a distance threshold. Procedural textures (generated in code, no image
   assets) for grass, meadow, forest floor, pavement and asphalt on the matching ground and
   road materials. Trees stand on the ground height `src/render3d/heights.ts` gives for the
   ground (0 on main; TASK-105 adds terrain in parallel and the lead wires its `groundAt` in
   at merge, so read ground height through one function).
6. **Layers.** "Trees" (OSM trees and woods, default on) and "Street trees" (generated, default
   on), shown when they would draw anything (`LayerVisibility.trees`, `streetTrees`).
7. **Measure.** Per city: tree counts by source, placement time, 2D rebuild time and frame time
   at overview, 3D frame time at both Munich zooms, Trees on and off.

## In scope

`src/schema/city.ts`, `city.schema.ts` (context points and `tree_row`);
`src/importers/osm/context.ts`, `src/importers/overpass.ts` (surroundings part only);
`src/render/vegetation.ts` (new), `src/render/layers/vegetation.ts` (new),
`src/render/layers/context.ts` (ground texture), `src/render/scene.ts`, `src/render/style.ts`,
`src/render/types.ts`; `src/render3d/vegetation.ts` (new), `src/render3d/context.ts` (ground
materials), `src/render3d/geometry.ts` (road surface material only), `src/render3d/scene.ts`;
`src/ui/layers.tsx`; `bench/geometry-shots.ts` (new cameras); `docs/architecture.md` sections 4,
11 and 13 (describe what you built); tests (a new `tests/render/V106-vegetation.test.ts`, an
importer case, an e2e case tagged `@smoke`), and the expectations that move, each named.

## Out of scope

`src/network`, `src/sim`, `src/routing`, the road importer's geometry, terrain (TASK-105),
street lamps, sidewalks and curbs (TASK-107), road markings (TASK-108), vehicles (TASK-100).

## Gates

1. **Network untouched.** For Munich, Sindelfingen, grid and town, `compile(city)` equals main's
   (a stable hash, in V106). The lead checks the benchmark hashes and the traffic gate at merge.
2. **Placement.** In V106: placement is deterministic (two runs equal); no generated tree lies
   on a road surface, junction, crossing, building or water polygon; none within 15 m of a
   junction node; woods reach the density within ±15%; the cap holds.
3. **Import and project.** Tree counts per city asserted within ±10%; save and open keep the new
   features; a file without them opens.
4. **Render.** Shots before and after in 2D and 3D (new cameras `V106-munich-streets` on a
   residential grid, `V106-munich-park`, `V106-sindelfingen-wood`, plus `R6-n138`). Read every
   image yourself: roads stay the strongest element, no tree covers a road or junction from
   above in 2D, the 3D forest edge is not a hard wall of identical trees.
5. **Performance.** Frame time with Trees and Street trees on within 20% of both off, in 2D at
   the Munich overview and in 3D at both Munich zooms (owner allowance, TASK-097); report all.
6. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Heavy e2e cases need
   `test.setTimeout(420_000)` for CI's software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5306`;
   never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, `npm run bench` or the full
  `npm run test:e2e`; the lead runs them at merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5306`), import Munich,
look at a residential street, a park and the overview in 2D and 3D, toggle both tree layers;
describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): sources and
placement rules as implemented; counts per city; times; image paths; expectations changed, each
with its reason; the final lines of `npm run check`.

Commit on `task/106-vegetation`; do not push or merge. The lead reviews only commits.
