# TASK-096 — OSM surroundings: buildings, land use, water, parks and railways drawn under the roads

Owner: unassigned
Gate: 6 (visual representation, owner 2026-11-07)
Branch: `task/096-osm-context` (created by the lead from main)
Depends on: TASK-090 (tiers). Design: this file; `docs/architecture.md` sections 4 (City), 11
(rendering), 12 (project format) and 13 (OSM import). Read those before the code.

## Goal

The owner: "osm geometry context (non road ones)". Today the importer keeps drivable highways
and turns land-use areas into places; every other OSM feature is dropped, and the only context on
screen is the optional raster tile backdrop. The Munich extract alone has about 1 400 buildings,
180 land-use areas and 67 railway ways.

Import the non-road features as display-only shapes, save them with the project, and draw them
in a muted style under the roads, so an imported city reads as a place and not as roads on a
blank field.

Hard rule: the road network is untouched. Road, node, place and movement geometry, ids and the
compiled city stay byte for byte as on main. The simulation never reads the new data.

## Design

1. **Schema (contract change, owner-approved).** Add one optional field to `City` in
   `src/schema/city.ts` and `city.schema.ts`, and describe it in `docs/architecture.md` section 4:

   ```ts
   export type ContextArea = 'building' | 'water' | 'green' | 'landuse' | 'parking';
   export type ContextLine = 'rail' | 'tram' | 'waterway';
   export type ContextFeature =
     | { kind: 'area'; class: ContextArea; rings: Vec2[][]; sub?: string; heightM?: number; levels?: number }
     | { kind: 'line'; class: ContextLine; line: Vec2[]; widthM?: number; layer?: number };
   // City:
   context?: { features: ContextFeature[] };
   ```

   - `rings[0]` is the outer ring, the rest are holes; coordinates in the city's local metres,
     rounded to 0.1 m.
   - `sub` is the source tag value (for example `residential`, `grass`, `forest`).
   - `heightM` and `levels` come from `height` / `building:levels` when tagged (TASK-098's 3D
     view extrudes buildings with them).
   - No `schemaVersion` bump: the field is optional and old files load unchanged. Add a test
     that a file without `context` opens, and one that a project with `context` round-trips
     through save and open (section 12).
   - Edits never touch `context`; it does not bump `city.version`. `compile()` ignores it.
2. **Import.** New file `src/importers/osm/context.ts`, called from `importOsm` after places.
   - Classes:
     - `building`: any `building=*` way or multipolygon relation, except `building=no`.
     - `water`: `natural=water`, `waterway=riverbank`, `landuse=reservoir`, `landuse=basin`.
     - `green`: `leisure=park|garden|pitch|playground`, `landuse=grass|meadow|forest|recreation_ground|village_green|allotments|cemetery`,
       `natural=wood|scrub|grassland`.
     - `landuse`: `landuse=residential|commercial|retail|industrial|railway|construction`.
     - `parking`: `amenity=parking` areas.
     - Lines: `railway=rail|light_rail|subway|narrow_gauge` as `rail`, `railway=tram` as
       `tram`, `waterway=river|stream|canal` as `waterway`. Skip `railway=abandoned|disused`
       and lines tagged `tunnel=yes` with `layer < 0`, which are underground.
   - Multipolygon relations: assemble outer and inner rings from member ways (reuse what
     `places.ts`/`buildings.ts` already do; do not write a second ring assembler if one
     exists, factor it out).
   - Clip to the import bounds (reuse `clip` in `buildings.ts`), simplify rings and lines with a
     0.3 m tolerance, drop areas under 4 m² and lines under 2 m.
   - Size budget: on Munich the serialized `context` is at most 40% of `city.json` without
     it. Report both sizes.
   - `ImportOptions` gains `context?: boolean`, default `true`. The import wizard
     (`src/ui/import/wizard.tsx`) gets a checkbox "Include surroundings", on by default.
   - Overpass (`src/importers/overpass.ts`): when `context` is on, the query also fetches the
     tags above inside the same bbox. Keep the road part of the query unchanged; the
     existing Overpass test must still pass, and add one for the context part.
   - The land-use areas `addBuildings` turns into places stay places, unchanged. A land-use
     area may now also appear in `context` as a drawn shape; that is fine.
3. **Render.** New layer `src/render/layers/context.ts`, wired in `src/render/scene.ts`.
   - Drawn above the tile backdrop and below every grade group (under grade 0's road
     surfaces), flat, not pickable.
   - Muted palette added to `src/render/style.ts`, in the spirit of `AGENTS.md`'s design
     direction: roads stay the strongest element. Buildings a light warm grey with a hairline
     darker edge; water a pale blue; green a pale green; land use a faint tint per `sub`;
     parking a light grey; rail a thin dark-grey line with cross ties at high zoom, tram a
     thinner line; waterways pale blue lines.
   - Static: built once per `setCity` and cached as a texture at overview zoom the way grade
     terrain is (`cacheAsTexture` in `scene.ts`).
   - A Layers entry "Surroundings" (`LayerVisibility.context`, default `true`), shown only
     when the city has context. Basemap and Surroundings can both be on; Surroundings then
     draws over the tiles.
   - `canvas.dataset.contextFeatures` holds the drawn feature count (for e2e).
4. **Measure.** Report per city (Munich, Sindelfingen): feature counts per class, serialized
   size, static rebuild time and frame time at the overview zoom with Surroundings on and off.

## In scope

`src/importers/osm/context.ts` (new), `src/importers/osm/index.ts` (the call),
`src/importers/osm/buildings.ts` and `places.ts` (only to share ring assembly and clipping),
`src/importers/overpass.ts`, `src/importers/types.ts` (`ImportOptions`), `src/schema/city.ts`,
`city.schema.ts`, `src/render/layers/context.ts` (new), `src/render/scene.ts`,
`src/render/style.ts`, `src/render/types.ts` (`LayerVisibility`), `src/ui/layers.tsx`,
`src/ui/import/wizard.tsx`, `docs/architecture.md` sections 4, 11 and 13 (describe what you
built), tests (a new `tests/importers/T44-context.test.ts`, a project round-trip case, an e2e
case tagged `@smoke`), and the expectations that move, each named.

## Out of scope

The road importer's geometry (`roads.ts`, `split.ts`, `corridors.ts`, `realign.ts`,
`relax.ts`, `smooth.ts`), `src/network`, `src/sim`, `src/render/layers/roads.ts` (TASK-095 is
editing it), shadows (TASK-097), the 3D view (TASK-098).

## Gates

1. **Network untouched.**
   - For Munich, Sindelfingen, grid and town, the compiled city with context equals the one
     without (compare a stable hash of `compile(city)` output; add it to T44).
   - Benchmark hashes and the traffic gate are checked by the lead at merge; do not run them.
2. **Import.**
   - Munich and Sindelfingen import with context; counts per class reported and asserted in
     T44 within ±10%.
   - Every ring is closed, has at least 3 points and lies inside the bounds; no NaN.
   - The size budget above holds.
   - An import with `context: false` produces a city with no `context` field, identical to
     main's output.
3. **Project.** Save and open keep `context`; a file without it opens; the TASK-042 baseline
   path still works.
4. **Render.**
   - Shots with `npm run geometry-shots -- <dir> --only ...` before and after: add cameras
     `V96-munich-overview` (the whole Munich extract), `V96-hbf-tracks` (the railway area in
     the extract) and `V96-sindelfingen` (with `osm: 'fixtures/osm/sindelfingen-a81.osm'`), and
     include `T93-n967`, `R6-n138`. Read every image yourself: roads must stay the dominant
     element, buildings must not cover any road or junction surface.
   - Frame time at the Munich overview with Surroundings on is within 10% of off; report
     both.
5. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5291`; never use port 4173.

## Checks to run

Use the fast tiers (TASK-090, `AGENTS.md` "Delivering a task"):

- While iterating: `npm test` (unit tier, about 15 s) and `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, `npm run bench` or the full
  `npm run test:e2e`: this task does not touch `src/sim` or `src/network`, and the lead runs
  the traffic gate, the benchmark hashes and the full e2e suite at merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5291`) and
import the Munich fixture through the wizard with and without "Include surroundings";
describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the classes and tags as implemented;
- counts and sizes per city;
- frame and rebuild times;
- image paths (before and after);
- expectations changed, each with its reason;
- the final lines of `npm run check`.

Commit on `task/096-osm-context`; do not push or merge. The lead reviews only commits.
