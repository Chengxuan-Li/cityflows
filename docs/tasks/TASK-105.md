# TASK-105 — Terrain: an elevation grid at import, relief in 3D with roads on the ground, hillshade in 2D

Owner: unassigned
Gate: 8 (more realistic visuals, owner 2026-11-07); Phase 1 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/105-terrain` (created by the lead from main)
Depends on: TASK-096 (context), TASK-098 (3D view). Design: this file; `docs/architecture.md`
sections 3 (coordinate frame), 4 (City), 11 (rendering), 12 (project format) and 13 (OSM
import). Read those before the code.

## Goal

The owner: "topography". The 3D view (TASK-098) puts every street on a flat ground plane,
raised only by its grade (`src/render3d/heights.ts`). Sindelfingen sits on hills; Munich is
nearly flat but not level.

Fetch an elevation grid for the import area, save it with the project, let the 3D ground,
roads, buildings, surroundings and vehicles follow it, and show a hillshade in 2D.

Hard rule (as Gate 6): the planar geometry built from OSM is untouched. Road, node, place and
movement geometry, ids and the compiled city stay byte for byte as on main. The simulation
never reads the terrain; slope does not affect driving (owner decision, 2026-11-07).

## Design

1. **Schema (contract change, owner-approved).** One optional field on `City`, described in
   `docs/architecture.md` sections 4 and 12:

   ```ts
   // City:
   terrain?: {
     source: string;      // attribution, e.g. "AWS Terrain Tiles (Mapzen, SRTM, ...)"
     originM: Vec2;       // local metres of cell (0, 0)'s centre
     cellM: number;       // grid spacing, 10 by default
     cols: number;
     rows: number;
     baseM: number;       // height of a stored 0
     heights: string;     // base64 of little-endian Int16, decimetres above baseM, row-major
   };
   ```

   No `schemaVersion` bump; old files load unchanged. Edits never touch it and it does not
   bump `city.version`; `compile()` ignores it. The manifest's attribution names the source.
2. **Fetch at import.** New `src/importers/terrain.ts`.
   - Source: AWS Terrain Tiles, Terrarium encoding,
     `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, zoom 15, no
     key. Height in metres is `R * 256 + G + B / 256 - 32768`.
   - Decode PNGs with `fast-png` (new dependency, owner-approved), so the browser worker and
     Node tests share one path; no canvas.
   - Resample the tiles covering the bbox (plus 100 m margin) to the `cellM` grid in local
     metres (section 3's projection), bilinear.
   - Cache fetched tiles like Overpass extracts (`src/importers/cache.ts`).
   - `ImportOptions` gains `terrain?: boolean`, default `true`; the import wizard gets an
     "Include terrain" checkbox next to "Include surroundings". A failed fetch imports without
     terrain and shows one warning in the wizard's diagnostics step; it never fails the import.
   - Fixtures: commit grids for `munich-donnersberger.osm` and `sindelfingen-a81.osm` under
     `fixtures/terrain/` (the same JSON shape as `City.terrain`), produced once by a new
     `bench/terrain-fetch.ts`. Tests and the city tier read the fixtures and never fetch. If
     your environment has no network, stop and ask the lead to run the script.
3. **Height function.** New `src/render3d/terrain.ts`: `groundAt(x, y)` (bilinear on the grid,
   edge-clamped) and a ground mesh builder. With no terrain, `groundAt` is 0 and everything
   renders as on main.
4. **3D.**
   - Ground: the flat ground plane, the basemap tiles and the surroundings' ground classes
     (green, water, land use, parking) drape onto a mesh built from the grid; water stays
     level at its outline's lowest ground height.
   - Roads: `heights.ts` adds the ground under each road station to its grade profile. A deck
     (grade above 0) and a tunnel (below 0) take the ground at their two ends and interpolate
     linearly between them, so bridges stay straight over valleys and tunnels under hills;
     ramps blend between the two over their existing transition. Markings, crossings, signals
     and vehicles read the same heights (they already go through `heights.ts`).
   - Buildings stand on the lowest ground under their footprint, extruded to the same top as
     on main plus that offset.
   - A Layers entry "Terrain" (`LayerVisibility.terrain`, default on, shown when the city has
     terrain): off renders exactly as main.
5. **2D.** A hillshade layer under the surroundings (`src/render/layers/hillshade.ts`): one
   texture computed from the grid (light from the north-west, 45°), drawn at low opacity so
   roads stay dominant, cached like the context layer. Shown when "Terrain" is on.
6. **Measure.** Per city: grid size, serialized size, min and max height, fetch time, mesh
   build time, frame time in 3D with Terrain on and off, and 2D overview frame time.

## In scope

`src/importers/terrain.ts` (new), the call where the import runs (`src/importers/worker.ts`
and the Node entry the city tier uses),
`src/importers/types.ts` (`ImportOptions`), `src/importers/cache.ts`, `src/importers/worker.ts`;
`src/schema/city.ts`, `city.schema.ts`; `src/render3d/terrain.ts` (new), `heights.ts`,
`scene.ts`, `basemap.ts`, `context.ts`; `src/render/layers/hillshade.ts` (new),
`src/render/scene.ts`, `src/render/types.ts`, `src/render/style.ts`; `src/ui/layers.tsx`,
`src/ui/import/wizard.tsx`, `diagnostics-step.tsx`; `package.json` and the lockfile
(`fast-png`); `bench/terrain-fetch.ts` (new), `fixtures/terrain/` (new); the project manifest's
attribution; `bench/geometry-shots.ts` (new cameras); `docs/architecture.md` sections 3, 4, 11,
12 and 13 (describe what you built); tests (a new `tests/render/V105-terrain.test.ts`, an
importer case, a project round-trip case, an e2e case tagged `@smoke`), and the expectations
that move, each named.

## Out of scope

`src/network`, `src/sim`, `src/routing`, the road importer's geometry, vegetation (TASK-106),
road markings (TASK-108), building details (TASK-109), vehicles' shapes (TASK-100).

## Gates

1. **Network untouched.** For Munich, Sindelfingen, grid and town, `compile(city)` with terrain
   equals the one without (a stable hash, in V105). The lead checks the benchmark hashes and
   the traffic gate at merge; do not run them.
2. **Terrain off = main.** With "Terrain" off, or a city without terrain, the 3D and 2D shots
   equal main's pixel for pixel on the existing cameras.
3. **Heights.** In V105: `groundAt` matches the fixture grid at cell centres; a deck's height
   between its ends is linear in station plus its grade profile; no road station is below the
   ground by more than 0.3 m except tunnels; no vehicle floats more than 0.3 m above its road.
4. **Import and project.** Import with terrain on and off; the off case equals main's output.
   Save and open keep `terrain`; a file without it opens. Serialized terrain is at most 15% of
   `city.json` without it on both fixtures.
5. **Render.** 3D shots of Sindelfingen (new cameras `V105-sindelfingen-overview`,
   `V105-sindelfingen-a81` on the motorway, `V105-sindelfingen-bridge` at a deck) and Munich
   (`V105-munich-overview`), Terrain on and off, plus a 2D hillshade shot of Sindelfingen. Read
   every image yourself: roads sit on the ground, bridges stay straight, nothing pokes through.
6. **Performance.** 3D frame time with Terrain on within 20% of off at both Munich zooms and the
   Sindelfingen overview (owner allowance, TASK-097); report all.
7. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Heavy e2e cases need
   `test.setTimeout(420_000)` for CI's software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5305`;
   never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, `npm run bench` or the full
  `npm run test:e2e`; this task does not touch `src/sim` or `src/network`, and the lead runs
  them at merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5305`), import
Sindelfingen through the wizard with terrain, switch to 3D, orbit the A81 and a bridge, toggle
Terrain; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the data source and
grid as implemented; sizes and heights per city; build and frame times; image paths (Terrain
on and off); expectations changed, each with its reason; the final lines of `npm run check`.

Commit on `task/105-terrain`; do not push or merge. The lead reviews only commits.
