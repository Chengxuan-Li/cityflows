# TASK-110 — Pedestrian network: footways, sidewalks, crossings, entrances and walk routing

Owner: unassigned
Gate: 9 (occupancy-driven trips, owner 2026-11-07), feature 9.1; Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/110-walk-network` (created by the lead from main)
Depends on: TASK-091 and TASK-094 (crossings), TASK-096 (context), the lead's Phase 2 walk
format (`City.walk`, `Road.sidewalk` in `src/schema/city.ts`, architecture section 4). Design:
this file; `docs/architecture.md` sections 4 (City), 5 (compile), 7 (routing), 11 (rendering)
and 13 (OSM import). Read those before the code.

## Goal

The importer drops every footway, and pedestrian crossings are only markings. Build the walk
network Gate 9 needs: mapped pedestrian ways from OSM, sidewalks along streets, walk links over
the crossings, building entrances, and walk routing on that graph, drawn in 2D and 3D. No
walker moves yet (TASK-111 adds pedestrians to the simulation, TASK-112 person trips). The
sidewalk drawing that was planned for TASK-107 is part of this task.

## Design

1. **Import** (new `src/importers/osm/walk.ts`). `highway=footway`, `pedestrian`, `path`,
   `steps` and `footway=crossing` ways as walk links (`City.walk`), with `width` and `layer`;
   `highway=living_street` roads also get walk links along them (shared space). `entrance=*`
   nodes on building outlines as entrance walk nodes, matched to the place whose footprint or
   building they touch (else `placeId: null`). `sidewalk=*`, `sidewalk:left/right/both`
   on roads into `Road.sidewalk`, relative to each road's travel direction (map both
   directions of a two-way street). The Overpass query adds the pedestrian ways and entrance
   nodes (keep your change one separate clause). Refine the walk format if needed and describe
   it in section 4.
2. **Compile** (new `src/network/walk.ts`, derived, never saved):
   - Sidewalks along streets: on each side marked `yes`, or by road class where untagged
     (residential to primary both curb sides; none on motorways, trunks, ramps and service
     roads), offset beyond the carriageway's outer edge (2 m wide by default), following the
     road; the two sides of a two-way street are the outer curbs of its pair, not the median.
     `separate` means a mapped footway already runs alongside: generate none.
   - Sidewalks join at junctions around the corner; crossings (the TASK-091 crossing positions,
     honouring `Road.crossings` overrides, and mapped `footway=crossing` ways) become walk links
     between the sidewalks on either side, each tagged with its road and end.
   - Mapped footways join sidewalks and each other where they meet or cross within a small
     tolerance, respecting `layer` (a footway bridge does not join the street below).
   - Places connect to the walk graph at their entrances, else at the nearest walk link to their
     shape (a short generated link, marked generated); parking facilities and connectors the
     same way, so TASK-112 can walk from a car to a door.
   - Output: walk nodes and links with lengths, kinds, the road and side for sidewalks, and for
     crossings the road, end and whether it is a zebra or at a signal.
3. **Walk routing** (new `src/routing/walk.ts`): shortest walking time between two walk
   positions or places (walking speed a parameter, steps slower), with the path as links.
   Deterministic; fast enough for TASK-112 to call per trip (report the time per query).
4. **Drawing.** A walk layer in 2D and 3D: sidewalks as pale paving strips outside the curb
   (clipped by buildings), footways and paths as thinner lines, steps hatched, crossings already
   drawn by the markings. Own Layers entries "Sidewalks" and "Footways", default on; roads stay
   the strongest element. In 3D sidewalks sit at curb height on the terrain.
5. **Measure.** Per city: walk nodes and links by kind, sidewalk length, crossings joined,
   places reachable on foot from a central place, compile time against main, routing time per
   query.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
compile wiring, renderer layers and setters, dev pages, fixture builders, shared types, test
helpers), as long as it is not named under "Out of scope"; list each such file and why in
your report. Stop and ask the lead only for a file named under "Out of scope", a contract
change this task does not describe, or a behaviour change to another feature.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (refinements of the walk
format and `Road.sidewalk`); `src/importers/osm/walk.ts` (new), `index.ts`, `roads.ts`
(sidewalk tags), `src/importers/overpass.ts` (pedestrian ways and entrances); `src/network/walk.ts`
(new), `compile.ts`, `types.ts` (a compiled walk graph next to the vehicle network);
`src/routing/walk.ts` (new) and `src/routing/index.ts` (exports); walk layers under
`src/render/layers/` and `src/render3d/`, `src/render/style.ts`, `src/render/types.ts`,
`src/render/scene.ts`, `src/render3d/scene.ts`, `src/ui/layers.tsx`, `src/ui/store.ts`,
`src/ui/map-view.tsx`; `bench/geometry-shots.ts` (new cameras); `docs/architecture.md` sections
4, 5, 7, 11 and 13; tests (a new `tests/network/T50-walk.test.ts`, a routing case, importer
cases, an e2e case tagged `@smoke`), and the expectations that move, each named with its reason.

## Out of scope

The vehicle network and its compile output (roads, lanes, nodes, movements, junction
geometry), the simulation (`src/sim`), demand, vehicle routing, parking (TASK-102 to
TASK-104), street lamps, curbs and signs (TASK-107), crossing markings themselves (TASK-091,
TASK-108).

## Gates

1. **Vehicle network untouched.** For Munich, Sindelfingen, grid and town the compiled vehicle
   network equals main's: the pinned compile hashes (T44, V106, V108, T47) do not move, or move
   only because the walk graph is part of the hashed object, proven by hashing without it.
   Traffic is untouched (no `src/sim` change).
2. **Graph.** In T50: sidewalks follow both curbs of a two-way street and both sides of a
   one-way street, not the median; corners join; every crossing joins the sidewalks on both
   sides; a footway bridge does not join the street below; entrances join their places;
   deterministic. On Munich at least 95% of places with residents or jobs are reachable on
   foot from the central place; report the rest and why.
3. **Routing.** A walk route between two places on opposite sides of a street uses a crossing;
   routes are shortest by time; report the mean query time on Munich.
4. **Import.** Walk link counts by kind and entrance counts for Munich and Sindelfingen
   asserted within ±10%; save and open keep the walk network and sidewalk tags; a file without
   them opens.
5. **Render.** 2D and 3D shots (new cameras `V110-munich-sidewalks` on a residential grid,
   `V110-munich-crossings` at a signalised junction, `V110-sindelfingen-paths`, and 3D versions
   of the first two); read them yourself: sidewalks sit outside the curb, never on the
   carriageway or through a building, roads stay the strongest element.
6. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Heavy e2e cases need
   `test.setTimeout(420_000)` for CI's software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5310`;
   never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, the full `npm run test:e2e` or
  `npm run bench`; the lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5310`), import
Munich, look at sidewalks, crossings and footways in 2D and 3D, toggle the two layers; describe
what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): sources and rules as
implemented, counts per city, reachability, routing time, image paths, files changed outside
the pre-approved list and why, expectations changed with their reasons, and the final lines of
`npm run check`. Write any Markdown or docs as UTF-8.

Commit on `task/110-walk-network`; do not push or merge. The lead reviews only commits.
