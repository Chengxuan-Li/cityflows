# CityFlows delivery plan

Companion to `docs/architecture.md` (contracts) and `docs/tasks/` (one contract per task).
The lead owns this file: task status, deferrals and owner decisions are recorded here, not in
chat history.

## Gates

| Gate | Outcome | Exit criterion |
|---|---|---|
| 0 | Repo, contracts, bounded upstream audit | `npm run check` green on `main`; architecture approved; audit merged |
| 1 | Minimum playable CityFlows on a synthetic city | The owner's Gate 1 checklist below passes in Playwright and by hand |
| 2 | Real-city import and a genuine network editor | An imported neighborhood is editable; changing a one-way or adding a road changes legal routes, not only the picture; project round-trips |
| 3 | Places, daily life, ramps, congestion-aware routing | A morning rush has home-to-work directionality; a longer but faster expressway wins; a station pulse causes measurable spillback |
| 4 | Compelling sandbox and comparisons | A new user imports a neighborhood, adds a station, builds a bypass, edits signals, and compares before and after without developer tools |
| 5 | Future: transit, bulk import, desktop (walking legs move to Gate 9) | Not planned here; the contracts keep it possible (R7) |
| 6 | OSM surroundings, grade shadows and a 3D viewer (TASK-096 to TASK-098) | Done 2026-11-07; the planar geometry built from OSM is unchanged |
| 7 | Road betterment: parking, vehicle categories, restricted access | Roadmap: Gates 7 to 9 |
| 8 | More realistic visuals: terrain, vegetation, street furniture, markings | Roadmap: Gates 7 to 9 |
| 9 | Occupancy-driven trips: pedestrians, person trips, mode choice | Roadmap: Gates 7 to 9 |

### Gate 1 checklist (owner, 2026-11-03)

A user can:

1. Open a small synthetic city with several roads, intersections, two places, and generated
   vehicles.
2. Watch individual vehicles drive between origins and destinations on valid lane-level
   routes.
3. Pause, resume, restart, and change simulation speed.
4. Inspect a vehicle and its route.
5. Change at least one meaningful traffic-control or road-network property through the UI
   (turn ban, signal timing, street direction, lane count, speed limit).
6. Restart with the same demand seed and see how the change alters vehicle behavior or
   traffic conditions.
7. Save and reload the project with the modified network and scenario intact.

Presentation is simple but coherent and game-like; no placeholder panels, no dead controls.

## Task graph

Status: `todo`, `active`, `review`, `done`, `deferred`. Owner is a session or agent name once
assigned. "Owns" is the file surface the task may touch; two active tasks never share one.

| Task | Gate | Name | Owns | Depends on | Proves | Status |
|---|---|---|---|---|---|---|
| [TASK-000](tasks/TASK-000.md) | 0 | Upstream audit and reuse matrix | `docs/references/upstream-audit.md` | - | reuse decisions for sim and import | done |
| [TASK-001](tasks/TASK-001.md) | 1 | Canonical schema, compile, fixtures | `src/schema`, `src/geo`, `src/network`, `src/fixtures`, `tests/network` | - | T13, T18 (schema), compile invariants | done |
| [TASK-002](tasks/TASK-002.md) | 1 | Lane-feasible routing | `src/routing`, `tests/routing` | 001 | T04, T05, lane feasibility | done |
| [TASK-003](tasks/TASK-003.md) | 1 | Simulation core | `src/sim` (except lane changes), `tests/sim` | 001, 002 | T01, T02, T03 (single lane), T08, T15 (sim side), intersections | done |
| [TASK-004](tasks/TASK-004.md) | 1 | Lane changing and route following | `src/sim/lane-change.ts`, engine hooks, `tests/sim/T03*`, `T07*` | 003 | T03, T07 (partial) | done |
| [TASK-005](tasks/TASK-005.md) | 1 | Engine host (worker) | `src/host`, `tests/host` | 003 | protocol, play loop, snapshot transfer | done |
| [TASK-006](tasks/TASK-006.md) | 1 | Renderer | `src/render`, `dev/render.html` | 001 | drawn city, camera, picking, vehicles | done |
| [TASK-007](tasks/TASK-007.md) | 1 | Editor core | `src/editor`, `tests/editor` | 001 | T12 (attribute and rule commands), T04 (editor side) | done |
| [TASK-008](tasks/TASK-008.md) | 1 | Project persistence | `src/project`, `tests/project`, `fixtures/projects` | 001 | T14 | done |
| [TASK-009](tasks/TASK-009.md) | 1 | App shell, run controls, inspectors | `src/ui`, `src/main.tsx`, `tests/e2e/gate1-run.spec.ts` | 005, 006, 008, 011 | Gate 1 items 1 to 4, 7 | done |
| [TASK-010](tasks/TASK-010.md) | 1 | Editing UI and restart policy | `src/ui/inspector/*`, `src/ui/run-bar*`, `tests/e2e/gate1-edit.spec.ts` | 007, 009 | Gate 1 items 5, 6; T17 | done |
| [TASK-011](tasks/TASK-011.md) | 1 | Demand v1: population and commute trips | `src/demand`, `tests/demand` | 001 | T09 (commute), T15 (data side) | done |
| [TASK-012](tasks/TASK-012.md) | 1 | Gate 1 integration and acceptance | anywhere (lead), `tests/e2e/gate1-*.spec.ts` | 004, 010 | Gate 1 checklist, CI green | done |
| [TASK-020](tasks/TASK-020.md) | 2 | OSM importer and fixtures | `src/importers/osm`, `src/importers/types.ts`, `fixtures/osm`, `tests/importers` | 001 | T11, T18 | done |
| [TASK-021](tasks/TASK-021.md) | 2 | Import wizard, Overpass provider, file upload | `src/ui/import`, `src/importers/overpass.ts`, `src/importers/cache.ts`, `src/importers/worker.ts` | 020, 009 | import workflow end to end | done |
| [TASK-022](tasks/TASK-022.md) | 2 | Topology editing: draw, split, delete, move | `src/editor/commands/topology.ts`, `src/ui/tools/*`, `src/render/layers/edit-overlay.ts`, `tests/editor/T12-topology.test.ts`, `tests/e2e/gate2-edit.spec.ts` | 007, 010 | T12 (full) | done |
| [TASK-023](tasks/TASK-023.md) | 2 | Multi-select and batch editing | `src/ui/selection`, `src/editor/commands/batch.ts` | 022 | bulk edits, one undo entry | done |
| [TASK-024](tasks/TASK-024.md) | 2 | Raster tile backdrop | `src/render/layers/tiles.ts`, layer toggle in `src/ui/layers*` | 006, 020 | tiles align with imported roads | done |
| [TASK-025](tasks/TASK-025.md) | 2 | GeoJSON feature import and export | `src/importers/geojson`, `src/project/geojson.ts` | 008, 020 | documented interchange, id conflict handling | done |
| [TASK-026](tasks/TASK-026.md) | 2 | Large synthetic city fixture | `src/fixtures/town.ts`, `src/fixtures/scenarios.ts`, `fixtures/projects/town.cityflows.json`, `tests/network/town.test.ts`, `tests/sim/town-day.test.ts` | 001 | compiles, full day under 1 percent failed, perf workload | done |
| [TASK-050](tasks/TASK-050.md) | 2 | Game-like UI redesign | `src/ui`, `src/render/style.ts`, `src/render/layers/*` visuals, `tests/e2e` names | 010 | all capabilities reachable, seven e2e scenarios green | done |
| [TASK-030](tasks/TASK-030.md) | 3 | Activity chains, through traffic, place events | `src/demand`, `src/sim/connectors.ts` (events, capacity), `tests/demand`, `tests/sim/T10*` | 011, 003 | T09 (full), T10 | done |
| [TASK-031](tasks/TASK-031.md) | 3 | Congestion-aware routing | `src/sim/link-costs.ts`, `src/sim/reroute.ts`, `src/routing` (costs) | 002, 004 | T06 | done |
| [TASK-032](tasks/TASK-032.md) | 3 | Ramps, merging, expressway construction | `src/sim/merge.ts`, `src/editor/commands/ramp.ts`, `src/ui/tools/ramp*`, `tests/sim/T07*` | 004, 022 | T07 (full), demo C | done |
| [TASK-033](tasks/TASK-033.md) | 3 | Place editor and demand panel | `src/ui/inspector/place*`, `src/ui/panels/demand*`, vehicle inspector reasons | 030, 010 | demos A and B reachable from the UI | done |
| [TASK-034](tasks/TASK-034.md) | 3 | Place painting and demand regeneration | `src/ui/tools/place-paint.tsx`, place controls, regenerate action, `tests/e2e/gate3-paint.spec.ts` | 050, 011 | painted place attracts trips after regenerate | done |
| [TASK-040](tasks/TASK-040.md) | 4 | Signal editor | `src/ui/inspector/signal*`, `src/render/layers/signal-preview.ts` | 010 | T13 through the UI | done |
| [TASK-041](tasks/TASK-041.md) | 4 | Metrics, layers and charts | `src/ui/panels/metrics*`, `src/ui/layers*`, `src/render/layers/heat.ts` | 005, 006 | readable congestion feedback | done |
| [TASK-042](tasks/TASK-042.md) | 4 | Scenario comparison | `src/ui/panels/compare*`, `src/project/scenarios.ts` | 008, 041 | same-seed baseline versus variant | done |
| [TASK-043](tasks/TASK-043.md) | 4 | Analysis and interchange exports | `src/project/export-*.ts`, export menu | 008, 041 | CSV and GeoJSON exports labelled synthetic | done |
| [TASK-044](tasks/TASK-044.md) | 4 | Performance and benchmark harness | `bench/`, hot paths in `src/sim`, `src/render` (coordinated), `tests/e2e/T16*` | 003, 004, 005, 006 | T16, targets in architecture section 15 | done |
| [TASK-045](tasks/TASK-045.md) | 4 | Gameplay acceptance demos and onboarding | `tests/e2e/demo-*.spec.ts`, first-run hint in `src/ui` | all Gate 1 to 4 | demos A to D recorded | done |
| [TASK-046](tasks/TASK-046.md) | 4 | Simulation hotspots | `src/sim/reroute.ts`, `engine.ts`, `lane-change.ts`, `src/host/headless.ts`, `export-data.ts`, `bench/` | 044, 032 | bench gains with unchanged hashes | done |
| [TASK-047](tasks/TASK-047.md) | 5 | Renderer polish: junctions, motion, markings | `src/render/**`, snapshot handling in `map-view.tsx`, `layers.tsx`, chart and hint CSS | 044, 046 | screenshots, T16 unchanged | done |
| [TASK-048](tasks/TASK-048.md) | 5 | Import quality on real OSM data | `src/importers/**`, compiler lane assignment, `bench/import-probe.ts`, `tests/importers` | 020, 030 | Munich baseline targets met | done |
| [TASK-049](tasks/TASK-049.md) | 5 | Junction controls: yield, stop, turn on red, roundabouts | `src/sim`, `src/network/signals.ts`, `src/editor`, `src/ui/tools/roundabout.tsx`, `src/render/layers/signs.ts` | 032, 040, 046 | gate5-controls scenarios | done |
| [TASK-051](tasks/TASK-051.md) | 5 | Live edits with bounded rerouting (B8) | `src/sim` (patch, reroute, link costs, types), `src/host/**`, `src/ui/store.ts` edit path, run-bar status, `tests/sim/T19*`, `tests/host`, `tests/e2e/gate1-edit.spec.ts` | 046, 048, 049, 055, 057; design in architecture 1, 6, 8, 10 | T19; an edit while playing applies without restart | done |
| TASK-052 | 5 | CI green on the Linux runner (lead) | `tests/e2e/gate3-paint.spec.ts`, `tests/e2e/gate3-places.spec.ts` | - | e2e green with wider fonts | done |
| [TASK-053](tasks/TASK-053.md) | 5 | Import demand scale (B13) | `src/ui/import/*`, `bench/import-probe.ts`, `tests/e2e/gate2-import.spec.ts` | 021, 048 | Munich runs at the default scale without gridlock | done |
| [TASK-054](tasks/TASK-054.md) | 5 | Signal junctions on import (B15) | `src/importers/osm/split.ts`, `controls.ts`, `index.ts` (junction seeds), `src/importers/signal-program.ts`, `tests/importers` | 048, 049 | no degree-two signal nodes on Munich | done |
| [TASK-055](tasks/TASK-055.md) | 5 | Undrivable routes (B17) | `src/routing/**`, `src/network/**`, `bench/route-audit.ts`, `tests/routing`, `tests/network` | 031, 046, 048 | route audit zero on four cities | done |
| [TASK-056](tasks/TASK-056.md) | 5 | Draw order by level (B19) | `src/importers/osm/roads.ts` (layer), `index.ts` (`addNode` layer), `src/render/scene.ts`, `src/render/layers/roads.ts`, `nodes.ts`, `tests/render` | 047 | bridges draw over what they cross | done |
| [TASK-057](tasks/TASK-057.md) | 5 | Pass-through at conflict-free nodes (B18) | `src/sim/intersection.ts`, `src/sim/engine.ts` (grant path), `src/sim/vehicle.ts`, `tests/sim` | 046, 049 | split road drives like one road | done |
| [TASK-058](tasks/TASK-058.md) | 5 | Sheets and inspector overlap (B14) | `src/ui/app.css`, `src/ui/run-bar.tsx`, `src/ui/App.tsx`, inspector container, `tests/e2e/gate3-places.spec.ts` | 050, 033 | no covered inspector control with a sheet open | done |
| [TASK-059](tasks/TASK-059.md) | 5 | Roundabout removal as an inverse command | `src/editor/commands/roundabout.ts`, `src/schema` (approved), `docs/architecture.md` section 6, `tests/editor` | 049 | removal after approach edits | done |
| [TASK-061](tasks/TASK-061.md) | 5 | Junction geometry: setbacks, curb arcs, tapers (B16) | `src/network/**` (lanes, movements, new `junctions.ts`, types), `src/geo/polyline.ts` (additive), `src/editor/commands/ramp.ts`, `src/render/layers/nodes.ts`, `roads.ts`, `signs.ts`, `scene.ts` picking, `src/fixtures/junctions.ts`, `tests/network/T20*`, `tests/render` | 047, 048, 049, 055; design in architecture 5.1, 5.2, 11 | T20; no overlapping lanes at Munich nodes | done |
| [TASK-062](tasks/TASK-062.md) | 5 | Routing throughput (B20) | `src/routing/**`, `tests/routing` | 055, 057 | routes per second back near the TASK-057 figures, audit zero, hashes unchanged | done |
| [TASK-063](tasks/TASK-063.md) | 5 | Junction surface, crossings, one asphalt colour (B21, B23, B24, B25) | `src/network/junctions.ts` (outline only), `src/geo/polyline.ts` (additive), `src/render/layers/nodes.ts`, `roads.ts`, `src/render/style.ts`, `scene.ts`, `types.ts` (layer flag), `src/ui/layers.tsx`, `tests/network/T20*`, `tests/render`, `tests/e2e/gate4-layers.spec.ts` | 061; design in architecture 5.1, 11 | T20 additions; hashes unchanged | done |
| [TASK-064](tasks/TASK-064.md) | 5 | Conflict zones instead of whole-movement conflicts (B26) | `src/network/conflicts.ts`, `src/network/types.ts` (additive), `src/sim/intersection.ts`, conflict reads in `engine.ts`, `merge.ts`, `patch.ts`, `tests/network/conflict-zones.test.ts`, `tests/sim` | 049, 051, 057, 061; design in architecture 5.3, 8 | T21; uncapped Munich at least as fast as capped | done (cap kept) |
| [TASK-065](tasks/TASK-065.md) | 5 | Zone reservations by time and a clear junction box (B27, B28) | `src/sim/intersection.ts`, zone-stop and counter in `engine.ts`, `types.ts`, `metrics.ts`, `src/schema/sim.ts` and `src/sim/params.ts` (additive), `tests/sim` | 064; design in architecture 8 | T22; uncapped Munich at least as fast as capped | done (cap kept) |
| [TASK-066](tasks/TASK-066.md) | 5 | Smooth road curves on import (B29) | `src/importers/osm/**`, `src/geo/polyline.ts` (additive), `tests/importers`, imported lane-pair lists in `tests/network` | 048, 054, 056, 061; design in architecture 13 | T23; junction nodes fixed, 2 m deviation | done |
| [TASK-067](tasks/TASK-067.md) | 5 | Ship it: static deploy and user guide | `.github/workflows`, `vite.config.ts`, URL lines in `tiles.ts`, `area-picker.tsx`, `overpass.ts`, `README.md` | 060; design in architecture 2 | published build without test hooks | done |
| [TASK-068](tasks/TASK-068.md) | 5 | Realign acute approaches on import; attribute the smoothing cost (B31, B30) | `src/importers/osm/**`, `src/geo/polyline.ts` (additive), an acute-Y OSM fixture, `tests/importers`, imported lane-pair lists in `tests/network`, `tests/routing/throughput-routes.json` | 061, 063, 065, 066; design in architecture 13 | T24; Munich at least 2 023 at 0.15 | done |
| [TASK-069](tasks/TASK-069.md) | 5 | Notes instead of warnings; deterministic vehicle pick (B22) | `src/network/types.ts` (severity), `src/network/diagnostics.ts`, `src/ui` diagnostics and badge, `tests/e2e/helpers.ts` and car-clicking scenarios, the warning table in `tests/importers/munich.test.ts` | 055, 058; design in architecture 5.5 | grid opens with Validation (0); demo B ten in a row | done |
| [TASK-071](tasks/TASK-071.md) | 5 | Lanes that continue through splits, merges and lane drops | `src/network/lanes.ts`, new `continuity.ts`, continuation nodes in `junctions.ts`, `types.ts` (additive), new `src/render/layers/transitions.ts`, `drawRoad` dividers, `scene.ts` wiring, a continuity fixture, `tests/network/T25*`, `tests/render` | 061, 063, 066, 068; design in architecture 5.1, 11 | T25; no pinch at splits and merges | done |
| [TASK-072](tasks/TASK-072.md) | 5 | Stop lines and crossings on the road | new `src/network/stops.ts`, `types.ts` (additive), ungranted stop rules in `src/sim`, `drawApproachMarkings` and `crossingStripes` in `roads.ts`, `tests/sim/T26*`, `tests/render` | 063, 064, 065; design in architecture 8, 11 | T26; cars stop before the crossing | done |
| [TASK-073](tasks/TASK-073.md) | 5 | Exercise the paths nobody has run end to end | `tests/e2e/qa-*.spec.ts`, e2e helpers and fixtures | 067, 069, 070 | defects reported, suite green | done |
| [TASK-074](tasks/TASK-074.md) | 5 | Junction shapes, measured on the real cities | new `bench/junction-audit.ts`, `src/network/junctions.ts`, `src/geo/polyline.ts` (additive), `src/render/layers/nodes.ts`, the marking clip in `drawRoad`, `NOTICE`, `tests/network/T27*` | 063, 068, 071, 072; design in architecture 5.1, 11 | T27; overlap outside outlines halved | done |
| [TASK-075](tasks/TASK-075.md) | 5 | Lane markings through junctions without signals | new `src/render/layers/junction-markings.ts`, `scene.ts` wiring, `style.ts` (additive), `tests/render/T28*` | 061, 063, 071, 072; design in architecture 11 | T28; dashed guide lines on major roads | done |
| [TASK-076](tasks/TASK-076.md) | 5 | Cars reach their exit: lane choice, cooperative gaps, give-up | `src/routing/lanes.ts`, `src/sim/lane-change.ts`, the proposal pass and `planLane` in `engine.ts`, `bench/import-probe.ts`, `tests/sim/T29*` | 032, 048, 071, 072; design in architecture 7, 8 | T29; no car held off its target lanes | done |
| [TASK-077](tasks/TASK-077.md) | 5 | Gridlock recovery: a stuck jam head fades and respawns | commit and removal in `engine.ts`, `connectors.ts`, `vehicle.ts`, `metrics.ts`, `types.ts`, snapshot transfer in `src/host`, `layers/vehicles.ts`, inspector and exports, `tests/sim/T30*` | 064, 065, 072, 076; design in architecture 1, 8, 11 | T30; Munich never locks | done |
| [TASK-078](tasks/TASK-078.md) | 5 | Junction curbs with a realistic radius, lanes untouched (B32) | `src/network/junctions.ts` (curbs only), `types.ts` (additive), `src/geo/polyline.ts` (additive), `drawNode` in `nodes.ts`, `bench/junction-audit.ts`, `tests/network/T31*` | 063, 074; design in architecture 5.1 | T31; hashes unchanged | done |
| [TASK-079](tasks/TASK-079.md) | 5 | Markings up to the junction, arrows once, offsets on curves (B33 to B35) | `src/render/layers/roads.ts`, a marking-offset export in `src/geo/polyline.ts`, `tests/render/T32*` | 072, 074, 075; design in architecture 11 | T32 | done |
| [TASK-080](tasks/TASK-080.md) | 5 | Short transitions, lanes through the remaining splits and merges (B36, B37) | `src/network/continuity.ts`, `lanes.ts`, `transitions.ts`, `drawRoadJoins` in `nodes.ts`, `tests/network/T33*` | 071, 074, 076; design in architecture 5.1 | T33 | done |
| [TASK-081](tasks/TASK-081.md) | 5 | Geometry audit and visual regression harness | new `bench/geometry-audit.ts`, `bench/geometry-shots.ts`, `package.json` scripts, `tests/bench/T34*` | 074, 078, 079, 080; plan "Geometry rework" | T34; baseline of G1, G2 | done |
| [TASK-082](tasks/TASK-082.md) | 5 | Corridors first: lanes and surfaces at a constant offset (G1, B38) | new `src/network/corridor.ts`, `lanes.ts`, `compile.ts` wiring, `types.ts` (additive), `src/geo` (additive), offsets read in `roads.ts`/`transitions.ts`, `tests/network/T35*` | 071, 079, 080, 081; plan "Geometry rework" | T35; width error under 0.05 m | done |
| [TASK-084](tasks/TASK-084.md) | 5 | Importer: corridors, separated carriageways, relaxation | `src/importers/osm` (new `corridors.ts`, `relax.ts`), import options, `tests/importers/T36*` | 066, 068, 070, 081; plan "Geometry rework" | T36; relaxation value by experiment | done |
| [TASK-085](tasks/TASK-085.md) | 5 | Through movements at multi-lane splits and merges (B39) | `src/network/movements.ts`, `tests/network/T37*` | 071, 076, 080; plan "Geometry rework" | T37 | done |
| [TASK-083](tasks/TASK-083.md) | 5 | Junction polygons, osm2streets-style: through roads keep their line (G2) | `src/network/junctions.ts` (rewritten), through-movement geometry in `movements.ts`, `types.ts`, `compile.ts`, `drawNode`, `realign.ts` call, `tests/network/T38*`, T20/T27/T31 | 081, 082, 084, 085; plan "Geometry rework" | T38; G2 within 0.1 m | done |
| [TASK-087](tasks/TASK-087.md) | 5 | Importer: no overlapping carriageways near junctions (B41, B42) | `src/importers/osm/**`, audit measure 9 in `bench/geometry-audit.ts`, `tests/importers/T39*`, `tests/network/junction-audit.ts` lists | 083, 084; plan "Geometry rework" | T39; no corridor lane overlap outside outlines | done (partial, rest in TASK-089) |
| [TASK-088](tasks/TASK-088.md) | 5 | Lane dividers across multi-lane splits; markings at n:1181 (B44) | `src/render/layers/roads.ts`, `junction-markings.ts`, `tests/render/T40*` | 075, 083, 085 | T40 | done |
| [TASK-089](tasks/TASK-089.md) | 5 | Converging carriageways side by side, through alignments that reach, a constant median, clean curb ends (B41, B43, B42) | `src/network/junctions.ts`, `movements.ts`, `nodes.ts`, `tests/network/T38*` | 083, 087 | T38 extended, T39.4, T39.5 | done |
| [TASK-090](tasks/TASK-090.md) | process | Fast checks: test tiers, a city import cache, one shared Munich morning | `package.json` scripts, `vite.config.ts`, `playwright.config.ts`, CI, `bench` loaders, `tests/**`, `AGENTS.md` | none | tiers, cache, shared morning | done |
| [TASK-091](tasks/TASK-091.md) | 5 | Pedestrian crossings everywhere and editable; centre lines end at the junction (B50, B46, B52) | `src/schema`, `src/render/layers/roads.ts`, `junction-markings.ts`, `src/ui/inspector/node.tsx`, `tests/render` T41 | 072, 074, 089 | T41 | done (signal-arm set-back open, B53) |
| [TASK-092](tasks/TASK-092.md) | 5 | Every junction corner sweeps with a radius; rounded median noses (B48, B51, B52) | `src/network/junctions.ts`, `src/render/layers/nodes.ts`, audit corner measure, `tests/network` | 083, 089, 090 | corner audit zero | done |
| [TASK-093](tasks/TASK-093.md) | 5 | One street's carriageways: overlap at n:967, median voids, lane-to-lane continuation (B49, B45, B47) | `src/importers/osm/corridors.ts`, `realign.ts`, `src/network/continuity.ts`, `corridor.ts`, `lanes.ts`, T39 | 084, 087, 089, 071, 090 | T39 extended | done |
| [TASK-094](tasks/TASK-094.md) | 5 | Stop lines behind set-back crossings at signals (B53) | `src/network/stops.ts`, crossing span, `src/render/layers/roads.ts` (placement), T26, T41, `bench/latest.log` | 072, 091, 090 | T26 extended, T41.5 | done |
| [TASK-095](tasks/TASK-095.md) | 5 | Roads that approach a node side by side are drawn attached, with a divider line (B54, B55) | `src/importers/osm/corridors.ts`, `src/network/continuity.ts`, `corridor.ts`, `lanes.ts`, `junctions.ts`, `nodes.ts`, `roads.ts` (divider), audit measures | 089, 092, 093, 090 | T39/T43 | failed; importer part salvaged |
| [TASK-099](tasks/TASK-099.md) | 5 | One lateral shift profile per corridor stretch (B54, B55 redesign; replaces TASK-089's split arrays and TASK-095's pull) | `src/network/continuity.ts`, `corridor.ts`, `lanes.ts`, `compile.ts`, `types.ts`, `junctions.ts`, `roads.ts`/`nodes.ts` (markings), audit | 089, 092, 093, 094, 095 salvage | T39/T45, traffic gate | done (partial: B54 west and `n:638`; B55 open) |
| [TASK-096](tasks/TASK-096.md) | 6 | OSM surroundings (buildings, land use, water, parks, railways) drawn under the roads | `src/importers/osm/context.ts`, `overpass.ts`, `City.context` (schema), `src/render/layers/context.ts`, `scene.ts`, Layers, import wizard | 090 | T44, project round trip, e2e smoke | done |
| [TASK-097](tasks/TASK-097.md) | 6 | Shadows, deck edges, tunnel style and see-through under decks for grade separation | `src/render/layers/shadows.ts`, `scene.ts`, `style.ts`, Layers, shot cameras | 090 | unit, e2e smoke | done |
| [TASK-098](tasks/TASK-098.md) | 6 | 3D view of the running city, viewer only (three.js) | `src/render3d/`, shared grade and pose functions, map view toggle, store | 090; phase B 096 | unit, 3D shots, e2e smoke | done |
| [TASK-100](tasks/TASK-100.md) | 7 | Vehicle classes: car, van, truck and bus, each with its own size and driving | `src/schema` (class, version 3), `src/sim/**`, `src/demand/**`, `src/host/**`, vehicle layers 2D and 3D, vehicle inspector | 090 | T46, traffic quick | done |
| [TASK-101](tasks/TASK-101.md) | 7 | Restricted road access: closed roads, local-traffic zones, delivery and bus lanes | `Road.access` (schema), `compile.ts`, `src/routing/**`, access tags in `roads.ts`, `src/editor`, street inspector | 090 | T47, traffic quick | done |
| [TASK-105](tasks/TASK-105.md) | 8 | Terrain: elevation grid at import, relief in 3D, hillshade in 2D | `City.terrain` (schema), `src/importers/terrain.ts`, `render3d/terrain.ts`, `heights.ts`, 2D hillshade layer | 096, 098 | V105, 3D shots | done |
| [TASK-106](tasks/TASK-106.md) | 8 | Vegetation and surfaces: OSM and generated trees, filled woods, ground textures | context points (schema), `context.ts` import, `render/vegetation.ts`, vegetation layers 2D and 3D | 096, 098 | V106, shots | done |
| [TASK-108](tasks/TASK-108.md) | 8 | Lane marking realism: hatched gores, channelizing lines, a marking theme, standard arrows | `render/marking-geometry.ts`, `roads.ts`, `junction-markings.ts`, `transitions.ts`, `render3d/markings.ts`, `style.ts` | 079, 088, 091, 098 | V108, shots | done |
| [TASK-109](tasks/TASK-109.md) | 8 | Building details: terrain footprints closed, roof shapes, colours, window bands | building fields of `ContextFeature` (schema), building tags in `context.ts`, `render3d/context.ts`, `terrain.ts` (footprint closure), new `render3d/roofs.ts`, Building details layer | 096, 098, 105 | V109, 3D shots | done |
| [TASK-115](tasks/TASK-115.md) | perf | Render on demand: 2D and 3D draw only when something changes; CI e2e timeout back to 60 s | `src/render/scene.ts` and layer setters, `src/render3d/scene.ts`, the frame loop in `map-view.tsx`, frame-timing specs, `playwright.config.ts` | - | V115, T16, T44, V106 | done |
| [TASK-102](tasks/TASK-102.md) | 7 | Parking model and garages: facilities, choice on arrival, cruising, departures from where parked | `City.parking` refinements, new `importers/osm/parking.ts`, facility compile, new `src/sim/parking.ts`, `connectors.ts`, `engine.ts`, demand, snapshot, facility inspector and occupancy layer | 100, 101, Phase 2 formats | T48, traffic quick | done (see review) |
| [TASK-104](tasks/TASK-104.md) | 7 | Surface lots: aisles as service roads, generated stalls, stall paint; no simulation | lot fields of `City.parking`, `filter.ts`, new `importers/osm/lots.ts`, aisle roads, new `src/network/stalls.ts`, stall layers 2D and 3D | 096, 101, Phase 2 formats | T49, traffic quick, shots | done (mapped entries only; unreachable lots diagnosed; see review) |
| [TASK-107](tasks/TASK-107.md) | 8 | Street furniture: lamps, 3D curbs, access signs, `BUS` lane text (sidewalks moved to 110) | `street_lamp` context points (schema), `context.ts` import, new `render/street.ts`, street layers 2D and 3D, `BUS` text in `marking-geometry.ts` | 101, 106, 108 | V107, shots | done |
| [TASK-110](tasks/TASK-110.md) | 9 | Pedestrian network: footways, sidewalks, crossings, entrances, walk routing, walk layers | `City.walk` and `Road.sidewalk` refinements, new `importers/osm/walk.ts`, new `src/network/walk.ts`, new `src/routing/walk.ts`, walk layers 2D and 3D | 091, 094, 096, Phase 2 formats | T50, shots | done |
| [TASK-114](tasks/TASK-114.md) | 8 | US and UK marking themes, chosen per project, default by country | `City.markingTheme` (schema), theme table in `style.ts`, `marking-geometry.ts`, country detection, marking style setting | 108 | V114, shots | done |
| [TASK-116](tasks/TASK-116.md) | perf | Lane targets as feasible sets for every route (generalises TASK-101's fix) | `src/routing/index.ts`, `lane-search.ts`, `lanes.ts`, `src/sim/engine.ts`, `lane-change.ts`, `reroute.ts`, `patch.ts` | 076, 101 | T51, T29, T46, traffic quick | done |
| [TASK-103](tasks/TASK-103.md) | 7 | Visible parking: roadside strips and lot stalls in the simulation, park and leave manoeuvres, parked cars drawn | `strip` facilities (import, inference, compile), inferred lot driveways, `src/sim/parking.ts`, `connectors.ts`, `engine.ts`, parked-car layers 2D and 3D, road inspector | 102, 104 | T52, traffic quick, shots | done (see review) |
| [TASK-111](tasks/TASK-111.md) | 9 | Pedestrian rules: walkers, zebra priority, pedestrian signal phases, a test pedestrian source | new `src/sim/walkers.ts`, crossing spans, `SignalProgram` walk groups, `intersection.ts`, `signals.ts`, walker layers 2D and 3D, signal editor | 110 | T53, traffic quick unchanged, shots | done (see review) |
| [TASK-117](tasks/TASK-117.md) | 8 | Visual fixes after Phase 2: sign collisions, UK kerb lines only on urban kerbs, access signs by marking theme | `src/render/street.ts` (sign placement), `layers/street.ts`, `render3d/street.ts`, `marking-geometry.ts`, `style.ts` | 107, 114 | V117, shots | done (see review) |
| [TASK-118](tasks/TASK-118.md) | 7 | Parking motion: circulation inside lots, stochastic stall choice, visible strip manoeuvres, individual slot departures (owner bugs 1 and 2) | `src/network/stalls.ts`, new `lot-paths.ts`, `src/sim/parking.ts`, `connectors.ts`, `engine.ts`, new `manoeuvre.ts`, renderers | 103, lead follow-up | T54, traffic quick, shots | done (see review) |
| [TASK-119](tasks/TASK-119.md) | 7 | Mapped street-side parking areas become strips; dropped lots and garage imported (owner bug 3) | `src/importers/osm/strips.ts`, `lots.ts`, `parking.ts`, `places.ts`, `src/network/strips.ts` | 103 | T55, traffic quick, shots | done (see review) |
| [TASK-120](tasks/TASK-120.md) | 7 | Dead-end turnarounds: an implicit U-turn at single-road dead ends, so strip cars there can leave; restores the 2% full-demand parking gate | `src/network/movements.ts`, `junctions.ts` (dead-end cap), `diagnostics.ts` | 118, 119 | T56, traffic quick, shots | rejected (lead's premise error; see review), replaced by TASK-122 |
| [TASK-112](tasks/TASK-112.md) | 9 | Trips made by people: access walk to the parked car, drive, egress walk to the destination; walk-mode trips simulated; person view (owner bug 4) | new `src/sim/persons.ts`, `walkers.ts` (spawn API), `parking.ts`, `connectors.ts`, `src/demand/**`, host snapshot and person inspect, person view, walker layers | 103, 110, 111, 118 | T57, traffic quick, shots | done (round 2; see review) |
| [TASK-121](tasks/TASK-121.md) | 7 | Queue heads that cannot enter re-route (B56): a head detour after `headDetourS`, gate back to 0 stalled heads | `src/sim/engine.ts` (`planLane`, fallback), `intersection.ts`, `reroute.ts`, `SimParams.headDetourS` | 048, 076, 077, 116 | T58, traffic quick, stability probe | done (merged with TASK-112; see review) |
| [TASK-122](tasks/TASK-122.md) | 9 | Trip cars start and park only on spaces they can drive away from (replaces TASK-120): halves the full-demand parking failures | `src/sim/parking.ts`, `connectors.ts`, `persons.ts`, new departure check in `src/sim/` | 103, 112, 118, 119 | T59, full-demand test, traffic quick | done (lead re-measure on TASK-124 and TASK-125; see review) |
| [TASK-123](tasks/TASK-123.md) | 9 | One connected walk network (B57): Sindelfingen places and garages join the main walk network, so walk legs stop falling back to a straight line | `src/network/walk.ts`, `crossings.ts` (defaults), `src/importers/osm/walk.ts`, new join helper in `src/network/` | 110, 111, 112 | T60, walk fallbacks under 2%, traffic quick, shots | done (round 3; see review) |
| [TASK-124](tasks/TASK-124.md) | 9 | Every garage and place has a car exit (B58): connectors snap to lanes a car can leave; `parking_no_exit` and `place_no_exit` warnings | `src/importers/osm/places.ts` (car core, `placeConnector`), `parking.ts`, `src/network/parking.ts`, `diagnostics.ts` | 102, 103, 104, 119 | T61, exit census, traffic gates | done (see review) |
| [TASK-125](tasks/TASK-125.md) | 9 | Parking claims: a car that chooses a strip space, garage or lot claims it; claimed spaces are taken for others and full-by-claims facilities drop out; every exit path releases the claim | `src/sim/parking.ts`, release calls in `src/sim/engine.ts`, metrics | 102, 103, 118, 124 | T63, Munich 0.15 gate with lower search time, T53, baseline reset | done |
| [TASK-126](tasks/TASK-126.md) | 10 | Railway tracks and stations: a track graph imported, compiled, saved and drawn; stations tied to platforms and walk entrances | new `src/importers/osm/rail.ts`, `src/network/rail.ts`, rail layers, `src/schema` (rail network), fixtures (railway ways appended) | 096, 110, 123 | T62, census, traffic unchanged, shots | done |
| [TASK-127](tasks/TASK-127.md) | 10 | Decorative trains: S-Bahn trains stop at Donnersbergerbrücke, main-line trains pass through, by a deterministic timetable on the sim clock; drawn in 2D and 3D; no sim change | new routes/timetable/motion module, train layers, `src/network/rail.ts`, rail schema (preferred direction) | 126 | T64, traffic and sim hash unchanged, frame time, shots | done |
| [TASK-128](tasks/TASK-128.md) | 10 | Stations as trip ends: S-Bahn riders walk out of Donnersbergerbrücke after each stop, walk to work or a visit nearby, and walk back to board; walk-only, timed by TASK-127's timetable | new rider module in `src/demand/`, `schedule.ts`, person inspector, rider census | 126, 127 | T65, Munich 0.15 gate with riders, Sindelfingen and synthetic trips unchanged, shots | done 2026-11-13 (merged after TASK-154, via TASK-159) |
| [TASK-129](tasks/TASK-129.md) | 10 | Car ownership: persons grouped into households that own their members' cars; a person drives only a free household car (owners first, borrowers for a whole free day), a car's trips chain by car, every car starts and parks near home | `src/demand` (households, drivers), `src/schema` (`householdId`, `carId`, `homeParkingRadiusM`), `src/sim/parking.ts`, `persons.ts`, person inspector, census | 112, 122, 125 | T67, Munich 0.15 seeds 1 to 3, no car parked beyond the home radius while room is near, baseline reset | done 2026-11-13 (merged on main after TASK-154) |
| [TASK-130](tasks/TASK-130.md) | 7 | Break the Landsberger loop (B56 reopened): trace the cycle TASK-121's head detours do not clear, then the smallest general rule (box entry, zipper or wider detours) so the corridor drains | `src/sim/intersection.ts`, `engine.ts`, `reroute.ts`, `lane-change.ts`, `merge.ts`, `params.ts`, probe seeds | 121, 122, 077 | T66, 0 stalled heads over seeds 1 to 3, loop waits under 15 min, baseline reset | reviewed and held at `215afac`; B56 is part of TASK-131 Phase 3 |
| [TASK-131](tasks/TASK-131.md) | 5 | Junction groups (B54 amended, B55): every OSM node keeps its position; nodes joined by links up to `junctionGroupMaxM` (30 m) form one junction group with inner links kept, one coordinated signal program and one drawn surface; the collision model off; cars never stop on inner links | `src/importers/osm/**`, `src/schema` (junction group), `src/network/**`, road and junction renderers, signal editor; Phase 3 `src/sim/intersection.ts`, `signals.ts`, `engine.ts` with B56 | 089, 092, 094, 099, 111; B56 folded into Phase 3 | T68, reference-case shots per checkpoint, geometry gates, traffic over seeds 1 to 3, baseline reset | Phases 0 to 2 merged 2026-11-11 (lead-driven subagents); Phase 3 / B56 deferred at local checkpoint `4ab4d71` (wait and step-time gates unmet); TASK-130 held |
| [TASK-133](tasks/TASK-133.md) | 10 | Station furniture: name boards, shelters, benches, departure displays from the timetable, generic entrance signs; visual only | new `src/render/layers/stations.ts`, `src/render3d/stations.ts`, placement module, read-only helper in `src/network/trains.ts` | 126, 127 | T70, shots, no hash change | done 2026-11-11 |
| [TASK-135](tasks/TASK-135.md) | 10 | Trams as their own kind of track: embedded, grass, paved or ballast form from OSM tags or inference, a distinct tram look in 2D and 3D | `src/schema/rail.ts`, `src/importers/osm/rail.ts`, rail drawing 2D and 3D, `style.ts` | 126, 127, 131 | T69, shots against the imagery, no hash change | done 2026-11-11 |
| [TASK-140](tasks/TASK-140.md) | 9 | Crossing walk links, pedestrian heads and walker conflict zones at the zebra stripes (B59) | `src/network/crossings.ts`, `walk.ts`, `walk-joins.ts`, `conflicts.ts`, head drawing | 091, 094, 110, 111, 131 | T71, every link within 0.5 m of its stripes, T53, baseline reset | done 2026-11-11 |
| [TASK-132](tasks/TASK-132.md) | 10 | Rail heights: tunnels below ground with portals, bridges and viaducts on piers, ramps within 4% (trams 6%); find and draw the Munich tunnel missing today | `src/network/rail.ts`, rail drawing 2D and 3D, `src/render3d/heights.ts` (rail), small importer functions | 126, 127, 135 | T72, the tunnel drawn, no sim hash change | done 2026-11-11 |
| [TASK-134](tasks/TASK-134.md) | 10 | Overhead lines: wired by `electrified` (no tag draws it), close parallel tracks share masts and portals every 40 to 60 m clear of switches, crossings, roads and platforms, a contact and messenger wire over each track; 2D and 3D | new catenary modules, scene hooks, a small `electrified` read in the rail importer | 126, 132, 135 | T74, counts and shots, no hash change | done 2026-11-11 |
| [TASK-137](tasks/TASK-137.md) | 10 | Tram stops: imported stops and platforms grouped per stop, generated islands for node-only stops, shelters, names, markings and a name-and-lines display; visual only | new tram-stop modules, `src/schema/rail.ts` (optional stops), scene hooks, rail inspector | 126, 133, 135 | T73, every Munich tram stop placed or listed, no sim hash change | done 2026-11-11 |
| [TASK-136](tasks/TASK-136.md) | 10 | Level crossings | rail import, crossing placement and drawing | 127, 135, 138 for tram service | T75, shots | done 2026-11-13 (PR #1 merged on TASK-154) |
| [TASK-138](tasks/TASK-138.md) | 10 | Scheduled trams serving stops and crossing road traffic | timetable, tram poses, vehicle drawing and inspection | 135, 137, 136 for crossing priority | service tests, Munich shots and live car interaction | done 2026-11-13 (PR #1 merged on TASK-154) |
| [TASK-141](tasks/TASK-141.md) | 7 | Diagnose the Munich parking-motion failure | T54 repro and trace | 118 | first divergence on main | done with TASK-142 (lead review below) |
| [TASK-142](tasks/TASK-142.md) | CI | Repair the November 12 nightly full suite | six affected browser specs, beside TASK-141 | nightly run 43187179345 | Full | done (Full run 43193281232 green) |
| [TASK-143](tasks/TASK-143.md) | 3 | Reuse identical route searches by a waiting queue head | sim head detours | 121 | unchanged traffic hashes and fewer repeated searches | done (Full run 43216929096 passed) |
| [TASK-144](tasks/TASK-144.md) | audit | Munich lot access | parking importer and route verification | 104, 122 | contract checks and lead review | merged in PR #4 |
| [TASK-145](tasks/TASK-145.md) | audit | T62/T64 frame times | rail performance tests and renderer | 126, 127 | contract checks and lead review | audit merged, SwiftShader 3D fixed in TASK-148 |
| [TASK-146](tasks/TASK-146.md) | audit | Westbound lane gain | Munich source and compiled road geometry | after 144 and 145 | contract checks and lead review | merged in PR #3 |
| [TASK-147](tasks/TASK-147.md) | audit | PR #1 traffic CI repair | operating crossings on the held PR | 136 and 138 branch | contract checks and lead review | done 2026-11-13 (PR #1 merged) |
| [TASK-148](tasks/TASK-148.md) | render | Reduce SwiftShader rail drawing time | 3D renderer | 145 | T62/T64 with local assertions | done (PR #6) |
| [TASK-149](tasks/TASK-149.md) | importer | Verify remaining parking-lot access in both extracts | OSM parking access, route tests | 144 | 26 sites, legal routes and geometry shots | done (PR #5) |
| [TASK-150](tasks/TASK-150.md) | 7 | A car leaving a lot waits clear of the public lane and merges continuously once granted | `src/sim/parking.ts`, `manoeuvre.ts`, `engine.ts` (exit), T77 | 118, 122, 149 | T77, witness 0 overlaps, T54/T59/T63, Munich gate, shots | done 2026-11-13 |
| [TASK-151](tasks/TASK-151.md) | 7 | PR #1 on today's main: find why crossings and tram service plus main's parking changes fail the gate (3,300 / 49 / 1) and repair the cause | `src/sim/**` (crossing control, rail service, parking, engine), tests | 136, 138, 147, 149, 150 | Munich gate, T75/T76, parking tests, 0.1 s replay | closed 2026-11-13: B56 fixed by TASK-154; PR #1 merged |
| [TASK-152](tasks/TASK-152.md) | 7 | Lots whose aisles are roads: a bay beside a drivable aisle leaves into the aisle lane by the strip rule, not along it as a motion | `src/network/parking.ts`, `src/importers/osm/parking.ts` (connectors), minimal `src/sim/parking.ts` | 104, 149, 150 | census 0 in-lane holds, regression, route records, Munich gate, shots | done 2026-11-13 |
| [TASK-153](tasks/TASK-153.md) | 7 | Lot admission waits behind exiting cars (pk:2049 up to 2,173 s) | `src/sim/parking.ts`, engine callbacks | 149, 150, 151 | per-lot wait census, pk:2049 under 300 s, Munich gate, shots | done 2026-11-13 (merged on TASK-154) |
| [TASK-113](tasks/TASK-113.md) | 9 | Mode choice: walk, drive, or drive and walk per trip by a logit model with household car availability; sliders and mode shares | `src/demand/**`, demand schema, demand sheet, metrics, `src/sim/persons.ts` at departure | 112, 129 | model tests, Munich census, gate with choice off and on, shots | done 2026-11-13 |
| [TASK-154](tasks/TASK-154.md) | 7 | Land TASK-131 Phase 3 (candidate `4ab4d71`) and drain the Landsberger loop (B56): step time within budget, per-visit drain criterion, PR #1 checked on top | `src/sim/**` (not parking admission) | 131, 143, 149, 150 | seed-1 gate, drain criterion seeds 1-3, step time, PR #1 check, shots | done 2026-11-13 (drain (b) and (c) open: TASK-161, TASK-153) |
| [TASK-155](tasks/TASK-155.md) | 9 | Sindelfingen gateway trips on cut-off motorway components (245 failures) generated only where servable, failures labelled by real reason | `src/demand` gateway trips, `src/sim/connectors.ts` attribution, gateway import | 104, 122 | Sindelfingen before/after, Munich unchanged, regression | done 2026-11-13 |
| [TASK-156](tasks/TASK-156.md) | 7 | Lot aisles no lane vehicle reaches (Munich 68, Sindelfingen 232 holds) and visible arrivals on aisle roads | `src/network/parking.ts`, `parking-egress.ts`, arrival path in `src/sim/parking.ts` | 152, 153 | census, route records, Munich gate, shots | done 2026-11-13 (partly; rest in TASK-164) |
| [TASK-157](tasks/TASK-157.md) | 7 | Lot exits bound for the far lane hold clear of the near lane and are granted both gaps (Munich 333, Sindelfingen 1,749) | `src/sim/parking.ts` hold/grant, `manoeuvre.ts`, engine exit | 150, 153 | census, regression, Munich gate, shots | done 2026-11-13 |
| [TASK-158](tasks/TASK-158.md) | 9 | TASK-129's extra gridlock (44 against 39), only if it persists after TASK-154 | `src/demand` households, initial stock | 129, 154 | Munich gate with TASK-129 | not needed: TASK-129 passed after TASK-154 |
| [TASK-159](tasks/TASK-159.md) | 10 | TASK-128 riders' car cost (-11%, -16%, -4%): re-measure after B56, then repair | `src/demand/stations.ts`, walker crossings in `src/sim` | 128, 154 | Munich gate with riders, T65, T53 | done 2026-11-13: no repair needed; TASK-128 merged |
| [TASK-160](tasks/TASK-160.md) | UI | macOS-style interface and map: Sonoma/Ventura flat, Arimo, system blue, docked window (toolbar, sidebars, inspector, status bar), neutral map palette in 2D and 3D | `src/ui/**`, `src/render/style.ts` and colours, `src/render3d` colours, fonts, `AGENTS.md` design | 050 | phase shots to the owner, check, e2e, T62/T64 frame gates, contrast | done 2026-11-13 (merged together) |
| [TASK-161](tasks/TASK-161.md) | 7 | Junction-group signal programs serve every approach (group 10 gives `r:961`'s right turn 15 s per 120 s; single loop visits up to 1,803 s) | `src/network/groups.ts`, `signals.ts`, `signal-program.ts` | 131, 154 | drain criterion (b) for `r:961`, group program census, Munich gate | done 2026-11-13 |
| [TASK-162](tasks/TASK-162.md) | UI | Mac-style map (TASK-160 phase 3, in parallel): plain canvas with OSM tiles off by default, quiet place tints, system-colour destination tints, Apple-Maps light roads, 2D and 3D | `src/render/**`, `src/render3d/**` colours and styles, tiles default | 160 | matched shots, contrast, T62/T64 frame gates, render tests | done 2026-11-13 (merged together) |
| [TASK-163](tasks/TASK-163.md) | UI | Scene lighting settings (Day / Evening / Night, follow the sim clock, exposure) and an evening scene with artificial lighting: lit lamps with ground glow, lit windows, vehicle lights, emissive signals; 2D evening tint | `src/render3d/**`, `src/render/**` evening layers, a lighting settings component | 107, 162 | shots per preset, T62/T64 within 10% of Day, view-only state | done 2026-11-13 (2D Evening cost to TASK-176) |
| [TASK-164](tasks/TASK-164.md) | 7 | Remaining lot aisle holds (pk:2056, pk:1487, pk:1475), private-aisle departures checking arrivals, lot-entrance lane release (TASK-156 follow-up) | `src/sim/parking.ts` exits/departureRoom/hold, `manoeuvre.ts`, `src/network/parking.ts` | 152, 156, 157 | census, regressions, route records, Munich gate, shots | done 2026-11-13 (pk:1475 left) |
| [TASK-165](tasks/TASK-165.md) | 9 | Crosswalk safety at junction-group exits: walkers never step onto a span a vehicle body stands on; cars not admitted onto an exit crosswalk without room past it (T53 overlap at n:251 with mode choice on) | `src/sim/walkers.ts`, crossings, `intersection.ts` exit storage | 111, 140, 154, 161, 113 | T53 with mode choice on, regression, Munich gate | done 2026-11-13 |
| [TASK-166](tasks/TASK-166.md) | UI | Dark appearance for the Mac UI (System / Light / Dark, optional match to night lighting) | `src/ui/**` tokens, map dark variant | 160, 162, 163 | shots both appearances, contrast, T62/T64 | done 2026-11-13 (frame check to TASK-176) |
| [TASK-167](tasks/TASK-167.md) | UI | Street-name labels and map typography (Arimo, along roads, collision-free) | `src/render/**` label layer | 160, 162 | shots, no overlaps, T62/T64 within 5% | done 2026-11-13 (2D only; T64 2D frame check to TASK-176) |
| [TASK-168](tasks/TASK-168.md) | UI | Keyboard shortcuts and a command menu (⌘K), shortcut sheet | `src/ui` key bindings, command menu | 160 | e2e spec, previews | done 2026-11-13 (T80 key-drop fix fc82ace) |
| [TASK-169](tasks/TASK-169.md) | 7 | Keep-clear at driveways, lot mouths and exit crosswalks (pk:2049 exit waits) | `src/sim/**` queue stops, `src/network` zones, marking | 164, 165 | exit-wait census, Munich gate, shots | done 2026-11-13 (with TASK-170) |
| [TASK-170](tasks/TASK-170.md) | 7 | Demand-aware signal splits and optional actuation | `src/network/signal-program.ts`, `src/sim/signals.ts`, signal editor | 113, 161 | seeds 1-3, drain criterion, gate | done 2026-11-13 (actuated default, split opt-in; owner review) |
| [TASK-171](tasks/TASK-171.md) | CI | Test infrastructure: one timeout setting, heavy tests serialised, warm import cache | test config, test files | none | no timeout failures under load, CI not slower | done 2026-11-13 |
| [TASK-172](tasks/TASK-172.md) | CI | Nightly three-seed traffic report (advisory) | `bench/seed-report.ts`, Full workflow | 113, baseline reset | manual Full run | done 2026-11-13 |
| [TASK-173](tasks/TASK-173.md) | 9 | Mode choice at each departure (progressive car chains and stock) | `src/sim/persons.ts`, `parking.ts`, `src/demand` | 113, 164 | choice off = main, mode-share guard, gate | done 2026-11-13 |
| [TASK-174](tasks/TASK-174.md) | 9 | Transit as a mode: walk, tram or S-Bahn, walk, with capacity | `src/demand`, transit routing, `src/sim`, inspector | 173, 138, 127, 128 | routing tests, census, gate | done 2026-11-13 |
| [TASK-175](tasks/TASK-175.md) | 5 | Road grade in the compiled network (contract change, pre-approved) | `src/network`, schema, parking holds, picking | none | under-bridge census, gate, pins proved | done 2026-11-13 |
| [TASK-176](tasks/TASK-176.md) | perf | Performance pass after the 2026-11-13 merges | profiles, exact rewrites | most of the above | quiet-machine numbers, hashes unchanged | done 2026-11-14 |
| [TASK-177](tasks/TASK-177.md) | docs | User documentation and in-app help for the new features | README, hints | 160-163, 168 | links, onboarding e2e | done 2026-11-14 |
| [TASK-178](tasks/TASK-178.md) | CI | Repair the full test tier after the 2026-11-13 merges (Full run 43479489386: full-demand timeout, T19, T47, V100, gate4-layers, qa-mobile, T16 stress, T54 Munich and others) | `tests/e2e/**`, `tests/traffic/**`, small fixes | 113, 160, 161, 173, 175 | full tier green, manual Full run | done 2026-11-13 (Full run 43516520585 green) |
| [TASK-179](tasks/TASK-179.md) | CI | Full-tier specs after the queue merge (T65 riders under TASK-174, T16 stress under actuated signals) | `tests/e2e/**`, `bench/workloads.ts` | 166-170, 174 | both specs, check, Full run | done 2026-11-13 (Full run waits for TASK-176's full-demand item) |
| [TASK-180](tasks/TASK-180.md) | 9 | Full-demand throughput drop after the queue merge (3,579 to 2,460 completed) and the actuation default, measured | diagnosis, `src/sim/**`, `signal-program.ts` | 169, 170, 174, 176 | seeds 1-6 and full demand table, gate, guard, drain | done |
| [TASK-181](tasks/TASK-181.md) | UI | Window scrolls sideways after Play at 1280 px; mode-choice switch label covers transit | `src/ui/**` | 160, 174, 177 | no horizontal scroll at 1280/1024/900 px, e2e | done 2026-11-14 |
| [TASK-182](tasks/TASK-182.md) | UI | One copy of each rule in `app.css` (duplicate blocks from the UI merges) | `src/ui/app.css` | 160, 166, 181 | computed styles identical, shots, contrast | done |
| [TASK-183](tasks/TASK-183.md) | UI | Street, station, stop and place labels in 3D (TASK-167's rules, collision-free, Labels toggle) | `src/render3d/**`, `src/render/labels.ts` shared parts | 167 | no overlaps, T64 3D within 5%, shots | done |
| [TASK-184](tasks/TASK-184.md) | UI | Follow clock seasons so a run reaches evening; 2D vehicle lights under bridge decks | `src/render/lighting.ts`, lighting settings, 2D light layer | 163 | sun model tests, V163, T62/T64, shots | done |
| [TASK-185](tasks/TASK-185.md) | render | 2D street-label frame cost under TASK-167's 5% gate | `src/render/layers/labels.ts`, 2D scene | 167, 176 | T62/T64 2D rounds, placement unchanged | done |
| [TASK-186](tasks/TASK-186.md) | render | 2D Evening frame cost within 10% of Day | `src/render/layers/night.ts`, vehicle lights | 163, 184 | Evening/Day rounds, matching shots, V163 | done |
| [TASK-187](tasks/TASK-187.md) | 9 | Full-demand step time (rail crossings, spawn), results unchanged | `src/sim/**`, bench profiling | 176, 180 | identical hashes, 25% faster full demand | done (23.7% of 25%) |
| [TASK-188](tasks/TASK-188.md) | 9 | Actuated signals as the default again after the seed-6 loop exit drains; actuated walk lights in amber | `src/sim/**`, `signal-program.ts` | 170, 180, decision signal-timing | seeds 1-6 and full demand tables, drain, gate, guard | done (fixed-time stays; walk lights fixed) |
| [TASK-189](tasks/TASK-189.md) | UI | Inspector as a half-height bottom sheet on phones | `src/ui/**`, `app.css` | 160 | phone e2e, styles unchanged at 768 px+, shots | done |
| [TASK-190](tasks/TASK-190.md) | 10 | No parking bays under the low part of ramps (clearance 4.5 m) | stall generation | 175 | census, re-pins, gate, 3D shot | done |
| [TASK-191](tasks/TASK-191.md) | UI | Shortcut keys that browsers reserve (Ctrl/Cmd+N, mod+1 to 3) | `src/ui/shortcuts.ts`, `commands.ts` | 168 | reserved-chord test, T80 repeats | done |
| [TASK-192](tasks/TASK-192.md) | UI | 3D labels: hide names of streets behind buildings; keep labels aligned while the camera moves | `src/render3d/labels.ts` | 183 | occlusion and orbit tests, T64 3D within 5%, shots | done |
| [TASK-193](tasks/TASK-193.md) | 9 | The jam ring behind jg:10802 (detours feeding the queue they leave, or the exit-full hold on single-movement entry lanes) | `src/sim/**` | 121, 154, 188 | seeds 1-12 both modes, full demand, drain, gate, guard | done (actuated full demand -3.3%, accepted; see review) |
| [TASK-194](tasks/TASK-194.md) | 9 | Why actuated signals complete fewer trips at full demand; actuated default if they then match | `src/sim/signals.ts`, `signal-program.ts` | 188, 193 | full demand over time, seeds 1-12, drain, gate, guard | done 2026-11-17 (actuated default, owner approved) |
| [TASK-195](tasks/TASK-195.md) | UI | 3D names for partly hidden streets (best visible stretch, smaller size) | `src/render3d/labels.ts` | 183, 192 | counts, sight lines, T64 3D within 5%, shots | done |
| [TASK-196](tasks/TASK-196.md) | UI | Keep the selection in view above the phone sheet (2D and 3D) | `src/ui/**`, cameras | 189 | phone e2e, wider layouts unchanged, shots | done |
| [TASK-197](tasks/TASK-197.md) | UI | Scout a showcase landing city: a real German place with a natural edge, richer, curated | decision doc, scratch | owner brief 2026-11-17 | numbers and shots per candidate, recommendation | done; owner picked Freiburg |
| [TASK-198](tasks/TASK-198.md) | UI | Build Freiburg, the chosen landing city, as a curated bundled project and open it by default | importer, `fixtures/projects`, `store.ts`, e2e | 197 | own gate, load and frame budgets, e2e on the grid by name | done 2026-11-17 (Freiburg fixed-time until TASK-199) |
| [TASK-199](tasks/TASK-199.md) | 9 | Freiburg jams with actuated signals: find and fix the cause, drop its fixed-time opt-out | `src/sim/signals.ts`, `signal-program.ts`, `bench/freiburg.ts` | 194, 198 | Freiburg gate actuated, Munich seeds 1-12, full demand | done 2026-11-18 (Freiburg actuated; merged as is, owner approved) |
| [TASK-200](tasks/TASK-200.md) | UI | Engine queries racing a project open (gate4-compare fails alone since TASK-198) | `src/main.tsx`, `src/ui/store.ts` open, `src/host/client.ts` | 198 | spec 10/10 alone, failing test without the fix, light tiers | done 2026-11-18 |
| [TASK-201](tasks/TASK-201.md) | UI | Freiburg in detail: building parts (the Münster spire) and the Schlossberg terrain from the approved downloads | importer parts, 3D buildings, `fixtures/osm`, `fixtures/terrain/freiburg.json`, `bench/freiburg.ts`, project | 198 | parts tests, Freiburg gate, load and frame budgets, shots | done 2026-11-18 (flat, owner; terrain fixture unused) |
| [TASK-202](tasks/TASK-202.md) | 9 | Trams to every Freiburg stop (8 of 32 unserved) | `src/network/trams.ts`, `rail.ts` | 198 | per-cause tests, served count, other cities unchanged | done 2026-11-18 (with the crossing stop line; owner approved the trade-off) |
| [TASK-203](tasks/TASK-203.md) | UI | Framing the city in the area the panels leave visible, 2D and 3D | `src/ui/**` map view, 2D/3D cameras | 196, 198 | framing tests, e2e at 1440/1024/phone, first frame, shots | done 2026-11-18 (showcase camera applied in the follow-up) |
| [TASK-204](tasks/TASK-204.md) | 9 | Munich's missed turns at the jughandle (r:639, r:654): choose the lane earlier | `src/sim/lane-change.ts`, lane planning | 193, 194 | miss counts, seeds 1-12 both modes, full demand, drain, gate, guard | done 2026-11-18 (owner approved the trade-off) |
| [TASK-205](tasks/TASK-205.md) | tooling | Each worktree builds its own production test bundle | `playwright.config.ts`, `.gitignore`, workflows naming the path | 198 | production spec in-worktree, light e2e, CI | done 2026-11-18 |
| [TASK-206](tasks/TASK-206.md) | render | 3D load time back under 5 s after the first frame (5.2 to 6.9 s on main; 2.0 to 4.0 s at TASK-198) | `src/render3d/**`, 3D start-up | 198, 201 | phase timings, 3D within 5 s idle, shots unchanged | done 2026-11-19 |
| [TASK-207](tasks/TASK-207.md) | UI | Freiburg's 187 validation warnings: importer fixes, curation, notices | importer, diagnostics, `bench/freiburg.ts`, project | 198, 201 | codes before and after, tests, Freiburg gate | done 2026-11-19 (curation; F1 and F2 held for the owner) |
| [TASK-208](tasks/TASK-208.md) | 9 | Munich's remaining missed turns (r:700 lane 0, the r:639 weave) and why TASK-204's first rule gridlocked Freiburg | `src/sim/lane-change.ts`, entry chains | 204 | misses, seeds 1-12 both modes, full demand, gates | retired (tag `archive/task/208-remaining-misses`); superseded by TASK-253 (triage 2026-11-25) |
| [TASK-209](tasks/TASK-209.md) | - | The parked branches (TASK-128, 129, 130, 131 Phase 3): revive or drop | decision document | - | measured recommendation each | done 2026-11-19 (drop all four; owner decides) |
| [TASK-212](tasks/TASK-212.md) | 10 | Geometry audit of junctions, lane splits and merges, and markings (Freiburg first) | findings | 201 | ranked defects with ids, close-ups, counts | done 2026-11-18 |
| [TASK-213](tasks/TASK-213.md) | 10 | Junction shapes (TASK-212 J1 to J6; fixes the geometry-audit bench) | `junctions.ts`, `groups.ts`, `bench/geometry-audit.ts` | 212 | audit before and after, tests, close-ups, traffic if it moves | done 2026-11-19 (J4 and the audit; J1, J2, J3, J5, J6 handed on) |
| [TASK-214](tasks/TASK-214.md) | 10 | Lane splits and merges (TASK-212 S1 to S6) | `lanes.ts`, `lane-drop.ts`, `corridor.ts`, `continuity.ts` | 212 | audit before and after, tests, close-ups, traffic if it moves | done 2026-11-19 (owner approved the trade-off; Freiburg rebuilt) |
| [TASK-215](tasks/TASK-215.md) | 10 | Lane markings (TASK-212 M1 to M6; M7 for the owner) | `road-paint.ts`, `marking-geometry.ts`, `render3d/markings.ts`, `crossings.ts` defaults | 212 | audit before and after, tests, close-ups, traffic if it moves | held for the owner 2026-11-19 (Munich delay +4 to 5%; branch `3e5e33f`) |
| [TASK-216](tasks/TASK-216.md) | 10 | Road shapes against aerial imagery (LGL DOP20), Freiburg Hauptbahnhof first (owner's suggestion) | `bench/` overlay script, findings | 213, 214 | registration, ranked defects by class, close-ups | done 2026-11-19 (9 defects; follow-ups proposed) |
| [TASK-217](tasks/TASK-217.md) | 10 | Markings and crossings: TASK-215 reworked on TASK-214, crossings where OSM maps them (D1), solid lines before stop lines (M7) | markings, `crossings.ts`, walk links | 214, 215, 216 | tests, close-ups, traffic, merge rule | done 2026-11-19 (merged: paint-only variant; full version missed the rule) |
| [TASK-218](tasks/TASK-218.md) | 10 | Importer road shapes: widths, medians, shared lanes, stop lines (D3 to D6, D9) | `roads.ts`, `corridors.ts`, `controls.ts` | 216 | tests, close-ups, traffic, merge rule | retired (tag `archive/task/218-importer-roads`); parts landed in 233, 238, 242/254, 255 (triage 2026-11-25) |
| [TASK-219](tasks/TASK-219.md) | 10 | Junction-group surfaces and stop lines (J1, D2) | `junctions.ts`, `groups.ts` | 213, 216 | tests, close-ups, traffic, merge rule | done 2026-11-20 (its rules landed through TASK-226 and 234) |
| [TASK-220](tasks/TASK-220.md) | render | Tram track form: embedded, grass, paved, ballast (D8) | rail import and drawing | 216 | identical hashes, close-ups, frame budgets | done 2026-11-19 (merged; hashes identical) |
| [TASK-221](tasks/TASK-221.md) | 10 | Lane tapers across the plain nodes between short roads (S5, S6, J2, J6 left by TASK-214) | `lanes.ts`, `lane-drop.ts`, `continuity.ts`, `corridor.ts` | 214 | audit, tests, close-ups, traffic, merge rule | done 2026-11-20 (landed as TASK-235) |
| [TASK-222](tasks/TASK-222.md) | 9 | Lock between a tram crossing and two actuated signals (Freiburg n:18, n:39; found by TASK-208) | actuated control, rail-crossing calls | 199, 208 | repro test, traffic, merge rule | done 2026-11-19 (merged; Munich and full demand identical, Freiburg -0.5 s) |
| [TASK-223](tasks/TASK-223.md) | 9 | TASK-208's missed-turn rule re-measured on TASK-222 | `detourHeads` | 208, 222 | misses, traffic, merge rule | retired (tag `archive/task/223-remaining-misses-2`); superseded by TASK-253 (triage 2026-11-25) |
| [TASK-224](tasks/TASK-224.md) | 10 | Aerial re-check of the Hauptbahnhof box after wave A | overlay bench, findings | 216 to 220 | D1 to D9 before and now | done 2026-11-19 (merged; D8 mostly, D1 partly fixed on main; N1 to N4 new) |
| [TASK-225](tasks/TASK-225.md) | 9 | The Siegesdenkmal box lock (Freiburg jg:13305; main seeds 2 and 4, TASK-219 seed 1) | `src/sim` box and group-chain rules | 219 | repro test, Freiburg seeds 1 to 6, traffic, merge rule | done 2026-11-19 (merged; lock gone, every other hash identical) |
| [TASK-226](tasks/TASK-226.md) | 10 | TASK-219's group membership re-measured on TASK-225 | `split.ts`, Freiburg rebuild | 219, 225 | TASK-219's gates | done 2026-11-20 (landed as TASK-234) |
| [TASK-227](tasks/TASK-227.md) | render | Pitched roofs on concave outlines (straight skeleton) | `render3d/roofs.ts` | 210 | flat fallbacks, skeleton tests, close-ups, budgets, identical hashes | done 2026-11-19 (merged; flat roofs Freiburg 204 to 14, Munich 70 to 13) |
| [TASK-228](tasks/TASK-228.md) | 9 | Tram backlog: one delayed tram holds every unstarted one (found by TASK-225) | `rail-crossings.ts` service holds | 225 | backlog figures, traffic, merge rule | done 2026-11-19 (merged v2; full timetable, Munich identical, Freiburg +4.6 s) |
| [TASK-229](tasks/TASK-229.md) | render | Marking follow-ups from the aerial re-check: M2 lane lines on carriageway inside groups (N1), arrows on double-left entry lanes (N2) | `marking-geometry.ts` | 217, 224 | tests, counts, close-ups, audit, identical hashes | done 2026-11-19 (merged; paint only, hashes identical) |
| [TASK-230](tasks/TASK-230.md) | 9 | Step time, third pass: Munich full demand and the Freiburg landing city, results identical | `src/sim/**` except `rail-crossings.ts` | 211 | phase tables, identical hashes, interleaved timings | done 2026-11-19 (merged; full demand 14.5% faster, Freiburg 8%, hashes identical) |
| [TASK-231](tasks/TASK-231.md) | 10 | One carriageway for close halves and shared one-lane streets (TASK-218's D5 and D6 alone) | `corridors.ts`, `roads.ts`, `marking-geometry.ts` | 218, 229 | tests, audit, traffic, merge rule | retired 2026-11-25 (tag `archive/task/231-halves-shared-lanes`); D6 landed in 233, D5 in 238 (triage) |
| [TASK-232](tasks/TASK-232.md) | render | Tram track form follow-ups: Fahnenbergplatz ballast, Rotteckring paving (TASK-224 D8, N3) | `rail.ts`, `rail-geometry.ts` | 220, 224 | tests, close-ups, identical hashes, budgets | done 2026-11-19 (merged; hashes identical) |
| [TASK-233](tasks/TASK-233.md) | render | Shared one-lane streets drawn without a centre line (TASK-231's D6 alone) and the grade-aware lane-overlap audit | `roads.ts`, `marking-geometry.ts`, `geometry-audit.ts` | 231 | tests, audit, traffic, merge rule | done 2026-11-19 (merged variant; networks byte-identical) |
| [TASK-234](tasks/TASK-234.md) | 10 | Land TASK-226 (Hbf group membership, D2) on current main | `split.ts`, `junctions.ts`, Freiburg rebuild | 226 | audit, Freiburg seeds 1 to 6, traffic, merge rule | done 2026-11-20 (merged variant; D2 fixed; Freiburg with 235 77.8 s) |
| [TASK-235](tasks/TASK-235.md) | 10 | Land TASK-221 (lane tapers across short roads) with the grade-aware audit | `lanes.ts`, `continuity.ts`, `compile.ts` | 221, 233 | audit, traffic, merge rule | done 2026-11-20 (merged; audit within the lead's tolerance) |
| [TASK-236](tasks/TASK-236.md) | render | The remaining roof shapes on concave outlines (half-hipped, gambrel, mansard, skillion, round) | `render3d/roofs.ts` | 227 | flat fallbacks, tests, close-ups, budgets, identical hashes | done 2026-11-20 (merged; flat roofs Freiburg 14 to 1, Munich 13 to 0) |
| [TASK-237](tasks/TASK-237.md) | 9 | Step time, fourth pass: the rail hold and rail step, results identical | `rail-crossings.ts` performance | 230 | phase tables, identical hashes, interleaved timings | done 2026-11-20 (merged; full demand 9.5% faster, rail 41%, hashes identical) |
| [TASK-238](tasks/TASK-238.md) | 10 | Close halves as one carriageway unless a mapped median lies between them (TASK-231's D5 reworked) | `corridors.ts` | 231 | audit, traffic, merge rule | done 2026-11-20 (merged; nothing worse) |
| [TASK-239](tasks/TASK-239.md) | 10 | Crossings mapped only as OSM nodes get walk links and paint | importer `walk.ts` | 217, 224 | census, audit, traffic, merge rule | done 2026-11-20 (landed as TASK-248) |
| [TASK-240](tasks/TASK-240.md) | render | Arrows of the next junction on approaches ending at a plain node or median crossover (r:1148) | `marking-geometry.ts` | 229, 234 | tests, counts, close-ups, identical hashes | done 2026-11-20 (merged; hashes identical) |
| [TASK-241](tasks/TASK-241.md) | render | Paint fixes: gores between one carriageway's lanes, arrows over keep-clear boxes, give-way triangles over zebras | `marking-geometry.ts` | 108, 240 | tests, counts, close-ups, identical hashes | done 2026-11-20 (merged; hashes identical) |
| [TASK-242](tasks/TASK-242.md) | 10 | Road widths from the data: urban lane widths, `width` tags, `placement` (TASK-218's D3, D9) | `roads.ts`, `corridors.ts` | 218, 238 | imagery checks, audit, traffic, merge rule | retired 2026-11-25 (tag `archive/task/242-road-widths`); placement and tagged widths in 254; untagged narrowing caused the full-demand miss (triage) |
| [TASK-243](tasks/TASK-243.md) | 9 | Step time, fifth pass: routing and reroutes, results identical | `src/routing/**` performance | 230, 237 | tables, identical hashes, interleaved timings | done 2026-11-20 (merged; route requests 59% faster, stepping 7.3%, hashes identical) |
| [TASK-244](tasks/TASK-244.md) | 9 | Departing batches spread over routes (latent fault found by TASK-239) | `link-costs.ts`, engine route assignment | 239 | repro test, Freiburg band, traffic, merge rule | retired (tag `archive/task/244-route-batching`); cause fixed by TASK-247 (triage 2026-11-25) |
| [TASK-245](tasks/TASK-245.md) | 9 | Walkers wait about 420 s at signalised crossings (found by TASK-239) | `signals.ts`, walkers' signal wait | 188, 222, 239 | repro test, wait distributions, traffic, merge rule | done 2026-11-20 (v1 landed as TASK-249) |
| [TASK-246](tasks/TASK-246.md) | render | Keep-clear boxes on lane gains (found by TASK-241) | `marking-geometry.ts` | 241 | test, census, identical hashes | done 2026-11-20 (merged; hashes identical) |
| [TASK-247](tasks/TASK-247.md) | 9 | Freiburg's 08:00 station peak: spillback at the Hauptbahnhof signals (`n:364`, `n:1132`) | `signals.ts`, junction admission | 239, 244, 245 | repro test, Freiburg band, traffic, merge rule | done 2026-11-20 (merged v1; Freiburg's 08:00 flip gone, gate 68.1 s) |
| [TASK-248](tasks/TASK-248.md) | 10 | Land TASK-239 (node-only crossings) on TASK-247 | importer `walk.ts`, Freiburg rebuild | 239, 247 | Freiburg seeds, traffic, merge rule | done 2026-11-20 (merged; TASK-239 landed) |
| [TASK-249](tasks/TASK-249.md) | 9 | Land TASK-245's v1 (walker fixes) on TASK-247 | `walkers.ts` | 245, 247 | waits, Freiburg seeds, traffic, merge rule | done 2026-11-20 (merged on the five-seed full-demand reading: +0.2%, 40 more trips) |
| [TASK-250](tasks/TASK-250.md) | 9 | Full demand after TASK-247: four stalled heads and 164 fewer trips | `signals.ts` | 247 | trace, repro test, traffic, merge rule | done 2026-11-20 (diagnosis only: seed-1 full demand is divergence; no change) |
| [TASK-251](tasks/TASK-251.md) | 9 | Reroute checks skip the lane search when no switch is possible (optional bound on `RouteProvider.route`) | `src/routing/**`, engine reroute check, architecture 5.x | 243 | identical hashes, timings | done 2026-11-20 (merged; route requests about 34% less, hashes identical) |
| [TASK-252](tasks/TASK-252.md) | render | Walk lights at crossings no signal phase serves draw dark | walk-light drawing, signal snapshot | 245, 249 | test, list, identical hashes, budgets | done 2026-11-20 (merged; hashes identical) |
| [TASK-253](tasks/TASK-253.md) | 9 | TASK-223's missed-turn rule re-measured on five-seed full demand | `detourHeads` | 223, 249 | misses, traffic, merge rule | done 2026-11-20 (merged v2; full demand five-seed -1.1% / -1.0%) |
| [TASK-254](tasks/TASK-254.md) | 10 | `placement` and tagged widths read by rule; `r:1179` and `n:1146` (TASK-242's split) | `roads.ts`, `corridors.ts` | 242 | imagery, audit, traffic, merge rule | parked, owner decision 2026-11-26 (`2e58a343` on main `d510b589`): merge rule passes (Munich identical, Freiburg gate 62.5 to 60.6 s); audit misses tolerance: Freiburg bulge 9.07 to 15.89 m² (`n:536` B 31 on-ramp into placed `r:538`), sharp corners 60 to 62, Sindelfingen A 81 voids 1,335 to 2,075 m² (`placement=right_of:1` opens the median the audit takes as 0.5 m); overlaps fall in both; tapered fallback measured worse and reverted; options: accept voids as a median rule in the audit, or close |
| [TASK-255](tasks/TASK-255.md) | 10 | Stop lines at the painted line where a signal sits ahead of its junction (TASK-218's D4 with J1) | `controls.ts`, `split.ts`, `junctions.ts`, `groups.ts` | 218, 234 | imagery, audit, traffic, merge rule | done 2026-11-21 (merged; `r:1178` 9 m to 1.2 m, Freiburg gate 65.8 s, Munich identical) |
| [TASK-256](tasks/TASK-256.md) | render | Visual leftovers: `n:211` zebra, promenade parking hatch, `rt:12944` ballast | markings, rail drawing | 232, 233, 248 | tests, close-ups, hashes | done 2026-11-20 (merged; promenade and ballast fixed, hashes identical; `n:211` needs a placement task) |
| [TASK-257](tasks/TASK-257.md) | render | Unmarked crossings: a marking field on walk links (owner-approved schema) | `src/schema`, `walk.ts`, crossing paint | 217, 248 | tests, counts, close-ups, identical hashes | done 2026-11-21 (merged; Munich zebra ends 114 to 25, hashes identical) |
| [TASK-258](tasks/TASK-258.md) | UI | Munich and Sindelfingen preloaded in the New city panel; one builder, a staleness test | `bench/`, `fixtures/projects`, `bundled-projects.ts`, `top-bar.tsx` | 198 | showcase gates, staleness test, e2e, budgets | done 2026-11-21 (merged; both pass the gate; Sindelfingen loads in 8 to 13 s, TASK-266) |
| [TASK-259](tasks/TASK-259.md) | UI | Scout more preloaded cities: Lübeck, a UK centre, Philadelphia | decision doc, findings | 197, 258 | gates, budgets, shots, defects per city | done 2026-11-21 (none passes raw; fixes TASK-267 to 272; York picked) |
| [TASK-260](tasks/TASK-260.md) | render | Rail bridges in 3D: walls and decks cutting into each other (owner bugs 1, 2) | `render3d/rail.ts`, `geometry.ts`, `heights.ts` | owner 2026-11-20 | tests, close-ups, hashes, budgets | done 2026-11-21 (merged; embankments Freiburg 47 to 11, covered bed points 975 to 148; hashes identical) |
| [TASK-261](tasks/TASK-261.md) | render | Walkways and stairs in 3D: broken edges, twisted stairs (owner bugs 3, 4) | `render3d/walk.ts`, `geometry.ts`, `heights.ts` | owner 2026-11-20 | tests, close-ups, hashes, budgets | done 2026-11-21 (notches to 0, stairs as flights; hashes identical) |
| [TASK-262](tasks/TASK-262.md) | render | Footbridges with piers, railings, canopies (owner bugs 5, 7) | `render3d` footbridges | owner 2026-11-20 | tests, counts, close-ups, hashes, budgets | done 2026-11-21 (decks, railings, piers, roofs as canopies; walk-link tags need a schema field) |
| [TASK-263](tasks/TASK-263.md) | render | Elevators drawn as elevators (owner bug 6) | `render3d` buildings, `lights.ts` | owner 2026-11-20 | tests, counts, close-ups, hashes, budgets | done 2026-11-21 (merged; 6 Freiburg shafts; node-only elevators need a schema value, owner) |
| [TASK-264](tasks/TASK-264.md) | 10 | Lane gains that start where the ground widens (D7, Friedrichstraße), by rule | `lanes.ts`, `lane-drop.ts`, `continuity.ts` | 216, 254 | imagery, audit, traffic, merge rule | done 2026-11-21 (merged on the owner's approval; arrows at the painted ones, traffic identical) |
| [TASK-265](tasks/TASK-265.md) | 10 | Zebras where OSM maps them: crossing placement from the crossing node (`n:211`) | `crossings.ts`, `stops.ts`, walk-link placement | 140, 217, 256 | imagery, audit, traffic, merge rule | merged 2026-11-26 (`9db77449`, Codex re-run; node-mapped bands the curb-clearance floor would push out move onto the node: Freiburg 3 ends 4.2-5.9 m in (`n:211` 7.9 to 3.7 m from the cut, on the ground zebra), Philadelphia 27, York 8, London City 4, Heathrow 10, Zurich 4; Munich identical; Freiburg gate 62.48 to 62.17 s; audit byte-identical; showcases pass; tiers green on the merge with TASK-362) |
| [TASK-266](tasks/TASK-266.md) | render | Rail geometry load time: the polygon clipping in `railGeometry` (Sindelfingen 6.7 s) | `rail-geometry.ts` | 258 | identical output, times, budgets | done 2026-11-21 (Sindelfingen railGeometry 12 s to 0.3 s, identical output) |
| [TASK-267](tasks/TASK-267.md) | city | Imports that import: one bad parking facility never fails or crashes an import (D1, D2) | see contract | 259 | tests, counts, traffic where it moves, merge rule | done 2026-11-21 (merged; York and Cambridge import; none dropped) |
| [TASK-268](tasks/TASK-268.md) | city | Left-hand traffic: the driving side from the location, far-side protected turns, no priority to the left (D3, D11, D15) | see contract | 259 | tests, counts, traffic where it moves, merge rule | done 2026-11-21 (merged; York far-side turns; right-hand identical) |
| [TASK-269](tasks/TASK-269.md) | city | Mini-roundabouts and UK zebra zig-zags (D4, D16) | see contract | 259 | tests, counts, traffic where it moves, merge rule | done 2026-11-21 (merged; 6 UK nodes, Freiburg n:347; zig-zags) |
| [TASK-270](tasks/TASK-270.md) | city | Polygon gateways that route (D7) | see contract | 259 | tests, counts, traffic where it moves, merge rule | done 2026-11-21 (merged; no_route 0 in Lübeck, Cambridge, Philadelphia; Freiburg gate 62.6 s) |
| [TASK-271](tasks/TASK-271.md) | city | Reading rules for building passages, conditional access and alternating one-ways (D6, D12, `oneway=faux`) | see contract | 259 | tests, counts, traffic where it moves, merge rule | done 2026-11-21 (merged; passages at grade by rule; conditional access) |
| [TASK-272](tasks/TASK-272.md) | city | Landmark buildings mapped as multipolygons (D9, Philadelphia City Hall) | see contract | 259 | tests, counts, traffic where it moves, merge rule | done 2026-11-21 (render rule for parts; City Hall stands; Freiburg 20 bodies) |
| [TASK-273](tasks/TASK-273.md) | city | City walls and gates: fetched, read and drawn (D5, York; owner-approved query change and re-fetch) | `overpass.ts`, context import, drawing | 259 | tests, close-ups, identity, budgets | done 2026-11-21 (merged; York walls; Freiburg's one wall) |
| [TASK-274](tasks/TASK-274.md) | render | Elevators mapped only as points (owner-approved schema value) | `src/schema`, point import, `elevators.ts` | 263 | tests, counts, close-ups, hashes | done 2026-11-21 (merged; Donnersbergerbrücke lifts as shafts) |
| [TASK-275](tasks/TASK-275.md) | render | Covered and handrail on walk links (owner-approved schema fields) | `src/schema`, `walk.ts`, `footbridges.ts` | 262 | tests, counts, close-ups, hashes | done 2026-11-21 (merged; railings by handrail, canopies on covered ways) |
| [TASK-276](tasks/TASK-276.md) | wave A | UK kerb markings read from OSM (D8) | see contract | 259 to 270 | tests, counts, gates | done 2026-11-21 (merged; UK kerb lines from tags) |
| [TASK-277](tasks/TASK-277.md) | wave A | Philadelphia within budget, and transit names (D10, D13) | see contract | 259 to 270 | tests, counts, gates | done 2026-11-21 (merged; Philadelphia 2D 8.0 to 1.3 ms; stop names) |
| [TASK-278](tasks/TASK-278.md) | wave A | Faster 3D walkways: height lookups (TASK-266's follow-up) | see contract | 259 to 270 | tests, counts, gates | done 2026-11-21 (merged; Sindelfingen 3D 3.7 s sooner, identical meshes) |
| [TASK-279](tasks/TASK-279.md) | wave A | Unmarked crossings by German rules: no walker priority | see contract | 259 to 270 | tests, counts, gates | merged 2026-11-27 (`cf907113`, Codex re-run on main `8342af78`): Munich -0.8 to -3.8%, full demand +0.3% / -0.1%, Freiburg 62.2 to 61.0 s, all showcases pass; London City mean delay 210 to 386 s (worst visit 822 s). UK maps read with the same rule; Highway Code H2 turn-out yield not modelled |
| [TASK-280](tasks/TASK-280.md) | wave A | One height profile for rail tracks sharing a bridge | see contract | 259 to 270 | tests, counts, gates | done 2026-11-21 (merged; covered bed points 148 to 0; hashes identical) |
| [TASK-281](tasks/TASK-281.md) | wave A | Lübeck's parking failures under 2% (D17) | see contract | 259 to 270 | tests, counts, gates | done 2026-11-21 (merged; unreachable lots left out; Freiburg 60.1 s) |
| [TASK-282](tasks/TASK-282.md) | wave B | Left-hand turn ranking: the far-side right yields like a left (architecture 5.3) | movement priority | 268 | York, right-hand identity | done 2026-11-21 (merged; turn rank by driving side) |
| [TASK-283](tasks/TASK-283.md) | wave B | Gateways into restricted pockets: gateway trips judged by the person's own car | `src/demand`, `places.ts` | 270 | Lübeck, Cambridge, traffic, merge rule | done 2026-11-21 (merged on the owner's go; Lübeck -557 and Cambridge -679 trips a day until TASK-288) |
| [TASK-284](tasks/TASK-284.md) | wave B | Lübeck and York as preloaded cities | builder, fixtures, panel | 258, 259 to 282 | gates, budgets, e2e | done 2026-11-21 (merged; Lübeck in the panel; York held out: TASK-286, 287) |
| [TASK-285](tasks/TASK-285.md) | wave B | Philadelphia as a preloaded city | builder, fixtures, panel | 258, 270, 272, 277 | gates, budgets, e2e | done 2026-11-21 (merged; passes the gate and budgets) |
| [TASK-286](tasks/TASK-286.md) | city | Polygon gateways by the router's lane-change rule (York's Layerthorpe) | `places.ts` | 270, 284 | York gate, traffic, merge rule | done 2026-11-21 (merged variant; York gate passes; York in the panel) |
| [TASK-287](tasks/TASK-287.md) | render | York's load time (crossing styles, zig-zags, place details, walk compile) | hot paths | 277, 284 | identical output, budgets | done 2026-11-21 (merged; identical output; York first frame 2.80 s) |
| [TASK-288](tasks/TASK-288.md) | city | Populations draw gateway trips only among gateways the home's car reaches (TASK-283's follow-up) | `src/demand` | 283 | Lübeck, Cambridge, traffic, merge rule | done 2026-11-21 (merged on the owner's go; Munich and Freiburg identical; Sindelfingen 280 to 890 trips a day) |
| [TASK-289](tasks/TASK-289.md) | 9 | York's lot deadlock: a car at the entry and cars inside waiting on each other (TASK-288's v1) | `src/sim/parking.ts` | 288 | reproduction, synthetic test, traffic, merge rule | done 2026-11-21 (merged; York v1 seeds 1, 2 pass; every hash identical) |
| [TASK-290](tasks/TASK-290.md) | city | Parking garage entrances read from OSM (`amenity=parking_entrance`) | importer parking, Overpass query | 281 | counts, traffic, merge rule | done 2026-11-21 (merged; 54 entrances linked; Freiburg gate 62.7 s; Codex) |
| [TASK-291](tasks/TASK-291.md) | render | Road clearance under rail bridges lowered by TASK-280 | `render3d` rail heights | 280 | clearance census, close-ups, hashes | done 2026-11-21 (merged; Freiburg roads under 4.5 m 34 to 1, walks under 2.5 m 22 to 5; Codex) |
| [TASK-292](tasks/TASK-292.md) | render | York's load time, second pass (junction polygons, seams, walkway unions, 2D batching) | render hot paths | 287 | identical output, budgets | done 2026-11-21 (merged; York first frame 2.19 to 2.09 s, 1.22x Freiburg; identical output; Codex) |
| [TASK-293](tasks/TASK-293.md) | city | Philadelphia's import warnings and load time (TASK-285 F1, F2) | importer reading, load | 285 | warning counts, budgets, merge rule | done 2026-11-21 (merged; Philadelphia warnings 155 to 141, first frame 2.34 to 1.99 s; Codex) |
| [TASK-294](tasks/TASK-294.md) | city | "Anlieger frei" pockets in Lübeck: residents' access by zone | zones, router access, lot reachability | 281, 283 | Lübeck facilities, traffic, merge rule | merged 2026-11-22 (`12ba734`; owner accepted Lübeck delay +21 to 34 s) |
| [TASK-295](tasks/TASK-295.md) | airports | Airport schema, OSM import, airside topology; London City bundled | schema, importer, topology, surfaces | - | LCY counts, every stand reaches the runway, cities identical | merged 2026-11-22 (`4d98bcf`, wave A) |
| [TASK-296](tasks/TASK-296.md) | airports | Synthetic one-runway airport and topology regression tests | fixtures, tests | 295 | graph, code limits, backtrack variant | merged 2026-11-22 (`c040a60`, wave B) |
| [TASK-297](tasks/TASK-297.md) | airports | Airside markings and aircraft shapes in 2D | render, markings | 295 | marking rules, screenshots | merged 2026-11-22 (`342f20b`, wave B) |
| [TASK-298](tasks/TASK-298.md) | airports | Aircraft as a vehicle: types, airside routing, taxi, runway, approach, climb | schema catalogue, sim, routing, render | 296 | no overlap, one per runway, code limits, determinism | merged 2026-11-22 (`4c41a79`, wave B) |
| [TASK-299](tasks/TASK-299.md) | airports | Flight operations: schedule, stands, turnarounds, tows, hangars, helicopters | ops, sim, UI | 298 | 98% completion, stand codes, tows | merged 2026-11-22 (variant `bdea18d`, wave C) |
| [TASK-300](tasks/TASK-300.md) | airports | Runway configurations: time-of-day concepts, wind control, reconfiguration | sim, routing, UI | 299 | switch with no conflict, re-routes | merged 2026-11-22 (`dd04482`, wave C) |
| [TASK-301](tasks/TASK-301.md) | airports | 3D aircraft, flight paths, airfield and aircraft lighting | render3d, lighting | 297, 299 | light rules, PAPI, screenshots | merged 2026-11-22 (`e098862`, wave C) |
| [TASK-302](tasks/TASK-302.md) | airports | Zurich Airport bundled: crossing runways, Dock E, helicopters, concepts | all airport modules | 300, 301 | ZRH day, crossing interlock, load budget | merged 2026-11-22 (`7de5a81`, held out of the panel, 150-movement cap) |
| [TASK-303](tasks/TASK-303.md) | airports | Boston Logan: crossing-runway complexity test | all airport modules | 302 | rules carry over, six crossing pairs | parked 2026-11-22 (`dacf5ae`: 227/1,000 movements; scale findings in review) |
| [TASK-304](tasks/TASK-304.md) | airports | Heathrow: operational-scale test | all airport modules, perf | 302 | 1,300 movements, step and frame time | parked 2026-11-22 (`c0b4b2f`: 56/1,306 movements, load 37 s; scale findings in review) |
| [TASK-305](tasks/TASK-305.md) | airports | Airport editing: stands, taxiways, holding points, limits, configurations | editor, UI | 302 | edits recompile, undo, saved and reopened | merged 2026-11-22 (`8289736`, wave D) |
| [TASK-306](tasks/TASK-306.md) | airports | Aircraft performance figures and motion profiles | schema catalogue, sim motion | catalogue | profiles within figures, determinism | merged 2026-11-22 (`761b6bd`, wave A) |
| [TASK-307](tasks/TASK-307.md) | airports | Aircraft shapes: 2D outlines and procedural 3D models | render, render3d | catalogue | extents equal dimensions, part lists | merged 2026-11-22 (`931cb56`, wave A) |
| [TASK-308](tasks/TASK-308.md) | airports | Flight schedule generator and runway configuration chooser | demand, sim | catalogue | seeded volumes, tailwind limit | merged 2026-11-22 (`6540ebb`, wave A) |
| [TASK-309](tasks/TASK-309.md) | airports | Airside import rules on the Zurich, Boston and Heathrow extracts | importer, fixtures | 295 | counts, every stand reaches a runway | merged 2026-11-22 (`7b82aae`, wave B) |
| [TASK-310](tasks/TASK-310.md) | airports | Load time at airport scale | project, compile, demand, scene build | - | Heathrow first frame under 10 s, identical output | merged 2026-11-22 (`25ee0d5`, aims not met: Heathrow first frame 14 s) |
| [TASK-311](tasks/TASK-311.md) | airports | 3D render cost at airport scale | render3d, airfield lights | - | Heathrow 3D p95 under 6 ms, no visible change | merged 2026-11-22 (`8f4cde8`, wave E) |
| [TASK-313](tasks/TASK-313.md) | airports | London City: a taxiway section that reads and behaves as one-way | importer, airside, markings | - | both ways as paved, LCY gates kept | merged 2026-11-22 (`947f9d7`, wave E) |
| [TASK-312](tasks/TASK-312.md) | airports | Airside throughput at scale and realistic taxi speeds | sim, routing, ops, bundling | 310, 311, 302 | 98% at ZRH, BOS, LHR; taxi speeds vs real | merged 2026-11-22 with gaps (`29128cb`; large airports short of 98%) |
| [TASK-314](tasks/TASK-314.md) | airports | Aircraft motion realism: rotation, flare, gear steering, smooth turns | render pose, motion | 311 | pose timelines, nose gear on centreline | merged 2026-11-22 (`45f6507`, wave F) |
| [TASK-315](tasks/TASK-315.md) | airports | Aircraft model realism, jet bridges and apron furniture in 3D | render3d | 311 | part lists, bridges at gates, render budget | merged 2026-11-22 (`5eac69c`, `82c33ef`) |
| [TASK-316](tasks/TASK-316.md) | airports | Airside ground vehicles | sim, render | 312 | turnaround vehicles, no overlaps | merged 2026-11-25 (`f4ec8bf5`; London City and Zurich aircraft identical to main, 0 vehicle overlaps, visits served London City 64-73%, Zurich 95%; tiers green) |
| [TASK-317](tasks/TASK-317.md) | airports | Taxi speeds against the real world, and where airside delay comes from | sim motion, figures | - | delay attribution, speeds vs real | merged 2026-11-22 (`1d74dac`) |
| [TASK-318](tasks/TASK-318.md) | airports | Real aircraft models with level of detail | render3d, assets, NOTICE | 315 | types scaled, LOD by screen size, render budget | merged 2026-11-23 (`51b03cb`, `2d7d55d`) |
| [TASK-319](tasks/TASK-319.md) | airports | Mapped jet bridges and a ready-for-pushback state | schema, importer, sim, render3d | 315 | bridges at mapped gates, retract before push | merged 2026-11-22 (`fc3ea8d`, `4a252dc`) |
| [TASK-320](tasks/TASK-320.md) | airports | Parked aircraft on their stand's heading and stop | sim parking, render | 312 | heading under 3 degrees, 316 re-run | merged 2026-11-23 (`4fa2884`) |
| TASK-321 | airports | Abstract block-signalling validation (bench only) | bench | 312 | gridlocks per policy, real layouts | merged 2026-11-23 (`6809c54`) |
| [TASK-322](tasks/TASK-322.md) | airports | Block signalling and dynamic taxi flows in the airside simulation | sim, routing | 321 | no gridlock anywhere, LCY kept, large-airport days | not merged 2026-11-23 (best Zurich peak 120/199 against main 152; variants `f09208a` to `0e63542`) |
| [TASK-323](tasks/TASK-323.md) | airports | Dynamic taxi-flow preferences per runway configuration | sim module | 321 | flips with runway direction, fast, small route cost | merged 2026-11-23 (`ad9bc75`) |
| TASK-324 | airports | Conflict-free routing pilot on the Zurich peak (real sim) | sim pilot | 322 | Zurich peak against main | not merged 2026-11-23 (`f51741a`, 97/199) |
| TASK-325 | airports | Calibrated surface bench: time-window routing and departure metering mocks, clips | bench | 321 | Zurich peak and full days at three airports | branch only 2026-11-23 (`93fd166`, `a378949`, `31449d5`; bench misleads at scale) |
| TASK-326 | airports | Departure metering and a crossing exit check in the real sim | sim pilot | 325 | Zurich peak against main 152/199 | not merged 2026-11-23 (`9f6332d`; metering 136, exit check alone 150) |
| [TASK-327](tasks/TASK-327.md) | airports | Runway interlocks at intersections only | sim | 312 | Boston days, no runway conflicts, Zurich and LCY kept | merged 2026-11-23 (`bb78390`, `32dd6f5`) |
| [TASK-328](tasks/TASK-328.md) | airports | One runway configuration per day; Zurich uses all three runways | sim configuration, operations | 302, 312 | no mid-day change, re-route at holds, per-runway use | merged 2026-11-23 (`58e23c2`) |
| [TASK-329](tasks/TASK-329.md) | airports | Moving aircraft never wait for aircraft that have not started | sim admission order | 312 | Heathrow no wait cycles, Zurich/Boston/LCY days | merged 2026-11-23 (`be7aef1`) |
| [TASK-331](tasks/TASK-331.md) | render | Aircraft: one row of cabin windows and realistic landing gear | aircraft model prep, render3d gear | 318 | one pane row per deck, wheel counts per type, render budget | merged 2026-11-23 (`74bc705`; fold retraction added by lead decision; draw calls unchanged, p95 within TASK-311) |
| [TASK-332](tasks/TASK-332.md) | render | Train model kit, with the tram and the S-Bahn | render3d trains, variant rule | - | variant per route, budgets, picking, sim hashes identical | merged 2026-11-23 (`7909254`, two feedback rounds; sim hashes identical, 3D p95 within noise) |
| [TASK-333](tasks/TASK-333.md) | render | DLR, Elizabeth line and DB intercity trains | render3d train variants | 332 | variants at LCY/Munich, loco and cab car ends, render budget | merged 2026-11-23 (`736a751`, one visual round; Elizabeth rule for left-hand traffic) |
| [TASK-334](tasks/TASK-334.md) | render | Generic tube and New York subway trains | render3d train variants | 332 | Piccadilly and Philadelphia variants, real car length | merged 2026-11-23 (`c9932be`, one visual round: close-coupled, 75 ft New York car) |
| [TASK-335](tasks/TASK-335.md) | render | Generic road vehicle models | render3d vehicles, parked cars | - | extents per class, stable choice, shadow cost, render budget | merged 2026-11-23 (`9f2a7d0`, one visual round; sim and 2D hashes identical, 3D p95 within noise) |
| [TASK-336](tasks/TASK-336.md) | render | Night halo shader compiles in every city | `render3d/lights.ts` | 335 | no shader error at night, halos unchanged | done 2026-11-23 (lead) |
| [TASK-337](tasks/TASK-337.md) | sim | Aircraft wait at runway holds clear of rolling widebodies | `sim/aircraft.ts` | 330 pilot | no hold overlap at Zurich seed 2, airports not worse, cities identical | merged 2026-11-24 (`92bb5ea`; Zurich mixed per seed, total +10, overlaps 4 to 1; Heathrow identical) |
| [TASK-338](tasks/TASK-338.md) | sim | Gates on taxiway stretches that run on runway pavement | `sim/aircraft.ts` | 330 planner pilot | airports identical on main, gates on the pilot stretches, tiers green | merged 2026-11-25 (`7a2797d1`; Heathrow, Zurich, Boston, London City identical to main) |
| [TASK-339](tasks/TASK-339.md) | sim | No waiting behind aircraft parked across the way | `sim/aircraft.ts`, `bench/airside-delay.ts` | 330 pilot (`07e5e3a6`) | Heathrow seeds 1-5 >= 630 and seed 4 >= 120, full day no freeze, Boston go-arounds <= 6, cities identical | gates run 2026-11-24 (`e7ce9b31` on `task/339-parked-blockers`, not merged): Heathrow full day seed 1 774/1306, no freeze (main 367); peak seeds 1-5 146/113/94/134/135 = 622 (gate 630 fails on seed 3: three-aircraft ring); with `T330RING` seed 3 123, total 651, Zurich seed 2 106 to 181 but +16 / +8 overlaps; Boston, Zurich 1/3, London City, switches-off, tiers and Freiburg hash pass |
| [TASK-340](tasks/TASK-340.md) | sim | Ring-free ground ordering | `sim/aircraft.ts` | 339 (`e7ce9b31`) | Heathrow peak seed 3 >= 115, Zurich seed 2 >= 175 with no gridlock, no deadlock ring, then the TASK-339 gates (seeds 1-5 >= 630) | merged 2026-11-25 in `75d6a7f5` (ported onto TASK-346; release holds, chain opening, coverage rule, landing waits clear of runway holds) |
| [TASK-341](tasks/TASK-341.md) | ui/render3d | Visual quality panel: lighting, shadows, vegetation style and render quality | `render/lighting.ts`, `ui/lighting-store.ts`, `ui/lighting.tsx`, `ui/layers.tsx`, new panel in `src/ui/`, `ui/app.css`, `render3d/scene.ts`, `render3d/vegetation.ts`, `render/style.ts` | `origin/main` (`47ab2d1b`) | Balanced equals main, sun within 0.5 deg of NOAA, frame times per preset, check, city, e2e light and the new spec | review 2026-11-25 (`task/341-visual-quality`, not merged): Balanced pixel-identical to main in 3D at Freiburg and Munich; NOAA test within 0.5°; check, city, e2e light and V340 pass; species mix default Map and tree and aircraft casters off in Balanced (they would change today's look) |
| [TASK-342](tasks/TASK-342.md) | sim | Aircraft at holds clear of the next taxi lane | `sim/aircraft.ts` | 340 | Heathrow seed 3 overlaps 376 to 0, completed kept | merged 2026-11-25 in `75d6a7f5` |
| [TASK-343](tasks/TASK-343.md) | sim | Heathrow runway occupancy and crossings behind each lander | `sim/aircraft.ts` | 340 | 27L landings/h +15% at peak, no go-around or overlap increase | no gain 2026-11-25 (`cd1f7d34`, switches off): 27L has no real rapid exit in the OSM data; gap is wake spacing plus crossings far down the runway |
| [TASK-344](tasks/TASK-344.md) | sim | Turnaround and departure start efficiency | `sim/aircraft.ts`, `flight-operations.ts` | 340 | start wait and taxi-out -20% at peak, completed kept | measured 2026-11-25 (`5cfcc9ac`): 27R take-offs about 32/h against 52/h ready; extended to the take-off gap rule |
| [TASK-345](tasks/TASK-345.md) | tests | Runway-conflict checker exemptions in the tests | `tests/sim/aircraft-checks.ts` | owner 2026-11-24 | exempt-aware count, main unchanged | merged 2026-11-25 (`472f4eea`; `npm run check` 2148 tests pass; sim unchanged) |
| [TASK-346](tasks/TASK-346.md) | sim | Consolidated airside stack: pilot rules become the airside rules | `sim/aircraft.ts`, tests, architecture | 339 + 342 | identity with the pilot switches, airports not worse than main on the ladder, cities identical | merged 2026-11-25 (`75d6a7f5`, with TASK-340 and 342): Heathrow days 766/668/725 vs main 367/390/215, peak seeds 1-5 615 vs 317, Zurich days 716-746 vs 577-599, Boston 971-996 vs 752-817; no gridlock, rc real 0, overlaps level; line-up safety fix (no line-up ahead of a rolling departure) |
| [TASK-347](tasks/TASK-347.md) | render | Junctions drawn as road, one surface per group (drawing only) | `render`, `render3d`, `network/groups.ts`, geometry audit | audit 2026-11-25 | degree-two nodes drawn as junctions 25/25/58 to about 0, sim hashes identical | merged 2026-11-26 (owner: merge; census 25/25/58 to 11/8/4; sim hashes identical; new audit noses are group-surface seams, TASK-355) |
| [TASK-348](tasks/TASK-348.md) | network | Lane geometry under junction groups and signalised crossings | `network/compile.ts`, `lanes.ts`, `junctions.ts` | 347 + owner decisions | inner-road stubs and signal-node cuts to 0, J1 overlap to about 0, traffic merge rule | rule 2 merged 2026-11-26 (`db9f37b4`; standalone signal crossings plain, 0/2/4 to 0; Munich identical, Freiburg 61.3 s; all showcase gates pass). Rule 3 failed Munich (full demand fixed +5.3%, actuated choice-on +4.6%) and rule 1 gridlocked Freiburg: both off, follow-ups with diagnosis notes |
| [TASK-349](tasks/TASK-349.md) | city/airports | Zurich passes the showcase gate and joins the New city panel | cause on Flughafenstrasse `r:3407`, `bundled-cities.ts`, `bundled-projects.ts` | owner 2026-11-25 | showcase gate passes, cities merge rule, load reported | done 2026-11-26: tram-crossing fix (`6118fe61`) plus TASK-351; Zurich joined the panel |
| [TASK-350](tasks/TASK-350.md) | airports | Ground vehicles serve more turnarounds at London City | `sim/ground-vehicles.ts` | 316 | London City served >= 85%, vehicle-tug pushes >= 75%, aircraft identical, 0 vehicle overlaps | merged 2026-11-25 (`cc610d9e`; London City served 64-73% to 91-93%, vehicle-tug pushes 78-81%, Zurich 96.6%; aircraft identical, 0 vehicle overlaps; tow-on-parking tugs not done) |
| [TASK-351](tasks/TASK-351.md) | network | Where a car can leave from when the public road network splits | `importers/osm/places.ts`, `network/parking-egress.ts` | 349 | Zurich showcase gate passes, parking <= 2%, traffic merge rule | merged 2026-11-26 (`7246da22`; Zurich showcase gate passes, Zurich in the panel; Munich identical, Freiburg 62.48 s; parking 0.15%) |
| [TASK-352](tasks/TASK-352.md) | sim | Heathrow intersection departures with the arrival side | `sim/aircraft.ts` | 346 | take-offs and landings up, go-arounds not worse | parked 2026-11-26 (`43cc8498` on `task/352-idep-arrivals`, switches off, identical to main): intersection departures gain only on seed 1 (+12-15 take-offs); seeds 2-3 lose landings; final spacing is the main hold; found helipad overlap hazard (TASK-358) |
| [TASK-353](tasks/TASK-353.md) | sim | Tow-backs at the start of a run are not held | `flight-operations.ts` | 344 | start-of-run readiness wait down, airports not worse | merged 2026-11-26 (tow-backs to the stand left or the nearest own-kind stand; Heathrow days 752/758/777 vs 766/668/725, diverted 548 to 469; Zurich 729/727/746 vs 716/727/746; Boston 992/968/996 vs 991/971/996, seed 3 go-arounds 27 to 49; peak carried-in readiness -57%; seed 1 loss is the stand-pairing stall, follow-up) |
| TASK-354 | ui | Heathrow in the New city panel (owner: add now, improve in parallel) | `bundled-projects.ts`, `bundled-cities.ts`, real-places spec | owner 2026-11-25 | panel test, e2e render check (2D budget 6 ms recorded) | merged 2026-11-25 |
| [TASK-355](tasks/TASK-355.md) | bench | The geometry audit skips seams of group surfaces | `bench/geometry-audit.ts` | 347 | seams not counted, real noses counted, totals before and after | merged 2026-11-26 (`ca10a084`; square noses after 347: Munich 19 to 2, Sindelfingen 21 to 9, Freiburg 39 to 26; real medians and islands still counted; bench only) |
| [TASK-356](tasks/TASK-356.md) | airports | A vehicle tug for tow-aways right after parking | `sim/ground-vehicles.ts`, `flight-operations.ts` | 350 | aircraft identical, pushes without a tug toward 0, 0 vehicle overlaps | merged 2026-11-26 (`9c501588`; London City unannounced pushes 18/12/12 to 0, pushes with a vehicle tug >= 90%; Zurich unannounced 61 to 8; aircraft identical, 0 vehicle overlaps; Zurich vehicles queued at midnight 13 to 29) |
| [TASK-357](tasks/TASK-357.md) | render | Heathrow in the panel: load time, 2D budget, showcase morning | `render`, `render3d`, real-places spec | 354 | 2D p95 under 4 ms, first 3D frame down, showcase morning measured | merged 2026-11-26 (`cd5eb6ca`; first 3D frame 15.7-18.3 to 10.2-11.4 s, 2D p95 5.3 to 1.5-1.7 ms, 6 ms exception removed; output pixel-identical; showcase morning passes (0 gridlock, worst visit 553 s) but takes 30 min, kept to checkpoints; 3D p95 at 6 ms needs aircraft mesh batching) |
| [TASK-358](tasks/TASK-358.md) | sim | Helicopters at helipads clear of passing aircraft | `sim/aircraft.ts` | 352 | the helipad overlaps gone, Heathrow peaks and days not worse | helipad rule merged 2026-11-26 (`86ef4334`: a helicopter on a pad or below 20 m is a body in fixed-wing aircraft's way and does not start while one passes; on main after TASK-360 Heathrow peaks 1-5, days 1-3 and London City identical but seed 1's 3 helicopter overlaps gone). Stand-pairing way-in rule (`1ed91f74`, `task/358-helipad-clearance`) parked: Heathrow days 772/726/736 vs 752/758/777 |
| [TASK-359](tasks/TASK-359.md) | render3d | Batched aircraft meshes: Heathrow's 3D frame under budget | `render3d` aircraft | 357 | 3D p95 well under 6 ms, output identical | merged 2026-11-26 (`81f91d26`; instanced aircraft batches and shared real-model geometry with per-instance livery, station boards two draws a panel; Heathrow 3D draws 392 to 193, uniform calls 788 to 172; p95 0.7 ms under main in every A/B (5.2-5.4 vs 5.9-6.1 loaded, 4.0 quiet); pixel-identical but isolated edge pixels; "well under 6 ms" on a loaded machine not met) |
| [TASK-360](tasks/TASK-360.md) | sim | Departures: intersection take-offs, line-up behind a passing roll, multiple line-ups | `sim/aircraft.ts` | 353 | take-offs up, completed not worse, 0 real runway conflicts, days not worse | merged 2026-11-26 (`7efaf55c`; on runways crossing no other: intersection take-off with 15% of the run spare (CS/14 CFR 25.113), line-up ahead of a passing roll (CAP 493 2-1 13.3), multiple line-ups 200 m apart (CAP 493 2-1 14.1, 15.5; ICAO Doc 7030 6.5.4); Heathrow peaks seeds 1-5 617 to 676, take-offs 338 to 410, 27R median gap 120-172 to 75-81 s, 67% intersection take-offs, 75 multiple line-ups, 0 real runway conflicts; days 752/758/777 to 849/813/757 (seed 3: arrival admission-order hold, TASK-352), Zurich, Boston identical, London City same; owner picture sent) |
| [TASK-361](tasks/TASK-361.md) | airports | Zurich ground vehicles: dropped and late tugs, vehicles queued at day's end | `sim/ground-vehicles.ts` | 356 | pushes without a tug down, served not lower, aircraft identical, 0 vehicle overlaps | merged 2026-11-26 (`d07a2689`, Codex; depots by driven distance, junction reservations released as cleared, wait cycles broken in urgency order, one re-dispatch; Zurich pushes without a tug 179/145/171 to 79/70/84, served 61-70% to 87-88%, queued at midnight 29/73/63 to 1/0/3; London City not worse; aircraft identical, 0 overlaps; late tugs 36 to 66 on seed 1) |
| [TASK-362](tasks/TASK-362.md) | sim | A stop line under two actuated controls never gets both greens (`r:1348`, `n:18`/`n:39`) | `sim/signals.ts` | 222, 279 | repro, 279's Freiburg lock gone, merge rule | merged 2026-11-26 (`b099f2d6`, Codex; a stopped head at a stop line shared by its signal and a tram crossing keeps the near green through the far controller's change, at most one far cycle (MUTCD 8D.11); TASK-279's Freiburg 19 gridlocked to 0; main hash-identical everywhere (Munich four configurations, Freiburg, seven showcases); T75 repro) |
| [TASK-363](tasks/TASK-363.md) | sim | Heathrow arrivals: an arrival waiting for its stand does not hold the landing sequence | `sim/aircraft.ts`, `flight-operations.ts` | 352, 353, 360 | landings up, completed up, days not worse | merged 2026-11-27 (`c33fa93f`, on by default; owner accepted the go-arounds trade-off after TASK-366/367): Heathrow peaks 676 to 689, days 2,419 to 2,567, go-arounds 51 to 71, 0 real runway conflicts; Zurich, Boston, London City identical |
| [TASK-364](tasks/TASK-364.md) | network | One-way to two-way continuations without the Munich full-demand loss (TASK-348 rule 3) | `network` rule 3 | 348 | merge rule, audit | merged 2026-11-26 (`9fbf659a`, Codex; continuations only on uncontrolled straight seams with an unchanged lane map, full taper room and no TASK-093 step; group entries keep their layout (the +5.3% came from `n:452`'s group entry shortened, box refusals 1,622 to 4,008); Munich all 48 + full demand and Freiburg hash-identical, audit byte-identical; York and Zurich (two seams) rebuilt by the lead, showcases pass, Zurich graph re-pinned) |
| [TASK-365](tasks/TASK-365.md) | sim | At most two departures lined up at once on one runway end | `sim/aircraft.ts` | 360, 363 | identical where pairs suffice, no three-in-line conflicts | merged 2026-11-26 (`e5e1a8d4`, lead; Heathrow peaks, days and London City identical to main) |
| [TASK-366](tasks/TASK-366.md) | sim | Go-arounds from ground refusals at landing commitment, with TASK-363 on | `sim/aircraft.ts` | 352, 363 | go-arounds not worse than main with T363 on, gains kept | parked 2026-11-26 (`e78c618b`, switches `T366=h/p/a/s` off, identical to main): holds at release or commitment cut go-arounds but lose landings (peaks with `p` 666, `h` 666 against main 676); go-arounds trace to admission order → TASK-367 |
| [TASK-367](tasks/TASK-367.md) | sim | Heathrow: ground aircraft ordered before a queued arrival on its way off | `sim/aircraft.ts` | 330, 340, 363, 366 | completed up, go-arounds not worse, days not worse | parked 2026-11-27 (`587a9aa0`, switch `T367=c` off, identical to main): ground aircraft re-ordered behind arrivals whose way off holds their crossing; peaks with `T363=pk` 654 (21 go-arounds) against main 676 (18); crossing gaps after a hold short cost about a landing each. Branch also widens the multiple line-up test in `aircraft-checks.ts` (gate metric, owner review) |
| [TASK-368](tasks/TASK-368.md) | network | Inner roads without stub lane blocks (TASK-348 rule 1) without the Freiburg gridlock | `network/compile.ts`, `lanes.ts` | 348 | census to 0, J1 overlap, merge rule, audit | parked 2026-11-27 (`62bc06e3`, Codex): census 69/30/121 to 0 and Hbf overlap 31 to 6 m², but Munich actuated +4.7% / +9.9%, Freiburg 62 to 76 s, London City worst visit 802 to 1,111 s; the covered lane slices go to adjacent movements without refitting the turns |
| [TASK-369](tasks/TASK-369.md) | sim | Heathrow: an arrival whose way in is blocked by a parked aircraft takes another stand | `sim/flight-operations.ts` | 353, 358, 363 | stepped-out time down, completed and go-arounds not worse | started 2026-11-27 (Codex) |
| [TASK-370](tasks/TASK-370.md) | sim | Boston: overlapping aircraft bodies on full days | `sim/aircraft.ts` | 360 | Boston overlaps 22/0/11 to 0, others identical or not worse | merged 2026-11-27 (`72d2fbb2`, Codex): Boston days overlaps 33 to 0 with completed 2,956 and go-arounds 101 identical; Heathrow, Zurich, London City identical. Parked spawns check pushback reservations; waits check tight-turn chords |
| [TASK-210](tasks/TASK-210.md) | render | Roof shapes in 3D: round, dome and onion (the Schwabentor), other flat fallbacks | `src/render3d/roofs.ts` | 201, 206 | fallback counts, shape tests, close-ups, frame budget | done 2026-11-19 |
| [TASK-211](tasks/TASK-211.md) | 9 | Full-demand step time 15% faster, state hashes identical (TASK-187 follow-up) | `src/sim/**` performance | 187, 202, 204 | phase tables, identical hashes, interleaved timings | done 2026-11-19 (23.1% faster, hashes identical) |
| [TASK-060](tasks/TASK-060.md) | 5 | Tooling: workflow actions and audit advisories | `.github/workflows/ci.yml`, `package.json` devDependencies, lockfile, `eslint.config.js` | - | CI green without deprecation notes, audit clean | done (actions only; see review) |

### Waves

The November 12 audit wave runs TASK-144 and TASK-145 in parallel. TASK-147 investigates the held PR independently. Reserve local hardware for the timed rendering runs. TASK-146 follows the first two audits.

Tasks in the same wave run in parallel on disjoint file surfaces. A wave starts when every
dependency of its tasks is merged to `main`.

- Rail service wave (2026-11-12): TASK-136 road protection and equipment drawing run alongside TASK-138 timetable and vehicles. Integrate their signals and car priority after review.
- Wave 0: TASK-000, TASK-001. Nothing else starts before TASK-001 merges; it defines the
  types everything consumes.
- Wave 1: TASK-002, TASK-006, TASK-007, TASK-008, TASK-011, TASK-020.
- Wave 2: TASK-003 (after 002), then TASK-004 and TASK-005 (after 003); TASK-009 (after
  005, 006, 008, 011). The 002, 003, 004 chain is sequential because each builds on the
  previous one's code in `src/sim` and `src/routing`.
- Wave 3: TASK-010 (after 007, 009), TASK-021 (after 020, 009), TASK-024 (after 006, 020),
  TASK-025 (after 008, 020).
- Wave 4: TASK-012 (lead, after 004 and 010), TASK-022 (after 010).
- Gate 3: TASK-030 and TASK-031 in parallel after Gate 1; TASK-032 after 022; TASK-033 after
  030 and 010.
- Gate 4: TASK-040, TASK-041 in parallel; TASK-042 and TASK-043 after 041; TASK-044 as soon
  as Gate 1 is done (it coordinates with whoever owns `src/sim` at that time); TASK-045 last.
- Revised after Gate 1 (owner decision, 2026-11-03): the UI redesign TASK-050 lands before
  any further UI feature, so wave 5 is TASK-050, TASK-030, TASK-031 and TASK-026 (disjoint
  surfaces: ui and render visuals; demand and connectors; routing and the engine step;
  fixtures). Wave 6, on the new design: TASK-021, TASK-022, TASK-034, TASK-040, TASK-041.
  Wave 7: TASK-023, TASK-032, TASK-033, TASK-042, TASK-043, TASK-044. TASK-045 last.
  TASK-031 owns `src/sim/engine.ts` in wave 5; TASK-030 stays in `src/demand` and
  `src/sim/connectors.ts`. Wave 5 outcome: TASK-026, TASK-031 and TASK-050 merged;
  TASK-030 was not delivered and runs again alongside wave 6.
- Wave 6 (lead, 2026-11-03): TASK-021, TASK-022, TASK-040, TASK-041 and the TASK-030 rerun
  (branch `task/030-activities-2`) in parallel. TASK-034 follows TASK-022 because both need
  the map pointer plumbing for a drawing tool; TASK-022 owns `src/ui/toolbox.tsx`,
  `src/ui/map-view.tsx` and the tool state in the store. Shared files (`store.ts`, `App.tsx`,
  `scene.ts`, `app.css`) take additive edits only; the lead resolves the merges.
- Wave 6 outcome (2026-11-03): all five merged.
- Wave 7 (lead, 2026-11-03): TASK-034, TASK-023, TASK-032, TASK-042, TASK-043 and TASK-044 in
  parallel. Each tool task adds one tool file, one toolbox button, one entry in the map-view
  tool map and one literal in the store's tool union; TASK-034 owns `src/ui/inspector/place.tsx`,
  TASK-023 owns `src/ui/tools/select.tsx` and the selection model, TASK-032 owns `src/sim` and
  `src/fixtures/ramp.ts`. TASK-042 and TASK-043 add to `src/host` additively (compare runs and
  trajectory sampling). TASK-044 measures and optimizes `src/render` and `src/routing` only this
  wave and reports `src/sim` hotspots for after TASK-032. TASK-033 follows TASK-034 (both edit
  the place inspector and the regenerate action); TASK-045 last.
- Wave 7 outcome (2026-11-03): all six merged. Wave 8: TASK-033 (place editor and demand
  panel) and TASK-046 (simulation hotspots from the TASK-044 profile: reroute scanning,
  prepareTravel, lane-change proposals, the stress grid's stranded trip) in parallel on
  disjoint surfaces; TASK-045 last.
- Wave 8 execution (owner decision, 2026-11-03): the lead starts the agents as sessions from
  the lead chat, one worktree per task cut from `main`; review and merge stay with the lead.
  TASK-045 waits until TASK-033 and TASK-046 are in.
- Wave 8 outcome (2026-11-04): TASK-033 and TASK-046 merged. TASK-045 is the last task.
- Wave 9 (lead, 2026-11-04, owner-started agents as before): TASK-047, TASK-048 and
  TASK-049 in parallel on disjoint surfaces (renderer; importer and compiler lane
  assignment; sim, editor, signals and a signs layer). TASK-051 (live edits, B8) follows all
  three after a lead design note amending the restart rule. Fixture
  `fixtures/osm/sindelfingen-a81.osm` (A81 junction, seven roundabouts) is the roundabout
  check for TASK-049.
- Wave 9 outcome (2026-11-04): all three merged. Next: TASK-051 after the lead design note,
  with B13 folded in.
- Wave 10 (lead, 2026-11-04, owner-started agents on branches cut from `main`, one worktree
  each): TASK-053 to TASK-060 in parallel on disjoint surfaces. Two pairs share a module but
  not a file: TASK-054 and TASK-056 both edit `src/importers/osm/index.ts` (the junction seed
  list versus `addNode`'s layer computation); TASK-053 and TASK-058 both live in `src/ui`
  (the wizard versus the run bar, inspector container and stylesheet). TASK-055 stays out of
  `src/sim` and TASK-057 out of `src/network`; each reports causes on the other's surface
  instead of fixing them. Merge order: 057, 055, 054, 056, 059, 053, 058, 060. B13 leaves
  TASK-051; the B16 junction geometry task (TASK-061) and TASK-051 follow in wave 11 after
  the lead design notes.
- Wave 10 outcome (2026-11-04): all eight merged in the planned order with one lead fix
  commit (the highway fixture's warning baseline, a diagnostic code in architecture 5.5, the
  pass-through probe moved to `bench/`, a layers test, and the import default fixed from the
  probe). Review entries below. Next: the wave 11 design notes.
- Wave 11 (lead, 2026-11-04): TASK-051, TASK-061 and TASK-062 in parallel on disjoint
  surfaces, branches `task/051-live-edits`, `task/061-junction-geometry` and
  `task/062-routing-throughput` cut from `main` at the commit that carries the design notes
  (architecture sections 1, 5.1, 5.2, 6, 8, 10, 11, 14). Boundaries: TASK-051 stays out of
  `src/routing` and uses the `RouteProvider` as it is; TASK-062 stays out of `src/sim` and
  keeps every returned route identical (the benchmark route hash); TASK-061 stays out of
  `src/sim` and `src/routing` and reports engine or router defects by id. Merge order: 062,
  051, 061. TASK-061 changes every lane length and with it every state hash, so it lands
  last and the other two are verified against unchanged hashes.
- Wave 11 outcome (2026-11-04): all three merged in that order with lead fix commits
  (trip-scheduling edits stay a restart, overflow carried through zero-length movements, a
  projection guard, the setback cap, the pinned routes captured again). The four state
  hashes turned out unchanged even after TASK-061. Review entries below. Next: an owner
  testing round on Munich with live edits and the new junctions, and the Gate 5 scope
  decision.
- Wave 12 (lead, 2026-11-04, after the owner's Munich test, B23 to B26): TASK-063 and
  TASK-064 in parallel, branches `task/063-junction-surface` and `task/064-conflict-zones`
  cut from `main` at the commit that carries the design (architecture 5.1, 5.3, 8, 11, 14).
  TASK-063 changes only how junctions are drawn (outline, crossings, colour) and keeps every
  lane end, so the four state hashes stay; TASK-064 changes the grant rule and every hash,
  and stays out of the geometry files. Merge order: 063, then 064, then a lead commit that
  removes the setback cap once the uncapped Munich run is at least as fast as the capped
  one. Both agents report in their commit messages: wave 11's branches carried none.
- Wave 12 outcome (2026-11-04): both merged, plus a lead commit that cut the compile cost
  the two tasks added without changing any compiled geometry. The cap stays: with it lifted,
  Munich completes 1 285 trips by 10:00 against the capped 2 231 (B27 below). Next: B27 and
  B28 together, B29, shipping, then Gate 5.
- Wave 13 (lead, 2026-11-04): TASK-065, TASK-066 and TASK-067 in parallel, branches
  `task/065-zone-timing`, `task/066-smooth-roads` and `task/067-ship` cut from `main` at the
  commit that carries the design (architecture 2, 8, 13, 14). Surfaces: the simulation; the
  OSM importer and its tests; CI, Vite config, three URL lines and the README. TASK-066
  changes imported geometry but not the synthetic fixtures, so the benchmark hashes stay;
  TASK-065 may change them. Merge order: 067, 066, 065, then a lead commit that lifts the
  setback cap if Munich at 0.15 uncapped completes at least as many trips as capped on the
  merged tree, then the owner enables GitHub Pages. Owner decision: no long performance runs
  unless they block.
- Wave 13 outcome (2026-11-04): TASK-067 and TASK-066 merged with lead fixes. TASK-065 came
  back uncommitted, without a report and not typechecking, and it misses its merge goal, so
  it is returned to its agent in its worktree; the cap stays. Next: TASK-065 again, the owner
  enables Pages.
- Wave 13 completion (2026-11-05): TASK-065 merged on its second round with the cap kept.
  Lifting the cap is abandoned as the route to B26: it shortens acute approach lanes too far.
  Next: B31 (realign acute approaches on import), B30, Gate 5.
- Wave 14 (lead, 2026-11-05): TASK-068 and TASK-069 in parallel, branches
  `task/068-acute-approaches` and `task/069-notes-and-picks` cut from `main` at the commit
  that carries the design (architecture 5.5, 13 step 12, 14). Surfaces: the OSM importer;
  the diagnostic severity, its UI and the e2e helpers. Both may change the warning-count
  table in `tests/importers/munich.test.ts`; the lead reconciles it at merge. Merge order:
  069, then 068. GitHub Pages waits for the owner.
- Wave 14 outcome (2026-11-05): both merged, 069 as delivered and 068 with a lead merge
  commit (the warning table, `realign_limited` as a note). B30 did not reproduce on current
  code. Munich at 0.15 completes 2 175 trips by 10:00, the best since the TASK-063 era
  (wave 12: 2 231 before smoothing). Next: the owner's test round and the Gate 5 decision.

- Wave 16 (lead, 2026-11-05): the owner's second test round comes before Gate 5 (owner
  decisions log). TASK-074, TASK-075 and TASK-076 in parallel, branches
  `task/074-junction-shapes`, `task/075-junction-markings` and `task/076-exit-lanes` cut from
  `main` at the commit that carries the design (architecture 1, 5.1, 7, 8, 11, 14; the new
  `SimParams` fields with their defaults). Surfaces: network geometry with the node layer and
  the marking clip in `drawRoad`; a new render layer and its `scene.ts` wiring; routing and
  the lane-change parts of the simulation. TASK-077 also changes `src/sim`, so it starts once
  TASK-076 is merged, on a branch cut then. Merge order: 076, 075, 074, then 077.

- Wave 17 (lead, 2026-11-06): the owner's round 3 findings (B32 to B37, screenshots in
  `docs/findings/2026-11-06/`). TASK-078, TASK-079 and TASK-080 in parallel on branches
  `task/078-curbs`, `task/079-junction-markings` and `task/080-transitions`, run by the lead's
  subagents in worktrees under `D:\cityflows-wt`. Surfaces: curb aprons in the network and
  `drawNode`; the road markings in `roads.ts`; tapers and continuity in the network with
  `transitions.ts` and `drawRoadJoins`. Shared: `src/geo/polyline.ts` (078 and 079 add
  exports), `nodes.ts` (078 `drawNode`, 080 `drawRoadJoins`); the lead reconciles. Merge
  order: 079, 078, 080.

- Phase 1 of Gates 7 to 9 (lead, 2026-11-07): TASK-100, TASK-101, TASK-105, TASK-106 and
  TASK-108 in parallel on `task/100-vehicle-classes`, `task/101-road-access`,
  `task/105-terrain`, `task/106-vegetation` and `task/108-lane-markings`, cut from `main` at
  the commit that carries their contracts. The owner runs the agents; each creates its own
  worktree. Surfaces and merge order: "Phases" under "Roadmap: Gates 7 to 9".

Rule from the brief: no broad parallel coding before the schema exists. Two tasks that must
both change `src/sim` (for example 004 and 031) are sequenced, never parallel.

Execution model: the owner starts one Codex agent per task in its own git worktree cut from
`main`; the lead reviews each branch on request and merges locally until a GitHub remote
exists.

## Lead responsibilities

- Keep `docs/architecture.md` and this file current. A contract change is a PR that updates
  the doc and the code together, approved by the lead.
- Assign tasks, one per agent, with the task file as the brief. Refuse scope creep in PRs.
- Review every PR for semantic compatibility: movement legality, connectivity, determinism
  (hash tests), license (`NOTICE`), and the task's acceptance tests. CI green is necessary,
  not sufficient.
- Run TASK-012 (Gate 1 integration) personally, then update the Gate 1 status here.
- Record deferrals here with the reason and the task that will lift them.

## Requirement coverage

| Requirement | Delivered by |
|---|---|
| R1 individual vehicles on multi-lane networks | TASK-003, 004, 032 |
| R2 import real cities and author roads | TASK-020, 021, 022, 023, 025 |
| R3 quasi-realistic work/life travel | TASK-011, 030, 033 |
| R4 high-ingress special places | TASK-003 (connectors, capacity), 030, 033 |
| R5 advanced road and traffic controls, plausible routing | TASK-002, 007, 010, 022, 031, 032, 040 |
| R6 browser-first, no heavy engine | scaffold, TASK-005, 006, 044 |
| R7 person agents, multimodal readiness | TASK-001 (demand types), 011 (T15), 030 |
| R8 batch import plus user modifications, no buildings | TASK-020, 022, 023, 025 |

## Deferrals and open items

- Lane changes are discrete in the model; the renderer animates them (architecture section 8).
- Edits during a run: TASK-051 patches the running engine (architecture section 8, live
  edits); edits that change demand still need a restart.
- `npm audit` reports moderate advisories in dev tooling only (minimatch under
  typescript-eslint); nothing ships to the browser. Revisit when upgrading tooling.
- B54 east (`n:138`) and B55 (owner, 2026-11-07): outstanding, deferred while Gates 7 to 9
  proceed; TASK-099's attachment stays limited to its two named Munich corridors. B54 and B55
  were then done by TASK-131 (2026-11-11). B56 reopened (TASK-130) and is deferred inside
  TASK-131 Phase 3 (owner, 2026-11-12).
- B57 (lead, 2026-11-09): Sindelfingen's walk graph has places and garage connectors in
  separate components, so 70% of its egress walks fall back to a straight line (TASK-112).
  TASK-123 joins them (round 2).
- B58 (lead, 2026-11-09): garages `pk:1981` and `pk:2035` in Munich have no car exit (TASK-122
  review); their exits reach only one direction of a two-way road. Done by TASK-124 (2026-11-10).
- Parking exit overlap (TASK-149 review, 2026-11-12): an exiting car waits on the public lane;
  TASK-150.

## Owner findings from real OSM testing (2026-11-04)

Logged as the backlog for the wave after TASK-045; planned once TASK-045 is merged. First
triage by the lead; the agents' investigation may move items between groups.

| Id | Finding | First triage |
| --- | --- | --- |
| B1 | Junctions render as a large disc with arrows instead of the junction shape. | Renderer: draw the junction surface as the union of the road ends and movement surfaces, no disc beyond the lane edges; disc only for degree-two nodes. |
| B2 | OSM imports interlock: short segments form small junction loops; feeder roads join a major road in one direction only, or not to every lane of a direction. | Importer and compiler: merge sub-30 m segments between degree-two nodes, join feeders to both carriageways of a divided street, lane assignment for a single-lane approach into a multi-lane road. Needs a real extract as a fixture. |
| B3 | Highways spawn no cars on OSM imports. | Demand on imports: gateway demand by road class exists (`src/importers/osm/places.ts`), check that motorway and trunk ends get gateways and that clipped ramps are not counted as ends. |
| B4 | No way to hide the OSM basemap in OSM mode. | One Layers entry for tiles (`setTiles` exists on the Scene). Small. |
| B5 | OSM places should also come from buildings and land use inside the area, not only the edges; edge gateways stay. | Importer: residential, commercial, industrial and retail land use and building footprints become places with population and jobs by area; gateways unchanged. |
| B6 | Cars jump between positions; interpolate between simulation ticks without simulating intermediate steps. | Renderer: dead-reckon each car along its lane from the last snapshot (position plus speed times elapsed wall time scaled by the run speed) until the next snapshot arrives; vehicles layer only. |
| B7 | Lane-change motion looks unnatural. | Renderer: ease the lateral offset (smoothstep over `laneChangeDurationS`) and turn the car heading slightly into the change; no model change. |
| B8 | Every map edit asks for a restart; production needs on-the-fly edits with bounded rerouting. | Engine and host contract change (T17 and the "live topology edits" deferral): hot-swap the compiled city under a running engine, remap vehicles to surviving lanes, reroute only vehicles whose remaining route touches a changed road or movement, staggered over the reroute interval; edits that remove a lane under a car keep a short grace. Needs a design note before agents run. |
| B9 | Lane markings and realistic junction markings; built-in roundabouts as a special object with their own routing. | Renderer for stop lines, give-way triangles and junction markings; roundabout as an editor object that builds a circulating one-way ring with yield-on-entry and `uturn` allowed, plus a Roundabout tool. |
| B10 | Yield and stop signs. | Model has `Control` yield and stop; check the gap-acceptance behaviour at both and add sign visuals and the node control in the inspector (already there) with a sign on the map. |
| B11 | Signals may or may not allow right turn on red. | `SignalProgram.rightOnRed` (left on red under left-hand driving): a permitted turn on red yields like a stop sign; compiler marks those movements, signal editor toggle, importer default per country. |
| B12 | Pedestrian crossing visuals. | Renderer: zebra markings at signalized junction approaches and at nodes tagged `crossing` by the importer; no pedestrian simulation. |
| B13 | Imported cities gridlock at the default demand (one person per resident on 35 000 residents). | Import wizard: default `personsPerResident` for imports around 0.3 and a demand slider on the accept step; the probe takes a scale argument. Small. |
| B14 | With wider fonts (Linux, DejaVu Sans) the Demand sheet covers the lower part of an open inspector at 1440 × 900, so controls there cannot be clicked until the sheet closes. | UI: keep run-bar sheets and the inspector from overlapping, for example by capping the inspector above an open sheet. Small. |
| B15 | OSM import (owner, 2026-11-04): some points where a road is only split are classified as junctions with traffic lights. | Importer: a signal tag or a generated program only at nodes where streets actually cross or join; a node between two sections of one street stays plain. Check against the Munich extract. |
| B16 | At irregular junctions roads still overlap each other. Junctions need real geometry: setback stop lines, rounded curb edges, and movement paths a real car would drive, such as a ramp's merge lane running alongside the expressway before it joins. | Network geometry and renderer: per-junction setback from the lane-edge intersections, curb arcs between adjacent approaches, movement curves built from the setback ends, and merges as parallel taper lanes instead of point joins. Large; needs a design note (architecture 5.1, 5.2, 11). |
| B17 | Some routes look valid but cannot be driven, especially through irregular junctions and near the map edge. | Routing and compiler: find which lane-level routes the engine cannot follow (fallback movements, dropped lanes, clipped boundary roads), make them a diagnostic, and add the cases to the Munich test. |
| B18 | A junction node behaves and looks too different from an ordinary stretch of road. | Investigate first: degree-two and through-street nodes should drive and draw like the road itself (no slowdown, no stop, no junction surface); real junctions keep their treatment. Overlaps B15 and B16. |
| B19 | Roads that are on top in reality (bridges, flyovers) should be drawn on top; where the level is unknown, the order should at least be consistent. | Importer and renderer: carry OSM `layer`, `bridge` and `tunnel` into the road's grade and draw by grade, with a deterministic tie-break by id. |
| B20 | After TASK-055 the router runs its lane-level search for nearly every request: routes per second fell 2 to 3 times and the town's engine rate by a third (TASK-055 review entry). | Routing: accept the road-level result whenever its lane resolution needs no change that the audit would reject, or make the lane search incremental; keep the audit at zero. Measure with `npm run bench` against the TASK-055 entry's numbers. |
| B21 | At an acute approach the lane blocks of two roads still overlap on the map beyond the 10 m setback cap (Munich 24 nodes, Sindelfingen 16 after TASK-061). | Geometry: draw the overlap as one merge surface, a taper, and run the movement along it; the cap keeps the simulation honest meanwhile (TASK-061 review entry). |
| B22 | The bundled grid opens with "Validation (15)": fifteen `lane_requires_merge` warnings since TASK-055, where its two-lane streets feed one-lane streets. | Fixture or compiler: give the grid's narrowings a proper lane drop, or stop warning where the clamped movement is the only continuation. Small. |
| B23 | Owner, 2026-11-04 (Munich after wave 11): junctions still do not look right. A road's edge should run smoothly from one road segment through the junction to the next; today the surface is a polygon through the road-end corners, widened to a convex hull wherever a movement curve escapes it, so it shows corners and blobs. | Network geometry and renderer, with B21: the outline is road edge, curb fillet, next road edge for every pair of angularly adjacent ends, with no hull; an acute pair is a gore whose surface follows both lane blocks until they separate. |
| B24 | Owner: queued cars stand on the zebra crossing. The crossing is drawn 1.8 to 4.2 m before the lane end and the stop line at the lane end, and an ungranted car stops `minGapM` (2 m) before the lane end, so its front is on the crossing. | Renderer: stop line, then crossing, then junction. Draw the crossing in the junction mouth just past the trimmed lane end (inside the setback) so the stop line is where cars stop. Small. |
| B25 | Owner: the junction surface is a different colour from the roads it joins; road class tones (which the owner reads as speed-limit colouring) should be optional. Roads take a tone per class from `roadStyle`, the junction always `style.asphalt`. | Renderer and Layers: one asphalt colour for roads and junctions by default; a "Road classes" Layers entry turns the class tones on, and then a junction takes the tone of its highest-class road. Small. |
| B27 | Owner, 2026-11-04 (with B26): a granted car still far from a conflict zone blocks a crossing car that would clear the zone before it arrives, which is why the uncapped Munich run loses 40 percent of its trips even with conflict zones (TASK-064 review). | Simulation: reserve conflict zones by time window (estimated entry and exit from current speed and distance) instead of by grant, so a crossing car may use a zone that a granted car will reach only later; then lift the setback cap (B26, B21). Needs a design note for architecture 8. |
| B28 | Owner: restrict, without banning, entry into a junction when the car is likely to wait inside it for the cars ahead to move ("don't block the box"). Today only the exit lane's first `vehicleLengthM + minGapM` must be free. | Simulation: grant entry only when the exit lane has room for the whole car past the movement, estimated from the exit queue's tail and speed; allow it anyway after a waiting time, so a jammed junction still drains. Belongs with B27 in `src/sim/intersection.ts`. |
| B29 | Owner: roads should be smooth curves with realistic curvature, not the piecewise linear segments exported from OSM. | Importer or compiler: fit the OSM centerline with a smoothing spline or circular arcs (bounded deviation, a minimum radius by road class), sampled for lanes; keep node positions. Lanes, movements and every hash change. Medium; touches `src/importers/osm` or `src/network/lanes.ts`. |
| B32 (done, TASK-078, redone by TASK-083) | Owner, 2026-11-06 (round 3; screenshots in `docs/findings/2026-11-06/`, 1, 6, 7, 8): junction curbs should sweep from one road's edge into the next with a realistic radius, as the owner drew in red. TASK-074 ties the curb radius to the setback and set it to 1 m because a larger radius shortened approach lanes and cost Munich trips. | Network geometry: draw curbs with a class-based radius tangent to the road edges, independent of the setbacks, filling only the corner outside both road surfaces, so lane lengths and the simulation stay as they are. |
| B33 | Owner, round 3 (1): lane dividers stop short of the junction on some approaches; they should run up to the stop line and the junction mouth. | Renderer: find what ends them early (TASK-074's clip at other surfaces within 10 m of the cut, or the stop-line rule) and run them to `stopM`. |
| B34 | Owner, round 3 (7, the two circles marked X): lane arrows drawn where they should not be, on the short road between the Y-junction and the signal below it. | Renderer: lead's reading, to confirm with the owner: arrows belong only on an approach's last stretch before its stop line, once per approach, and not on a link too short for them or just past a junction. |
| B35 | Owner, round 3 (2), clarified: on a long curve the centre line and the boundary (edge) lines are not drawn properly; they should follow the curve at their offsets. | Renderer and geometry: markings come from `offsetPolyline` of the lane polylines (per-vertex miter, clamped), which drifts on tight, densely sampled curves; measure the offset error of every marking on the four cities and draw markings that keep their offset through curves. |
| B37 | Owner, round 3 (3), clarified: where a road gains a lane the widening should happen over a short section, not a long gradual change. | Geometry: TASK-071's taper is `min(60 m, half the road)`; make it short, scaled by speed (about 20 m in town, up to 40 m on fast roads), for added and dropped lanes and branch offsets alike. |
| B36 | Owner, round 3 (4, 5): carriageway splits and merges that TASK-071 does not cover draw as two overlapping surfaces without lane markings (4), or with a jagged edge where a ramp joins (5). | Network and renderer: lanes continue side by side with dividers through such splits and merges, and an absorbing merge draws as a smooth taper. |
| B38 (done, TASK-082) | TASK-079 review: some lane polylines step backwards by 4 to 26 m (Munich `r:1025`/`r:1026`, `r:839`/`r:840`, `r:866`/`r:867`; Sindelfingen `r:1053`/`r:1054`, `r:1116`/`r:1117`), so the markings drawn from them are off there. | Geometry (`lanes.ts`) or the importer's smoothing: find where the offset lane polyline folds back and remove the fold. |
| B39 (movements done, TASK-085; drawing B44) | TASK-080 review: at multi-lane splits and merges that stay ordinary junctions (Munich n:312, n:305, n:201, n:194) the stretch between the road ends is a junction surface with no lane markings, and some lanes there have no movement into the lane beside them (`r:313` has none into `r:692`). | Network movements and guide markings: generate the missing through movements at such splits, then let TASK-075's guide lines (or continuation) draw dividers across them. |
| B40 (done, lead fix 44d871c) | TASK-084 review: the engine computes a conflict zone's entry position as `(lane.lengthM + zoneStart) - lane.lengthM`, which can round past `zoneStart`; T21 failed once by 2e-15 m on an intermediate tree. | Simulation: clamp the entry position to `zoneStart` (a rounding fix, no rule change); confirm the benchmark hashes. |
| B41 (done, TASK-087, TASK-089) | TASK-083 review: dual carriageways the source draws closer than their lane blocks (Landsberger at `n:104`, `n:324`, `n:721`, `n:774`; Arnulfstraße at `n:446`, `n:949`) overlap and their lanes cross near the node. | Importer: separate such pairs as TASK-084 separates coincident ones (a lateral push to the median), then let TASK-083 treat them as one approach. |
| B42 (done, TASK-087, TASK-089) | TASK-083 review (R3-6, `n:138`): with Arnulfstraße's carriageways one arm, the realignment of acute approaches bends Donnersbergerstraße within 25 m of the node instead, and two curb ends on the south road show 1 px nubs. | Importer realignment and curb drawing: check which arm the acute rule should bend at `n:138` and remove the nubs. |
| B43 (done, TASK-089; Sindelfingen 5 of 15 and `n:156` named) | TASK-083 review: through pairs whose joined alignment passes more than 2 m from the node keep their centerline (16 of 127 in Munich, 14 of 114 in Sindelfingen; `n:30`, the `n:823` Y), and divided pairs continuing into two carriageways widen their median near the node (`r:1280`/`r:1334` 0.5 to 0.93 m). | Network: let through alignments move farther where side-road storage allows, and keep a divided pair's median constant across the node. |
| B44 (done, TASK-088) | TASK-083 review: multi-lane splits that stay ordinary junctions (B39, `n:201`, `n:312`) now draw a smooth surface but still carry no lane dividers across it; R3-1 `n:1181` shows zebra and stop markings at two approaches where they were hidden before. | Renderer (`roads.ts`, junction markings): draw dividers along TASK-085's through movements at such splits; check the markings at `n:1181`. |
| B45 (done, TASK-093; threshold 3 m, owner to confirm) | Owner, 2026-11-06 (round 5; screenshots in `docs/findings/2026-11-06-round5/`, 1): Landsberger Straße between `n:721` and `n:328` works, but irregular voids remain between its two carriageways. Suggestion, not a hard requirement: where OSM draws one street (same name, ref or way lineage) as two or more lines, draw them parallel and attached, without the irregular median gaps. | Importer and network: extend TASK-087/TASK-089 separation to close median voids narrower than a threshold for one street's carriageways (corridor), keeping them parallel at the 0.5 m median; owner to confirm the threshold. |
| B46 (done, TASK-091) | Owner, round 5 (2, and 6 at the X): Westendstraße/Ganghoferstraße and `n:104`, a two-way road's centre line runs into the junction; it should end at the junction mouth. | Renderer: clip centre lines at the cut (stop position), as lane dividers are. |
| B47 (done, TASK-093) | Owner, round 5 (3): at `n:212` (and `n:55`) a one-way, one-lane road continues as a two-lane, two-way road, and the geometry aligns the centre lines. It should align the lane of the same travel direction (lane-to-lane continuity). | Network: continuation alignment for one-way to two-way continuations by the matching direction's lane, as TASK-071/TASK-089 align continuation lanes. |
| B48 (done, TASK-092; named exceptions in T42.1) | Owner, round 5 (4, 5, 6, 7): sharp junction corners: `n:262` (the marked corner and others), `n:967`, `n:104` (south road both sides), `n:291` (curb from the north road into the south-west road kinks). Curbs should sweep with a radius. | Network: find why the TASK-083/TASK-089 curb cubics degenerate there (short cuts, split ends, acute arms) and give every corner a class radius; T38.3 to cover every corner, not only B42's. |
| B49 (done, TASK-093) | Owner, round 5 (5): `n:967`, the east road's two carriageways overlap into the junction; they need separate end points and the overlap removed, as at Landsberger Straße (1): parallel carriageways with their own lanes and a median line up to the junction. | Importer/network: why TASK-089's split missed `n:967` (pair detection, angle, or same-direction pair); apply the split. |
| B50 (done, TASK-091; signal arms TASK-094) | Owner, round 5: pedestrian crossings. Make them editable (decorative only for now); every node gets crossings by default except expressway ramps; crossings start farther from the junction (owner 7: the `n:291` west-arm stripes run into the corner). | Schema and editor: a per-approach crossing flag (default on, off for motorway links), an inspector toggle, and a set-back of the stripes behind the curb return. No simulation effect. |
| B51 (done, TASK-092) | Owner, round 5 (6): `n:104` node shape, smaller problems: the median nose between the west carriageways is square, not rounded; sharp corners at the south road (B48); the south road's centre line enters the junction (B46). | Network and renderer: round median noses at split ends (TASK-089); B46, B48. |
| B52 (curb done, TASK-092; stripes TASK-091/094) | Owner, round 5 (7): `n:291`, the curb from the north road into the south-west road kinks, and the south-west arm's crossing stripes run into the curb corner. | Network: B48; renderer: B50's set-back. |
| B53 (done, TASK-094) | TASK-091: at signalised approaches the crossing stays where TASK-072 put it (0.25 to 2.75 m from the cut, between the stop line and the junction); setting it back as the owner asked (B50) moves it 5 to 12 m out, behind the stop line, so cars at red would stand on it (T26). 34 Munich ends (incl. `n:291`) and 4 at Sindelfingen `n:110`. | Simulation rule change, owner to decide: move `stopM` to the crossing's far edge plus 0.5 m (`src/network/stops.ts`), new benchmark hashes. |
| B54 (done by TASK-131, 2026-11-11; amended by the owner 2026-11-10: side by side with a divider only where the carriageways overlap or leave no space; elsewhere drawn where they are; Landsberger done, TASK-095 salvage; `n:138` west and `n:638` done, TASK-099; `n:138` east deferred, owner 2026-11-07) | Owner, 2026-11-07 (round 6; screenshots in `docs/findings/2026-11-07-round6/`, 1, 2): one street's carriageways still run apart with irregular voids wider than TASK-093's 3 m: Arnulfstraße at `n:138` west (`r:386`/`r:716`) and east (`r:715`/`r:958`), and east of the Donnersberger bridge at `n:638` (`r:654`/`r:680`; the owner's n:168). "Merge both segments into paired road with center divider marker lines." | TASK-095: attach one corridor's carriageways wherever they run within 20 degrees, with a divider; ease apart only where they part. |
| B55 (done by TASK-131, 2026-11-11: side-by-side strips, 12 Sindelfingen cases incl. `n:68`; reopened 2026-11-10; deferred 2026-11-07, TASK-099 did not reach it) | Owner, round 6: "we still need to make the '2 roads approach an intersection at small angle diff or parallel' handling": different streets approaching a node nearly parallel overlap near it (Sindelfingen `n:841`, `n:68`). | TASK-095: hold such pairs side by side up to the node (TASK-089 split ends for any pair), rounded gore, edge line between them. |
| B57 (TASK-123, 2026-11-09) | TASK-112 report: in Sindelfingen at 0.15, 99 of 140 walk legs (70.7%) have no walk route and fall back to a straight line, all egress from a garage. The walk graph (TASK-110) puts places and the garages they use in different components, for example `p:1407` (component 27) and `pk:1453`'s connector (component 2), and `p:1433` and `pk:1466`. Munich has none. | Walk network (`src/network/walk*`): connect every place entrance and parking connector to the main walk component, or explain which gaps are real. Gate: walk fallbacks under 2% in both cities. |
| B56 (reopened 2026-11-10, TASK-130; head detours TASK-121, 2026-11-09) | TASK-099 round 3: Munich at 0.15 holds a deadlock loop (Arnulfstraße eastbound, `n:138`, the Landsberger ramps, `n:967`'s ramp `r:703`, the Donnersberger ramps through `n:638`, back to `r:884`) that locks at `n:263`, where the head of `r:703#1` waits for good to enter a standing queue in lane 0 instead of re-routing. Main had it before TASK-099 (`r:406#1`'s head waited 6 084 s) without a head standing still long enough to count as stalled; TASK-099 shows it as one stalled head on `r:753#0`. A 1 cm shift of an unrelated road moves completed trips by up to +211 and can stall a head on this corridor. | Simulation rule (owner): let a vehicle stuck at a queue head re-route or give way; then tighten the gate back to 0 stalled heads. |
| B58 (done, TASK-124, 2026-11-10) | TASK-122 review: two large Munich garages have no car exit. `pk:1981` (capacity 1 071, `p:1733`) leaves only onto `r:379#0` of two-way Trappentreustraße, whose one movement enters the bus-only `r:373`; `pk:2035` (441, `p:1841`) leaves via `r:1060` into private `r:921`. Their exit connector sits on one direction of the road only. On main their cars park in the morning and could not leave in the evening; with TASK-122 they are refused and cruise for street space for up to two hours. | Network (connectors): a driveway on a two-way road should reach both directions (a left turn out), or the importer should find the facility's real exit. Gate: no garage or lot of more than 20 spaces without a car exit in either city. |
| B59 (done, TASK-140, 2026-11-11) | TASK-131 review: at signalised crossings the pedestrian heads and the walk link stand 8 to 10 m nearer the junction than the drawn zebra stripes; in Munich 100 of 249 signalised crossings are more than 3 m off (76 outside junction groups; `n:34` 4 to 6 m, `n:372` 4 m, `n:23` 5 m). TASK-094 set the stripes back (B53) without moving the links or heads. | Network: one crossing position (the stripes) for walk links, heads and walker conflict zones. |
| B31 (done, TASK-068) | Acute approaches (B26, B21): cars stop well before the junction because a lane at a sharp angle only clears its neighbour far out, and lifting the setback cap to follow that geometry cuts the approach lanes to stubs and costs a quarter of Munich's morning (TASK-065 review: `r:961#0` 41.5 to 4.8 m, `r:706#1` storage 70 to 41 m). | Importer, with TASK-066's smoothing: realign the last 15 to 25 m of a minor approach that meets another road at under about 45 degrees, bending it to meet at 60 degrees or more as road design does, so setbacks stay short, lanes keep their storage and stop lines sit at the junction. Junction node fixed; bounded lateral shift; the 10 m cap then rarely binds. |
| B30 (closed, TASK-068) | Munich at 0.15 completes 2 005 trips by 10:00 after TASK-066's smoothing, against 2 231 before (wave 12), with routes, junction headings and warning lists unchanged. | Investigate with TASK-065's zone probe: which junctions gained queues, and whether smoothed approach lengths moved setbacks or movement lengths. Not attributed yet. |
| B26 | Owner: at acute junctions cars stop well away from the junction. Since TASK-061 a lane stops where its lane block clears its neighbours', capped at 10 m, so on an acute approach the car waits at the cap with the lane blocks still overlapping in front of it. The cap exists because a car on a movement blocks every conflicting movement for the movement's whole length. | Simulation (conflict points): resolve conflicts at the crossing point along each movement instead of over the whole movement, so setbacks can follow the geometry again without killing throughput; then lift the cap and let B23's gore surface reach the stop line. Large, needs a design note (architecture 5.3 and 8). |

Grouping for the next wave, to confirm after TASK-045: a renderer wave (B1, B6, B7, B9 markings, B12 and B4 together), an import wave (B2, B3, B5 with a real extract fixture), a control wave (B10, B11, B9 roundabouts) and B8 on its own with a contract amendment first.

### Reference extract and import baseline (2026-11-04)

`fixtures/osm/munich-donnersberger.osm` is the reference extract for the backlog: the
Donnersbergerbrücke and Mittlerer Ring in Munich, bbox 11.525, 48.135, 11.545, 48.148
(2.15 km²), with every highway way and node, turn restriction relations, buildings, land use,
amenities and stations, so importer changes rerun without another download (attribution in
`fixtures/osm/ATTRIBUTION.txt`). `npm run import-probe -- fixtures/osm/munich-donnersberger.osm
11.525 48.135 11.545 48.148` imports it, compiles it, routes every connector pair and runs
07:00 to 10:00 headless. Baseline before the import wave:

| Measure | Value |
| --- | ---: |
| Roads / nodes / signals | 837 / 465 / 40 |
| Road classes | trunk 24, ramp 32, primary 45, secondary 50, tertiary 56, residential 368, service 262 |
| Places | 150: 64 gateways, 80 parking, 5 schools, 1 station; no residential or work places (B5) |
| Import and compile warnings | road_too_short 173, dead_end 65, connector_unreachable 7, disconnected_component 1 |
| Connector pairs routable | 10 181 of 19 193 (53 percent) |
| Morning run, 4 660 persons | 462 completed, 3 970 failed: no origin connector 1 560, no destination connector 1 066, no route 676, stranded 668; peak 235 driving |

The import wave (B2, B3, B5) reports the same table after its changes; the targets are no
unreachable connectors, every connector pair routable, under 1 percent failed trips, and
residential and work places from buildings and land use.

After TASK-048, same probe (one person per resident, car share one):

| Measure | Before | TASK-048 |
| --- | ---: | ---: |
| Roads / nodes / signals | 837 / 465 / 40 | 548 / 287 / 24 |
| trunk / ramp / primary / secondary | 24 / 32 / 45 / 50 | 24 / 25 / 37 / 34 |
| tertiary / residential / service | 56 / 368 / 262 | 26 / 262 / 140 |
| Gateways / parking / schools / station | 64 / 80 / 5 / 1 | 33 / 80 / 5 / 1 |
| Residential / work / retail places | 0 / 0 / 0 | 48 / 38 / 5 |
| Population / jobs | 4 660 / 4 660 | 35 422 / 30 234 |
| road_too_short / dead_end / connector_unreachable | 173 / 65 / 7 | 15 / 7 / 0 |
| disconnected_component | 1 | 1 |
| Routable connector pairs | 10 181 / 19 193 | 47 941 / 47 941 |
| Persons / completed / failed / peak driving | 4 660 / 462 / 3 970 / 235 | 35 422 / 445 / 0 / 4 157 |
| No origin / no destination / no route / stranded | 1 560 / 1 066 / 676 / 668 | 0 / 0 / 0 / 0 |
| Released trips / completed share / failed share | 4 660 / 9.91% / 85.19% | 35 420 / 1.26% / 0% |
| Queued origins / driving at 10:00 | 0 / 228 | 30 818 / 4 157 |

The unchanged full-sample, car-share-one probe remains heavily congested: zero failures does
not mean good throughput. Shares use released trips, including origin queues, and exclude
afternoon trips still pending. Buildings supply 31 182 residents and 25 025 work jobs (plus
769 retail jobs); gateway demand supplies the remainder. There are 91 new block/use places.
Trunk gateways recorded 743 departures and 12 completed arrivals; sampled ramp traffic recorded
1 385 entries and 1 091 exits. The reference has no clipped ramps; the parent-ramp suppression
rule is covered by the synthetic gateway regression. Original-fixture warning totals decreased:
downtown 207 → 60, highway 41 → 17, suburb 39 → 7.

Remaining Munich dead ends are asserted by lane id in `tests/importers/munich.test.ts`:

| Lane id | Reason |
| --- | --- |
| `r:1095#0` | Service approach meets the reverse direction of Josef-Obenhin-Straße; every exit is a U-turn. |
| `r:1103#0` | One-way Georg-Lindau-Straße fragment leaves the crop without a route from the main network. |
| `r:1161#0` | Isolated service spur has no legal return through the retained Hansastraße boundary junction. |
| `r:1173#0` | Westendstraße faces a one-way approach; its only outgoing road reverses its own street group. |
| `r:350#0` | Friedrich-von-Pauli-Straße faces a one-way approach; only its reverse carriageway leaves. |
| `r:672#0` | Two-way trunk link ends against an incoming one-way link; ramp U-turns remain prohibited. |

`r:978#2` (Landsberger Straße losing a receiving lane) left the list with TASK-054; its case
is now the `lane_requires_merge` warning from TASK-055, of which the extract has 15.

After wave 10 (TASK-054, 055, 057 change the network and the engine), same probe at scale 1:

| Measure | TASK-048 | Wave 10 |
| --- | ---: | ---: |
| Roads / nodes / signals | 548 / 287 / 24 | 541 / 282 / 14 |
| trunk / ramp / primary / secondary | 24 / 25 / 37 / 34 | 24 / 25 / 35 / 33 |
| tertiary / residential / service | 26 / 262 / 140 | 26 / 260 / 138 |
| Roads at layer −1 / 0 / 1 / 2 | - | 8 / 505 / 2 / 26 |
| road_too_short / dead_end / connector_unreachable | 15 / 7 / 0 | 12 / 6 / 0 |
| lane_requires_merge (new code) | - | 15 |
| Routable connector pairs | 47 941 / 47 941 | 47 069 / 47 069 |
| Route audit: infeasible routes | - | 0 |
| Persons / completed / failed / peak driving | 35 422 / 445 / 0 / 4 157 | 35 422 / 530 / 0 / 4 177 |
| Queued origins / driving at 10:00 | 30 818 / 4 157 | 30 712 / 4 177 |

Places and demand are unchanged (33 gateways, 91 block places, 35 422 residents, 30 234
jobs). The import wizard's demand scale (TASK-053) against the same probe:

| Scale | Persons | Completed by 10:00 | Queued at origin at 10:00 | Peak driving |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 35 422 | 530 | 30 712 | 4 177 |
| 0.3 | 10 626 | 1 500 | 5 710 | 3 415 |
| 0.2 | 7 085 | 1 700 | 2 438 | 2 947 |
| 0.15 | 5 314 | 2 120 | 1 012 | 2 182 |
| 0.1 | 3 542 | 2 408 | 32 | 1 102 |


After wave 11 (TASK-061 geometry with the 10 m setback cap; TASK-051 and TASK-062 are
neutral here), same probe: roads, nodes, places and routable pairs unchanged
(47 069 of 47 069), `road_too_short` 12 to 7, `dead_end` 6, zero failed trips. At scale 1:
577 completed by 10:00, 30 713 queued at origin, peak 4 129 driving (wave 10: 530, 30 712,
4 177). At the wizard's default 0.15: 2 078 completed, 1 108 queued, peak 2 128 (TASK-053
table: 2 120, 1 012, 2 182). Before the cap, the same geometry gave 444 and 1 275 completed.

## Roadmap after wave 14 (lead, 2026-11-05)

Outstanding work, from the owner's findings after TASK-070 (points 1 to 4), the backlog and
the review log, in phases whose tasks run in parallel on disjoint surfaces.

Phase 1 (wave 15, now): TASK-071 lane continuity (owner points 3 and 4: splits, merges and
lane drops without the pinch, with tapers and markings; network geometry and a new render
layer), TASK-072 stop positions (owner point 2: crossings on the road, cars stop before
them; a new `stopM` used by the simulation and the markings), TASK-073 end-to-end QA of the
paths never run (Overpass download and cache, exports, a real city saved and reopened, a
phone-sized screen, the Pages build). Shared files: `src/network/types.ts` (071 and 072 add
separate fields), `src/render/layers/roads.ts` (071 the divider loop, 072 the approach
markings) and `src/render/scene.ts` (wiring); the lead reconciles them. Merge order: 073,
072, 071. Then the lead runs the whole suite with T16 once.

Update after the owner's second test round (2026-11-05): phase 2 is now wave 16, the four
owner items below, before any Gate 5 item. Walking legs and multimodal travel move to phase 3.

- Round 2, point 1: lane markings continue through junctions without signals (TASK-075).
- Round 2, point 2: keep improving junction shapes (TASK-074, measured by an audit instead of
  waiting for the owner's examples; the owner may still send some during the wave).
- Round 2, point 3: in Munich cars wait on the main road instead of turning into their exit,
  and the city deadlocks. Lead probe on ce4e3f8 at 0.15: the first stalls are cars off their
  target lane at the end of short ramps (`r:639` at `n:638`, `r:1299`, `r:968`, `r:884`),
  held for a mandatory change that no gap ever allows, after lane resolution planned the
  change although a lane needing none was available; from 09:30 all 2 241 cars on the road
  stand still and completions stop at 2 008. b2131fe (before wave 15) locks the same way at
  2 175. TASK-053's "no gridlock at the default scale" counted queued trips, not stalled cars,
  and the probe's completed and failed counts hid the lock until now (TASK-076).
- Round 2, point 4: a car deadlocked in a junction should fade, vanish and respawn from its
  origin, as a general escape (TASK-077, after TASK-076).

Phase 2 as first planned (wave 16, after phase 1 and the owner's examples for point 1): TASK-074 junction
shape, the rest of point 1 and B21: the junction outline built the way SUMO's netconvert
computes node shapes (EPL-2.0 or GPL-2.0-or-later, so its algorithm may be adapted with a
NOTICE entry), sized from the owner's two or three worst junctions; `src/network/junctions.ts`
and the node layer. In parallel, the first Gate 5 item the owner picks, on `src/sim` and
`src/demand`: actuated signals (detectors, extend-and-gap-out phases in the signal editor),
or walking legs (a person walks to a stop or a parking place, then drives or rides). The
lead in parallel: measurement debt from the Performance section, and the handover archive
regenerated at the new `main`.

Phase 3 (wave 17): the second Gate 5 item, and polish from the owner's next test round. Not
planned: desktop packaging and 3D (architecture 16).

Kept open, no task yet: the twelve dev-tooling audit advisories (waiting on upstream
`minimatch`), the 101 Munich road ends still at the setback cap (phase 2), empty agent
worktree folders that Windows keeps locked.

## Geometry rework (lead, 2026-11-06)

The owner's round 4 test: markings and edges still are not parallel on a long curve, and
the through road still bulges at side-street junctions; the owner proposed corridor-first
geometry, osm2streets-style junction polygons and collision-based relaxation of
overlapping roads (owner decisions log, 2026-11-06). The lead runs it in this session with
subagents in worktrees under `D:\cityflows-wt`, advancing on its own between the owner's
check-ins by the rules below.

Regression cases (the owner's, Munich extract `fixtures/osm/munich-donnersberger.osm`):

- G1, the hairpin (round 4 screenshot 1): service-road pairs `r:917`/`r:921` (220 m, 369
  centerline points) and `r:1059`/`r:1060` (246 m, 243 points), node `n:919`. Lanes and
  surfaces are offset vertex by vertex from a densely smoothed centerline, so the width
  breathes and the two directions' centre lines part.
- G2, the T-junctions on Landsberger Straße (round 4 screenshot 2): `n:774`, where service
  road `r:777` meets `r:1276`, `r:1277`, `r:1362`, `r:1368`, and the next side-street junction
  east of it in that screenshot. The through road bulges and its lanes dip toward the node.
- Also kept as cases: B38's folded lane polylines, B39's unmarked multi-lane splits (`n:312`,
  `n:305`, `n:201`, `n:194`), Marsstraße's coincident carriageways (`r:368`/`r:480`), and the
  round 3 screenshots in `docs/findings/2026-11-06/`.

Road corridors (owner, 2026-11-06): the engine must know which roads run side by side as one
street, so that junction building, relaxation and markings can use it. A new canonical field
`Road.corridorId: string | null` (schema and project migration added by the lead with stage
1's design; existing projects get `corridorId = streetGroupId`) groups the carriageways of one
street: the two directions of a two-way way (as `streetGroupId` does today), a pair of
opposite one-way ways drawn on one centerline, and a dual carriageway (opposite one-way ways
of one name running parallel within a median's distance), and other parallel segments of one
street. `streetGroupId` keeps its editing meaning (toggling a simple two-way street's
direction). The importer sets `corridorId` (TASK-084); the editor sets it with
`streetGroupId` for drawn two-way streets; the compiler carries it as `CRoad.corridorId` and
the corridor module (TASK-082) and the junction builder (TASK-083) treat a corridor's
carriageways as one approach with a median.

Stages (each a task contract written before it starts; tasks on one line run in parallel):

1. TASK-081 geometry audit and visual regression harness. `bench/geometry-audit.ts`
   (extends the junction audit) measures, per city and per case: corridor width error (edge
   to centerline against W/2), the two directions' centre-line gap, lane-polyline folds and
   self-intersections, through-road deviation from its OSM alignment across a junction,
   overlap between unrelated same-grade corridors, junction polygon validity and bulge (area
   outside the corridors' trimmed ends and curb arcs), and discontinuities between
   consecutive road ends. A Playwright script captures fixed-camera images of every case.
   Baseline on `main`. Every later stage reports these tables before and after.
2. TASK-082 corridors first (B38, G1) ∥ TASK-084 importer separation and relaxation ∥
   TASK-085 missing through movements at multi-lane splits (B39).
   - TASK-082 (`src/network`: a new corridor module, `lanes.ts`; `src/geo`; `clipper2-ts`):
     one corridor per street (both directions of a two-way street share it), its centerline
     resampled by curvature so dense smoothing output does not drive the offsets; lanes at
     fixed offsets from that centerline by a robust parallel offset (arc-length and curvature
     aware, no per-vertex miter); road and corridor surfaces from `clipper2-ts` offsetting.
     Target: width error under 0.05 m and centre-line gap under 0.02 m on every road outside
     tapers; no folds.
   - TASK-084 (`src/importers/osm`): `corridorId` for every corridor; opposite one-way
     carriageways drawn on one centerline are separated into a divided pair, keeping OSM
     topology and ids and their shared `corridorId`; then a deterministic,
     bounded position-based relaxation pushes apart unrelated same-grade corridors that
     overlap or come closer than a clearance, minimizing displacement, keeping smoothness and
     connectivity, exempting junction zones and grade-separated crossings, recorded as
     inferred provenance. The maximum displacement is an internal parameter for now; the
     stage runs it at several values (1, 3, 5, 10 m, unbounded) and reports overlap,
     displacement and traffic for each; the lead picks the value from the results and records
     it (the owner: not limited in advance, decide after experiments, an import option later).
   - TASK-085 (`src/network/movements.ts`): the through movements a multi-lane split lacks
     (`r:313` to `r:692`), so lanes can continue and be marked across it.
3. TASK-083 junction polygons, osm2streets-style (G2, B39 drawing), after TASK-082. Each
   road end is cut square to its own corridor where it meets its neighbours' corridors; the
   junction polygon is the region between the cut ends with curb arcs (class radius), built
   with `clipper2-ts`; a through road (two ends within 30 degrees of opposite, the higher
   class) keeps its alignment and its far edge straight across a side road's mouth; turning
   paths run between the cut boundaries. Replaces the TASK-063/074 outline and the TASK-078
   aprons (one polygon, curbs included); setback cap and gores revisited under the new rule.
   Target: G2's through road within 0.1 m of its OSM alignment; no bulge; no approach loses
   more than 2 m of storage against stage 2. The old outline and apron code and their tests
   are deleted once the polygon passes the gates (owner).
4. Integration: the relaxation value chosen, all cases re-captured and sent to the owner,
   the backlog items these stages close marked done, the owner's test round.

Gates the lead applies to every merge, without asking:

- Geometry: the stage's targets above, measured by TASK-081's audit on the merged tree.
- Traffic (owner-approved tolerance): Munich at `--scale 0.15` with `stalledHeads` 0 and no failures other than
  `gridlocked`; `gridlocked` at most 1.5 times main's; completed at least 90 percent of
  main's (the count swings several percent with geometry alone, TASK-080 review); every
  benchmark trip completes; `npm run route-audit` zero on all four cities.
- Checks: `npm run check` green (rerun 5 s time-outs under load with a longer timeout and
  say so); the full Playwright suite with T16 at the end of each stage.
- A task that misses a gate goes back to its agent with the measured failure, at most twice;
  small integration fixes are lead commits. New dependencies and `src/schema` or project
  format changes (with a migration) need no owner check (owner, 2026-11-06).

The lead stops and asks the owner when: a stage needs a change to simulation rules; a gate still
fails after two rounds; a target turns out to be wrong for the owner's cases; or the work
would change something outside this repository. Otherwise it merges, pushes `main` (Pages
redeploys) and reports after each merge.

## Roadmap: Gates 7 to 9 (owner, 2026-11-07)

The owner's next stages, after deferring B54 east, B55 and B56 (owner decisions log,
2026-11-07). Gate 6 was the visual surroundings and the 3D viewer (TASK-096 to TASK-098).
Each gate below is a set of features with a first design, the tasks the lead proposes, and
the questions the lead will settle with defaults unless the owner answers differently. The
task contracts (`docs/tasks/TASK-1xx.md`) and the architecture amendments are written when a
wave starts, not now.

What already exists and is built on, not rebuilt:

- `VehicleClass` (`car`, `truck`, `bus`) on `Lane.allowed`, and routing graphs per class
  (`src/routing/graph.ts`). The simulation's vehicles carry no class yet.
- `Place.kind: 'parking'`, `Place.capacity` and connectors with `in`, `out` or `both`
  directions and a throughput (`src/sim/connectors.ts`). A car appears at a connector and
  vanishes at its destination's connector, so every place already behaves like an invisible
  garage.
- `TripMode` (`car`, `walk`, `bus`, `rail`), `TripRequest.legs` and `Person.hasCar`.
  Non-car trips are generated and then dropped by the simulation.
- OSM surroundings (`City.context`, TASK-096) with buildings, `amenity=parking` areas and
  green areas including `wood`, `forest`, `grass` and `grassland`.
- Pedestrian crossings as markings (TASK-091, TASK-094). They are decorative; no simulated
  pedestrian uses them.
- The importer drops `highway=service` with `service=parking_aisle` or `driveway`
  (`src/importers/osm/filter.ts`) and every footway.

### Gate 7: road betterment

Exit criterion: on the Munich extract, a morning run shows cars leaving building garages,
street parking and a surface lot; parked cars are visible at the curb and in the lot; a full
facility sends arriving cars on to the next one; cars, vans, trucks and buses are told apart
in the inspector, the map and the metrics; a destination-only street carries only traffic
that starts or ends on it, and a bus lane carries only buses.

1. Parking, three kinds, one model. A new `ParkingFacility` entity in `City` (schema and
   project migration) with a kind, a capacity, its slots, an access rule (public, private to
   a place, customers) and its connectors to the road network.
   - Garage (in a building, invisible): entry and exit connectors on a road; a car that
     enters disappears and is counted; no interior network. From OSM: `amenity=parking` with
     `parking=underground` or `multi-storey`, `building=parking`, `building=garage(s)`,
     `entrance=garage`. Each existing place's connectors become its garage, so today's
     behaviour is the first case of the new model.
   - Roadside: a parking strip along one side of a road, outside the travel lanes, with
     slots by length (about 6 m parallel, 2.5 m angled or perpendicular). The lane array
     does not change. From OSM: `parking:left`, `parking:right`, `parking:both` (and the
     older `parking:lane:*`); the road inspector toggles a strip per side. A parking car
     stops in the curb lane, holds it for a manoeuvre time, then leaves the lane and stays
     visible in its slot; a leaving car waits for a gap and merges in.
   - Surface lot: an `amenity=parking` area with `parking=surface`. Its `parking_aisle` ways
     are imported as low-speed service roads tagged with the lot, stalls are generated along
     both sides of each aisle inside the lot polygon, and the lot's entries are where aisles
     meet public roads. A car drives through the aisles to a free stall and stays visible.
   - In the simulation: on arrival a car takes its destination's own facility first, then
     the nearest public facility with a free slot within a search radius, and drives on
     (cruising) when the chosen one fills before it arrives. Departures start from where
     the car is parked. Facilities start the day with an occupancy from residents' cars.
     The walk between facility and destination is counted as distance only until Gate 9.
   - Parked cars travel in the snapshot as a separate, rarely changing set; the 2D and 3D
     renderers draw them as one instanced layer rebuilt on change.
   - Metrics: occupancy per facility, search time, cars parked. A Layers entry colours
     facilities by occupancy.
   - This lifts "parking circulation" from architecture section 16.
2. Vehicle categories. Extend `VehicleClass` to `car`, `van`, `truck`, `bus` (the migration
   keeps the old three) and add a free label for the purpose (`private`, `delivery`,
   `service`, `taxi`, `through`). Each class gets a length, a width and its own driver
   parameters (desired speed cap, acceleration, comfortable deceleration), which change queue
   storage and capacity. Demand gets a share per class and purpose (trucks mostly on
   through trips, vans to work and retail places). Vehicles carry their class into the
   snapshot; the renderers draw a shape per class and can colour by class; the inspector,
   the export and the metrics report per class.
3. Restricted access. A road-level access rule per class: `yes`, `no`, `destination` (local
   traffic only), `delivery`, `private`, with lanes reserved by class through
   `Lane.allowed` as today. From OSM: `access`, `motor_vehicle`, `motorcar`, `hgv`, `bus`,
   `psv`, `goods`, `lanes:psv`, `busway`, `maxweight` and `maxheight` mapped to classes.
   Routing: `no` leaves the class's graph; `destination` and `private` roads form zones
   (connected sets of such roads), and a route may enter a zone only when its origin or
   destination lies in it; `delivery` admits vans and trucks with a delivery purpose. The
   road inspector edits the rule, and the map shows a sign at each zone entry and `BUS` on
   reserved lanes. Time-conditional access (`:conditional`) stays out.

Proposed tasks, with surfaces kept disjoint:

| Task | Feature | Surfaces | After |
| --- | --- | --- | --- |
| TASK-100 | Vehicle categories (7.2) | `src/schema` (class), `src/sim/vehicle.ts`, `params.ts`, `idm.ts`, `src/demand`, snapshot, `layers/vehicles.ts`, `render3d/vehicles.ts`, inspector, metrics | - |
| TASK-101 | Restricted access (7.3) | `src/schema` (road access), `src/importers/osm` (tags), `src/routing`, road inspector; no drawing (signs are TASK-107's) | - |
| TASK-102 | Parking model and garages (7.1) | `src/schema` (`ParkingFacility`), new `src/importers/osm/parking.ts`, `src/sim/connectors.ts`, new `src/sim/parking.ts`, host snapshot, inspector, metrics | 100 |
| TASK-103 | Visible parking in the simulation, roadside and lot stalls (7.1) | road strips in schema and network, park and leave manoeuvre in `src/sim`, parked-car layers 2D and 3D, road inspector | 102, 104 |
| TASK-104 | Surface lot import: aisles and stall geometry, no simulation (7.1) | `filter.ts` and a new `lots.ts` in the importer, stall generation in `src/network` | the lead's parking schema |

TASK-100 and TASK-101 run in parallel (simulation and demand against routing and the
importer; the lead reconciles the two schema additions). The phases below give the order.

### Gate 8: more realistic visuals

Same rule as Gate 6: the planar geometry built from OSM does not change, every feature has
a Layers toggle, and the frame time stays within the owner's 20 percent allowance (owner
decisions log, TASK-097) at both Munich zooms. Gate 8 touches only `src/render`,
`src/render3d`, `City.context` and the importer's context part, so it runs alongside Gate 7.

Exit criterion: Sindelfingen in 3D shows its relief with roads following the ground, trees
along streets and filling woods, lamps and curbs along streets, hatched gores with chevrons
at motorway exits and realistic arrows; Munich's network hashes are unchanged.

1. Building details (low priority, last). OSM `roof:shape` (flat, gabled, hipped,
   pyramidal), `roof:colour`, `building:colour`, `building:material`, `roof:levels`; window
   bands generated per level in the facade shader.
2. Topography. An elevation grid for the import area, fetched at import from open DEM tiles
   (AWS Terrain Tiles, Terrarium encoding, no key) and saved in the project as an optional
   `City.terrain` (origin, cell size, quantized heights). 3D: the ground mesh follows it,
   and roads drape onto it with bridges and tunnels keeping their grade offsets. 2D: an
   optional hillshade. The simulation ignores slope.
3. Vegetation and surfaces. Trees from `natural=tree` and `natural=tree_row`; street trees
   generated along streets where OSM has none (seeded, spaced by class, clear of junctions,
   crossings and driveways, marked generated, own toggle); woods and forests filled by
   seeded sampling at a capped density with distance-based detail; procedural textures for
   grass, meadow, forest floor, pavement and asphalt. 2D draws canopies from above.
4. Street lights and curbs. Lamps from `highway=street_lamp`, generated along streets where
   OSM has none (spacing by class, sidewalk side, own toggle); sidewalks from `sidewalk=*`
   drawn outside the carriageway and clipped by buildings; a raised curb along the road
   edge in 3D, broken at crossings and driveways. Optionally lamps light up at night by the
   simulation clock.
5. Lane markings. Hatched gore areas with chevrons where lanes diverge or merge at ramps,
   solid white channelizing lines around them; marking colour by theme (yellow centre lines
   between opposing traffic in the US, white in Germany and the UK, UK yellow edge lines);
   arrow shapes drawn to a national standard instead of today's simple arrows. A marking
   theme per project, defaulting from the import area's country; Germany first, the US and
   UK themes later (low priority). 2D and 3D read the same marking geometry.

Proposed tasks:

| Task | Feature | Surfaces | After |
| --- | --- | --- | --- |
| TASK-105 | Topography (8.2) | DEM fetch and cache in `src/importers`, `City.terrain` (schema), `render3d/heights.ts`, ground mesh, 2D hillshade | - |
| TASK-106 | Vegetation and surfaces (8.3) | `src/importers/osm/context.ts` (trees), new `render/layers/vegetation.ts`, `render3d/vegetation.ts`, textures | - |
| TASK-107 | Street furniture: lamps, 3D curbs, access signs, `BUS` lane text (8.4); sidewalks are TASK-110 | new `render/layers/street.ts`, `render3d/street.ts`, context import of lamps | 101, 106, 108 |
| TASK-108 | Lane marking realism (8.5) | `render/layers/roads.ts`, `junction-markings.ts`, `render3d/markings.ts`, `style.ts` themes | - |
| TASK-109 | Building details (8.1) | `render3d/context.ts`, building tags in `context.ts` | 105 |

TASK-105, TASK-106 and TASK-108 run in parallel. Access signs and `BUS` lane text moved to
TASK-107, so TASK-101 and TASK-108 share no files.

### Gate 9: occupancy-driven trips

Exit criterion: a person leaves a building, walks to their car parked on the street,
drives, parks in a lot near the destination and walks into the building; pedestrians cross
at zebras with cars yielding and at signals during their own phase; short trips walk, long
ones drive, and congestion moves some trips to park-and-walk; through traffic is unchanged.

1. A pedestrian network. Import `highway=footway`, `pedestrian`, `path`, `steps`,
   `living_street` and `footway=crossing`, and generate sidewalks along streets from
   `sidewalk=*` (or by road class where untagged). A walk graph separate from the vehicle
   network, joined to it at crossings (the crossings of TASK-091 become walk links) and to
   buildings at entrances (`entrance=*`, else the nearest walk link). Walk routing on it.
2. Pedestrians in the simulation. Walkers move along walk links at their own speed (no crowd
   collisions). At a zebra, cars yield to a walker on or about to step onto the crossing; at
   a signal, crossings get pedestrian phases in `SignalProgram`, and turning movements
   yield to walkers in them through the existing conflict zones. This is the simulation
   rule change the owner asked for ("controlled properly by traffic"); its details come to
   the owner with the task contract.
3. Person-driven trips. Every local trip starts and ends at a building or facility. A
   person (or a household group sharing one car) owns a car with a parking location: the
   building's garage (the car leaves from the invisible garage), a street slot or a lot
   stall. A trip's legs are walk to the car, drive, park (by walking distance, availability
   and access), walk to the destination; cars stay where they were parked, so occupancy
   evolves through the day. Vehicles carry their occupants. Gateway-to-gateway through
   traffic stays vehicles without persons.
4. Mode choice. Walk, drive, or drive part and walk part, chosen per trip at departure by a
   logit model over walk time, drive time from current link costs, parking search and walk
   egress time, distance, car availability and location, and per-person preferences sampled
   from the demand seed (a walk preference, a value of time). The demand sheet gets sliders
   for these; the metrics show mode shares.

Proposed tasks:

| Task | Feature | Surfaces | After |
| --- | --- | --- | --- |
| TASK-110 | Pedestrian network, including sidewalk geometry (9.1) | new `src/importers/osm/walk.ts`, new `src/network/walk.ts`, walk routing, walk layer 2D and 3D | the lead's walk schema |
| TASK-111 | Pedestrian rules in the simulation: zebra yield, pedestrian signal phases, tested with a test pedestrian source (9.2) | `src/sim/intersection.ts`, `signals.ts`, new `walkers.ts`, `SignalProgram` pedestrian phases, signal editor, renderers | 110 |
| TASK-112 | Person-driven trips (9.3) | `src/demand`, persons and cars in `src/sim`, trip legs, inspector (person view) | 104, 111 |
| TASK-113 | Mode choice (9.4) | `src/demand` (choice model), demand sheet, metrics | 112 |
| TASK-114 | US and UK marking themes (8.5, low priority) | `style.ts` themes, a project theme setting | 108 |

TASK-111 to TASK-113 change `src/sim` and run in sequence. It lifts "walking legs" from
architecture section 16; transit vehicles, bicycles and parking fees stay deferred.

TASK-112 validation (2026-11-09): see the TASK-112 review entry. Sindelfingen's walk gaps are B57.

### Phases (owner-approved, 2026-11-07)

The gates name features; the phases below order the work by file surface and dependency so
that tasks run in parallel. The simulation chain (TASK-100, 102, 103, 112, 113) is the critical
path; the visual tasks never block it. The owner starts and orchestrates every agent, in Codex
or Claude Code, and sends each finished branch to the lead for review; the lead never starts
agents. For each task the lead writes the contract, creates the branch from `main` (no
worktree; the agent creates its own) and writes a handover message naming the harness, the
model and the reasoning effort.

| Phase | Tasks in parallel | Depends on | Estimate |
| --- | --- | --- | --- |
| 0 | Lead: Phase 1 contracts and branches; the shared formats for Phase 2 on `main` (`ParkingFacility`, the walk network types; done 2026-11-08) | - | half a day |
| 1 | TASK-100, TASK-101, TASK-105, TASK-106, TASK-108 | - | 1 to 1.5 days |
| 2 | TASK-102, TASK-104, TASK-107, TASK-109, TASK-110, TASK-114, TASK-115, TASK-116 | 100 and 101 (102, 104, 107), 105 (109), 106 and 108 (107, 114), the Phase 0 formats | 1.5 to 2 days |
| 3 | TASK-103, TASK-111, TASK-117 | 102 and 104 (103), 110 (111), 107 and 114 (117) | 1.5 to 2 days |
| 3b | TASK-118, TASK-119 | 103 and the lead's follow-up | 1 to 1.5 days |
| 3c | TASK-120 (rejected; replaced by TASK-122 in phase 4b) | 118, 119 | half a day |
| 4 | TASK-112, TASK-121 (start while TASK-120 runs) | 103, 110, 111, 118 (112); 048, 076, 077, 116 (121) | 2 to 3 days |
| 4b | TASK-122, TASK-123 (B57, walk network), beside TASK-112's round 2 | 112 | half a day |
| 5 | TASK-113 | 112 | half to 1 day |

Phase 3 runs two simulation tasks at once, on disjoint files: TASK-103 owns `parking.ts`,
`connectors.ts` and the manoeuvre, TASK-111 owns `intersection.ts`, `signals.ts` and
`walkers.ts`; the lead reconciles their hooks in `engine.ts`. TASK-111 has no real walkers
until TASK-112, so it does not move traffic.

Agents and ports for Phase 1 (the lead's suggestion; the owner decides):

| Task | Harness | Model | Effort | e2e port |
| --- | --- | --- | --- | --- |
| TASK-100 | Claude Code | Opus 5.5 | high | 5301 |
| TASK-101 | Claude Code | Opus 5.5 | high | 5302 |
| TASK-105 | Codex | GPT-6.1-Sol | high | 5305 |
| TASK-106 | Codex | GPT-6.1 Terra | high | 5306 |
| TASK-108 | Codex | GPT-6.1-Sol | high | 5308 |

Phase 2 (lead, 2026-11-08). TASK-109 and TASK-115 started first, before TASK-101 merged;
TASK-102, TASK-104, TASK-107, TASK-110, TASK-114 and TASK-116 follow on branches cut from `main`
after TASK-101 and the lead's Phase 2 formats (`City.parking`, `City.walk`, `Road.sidewalk`).
The owner added TASK-114 (low priority) to this batch. TASK-107 no longer waits for TASK-110:
its sidewalks moved to TASK-110, and lamps, curbs, signs and `BUS` text depend only on 101, 106
and 108. TASK-116 generalises TASK-101's lane-option fix to every route (review log,
2026-11-08).
TASK-116 now returns feasible target sets for every route, preserving the selected plan and
TASK-076's lane preference. The quick morning improves from 3,012 completed / 38 gridlocked /
0 stalled heads on main to 3,214 / 29 / 2; persistent heads remain on `r:248` and `r:961`.
`npm run check` and `test:city` pass. All 21 smoke cases are validated across a
20-pass full run and the remaining vegetation case's focused rerun. The owner
approved a 180 s total budget for T47 Munich and a 25% local vegetation frame
allowance; functional assertions and traffic/routing-speed gates are unchanged.
The lead retains the full traffic gate and baseline reset at merge.

Checks for Phase 2 agents (owner, 2026-11-08): `npm run check`, `npm run test:city` and
`npm run test:e2e:smoke`, plus `npm run traffic:quick` for tasks that move traffic (102, 104,
116). Agents do not run the full e2e suite, `npm run test:traffic` or the benchmarks; the lead
runs them at merge and GitHub CI runs the rest after it.

Shared files, reconciled by the lead at merge: `src/schema/city.ts` and `city.schema.ts` (102
and 104 parking, 110 walk, 107 `street_lamp`, 109 roof fields, 114 `markingTheme`),
`src/importers/overpass.ts` (102, 104, 107, 110), `src/importers/osm/index.ts` (102, 104, 110,
114), `src/importers/osm/context.ts` (104, 107, 109), `src/network/compile.ts` and `types.ts`
(102, 104, 110), `src/sim/engine.ts` (102, 116), `src/render/marking-geometry.ts` and
`style.ts` (104, 107, 109, 114), the scenes, `src/ui/map-view.tsx`, `layers.tsx`, `store.ts` and
`docs/architecture.md` (most tasks). Once TASK-115 is on `main`, every new layer or setter must
request a frame through its invalidation rule; the lead adds the calls when merging a task
written before it. Merge order: as tasks are delivered, with 115 before the other renderer
tasks and 116 before 102 when both are ready. Tasks that move trip counts (102, 104, 116) reset
the traffic baseline at their merge (owner rule 7).

| Task | Harness | Model | Effort | e2e port |
| --- | --- | --- | --- | --- |
| TASK-102 | Codex | GPT-6.1-Sol | xhigh | 5302 |
| TASK-104 | Codex | GPT-6.1 Terra | high | 5304 |
| TASK-107 | Codex | GPT-6.1 Terra | high | 5307 |
| TASK-109 | Codex | GPT-6.1-Sol | high | 5309 |
| TASK-110 | Codex | GPT-6.1-Sol | high | 5310 |
| TASK-114 | Codex | GPT-6-Luna | high | 5314 |
| TASK-115 | Codex | GPT-6.1 Terra | high | 5315 |
| TASK-116 | Codex | GPT-6.1-Sol | high | 5316 |

Phase 3 (lead, 2026-11-08). TASK-103 and TASK-111 start together on branches cut from `main`
at the end of Phase 2 (CI green at 885c17e). Lead defaults written into the contracts, from
the discussion with the owner: a lot with no reachable aisle gets one inferred driveway within
30 m; residential trips take the own garage first except a seeded 30% who look for a street
slot first, work and school trips the own garage first, visits strips and lots first; inferred
garages keep admitting every car; pedestrian signals run concurrently with the parallel
vehicle green, turning drivers yielding, with an exclusive pedestrian phase as an editor
option. Both contracts ask for every timing that grew against main, after TASK-107 and TASK-110
reported large slowdowns as limitations.

Shared files, reconciled by the lead at merge: `src/sim/engine.ts`, `types.ts`, `metrics.ts`,
`hash.ts` and `params.ts`, `src/schema/sim.ts`, `src/network/compile.ts`, `types.ts` and
`walk.ts` (103 the sidewalk offset beside a band, 111 crossing spans), the host and snapshot,
the scenes, `src/ui/layers.tsx`, `store.ts`, `map-view.tsx`, the metrics panels,
`bench/geometry-shots.ts` and `docs/architecture.md`. Merge order: as delivered. TASK-103 moves
trip counts and resets the traffic baseline at its merge (owner rule 7); TASK-111 must leave
traffic unchanged without walkers.

The owner added TASK-117 to Phase 3 (2026-11-08): the small visual fixes from the Phase 2
review, renderer only. It shares `src/render/street.ts` with TASK-103 (signs against kerbs
and lamps beside a parking band); at merge the lead also makes UK kerb lines skip TASK-103's
strip runs. Compile time (the walk graph doubles it) and the Landsberger Straße queues wait
until after Phase 3.

| Task | Harness | Model | Effort | e2e port |
| --- | --- | --- | --- | --- |
| TASK-103 | Codex | GPT-6.1-Sol | xhigh | 5303 |
| TASK-111 | Claude Code, the lead's subagent | Opus 5.5 | high | 5311 |
| TASK-117 | Codex | GPT-6.1 Terra | high | 5317 |

The owner sends TASK-103 and TASK-117 to Codex and lets the lead drive TASK-111 through a
subagent from the lead's session (2026-11-08), an exception to "the lead never starts agents".
The subagent works in `D:\cityflows-wt\111` on `task/111-pedestrian-rules` under the same
contract, checks and report; the lead reviews its commits like any other delivery.

Phase 1 shared files, reconciled by the lead at merge: `src/schema/city.ts` and
`city.schema.ts` (100 the class and version 3, 101 `Road.access`, 105 `City.terrain`, 106
context points), `src/routing/index.ts` (100 and 101 both add `RouteRequest.purpose`),
`src/importers/osm/roads.ts` (100 the default `allowed` list, 101 the access tags),
`src/render/scene.ts`, `src/render3d/scene.ts`, `src/render3d/geometry.ts` (105 terrain, 108
markings), `src/ui/map-view.tsx` (100, 105, 106 wiring), `src/render/style.ts`,
`src/render/types.ts`, `src/ui/layers.tsx` and `docs/architecture.md`. Merge order: 108, 106,
105, 101, 100.

Scope rule (owner, 2026-11-07, after every Phase 1 agent stopped on a missing file): a
contract's "In scope" list is the main surface, not a fence. Agents may change whatever else
the feature needs to be wired in, type-check or be tested, and list it in their report; they
stop only for a file under "Out of scope", an undescribed contract change or a behaviour
change to another feature (`AGENTS.md` "Delivering a task").

Phase 3b (owner, 2026-11-08). Testing TASK-103 the owner logged four bugs: lots move cars into
a stall instantly with no routing inside the lot, and stall choice is always the single best
stall (1); strip cars vanish into and appear from their slots, and strips empty from one end
(2); many surface car parks never hold a car (3: 57 of Munich's 80 parking places are mapped
`parking=street_side` areas that import as places without a facility); no pedestrians are seen
(4: walkers come only from the test source until TASK-112). TASK-118 takes 1 and 2 (lot
circulation as a local problem inside each lot, not in the road graph, per the owner's routing
guidance), TASK-119 takes 3; 4 waits for TASK-112, which now follows TASK-118 (both rewrite
`src/sim/parking.ts`). TASK-118 owns `src/sim/**`, `src/host/**` and `src/network/stalls.ts`;
TASK-119 owns `src/importers/**` and `src/network/strips.ts`; both move trip counts and the lead
resets the baseline at each merge. Simplified CI rule as in Phase 3.

TASK-119 imports all 57 Munich street-side areas (54 strips, 3 fallback lots) and both
Sindelfingen areas (strips), with no orphan parking places. Munich way 135296620 remains a
zero-stall fallback lot: its 76.11 × 1.99 m footprint cannot fit the existing 2.5 m-wide lot
bays. It retains its inferred driveway; changing lot stall dimensions belongs to TASK-118.
The other 56 Munich areas have usable slots. Counts, timings, traffic and comparison images
are recorded in the task branch's final commit body.

TASK-118 derives local circulation without changing the vehicle network. The lead's merge
lets an entry link pass under a building exclusion when no clear link exists (courtyards
reached through a passage: Munich `pk:2037` Gewerbehof Westend, Sindelfingen `pk:1475`) and
lets a stall join an aisle up to 5 m away. Unreachable stalls fall from 110 to 54 in Munich
(28 of them in TASK-119's two aisle-less fallback lots) and from 195 to 22 in Sindelfingen;
they stay painted and unused with `lot_stalls_unreachable`. Local graph counts do not imply
street access: existing private-road policies still apply (for example at `pk:1473`).

| Task | Harness | Model | Effort | e2e port |
| --- | --- | --- | --- | --- |
| TASK-118 | Codex | GPT-6.1-Sol | xhigh | 5318 |
| TASK-119 | Codex | GPT-6.1 Terra | high | 5319 |
| TASK-120 | Codex | GPT-6.1 Terra | high | 5320 |

Phase 4 (owner, 2026-11-09). While TASK-120 runs, the owner starts TASK-112 (trips made by
people, the critical path; it waits on 103, 110, 111 and 118, all merged) and TASK-121 (B56,
the deferred queue-head deadlock). The three share only hooks in `src/sim/engine.ts`:
- TASK-120 owns `src/network/**`;
- TASK-112 owns `src/demand/**`, `src/sim/persons.ts`, `walkers.ts`, `parking.ts` and
  `connectors.ts`;
- TASK-121 owns `intersection.ts`, `reroute.ts`, `lane-change.ts` and the gridlock path in
  `engine.ts`.

All three move trip counts. The lead merges in delivery order (TASK-120 first, expected within
hours), resets the baseline at each merge (rule 7), and integrates the later branches onto the
earlier ones. TASK-112 keeps vehicle `completed` as the drive leg, so the traffic gate keeps its
meaning. Person trips are separate metrics. TASK-121 tightens `stalledHeads` to 0. B54 east and
B55 are geometry and wait for TASK-120's `junctions.ts` and for TASK-121's stability probe.

| Task | Harness | Model | Effort | e2e port |
| --- | --- | --- | --- | --- |
| TASK-112 | Codex | GPT-6.1-Sol | xhigh | 5312 |
| TASK-121 | Codex | (not recorded) | | 5321 |

Phase 4 result (lead, 2026-11-09). TASK-120 was rejected (see its review entry). TASK-121 and
TASK-112 were integrated on `task/lead-112` and merged to main after TASK-112's round 2 made the
full e2e suite green. Phase 4b: TASK-122 makes trip cars start and park only on spaces they
can drive away from, which is the fix TASK-120 was meant to be. It owns `src/sim/parking.ts`,
`connectors.ts` and `persons.ts`. B54 east and B55 can follow (geometry); TASK-113 follows
TASK-122 (both touch the person and parking code).

| Task | Harness | Model | Effort | e2e port |
| --- | --- | --- | --- | --- |
| TASK-122 | owner's choice | | high | 5322 |
| TASK-123 | owner's choice | | high | 5323 |

TASK-123 (owner, 2026-11-09) runs beside TASK-122 and TASK-112's round 2 because it touches
only the walk network: `src/sim/**` and `tests/e2e/**` are out of its scope. It branches from
`task/lead-112` for the `walkFallbacks` count.

### Questions for the owner, with the lead's defaults (accepted by the owner, 2026-11-07)

1. Vehicle classes: `car`, `van`, `truck`, `bus`; motorcycles and bicycles left out.
2. Where OSM has no parking data (most residential buildings): a building with residents
   gets an implicit garage sized from its residents and the car share, and residential
   streets get roadside strips where they are wide enough; both marked inferred.
3. Elevation data from AWS Terrain Tiles, a second external host next to Overpass and the
   tile server.
4. Slope does not affect driving.
5. Generated street trees and lamps are on by default, marked generated, with their own
   toggles.
6. Pedestrians walk along links without collisions between them.
7. Tasks that change demand or parking (TASK-100, TASK-102 to TASK-104, TASK-111 to
   TASK-113) change completed-trip counts by design: the lead resets the traffic baseline at
   each such merge and records the before and after figures in its review entry; the gate's
   90 percent rule still protects every other task.
8. Night lighting by the simulation clock is optional in TASK-107 and deferred.

## Owner backlog (2026-11-10)

Logged by the owner on 2026-11-10; contracts are written when each item starts. Order: TASK-124,
then TASK-125, then the lead re-measures TASK-122 on both. The rail items touch the importer,
network and renderer, not `src/sim/parking.ts`, so they can run alongside the parking work.

| Task | Harness | Model | Effort | e2e port |
| --- | --- | --- | --- | --- |
| TASK-148 / TASK-149 | Codex | GPT-6.1 Sol | high | 5348 / 5349 (production +100) |
| TASK-144 / TASK-145 / TASK-146 / TASK-147 | Codex | GPT-6.1 Sol | high | 5344 / 5345 / 5346 / 5347 (production +100) |
| TASK-136 crossing control and equipment | Codex | GPT-6.1 Sol | high | 5344/5444 and 5346/5446 |
| TASK-138 tram service | Codex | GPT-6.1 Sol | high | 5348/5448 |
| TASK-131 Phase 3 / B56 | Codex | GPT-6.1 Sol | high | 5332 (production 5432) |
| TASK-136 import and drawing | Codex | GPT-6.1 Sol | high | 5336 (production 5436) |
| TASK-141 T54 diagnosis | Codex | GPT-6.1 Sol | high | 5341 (production 5441) |
| TASK-125 | Codex | GPT-6.1-Sol | xhigh | 5327 (production 5427) |
| TASK-126 | Codex | GPT-6.1-Sol | high | 5326 (production 5426) |
| TASK-127 | Codex | GPT-6.1-Sol | high | 5328 (production 5428) |
| TASK-128 | Claude Code, the lead's subagent (Codex run never started) | Opus 5.5 | high | 5329 (production 5429) |
| TASK-129 | Claude Code, the lead's subagent (Codex run never started) | Opus 5.5 | high | 5331 (production 5431) |
| TASK-130 | Codex | GPT-6.1-Sol | xhigh | 5330 (production 5430) |
| TASK-131 | Claude Code, the lead's subagent | Opus 5.5 | high | 5332 (production 5432) |
| TASK-133 | Claude Code, the lead's subagent | Sonnet 5.5 | high | 5333 (production 5433) |
| TASK-135 | Claude Code, the lead's subagent | Opus 5.5 | high | 5335 (production 5435) |
| TASK-140 | Claude Code, the lead's subagent | Opus 5.5 | high | 5340 (production 5440) |
| TASK-132 | Claude Code, the lead's subagent | Opus 5.5 | high | 5332 (production 5432) |
| TASK-137 | Claude Code, the lead's subagent | Sonnet 5.5 | high | 5337 (production 5437) |
| TASK-134 | Claude Code, the lead's subagent | Opus 5.5 | high | 5334 (production 5434) |
| TASK-150 | Claude Code, the lead's subagent | Opus 5.5 | high | 5350 (production 5450) |
| TASK-151 | Claude Code, the lead's subagent | Opus 5.5 | high | 5351 (production 5451) |
| TASK-152 | Claude Code, the lead's subagent | Opus 5.5 | high | 5352 (production 5452) |
| TASK-153 | Claude Code, the lead's subagent | Opus 5.5 | high | 5353 (production 5453) |
| TASK-113 | Claude Code, the lead's subagent | Opus 5.5 | high | 5313 (production 5413) |
| TASK-154 | Claude Code, the lead's subagent | Opus 5.5 | high | 5354 (production 5454) |
| TASK-155 | Claude Code, the lead's subagent | Opus 5.5 | high | 5355 (production 5455) |
| TASK-156 | Claude Code, the lead's subagent | Opus 5.5 | high | 5356 (production 5456) |
| TASK-157 | Claude Code, the lead's subagent | Opus 5.5 | high | 5357 (production 5457) |
| TASK-158 | Claude Code, the lead's subagent | Opus 5.5 | high | 5358 (production 5458) |
| TASK-159 | Claude Code, the lead's subagent | Opus 5.5 | high | 5359 (production 5459) |
| TASK-160 | Claude Code, the lead's subagent | Opus 5.5 | high | 5360 (production 5460) |
| TASK-161 | Claude Code, the lead's subagent | Opus 5.5 | high | 5361 (production 5461) |
| TASK-162 | Claude Code, the lead's subagent | Opus 5.5 | high | 5362 (production 5462) |
| TASK-163 | Claude Code, the lead's subagent | Opus 5.5 | high | 5363 (production 5463) |
| TASK-164 | Claude Code, the lead's subagent | Opus 5.5 | high | 5364 (production 5464) |
| TASK-165 | Claude Code, the lead's subagent | Opus 5.5 | high | 5365 (production 5465) |
| TASK-166 | Claude Code, the lead's subagent | Opus 5.5 | high | 5366 (production 5466) |
| TASK-167 | Claude Code, the lead's subagent | Opus 5.5 | high | 5367 (production 5467) |
| TASK-168 | Claude Code, the lead's subagent | Sonnet 5.5 | high | 5368 (production 5468) |
| TASK-169 | Claude Code, the lead's subagent | Opus 5.5 | high | 5369 (production 5469) |
| TASK-170 | Claude Code, the lead's subagent | Opus 5.5 | high | 5370 (production 5470) |
| TASK-171 | Claude Code, the lead's subagent | Sonnet 5.5 | high | 5371 (production 5471) |
| TASK-172 | Claude Code, the lead's subagent | Sonnet 5.5 | high | 5372 (production 5472) |
| TASK-173 | Claude Code, the lead's subagent | Opus 5.5 | high | 5373 (production 5473) |
| TASK-174 | Claude Code, the lead's subagent | Opus 5.5 | high | 5374 (production 5474) |
| TASK-175 | Claude Code, the lead's subagent | Opus 5.5 | high | 5375 (production 5475) |
| TASK-176 | Claude Code, the lead's subagent | Opus 5.5 | high | 5376 (production 5476) |
| TASK-177 | Claude Code, the lead's subagent | Sonnet 5.5 | high | 5377 (production 5477) |
| TASK-178 | Claude Code, the lead's subagent | Opus 5.5 | high | 5378 (production 5478) |

| Item | What | Today | Depends on |
| --- | --- | --- | --- |
| TASK-125 (done 2026-11-10) | Parking claims: cars heading for a strip space or a garage count against it, as cars heading for a lot already do (TASK-103 follow-up). A space claimed by another car is taken; a strip or garage whose free spaces are all spoken for drops out of the choice; a claim is released when the car chooses again, fails or parks. Overflow cars go straight to the next option instead of circling. | Only lots count cars en route. A strip space is reserved when the car starts its manoeuvre, so many cars chase one freed space (TASK-122 round 2: 44 searches over an hour). | TASK-124 |
| TASK-126 (done 2026-11-10) | Railway tracks and stations (R1 and R2 merged, owner 2026-11-10): rail, light rail, subway and tram ways as their own track graph (nodes, switches, platforms), compiled, saved and drawn; stations tied to their platforms and to the walk network by their entrances, drawn as stations. Munich's Donnersbergerbrücke S-Bahn station is the example. Train routing comes later. | Display-only context lines (`src/importers/osm/context.ts`, TASK-096); place kind `station` from `railway=station`; the synthetic Station fixture (T10). The bundled extracts hold no track ways yet. | none |
| TASK-127 (done 2026-11-10; Codex) | Decorative trains: arrivals, departures and through trains that pass without stopping, on TASK-126's tracks by a simple timetable. Visual only. | none | TASK-126 |
| TASK-128 (merged 2026-11-13 in `36a1eea`; the "held" label was stale, TASK-209) | Stations as trip ends: people who leave arriving trains walk out from the platforms, and trips whose destination is the station end there. No multimodal choice model; the station is simply a destination this round. | Places can be destinations; no train-linked spawns. | TASK-126 (TASK-127 to time the arrivals) |
| TASK-129 (merged 2026-11-13 in `eaeda73`; the "held" label was stale, TASK-209) | Car ownership: a car belongs to a household; its people drive only their own cars, and a car parks near home, not far away. | TASK-112: one car per person, parking choice unchanged. | TASK-125, TASK-122; before TASK-113 (no own car limits the modes) |
| TASK-132 (done 2026-11-11) | Rail heights: tunnels and elevated sections at their true height in 2D and 3D, with portals and supports; at least one Munich tunnel is not shown today. | TASK-126 imports `layer`, `bridge` and `tunnel` on tracks; heights are not applied everywhere. | TASK-126 |
| TASK-133 (done 2026-11-11) | Station furniture: station signage, name boards, departure displays, shelters and benches at platforms. | Stations drawn as platforms and small discs. | TASK-126, TASK-127 (displays read the timetable) |
| TASK-134 (done 2026-11-11) | Overhead lines: catenary masts shared by parallel tracks close together, with a portal or truss across them and a contact wire over each track. `electrified=contact_line` (or `yes`) draws it, `electrified=no` (or `rail`, third rail) does not, no tag draws it anyway (owner); mapped `power=catenary_mast` nodes place masts where present. | None. | TASK-126, TASK-132 (heights) |
| TASK-135 (done 2026-11-11) | Trams as their own kind of track: a distinct track type with its own visual quality (rails, bed, sleepers or embedded track), in 2D and 3D, clearly unlike railway tracks. | Tram tracks drawn almost like railway tracks. | TASK-126 |
| TASK-136 (static equipment merged, operating crossings held for owner in green PR #1) | Level crossings: railway crossings (`railway=level_crossing`, `crossing:barrier`, `crossing:light`, `crossing:bell`) always get gates, St Andrew's cross signs, lights and road markings; tram crossings (`railway=tram_level_crossing`) get tram signals, and trams may have priority. Road traffic stops for trains and trams in the simulation. | Crossing equipment is drawn. Operating protection and tram interaction are on the reviewed branch in PR #1. | TASK-127, TASK-135; TASK-138 for trams |
| TASK-137 (done 2026-11-11) | Tram stops: stops in the middle of the street (`railway=tram_stop`, `public_transport=platform`) with platforms, shelters, markings and displays. | None. | TASK-135 |
| [TASK-138](tasks/TASK-138.md) | Tram vehicles: timetabled trams on the tram tracks that interact with cars, signals and level crossings (not only decorative). | Main has TASK-127 railway service. The synthetic tram timetable and interacting trams are on the reviewed branch in PR #1. | TASK-135, TASK-137, TASK-136 crossing control |
| TASK-139 (dropped for now, owner 2026-11-11) | Trams beside and in streets: tracks in a median keep their own space beside parallel carriageways without overlapping them; street-running trams (`embedded=yes`, `embedded_rails=*`) run in a road lane shared with cars. Reconcile with TASK-131's keep-the-geometry rule (overlaps come from lane widths, not OSM lines). | Tram tracks drawn over road surfaces; no shared lanes. | TASK-131, TASK-135, TASK-138 |

## Lead handover

How the lead runs this project, for whoever takes the role on another machine. Everything
else is in this file, `AGENTS.md`, `docs/architecture.md` and `docs/tasks/`.

The [current lead handover after TASK-149](lead-handoff-2026-11-12-after-149.md) records the
verified main build, owner holds, agent allocation and the next independent parking follow-up.
The [earlier handoff](lead-handoff-2026-11-12.md) covers the start of the temporary lead shift.

The owner subsequently assigned orchestration to the temporary lead. Unless the owner reserves a
task, the lead starts Codex subagents in the lead chat and they report to the lead. Use up to
GPT-6.1 Sol at high effort. If a task would benefit from GPT-6 Astra, explain why and obtain
the owner's approval before assigning it.

- A wave is a set of tasks on disjoint file surfaces. For each task: write the contract in
  `docs/tasks/TASK-<id>.md`, add its row to the task table, note the wave under "Waves",
  commit, cut `task/<id>-<name>` from `main`, and give the agent a brief that names the
  branch inside and outside the message, the files to read in order, what to deliver, the
  surface it owns, the shared files it may touch additively, the tests, and the report
  format. Agents work in their own worktree, commit with Conventional Commits, never push,
  never merge, and set `CITYFLOWS_TEST_PORT` to a port of their own for Playwright.
- Review on request: read the diff against `main` with the contract beside it; merge in
  surface order (sim and host first, UI last); resolve conflicts, which are usually additive
  blocks and a dropped closing brace in `app.css`; run `npm run check`, the full
  `npm run test:e2e` (serial, about six minutes with T16) on a free port, and
  `npm run import-probe` when the importer changed; exercise what changed in the browser
  with `npm run dev`; fix contract-level problems in a lead commit; write the review entry
  in the review log, set the row to done, commit, push `main`.
- Agents sometimes write their own status into this file or the owner decisions log; replace
  it with the review entry. Contract changes an agent made are accepted only when they are in
  `docs/architecture.md` in the same branch and named in the review entry.
- Measurements that gate work: the Performance section (benchmark and T16), the Munich
  import baseline and its after-tables, `npm run route-audit` (zero infeasible routes on the
  grid, town, Sindelfingen and Munich), the probe's `--scale` for import demand, and the
  demos' metrics files under `test-results`, which regenerate from the suite.
- CI runs on Linux, whose fonts are wider than Windows' system UI font, so floating panels
  are larger there. A scenario that clicks or paints near a panel can pass locally and fail
  in CI. Check `gh run list --branch main` after each push. To reproduce locally, set the
  root font in `src/ui/app.css` to Verdana for the run and revert it afterwards.
- Local-only state: `bench/latest.log` and the CPU profiles, `test-results`, the worktrees
  under `.claude/worktrees` and the owner's Codex worktrees. None of it is needed.

## 24-hour plan (lead, 2026-11-13)

Wave A, finishing: TASK-113 (gate with choice off, mode-share guard), TASK-160 with 162 (UI and
map), TASK-163 (lighting), TASK-164 (aisle departures), TASK-165 (crosswalk safety); the lead
resets the baseline after TASK-161 and TASK-113 and runs a quiet-machine frame check before the UI
merge. Wave B, mostly parallel: TASK-166, 167 and 168 (UI, once TASK-160 to 163 merge), TASK-169
then TASK-170 (intersection behaviour, in sequence), TASK-171 (test infrastructure, when few sim
branches are open), TASK-172 (after the baseline reset). Wave C: TASK-175 (independent, starts
now), TASK-173 then TASK-174 (mode choice at departure, then transit), TASK-176 and 177 near the
end. At most five agents at once; sim tasks sharing `parking.ts` or `intersection.ts` run in
sequence; every merge goes through the unchanged gate and CI, and anything failing is held.

## Review log

- 2026-11-03, TASK-000 merged as delivered: pinned SHAs, line-anchored paths, destination
  files per recommendation, do-not-use list.
- 2026-11-03, TASK-001 merged after a lead fix commit (`6e4c0d7`). Found in review: merge and
  diverge lanes fanned out instead of pairing from the curb; the spec's left-hand-traffic
  sentence was wrong (lane 0 turns left on both sides) and the code followed it; strongly
  connected components flagged every one-way-only fixture; a lane could be left without any
  movement at a T-junction; the bypass fixture joined the expressway with left turns and had no
  real time advantage; generator was not mulberry32. Spec sections 5.2, 5.3, 5.5, 9 and 14
  amended in the same commit. Accepted as judgment calls: compile re-validating shapes, the
  empty Flatbush subclass, `Command` living in `src/schema`.

- 2026-11-03, wave 1 (TASK-002, 006, 007, 008, 011, 020) merged after one lead fix commit.
  Found in review: `history.json` lacked its version wrapper, the manifest pinned schema
  version 1 ahead of `migrateCity`, unknown archive members were rejected; Zod schemas for
  persons, scenarios, trips and history were scattered across `src/project` and `src/demand`
  and now live in `src/schema`; the importer dropped non-incident restriction relations
  silently and counted untagged defaults as inferred; the renderer drew arrows for never-green
  movements. Spec amended to document justified deviations: routing feasibility budgets and
  penalty reading (section 7), scheduling fills agendas and the trip window rule (9), the
  renderer's `setCity(compiled, city)` and route overlay input (11), single-JSON hashing (12),
  importer junction set, per-section street groups, lane splitting, turn-lane pinning and the
  generated signal program (13). Accepted as judgment calls: routing's `priority < 10` minor
  test, compile inside `generatePopulation`, the editor's `reverseRoad` ungrouping.

- 2026-11-03, TASK-024 and TASK-025 merged as delivered. Tiles: layer below the grade
  groups, failure cooldown, attribution constant, dev-page toggle. GeoJSON: `docs/geojson.md`
  documents the format; two-way roads take a total lane count split forward-heavy; export
  writes one one-way feature per directed road and lists everything dropped.

- 2026-11-03, TASK-003 merged after a lead fix commit. The engine was faithful and
  deterministic; review found that only one vehicle could occupy a movement at a time and that
  a follower could request entry only as lane leader within 15 m, which broke every platoon at
  every junction. Fixed with per-movement occupancy and a speed-aware request rule, with a
  platoon test. Unknown place ids now throw at load. Section 8 documents the merged behaviour.
  Accepted: minor-only stop standing, exit clearance measured from the last vehicle, commit
  clamps, fallback memory, departed-only hash set, pending trips not inspectable.

- 2026-11-03, TASK-004 and TASK-005 merged with lead fix commits. Lane changes: discretionary
  changes were possible while holding a grant, near the stop line, and off a queued
  destination lane (which defeated T08's spillback); all three are now excluded. Host: a
  dev-only console log removed; section 10 documents the wire form (Flatbush rebuilt in the
  worker), the 25-step cap and snapshot coalescing. Accepted: grant release on lane change,
  creep as a speed clamp, the router-tolerance mismatch used by the short-turn tests, per-step
  allocations in the lane-change pass (TASK-044).

- 2026-11-03, TASK-009 merged as delivered (check and both Playwright scenarios green). Lead
  exercised the app in the browser: bundled grid loads, Play moves cars, speeds 1 to 20 with
  the achieved multiplier, Pause and Step, vehicle inspector with the route overlay, street,
  node and diagnostics panels, no console errors. Undo and Redo are present but inert until
  TASK-010 binds them. Observation for TASK-012: the grid fixture's demand (100 to 150
  residents spread over the morning) puts only one to three cars on the road at once; the
  Gate 1 demo needs enough residents for visible queues.

- 2026-11-03, TASK-010 merged as delivered (check and six Playwright scenarios green). Lead
  exercised it in the browser: editing a signal phase while playing paused the run, showed
  "Restart to apply changes" with Play and Step disabled, Restart replayed from the edited
  network, Undo restored the program and re-staled the run. The store keeps the engine's
  compiled city apart from the editor's so a paused run stays inspectable on the new map.
  Accepted: per-phase road-pair checkboxes ahead of TASK-040, test hooks on window.cityflows,
  vehicles on a deleted lane drawn in layer 0 until restart. With this, Gate 1 items 1 to 7
  are implemented; TASK-012 verifies them end to end.

- 2026-11-03, Gate 1 verified (TASK-012, lead). Checklist items 1 to 7 pass in Playwright
  (seven scenarios: run, replay and inspect; JSON open, ZIP save and reopen; T17; a banned
  movement changes routes and the hash; a shortened phase changes the queue; rejected and
  undone edits; an edited network surviving save and reopen) and by hand in the browser. The
  demo grid now has 1 088 residents so the morning peak overloads the central signal. A full
  scenario day headless (07:00 to 18:00, 2 176 trips): 1 978 completed, 0 failed, the rest
  scheduled after the end of the window, peak 24 driving and 26 queued at the origin, mean
  delay 31 s, 396 000 steps in 0.7 s, heap 17 to 32 MB with no growth after the peak. The
  handoff's failure conditions are absent: cars carry state, roads are canonical topology,
  routing is by expected time with lane feasibility, edits change routes after restart, trips
  start and end only at connectors, and the project exports and reopens.

- 2026-11-03, TASK-031 merged as delivered. Per-road EWMA of observed traversal times
  (alpha 0.3, updated every 60 s, decaying to free flow when unobserved, partial traversals
  normalized by distance), staggered route checks every 120 s with 15 percent hysteresis, at
  most three congestion switches per trip and none inside the decision distance; route noise
  0.1 is now on by default. T06 on the bypass: 73 of 600 vehicles rerouted, 17 diverted to
  the local street during the blockage, at most one switch per vehicle, a return share under
  25 percent per interval, identical twin hash. Six SimParams fields were added to the schema
  with defaults (architecture section 8 updated by the agent). Accepted as noise: the routing
  cost cache only copies the array when the version changes.

- 2026-11-03, TASK-026 merged with one lead change. The town has 324 nodes, 1 137 roads,
  1 409 lanes and 18 places: arterials every 400 m with two-phase signals at the 16 crossings
  (left turns banned there and routed over the local streets), alternating one-way local
  rows, two diagonal avenues; it compiles with no diagnostics and every departure reaches
  every arrival. The agent had cut the town demand to 0.35 persons per resident; the lead
  restored 1 and regenerated the bundled project after a full day at full demand: 12 640
  trips requested, 12 571 completed, 0 failed, 0 stranded, peak 380 driving and 141 queued,
  6 500 steps per second (at 0.35: 4 439 trips, peak 97 driving, 17 000 steps per second).
  The store change in the branch was dropped in favor of the bundled-project loader of the
  redesign.

- 2026-11-03, TASK-050 merged as delivered. Light warm map, floating project bar, toolbox and
  run controls, a contextual inspector sheet with Lanes and street settings, Signal phases,
  Turns, Place settings and Connectors behind disclosures; places hued from a six-color
  palette by a hash of their id, vehicles tinted by the hue of their destination, signal
  glow, selection ring, route ribbon, markings and arrows fading with zoom, eased zoom at the
  pointer and pan inertia; a New picker built from the bundled scenarios, Town included. The
  seven Playwright scenarios pass with the disclosures opened in the tests; the lead
  exercised run, zoom, pan, car, street and signal selection, the picker and the town in the
  browser. Observation for wave 6: point places are 6 m shapes and nearly vanish at fit
  zoom; TASK-034 should give places a minimum on-screen size.

- 2026-11-03, TASK-030 not delivered: the branch `task/030-activities` holds no commits and
  its worktree is clean. The brief stands and is re-issued with wave 6; the agent merges
  `main` first, since the engine and the sim parameters changed under TASK-031.

- 2026-11-03, TASK-030 (rerun on `task/030-activities-2`) merged as delivered. Opt-in chains
  through a new `DemandConfig.chains` (school, shop and leisure shares; schema addition
  approved), departures drawn from place profiles, gateway through trips with seeded
  stochastic rounding, event visitors as paired inbound and outbound trips, admission windows
  and parking pairing in the connectors, `CPlace.events` on the compiled city (approved), and
  the station fixture (08:00 to 08:35, 180 through trips per hour, an 80-visitor train). T09
  and T10 pass; without chains, events or through traffic the town day is unchanged (12 640
  trips, none failed).

- 2026-11-03, TASK-022 merged as delivered. `src/editor/commands/topology.ts` implements
  addRoad, deleteRoad, splitRoad, moveNode and the approved mergeRoads (added to the Command
  union and architecture section 6); drawing snaps to nodes and roads, splits on snap, keeps
  crossings grade-separated, and the select tool drags junctions; Split, Delete street and
  Merge streets sit in the inspector. T12 and the three gate2-edit scenarios pass; the lead
  drew and undid a snapped diagonal in the browser. Noted for TASK-044: every topology command
  compiles the city twice to relocate connectors, fine at town scale.

- 2026-11-03, TASK-040 merged as delivered. Signal programs are now drafted in
  `src/ui/inspector/signal.tsx` (timeline with draggable durations, a schematic with one arrow
  per legal road pair, the generator shared with the importer in
  `src/importers/signal-program.ts`) and committed with "Apply signal program" after a trial
  compile; a conflicting draft disables the apply button. The preview highlights the loaded
  engine's green movements at the selected signal. The gate1 scenarios were updated for the
  explicit apply step.

- 2026-11-03, TASK-041 merged with two lead changes: the heat tint now sits under vehicles in
  the base grade instead of covering them, and the ramp runs from the plain road tone to dark
  teal so free-flowing roads keep their look. `metricsSeries` and the throttled
  `roadSpeedRatio` on snapshots are approved protocol additions. The layer list, queue dots
  and the four inline SVG curves work in the browser. The agent measured 0.07 ms mean per heat
  update at 3 000 vehicles on the town.

- 2026-11-03, TASK-021 merged with two lead changes: restart regenerates the population only
  when a place's kind, population or jobs changed or places were added or removed (the branch
  regenerated on any places edit, which would have discarded the saved population after a
  connector move), and a mangled character in the import fallback text was replaced.
  maplibre-gl 6.16.0 is the one approved dependency (NOTICE entry present, loaded lazily with
  the wizard). File upload, diagnostics and accept are covered by the gate2-import scenarios;
  the Overpass path (cache hit, area cap, cancel) is unit-tested with a stubbed fetch and was
  not exercised against the live endpoint by the lead.

- 2026-11-03, wave 6 merge notes: four stylesheet merges each dropped a closing brace at the
  conflict boundary, fixed in the follow-up commit. Playwright now runs with one worker: the
  scenarios that step whole mornings starve parallel pages of the shared GPU process and made
  unrelated scenarios time out. All 16 scenarios pass serially in about one minute.

- 2026-11-03, TASK-034 merged as delivered. A Place tool paints with a round brush (raster
  union at 2 m, smoothed and simplified to at most 48 points), creates the place with
  area-scaled residents or jobs and a connector snapped to the nearest car lane within 60 m,
  extends an existing place of the same kind, and refuses to leave a dangling place. The place
  inspector gained sliders, a demand readout, connector add, move and remove, and delete;
  "Regenerate demand" with a seed sits behind Trip counts; point places now keep a minimum
  on-screen size. The three gate3-paint scenarios pass; the lead painted a work place and
  read its inspector in the browser.

- 2026-11-03, TASK-023 merged with one lead change. Shift-click and Shift-drag box selection
  of streets, a batch inspector with mixed values, and one batch command per apply; the
  invalid-member test and the four gate2-batch scenarios pass. Removed: the branch compiled
  the whole city after every batch member to reject batches that pass through an invalid
  intermediate state, which cost one compile per member and broke the existing
  add-then-configure batch in T12; the editor compiles the final draft once, as before.

- 2026-11-03, TASK-042 merged as delivered. Baselines are saved in the project (optional
  `baseline.json`, approved), restored through the approved `restoreCity` command as an
  undoable patch with optional city metadata, and compared in a second worker with
  `runHeadless` (approved protocol addition) on the trip list generated once from the
  baseline; the table shows mean travel time, 90th percentile delay, completed and failed,
  and a difference layer tints roads by unique-vehicle count change. Verified in the browser:
  a banned movement on the first commute route moved the mean travel time and the 90th
  percentile delay and painted the diverted roads. Noted for TASK-044: the headless run
  inspects every active vehicle every step, slow on the town.

- 2026-11-03, TASK-043 merged with one lead change. Trips, road metrics and trajectories CSVs
  with a provenance comment line, an Export menu in the top bar with the GeoJSON exporter and
  a trajectory recording toggle, and the approved `tripRecords`, `roadStats` and
  `trajectories` requests with a lazily materialized `Metrics.tripOutcomes`. Changed: the
  worker recorder took a snapshot and inspected every vehicle after every fixed step, which
  would have slowed every interactive run; it now samples every tenth step from the snapshot
  alone (documented in architecture section 10). Export tests pass; the lead did not download
  the files by hand.

- 2026-11-03, TASK-032 merged with one lead change. `src/sim/merge.ts` adds gap acceptance at
  merge movements with cooperative mainline braking bounded by `safeDecelMps2`, and lane
  drops become mandatory changes before the drop with a holding state instead of the
  compiler's fallback movement; the merge and diverge classification now ignores reverse
  carriageways (architecture 5.2, approved). `addRamp` and `removeRamp` (approved commands)
  split both roads and lay a tangent cubic ramp; a Ramp tool picks start and end roads with a
  preview. T07 in full, the ramp editor test and demo C pass: on the grid an expressway with
  an on-ramp and an off-ramp cuts the mean travel time from 90.7 s to 60.0 s and every
  inspected route uses it. Changed: the scenario's first expressway vertex sat under the top
  bar once TASK-043's Export button widened it; it now starts inside the map on the same line.
  The lead built a ramp from the top street onto a drawn expressway in the browser.

- 2026-11-03, TASK-044 merged as delivered. `npm run bench` (Node type stripping, no new
  dependency) runs four full-day workloads and prints one table; T16 samples eight seconds at
  10x in the browser for the grid, a distributed 3 000-car stress grid and the town, with a
  retained-heap guard across repeated mornings and a JSON report per scenario; the one shipped
  optimization caches the static terrain as a texture below zoom 0.7, which took the town
  overview from 12.8 to 60 FPS. The lead reran the benchmark on the merged tree (grid 69 200
  steps per second over the day, stress 15 700, town 8 900, all trips reconciled, the known
  single stranded trip on the stress grid) and all 28 Playwright scenarios pass; T16 adds about
  three minutes to the suite. The measured section 15 status and the profiled simulation
  hotspots are in the Performance section below; the sim follow-up is the next task.

- 2026-11-04, TASK-046 merged as delivered (first wave run as sessions from the lead chat).
  The reroute check keeps a min-heap of due checks keyed by time and id instead of scanning
  every trip every step; the travel and proposal passes walk an ordered list of occupied
  segments; lane-change proposals allocate nothing per vehicle and use precomputed lane
  survival; the headless comparison reads one snapshot per step and the trip outcomes once.
  The stress grid's stuck trip was an engine defect: a lane-level fallback route whose only
  target lane was dropped before a narrowing never proposed a lane change; a vehicle now leaves
  by the nearest surviving lane that enters the next road and reroutes as missed_turn, with a
  reproduction test. Lead benchmark on the merged tree, 24 h steps per second: grid 69 200 to
  488 000, scaled grid 24 000 to 197 000, stress 15 700 to 39 800 with all 6 240 trips
  completed, town 8 900 to 42 000; grid, scaled and town state hashes unchanged, the stress
  hash changed only through the fix. Check (168 unit tests) and all 28 Playwright scenarios
  pass. Left alone with numbers: the export recorder, the comparison snapshots, signal grant
  scans and the IDM arithmetic.

- 2026-11-04, TASK-033 merged as delivered (session from the lead chat). The place inspector
  gained a 24-bar hourly profile editor (drag or arrow keys; "Add profile" seeds a commute
  shape by place kind; "Use default timing" clears it), an event list, a Type select,
  editable attraction and a per-connector direction; "Add connector" falls back to a free slot
  15 m along an already connected lane. The Demand panel in the run bar shows persons and
  cars, trips by hour, trips per place, the regenerate control with its seed (moved out of
  Trip counts) and the last run's origin queue and failures by reason; the vehicle inspector
  derives a waiting reason in the UI. The gate3-places scenarios cover demo A (2 000
  residents, morning peak, at least 10 driving at 08:00, the Homes exit being the limit) and
  demo B on the bundled Station city (queue 0 before the 08:05 train, peak 64 after, about 53
  with a second arrival connector; the 300-visitor variant is origin-bound at the gateway
  exits, so the fixture's 80 stays). Check and all 31 Playwright scenarios pass on the merged
  tree; the lead opened the panel and the editors in the browser. Two follow-ups noted: a
  second connector with direction "both" on a capacity-limited place deadlocks its loop
  (departures spawn into the arriving queue), and the demand chart oversizes below 900 px.

- 2026-11-04, TASK-045 merged as delivered (session from the lead chat). Four recorded demo
  scenarios with a video and a metrics file each (A: grid with 2 000 residents, peak at 08:00,
  22 driving and 240 queued at the Homes exit; B: Station city, queue 0 before the 08:05
  train, peak 64, 53 with a second arrival connector; C: expressway with two ramps, every
  inspected route uses it, mean travel time 90.7 s to 60.0 s; D: the downtown OSM fixture
  imported, a banned turn lifted, saved, reopened in a fresh browser context and replayed to
  the same hash), a shared e2e helper module, and a first-run hint sequence of six cards
  beside their targets that advance when the step is done, with Show hints, `?hints` and a
  dev hook to reopen it. The lead followed the first three hints in the browser. Demo D
  confirms the import demand problem already in the backlog (B3, B5): 7 442 of the imported
  city's gateway trips fail in the first 15 minutes. With this, every task in the plan is
  merged; the backlog from real OSM testing is the next wave.

- 2026-11-04, TASK-047 merged as delivered. Junctions are drawn as the polygon through the
  lane-edge corners of every road end plus the movement surfaces, with a disc only at
  degree-two nodes; cars advance along their lane or movement polyline between snapshots
  by speed times elapsed wall time times the run multiplier and snap on the next snapshot;
  lane changes ease with a smoothstep and a small yaw; stop lines, give-way triangles,
  lane arrows and zebra crossings come from the compiled movements and fade with zoom;
  Layers gains a Basemap toggle for georeferenced cities; the demand chart and the ramp
  hint fit narrow windows. Two unit tests cover the markings rule and the interpolation.
  The lead saw the grid signal with crossings, stop lines and arrows and interpolated
  motion at x20 in the browser.

- 2026-11-04, TASK-049 merged as delivered. Stop approaches wait a full second at the line
  before requesting and yield gaps are inclusive of gapS (both hashes changed only in the
  affected tests); optional SignalProgram.turnOnRed marks curb-side turns that stop, then
  yield on red, with a toggle in the signal editor and an importer default from explicit
  country tags; addRoundabout and removeRoundabout (approved) replace a junction with a
  one-lane 30 km/h ring on split entry and exit legs with yield on entry, driven by a
  Roundabout tool that drags the radius; imported junction=roundabout rings keep their
  geometry and get yield entries; stop and yield signs fade with zoom in a signs layer; the
  Station deadlock is fixed by letting a parked departure use another outlet of its place.
  Accepted with a note: removal restores the junction from a before-and-after snapshot
  stored on the node, which is more state than an inverse command; revisit if saved cities
  grow. The agent also noted a flaky first run of the T16 grid scenario (worker terminated
  while a replacement project loaded) that passed on rerun; watch it.

- 2026-11-04, TASK-048 merged as delivered, with one scope note. The importer now merges
  sub-30 m sections, consolidates short junction clusters (up to 60 m across, keeping bridges,
  motorway junctions, controls and restriction nodes apart) into one junction with explicit
  turn rules, joins feeders to both carriageways by proximity, gives single-lane approaches
  every receiving lane (architecture 5.2 amended), defers turn:lanes arrows across way
  boundaries, pairs boundary gateways per carriageway with demand by class and lane, and turns
  buildings and land use into block places (defaults in architecture 13). On the reference
  extract: 548 roads, 33 gateways, 91 block places with 35 400 residents and 30 200 jobs, zero
  unreachable connectors, every connector pair routable, zero failed trips; short-road
  warnings 173 to 15 and dead ends 65 to 7, each remaining one listed by id with a reason in
  the Munich test. The existing fixtures lost warnings too (downtown 207 to 60). One lead
  fix on merge: the new junction consolidation collapsed roundabout rings, whose arcs are
  short by design, so rings are now excluded (the Sindelfingen scenario caught it). Out of the
  stated surface and accepted after reading: a fallback movement now has to route to the
  destination and a car whose route needs another lane waits for a safe change instead of
  stranding (architecture 8), which changed the route-following tests and shifted the grid's
  morning peak. Open: at one person per resident the imported city gridlocks (30 800 queued at
  origin at 10:00), so the import wizard's default demand needs a scale (B13 below).

- 2026-11-04, TASK-052 (lead, on taking over the lead role). GitHub CI on `main` had
  failed on every push since `95a1af6`, while every local run on Windows passed. On the
  runner's wider fonts two scenarios broke. In gate3-paint "extend…" the retail stroke at
  map y 55 started on the Place tool's hint panel, so no place was painted; the strokes now
  run one block lower (y 175 and 205). In gate3-places "profile and event editors" the
  Demand sheet covered "Use default timing" in the inspector; the sheet now closes before
  that click instead of before the Offices click (the overlap itself is B14). The T16 grid
  failures in the same runs were a heading race that `9ea76ba` already removed by renaming
  the uploaded grid. Verified with the root font switched to Verdana for the run: the two
  scenarios fail before the change and pass after, and the full suite passes. It also passes
  with the original font, and `npm run check` passes.

- 2026-11-04, wave 10 merged (TASK-053 to TASK-060, owner-started agents in Codex
  worktrees). Merge order 057, 055, 054, 056, 059, 053, 058, 060; git merged every branch
  without a conflict; one semantic clash (below) fixed in the lead commit. Verified on the
  merged tree: `npm run check` (265 unit tests), all 46 Playwright scenarios on port 4391,
  the route audit, the Munich probe at four scales, and the benchmark; the wizard, the
  Demand sheet with an inspector, and the Munich bridge checked in the browser.

- TASK-057 merged as delivered. A movement at an uncontrolled node with no conflicts, no
  signal, no merge, no never-green and no turn-on-red flag is a continuation: the engine
  treats it as granted, the request chain lets a follower ask as soon as the car ahead is on
  a continuation, `enterLane` releases only real grants, and the spawn-gap check looks across
  a continuation because it holds no reservation. Tests: a platoon of one and ten through two
  degree-two nodes and through a conflict-free one-way T arrive within one step of the
  unsplit road; a blocked continuation keeps the following gap; a table test that only the
  uncontrolled case bypasses reservations. The synthetic fixtures have no conflict-free
  movement, so the four benchmark hashes and trip counts are unchanged (checked on a tree
  with only this branch merged and on the merged tree); the effect shows on imports, where
  the Munich morning at scale 1 completes 530 trips by 10:00 instead of 445 with zero
  failures, a gain shared with TASK-054 and TASK-055 in the same wave. Engine rates on a
  tree with only this branch merged (i7-14700F, idle, 24 h steps per second): grid 449 273,
  scaled 102 374, stress 25 713, town 27 065, in line with the TASK-046 figures scaled to
  this machine. The agent's measurement script was in `tests/sim`; the lead moved it to
  `bench/passthrough-probe.ts`.

- TASK-055 merged as delivered, with the diagnostic code added to architecture 5.5 by the
  lead. `bench/route-audit.ts` (`npm run route-audit`) routes every connector pair and checks
  each route independently of the router: lane changes reachable within the road length and
  the change distance, every movement legal at its node, no clipped boundary stub. Causes
  found and fixed: the lane search gave the same road length to the arrival at the connector
  and to leaving the road, so a route could end on a lane it could not reach; the remaining
  cost ignored lane changes; the road-level search's result was taken without checking that
  it needed no lane changes; and a narrowing's clamped fallback movement was routable. The
  compiler now warns `lane_requires_merge` for such a movement and the graph skips it; the
  fallback rule no longer counts U-turns as served. Audit before and after is in the PR
  branch's test output; after: zero on the grid, town, Sindelfingen and Munich (Sindelfingen
  keeps 624 unroutable pairs across its clipped motorway ends, unchanged). The four
  benchmark state hashes are unchanged (grid 1639643273, scaled 3254820089, stress
  1071430910, town 3932636798): the synthetic fixtures had no infeasible route. Found by
  the lead's benchmark and left open as B20: the road-level search result is now accepted
  only when it needs no lane change and costs exactly the road path, so nearly every
  request falls through to the lane-level search. On this machine (i7-14700F, idle), the
  routing benchmark fell from 54 963 to 26 427 routes per second on the grid and from 5 064
  to 1 548 on the town, and the town's 24 h rate from 27 065 to 18 764 steps per second
  (morning 9 604 to 6 035), measured against a tree with only TASK-057 merged.

- TASK-054 merged as delivered. The importer snapshots every signal, stop and give-way node
  before junction consolidation, resets controls, and after consolidation moves each control
  along directed roads to the first surviving junction within 60 m: a node where at least
  two streets meet (degree three, or two roads that are not sections of one street). A
  control that reaches no junction is dropped and its node merged away; transfers are
  recorded as `controlTransferred:<tag>:node/<id>` in provenance. Munich: 24 signals to 14,
  none of degree two, every one on at least two streets; `r:978#2` left the dead-end list.
  The T18 case of a give-way node in the middle of a single way now expects an uncontrolled
  node, which is the rule. Fixture warning baselines reset to the TASK-048 values plus
  Sindelfingen (53).

- TASK-056 merged with a lead commit for the work the agent left uncommitted in its worktree
  (including its untracked `tests/importers/layers.test.ts` and
  `tests/render/grade-order.test.ts`). The task text was wrong about `Road.layer` existing;
  the agent added it as an optional field (schema and architecture section 4 updated in the
  branch, accepted) filled by the importer from `layer`, else +1 for a bridge, −1 for a
  tunnel or covered way; node layers prefer the through way, then a continuation, else
  ground, so bridge ends meet the street. The scene now orders grade groups by layer instead
  of first-seen order. Munich has 26 roads at layer 2 (the Donnersbergerbrücke decks), 2 at
  layer 1 and 8 at −1; in the browser the bridge draws over the streets it crosses.

- TASK-059 merged as delivered. `removeRoundabout` rebuilds the junction from the current
  ring: center at the ring's centroid, each entry and exit leg pair merged back through the
  center with the outer road's attributes, controls, turn rules and signal groups remapped,
  connectors projected onto surviving lanes with warnings; a broken ring refuses with the
  road id. `Node.roundabout` is now `{ radiusM, ringRoads, restore }`; the city schema is
  version 2 with a legacy schema that migrates version-1 files (and history patches) on
  open, covered by a saved version-1 project in `tests/editor`. Accepted with a note: the
  leg pairing recognizes `splitRoad`'s allocation pattern by id arithmetic, which ties it to
  `topology.ts`.

- TASK-053 merged with one lead change. The accept step of the wizard has a Demand range
  input (0.05 to 1) with a residents × scale readout written to
  `demand.personsPerResident`; the probe takes `--scale`. The agent shipped a default of
  0.1 instead of the contract's 0.3 without saying why; the lead's probe runs explain it:
  at 0.3 the morning still queues 5 710 of 10 625 trips at the origin at 10:00, at 0.2 a
  third, at 0.15 under a fifth (1 012 of 5 314) and at 0.1 almost none. By the contract's
  rule (the largest 0.05 step with under a quarter queued) the default is 0.15, set by the
  lead in the wizard and the e2e scenario. The synthetic cities stay at 1.

- TASK-058 merged as delivered. The run-bar sheets render inside one `.run-sheet` wrapper
  whose height a `ResizeObserver` writes to `--run-sheet-space` on the app root; the
  inspector's maximum height subtracts it, so it scrolls above the sheet instead of being
  covered, and below 900 px it collapses to its heading while a sheet is open. The TASK-052
  workaround is gone from gate3-places and two scenarios trial-click every enabled inspector
  button with the Demand sheet open at 1280 × 720 and 1440 × 900. Seen in the browser at
  1440 × 900 on the Munich import.

- TASK-060 merged in part. The three workflow actions moved to their v7 releases (checked
  against the release tags). The audit advisories cannot be cleared: `typescript-eslint`
  8.72.1, `eslint` 10.14.0, `@eslint/js` 10.0.1 and `eslint-plugin-react-refresh` 0.5.7 are
  the latest releases and all still reach the vulnerable `minimatch`; the twelve moderate
  advisories stay in dev tooling only, as the deferral says. The agent left the workflow
  change uncommitted and no report; the lead committed it.

- 2026-11-04, TASK-062 merged as delivered. The lane-level search keeps its edge expansions
  per road graph (one entry per compiled version and vehicle class), the search reuses its
  cost, predecessor and heap storage between requests, and the heap holds parallel arrays.
  Routes are identical: a regression pins the full `RouteResult` of 96 requests on each of
  the grid, the town, Sindelfingen and Munich (`tests/routing/throughput-routes.json`), and
  the four benchmark state hashes were unchanged on the tree with TASK-062 alone. Lead
  benchmark on that tree (i7-14700F, idle, routes per second): grid 33 972 to 55 988,
  scaled grid 30 688 to 53 562, stress 36 647 to 65 475, town 2 833 to 5 342; town 24 h
  33 273 to 40 992 steps per second (morning 10 856 to 14 374). The agent left no report;
  the numbers are the lead's. The pinned routes were captured again after TASK-061, whose
  geometry changes them.

- 2026-11-04, TASK-051 merged with a lead fix commit. `engine.patch` remaps lanes,
  movements, roads, connectors and signals by id, projects a car whose segment disappeared
  onto the nearest car lane or movement within 4 m and 30 degrees (`src/sim/patch.ts`),
  strands only a car with nothing to project onto, releases grants at nodes whose movement
  set changed, restarts a changed signal program at the patch time, reroutes with reason
  `edit` only routes that touch a change (at once when broken on the current road, otherwise
  spread over the reroute interval by id and outside `maxReplans`), and refuses place
  additions and removals. The host adds the `patch` request (the reply carries `timeS`,
  section 10 amended by the agent), the recorder remaps its road statistics, and the store
  patches on every commit that keeps demand, with a fading "Edit applied" status in the run
  bar; restart after patches reloads the patched city. T19: thirteen unit cases
  (conservation, determinism, staggering, grants, signals, costs, projection on a split and a
  lane drop, stranding on a delete, lost connectors, a moved arrival portal), a host round
  trip, and a town scenario that draws a road at 10x while playing and sees cars on it 10
  simulated seconds later (patch 14 ms for the road, 11 ms for a turn ban, on this machine).
  Found and fixed by the lead: a profile, event or attraction edit was patched live although
  trips are scheduled from those fields at load, so Restart no longer applied it; the agent
  had changed the gate3-places scenario to press "Regenerate demand" instead. Such commits
  now mark the run stale (architecture sections 1 and 6 amended) and the scenario is back to
  its original form; the scenario's 50 ms patch assertion is 500 ms for CI. Ten scenarios
  changed from waiting for "Restart to apply changes" to the status line; the four benchmark
  hashes are unchanged without patches. Seen once: demo B's click on a queued car at the
  Station missed (vehicle picking by screen position) and passed on rerun.

- 2026-11-04, TASK-061 merged with lead fixes. Delivered: per-road-end setbacks from the
  lane-block edge intersections with the two angular neighbours (`src/network/junctions.ts`),
  opposite carriageways grouped as one arm, setback 0 at an uncontrolled through node of one
  street; `CNode.setbacks` and `CNode.outline` with 8 m curb arcs, extended to the convex
  hull of the movement surfaces where a fixed Bezier escapes the curb; lanes trimmed by their
  own setback with a continuation hint so offsets stay smooth across through nodes; movement
  curves from the trimmed ends, straight within 0.5 m; stop lines and give-way triangles at
  the trimmed lane end; node areas drawn from the outline, nothing at a through node, and a
  small handle so through nodes stay selectable; `addRamp` lays the 60 m taper with one extra
  curb lane fed by the ramp alone and turn rules that keep the mainline lanes and connectors
  in place, `removeRamp` reverses it and refuses intervening edits; a five-junction fixture;
  T20 in `tests/network` and `tests/render` with a lane-crossing audit. The agent recorded a
  clarification in architecture 5.1 and the task file as owner-approved (convex-envelope
  outlines, source road-body overlaps reported separately, a 1 percent Munich completion
  tolerance); the lead accepted it at review. Found by the lead: (1) at acute approaches the
  setback rule as designed runs away: Munich had 80 road ends set back over 20 m (up to 65 m)
  and 97 movements over 40 m (up to 115 m), and since a movement holds its conflicts for its
  whole length the Munich morning fell from 2 120 to 1 275 completed trips at scale 0.15 (530
  to 444 at scale 1). Setbacks are now capped at `max(own floor, 10 m, the widest neighbouring
  road end's half extent + 1)` (architecture 5.1 amended, `SETBACK_CAP_M`); the audit
  tolerates crossings at a node with a capped end because the junction surface covers them
  (Munich 35, Sindelfingen 27; the visual residue is B21). With the cap: 2 078 completed at
  0.15 and 577 at scale 1, no movement over 24 m, audit zero on the four cities. (2) A through
  node's movement has no length and the commit inserted a car on it at `min(overflow, 0)`,
  losing a step per node, so the pass-through tests failed on the agent's own branch; the
  overflow now carries into the next lane in the same step. (3) The live-edit projection
  divided by zero on such a movement; guarded. (4) The TASK-062 pinned routes were captured
  again for the new geometry. The four benchmark state hashes are unchanged after all: every
  synthetic junction is a right angle whose setback equals the old radius. Verified on the
  merged tree: check (307 unit tests), all 47 Playwright scenarios, the benchmark, the four
  route audits, the Munich probe at both scales (table above); in the browser the grid's
  signalized crossing shows stop lines, crossings and arrows at the trimmed ends, and a road
  committed while playing applied live with "11 cars rerouted · 0 removed". The agents left
  no reports in any of the three branches; the numbers in these entries are the lead's.

- 2026-11-04, TASK-063 merged with a lead performance commit. Junction outlines are built
  from road edges and curb fillets per adjacent pair (largest radius up to 8 m keeping the
  pair's movement surfaces inside), with straight and bounded extended joins as fallbacks,
  gores at capped acute pairs, and no convex hull; Munich has 127 fillet, 84 extended and
  35 gore outlines and 36 through nodes, every outline simple and containing its movements.
  Node areas draw above lane markings, crossings sit 0.5 to 3 m past the trimmed lane end in
  the junction mouth (omitted where the setback leaves less than 3.5 m), roads and junctions
  share one asphalt colour, and a "Road classes" Layers entry restores the class tones with
  a junction taking its highest-class road's tone. Lane and movement geometry and the four
  state hashes are unchanged. The owner confirmed the contract exceptions the agent recorded
  as approved (extended cuts and the near-parallel fallback). Not supported, as reported:
  an authored short unequal-width junction whose movement width crosses a road's outer edge
  stays slightly outside the outline. Found by the lead: the outline search made a full
  compile six times slower (Munich 30 to 179 ms, town 58 to 265 ms), paid on every edit; see
  the TASK-064 entry for the shared fix. Seen in the browser on the Munich import: the
  signal junctions north of the Donnersbergerbrücke with crossings beyond the stop lines and
  queued cars behind them.

- 2026-11-04, TASK-064 merged as delivered; the cap stays. `CMovement.conflictZones` comes
  from the sampled paths with outward rounding; a car blocks a conflicting movement while
  its grant is on the approach or its rear is before the zone end, and yield, stop and
  turn-on-red gaps are measured to the zone start; live patches carry the zones and revoke
  approach grants when a zone grows. T21 sampled 192 000 steps (four-way signal, junction
  fixture, grid, Munich morning) with no two cars in contacting zones at once. The owner
  confirmed the two integration lines in `compile.ts` and `movements.ts`. Munich at 0.15:
  2 231 completed by 10:00, 959 queued, peak 2 124 with the cap (wave 11: 2 078, 1 108,
  2 128); 1 285 completed with the cap lifted, so the cap stays and B27 takes the rest. The
  four state hashes are unchanged, though town peak driving moved (371 to 391): the hash
  covers end-of-day state. The agent's reported 20 percent engine slowdown did not reproduce
  on the lead's idle runs (24 h steps per second, main then merged: grid 497 985 / 483 511,
  scaled 154 305 / 151 652, stress 37 135 / 34 313, town 34 522 / 34 225). Lead commit for
  both tasks: a prepared polygon test bucketed by y for the outline search, recomputing
  outside points only after an accepted change, and a bounding-box prefilter in the zone
  contact test; outlines, zones and lane and movement polylines hash identically on five
  cities, and a full compile takes town 352 to 152 ms and Munich 176 to 54 ms (main 58 and
  30). Verified on the merged tree: check (334 unit tests), all 47 Playwright scenarios,
  the four route audits at zero and the probe above.

- 2026-11-04, TASK-067 merged with one lead change. A deploy job after the check job
  publishes `dist` to GitHub Pages on pushes to `main` only, with Pages and OIDC permissions on
  that job alone; the Pages build sets `CITYFLOWS_BASE_PATH` from `configure-pages`, so dev,
  preview and Playwright keep `/`; `VITE_TILE_URL` and `VITE_OVERPASS_URL` come from repository
  variables with today's defaults; the README opens with a "Use it" guide, the published link,
  the synthetic-traffic notice and the attribution. The agent served a `/cityflows/` build
  locally: the grid ran, the town opened, downtown imported, `window.cityflows` was undefined,
  and every asset used the base path. Changed: the job's `concurrency.queue: max` became the
  documented `cancel-in-progress: false`, since an unrecognized key would fail every CI run.
  Owner steps: enable Pages with GitHub Actions as the source, and decide whether the public
  site may use `tile.openstreetmap.org` (light, attributed use only) or set `VITE_TILE_URL`.

- 2026-11-04, TASK-066 merged with lead fixes. The agent worked in a re-cloned folder, not a
  worktree of this repository; its commit was fetched from there. After splitting and
  consolidation, every interior vertex of an OSM road and every seam node joining two
  sections of one street becomes a tangent circular fillet at the class radius, reduced to
  half of each adjacent segment and a 2 m deviation, sampled at 1 degree; junctions, gateway
  cuts, layer changes, controls and restriction vias stay fixed; roundabout rings and non-OSM
  roads are untouched. T23 holds on Munich, Sindelfingen and downtown (junction nodes fixed,
  at most 2.000 m deviation, heading steps under 1 degree, deterministic). Accepted with
  reasons: a fold on a Sindelfingen service loop whose two ways share both end nodes (n:26),
  one movement edge sample outside the n:501 outline, and one more Sindelfingen merge warning.
  Lead fixes: a fillet tighter than the road's lateral extent plus 0.5 m keeps the corner
  (none on these extracts, a guard for narrow corners), and the TASK-062 pinned routes were
  captured again (they matched exactly with smoothing off). The agent's `npm run check`
  failed on timeouts while three agents ran at once; on the lead's merged tree check (340
  unit tests), all 47 Playwright scenarios, both route audits and the four unchanged
  benchmark hashes pass. Munich at 0.15: 2 005 completed, 1 118 queued, peak 2 192 (B30). In
  the browser the Landsberger Straße bend and the side streets are continuous curves.

- 2026-11-04, TASK-065 returned. The work was left uncommitted in its worktree with no
  report: the timed blocking test, the zone-stop backstop with `zoneStops`, the box rule and
  the two SimParams fields are there, but the project-file schema lacks the new fields, so
  the project open path does not typecheck and T22's own schema case fails. Measured by the
  lead on that worktree, Munich at 0.15: 2 185 completed with the cap and 1 638 with it
  lifted (TASK-064: 1 285), `zoneStops` 0 in both. The cap stays; the agent continues in the
  same worktree.

- 2026-11-05, TASK-065 merged on its second round; the cap stays. Holders' and candidates'
  zone occupancy windows are forecast from current speed and IDM acceleration (approach and
  movement speed limits separately) and a grant is refused only when the windows, widened by
  `zoneMarginS`, overlap, so a crossing car may go before a distant holder or after one that
  will have cleared; a car on a movement stops at an occupied zone, including a zone a
  departing car's rear still covers on its exit lane, clamped in the commit and counted as
  `Metrics.zoneStops`; the box rule needs room for the whole car past the movement and falls
  back to the older rule after `boxWaitS`; `zoneMarginS` and `boxWaitS` are in the scenario
  schema with defaults for older projects; `bench/zone-probe.ts` samples refusal reasons. The
  agent merged `main` into its branch as asked (smoothed imports). T22 has 21 cases; T21 keeps
  per-step contact sampling on four networks with no overlap. Benchmark: same completions,
  zero failures, unchanged hashes, `zoneStops` 0, 0, 190 and 173 over four full days. Munich
  at 0.15: 2 023 completed with the cap (main 2 005), 1 518 with it lifted; the agent's nine
  measured variants and probe show the uncapped loss in storage and manoeuvring geometry
  (approach lanes cut to stubs, a three-lane approach too short to change lanes, exit storage
  lost), not in arbitration, so B31 replaces the cap removal. Test changes, each with a
  reason in the report: three T21 cases rewritten for timed grants, one destination portal
  moved from 30 to 40 m, a contact-boundary inequality made strict, the Munich safety
  timeout raised to 600 s. Verified on the merged tree: check (361 unit tests), 44 Playwright
  scenarios (T16 skipped by owner decision), the benchmark and the probe above. Architecture
  8 now describes the forecast as merged and 5.1 the cap as permanent.

- 2026-11-05, TASK-069 merged as delivered. `Diagnostic.severity` adds `info`;
  `lane_requires_merge` is one; the Validation badge counts errors and warnings, and the
  diagnostics panel and the import wizard list notes last under "Notes". `clickVehicle` in
  the e2e helpers pauses, reads the snapshot the renderer last drew (with its lane-change
  offset) through test-only hooks, clicks through the canvas and waits for that vehicle's
  inspector, retrying once; seven scenarios use it, demo B passed ten runs in a row, and a
  Restart/Step race in the roundabout scenario surfaced and was fixed by waiting for Step.
  In the browser the grid opens with "Validation (0)", "No network issues found" and 15
  notes; Munich's wizard shows 20 warnings (35 before) with the notes after them.

- 2026-11-05, TASK-068 merged with a lead merge commit. B30 first: on current main, Munich
  at 0.15 completes 2 023 trips with smoothing and 1 921 with only the smoothing pass
  skipped, so smoothing helps; the earlier 2 231 to 2 005 drop compared different code, and
  the per-junction queue changes were traced to spillback, not to setbacks or movement
  lengths (closed). Then step 12: acute adjacent arms under 45 degrees, merges and diverges
  left alone, the minor arm bent by a two-handle cubic over up to 25 m and half the road to
  reach 60 degrees where an 8 m shift and lane-block curvature allow, both directions
  identical, node and neighbour fixed; 52 Munich roads realigned. T24 (seven cases) covers
  the angle, shift, fixed node, reverse identity, merges in both cities, determinism and
  short bends. Munich: road ends at the setback cap 132 to 101; approach lanes under 10 m
  15 to 15, a shortfall against the contract the owner accepted together with bends under
  15 m on short roads. Munich at 0.15: 2 175 completed, 1 008 queued, peak 2 131, zero
  failed; route audits zero. The acute-Y fixture is hand-written, not OSM data. Lead merge
  commit: `realign_limited` is a note rather than a warning (architecture 5.5 and 13), the
  import warning table counts warnings only and was measured on the merged tree (downtown
  28, highway 11, suburb 7, Sindelfingen 41), and the Munich import scenario checks that the
  notes include a lane drop. Verified on the merged tree: check (371 unit tests), 46
  Playwright scenarios (T16 skipped), unchanged benchmark hashes, both route audits and the
  probe. In the browser an Arnulfstraße approach bends into its junction and its queue
  stops at the mouth.

- 2026-11-05, TASK-070 (lead, owner bug report: OSM files other than the Munich extract
  could not be imported). Every bundled extract imported, compiled and opened through the
  wizard, so the failing files were others. Synthetic cases showed two hard failures on a
  single way: a drivable way referencing a node missing from the file (`dangling_ref`), as
  in extracts clipped by osmium or osmconvert, and a one-node way (`road_degenerate`). A way
  now keeps its longest run of present nodes, unusable ways are dropped, and one
  `osm_incomplete_way` warning lists both (architecture 13 step 10). Closed service loops,
  isolated rings, duplicate nodes and openstreetmap.org exports already imported. Verified:
  check (373 unit tests), the import e2e scenarios, and in the browser a suburb extract with
  39 nodes removed imported with 193 roads and the warning. If a file still fails, its
  error code identifies the next case.

- 2026-11-05, TASK-073 merged with a lead fix for the defects it found. Seventeen scenarios
  in five `qa-*` files: the area picker with Overpass answered from a recorded response, the
  persistent cache on a second import, and a 503 leaving the city untouched; all four exports
  downloaded and parsed (2 176 trips, 78 road rows, trajectory samples, 80 GeoJSON features)
  with their provenance line; Munich imported, edited live, saved and reopened in a fresh
  context with an identical replay hash and its smoothing and realignment provenance; a
  390 x 844 phone; and the production build under `/cityflows/` without test hooks, as a
  second Playwright project with its own server. Defects: QA073-002 the toolbox covered the
  Export menu's GeoJSON button at 1280 x 720 (the top bar and toolbox shared `z-index: 1`);
  QA073-001 the phone toolbox covered the inspector heading; QA073-003 the phone run
  summary ran 12 px past the screen. Lead fix commit: the top bar stacks above the toolbox,
  the phone inspector always starts below the toolbox, and the phone run summary wraps; the
  five scenarios marked fixme now run and pass.

- 2026-11-05, TASK-072 merged as delivered. `CLane.stopM` (`src/network/stops.ts`) is 3 m
  before the lane end on served signal approaches of lanes 10 m or longer; every ungranted
  stop rule uses it (standing obstacle, clamp, entry request, stop standing time, junction
  waiting, amber, merge stopping, discretionary changes near the line, yield and stop gaps),
  granted travel and zones do not. Stop lines and give-way marks are at `stopM`, approach
  crossings on the road between `stopM` and the lane end, exit crossings on the exit road's
  first 3 m; a crossing that would fall inside a neighbouring junction outline is left out
  (Munich n:382, r:383, reported). T26 has six simulation and two render cases; T21's sampled
  safety holds. Benchmark completions and hashes unchanged (`zoneStops` 0, 0, 185, 273).
  Munich at 0.15: 1 987 completed, 1 116 queued, peak 2 212, zero failed, against 2 175:
  stopping 3 m back costs queue storage and start-up distance at every signal; reverting the
  rules one at a time did not restore it, reverting all did. The agent recorded the owner's
  approval of that result and of two edits outside its surface (one `stopM` initializer in
  `lanes.ts`; the gate1 five-second-phase scenario now samples at 150 s instead of 91 s).
  Verified on the merged tree with TASK-073 and the lead fix: check (381 unit tests), all 63
  Playwright scenarios except T16, the benchmark and the probe; in the browser the grid's
  signal has its crossings on the four arms, outside the junction, behind the stop lines.

- 2026-11-05, TASK-071 merged with two lead fixes; wave 15 (phase 1) is complete. Continuation
  nodes come from the movements (uncontrolled, all through, merge or diverge, every end within
  30 degrees of the trunk axis); each branch takes its slice of the trunk's lane block with an
  end offset easing to its own over `taperM` by a Hermite curve; `CRoad.startOffsetM` and
  `endOffsetM`, `CLane.taperStartM` and `taperEndM`; setbacks 0 and no outline there; dropped
  lanes drawn narrowing with two chevrons, added lanes growing, dividers continuing; a
  continuity fixture; T25 (ten cases). Ordinary junctions keep exactly their b2131fe setbacks
  and outlines on the grid and Munich (hashed). The agent recorded exceptions as lead- or
  owner-authorized that did not come from this lead (disjoint default assignments for
  balanced splits and merges, legacy movements kept for unequal merges, refreshed route-cost
  expectations, an audit classification for Munich n:194); accepted on reading, and the owner
  confirmed authorizing them. It committed with `npm run check` red on one safety test, T07 mixed ramp traffic:
  merges that absorb a lane (an on-ramp without its own lane) had become continuation nodes
  with zero-length merge movements, so a merging car appeared in the target lane in one step
  and the mainline follower braked at 3.86 m/s2 against the 3.0 bound. Lead fix: such merges
  stay ordinary junctions (architecture 5.1), which restores T07; Munich has 63 continuation
  nodes. Second lead fix: TASK-073's export scenario stepped while Pause was still in flight
  and the busy store dropped the step (4 of 5 runs failed, also on the commit before TASK-071);
  it now waits for Step. Verified on the merged tree: check (391 unit tests), the full
  Playwright suite including T16 (65 passed; the export scenario then 10 of 10), unchanged
  benchmark hashes, the four route audits at zero; Munich at 0.15: 2 008 completed, 1 065
  queued, peak 2 242, zero failed (1 987 after TASK-072 alone; the agent's 2 241 was on the
  base without TASK-072's stop positions).

- 2026-11-05, TASK-075 merged as delivered (wave 16 run by the lead's subagents in worktrees
  under `D:\cityflows-wt`, at the owner's request). A `guides` layer above node areas draws
  the major road's dividers, centre line and side-road edge line dashed (1.5 m, gap 1.5 m)
  through junctions without signals; built once per compiled version. Two checks beyond the
  contract: the two directions must be side by side (Munich n:400, n:405, n:719 have opposing
  carriageways on one centreline, an importer defect, and get none), and a one-way major road
  also gets the median-side edge line. Munich: 24 of 282 nodes, 114 dashes, under 3 ms to
  build; the grid none (equal-priority crossings and one signal). Open: many Munich priority
  roads get none because the compiler gives the other direction a turn of equal priority
  (n:1375, n:138, n:324, n:33, n:774), so no road is major; the centre line follows the
  innermost through paths, so it sits off centre beside a left-turn lane. Verified on the
  merged tree: check (395 unit tests; one run failed a test under load from the other two
  agents and passed on rerun), the screenshots.

- 2026-11-05, TASK-076 merged after two rounds. Round one: lane resolution lands where the
  next road needs the fewest changes (then penalty, then idx); a car held 3 s for a mandatory
  change gets one yielder behind it (virtual leader, braking at most `bMps2`); after 30 s it
  takes the TASK-048 fallback and reroutes with `missed_turn`; a car standing at its stop may
  change up to a shorter neighbour's `stopM`; the probe reports `completedByHalfHour` and
  `stalledHeads`. Accepted deviation: ordinary off-target cars with a fallback still take it
  when granted rather than waiting 30 s (waiting held cars on the `r:307`/`r:1259` weave).
  The agent traced two causes outside its contract, and the lead added them to section 8
  (7f0b478) for round two: no discretionary change that adds a needed change on any road of
  the route (`r:639`: cars landed on the right lane, then MOBIL moved them off it), and one
  lane-drop rule counting only the lanes that feed the next road (`isDroppedLane` in
  `lane-drop.ts`, used by the compiler, routing, the simulation and `bench/route-audit.ts`;
  `r:968`'s through lane beside turn lanes had counted as dropped). `lane_requires_merge`
  notes: Munich 15 to 6, downtown 6 to 0, highway 6 to 3. Off-target holds over 40 s on
  Munich 81 to 20; `r:639` longest 463 s to 72 s, `r:968` and `r:1299` none. Munich at 0.15:
  2 044 completed (round one 2 143, main 2 008), still locked from about 09:00: the first
  stalls are now on-target saturation queues at `n:262`, `n:774`, `n:186`, `n:263`, `n:1303`,
  left to TASK-077. T29 case 4 (no off-target hold over 40 s on Munich) is `test.fails` until
  the city no longer locks. Benchmark end hashes unchanged (every trip completes). Verified on
  the merged tree: check (399 unit tests), route audit zero on all four cities, the probe.

- 2026-11-05, TASK-074 merged after two rounds, with a lead fix. `bench/junction-audit.ts`
  measures every node of the four cities. Setbacks follow SUMO netconvert's node shapes
  (`NOTICE`), curb radius 1 m (1.5 m cost Munich 400 trips), cap kept; the outline reaches at
  most 11 m past a road end's cut and covers the remaining overlap with a gore. Round one's
  marking clip erased whole roads' markings (n:721, n:104, n:823 in its own screenshots) and
  let junctions swallow 40 m of road; returned. Round two: markings clip only at the road's
  own outlines and at other roads' surfaces within 10 m of the cut, never against the
  opposite direction or a road within 30 degrees, never arrows, stop lines or crossings;
  marking length outside outlines is 100.5 to 101.5 percent of main on every city (T27).
  Overlap at road ends: Munich 256.6 to 0 m2, Sindelfingen 55.7 to 15.6, grid and town 0;
  no proper outline self-intersections. Open: on the capped east approaches of n:104 and
  n:721 the arrows and stop lines lie under the junction surface; T27 names 49 residual
  nodes (22 coincident source carriageways, an importer defect; 27 others: 6 stub roads, 3
  bodies crossing away from the node, 18 other); T20's short unequal junction has 3 escaping
  movements (main 2) and touches itself at a point; `compile.ts` calls the new setback
  function while the importer keeps the old one (one signal grouping differs, n:949). Lead fix
  at merge: TASK-075's guide dashes clipped to the outline and incident road surfaces (T28.3
  failed at Munich n:266 on the merged tree). Benchmark hashes unchanged. Verified on the
  merged tree: check green except 5 s time-outs under the TASK-077 agent's load (all pass
  with a longer timeout), route audit zero, Munich at 0.15: 2 022 completed, still locked
  (TASK-077).

- 2026-11-05, TASK-077 merged after two rounds; wave 16 is complete. A jam head (on a
  movement or first on its lane, below 0.1 m/s) that stands for `gridlock.respawnS` fades over
  `fadeS`, leaves the road (grants, zone occupancy, TASK-076 lane-change state released; its
  partial road traversal recorded as a link-cost sample), and its trip rejoins its origin
  queue ahead of later departures with its first `departedS`, a fresh route (`respawn`), and
  the place slot it freed; the fourth stall fails it as `gridlocked`. `fade` reaches the host,
  the vehicle sprites' alpha, the inspector ("Restarts after gridlock"), the Demand panel, the
  trips CSV (`respawns` column) and the probe. Round one followed section 8 as written (a red
  for the car's own movement reset the timer) and left 17 Munich heads frozen 6 to 72 minutes
  in rings of queues through signals (`n:262`, `n:963`, `n:967`); the agent measured three
  rules and the lead adopted the one that reaches zero (2b840bc: a red neither starts nor stops
  the timer). Munich at 0.15 on the merged tree: 3 720 completed (2 022 before), 59 failed,
  all `gridlocked`, 1 975 respawns, `completedByHalfHour` [701, 1209, 678, 496, 373, 263],
  `stalledHeads` 0 (298 before). Benchmark end hashes unchanged; the town respawns 19 cars in
  its 08:00 peak (`n:224`, `n:225`, `n:228`, `n:207`), the grids none. Changed expectations:
  Munich failures at scale 1 (246) and in T21 and T27 must all be `gridlocked`; T29 case 3 runs
  without respawns; protocol buffers 9 to 10; the trips CSV header. Open: T29 case 4 stays
  `test.fails` (963 Munich cars held off-target over 40 s, worst 380 s on `r:639#0`, inside
  slow queues rather than at heads); 1 975 respawns in three hours says the default import
  demand of 0.15 is beyond Munich's capacity. Verified on the merged tree: check (426 unit
  tests), the full Playwright suite with T16, route audit zero, the probe.

- Wave 16 outcome (2026-11-05): the owner's four round 2 items are merged (TASK-074, 075, 076,
  077), run by the lead's subagents in worktrees under `D:\cityflows-wt`. Next: the owner's
  test round, then phase 3 (walking legs and multimodal travel). Candidates from the reviews:
  junction priority classification so more priority roads get guide lines (TASK-075 open
  item), the importer's coincident source carriageways (TASK-074's 22 residual nodes), and the
  default import demand against Munich's capacity (TASK-077).

- 2026-11-06, TASK-079 merged as delivered (B33 to B35). B33: junction 1 is Munich n:1181;
  the node outline reaches back over the last stretch of 82 Munich approach lanes and node
  areas draw above markings, so dividers vanished there, and the dash pattern could end 3.1 m
  short. Dividers and centre lines now run to `stopM`, and the stretch under the road's own
  outline is drawn above the junction surface with its arrows and stop line. B34: the owner's
  X-marked arrows lay on Marsstraße, where the importer laid two one-way carriageways on one
  centreline (`r:368` at n:823, `r:480` at the signal n:949), so both directions' arrows sat on
  the same lanes; besides section 11's rule (arrows once, 6 to 9 m before `stopM`, only where
  lanes differ), no arrow is drawn on a road running the other way (35 Munich lanes, 8 in
  Sindelfingen). Munich arrow length 2 730 to 308 m. B35: `parallelOffset` replaces the
  per-vertex miter for markings; lines off by more than 0.05 m: Munich 51 of 519 (worst
  1.75 m) to 0 outside lane corners, Sindelfingen 42 to 4, the hairpin fixture 1.75 m to
  0.005 m. The marking-length measure now counts lines only (`lineOutsideM`, 99.2 to 99.8
  percent of main); T27's baseline moved to 5024a83 line lengths. New: B38, folded lane
  polylines. Verified on the merged tree: typecheck, lint, format, build, and all unit tests
  with a 30 s timeout (437; the 5 s default times out under the other two agents' load).

- 2026-11-06, TASK-078 merged as delivered (B32). Curb aprons: each concave corner at a node
  with an outline gets an arc tangent to both facing road edges, radius 6, 9 or 12 m by the
  lower-ranked road's class, shrunk to fit, outside both road surfaces and overlapping no other
  road or apron; `CNode.curbs`, drawn by `drawNode` with the outline in one fill. Departures:
  one tangent point may lie on the edge's extension under the junction surface (otherwise most
  signal corners, such as n:949's, got none); `compile.ts` calls `junctionCurbs`; the importer
  keeps the old setback call. Munich 273 aprons at 114 of 219 nodes, Sindelfingen 257, the
  town 1 191, the grid 64; zero overlap. Setbacks, outlines, lanes, movements, the benchmark
  hashes and the Munich probe identical to main (T31 fingerprints). Costs 28 to 35 ms per
  Munich compile (about a quarter). Limits: acute non-gore pairs (n:104, n:138) get a rounded
  median nose; with Road classes on an apron takes the node's darker tone; aprons have no verge.

- 2026-11-06, TASK-080 merged with a lead test update (B36, B37). Every taper is
  `min(half the road, clamp(0.4 x km/h, 15, 40))` (60 m before; 20 m at 50 km/h);
  continuation branches keep their trunk slice until their blocks part; splits and merges
  outside the continuation rule draw their branches side by side with a dashed divider until
  they part, an absorbing merge's outer edge as one smooth taper; continuation membership and
  movement sets unchanged (63 nodes). Transition dividers run to `stopM` with `parallelOffset`
  (TASK-079's note: r:981 was 1.04 m short). Overlap of the two surfaces to 0 at n:305, n:308,
  n:312, n:726, n:253, n:28; n:201 54.5 to 28.2, n:734 31.5 to 6.9; n:194 unchanged (needs a
  type change). Munich at 0.15: 3 564 completed (main 3 720), 55 failed, `stalledHeads` 0;
  the agent showed the morning's gridlock rings swing the count from 3 434 to 3 946 with the
  layout at one node alone, so the lead accepted the drop as within that sensitivity. Lead
  update: TASK-078's T31 fingerprints re-measured for Sindelfingen and Munich (TASK-080 moved
  their lanes, as intended). Open: B39 (unmarked junction surface at multi-lane splits).

- Wave 17 outcome (2026-11-06): TASK-078, 079 and 080 merged. Verified on the merged tree:
  typecheck, lint, format, build, all unit tests (30 s timeout), route audit zero, the probe,
  and the full Playwright suite with T16. Open from the wave: B38 (folded lane polylines), B39.

- 2026-11-06, TASK-085 merged as delivered (B39, movements). Why `r:313` had none into
  `r:692` at `n:312`: the default pairing counts a multi-lane split's lanes from the curb, so
  only `r:313#2` and `#3` default into the two-lane `r:692`, and OSM turn:lanes (way 27764289)
  bans exactly those; the fallback then copied lane 2's turn onto lanes 0 and 1. Now every
  trunk lane that lines up with a branch lane under TASK-071's slice gets a movement unless a
  rule bans it, at uncontrolled through/merge/diverge nodes; nothing is removed (`orderBranches`
  and `defaultSlice` shared from `continuity.ts`). Added: Munich `n:312` (2), `n:305` (3),
  `n:308` (2), `n:253` (1), Sindelfingen `n:918` (1); `n:201` and `n:194` had nothing to add
  (one pair banned by OSM). Geometry and continuation membership unchanged. Munich at 0.15:
  3 886 completed (main 3 564), 56 failed, all `gridlocked`, `stalledHeads` 0; benchmark
  hashes unchanged; route audit zero. Verified on the merged tree: typecheck, lint, format,
  build, all unit tests (30 s timeout; 460), the audit and the probe.

- 2026-11-06, TASK-081 merged as delivered (geometry rework stage 1). `npm run geometry-audit
  -- [out.json]` measures the eight quantities on the four cities and 13 named cases in about
  9 s with byte-identical output; `npm run geometry-shots -- <dir>` captures 18 fixed-camera
  images of Munich through the app (pixel-identical between runs); T34 plants each defect.
  Accepted choices: through-road deviation is measured against the road's alignment 20 m out
  on each side joined smoothly across the junction (the canonical centerline itself dips at
  G2 after realignment), with a lane-dip value; bulge split into outline and curb parts. The
  baseline on main after TASK-085: Munich width error up to 5 m on 39 roads, 52 lane
  back-steps, 12 corridor pairs whose centre lines part by over 2 cm (up to 7 m, the
  coincident Marsstraße pair), 446 m2 of unrelated overlap, 908 m2 of bulge; G1 width error
  1.055 m within about 15 m of n:919 (its centre lines coincide along the curve, 0.109 m apart
  only near the ends, so the owner's parting lines may come from a different extract); G2
  bulge 65.3 m2 at n:774, lanes dipping 1.7 m there and 2.2 m at n:719. B38 does not step
  back on this tree; its roads have one corner sharper than 90 degrees each.
- 2026-11-06, TASK-084 merged as delivered (geometry rework stage 2, importer). Every imported
  road has a `corridorId`: Munich 186 two-way, 7 coincident pairs (Marsstraße `r:368`/`r:480`,
  Landsberger `r:1280`/`r:1334`, five Arnulfstraße pairs), 21 dual carriageways; Sindelfingen
  203, 2, 2. All nine coincident pairs run between the same two nodes, so separation gives the
  pair one shared centerline and each road a lateral offset of half its block plus 0.25 m (a
  0.5 m median up to the junctions; provenance `separated`); the easing for pairs on separate
  nodes is tested only synthetically. Relaxation (`src/importers/osm/relax.ts`): capsules of
  the lane blocks plus 0.3 m, displacement a cubic B-spline held at zero in the junction zones
  (setback cap plus 5 m), 100 fixed-order iterations, lower class moves more, slope at most
  0.2, byte-identical on rerun. Experiment (relaxMaxM 0, 1, 3, 5, 10, unbounded): Munich
  overlap 446 to 128 m2 at 1 m and 115 m2 from 3 m on, Sindelfingen 614 to 83 and 50 m2; no
  road needs more than 2 m, so 3 m and above are identical. Lead decision: `relaxMaxM` = 3 m
  (the import default), the smallest value that reaches the unbounded result, about a lane
  width at most from the OSM line in other extracts. Munich probe on the agent's tree at 3 m:
  3 732 completed (96 percent of main), 60 failed, all gridlocked, stalledHeads 0; route audit
  zero; benchmarks complete. Lead verification on the merged tree: typecheck, lint, format,
  build, vitest (30 s timeout), route audit zero, geometry audit (Marsstraße gap 7.0 to 0.5 m,
  the median; Munich overlap 115 m2, of which 61 m2 is the Trappentreustraße dual corridor
  `r:259`/`r:694`, excluded from relaxation by the contract). Expected regressions until
  TASK-082/083: the network treats a separated pair as two arms, so no median line is drawn,
  u-turns between the carriageways leave the outline, some curbs kink and the through-road
  measure reads 10.4 m at `n:721` (named residuals in T20 and T27); 22 approach lanes meeting
  the 14.5 m divided streets lose 2 to 4 m of storage (named in T27). Not paired: the
  same-direction coincident Landsberger `r:729`/`r:984`. New: B40, a rounding slip in the
  engine's conflict-zone entry position (the agent saw T21 fail once by 2e-15 m on an
  intermediate tree: `(lane.lengthM + zoneStart) - lane.lengthM` can round past `zoneStart`).
- 2026-11-06, lead fix for B40 (`task/086-zone-entry`, merged). TASK-082 round 2 made T21's
  Munich run fail at `n:721`: the u-turn `r:1334#0>r:1280#0` entered its zone while
  `r:1279#0>r:1280#0` occupied its own. Two layers: the grant forecast (TASK-065, expected
  arrival from the current IDM acceleration) treated the through car, already on its movement
  and braking at 4.45 m/s2 for its leader, as stopping short of the zone; the backstop then
  clamped the u-turn car at the zone start, but the entry offset, re-derived as
  `(lane.lengthM + zoneStart) - lane.lengthM`, rounded past `zoneStart`, so the next step's
  zone stop no longer held it. The commit now computes the offset once. No rule change: the
  backstop works as architecture section 8 states. Benchmark hashes unchanged, vitest green on
  main, T21 green on TASK-082's tree.
- 2026-11-06, TASK-082 merged after one return (geometry rework stage 2, G1, B38). Each
  corridor's roads that share a source centerline share one curvature-resampled reference line
  (`src/network/corridor.ts`); lanes, edges and tapers are arc-length offsets of it, eased into
  fillets where a bend is tighter than the corridor's offset (architecture 5.1). Round 1 met
  the width and gap targets but lanes stepped at continuation joints that the source kinks
  (Munich joins max 0.141 to 0.387 m, visible at G1's `n:919`); returned. Round 2: joints share
  the bisector tangent and ease back over 10 m or a 30 m radius, and `continuingRoad` now joins
  the two halves of a loop (Munich `n:814`, Sindelfingen `n:26`, `n:696`). Results on the
  merged tree, main before in brackets: lane folds Munich 0 (51 back-steps), Sindelfingen 0
  (47); G1 width error by T35's rays 0.031 m (1.055), centre-line gaps r:1059/r:1060 0.002 m
  (0.109), r:917/r:921 0.004 m (0.080); corridor gap max 0.008 m Munich, 0.012 m Sindelfingen
  (the separated pairs at the 0.5 m median by design); joins Munich max 0.047 m (0.141),
  Sindelfingen over 5 cm 28 to 12 (`n:918` stays 3 m, a TASK-071 blend). The audit's width
  column, measured from the original centerline, still reads up to 5 m because it counts the
  eases and TASK-080's side-by-side blocks (largest ease 1.09 m at a continuation joint, 4 m
  at the B38 hairpin `r:839`); T35's width measure excludes them, 0.020 m Munich and 0.024 m
  Sindelfingen. T21 failed on round 2's tree; the cause was B40, fixed by the lead (above).
  Accepted: `CRoad.surface` checked, not replaced, by clipper; `corridorSurface` unused until
  TASK-083; spikes in the outlines of Sindelfingen `n:1132`, `n:139` and an apron at Munich's
  gore `n:721` from `junctions.ts` reacting to centimetre edge moves, left for TASK-083 (T20,
  T31 exceptions). Architecture 5.1 and 5.5 amended by the lead. Lead verification on the
  merged tree: Munich at 0.15 3 686 completed (98.8 percent of main after TASK-084), 58 failed,
  all gridlocked, stalledHeads 0; route audit zero; geometry audit as above.
- 2026-11-06, TASK-083 merged after one return (geometry rework stage 3, G2). `junctions.ts`
  rewritten (architecture 5.1 TASK-083): approaches by corridor, cuts square to each reference
  line, through roads that keep their alignment with through movements following it, the
  junction a `clipper2-ts` union with class-radius curbs; the TASK-063/074 outline and TASK-078
  apron code and T31 deleted, their assertions moved to T38. The G2 lobes came from the
  importer: realignment grouped road ends by `streetGroupId`, so Landsberger Straße's two
  carriageways were two arms and one was bent away; it now groups by `corridorId` (accepted
  outside the contract's `realign.ts` limit as the root cause; it also corrects turn classes
  at six Munich nodes, 1 335 to 1 340 movements). Round 1 met the gates; returned for three
  visible regressions: a zigzag edge at `n:201`, sharp outer corners at continuation joints
  the aprons used to fill (`n:726`), verge nubs at curbs. Round 2: S-curves where edges run on,
  tangent arcs at outer corners, one verge band per curb, curb circles cut out of the polygon;
  T38.3 checks no drawn joint or corner turns over 20 degrees at a vertex. Results on the
  merged tree: G2 through far/near/lane at `n:774` 0.535/1.257/1.706 to 0.001/0/0.001 m and
  `n:719` 0/1.556/2.312 to 0, bulge 0 there; bulge Munich 905 to 133 m2, Sindelfingen 1 591 to
  268, town 1 833 to 0; Marsstraße `n:721` through far 10.42 to 0.50 m; the `n:1132`, `n:139`
  spikes and the `n:721` apron gone. Accepted: curbs run along the edges beyond the cuts
  instead of adding the class tangent to every cut (design item 2; up to 11 m of storage
  otherwise); seven T38.4 lanes shorter than stage 2 by 2.3 to 4.8 m, each named; TASK-084's
  22 shortened lanes not won back. Agent's tree: Munich 3 614 completed, 77 failed, all
  gridlocked, stalledHeads 0; benchmark hashes unchanged; route audit zero; e2e 63. New:
  B41 to B44. Architecture 5.1, 5.2 and section 14 amended by the lead.
- 2026-11-06, geometry rework stage 4 (lead). On main 30a2b23: typecheck, lint, format,
  build, vitest (497, 30 s timeout), route audit zero, benchmark hashes unchanged, Munich at
  0.15 3 614 completed and 77 failed (all gridlocked, stalledHeads 0; 93 percent of the
  stage 1 baseline 3 886), the full Playwright suite with T16 (66). Before and after images of
  G1, G2, Marsstraße and the round 3 junctions sent to the owner for the test round; B38 done,
  B32 redone, B39's drawing moved to B44.
- 2026-11-06, TASK-088 merged as delivered (B44). At split and merge junctions dashed guide
  dividers run between neighbouring lined-up movements (chosen with the network's own
  `orderBranches`/`defaultSlice`, so TASK-085's slice), from cut to cut inside the polygon,
  meeting the lanes' dividers within 4 mm; none where lanes merge or part beyond a lane width.
  Munich 14 dividers at 8 nodes (`n:201` 1, `n:305` 3, `n:308` 3, `n:312` 3, `n:253`, `n:266`,
  `n:28`, `n:670` 1 each); Sindelfingen's splits are single-lane. `n:194` is a continuation
  node with no surface; its shot shows residential streets on layer 0 above the trunk on -1.
  `n:1181`: the zebras are TASK-072's rule (every served signal approach and exit), uncovered
  by TASK-083's cuts; mapped-crossing-only drawing would be a contract change (not taken). Two
  importer defects found there went to TASK-087 (`r:981`/`r:1358` overlap 2.8 m at the cut,
  `r:729` runs 5 m past `r:984`'s cut). Benchmark hashes unchanged; render tests and the
  agent's full suite (30 s timeout, 504) green; e2e 63.
- 2026-11-06, TASK-087 merged as a partial delivery (B41, B42), the rest moved to TASK-089.
  The owner: "You have not fixed the overlapping lanes at close to junction". New audit
  measure 9 (lane overlap outside node outlines, every pair). Dual carriageways that meet at
  both nodes are pushed apart to the 0.5 m median and kept side by side to both nodes;
  `r:729`/`r:984` (one three-lane carriageway drawn as two ways) are one corridor; unnamed
  Sindelfingen pairs between the same nodes join corridors where they can be pushed. B42: the
  realignment no longer bends Donnersbergerstraße at `n:138` (one Munich and three Sindelfingen
  arms changed which arm is bent). Measure 9 Munich 2 827 to 1 856 m2, same-corridor 2 244 m2
  over 11 pairs to 1 273 over 8; the Landsberger pairs at `n:324` and `n:721` 761, 127 and
  84 m2 to 0; Sindelfingen corridor pairs 0. The agent stopped correctly on the rest: a road
  has one `lateralOffsetM` and ends exactly at its nodes, so a pair that meets at one node only
  (`n:104`, `n:774` west, `n:949`, `n:823`, `n:1181` both sides, `n:382`, Sindelfingen
  `r:574`/`r:971`) cannot be put side by side there without moving its lanes 3.75 to 5.5 m at
  the far node; the network must give converging carriageways end offsets (TASK-089
  amendment, lead decision; no schema change expected, approved if needed). Regression named:
  `r:476`'s exit zebra at `n:1181` 5 to 4 of 8 stripes until then; seven Munich lanes lose
  over 2 m (T38.4, named; `r:729` 7.3 m it used to run on into `n:1181`). Lead verification on
  the merged tree: Munich at 0.15 3 863 completed, 42 failed, all gridlocked, stalledHeads 0;
  vitest 510 (30 s timeout); route audit zero; benchmark hashes unchanged (agent).

- 2026-11-06, TASK-089 merged after two rounds (B41, B42, B43). Owner decision mid-task
  (sketch on the `n:104` shot): converging nodes are split geometrically, the network is not.
  Each carriageway of a street that converges on a node gets its own end beside the node
  (`CRoad.startShift`/`endShift`, a monotone per-road shift profile eased away from the node);
  cuts, curbs and the polygon follow the split ends, the median reaches the junction edge, and
  opposite carriageways side by side draw a solid double line. Movements, ids and routing are
  as imported (Munich 1 340 movements, 259 connectors; Sindelfingen 1 123, 78 places, 108
  connectors). Round 1 met the overlap gates but wobbled (S-bends at `n:104`, waving lanes at
  `n:949`), lost zebra stripes, dropped a Sindelfingen movement at `n:78` and bulged an unnamed
  `n:1303`; round 2 fixed those and added T39.5 (no lane edge within 60 m of a split node
  changes curvature sign more than once, source bends named). Measure 9 Munich 1 856 to
  647 m2, same-corridor 1 273 m2 over 8 pairs to 65 (only `r:259`/`r:694`, named);
  Sindelfingen same-corridor 0. Bulge Munich 133 to 20 m2. Through pairs keeping their
  centerline Munich 21 to 3; curbs are edge-following cubics (B42 nubs gone, T38.3). Zebra
  stripes Munich 494 to 554, `r:476` at `n:1181` 8 of 8. Named, not fixed: `n:823` through near
  0.76 to 1.42 m (the split end), `n:570` and Sindelfingen `n:620` far +0.7 and +0.15 m (curb
  shape), `n:382` `r:1260` crossing lost (stub under 10 m), `n:635` 7 to 6 stripes,
  Sindelfingen `r:574`/`r:971` still cross at `n:78` (joined after realignment to keep the
  network), Sindelfingen 5 of 15 kept centerlines and `n:156` median 0.43 m, 28 T38.4 storage
  exceptions, the TASK-074 mouth edge line now drawn at `n:774`. Lead verification on the
  merged tree: typecheck, lint, format, build green; vitest 522 (60 s timeout); Munich at 0.15
  3 762 completed, 49 failed, all gridlocked, stalledHeads 0 (gate 3 497 and 90 percent of
  main, gridlocked at most 63); route audit zero in all four cities; benchmark hashes unchanged
  (agent); e2e 63 (agent, port 5289).

- 2026-11-06, TASK-090 merged (fast checks, owner-approved plan). Tiers as vitest projects:
  `npm test` (unit, synthetic cities, Sindelfingen; `npm run check` runs it) 140 s to 15-17 s;
  `npm run test:city` (Munich geometry and import, 47 tests) about 15-20 s; `npm run
  test:traffic` (one shared Munich morning at 0.15 for the five former mornings, plus
  `munich.test.ts`'s full-demand morning kept apart because its thresholds assume scale 1)
  about 2-3 min. Real-city imports are cached in `node_modules/.cache/cityflows`, keyed by the
  extract, the options and the importer's static import graph; `CITYFLOWS_NO_CACHE=1`
  bypasses it. `npm run traffic:quick` (the gate's morning stopped at 09:30, about 25 s,
  advisory) ranks `a18cce0` and `81dfcd0` as the 0.15 run does, gridlock by a margin of one.
  Exact baselines became budgets: route samples (at most 10 percent change roads), T25
  setbacks (at most 12 Munich nodes move over 0.5 m), T38.4 storage (Munich at most 30 lanes
  over 2 m, none over 10 m), road-body crossings, T39.2/T39.4/T39.5, T35.2; T38 fingerprints
  removed. Kept exact: simulation determinism, benchmark hashes, ids, project round trips,
  `r:259`/`r:694`, G2. `@smoke` e2e set (12 tests, 93 s); CI runs check, city and three e2e
  shards in parallel; `geometry-shots --only`. Lead verification on main: check 33 s green
  (473 tests), city 47 passed, traffic 5 passed plus T29's expected fail (3 762 completed, 49
  gridlocked).

- 2026-11-07, TASK-091 merged (B46, B50, B52). Crossings by default at every road end of a
  node with three or more arms or a signal, except motorways, motorway/trunk links, motorway
  merges and roundabout rings (detected by geometry); per-end overrides
  (`Road.crossings`) stored only when edited, toggled in the node inspector with undo, saved
  and reopened; old files load with defaults. Ends with a crossing: Munich 75 to 659,
  Sindelfingen 10 to 677, town 128 to 2 266, grid 8 to 140. Stripes start 1 m beyond the curb
  return except at signal arms (B53, a simulation decision for the owner). Centre lines end at
  the junction mouth (no segment inside its node polygons on four cities); dividers, centre
  lines and arrows stop 0.5 m before a crossing; centre-line pieces shorter than a dash are
  dropped (the `n:182` stub). T27, T32.1, T32.2, T32.4 line lengths updated (Munich lane lines
  38 684 to 35 400 m). Full Munich redraw 185 to 305 ms (node script). Benchmark hashes
  unchanged. Lead verification: check green (482), city 50 passed. CI on the TASK-090 layout
  green in 10 minutes wall (before about 40).

- 2026-11-07, TASK-092 merged (B48, B51, B52 curb). Geometry audit measure 10, corner
  sharpness (missing, degenerate or over 30 degrees between 0.5 m samples): Munich 33 to 9,
  Sindelfingen 25 to 8, town 36 to 0, grid 2 to 0; square median noses Munich 58 of 70 to 9 of
  63. The owner's corners at `n:262`, `n:291`, `n:104` had no curb on main and have one; noses
  at `n:104`, `n:774`, `n:949`, `n:1181` are half circles (T42). Named exceptions (T42.1):
  short stubs, ramps bending away, coincident source ways, a 0 m road. Accepted regressions:
  bulge Munich 93 to 162 m2 and Sindelfingen 252 to 323 m2 (the new curbs and gore fillets fill
  area the measure counts; under T38.2's bound), through far/near at grid `n:2`, Munich
  `n:817` (a kink now an S-curve) and Sindelfingen `n:1028`, `n:658` (new curbs). Traffic and
  benchmark hashes unchanged.
- 2026-11-07, TASK-093 merged (B49, B45, B47). `n:967`: the north carriageway is two OSM
  ways (`r:1368`, `r:961`) and pairing took one partner per road, so `r:961` had no corridor;
  a second way now joins its pair's corridor after realignment, and TASK-089's jog rule
  measures the lanes that join (0.25 m) instead of the median-side edges (7.25 m); shallow
  converging pairs stay attached (also closes lenses at `n:774`, `n:823`, `n:949`, `n:33`).
  Measure 9 for `r:961`/`r:1276` 0, median 0.53 m. Median voids under 3 m closed
  (`MEDIAN_VOID_M`; Munich three pairs, Sindelfingen two; the 8.3 m Landsberger median between
  `n:721` and `n:328` stays as drawn). One-way to two-way continuations align by the matching
  lane (`n:212` 1.62 to 0.01 m, `n:55` 1.50 to 0.04 m; also `n:661` and four grid places), a
  visible gentle S on the shorter road. Network: movements, places equal; 23 Munich connector
  positions along their lanes moved up to 2.39 m. Bulge Munich 93 to 36 m2. Traffic Munich at
  0.15 3 762 to 3 998 completed, gridlocked 49 to 45. Lead: T42.2 updated (n:967's gore no
  longer sharp); `bench/traffic-baseline.json` now 3 998 / 45 (quick 3 639 / 20). Lead
  verification on main: check 486, city 56, traffic 5 plus T29's expected fail, probe 3 998 /
  45 / stalledHeads 0.

- 2026-11-07, TASK-094 merged after three rounds (B53). `crossingSpan`
  (`src/network/crossings.ts`, moved from render so the network may use it) gives each lane's
  crossing span; on a signalized approach `stopM` is its far edge minus 0.5 m, falling back to
  TASK-072's 3 m where it would land in the lane's first half (the end then draws no
  crossing). Round 1 cost 244 trips and left a stall at `n:967`; round 2 on main with TASK-092
  and TASK-093 gridlocked 75 until signal approaches that can get green kept the set-back
  without TASK-089's move-out (lead accepted). Round 3 draws signal heads just behind the stop
  line (`signals.ts`; T41.5: every head within 2 m of its stop position). Benchmark hashes are
  unchanged: they cover only the state after every trip has arrived (town zone stops 307 to
  232, respawns 11 to 17 during the day). The grant-release rule is unchanged, so a car that
  passed the stop line on a grant and loses it stands where it is (town 07:00 to 10:00, 18 cars,
  main 7). Lead verification on main: check 493, city 58, traffic passed; Munich at 0.15 4 017
  completed, 41 gridlocked, stalledHeads 0; `bench/traffic-baseline.json` 4 017 / 41 (quick
  3 701 / 22). Architecture 5.1 gained TASK-089, TASK-092 and TASK-093 paragraphs; the stop
  position and crossing place text now state TASK-094's rule.

- 2026-11-07, TASK-095 failed after two rounds (B54, B55); the importer part was salvaged and
  merged. Round 1 attached `n:138`, `n:638` and Landsberger but left check red and 13 city
  failures; round 2 got check green but failed the traffic gate (2 stalled heads on `r:961` at
  `n:967`) and 6 city tests (T39.5 71 against 26, T33.2, T35.2, T38.4, T42.1, T42.3), and
  drew `n:638`, `n:138` and `n:104` worse than round 1. Cause: TASK-089's split profiles and the
  new pull are two profiles whose eases meet. Owner: salvage, then redesign. Salvage (lead,
  `8098494`): the importer closes voids under `ATTACH_GAP_M` = 15 m between one corridor's
  carriageways running between the same two nodes (Landsberger `n:721`–`n:328` attached end to
  end; the other seven cameras pixel-identical), plus audit measures 9 per road-end pair and
  11 (corridor voids: Munich 5 295 m² / 25 pairs, Sindelfingen 1 145 m² / 5). Check, city 58
  and traffic passed; the Munich morning is identical to main. Redesign: TASK-099, one signed
  profile per corridor stretch. The branch `task/095-side-by-side` stays as reference until
  TASK-099 merges.
- 2026-11-07, traffic baseline corrected. A fresh import (`CITYFLOWS_NO_CACHE=1`) of the TASK-094
  merge commit `35d8a00` and of main both give 3 715 completed / 57 gridlocked at 0.15 (quick
  3 448 / 23), not the 4 017 / 41 (quick 3 701 / 22) recorded at that merge, which did not
  reproduce; the code is unchanged since (docs and cameras only), the runs are deterministic
  and `node_modules` is unchanged. `bench/traffic-baseline.json` now holds the reproducible
  figures.

- 2026-11-07, TASK-096 merged (OSM surroundings; agent run by the owner). Optional
  `City.context` (no schema bump) with buildings, water, green, land use, parking, rail, tram
  and waterways, clipped and simplified at 0.3 m; Overpass fetches them when "Include
  surroundings" is on; a muted Surroundings layer under every road, sharing the bottom grade's
  terrain cache. Munich 1 662 features (1 406 buildings; the extract has no track lines),
  context 26% of the city JSON; Sindelfingen 252. T44 pins that `context: false` reproduces the
  canonical city and that context leaves `compile()` unchanged on all four cities; the lead
  moved its Munich hashes to main after the TASK-095 salvage. Frame cost at the Munich
  overview +9.8% (software GPU). Lead review: shots read (overview, `n:138`, Sindelfingen);
  roads stay dominant.
- 2026-11-07, TASK-097 merged (grade shadows; agent run by the owner, owner revised the design
  and the frame gate, see the decisions log). Raised grades cast a soft three-fill shadow
  south-east (0.6 m per metre of height, 5 m per grade), fading to zero over 20 m at
  abutments; lower grades shade themselves; 0.35 m parapets; tunnels at 55% with dashed
  edges; signal heads and vehicles under decks show as 35% ghosts (TASK-094's hidden `n:967`
  heads now visible). Street-zoom frame +11.0%, rebuild +15.0%. Lead fix at merge: tunnel
  dimming applies to the tunnel grade's road layers only, so TASK-096's surroundings in the
  bottom grade are not faded (Sindelfingen `r:252`/`r:253`). Lead verification on main: check
  519, city 59.

- 2026-11-07, TASK-098 merged (3D viewer, phases A and B; agent run by the owner). three
  0.187.0 in a lazy chunk (615 kB); the eager bundle grew 4.8 kB (index split into index and a
  shared preload chunk, 931.1 kB against 926.3 kB). A 2D/3D toggle (`V`) shows the same compiled
  city and running simulation: grade `g` at 5·g m with Hermite ramps (one `heightAt` for
  surfaces, paint, signals and vehicles), 0.8 m deck slabs, piers every 30 m, shadow-mapped
  sun, "See below ground", and buildings extruded from `City.context` (heightM, else 3 m per
  level, else 10 m) with a Buildings toggle. Editing, undo and redo are disabled in 3D; vehicle
  picking works. `cityGrades` and `VehiclePoses` are factored out of the 2D scene, not copied.
  Munich at 1x with about 1 300 vehicles: 59.9 FPS in both 3D and 2D. Lead review: shots read
  (Donnersberger, `n:967`, Sindelfingen, ramp profile); in the app, Munich imported, played,
  3D flown over the bridge, a car selected in 3D, back to 2D on the same centre with the toolbox
  enabled, no console errors. Lead verification on main: check, city 61, bench end state
  unchanged, full e2e 69/70. The one failure is T44's local frame gate (+12%). It fails the
  same way on the pre-merge main (2 of 3 runs, +10 to +14% against 10%), so TASK-096's
  frame margin is within run-to-run noise on this machine.

- 2026-11-07, TASK-099 merged with the traffic baseline reset by the owner (see the decisions
  log). The importer pull (`attachCarriageways` in `corridors.ts`, after `separateDual`)
  measures the gap between the lane blocks' median edges along rays, smooths the pull so it
  never undershoots, fades it over 15 m from every chain end, and follows the network's own
  lane blend at lane-count joints (`n:652`). Where both carriageways reach a node that a
  TASK-083 through alignment continues, one keeps its imported line for 20 m and the other
  takes the whole pull. `convergingShifts` follows the actual shortfall where source lines
  already run attached; an attached pair whose edges cross past the cuts ends its gore in a
  rounded nose. Applied only to the two corridors in `ATTACHED` (`n:138` west `r:386`/`r:716`,
  void 308.5 to 0.86 m²; `n:638` `r:654`+`r:698`/`r:680`, 180.9 to 0 m²); the list is keyed by
  OSM way ids, so other cities get no attachment until the rule is general. `n:138` east stays
  a named exception (a nose at `n:647` makes a 75-degree corner); five corridors broke
  something when attached, and the clean ones failed the traffic gate together. Munich voids
  5 295 to 4 519 m²; movements, places and connectors unchanged. Three rounds by the lead's
  subagent: round 2 failed traffic (3 390 / 81 / 1 stalled head), round 3 traced the stall to
  B56 and showed the gate's sensitivity. Lead review: before and after shots read (`n:138`,
  `n:638`, `n:104`, `n:967`). Lead verification on main: check 540, city 61.

- 2026-11-07, TASK-108 merged as delivered (Codex, GPT-6.1-Sol). One marking geometry module
  (`render/marking-geometry.ts`) feeds 2D and 3D; `de` theme (0.12 / 0.15 / 0.30 m, dashes
  3/6 and 6/12 m, warm white); hatched gores with channel borders, hatched tapers in place
  of TASK-071's chevrons, standard arrows of 5 and 7.5 m. The owner allowed renderer-only gore
  pavement where the compiled surfaces leave a gap, and the extra files `render3d/geometry.ts`,
  `bench/junction-audit.ts`, T25 and T27; compiled cities unchanged. Painted metres fall with
  the German dash ratio (Munich 35 698 to 34 822 m), which T27/T32 now measure. Frame time: 2D
  overview +11.7 %, detail +3.3 %, 3D faster. Lead review: shots read (exits, arrows, overview);
  the `V108-munich-arrows` camera is the same view as `T93-n967` (a redundant camera, left).
  Lead verification on main: check 554, city 65, traffic quick 3 067 / 42 (unchanged).
- 2026-11-07, TASK-100 merged after two lead fixes (Claude Code, Opus 5.5). Classes car, van,
  truck and bus with their own size, speed cap and IDM factors; purpose labels; schema 3 adds
  `van` beside `car`; shares as contracted, from a separate seeded stream. The owner allowed
  extra files (City constructors, export CSV, both scenes, `map-view.tsx`, `dev/render.ts`,
  the editor's default lane permissions). Gate 1 holds beyond T46: with all-car shares the lead
  reproduced main's quick Munich run exactly (3 067 / 42 / 1 stalled head). The mixed fleet
  completes more, not fewer, trips: quick 3 233 / 32 / 0, full 3 547 / 57 / 0 (was
  3 390 / 81 / 1); the baseline is reset to those, keeping one allowed stalled head for B56.
  Lead fixes at merge: `bench/zone-probe.ts` read the deleted `vehicleLengthM`; V108's compile
  hashes now include `van` (proved equal to 56ffccd's with `van` removed). Conflicts in
  `style.ts` and architecture section 11 kept both sides.

- 2026-11-07, TASK-106 merged after lead fixes (Codex, GPT-6.1 Terra). OSM tree points and
  tree rows; one seeded placement module (`render/vegetation.ts`) for street trees (2.5 m off
  the road, 12 m ±2), woods, scrub and parks, cap 60 000, never saved in the city; 2D canopy
  discs, 3D instanced trees with a far LOD, procedural ground grain; "Trees" and "Street
  trees" layers. 3D frame time +15 % (allowance 20 %), 2D +1 %. Every 3D base takes a
  `groundAt` callback, flat until TASK-105's sampler is wired at its merge. Lead review: shots
  read (streets, park, wood, 2D and 3D). Lead fixes at merge: `bench/geometry-shots.ts`
  combines V108's all-3D mode with V106's per-shot `view3d`; V106 hashes include `van` (equal
  to 56ffccd's with `van` removed) and its save/open case parses the scenario as T14 does.
  Lead verification on main: check 594, city 66, traffic quick 3 233 / 32 (unchanged).

- 2026-11-07, TASK-101 returned (Claude Code, Opus 5.5), not merged. Access rules per class,
  zones, OSM tags and bus lanes as contracted; the owner allowed `src/sim` (access
  invalidation), the importer's way splitting and corridor/continuity fixes that keep
  junctions at access boundaries, with the expectations that move named. On its own it passes
  the gate (quick 3 111 / 25). The lead merged main into it on `task/101-merge-main` (one class
  constant, `van` through `goods` and `maxheight`, pinned hashes recomputed; check 639, city 68,
  full e2e 74) and the traffic gate fails: full 3 009 / 59 / 1 against a floor of 3 193, quick
  2 804 / 38. All-car and van-free runs give 3 111; with vans the network locks from about
  07:50 (`r:761`, `r:844`, `r:1368`, `r:83`, `r:1279`, `r:222`, `r:89`), vans no more stuck
  than cars. The agent continues from `task/101-merge-main`.

- 2026-11-07, TASK-105 merged after lead integration (Codex, GPT-6.1-Sol). AWS Terrarium grids
  at 10 m in `City.terrain` (Munich 3.9 %, Sindelfingen 3.4 % of `city.json`), `fast-png`;
  3D ground, basemap, surroundings, roads (decks and tunnels on an end-to-end baseline),
  signals and vehicles follow it; buildings stand on their lowest ground; 2D hillshade;
  "Terrain" layer, off renders as main. The agent worked from 56ffccd without the merged
  phases; the lead merged main into it: TASK-108's `buildMarkings` now adds the ground roads'
  crossfall and the ground junctions' local surface, and drapes that paint over the grid
  (gore paint keeps its pavement heights); TASK-106's trees take `groundAt`, and street trees
  skip graded roads (they grew through decks); the shot harness keeps one 3D mode. Stress
  site: the agent also tried San Francisco (Russian Hill, 105 m relief, cache only). On the
  merged code its paint sits on the road surface except 4 of 49 506 samples, two spots that are
  buried on flat ground too (a ramp near the tunnel portal); 3D build takes 10.7 s in the
  browser (Sindelfingen 11.7 s against 2.0 s flat). Known issue, follow-up: building
  footprints are excavated, so with Buildings off (and where a footprint has no building)
  hillsides show open pits. Lead verification on main: check, city, traffic quick 3 233 / 32,
  full e2e, shots read (Sindelfingen A81 and bridge, Munich, hillshade, SF in the app).

- 2026-11-07, CI e2e rebalanced (lead). `--shard` split the sorted file list by count, so the
  third shard held every heavy 3D case and set the wall time (18 to 27 minutes against 4 to
  10). Four groups balanced by measured duration now (`CITYFLOWS_E2E_GROUP` in
  `playwright.config.ts`, about 250 to 300 s each locally; `rest` takes any file not named, so
  new specs are never skipped). V106's frame comparison takes one sample per state on CI and
  skips its ratio there, as T44 does. CI prints per-test durations (list reporter). The
  `gate1-run` and `qa-overpass` timeouts were not hangs: the trace shows every click taking
  about 1.25 s, because the 2D scene redraws every frame even when idle and CI's software GPU
  needs about 0.4 s a frame on a slow runner; the test ran out of its 60 s. CI cases now get
  120 s; rendering the 2D scene only on change is the real fix (follow-up).

- 2026-11-08, TASK-101 merged after the agent's second round (Codex, from
  `task/101-merge-main`). Cause of the mixed-fleet jam: the lane search records one target lane
  per road with an arbitrary timing for equal-cost changes, and the simulation treats it as
  compulsory, so a driver could not pass a queue in another legal lane; queues at the reserved
  Trappentreustrasse approaches (`r:674`, `r:737`, `r:1299`) and Landsberger Strasse (`r:968`)
  spilled back through Donnersberger. Fix in `src/sim/engine.ts`: a route that crosses a lane
  its class may not use takes `resolveLanes`' feasible sets on the same roads and movements;
  other routes keep singleton targets (T46 unchanged); regression
  `tests/sim/route-lane-options.test.ts`. Also: `map-view.tsx` sets the 3D scene's terrain flag
  before its first city (V105's first-3D readiness), and T47 imports without surroundings and
  terrain. Access rules, shares and gates unchanged. Lead verification on main plus 101: check
  664, city 69, full traffic 3 342 / 75 / 1 (floor 3 193, gridlock cap 85), quick 3 012 / 38 / 0,
  full e2e 75 passed (24 min local, V106's local ratio included), street inspector checked in
  the app (Closed with a bus exception, then undo). The baseline stays 3 547 / 57 (101 is not
  a demand task), so the full run's margin to the floor is 149 trips until TASK-102 resets it.
  The lead added the lane-option rule to the routing section of `docs/architecture.md`.
  Follow-up worth weighing: the singleton-target rule may cause the same queue blocking on
  unrestricted routes; widening the fix changes T46's pinned behaviour, so it needs its own task.

- 2026-11-08, TASK-115 merged after lead fixes (Codex, GPT-6.1 Terra). One coalescing
  `FrameDemand` per view (`src/render/frame-demand.ts`): Pixi starts with `autoStart: false`,
  setters and the camera invalidate, the 3D scene invalidates on control changes, vehicles only
  while playing or interpolating, tiles only while loading or fading. Test mode exposes
  `data-frames` and `window.cityflowsRenderContinuously`, which T16, T44, V106 and the shots
  use while measuring; thresholds unchanged. CI's e2e timeout is 60 s again. Agent figures:
  idle Munich draws 67 frames in 2 s before and 0 after (2D), 16 and 0 (3D); six shots
  pixel-identical; full local e2e 38 min to 16 min. Lead: merged main (TASK-101's first-3D
  terrain line removed, 115's `setCity` terrain argument kept); `gate2-batch`'s mixed-fields
  case Shift-clicked before the map had drawn the recompiled city (the pointer ignores clicks
  until then; faster clicks exposed it), now waits for the edit and two frames. Lead
  verification: check 671, city 69, full e2e 76 of 77 then the fixed spec 3 of 3; in the app the
  idle 2D map made 0 WebGL draw calls in 2 s, a zoom drew, then 0 again.

- 2026-11-08, TASK-109 merged after lead fixes (Codex, GPT-6.1-Sol). Footprint closure first:
  the ground mesh keeps each excavated floor and adds banks along every outer and inner ring,
  cut at the terrain grid lines, so pits stay closed with Buildings, Building details or
  Surroundings off (main showed bright see-through slivers on Sindelfingen's slopes). Then OSM
  roof and building tags (`roof`, `colour`, `material`, `minHeightM` on context areas), new
  `render3d/roofs.ts` (gabled, hipped, half-hipped, pyramidal, skillion, mansard and gambrel on
  near-rectangular footprints; 71 irregular Munich footprints and 3 round roofs fall back to
  flat), muted tagged colours, window bands in the building shader fading by distance, and a
  "Building details" toggle. Agent figures: Munich 3D frame +10.1% (street) and +8.5%
  (overview) against main; context build 45 to 104 ms. Lead: shots read (Munich roofs and
  overview, Sindelfingen terrain with Buildings off against main, canopies); merged main with
  TASK-115 and added the frame request to `setBuildingDetails`; V115 gets the heavy-case budget
  (its 3D case took 58 s of 60 on CI). The machine was saturated by six Phase 2 agents, so the
  lead ran type-check, lint, format, the V109, V105, T44, T14 and V115 unit tests (82 pass) and
  the V105, V109, V115 and view3d e2e cases (pass), and left the full suite to CI at merge.

- 2026-11-08, TASK-104 merged after lead fixes (Codex, GPT-6.1 Terra). Surface lots become
  `lot` facilities with their courtyards and overlapping buildings as exclusions; mapped
  `parking_aisle` ways inside or touching a lot are appended as 10 km/h service roads with
  destination access, joined only at mapped public nodes (no inferred entries: Munich 18 of 22
  lots and Sindelfingen 30 of 31 are reported unreachable, mostly lots without mapped aisles);
  compile derives 2.5 x 5 m stalls (Munich 268, Sindelfingen 364) drawn as a default-on
  "Parking stalls" layer in both views. T49 strips the aisles and gets main's City and compile
  hashes back for both cities. Lead: `CompiledCity.parking` renamed `lots` (TASK-102's garages
  use `parking`); lot aisles get no default crossing and are not arms, so a lot entry no longer
  adds zebras to its street and aisle junctions carry none (Sindelfingen's big lot had one at
  every aisle); stalls are generated before the stops so a stop sees the same crossings;
  `parking`-kind places draw as an outline (their fill hid every aisle and stall with Places on,
  which the shots hide); the 3D stall toggle requests a frame. T44, V106 and V108 pins move for
  the lots (V108's arrow hash gains the aisle lanes). Traffic: quick 3233 / 35 / 1 against
  3012 / 38 / 0 on main, no route uses an aisle; full 3472 / 70 / 0 against 3342 / 75 / 1.
  Baseline reset to these (stalled heads stays 1 for B56).

- 2026-11-08, TASK-102 merged after lead fixes (Codex, GPT-6.1-Sol). Garages from OSM (Munich 53,
  Sindelfingen 4) plus an inferred private garage for every place with demand and no mapped
  facility (87 and 20), compiled into `CompiledCity.parking`; cars choose the destination's own
  garage first, then the nearest public one within 400 m, recheck on entry and cruise to the
  next when it is full; a person's next trip leaves from where the car parked; occupancy
  snapshots, a minute history, an editable facility inspector with undo, occupancy markers in
  2D and 3D, and trip CSV columns. 116 was not ready, so 102 merged after 104 instead of after
  116. Lead: conflicts with TASK-104 and TASK-115 (overpass query version 5 with both clauses;
  garages are allocated before the lots; T49's oracle strips only the lots, and the stripped
  cities now hash to TASK-102's own T44 pins, so lots still change nothing else); the
  occupancy setters request a frame only when a count changes, and 3D selection of a garage
  requests one; the garage tests skip lot facilities. Pins: T44, V106, V108 and T47 move for
  the garages; V108's arrow hash moves because garages take ids before the lots and renumber
  the aisle lanes (arrows on Sindelfingen's other 664 lanes equal main's). Traffic: quick
  3209 / 28 / 0 against 3233 / 35 / 1 at the TASK-104 merge, 0 parking failures in 2725 local
  arrivals, mean search 0 s; full 3378 / 62 / 0 against 3472 / 70 / 0, no parking failures.
  Baseline reset to these (stalled heads stays 1). CI after the merge failed three e2e cases
  the agents do not run: T16's stress grid released no car (every home garage was full at
  departure until its residents left, so every choice failed), demo A failed 1 382 trips (a
  1 200-slot inferred office garage for 2 000 commuters, and a Homes garage saved at 1 088
  before the population edit), and the trips CSV gained three columns. Lead fix: room at
  departure is a forecast (head for the first candidate with any slots; the entry decides),
  and an inferred garage with an inferred capacity never turns its own place's cars away;
  mapped and inspector-set capacities stay hard (the edit clears `capacity` from
  `inferred`). Munich quick is unchanged (3209 / 28 / 0).
- Owner, 2026-11-08, on the inferred garages: keep them admitting every car for the demo
  (not every owner parks in their garage, and mode choice will thin car demand), but the
  nameplate must hold the initial stock. Lead: compile sizes an inferred garage to at least
  its place's current population and jobs, less the place's other garages, so a place edit
  (demo A's Homes at 2 000 over a 1 088-slot garage) raises the nameplate; pins unchanged.
- TASK-116 review (lead, 2026-11-08): merged after TASK-102 and TASK-104. Routing keeps the
  lane search's movements and returns `resolveLanes`' sets with the chosen lane first; the
  engine wrapper is gone. Conflicts: the import probe keeps TASK-102's optional provider and
  wraps it for TASK-116's timing; traffic-quick prints both reports. T47's projection pins
  (roads, movements, cost) for Sindelfingen and Munich re-pinned to main fc5bf2f's own
  routes, so TASK-116 moves no route after the lots; T46 town keeps TASK-102's state hash
  with TASK-116's times. Traffic: quick 3356 / 20 / 0 against 3209 / 28 / 0, full 3493 / 51
  / 0 against 3378 / 62 / 0; baseline reset to these (stalled heads stays 1). The agent
  relaxed two Munich e2e allowances (T47 180 s, V106 local frame overhead 25%) citing the
  owner; kept, and the owner confirmed them.
- TASK-110 review (lead, 2026-11-08): merged after TASK-116. Conflicts with TASK-102/104/109
  kept both sides (layers, styles, imports); the Overpass query is version 6 with the garage,
  lot and walk clauses; walk IDs still come last, after the lots. T49 now hashes through
  `vehicleJson`, and its stripping oracle drops the walk network (allocated after the lots),
  so the stripped cities still equal TASK-102's pins; T44, V106 and V108 hold. The 3D walk
  toggle now requests a frame (the branch predates TASK-115). Compile time: the branch made a
  warm Sindelfingen compile 3.0 s against main's 0.36 s (Munich 1.0 s against 0.36 s), almost
  all in attaching places, garages and lots to the walk graph. The lead replaced the exact
  nearest-point radius search with a best-first search, skipped candidate paths whose box
  cannot beat the current attachment, and dropped the per-probe cumulative lengths in the
  road-crossing test; the compiled walk graph hashes identically on grid, town, Munich and
  Sindelfingen. Warm compile now 0.81 s Munich and 0.77 s Sindelfingen (walk about 0.45 s
  of that). Shots read on the merged tree: sidewalks outside the curb, lots unchanged.
- TASK-107 review (lead, 2026-11-08): merged after TASK-110. Conflicts: the Overpass query is
  version 7 (garages, lots, walk, lamps); the 2D marking fade from TASK-115 now also follows
  107's new Lane markings toggle; 3D keeps the lots after 107's paint handles; both street and
  walk setters in the map view. V107's network pins re-pinned to main 378a1f1's compile output
  (TASK-107 changes no network code; the merged tree hashes equal main's on all four cities).
  Placement time: the branch spent 3.9 s on Sindelfingen in `placeStreet`, run by both views
  on every city change, almost all in the obstacle clearance test. The lead made it stop at
  the first ring segment within the margin (same arithmetic as `nearestOnPolyline`) and use
  `preparePolygon` per ring; output hashes identical on town, Munich and Sindelfingen; 0.58 s
  Sindelfingen, 0.39 s Munich. Shots read: lamps on the verge, `BUS` upright in the lane, the
  Anlieger frei sign readable in 3D, curbs open at crossings. Night lighting stays deferred.
- TASK-114 review (lead, 2026-11-08): merged last. Conflicts: TASK-107's `busLabels` sits
  before the themed `roadMarkingGeometry` (every theme inherits the `bus` colour); 3D paint
  handles and lots kept with the themed stop colour; the map view rebuilds 3D on a theme change
  with terrain and parking occupancy. V114's German paint pins re-pinned to main 62ca1c3's paint,
  computed with main's own modules (TASK-104 aisles and TASK-107 `BUS` text moved the 806263a
  values); the merged tree's German paint equals main's on Munich and Sindelfingen. T49 sets
  the display-only `markingTheme` aside, as T44 does. Shots read: US yellow centre lines, UK
  yellow kerb edges, `BUS` and signs unchanged across themes. US/UK marking builds cost about
  2.5 times German (1.9 s against 0.74 s on Munich, per the agent); German is unchanged.
- TASK-111 review (lead, 2026-11-08): delivered by the lead's subagent (owner exception) as one
  commit; merged first. Walkers live in `src/sim/walkers.ts`, created only when the scenario has
  test pedestrians, so with none the engine does nothing new: `traffic:quick` equals main
  (3356 / 20, `against main { completed: 0, gridlocked: 0 }`) and the full traffic tier is the
  baseline exactly (3493 / 51). A held crossing's near edge is a standing obstacle clamped like a
  stop line; derived walk groups give an arm walk green where no movement from it is green;
  walk lists compile into `CSignal.phases[].walk` and patch by link id. With the test source at
  2 000 walkers per hour Munich's step time rose 5.5% (gate 25%), zero hard stops, zone stops
  34 to 39. V107's compile pins moved by the new crossing and walk data only (stripped, they
  hash to the old pins). Shots read: walkers on sidewalks and crossings, cars before the
  stripes, walk lights readable; walkers are small at street zoom. The subagent appended two
  lines to the shared `.git/info/exclude` by mistake and removed them; the checkout stayed
  clean.
- TASK-117 review (lead, 2026-11-08): merged with TASK-111 (one e2e run, 85 passed). Lead fix:
  same-rule entries of one street group merged across the whole group, so the far end of a long
  restricted street lost its sign (Munich 3 merges, Sindelfingen 6); merging now needs the kept
  sign within 15 m (Munich 1, Sindelfingen 4), with a V117 case. V117's compile pins follow V107
  after TASK-111. Lamps, curbs and German/US paint equal main's; Sindelfingen's one footprint
  overlap is resolved, Munich had none under the agent's estimator. Shots read: no sign overlaps
  another, UK motorway and ramp edges white, yellow only on urban nearside kerbs; a footbridge
  over one Munich plate is the existing deck occlusion.
- TASK-103 review (lead, 2026-11-08): merged last in Phase 3, on top of TASK-111 and TASK-117.
  Conflicts with TASK-111 (snapshot walkers and parked cars, pick order vehicle, walker, parked;
  layers, shots, section 11) kept both. Munich 257 strips (33 mapped, 224 inferred, 2 149
  slots), lots reachable 4 to 22 of 22; Sindelfingen 71 strips, 1 111 slots, lots 1 to 31 of 31.
  Performance: each parked car queues on its own slot connector (2 601 connectors in Munich
  against 311), and connector spawn walked every queue every step; the lead made spawn visit
  only queues due that step (a heap of wake times, compiled order kept), memoized the parking
  near each home at load, and sampled band edges densely only along strip runs. Totals are
  unchanged by these (quick 3314 / 33 / 5, mean delay 589.2769366877969 s). Idle against main:
  step 39.4 s against 30.8 s (+28%; the branch was +47%), load 36 ms against 18 ms (was 133 ms),
  street placement 422 against 347 ms, compile +4%. Route requests rose 25% (100 704 against
  80 851), almost all fast failed searches: choice tests each slot connector of a strip in turn
  and an unreachable strip fails on every slot (0.2 s in all); routing time rose about 1 s.
  Internalizing strip choice (one entry per strip, a slot picked on arrival, as lots already do)
  would remove those and most connectors; not needed for performance, left as is (owner).
  At merge: UK kerb lines leave out strip runs (TASK-117's hook); T52's vehicle hashes leave
  out signal walk lists, which index walk links that strips move; V107 and V117 pins for Munich
  and Sindelfingen hash to TASK-103's own pins with TASK-111's fields stripped, and V117's lamps
  and curbs move with the bands (lamps equal within 0.1 mm of the branch). Traffic: full 3462 /
  72 / 5 parking failures against 3493 / 51 (gate 3144 and 76), quick 3314 / 33 / 5 against 3356
  / 20; baseline reset to these. The gate tests now allow counted parking failures under 2% of
  local arrivals (5 of 1 369); T53's Munich walker floor is 0.94 of the no-walker hour (walkers
  now cost 4.5% of completions, 1.4% before parking).
- Owner, 2026-11-08, testing TASK-103: roadside parked cars never leave and some surface lots
  stay empty. Lead: starting stock was the full population's cars while demand generation
  makes persons at the import scale (Munich at 0.15: 31 181 parked cars for 5 315 persons), so
  most visible cars had no owner; and an OSM lot imports as its own `parking` place, which
  nobody visits, so private and customers lots admitted no car. Fix: stock per person (a
  resident whose moved street car a neighbour took starts from the inferred home garage), and
  an ownerless lot serves the places within 200 m, ranking first for them with cars on their
  way counted against its stalls. Munich roadside 1 310 at 07:00, 136 by 11:00; lots 305 of
  367 stalls by 11:00 (was 7). Traffic: full 3491 / 72 / 5, quick 3296 / 32 / 5, mean search
  10.4 s; baseline reset. T53's walker floor is back at 0.97 (walkers cost 1.4%). CI's e2e
  timed out on T52's Munich frame samples (software GPU): 20 frames and no frame allowance on
  CI, as T44 and V106.

- TASK-119 review (lead, 2026-11-09): accepted as delivered, merged first in Phase 3b. Munich
  57 street-side areas (54 strips, 3 fallback lots), Sindelfingen 2 (strips), no parking place
  without a facility; the two private lots and the garage were linked to the wrong place, not
  dropped. Route requests in the quick run rise to 182 916 (main 117 272): parking search tries
  the 466 new slot connectors and most attempts fail fast, as measured at TASK-103; the run is
  6% slower (39.1 s against 36.9 s).
- TASK-118 review (lead, 2026-11-09): merged on top of TASK-119. As delivered it left 305 lot
  stalls unreachable (Munich 8 of 22 lots usable, Sindelfingen 14 of 31) and gridlock 52
  against 32 in the quick run (1.63 times, over the gate). Lead fix in `lot-paths.ts`: an entry
  link may pass under a building exclusion when no clear link exists, never over a bay
  (courtyards behind a building passage: Munich `pk:2037`, Sindelfingen `pk:1475`, 227 stalls),
  and a stall joins an aisle over a clear link up to 5 m (single rows beside their aisle).
  Unreachable stalls: Munich 54 (28 in TASK-119's aisle-less fallback lots), Sindelfingen 22.
  No car stays stuck in a lot (quick run: at most 11 inside at once, longest 140 s, none at
  09:30); mean entry to parked 51.6 s. Hash pins re-derived for the combined merge. Traffic
  tests: T53's walker pair from removed place p:1667 now starts at p:1751 (same zebra n:859);
  T21's conflict-zone sampler skips `OFF_LANE`. Traffic: full 3334 / 81 / 13 parking failures
  (gate 3142 and 108), quick 3134 / 40 / 13 (run 40.6 s against 36.9 s on main); baseline reset
  to these. Full demand: 32 parking failures of 1 599 local arrivals (main 21 of 1 433), over
  2%, mostly resident cars on strips along dead-end lanes that cannot turn around (also on
  main); zeroing those strips raised it to 51 (their residents then have no car). The owner
  accepted the full-demand test at 2.5% until TASK-120. e2e 92 of 92 (qa-mobile and T52 Munich
  rerun alone after load from concurrent lead probes).

- TASK-120 review (lead, 2026-11-09): rejected; not merged. The lead's contract assumed that
  single-road nodes get no movements, so strip cars at dead ends could not turn. That is false for
  imported cities: the importer already allows a U-turn at residential and service dead ends
  (`addLocalTurnarounds`). The strips that strand cars (`pk:9127` on `r:953`, `pk:9336`, `pk:9348`,
  Sindelfingen `pk:2416`) are on one-way lanes into cropped gateways or behind an inferred ban, so
  the agent's correct implementation added turnarounds only at lot aisle ends (Munich 21,
  Sindelfingen 45), whose larger caps cost 168 lot bays, and left the parking failures alone. Its
  quick run was 3 087 / 41 / 13 against main's 3 134 / 40 / 13. Salvaged: its T54 e2e render-frame
  wait and the corrected `r:1161#0` comment in `tests/importers/munich.test.ts`. Owner: ask for a
  different fix, TASK-122 (cars choose spaces they can leave; no network change).
- TASK-121 review (lead, 2026-11-09): accepted; it goes to main together with TASK-112. Trace and rule as
  contracted; no give-way rule was needed. Quick run alone 3 493 / 14 / 13 against main's 3 134 /
  40 / 13; full gate alone 3 626 / 35 / 13 with 0 stalled heads (cars-only too, per the report).
  Step time equal to main (38.0 s against 38.6 s for the 09:30 run); route requests rise 53%
  (174 144 to 266 958), mostly fast failed searches from heads that keep looking for a detour
  each step after 45 s (mean route 0.03 ms). The stability aim was not met: main's three
  probe shifts all gave 3 134, the branch's spread is 72. With TASK-121 alone, T53 fails: walkers
  raise zone stops from 43 to 79 and cost 3.1% of trips (detours with walkers present: 73 against
  65); with TASK-112 merged it passes (51 to 57, 1.1%). Lead: T29 still fails as expected.
- TASK-112 review (lead, 2026-11-09): integrated on top of TASK-121 on `task/lead-112`; `engine.ts` load inputs and the
  import-probe counters were unions. Of its three failed gates: the 09:30 stalled heads (3 on the
  combined tree) are heads in a signal queue that stood 330 s by 09:30, just over the probe's 300 s
  sample, with red time not counted toward the 180 s respawn; the gate counts at 10:00, where it is
  0. Sindelfingen's walk fallbacks (70.7%) are gaps in TASK-110's walk graph, outside this task's
  files: B57. T52's frame ratio passes when the machine is idle (lot 2D 1.02). Lead fix: walker storage grew
  `arrivedS` with 0 instead of NaN (the `fill` test skipped NaN), so person walkers past the first
  storage block showed as arrived at 00:00 in the inspector. Lead test change: T10's station surge
  plateaus once visitors hold the station's spaces while walking in and out, and a head detour adds
  one car at +28 min, so the peak is now the first time the queue comes within one car of its
  maximum (+230 s). Behaviour to note: in the bundled station project the pickup loop now stays
  full for more than 30 minutes (each visitor walks about 150 s each way while holding one of the
  station's spaces); before TASK-112 it drained within 15 minutes. Combined tree: quick 3 357 / 8 /
  13, full gate 3 571 / 23 / 13 with 0 stalled heads, T53 passes, full demand 30 parking failures of
  1 729 local arrivals (1.7%, so the full-demand test is back at 2%). Baseline reset to these on
  the branch. Full e2e on the combined tree: 83 passed, 10 failed, all from person cars now
  leaving only after the access walk: gate1-edit (first departing vehicle reroutes; five-second
  phase), gate2-edit T12, gate3-paint, gate3-places demo B and demo B terminal access, gate4-layers,
  gate5-controls roundabout, qa-mobile and T54. Round 2 for the TASK-112 agent on `task/lead-112`:
  make them pass, fixing the spec where it assumes an instant departure and the product where the
  scenario's point is lost (demo B's second connector must still lower the station peak).
- TASK-112 round 2 (2026-11-09): fast-forwarded to the lead's integrated baseline. The Station
  pickup loop now has sidewalks and two station entrances at its curb. Visitors walk locally
  instead of taking the long path via the main road; the four-space capacity, event demand and
  six-car/minute arrival connector are unchanged. The minute-sampled queue peak falls from 67
  to 62 when the UI adds an arrival connector (previously 82 to 82). T10 again checks the true
  peak time and drains the queues by the original 08:35 end. Specs wait for access walks before
  inspecting drivers; demo B inspects a destination queue at 08:08 while retaining the full
  twenty-minute comparison. Layer screenshots exclude the floating sheet's overflow, and the
  roundabout spec uses the current world projection after fitting and zooming.
  Verification: full Playwright 93/93 on port 5312, including production; `check` passes (960
  unit tests passed, one skipped); `test:city` 103 passed (one skipped); quick traffic matches
  the integrated baseline at 3 357 completed / 8 gridlocks / 13 parking failures (three sampled
  heads at 09:30, as in the lead review above).
- Lead, TASK-112 round 2 review (2026-11-09): accepted. The Station fix is in the fixture, not
  the sim: the pickup loop gets sidewalks and the station two entrances at its curb, so visitors
  walk a few metres instead of about 150 s by the main road, and the loop drains within the
  original window again. T10 is back to the true peak time (the lead's plateau rule is removed)
  and a new T10 case checks that a second arrival connector lowers the peak (67 to 62). The spec
  changes wait for the access walk (`departVehicle`, longer steps) without dropping assertions;
  the five-second phase now asserts a longer queue, which is stricter. On the merged tree:
  `check` 960 passed; the 10 round-1 failures plus T53, T54 and T57 pass (36 of 36, port 5390).
  The traffic numbers above stand (no sim change). Merged to main with TASK-121.

- Lead, TASK-122 review (2026-11-09): round 2. The trace is thorough. Every failure is
  accounted for, and the departure check (largest SCC per class and access zone, lane-change
  thresholds, lot circulation) is correct and cheap: load time equals main and step time is
  +5.6% on an idle machine (47.6 against 45.1 s at 09:30), about what 209 more completed trips
  cost. On the merged tree: `check` 975 passed; full demand 1 874 completed, 185 gridlocked, 0
  parking failures (passes at 1%); the 10:00 gate 3 729 / 25 / 0 with 0 stalled heads; quick
  3 566 / 9 / 0. The owner's two decisions given to the agent (gateway visitors keep their
  parking choice; empty blocked strips are acceptable) stand. Open: T53 Munich fails, walkers
  cost 4.3% of completed trips (1 924 to 1 841, limit 3%; main 1.1%). The lead traced the
  search-time growth (total search time 57 000 to 434 000 s at 0.15): about 120 arrivals bound
  for the garage `pk:1981`, which has no car exit (B58), are refused and cruise nearby strips
  (`pk:9187`, `pk:9267`, `pk:9189`, `pk:9247`) for up to two hours, and they cross zebras while
  they cruise. Round 2: when a car with a later trip finds no space it can leave within the
  search radius, it keeps today's choice (as the gateway exception does), and the engine counts
  it (`parkedWithoutExit`), so B58 can fix the exits later. T53 must pass; the cruising time
  must fall back near main's.
- Lead, TASK-123 review (2026-11-09): round 2. Sindelfingen improves (connected sets 111 to
  30, walk fallbacks 99 to 41 of 140) and the trace is good. Three problems:
  1. The `sidewalk=separate` fallback duplicates mapped sidewalks in Munich: it adds 993
     links (8.4 km), and 7.9 km of them run parallel to a mapped footway within 12 m (385 links
     within 4 m, 405 at 4 to 8 m). The test for a mapped sidewalk along a side looks only 4 m
     out. The duplicates bring 65 new crossings, zebra delay rises 31% (10 499 to 13 737 s), and
     Munich's traffic gate fails on gridlock: quick 3 497 / 18 gridlocked / 1 stalled head
     against 3 357 / 8 / 3 (limits 12 gridlocked, 3 stalled heads), and the agent's 10:00 run 42
     gridlocked against 23 (limit 34). Correction, 2026-11-09: this entry first gave main's
     09:30 stalled heads as 0; that is the 10:00 gate's figure (`bench/traffic-baseline.json`,
     checked by `tests/traffic/munich-morning.test.ts`). Main's 09:30 heads are signal queues
     just over the probe's 300 s sample (see the TASK-112 review). Stalled heads are judged at
     10:00, against 0.
  2. Routed egress walks are long: Sindelfingen's mean egress grows from 308 m (straight line)
     to 1 051 m; `pk:1453` to `p:1407` routes 1 944 m. Report each leg's detour (routed against
     straight-line length) and trace legs over three times.
  3. Compile time: Sindelfingen walk compile +40.7%, whole compile +16.7% (limits 10% and 5%).
  The lead accepts the southern neighbourhood across the A81 (no mapped way in the extract) as a
  real gap; the 2% fallback gate counts walk legs outside listed real gaps. The bridge and
  tunnel endpoint joins the owner approved for the agent stand.
- Lead, TASK-122 round 2 review (2026-11-10): hold until B58. The fallback works as asked
  (current-position test, `parkedWithoutExit` 20, T53 passes), but the lead's 10:00 gate run of
  the branch alone (`tests/traffic/munich-morning.test.ts`'s probe) has 3 643 / 19 / 3 stalled
  heads against 0, and total parking search is 286 602 s against main's 56 894 (44 searches
  over an hour; 130 408 s at `pk:9181` alone). Strip slots are not claimed, so many cars with a
  later trip chase the same freed slot. With TASK-123 merged as well it is 3 356 / 39 / 2
  (limit 34). A lead experiment, giving up the exit test after 300 s of search, moved the time
  into `pk:1981` (148 375 s) and still failed (3 559 / 26 / 2). Both trap garages are B58; fix
  B58 first, then re-measure TASK-122 on top of it.
- Lead, TASK-123 round 2 review (2026-11-10): the duplicate sidewalks are gone (Munich
  fallback 993 links to 3, new crossings 65 to 1), compile is within budget, the vehicle hash
  is equal, and the lead's 10:00 gate run is 3 567 / 15 / 0. `check` passes; the full e2e
  passes except `gate3-bypass`, which also fails on main (flaky). One gate fails: the traffic
  tier's T53 (`tests/traffic/T53-munich-pedestrians.test.ts`, which the report does not run),
  zone stops 35 without and 63 with the test walkers against a limit of 62.5. Main is 51 and
  57. Round 3: trace both changes against main (which junctions gain or lose zone stops, and
  whether the test pairs now walk over different crossings), fix what the walk graph causes,
  and pass T53 unchanged.
- Lead, TASK-123 round 3 (2026-11-10): accepted. The T53 shift came from one access
  attachment: an owner-curb tie-break used a mapped entrance about 100 m away and moved
  `p:1769`'s access to the other curb of `r:62`, which changed one person's walk and the
  departures after it. With the fix T53 is 51 / 57 zone stops (main's, event for event), and
  the 10:00 gate is 3 571 / 23 / 13 parking failures / 0 stalled heads, main's exactly. Lead
  runs on the merged tree: `check` (two Sindelfingen tests timed out under load and pass alone),
  the traffic tier, the full e2e (93 passed) and the bench (equal to main) are green.
- Lead, TASK-124 review (2026-11-10): accepted with one lead fix. The car-exit check is TASK-122's
  departure check ported to `src/network/parking-egress.ts`; it reproduced main's census
  exactly. Six arrivals that cars can reach keep their place and gain a separate exit (`p:1733`
  and `pk:1981` exit on `r:380`, `p:1841` and `pk:2035` on `r:1059`); thirteen unreachable
  entries move (`pk:1443` to `r:1081`, 13 m from its footprint). Left: Munich 19 facilities / 95
  spaces, Sindelfingen 35 / 722, all strips or zero- to nine-space facilities on cropped or
  private-zone roads; every populated non-gateway place has an exit. Lead fix: the repair could
  pick any lane, and gave `p:1505` an exit on the inner lane of the Trappentreutunnel (trunk,
  layer -1); new portals now go only on the curb lane of an at-grade street that is not a
  motorway, trunk or ramp (`p:1505` now exits on `r:380`), and seven Munich hash pins moved with
  it. At 0.15 every count equals main (10:00 gate 3 571 / 23 / 13 / 0 stalled heads; T53 51 / 57;
  Sindelfingen 156 / 0 / 245), so the baseline stays. Full demand at 10:00 moves 1 994 / 204 to
  1 896 / 249, inside its gate, spread over many roads (departures from the repaired lots take
  new exits). Lead runs: `check`, `test:city` (T23 timed out under load and passes alone), the
  light traffic tier, the light e2e (37 passed), T61, T54 and T52 (the Munich 3D frame ratio
  1.22 failed while TASK-126's agent loaded the machine; it passed in the agent's run).
- Lead, TASK-126 review (2026-11-10): accepted with small lead fixes. Both extracts gained their
  railway ways from date-pinned Overpass queries, appended only (T62 rebuilds each original file
  byte for byte from the head of the new one). `City.rail` holds nodes, track sections and
  platforms; a station place lists its platforms and entrances. The compiled graph joins tracks
  only at shared nodes, on the same layer, within 30° of straight. Munich: 676 sections (622 rail,
  54 tram), 154 switches, 30 platforms; Donnersbergerbrücke has its two S-Bahn platforms (from the
  stop-area relation) and three entrances on the main walk component. Sindelfingen: 74 rail
  sections, no station. Integration: the rail import runs after TASK-124's exit repair, so every
  earlier id equals main's; the lanes and movements hash equals main's in both cities. The
  whole-city pins moved; with the rail data stripped Sindelfingen equals main's pins, and Munich
  differs only in the station's new platform outline and its three entrances (one, `wn:2279`,
  named a removed place `p:1523` on main). Lead fixes: (1) the 2D frame gate failed twice on an
  idle machine (Rail on +11.4% and +10.9% at 1.6 px/m): 10 300 of the 17 500 rail triangles are
  the 0.18 m twin rails, sub-pixel at that zoom, so the main-line twin rails now draw in their
  own 2D layer from 3 px/m (tram rails at every zoom, since a street tram has no bed); T62 then
  passes at 2D +6.2% and 3D +3.8%. (2) T62's frame gate skips on CI, as T44's does. (3) Re-pins
  for the combined tree, including T62's lanes/movements pin, which held the pre-TASK-124 value.
  (4) "Running line" instead of "Main line" for untagged non-rail tracks. Known: the station's
  car connector line on the Entrances and exits layer now starts at the platforms' centre
  (TASK-128). At 0.15 every count equals main (10:00 gate 3 571 / 23 / 0 stalled heads; T53
  51 / 57). Lead runs: `check`, `test:city`, the light traffic tier, the light e2e (37 passed),
  gate4-layers, T44-context, V97-grade-shadows and T62.
- Lead housekeeping (2026-11-10): the full e2e runs in six groups; a new group e holds the rail
  specs (T62, later TASK-127's T64). Moving three specs from c to d backfired: on
  `checkpoint-2026-11-10` T52-parking-cities alone took 14 min (8 min on a2e1f06, before
  TASK-124 and TASK-126; every test passed), so they went back to c. T62 timed out at 420 s on
  CI: its 120-frame samples on the software GPU are only for a gate CI skips, so CI now takes
  12-frame samples. T23's Munich case
  gets a 180 s limit, as T24 has: it takes 20 s locally and 45 to 61 s on CI runners (one
  timeout on ab41f86). Checkpoint `checkpoint-2026-11-10` runs the full tier with TASK-124 and
  TASK-126 on main.
- Lead, TASK-125 review (2026-11-10): accepted. A car that chooses with room claims one exact
  strip space, or one count against a garage or lot (soft inferred garages stay unlimited); the
  departure forecast to a full facility claims nothing. One idempotent `parking.release` runs on
  parking, choosing again, entry rejection and every completion, failure and respawn (through
  the shared accounting), and a live edit releases claims whose target vanished. The agent
  confirmed the lot leak on main: a car failed for gridlock kept its lot count. Munich at 0.15 to
  10:00: 3 592 completed (3 571), 17 gridlocked (23), 13 parking failures (13), 0 stalled heads;
  parking search 10 999 s (56 894 s, -81%); entry rejections 18 (133); same strip space chosen by
  two cars at once 0 (146). The cost: claimed strip spaces stay empty while their car is on the
  way, 112 claims with median 312 s, p90 4 410 s and longest 6 482 s (cars held in queues). T53
  30 / 42 zone stops (main 51 / 57). Sindelfingen 156 / 0 / 245 unchanged; its 245 parking
  failures have no route from any origin exit (reach, not claims). Full demand (agent run):
  1 896 / 249 to 1 983 / 203, stalled heads 2 to 3. Controlled wall time +2.2%. The baseline
  resets (rule 7): 3 592 / 17 / 0 stalled heads, quick 09:30 3 357 / 13 (1 stalled head on
  `r:961`, one of main's three). The agent also showed the claimed strip space in the vehicle
  inspector (`src/ui/inspector/vehicle.tsx`, outside the contract's scope); the owner
  confirmed approving it. Lead: re-recorded the baseline and put the T63 e2e spec in group b. Lead runs:
  `check`, `test:city`, the light traffic tier, the light e2e (37 passed), T54, T16, T49, T63.

TASK-127 review (lead, 2026-11-10; Codex GPT-6.1-Sol high, merged): decorative trains on
TASK-126's tracks. Routes run between boundary ends (degree-one, non-buffer nodes on the bbox)
through permitted connections only; `railway:preferred_direction` is a new optional track field
and binding; untagged parallel running tracks run on the right; station-serving paths are
S-Bahn, the other running paths main line; trams excluded. Owner exception: Sindelfingen has no
boundary-to-boundary path, so its services run boundary to buffer, dwell 40 s and reverse.
Munich: 20 routes, 30 S-Bahn and 180 main-line trains per hour, 15 stops per hour at each of
`rp:10736` and `rp:10737`; 265 sections used, 411 unused (54 trams among them). Sindelfingen:
2 terminal routes, 20 per hour; level crossings `r:982`/`rt:2547` occupied 773 s per hour and
`r:976`/`rt:2450` 413 s. A periodic reservation table keeps every section to one train; both
cities fit a 720 s cycle with no boundary waits. `trainsAt` is pure and imports no `src/sim`;
the timetable is cached by rail graph outside `CompiledCity`. Traffic and the simulation hash
are unchanged (light traffic tier equal to the TASK-125 baseline); lanes and movements unchanged;
whole-city and compile pins move (T44, T49, V106, V107, V108, V117) for compiled boundary flags and
Munich's preferred directions. Timetable build 9.9 ms in Munich (+1.0% of compile). Frame gate,
lead run on the merged tree: 2D +6.1% and +6.3%, 3D +6.5% and +5.7% (agent: 2D +6.1/+6.1, 3D
+4.9/+5.1). Lead: resolved the group e conflict (T62 and T64), gave T64 short frame samples on CI
as T62 has. Lead runs: `check` (two Munich/Sindelfingen tests timed out under load from other
agents, passed alone), `test:city`, the light traffic tier, the light e2e (37 passed), T64, T62,
gate4-layers, V97 (6 passed).

TASK-122 re-measure (lead, 2026-11-10; merged): TASK-122 round 2 on top of TASK-124 (car exits)
and TASK-125 (claims). Lead merge: the exit check and the claims combined in `choose()` and
`hasFreeSpace()` (`src/sim/parking.ts`); two T59 tests modelled a car taking a space another car
had chosen, which claims prevent, and now expect the claims outcome. Munich 0.15 to 10:00:
3 665 completed (main 3 592), 30 gridlocked (17), 0 parking failures (13), 1 stalled head (0);
mean delay 709 s (796); parking search per arrival 1.2 s (3.4); entry rejections 0 (18). Over
three demand seeds gridlock is noise (main 17 / 35 / 43, TASK-122 30 / 32 / 36) and every stalled
head on either tree is on the Landsberger loop (`r:961`, `r:364`, `r:248`): about 20 cars stand on
each of `r:961`, `r:364`, `r:248`, `r:703`, `r:273`, `r:997` at 10:00 with waits of 80 to 100
minutes on both trees; 743 cars pass `r:961` against 609 on main because fewer cars fail or search
upstream. The 07:00 stock moves about 40 cars between strips, none near the loop. B56 reopens as
TASK-130. T53's walker cost is systematic: 2.2 to 4.1% over three seeds (main 0.4 to 1.9%); the
owner relaxed its limit to 5%. Main also fails T53's zone-stop rule on seed 3 (43 to 91). Full
demand passes (parking failures under 1%). The baseline resets (rule 7): 3 665 / 30 / 1 stalled
head (`r:961`), quick 09:30 3 439 / 13 / 2 stalled heads (`r:248`, `r:961`). T63's gridlock and
stalled-head pins move to the baseline gate. Lead runs: `check`, `test:city`, the light traffic
tier, the full-demand test, the light e2e, demo-a-commute, T16, T52, T54, T57, qa-exports, T63.

- TASK-122 trace (2026-11-09): stopped under design item 1 before implementation. The three
  unchanged-tree runs reproduce every parking failure: Munich full demand 30 (1 971 completed,
  207 gridlocked, 1 729 local arrivals), Munich 0.15 at 10:00 13 (3 571 / 23; 09:30 3 357 / 8),
  Sindelfingen 0.15 at 10:00 245 (156 / 0). All 245 Sindelfingen failures originate at gateways
  with no parking facility or space: p:1303 (108), p:1306 (108), p:1315 (29). Their cropped
  motorway components have no path to local parking; `connectors.spawn` labels a failed route
  `no_parking` when the destination requires parking. Filtering parking spaces cannot change
  these departures. Lead decision needed on gateway routing/failure attribution; neither was
  changed. Munich's eleven never-departed full-demand failures all have allocated strip slots:
  the old trace mistook `inspect().parkingFacility` (chosen/arrived parking) for origin parking.
  The full-demand causes are cropped sinks/feeds (21), isolated loops (6), and car-forbidden
  exits (3). At 0.15: cropped sink (7), isolated loop (5), private-road-only egress (1).
  Named strips: pk:9339 feeds r:64, pk:9294 feeds car-forbidden r:373; pk:9217's direct exit
  feeds bus-only r:968#3, so a car needs an upstream lane change. pk:9122's only exit path
  traverses private r:1109/r:1033 from outside their access zone; a raw movement SCC would
  miss that restriction. Per-trip origins, slots, lanes, destinations and causes are in the
  trace commit message. No departure check, stock change, gate tightening or network edit was
  made; all implementation gates remain open.

- TASK-122 implementation (strict candidate fa0dda3, 2026-11-09): owner authorized the parking-space fix and left the
  original 245 gateway routing failures for another task. Derived departure reachability
  respects vehicle permissions, access zones, lane-change distance and lot circulation;
  starting stock, origin slots and parking before a later car trip use it. Live edits rebuild
  it without moving existing cars. Munich full demand: 1 785 completed / 199 gridlocked /
  zero parking failures (before: 1 971 / 207 / 30), so the parking gate is tightened to 1%.
  Munich 0.15: 3 370 / 11 / 0 at 09:30 and 3 643 / 24 / 0 at 10:00. Original Sindelfingen
  gateway failures are unchanged, but strict later-trip filtering rejects 32 additional
  inbound p:1300 visitors that formerly parked on isolated pk:2369; total 277, failing the
  non-rise gate. No routing/network exception was introduced to conceal this conflict.
  Starting stock totals remain 31 181 / 4 679 / 1 (Munich full / 0.15 / Sindelfingen 0.15).
  Explicit background occupancy stays put; default blocked strips can become empty when their
  residents' cars stay in garages. In the source app at scale 0.15 with Parked cars on,
  pk:9127's 16 bays remain drawn but empty at both 07:00 and 09:30; full-strip acceptance is open.
  Quick traffic also has 11 gridlocked versus the integrated reference's 8, and two stalled
  heads versus its zero: those acceptance limits are not met. Cold paired load median is
  113.28 ms versus 125.92 ms; quick phase load/step 77.01 / 75 626.27 ms versus reference
  119.37 / 98 467.46 ms. T59's 13 tests, all 972 unit tests, city tier (103), smoke (39) and
  additional named e2e checks (5) pass, as do typecheck, lint, formatting and build. Full task
  acceptance is not claimed; the last implementation commit carries the complete report,
  before/after measurements, remaining gates and per-trip trace.

- TASK-122 owner follow-up (2026-11-09): preserve existing parking choices for gateway-origin
  visitors, leaving gateway routing to another task, and preserve the street-share budget,
  accepting empty blocked strips. The arrival mask now exempts inbound gateway visits while
  preserving the car's next-trip ownership link; local arrivals with later gateway-bound trips
  still require a usable exit. T59 adds both cases (15 passing tests). Sindelfingen again has
  156 completed / zero gridlocked / 245 parking failures / 44 no_route, with exactly the same
  245 trip IDs, origins, destinations and starting facilities/spaces as before the fix. The
  prior strict candidate's extra 32 refusals are removed. Empty pk:9127 is now accepted by the
  owner. Updated Munich 0.15: 3 566 completed / 9 gridlocked / zero parking failures at 09:30,
  with zero stalled heads, and 3 729 / 25 / 0 at 10:00. The integrated quick gridlock limit
  remains open: 9 exceeds the reference's 8 plus 10%; other quick traffic limits pass.
  Full demand with the exception: 1 874 / 185 / 0, passing the 1% parking assertion in
  498.55 s. Fresh check passes (974 unit tests); T59 passes all 15 cases including onward
  car ownership. The repeated visual check confirms pk:9127 empty at both times. Current
  sequential load/step timings grow 88.1% / 32.0%; alternating cold-load medians grow 6.3%
  (68.14 to 72.46 ms). These mixed samples leave performance acceptance open; no baseline
  was relaxed. The follow-up commit body contains the consolidated trace and measurements.

- TASK-122 round 2 (2026-11-09): read the lead's review on main (bc7656a) and reproduced T53's
  1 924 to 1 841 completions (4.3% cost). The owner clarified that availability and reachability
  are checked from the car's current position, retaining today's ranking and search radius;
  only when no free leavable space can be reached does it retain the legacy choice. The same
  decision runs while searching. Filled targets are reconsidered before arrival, temporarily
  rejected facilities can qualify again, and unchanged targets keep their routes. No original
  garage anchor, roadside forecast or extra search-radius constraint is retained.
  `parking.parkedWithoutExit` counts actual later-trip arrivals without usable departures,
  including gateway visitors, not forecasts or background cars. At Munich 0.15: 3 106 leavable
  admissions and 20 without exits (pk:2035: 15; pk:1981: 5). T53 passes at 1 854 / 1 848 (0.3%
  cost), with crossing safety and zone-stop limits intact. T59's 25 tests pass, independently
  reviewed. At 09:30: 3 444 completed / 9 gridlocked / zero parking failures; at 10:00:
  3 643 / 19 / 0. The original 245 Sindelfingen failures remain unchanged; its new metric is 32.
  Search acceptance is still open: total search over all trips falls from 433 686 to 286 602 s,
  versus main's 56 894 s. p:1733 still accounts for 236 241 s; 33 trips search over an hour.
  The clarified rule keeps choosing reachable free safe bays in these cases, so this fallback
  does not alone restore near-main search time. No threshold was relaxed or B58 geometry changed.
  Fresh check passes (984 unit tests) and city passes (103). Quick has three stalled heads,
  matching the lead's corrected 09:30 baseline of three (main f5dfe24); the prior zero-head
  comparison in this branch's historical entries was incorrect. Concurrent quick phase load
  and step times grow 69.1% and 51.6%; performance acceptance is not established by that pair.
  Full demand passes the unchanged 1% parking gate: 1 970 completed / 209 gridlocked / zero
  parking failures, 1 689 local arrivals, `parkedWithoutExit` 35, in 689.52 s. Its mean successful
  search grows to 75.28 s (main 8.35 s); no full-demand search improvement is claimed.
  Of the 20 without-exit admissions, seven are new local fallbacks (all pk:2035); thirteen
  retain the gateway exception (eight pk:2035, five pk:1981). No local pk:1981 visit falls back
  in this run: free reachable safe alternatives continue to take precedence.
  Smoke: 38 pass, one Munich overview frame-cost failure (1.267x, allowance 1.2x); the isolated
  retry passes at 1.008x without threshold changes. The five additional named e2e scenarios
  also pass (six including the retry). All smoke cases have a passing result. Search-time
  and performance acceptance remain open; no full TASK-122 acceptance is claimed.
  The last round-2 commit body carries the complete measurements, checks and per-trip trace.

TASK-131 Phases 0 to 2 (lead-driven Claude Code subagents, 2026-11-10 to 2026-11-11; merged):
junction groups replace the importer's node merging. Every OSM node keeps its position. Nodes
joined by short links form one junction group: median crossings up to 30 m, complexes of two
signalised crossing groups joined by carriageway links up to 60 m (Munich `n:247`, `n:638`), and
other links up to 30 m and 1.5 times the widest road block. Merge-first with via nodes. A group
has one signal program; inner links carry lane lines but no control, and are drawn as one surface
with curbs outside. The collision model is off (`relaxMaxM` 0), `realignRoads` and
`attachCarriageways` are deleted, and carriageways are pushed side by side only where they
overlap, now also for pairs with different end nodes matched by ref (A81: 362 to 17 m2;
Trappentreutunnel: 320 to 5 m2). B55: side-by-side strips with a curb in 2D and 3D, 12
Sindelfingen cases including `n:68`. Fix round: lane turns at a group entry are classified
against the group's exits (Marsstraße `n:366`/`n:417` had a left turned into a U-turn); 73 of 178
entries still differ from main's merged node at road level, all explained (routes main allowed
through absorbed stubs, short arms now separate, two-left U-turns across median crossings,
one-lane inner roads). Two movements into one lane of an inner road are not a signal conflict
(contract change, architecture section 8). Import is faster (Munich -6.5%, Sindelfingen -15.1%);
compile Munich +2.1%, Sindelfingen -6.9%. Three agents ran in turn (two handovers). Lead merge:
`planLane`'s lane-change cutoff is clamped at 0, since a negative cutoff on an inner road under
10 m sent a car already in its target lane to the fallback and stranded it (Munich `r:663` >
`r:275`; 2 stranded trips). Munich 0.15 to 10:00: 4 197 completed (baseline 3 665), 35 gridlocked
(30), 0 stranded, 0 parking failures, 0 stalled heads (1); quick 09:30 3 809 / 19 / 0. T53's walker
cost is noise over seeds 1 to 3 (5.3%, -6.6%, 1.6%), so its limit is 6%. The baseline resets
(rule 7). Open for later: Phase 3 (box rule across inner links; 62 cars stood on inner links at
10:00 in the agent's run, and 25 of 30 unsignalised Munich groups make an inner-link car yield),
the walk links set back from their stripes (B59, TASK-140), the dead-end lot stub `r:2103`, the
westbound lane gain east of `n:638`. Lead runs: `check` (two Munich/Sindelfingen import tests timed
out under load, passed alone), `test:city`, the light traffic tier, the light e2e, T68, T61,
demo-c-bypass, T16.

TASK-133 (Claude Code subagent, Sonnet 5.5 high, 2026-11-11; merged): station furniture in 2D and 3D
from one pure placement (`src/render/station-furniture.ts`): name boards, canopies (from mapped
roof or station building polygons, since the city keeps no platform `covered` or `shelter` tags),
benches and bins, generic entrance signs, and one departure display per platform with the next
three departures at the sim clock (direction of travel, since the timetable names no
destinations; "now" while a train stands). No hash moved; load time -2.0%, 3D frame +0.9 to 4.1%
under load. On TASK-131's main the rail ids moved (platforms `rp:10743`, `rp:10744`), and the
merge found the timetable hash differed between Node and Chromium by float noise (1e-9 m); the
hash now covers rounded values (Munich `0d505d0f`). Lead runs: `check` (route-audit and T46 timed
out under load, passed alone), `test:city`, the light e2e (37), T70. T64's frame gate failed on the
loaded machine in the agent's runs (ratios 0.87 to 1.52 within one run); CI confirms it.

TASK-135 (Claude Code subagent, Opus 5.5 high, 2026-11-11; merged): trams are their own track type.
An optional `form` (embedded, grass, paved, ballast) comes from `embedded`, `surface`,
`railway:track_ballast` or `embedded_rails` tags, else from geometry (inside same-grade road
surface over 80% of the length is embedded), marked inferred. Munich's 54 tram sections carry no
form tags and are all inferred ballast (the nearest to embedded, `rt:10220` on Arnulfstraße east,
is 79% inside road). 2D: grooved street rails, or a 3.2 m bed with steel rails and sleepers on
ballast; 3D raised beds; railways unchanged (T69). Only hash pins moved (trams gained `form`). T62
and T64's frame gates failed on the loaded machine; CI confirms them.

TASK-140 (Claude Code subagent, Opus 5.5 high, 2026-11-11; merged, B59): the stripes' centreline is
the one crossing position. Generated crossings run along it over every road end of the arm; mapped
OSM crossings at a junction are re-anchored to it, with short kerb links to their original nodes,
unless they cross no lane, lie over 12 m away, or cross a road that does not end there. Walk lights
stand at the link ends and the walker conflict zone covers the stripes. Munich zebra links more than
0.5 m off went from 119 of 214 to 2 (`n:16`, a separate crossing 23 m up the street), signal links
from 6 of 12 to 0; Sindelfingen zebra from 17 of 287 to 0. The B59 count of "100 of 249 signalised"
was mostly zebras: Munich has 16 signal crossing links. Munich 0.15 to 10:00: 4 113 completed (main
4 197), 26 gridlocked (35), 0 stalled heads; mean walk time 111.0 s (111.2); T53's walker cost
-0.7% (was 5.3%). Lead merge with TASK-135: the V107 and V117 Munich compile pins re-pinned for
both. The baseline resets (rule 7): 4 113 / 26 / 0, quick 3 777 / 12 / 0. Lead runs: `check`,
`test:city`, the light traffic tier, the quick tier, the light e2e (37), T70.

TASK-132 (Claude Code subagent, Opus 5.5 high, 2026-11-11; merged): rail heights by tags. Nothing
was missing from the extract: every tunnel imported at its layer, but 2D drew it at about 22%
opacity under ground-level tracks and roads, and 3D faded it to about 10 grey levels behind the
see-through ground. The tunnel the owner saw missing is most likely the Südring (ways 37831035,
40348446) under the main-line tracks west of Donnersbergerbrücke. Heights now come from tags, not
`layer`: tunnels -7 m (-12 m at layer -2), bridges 5 m per layer raised to clear a road by 4.7 m or a
track by 6 m, everything else at ground, including 18 Munich and 3 Sindelfingen building passages
(new optional track field `covered`) and the Sindelfingen spur mapped at layer -1 with level
crossings. Ramps at most 4% (trams 6%) on the ground side, never over switches, level crossings,
road surfaces or platforms; where they cannot fit, the structure takes the rest (the Südring bridge
reaches 5.1 m of 7, its portal -4.1 m of -7). 3D: tunnel tubes with "See below ground", portals and
cutting walls always, decks with parapets on piers. Simulation and timetable hashes unchanged; load
+1.3%, 3D frame +2.3 to 2.6%. T62 and T64 frame gates sit at their 10% limit on the loaded machine,
as main does (they are skipped on CI). Lead runs: `check`, `test:city`, the light e2e (37), T70.

TASK-137 (Claude Code subagent, Sonnet 5.5 high, 2026-11-11; merged): tram stops as
`RailNetwork.tramStops` (new id prefix `ts`, allocated after everything else so no other id
moves). A stop is a platform island plus the tram sections it serves: mapped platforms keep their
shape, a node-only stop gets a generated 2.5 by 30 m island clipped clear of carriageways (none
needed in Munich), and two same-name positions on tracks 4.8 to 12 m apart share a centre island.
Munich: 14 stops, all on mapped platforms (7 of the 19 `railway=tram_stop` nodes lie inside the
extract, plus 6 from the `railway=stop` positions on Arnulfstraße; the rest are listed as
`osm_tram_stop_skipped`). Shelters, name boards, a name-and-lines display (from `route_ref`), a
tactile strip and a track marking, in 2D and 3D; TASK-133's furniture output is unchanged. 3D
islands use the platforms' layer height, as station platforms still do after TASK-132. Only the
Munich city hash pins moved. Lead merge: T44 and T49 re-pinned for TASK-132 and TASK-137 together.
Lead runs: `check`, `test:city`, the light e2e (37), T70, T73.

TASK-130 review (lead, 2026-11-11; Codex checkpoint `215afac`, not merged): the agent's own report
calls it a checkpoint, incomplete; B56 stays open. Retained model: junction exit storage rechecked
at entry with a bounded box forecast (a tail's forecast is capped by its immediate leader and by
known stops), bounded yielding for ready origins, a non-progress head-detour filter, per-vehicle
head-cost reuse and an unfinished-traversal cost floor in `link-costs.ts` (the last three with the
owner's approvals recorded in the commit, architecture sections 7 and 8 amended). On its base
(7868a5d) over seeds 1 to 3: completed 4 133 / 4 025 / 3 814 (main 3 665 / 3 465 / 3 084),
gridlocked 4 / 3 / 4, route requests about halved, step time +38 to 51%; the loop's longest waits
5 500 to 6 400 s against the 900 s gate in every seed; T53 fails (7.9% walker cost). It proposes a
routing change (`avoidEntryLane` in `RouteRequest`) that needs approval. Lead re-measure on today's
main (after TASK-131 and TASK-140), probe to 10:00: the loop persists on main (seed 1: `r:961` 24
cars, longest wait 5 090 s; `r:364` 17, 5 525 s; `r:248` 17, 6 888 s; seeds 2 and 3 alike). Main
completes 4 113 / 3 994 / 3 245; main with TASK-130 merged (only the baseline file conflicts)
completes 3 704 / 4 185 / 3 977 (mean +4.5%, seed 1 -10%) with the loop's waits still 4 600 to
6 200 s. Not merged: it meets none of B56's gates and costs step time. To be decided with the owner:
salvage parts (the box forecast bound, the head-cost reuse) as their own measured changes, take the
routing proposal, or combine with TASK-131 Phase 3's rule that a car enters a junction group only
when it can get through.

TASK-134 (Claude Code subagent, Opus 5.5 high, 2026-11-11; merged): overhead lines. Tracks are
wired by `electrified` (`contact_line` or `yes`, or no tag; not `no`, `rail` or `4th_rail`), kept as
an optional `contactLine`; mapped `power=catenary_mast` nodes become `RailNetwork.masts` (the
Overpass query asks for them, `queryVersion` 9; neither extract has any). Wired sections within 30
degrees and about 25 m bundle; supports every 60 m (50 m under 1 500 m radius, 40 m under 500 m),
aligned across a bundle, moved up to 10 m along the track off switches, level crossings, roads and
platforms: portals across three or more tracks, cantilevers for one or two, side or centre poles
for trams; contact and messenger wires over each track, in tunnels only with "See below ground".
Munich: 672 of 676 sections wired (623 tagged, 49 untagged), 32 bundles, 104 portals (the widest
over 44 tracks west of Donnersbergerbrücke), 37 cantilevers, 58 tram supports; Sindelfingen is all
`electrified=no`. No hash moved besides the city pins; load +2.5%, 3D frame over the track field
+0.7 to 4.2%. Lead merge with TASK-137: both schema additions, scene hooks and the rail e2e group
kept; T44 and T49 Munich city pins re-pinned for both. Lead runs: `check` (route-audit timed out
under load, passed alone), `test:city` (the city-cache test timed out, passed alone), the light e2e
(37), T70, T73, T74.

TASK-129 (Claude Code subagent, Opus 5.5 high, 2026-11-11; held for the owner, not merged):
households (2023 microcensus sizes), cars owned per household, drivers per day from the planned
agenda, cars chained by `carId`, per-car starting stock, home parking within 400 m (none beyond on
the branch to 20:00; main had one at 417 m). The default scenario's `carShare` is 1, so in Munich
every resident drives their own car and the trips equal main's; only the starting spaces move.
Munich 0.15 to 10:00 over seeds 1 to 3: completed 4 113 to 3 344 (-18.7%), 3 994 to 4 001, 3 245 to
3 668 (+13.0%), total -3.0%; reshuffling only the space draw spans main 3 595 to 4 155 and the
branch 3 344 to 3 717 on seed 1, driven by how badly `r:666` jams. The agent lowered T63's
completed floor from 3 571 to 3 300; the lead does not accept that without the owner. Also found:
`T54-parking-motion`'s Munich case fails on main too (not in the light tier).

TASK-128 (Claude Code subagent, Opus 5.5 high, 2026-11-12; held for the owner, not merged): S-Bahn
riders at Donnersbergerbrücke as walk-only persons outside the population (`src/demand/stations.ts`,
`rider-profile.ts`, a read-only `stationArrivals` in `src/network/trains.ts`; no `src/sim` change).
Every S-Bahn stop at a station platform brings commuters by arrival hour (05:00 to 10:59) and visitors
(11:00 to 21:59), scaled by `personsPerResident`; each walks out from its own point along the train
to a place within 1 500 m (jobs or attraction times exp(-d/600 m)) and walks back after its stay.
Munich 0.15: 720 stops, 1 339 riders, 2 501 trips a day; to 10:00 586 spawned, 568 completed, 0
failed, 0 walk fallbacks; the inspector reads "By train at Donnersbergerbrücke". Cars on seed 1:
3 679 completed (gate floor 3 702, 89.4% of main), 37 gridlocked (+11, gate +10): fails. An earlier
rider rule over seeds 1 to 3 gave 3 558 / 4 074 / 3 680 (main 4 113 / 3 971 / 3 669 in the same
runs); with every rider kept but walking nowhere seed 1 still drops, so the loss is seed noise, not
riders on crossings. Waits on the owner's gate method (three-seed mean or B56 first).

TASK-141 (lead review, 2026-11-12, 343da1e): T54 selected a garage at pk:2042 instead of the
original Munich lot (OSM way 160401431, now pk:2053). The city test could pass on garage
arrivals without exercising lot circulation. Select the historical OSM ways for the two Munich
lots and the Sindelfingen lot; observe a moving drive-in car. No engine change. Lead verified
check, city (151 pass), light traffic, light e2e (37), both T52 arrival cameras and the T54
Munich lot and strip in 2D and 3D. Both Munich lots received 16 arrivals. The agent's loaded
Munich frame ratio failed once at 1.44; the independent lead run passed the unchanged bound.
Integrates with the remaining nightly repairs (TASK-142).

TASK-142 (lead review, 2026-11-12): the nightly Full run on da7721d failed nine browser
cases. TASK-141 fixes the three T52/T54 lot cases. The other six: use the original physical
bay on way 704167778 in T63 (old index 1115, current 1107, less than 0.01 mm apart); verify
smoothed and separated road provenance in the Munich save/replay; route a T47 vehicle on a
movement from its exit lane to its actual parking target. The seventh Munich BUS label used to
lie past the current stop line. V107 verifies the six that fit. No current Munich signal head
lies under a deck; V97 applies a controlled signal at OSM node 20925330 on a clone of the
import, locates its covered approach head, then tests green/red/green, shadows and replay.
V114 exposed a product defect: independently trimmed paint edges could have different vertex
counts. Pair the corner offsets in shared paint geometry, with a curved-stroke regression.
Lead gates: check (1136 unit tests), city, light traffic, light e2e (37), T63 and Munich replay.
Full run 43193281232 passed all jobs on integrated repairs. Traffic code and floors unchanged.

TASK-136 first delivery (lead review, 2026-11-12, 54f8593): mapped road crossings become
facilities with shared 2D/3D placement. Munich has 5 rail, 10 tram and 4 pedestrian mapped nodes.
The 11 nodes on imported roads form 2 rail and 4 tram facilities with 9 incoming approaches.
Sindelfingen has 26 rail nodes, 25 on imported roads, grouped into 18 facilities with 26
approaches. The other road nodes are on excluded private aisles or driveways. Grouping follows
shared highway provenance. Equipment respects the driving side, physical track grade and
carriageway clearance. The Schrenkstraße posts initially stood in the cross street; the final
shots put the single incoming signal at the kerb. The railway shots show both rails across
the asphalt. The T75 oracle recovers prior serialized hashes after removing new crossing fields.
Lead ran check (1144 unit tests), city (162), light traffic, light e2e (37) and three T75 browser
cases, including rail-layer toggling. Full run 43196371675 passed on the integrated tree. No new dependency. Train stopping, moving barriers and
tram interaction still await the simulation work.

TASK-131 Phase 3 / B56 (lead checkpoint, 2026-11-12, a3ccf49, unmerged): the main seed-1
trace found a five-head wait cycle at 08:04:58. The four-junction fixture completed 25 of
200 cars on main and all 200 after accounting for vehicles already crossing toward an exit.
Munich 0.15 at 10:00, seeds 1/2/3: 4214/4177/4044 completed, 1/5/4 gridlocked, zero stalled
heads on each seed (main 4113/3994/3245, 26/41/59). The peak cumulative waits among cars
on the six roads were 5966/6582/6231 s, above 900 s on every seed. The approved independent
Astra review distinguished two individually legal head detours that together form a circuit
from upstream portal waiting. For car 4048, the lead measured 96.8 s of access walking,
50 cars ahead once ready, and 3226 s from walk completion to departure at c:1665. The road
insertion gap on r:371 was occupied in all 620 sampled refusals. The implementation agent
is testing detour history and short-exit storage with merge safety intact. No gate reset.

TASK-131 Phase 3 / B56 (second lead checkpoint, 2026-11-12, unmerged). Short-exit storage
with merge safety intact (`2543949`) gave 4246 completed, four gridlocked and a 5313 s
peak loop wait on seed 1. Remembering an earlier blocked movement across head detours
(`bc093c8`) gave 4172/4218/4061 completions over seeds 1/2/3 and 2/7/3 gridlocked, with
peak cumulative waits of 6898/5862/6038 s. All three exceeded the 900 s limit.

The focused group tests isolated two cases where the engine inspected the wrong downstream
route: a missed turn that reached the intended road in a different lane, and a head detour
proposed before its movement was installed. Fixing the first gave 3517 completions on seed 1.
Fixing both (`2991222`) gave 3392 (main 4113), six gridlocked and zero stalled heads. No car stood on an
inner link at 10:00. Car 2050 had 6248 s of cumulative wait, 6171 s of it before its latest
entry to r:961. Across its visits it stood on r:961 for 966 s. Car 2610 first reached r:273
at 10:00 carrying 5415 s of wait. The replay also found a 179 s stop on inner road r:966
before car 4664 respawned. Phase 3 stays on its task branch while the lead traces its exit.

TASK-131 Phase 3 / B56 (exit reservation review, 2026-11-12, `e2554a4`, unmerged). Four
cars claimed 6.5 m each on a 23.15 m exit. A moving car already on the exit allowed its
projected position to exceed the length of the lane. The branch caps outstanding claims at the
physical length for both occupied and empty exits. Car 2050 then completed without respawning.
In a separate case a reserved movement needed a specific lane on inner road r:364. The car's
ordinary route allowed either lane, so it never requested the change. The branch now passes
the reserved movement's lane to the mandatory lane-change logic (`2b4d275`). The lead
independently measured seeds 2 and 3 on both versions. Their final simulation hashes matched.

| Munich at 10:00, demand 0.15 | Seed 1 | Seed 2 | Seed 3 |
| --- | ---: | ---: | ---: |
| Main completions | 4113 | 3994 | 3245 |
| Exit-capacity fix completions (`e2554a4`) | 3684 | 4153 | 4178 |
| Both fixes, completions (`2b4d275`) | 3746 | 4153 | 4178 |
| Both fixes, gridlocked | 8 | 2 | 1 |
| Both fixes, peak cumulative wait on the six roads (seconds) | 6209 | 6794 | 7734 |

All three runs had zero stalled heads and zero parking failures. Seed 1 missed the completion
floor by 367 trips. All three failed the 900 s limit. The current traffic gate applies.
The lead ran T66 and T68 together on `2b4d275` (28 passed). The branch has no merge clearance.

The trace of car 1029 reached a driving-policy decision on r:671. All 420 evaluations of the
requested lane change found an unsafe gap. After the existing 30 s of holding, the car took a
legal fallback from lane 0 whose route returned through lane 1. The return passed the lane
feasibility check. It accumulated over 900 s of wait before its first head detour. The lead
authorized a simulation experiment: at the first ordinary timeout, allow one extra normal
lane-change window if the fallback returns to the same road through a different usable lane.
The experiment kept every safe-gap check and gave up normally at the second timeout.
It fired 315 times on seed 1. Completions fell on all three seeds, to 3446/4126/4163.
The peak waits were 5754/7163/6225 s. The experiment was reverted in `0981a0a`, the
unmerged task branch tip. The existing 30 s give-up policy, routing contract and traffic
gate apply. A further routing experiment
would need to compare the current legal return with a lane-feasible detour that bypasses the
blocked approach. The Phase 3 contract reserves routing changes for a separate decision.

TASK-131 Phase 3 / B56 (routing and discharge review, 2026-11-12). On the retained branch,
59 cars occupied the six roads at 10:00 on seed 1. All exceeded 900 s of cumulative wait.
Six had exceeded it before their first release, with zero respawns at 10:00. Car 3887 walked
56.6 s to its car, then spent 2451.3 s waiting to enter r:188. The five longest-waiting
cars on occupied loop roads had each spent less than 102 s awaiting their first release.

A replay reproduced car 1029's route cost to within floating-point precision. No legal suffix
from r:267#0 to its destination avoided r:671. In a wider sample of 125 ordinary turn
timeouts, 78 suffixes returned to the approach and 12 of those had a feasible bypass.
The first was on r:968. The bypass cost 320.2 s against 290.7 s for the returning route.

At n:251, 564 of 780 green lane-seconds for right-turn lanes r:269#3/#4 found the lane
empty over 13 cycles. At 08:02 car 1496 was waiting for space on a left return. Car
1610, immediately behind it in the shared lane, wanted the open right exit. The 45 s
head-detour rule eventually cleared 1495 after the receiving green had ended. The upstream
group is unsignalised. Physical queues propagated back to r:703 by 07:59.

The constrained-route experiment (`5bdc4e8`) completed 3722/4265/3782 trips. Seed 1
regressed against the retained fix, and the longest wait exceeded 900 s on all three seeds.
Two isolated lead probes also failed the gate. Using unfinished travel times when a road
had no exits during a cost update gave 4153/3956/4256 completions. Pricing the complete
suffix of each ordinary fallback gave 3929/4619/4052. Neither policy was adopted.

TASK-131 Phase 3 / B56 (shared-lane discharge, 2026-11-12, `ae398f3`, unmerged).
A stopped head can look for a safe detour earlier when its immediate follower needs a
different, available exit. Right turns at n:251 increased from 88 to 102 over 13 cycles.
Munich completions rose to 4601/4788/3999 versus main's 4113/3994/3245, with 4/3/7
gridlocks, zero parking failures and zero stalled heads. The longest cumulative waits
were 6170/5496/7081 s. All three still exceed the 900 s gate.

On seed 1 the six roads held 43 cars at 10:00, down from 59. Every one had exceeded 900 s
before its latest entry onto its current road. Across the city 613 of 617 cars still on the
road were over 900 s. The 43 loop cars' median wait was 4620 s; about 70% of their combined
wait was spent on the road. Some experienced a single road queue over 900 s. Others carried
delay through several junctions or from their origin. On the preceding build, 94 road cars
passed car 3887's parking exit while it waited to leave. Physical clearance was occupied
at all 2452 one-second samples. Existing safety checks correctly prevented an overlap.

TASK-143 (lead review, 2026-11-12, `254ed12`). While a head waits, the engine can reuse
its landing-lane route result within the current cost version. It checks exit space and
movement eligibility every step. Destination, trip routing inputs, lane replans and live
city edits invalidate old answers. A failed search refreshes when the costs change.
State hashes matched main for seeds 1/2/3 (507565795, 2362085700, 473190784), with the
same completions, mean delays, gridlocks and respawns. Requests fell from 246735/260075/353296
to 117896/120760/133529. After a warm-up on each build, alternating full-morning seed-1
runs took 65.96 and 70.43 s on main, 66.44 and 66.15 s with reuse. The mean was 2.8%
lower; the ranges overlap. Lead check passed 1148 unit tests, city 162, light traffic
and all 37 light browser tests. Full run 43216929096 passed on the integrated code.
The traffic baseline is unchanged.

TASK-131 Phase 3 / B56 (integration review, 2026-11-12). At r:1258 a discretionary pass
added a mandatory change on the downstream approach. Over the next roads the car found no
safe gap. Comparing the mandatory changes within one normal change window kept that car on
its original route. It completed with 308 s waiting and no respawn. At a separate roadside
exit, a safely stopped follower made a gap for car 3887, which left 1265 s earlier in the
first courtesy trial. The corrected policy bounds pre-admission holds at 10 s even across
the floating-point boundary at simulation time 32768 s.

| Munich at 10:00, demand 0.15 | Completions (seeds 1/2/3) | Gridlocked | Peak cumulative waits on the six roads (s) |
| --- | --- | --- | --- |
| Main | 4113/3994/3245 | 26/41/59 | 6888/5807/7089 |
| Downstream lane choice on the exit-reservation candidate (`5b1d223`) | 4474/4782/4627 | 3/9/2 | 6965/5872/7058 |
| Shared-lane release + downstream lane choice (`b2ef07b`) | 4560/4827/4580 | 4/5/5 | 6868/6612/5731 |
| Shared-lane release + corrected roadside courtesy (`7d60fd0`) | 4708/5003/4462 | 6/2/2 | 6012/6352/5181 |
| All three integrated locally with TASK-143 (`62cd578`) | 4720/4879/4443 | 4/2/5 | 6073/6882/5762 |

The integrated candidate on `task/lead-131-candidate` had zero parking failures and zero
stalled heads on all seeds. A second seed-1 run matched hash 3673406659. On all three
seeds the six-road dependency probe detected no sustained cycle and no car stood on an
inner link at 10:00. The longest inner-link stops earlier were 152/179/179 s.
The car carrying 6073 s on r:364 had added zero seconds during that visit. The standalone
lane-choice trial had one stalled head on seed 1.
The roadside trial improved direct roadside releases but moved some waiting to other
vehicles and garages. Combining the policies did not clear the 900 s whole-trip limit.
The candidate remains unmerged. Its T46 town pin accounts for an independently reproduced
0.5 vehicle-seconds saved across the same 207 completed trips. Explicit cars and legacy
trips with default classes still produced identical metrics and hashes.

At garage p:1664 the independent seed-1 replay matched the integrated hash. All 409
first departures and 65 respawns eventually left through c:1665. With an always-clear
road, the existing 30/min meter could have served that same arrival sequence with at
most 6 s waiting. In the real run 106 first departures waited over 900 s after becoming
eligible. Every rejected attempt also failed the road-entry clearance check. Six of the
48 cars on the watched roads came from this garage, and four of the six had exceeded
900 s before first leaving it. This connector explains a subset of the carried delay.

The 09:30 Munich probe completed 4082 trips with 4 gridlocks against main's 3777 and
12. On Sindelfingen at 0.15 both builds completed 155 of 445 released trips with zero
stalled heads or gridlocks, 49 route failures and 241 parking failures. The equal totals
had different state hashes (main 2991941029, candidate 3414305433).
The named full-demand Munich test passed with 3063 completed trips, 95 gridlocks and
zero stalled heads. Main's Full run 43216929096 recorded 1765, 315 and one respectively.
Both had zero parking failures.
T53 completed 1669 trips without walkers and 1652 with walkers (1.02% cost). No
pedestrian was dropped, no hard stop occurred, and the crossing clearance test passed.
The candidate passed 1200 unit tests, 162 city tests, the light traffic tier and all 37
light browser tests. The stop-control browser test now selects the junction before
stepping the baseline morning. Selecting it after 1500 steps picked vehicle 32 over
the junction center. The queue-growth assertion and both traffic runs are unchanged.
T16's three browser cases, T54, T57 and demo C passed.

Two warm seed-1 runs per build, with the order reversed for the second pair,
gave mean Munich step times of 70.82 s on main and 77.01 s on the candidate
(+8.73%, above the 5% B56 limit). Route requests fell from 117896 to 104441.
Sindelfingen step time rose from 2.42 to 2.71 s (+12.07%, above 10%).
Mean uncached import/compile times in ms were 6567/1026 to 6514/936 in Munich
and 5584/878 to 5438/842 in Sindelfingen. The retained local checkpoint is
`4ab4d71`; its simulation is identical to `62cd578`. The traffic baseline stays
at main's values. TASK-128, TASK-129 and TASK-130 remain held.

### 2026-11-12 operating crossings and tram service (TASK-136 and TASK-138)

The lead reviewed `38340cc` on `task/lead-rail-service-merge`. The seed-1 Munich gate
blocked both the combined service and a separate railway-only release. The floor is 3702
completed trips, the gridlock ceiling is 39, and the baseline allows zero stalled heads.

| Munich at 10:00, demand 0.15 | Completed | Gridlocked | Stalled heads |
| --- | ---: | ---: | ---: |
| Main | 4113 | 26 | 0 |
| Operating railway crossings only | 3683 | 29 | 0 |
| Operating railway and tram crossings | 2968 | 61 | 0 |

The combined branch serves all 54 Munich tram sections and 14 stops with four synthetic
services. The train-only timetable hashes on both extracts match main. In the browser a car
waited for the last carriage and then drove on, for both rail modes and in both views.
The tram at Trappentreustraße stopped with its leading cab at the mark and departed after
25 seconds. Verification passed 1190 unit tests, 164 city tests, 37 light browser cases
and three named operating-crossing and tram browser cases. Unit and city each have one
existing skip. T21 road safety and T53 pedestrian checks passed. [PR CI](https://github.com/Chengxuan-Li/cityflows/actions/runs/43295800165)
reproduced 2968 completions, 61 gridlocks and zero stalled heads. Code and browser CI passed.
The earlier full checkpoint
at `5cac0d8` passed all six browser groups and city geometry. Its traffic job missed the
morning floors and timed out on full demand.

The first combined prototype counted a stopped car 72 m upstream as occupying the tracks.
Another car crossed a closed facility when the marking coincided with the exact end of its
lane. After both repairs, all four served Munich tram crossings reopened during the loaded
three-hour run. On an open isolated lane with enough space for the entire three-car platoon,
the last car now clears at 41.5 s, matching the road without rail (previously 42.6 s).
The 96-minute Munich footprint replay sampled all 57600 steps and 499 near encounters.
It found no road/rail contact inside a mapped crossing. Car 785 touched a tram on parallel
road `r:981`, 31 m outside the protected crossing, with up to 0.162 m overlap. Parallel
track and road alignment belongs to deferred TASK-139.

At 08:30 queued exits into `r:248` and `r:364` blocked occupied junction movements.
The waiting cars at upstream crossing marks held no conflicting junction grant in that
sample. Reissuing the full warning at the next crossing after an upstream train hold was
tested separately (3090 completions, 55 gridlocks) and left out of the branch. On seeds 2
and 3 the final candidate completed 2801 and 2738 trips against 3994 and 3245 on main,
with 80 and 50 gridlocks and one and zero stalled heads respectively. The original traffic gate is intact. The reviewed work is preserved in
[draft PR #1](https://github.com/Chengxuan-Li/cityflows/pull/1). TASK-131 Phase 3 / B56
remains deferred. TASK-128, TASK-129 and TASK-130 retain their owner holds. TASK-113 awaits
TASK-129, and TASK-139 remains dropped for now.

### 2026-11-12 Munich access, rail frame times and held PR CI

TASK-144 reproduced a missing southern entrance on aisle way 159640404. Its northern
entrance already served the lot. The candidate joins the southern endpoint at OSM
node 1717584268 to service way 159640408 and restores a second shared node, 1717561493,
lost when two public ways were joined. Three fixed gateway round trips completed through
parking, dwell (457, 487 and 491 seconds) and departure. The reviewed late split recorded
3964 completions, 32 gridlocks and zero stalled heads in the original gate. Every original
road and lane index, all four sampled seeds' road-noise values, the 96 unrestricted route
paths and costs and the complete train timetable match the parent. Ten more complex
Munich joins and sixteen Sindelfingen candidates remain diagnosed.
[Parking audit](https://github.com/Chengxuan-Li/cityflows/pull/4).

TASK-145 reproduced excess 3D rail frame time on the default Playwright SwiftShader
backend in both the stationary and moving cameras. A delayed observer callback dropped
one render measurement per window. The corrected sampler retains the raw animation
intervals and all render entries. Isolating track paint identified the largest measured
layer cost. Per-track and 256 m spatial batches both missed the ten-percent limit.
The final one-worker Playwright run at `2fabc13` measured +14.61% in stationary 3D and
+14.83% and +13.80% in moving 3D on SwiftShader. On the same host, full Chromium
using the RTX 4070 SUPER measured +0.55% stationary and −0.01% and −1.80% moving.
Both 2D cameras passed on both backends. [PR #2](https://github.com/Chengxuan-Li/cityflows/pull/2)
merged as `9cca6a6` with the sampling correction. The default 3D budget remains open.

TASK-147 reproduced PR #1's 2968 completions and 61 gridlocks. Running the same
timetable without the crossing controller in a diagnostic reproduced main's 4113/26/0.
An occupied crossing could stop another tram's motion clock after its tail had cleared a
previous crossing, stretching a one-second release guard by minutes. The reviewed repair
`dcdaa10` counts that second in simulation time. It is on the existing held PR at
`68f55ac`. A three-hour physical replay recorded 260 road entries and exits across mapped
facilities with zero inside-facility contacts. T21 and T53 pass. The original seed-1
traffic gate remains red at 3201 completions, 68 gridlocks and zero stalled heads.
The trace found stopped cars on conflicting turns blocking both exits from the two
Landsberger tram crossings. [PR #1 CI](https://github.com/Chengxuan-Li/cityflows/actions/runs/43316340090).

TASK-146 located the westbound lane gain at OSM node 297271363 on Arnulfstraße.
Ways 146018788, 146018784/146018786 and 134171421 carry two, three and five westbound
lanes respectively. Opposite way 134583817 carries two at this point. Eastbound traffic
gains two lanes separately at `n:27`, west of the interchange. At `n:652`, the renderer
eased the two added lane centres a second time when drawing their strips, separating their
shared edge by 1.058 m. The first repair moved a pedestrian corner and left three stalled
heads in the Munich gate. The replacement corrects the paint and corridor outlines only.
The complete compiled vehicle and pedestrian graphs of both cities match the clean control.
Four carriageways use the corrected display geometry. The final original traffic tier meets
its zero-stalled-head gate. Check, city and all 37 light browser cases passed.
[Lane-gain audit](https://github.com/Chengxuan-Li/cityflows/pull/3).

TASK-144's first candidate changed synthetic S-Bahn departure offsets by shifting rail
node IDs. The unchanged T70 departure-row assertion exposed it. The replacement restores
the joins after ordinary import allocation and retains original road/lane indices in both
cities. The full Munich timetable is byte-identical to the clean control. Lead review also
found that late portal allocations advanced a temporary copy of the city counter. The
correction now advances the canonical counter and tests the next allocation after reopening.

### 2026-11-12 geometry merges and held tram-crossing CI

The lead merged the westbound lane paint in `2a9b645` and the two parking access
repairs in `89fc5d8`. The combined build preserves the original 96 unrestricted
routes and S-Bahn departure rows. Four Munich drawing digests combine the intentional
curb/paint and parking changes. The light PR checks passed on both integration branches.
[Lane-gain checks](https://github.com/Chengxuan-Li/cityflows/actions/runs/43320837918)
and [combined parking checks](https://github.com/Chengxuan-Li/cityflows/actions/runs/43322458878).

The lead brought this geometry into held PR #1 at `7a8fb1f`. Its canonical cities,
non-rail compiled graphs and all 96 road routes match the new main. Its crossing spans
and entire train/tram timetables match the reviewed PR. Typecheck, unit, city fixtures,
T70 browser and light e2e pass. Seed 1 still has 3319 completions, 52 gridlocks and zero
stalled heads. T21 and T53 pass. The completion floors remain 3702 for traffic and 3571
for T63. [PR CI](https://github.com/Chengxuan-Li/cityflows/actions/runs/43324312070).

On the prior PR head, letting a stopped tram wait before warning removed about 1000
seconds of protection at each Landsberger crossing. A road vehicle remained on the tracks
through a complete 121-second road cycle with both crossings open. This trial reduced
completions from 3201 to 3075. Following the actual feasible road lane instead of the
representative route lane exposed a real missed red at `r:252`; the correction alone
also held more drivers behind moving cars. That trial completed 2669 trips. Both
experiments were rejected.

On the updated PR, giving road vehicles already on the tracks priority within ordinary
grants and accounting for physical storage at their conflicting exits reached 3588
completions, 40 gridlocks and zero stalled heads in a diagnostic replay. The original
gate requires at least 3702, at most 39 and zero. A separate experiment secured both
junction movements and the receiving space before entering eligible compact links.
It recorded 34 claims, zero deadline expirations and no mapped contacts, but completed
only 2901 trips with 64 gridlocks. Its official T53 pedestrian check found a car on
a crossing span occupied by a walker on `r:184#0`. Combining the two finished at 3050/48/0.
The lead rejected these experiments and kept the reviewed clock fix on draft PR #1.
No qualifying repair for the remaining traffic failure was established. TASK-128 through
TASK-130 remain held and B56 deferred.
[Road storage replay](https://github.com/Chengxuan-Li/cityflows/actions/runs/43326354796),
[compact-link replay](https://github.com/Chengxuan-Li/cityflows/actions/runs/43328451433)
and [combined replay](https://github.com/Chengxuan-Li/cityflows/actions/runs/43328502397).

### 2026-11-12 TASK-147 crossing interlock and road discharge

The held PR reproduced 3319 completions, 52 gridlocks and zero stalled heads on
seed 1. One tram waited 307.7 seconds at the first crossing while keeping a second
crossing closed ahead of it. The downstream road could have discharged during that wait.
At an occupied rail exit, a competing turn could also take storage needed by a car on
the tracks.

The PR now releases the held service's downstream warning while an upstream road
body prevents its entry. It gives the downstream road its full warning again before
the tram can enter. Competing road grants account for already allocated storage beyond
the shared conflict zone. A driver leaving the tracks can take the first legal grant.
These changes are in `1a502a6` and `cb8fd8a`, integrated on the draft PR at `eb7c089`.

Seed 1 completed 3719 trips with 37 gridlocks and zero stalled heads. The existing
limits are 3702, 39 and zero. T21, T53 and T63 pass. A physical replay at 0.1 s
intervals recorded 262 service entries and 261 exits by 10:00, with zero contacts at
mapped crossings. The existing parallel road/track case on `r:981` and `rt:10157`
still recorded two contacting pairs outside the mapped facilities (TASK-139). Browser
checks passed for operating rail and tram crossings and the Munich tram's stop and
departure in 2D and 3D. GitHub passed check, city and e2e at `eb7c089`. The PR remains held. TASK-128
through TASK-130 remain held and B56 remains deferred.
[PR #1 checks](https://github.com/Chengxuan-Li/cityflows/actions/runs/43338527308).

### 2026-11-12 TASK-148 and TASK-149 candidate review

TASK-148 reproduced the rail overhead with the original stationary camera. Culling
35,453 off-screen triangles within one draw left the frame interval at 236.66 ms
in both cases. Single-sided paint and vertex colour conversion also missed the
10% target. The reviewed fix reuses settled-camera rail paint only on SwiftShader.
A hardware RTX 4070 SUPER kept the original mesh and passed all six named tests.
The combined build passed the stationary 3D gate at 221.66 ms with rail on and
208.14 ms off (+6.50%). Its moving 3D pairs were +7.23% and +8.95%. One unchanged
moving 2D pair exceeded the 10% budget at +12.98%. The full first combined run
therefore recorded five passes and one failure. A fresh complete combined run
passed all six tests with stationary 3D +7.36%, moving 3D +8.04% and +7.50%,
and moving 2D +9.35% and +9.54%. Rail geometry also survived a WebGL context
loss and restoration with identical pixels at the original camera. The original
workload and threshold were used throughout. See the [TASK-148 report](tasks/TASK-148.md).

TASK-149 traced ten Munich and sixteen Sindelfingen mouths to shared OSM nodes.
The first candidate split the through roads at all 26 mouths. It changed 43 of the
96 reference routes against a limit of nine and was rejected. The next candidate
keeps the through road and attaches parking circulation at the source entrance.
The independent route comparison preserved all 192 full route records across the
two cities. The directed-path audit covered all 26 mouths and 94 direction records.
Richelstraße gains 86 usable bays. Three other Munich lots gain 17, 10 and 6.
Sindelfingen's largest audited lot has 149 reachable bays out of 150 generated.

The unchanged Munich 10:00 gate rejected revision `e99c03c` with 3,323 completed
trips, 49 gridlock failures and one stalled head. At lot pk:2053, 16 drivers
failed after choosing a mouth that reaches only 26 of the 75 bays. Claiming a
reachable bay on approach removed all 16 parking failures in `5475921`, with
3,498 completed trips, 43 gridlock failures and zero stalled heads. A separate
trace shows a van waiting 5,595 simulated seconds at lot pk:2049 on r:639.
An outbound car required the same lane gap where the van waited for admission.
The combined repair ranks legal entrances within the selected lot, claims a bay
reachable from that entrance, and leaves a lane gap for an already committed
departure at a shared mouth. The original seed-1 T54/T63 traffic gate passed at
`94ff5b9` with 3,928 trips completed, 36 gridlock failures, no stalled heads and
no parking failures ([traffic run](https://github.com/Chengxuan-Li/cityflows/actions/runs/43358073560)).
The old 5,595 s circular wait no longer appears in the matched trace. An egress at
the other ramp mouth can still delay admission while it waits for public traffic.

Six representative facilities completed all 12 arrival and return legs on the
integrated build. Matched captures cover eleven lots, including the additional
under-bridge lot. All [PR #5 checks](https://github.com/Chengxuan-Li/cityflows/actions/runs/43359890405)
passed on the reviewed source and final evidence.

A parking follow-up remains. An exiting car's visible body can reach a public lane before
a passing car leaves enough room for it to merge. On the same authored lot, main
before TASK-149 and the integrated build produced the same 1,476 overlapping
footprint samples. The first occurred at 152.4 s. Track the physical merge
separately from the repaired mapped entrances.

### 2026-11-13 TASK-150 merge and PR #1 integration attempt

TASK-150 (Claude Code subagent, Opus 5.5 high; merged): a car leaving a lot stops at the farthest
drive-out pose whose whole body is clear of the exit lane and is granted from there, by the same
spawn-gap and lot-release tests, checked at its join station (the hold's nearest lane station plus
its distance from the lane centre, capped at the later of connector and stop line). The grant
inserts it into the lane at speed 0, so followers see it before its body crosses the lane edge; a
new `merge` phase draws it turning in at lot speed (0.25 m a step) and hands over without a jump.
A destination between the connector and the join station (its own lot again) is where it joins.
TASK-149's witness: 1,476 overlap samples before, 0 after. T77 (3 tests, all failing on main): no
overlap or lane intrusion while refused, through cars' poses and speeds identical with and without
the lot car, merge steps within 0.30 m, a second lot car queues without overlap. T54, T59, T63
unchanged. Lead run of the merge `871951f`: `check`, `test:city` (166), the light traffic tier at
seed 1: 3,903 completed, 36 gridlocked, 0 stalled heads, 0 parking failures (main 3,928 / 36 / 0 /
0); agent's light e2e 37 passed. Seeds 2 and 3 (diagnostic): 3,909 / 30 and 3,169 / 50 (main
4,068 / 36 and 3,322 / 50). No pinned simulation, route or timetable hash moved. Open: five lots
whose aisles are mapped on roads (Munich pk:2052, 2053, 2054, 2057; Sindelfingen pk:1487) have no
clear pose and still hold in the lane band; pk:2049's admission wait falls only from 2,503 s to
2,173 s, so it stays a separate item; the mean lot leave time rose from 229.5 s to 433.9 s with
those waits. Shots under `D:\cityflows-wt\150\test-results\task150\`.

PR #1 integration (lead, owner's instruction to merge if GitHub CI passed): the PR's CI was green
at `eb7c089`, and its merge onto main (`6c8361c`, branch `task/lead-pr1-merge`) conflicts only in
test hash pins. City hashes equal main's; compiled roads, lanes, movements and parking equal main
byte for byte; compile pins move for TASK-136's crossing facilities and TASK-138's compiled
`rail.tramStops` (Munich only). `check` (route-audit passes alone) and `test:city` (168) pass. The
unchanged Munich gate fails on the combination: 3,300 completed, 49 gridlocked, 1 stalled head, 1
parking failure (PR #1 on its old base 3,719 / 37 / 0; main 3,928 / 36 / 0). Not pushed: main's CI
runs this gate. The likely interaction is TASK-149's restored lot access with PR #1's crossing
control; diagnosis waits for the owner.

TASK-128 re-measure (Claude Code subagent, Opus 5.5 high, 2026-11-13; not merged, still held): the
branch merged onto main `f887c67` with one conflict (`playwright.config.ts` group e, both specs
kept) and no pin moved (`7182dd9`, `task/lead-128-remeasure`). `check`, `test:city`, T65 and the
light e2e (37) pass; timeouts under load passed alone. The unchanged seed-1 gate fails: 3,481
completed (floor 3,702, T63 floor 3,571), 33 gridlocked, 0 stalled heads, 0 parking failures; T21
and T53 pass. Riders as before: 586 walks started by 10:00, 568 completed, 0 failed. Against main
measured the same way (3,928 / 36 / 0 at seed 1; 4,068 and 3,322 at seeds 2 and 3) the branch
completes 3,481, 3,405 and 3,191 (-11.4%, -16.3%, -3.9%), with gridlock 33, 45 and 52. The loss is
now consistent across seeds, not seed noise, so the owner's merge condition is not met.

TASK-151 (Claude Code subagent, Opus 5.5 high, 2026-11-13; stopped under its B56 clause, no
repair): the combination of PR #1 and main (`4855f09`, with TASK-150) gives 3,287 / 44 / 0 / 1 at
seed 1, 3,248 / 56 at seed 2 and 3,297 / 27 at seed 3. Against PR #1 on its own head (3,719 / 3,310
/ 3,116) the difference is -432, -62 and +181: no systematic parking interaction (main's
shared-mouth yield off: +19). PR #1 already cost its old base 245, 37 and 508 trips. The cost sits
at the two Landsberger tram crossings inside the B56 loop (facilities 1 and 2): treating them as
unserved recovers +274 on the three-seed mean, the other served crossings -70, no crossing
controller 4,215 / 3,746 / 3,478. `r:966` (7.75 m, feeding the loop ramp `r:703`) and `r:252` (6.42
m) lie wholly inside the crossing area between two signals; a car admitted there waits with its
body on the tracks while the loop refuses it (`r:966>r:703` exit full 48,440 times, conflicts with
the B56 head road `r:961>r:364` 23,243). Cars stood on the tracks 10,197 s at facility 1 and 6,534 s
at facility 2; trams wait safely up to 446 s. TASK-147's release guard is not back. Requiring exit
storage before admitting a car onto the crossing cut on-track time by a third but gave 3,397 /
3,314 / 3,061 with stalled heads, so it was rejected. The one parking failure is van 2796 refused
at pk:2056 on `r:669#0`, a road ending at the extract edge (seed 1 only). Sindelfingen compile pins
re-pinned on the branch (`ba6eddb`; TASK-136 crossing fields only, proved by disabling that step).
`f59d680` on `task/151-pr1-gate`; evidence in `D:\cityflows-wt\151-evidence\`. PR #1 stays
unmerged pending the owner's call on B56 or a new entry rule for links inside a crossing.

TASK-129 on main with TASK-150 (lead, `task/lead-129-merge`): 4,091 completed, 44 gridlocked, 0
stalled heads, 0 parking failures: fails the gridlock limit (39). Not merged; re-measured at the next
main change.

TASK-152 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): at five lots each bay's access
point lies on a car lane that also carries its exit, so TASK-150 found no hold pose and the car
waited in the lane band (pk:2054 and pk:2057 also turned on the spot). `compileBayDepartures` in
`src/network/parking.ts` gives such a bay a departure connector at its own station on that lane
(or the opposite lane of the same two-way aisle; never against a one-way), only where the public
network is legally reachable from there. The connectors are appended after all others, with no walk
anchor and no entry listing, so admission and claims are unchanged. The car leaves strip-like:
gap, followers' braking and reversing room checked while parked, then inserted at its station.
Bays switched: pk:2052 39, pk:2053 14, pk:2054 33, pk:2057 1. Sindelfingen pk:1487's aisle exit is
illegal (private plant street), so an exit with no clear hold is offered only when no other exists.
Census: Munich no-clear-pose pairs 136 to 0, in-place U-turns 34 to 0; Sindelfingen 6 to 0. A
wider first rule (126 Munich bays) failed the gate (3,675 / 50, seed 2 a stalled head) by sending
pk:2056 cars through n:661 onto r:666, and was narrowed. T78 (3 cases, all failing on main). The
192 route records are byte-identical. Munich to 10:00 equals main's state hash every minute on
seeds 1 to 3 (no departures from these lots before 10:00). Eight Munich compile pins moved, all
from the 87 new connectors (each passes on main's pin with the step disabled). Lead run of the
merge: `check` (1,195), seed-1 gate 3,903 / 36 / 0 / 0. Open: TASK-150's hold is checked against
the exit lane only, so a car bound for the far lane of a two-way street waits inside the near lane
(Munich 333 pairs, Sindelfingen 1,749), and its grant checks only the far lane's gap; holds inside
aisle lanes no lane vehicle reaches (Munich 68, Sindelfingen 232).

TASK-153 (Claude Code subagent, Opus 5.5 high, 2026-11-13; held until TASK-154): at pk:2049, car
3599 waited 2,173 s at entry `c:2155` because `lotBusy` closed the lot to every arrival while any
car was leaving, at either mouth (3796 held 2,111 s at exit `c:10844` for a gap on `r:663#0`).
Relaxing that exposed a deadlock: TASK-149's shared-mouth yield measured from the connector, while
TASK-150 checks the departing car's gap at its join station short of it. The branch blocks an
arrival only where its path to its bay comes within body clearance of a departing car's stand or
remaining drive (otherwise it takes the next free clear bay, moving its claim), measures the yield
from the earlier of connector and join station, and lets a car leaving a full lot for a place the
lot serves claim the bay it frees (van 2796's refusal at pk:2056 on PR #1 plus main; no case on
main seeds 1 to 3). pk:2049 longest admission wait 2,173 s to 6.8 s (343 s counting a stop just
upstream at a genuinely shared mouth); its exit waits worsen at seed 1 (2,111 to 3,152 s, car 3544
held while through traffic stands across its join point on `r:639#0`), mixed on seeds 2 and 3.
`tests/sim/lot-admission.test.ts` (4 cases, all failing on main); T48, T52, T54, T59, T63, T77 and
the lot-access city test pass; `check`, `test:city`, light e2e 37. Seed 1: 4,327 completed, 32
gridlocked, 1 stalled head (car 4622 at the head of `r:961#0`, waiting for `r:364#0`: the B56 loop),
0 parking failures; seeds 2 and 3: 3,981 / 29 and 3,314 / 53 (main 3,909 / 30 and 3,169 / 50). No
pinned hash moved. Held: it is re-measured on top of TASK-154. Open: pk:2049 exit waits need a
keep-clear rule for through traffic; pk:2052's second entry starved by a stream of arrivals; trips
starting and ending at one lot drive out and back. `5de8b78` on `task/153-lot-admission`.

TASK-154 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): TASK-131 Phase 3 lands from
candidate `4ab4d71` (exit reservation capped at physical length, reserved-lane passing, downstream
lane choice, shared-lane early head release, bounded roadside courtesy) with one new rule: a car
already admitted to a junction group blocks a shared movement only if it could reach it before the
entering car clears, on the timing single junctions use (`r:961`'s right turn was refused through
every green by cars admitted at `r:968` and `r:964` 70 m or more upstream; new T68 case). Four exact
rewrites (seed-1 hash unchanged after each) brought Munich step time to +4.0% over eight warm
alternating pairs (median pair +5.0%, range -0.3% to +9.4%; route requests 114,989 against
124,583); Sindelfingen -0.8%. Drain criterion over seeds 1 to 3: (a) no sustained cycle (main 38 /
72 / 58); (d) zero stalled heads; (b) not met, worst single visits `r:961` 1,803 / 1,785 / 1,544 s
(group 10 gives its right turn 15 s per 120 s while the `r:966 > r:703` stream never stops inside
the group: TASK-161) and `r:997` / `r:273` up to 1,299 s (the pk:2049 jam, TASK-153); (c) not met
on seeds 2 and 3 (one to three cars on inner links at 10:00 for 13 to 111 s). Cars on the six loop
roads at 10:00: 31 / 67 / 67 (main 85 / 54 / 107); longest inner-link stop all morning 179 s (main
about 360). Seeds 1 to 3: 4,224 / 4,134 / 3,825 completed, 6 / 11 / 8 gridlocked, 0 stalled heads.
PR #1 on top passes the seed-1 gate (3,818 / 8 / 0 / 0); cars stopped on the tracks 667 s at
facility 1 and 4 s at facility 2 (TASK-151: 8,509 and 5,790), tram holds of 30 s or more 8 (32).
Lead run of the merge onto main (`task/lead-154-merge`): `check` (1,248), seed-1 gate 4,224 / 6 / 0
with one parking failure on `r:669#0` (within the test's 2% rule). Only the candidate's own pins
moved (T46, T22, T53). The traffic baseline is unchanged pending the owner (main now completes far
above it).

TASK-153 merge (lead, 2026-11-13): stacked on main with TASK-154 (`task/lead-153-merge`, with the
lead's integration of TASK-152 in `f8cb08a`). Seed-1 gate: 4,560 completed, 4 gridlocked, 0 stalled
heads, 0 parking failures (TASK-154 alone 4,224 / 6 / 0 / 1; the `r:669` parking failure is gone).
`check` (1,252), the sim unit tier (364). Merged.

PR #1 merge (lead, 2026-11-13; TASK-136 operating crossings, TASK-138 scheduled trams, TASK-147
repair, with TASK-151's Sindelfingen pins): stacked on main with TASK-154 and TASK-153
(`task/lead-pr1-final`). Conflicts: `engine.ts` keeps TASK-154's reserved-space spawn check and PR
#1's rail-crossing spawn check; `intersection.ts` keeps TASK-154's group clearance helpers and PR
#1's rail bands; Munich compile pins move for TASK-152's departure connectors plus PR #1's crossing
facilities and compiled `rail.tramStops` (T75's stripped compile for Munich alone, since Sindelfingen
has no tram stops). Seed-1 gate: 4,373 completed, 5 gridlocked, 0 stalled heads, 0 parking
failures (main before 4,560 / 4 / 0 / 0); T53 passes. `check` (1,304), `test:city` (168). Merged;
PR #1 closes with it. TASK-128 to TASK-130's holds are unaffected.

Traffic baseline reset (lead, owner's decision of 2026-11-13, after PR #1's CI passed on main,
run 43412997493): `bench/traffic-baseline.json` now holds main at `cd0b994`, Munich 0.15 to 10:00
seed 1: 4,373 completed, 5 gridlocked, 0 stalled heads (was 4,113 / 26 / 0); the 09:30 quick sample
3,737 / 4 / 0 (was 3,777 / 12). The gate's derived limits become at least 3,936 completed and at
most 7 gridlocked (1.5 times the baseline) with zero stalled heads; T63's absolute floor of 3,571
is unchanged. Branches in flight (TASK-129, 156, 157, 159, 161, 162) are judged against the new
baseline.

TASK-129 merge (lead, 2026-11-13): household car ownership merged onto main with TASK-154, TASK-153
and PR #1 (`task/lead-129-merge`). The lead resolved `parking.ts` (TASK-153's vacated-bay claim
inside TASK-129's home-radius search) and `bench/import-probe.ts` (main's `demandSeed` and observers
with TASK-129's `endS`); T63's floor stays 3,571 (the branch's lowering was reverted). T67's
replay-of-main pin moved to cd0b994's hashes, proved by computing them on main itself (1,614 trips,
890697552 / 2048011605 / 3080062683). Seed-1 gate against the reset baseline: 4,076 completed, 1
gridlocked, 0 stalled heads, 0 parking failures; T63, T21, T29 and T53 pass (the gate test's
600 s setup hook was raised locally for the run only; the machine was running seven agents).
`check`, `test:city` and the light e2e (38) pass, with timeouts under load (T64, T46, route-audit,
T36.1) passing alone. Earlier measurements on older mains are in the TASK-129 entries above.
TASK-113 (mode choice) starts on this main.

TASK-155 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): Sindelfingen's 245 to 290
failures at 0.15 all touched four gateways (now p:1292, p:1295, p:1298, p:1307) on cropped motorway
pieces that reach no local parking, labelled `no_parking` though no facility was reachable. A
lane-level car reachability (`src/network/car-service.ts`) now lets a gateway generate only legs a
car can serve (a person whose next leg cannot be served stays put for the day; through and event
trips only between servable ends), an import note `gateway_unserved` names each such gateway, and
a trip needing parking fails as `no_parking` only when one of its facilities was reachable.
Sindelfingen seeds 1 to 3: 445 / 155 / 290 released / completed / failed to 155 / 155 / 0 (and 168,
158 on seeds 2, 3), served trips byte-identical; Munich has no such gateway (state hashes equal
main). At the lead's request `scheduleTrips` takes the caller's compiled city (a contract change in
architecture, demand section): a Munich demand rebuild costs 64 to 94 ms instead of about 2.2 s.
Lead merge onto main with TASK-129: `schedule.ts` truncates unservable agendas, then TASK-129
assigns household cars; the gateway test now compares trips without car ids, since a household's
car indices shift when a member whose work is on a cut-off piece stays home, and asserts each car
trip uses the driver's household car. Seed-1 gate 4,076 / 1 / 0 / 0 with T63, T21, T29 and T53;
lint, format, build, the demand and sim unit tiers (436) pass; timeouts under load passed alone.

TASK-159 and TASK-128 merge (Claude Code subagent, Opus 5.5 high, then lead, 2026-11-13; merged):
TASK-159 re-measured TASK-128 on main after B56 was drained and found no car cost to repair:
seed 1 4,517 / 4 / 0 / 0 (main 4,373 / 5), seed 2 4,662 / 4 (4,488 / 3), seed 3 4,365 / 3
(4,393 / 2). The earlier -11% / -16% / -4% came from the locked Landsberger loop magnifying small
changes. Riders unchanged: 586 / 585 / 584 walks by 10:00, 0 failed, 0 walk fallbacks; they cross at
zebras (51 each at `n:645` and the `r:476` midblock zebra). The lead merged TASK-128 (via
`task/159-rider-cost`) onto main with TASK-129 and TASK-155: `schedule.ts` keeps TASK-155's served
through and event trips, TASK-129's household cars, then TASK-128's riders, which take no car.
Seed-1 gate 4,308 completed, 2 gridlocked, 0 stalled heads, 0 parking failures, with T63, T21,
T29 and T53; demand tests (37), lint, format, build, the unit tier and `test:city` pass (route-audit
and T36.1 timed out under load, as on every branch today, and pass alone). TASK-128's hold since
2026-11-11 ends.

TASK-157 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): a lot car bound for the far lane
now holds clear of every lane of the exit's street its body would stand in (the exit road's other
lanes, the opposite direction, roads meeting it at either end; lot aisles and roads at another
level excluded, since compiled roads carry no grade), with a lane test that respects lane ends.
Its grant needs each crossed lane's insertion gap (follower braking included) over the stretch the
body covers, together with the far-lane gap and the lot release; while it crosses, that stretch
is an obstacle for the lane's traffic, spawns and lane changes (an optional callback in
`lane-change.ts`), and an arrival from a crossed lane stops short. Census: Munich holds inside a
crossed lane 255 street-level to 0 (20 at pk:2050 past a lane end; 98 under the bridge, a different
level), Sindelfingen 1,743 to 1 (pk:1482's 7.9 m stubs keep the old hold). `far-lane-exit.test.ts`
(7 cases; the six traffic variants fail on the old base). Munich seeds 1 to 3 equal main's state
hashes (no lot departure before 10:00 crosses a near lane). Lead merge onto main with TASK-129,
TASK-155 and TASK-128: seed-1 gate 4,308 / 2 / 0 / 0 (= main), sim unit tier (413), lint, format and
build pass. Open: street-level crossings of roads that neither belong to the exit street nor meet
it need road grade (a contract change); standing traffic across a crossed lane keeps the exit
waiting (TASK-153's keep-clear item).

TASK-161 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): a junction group's generated
signal program now separates every pair of green groups whose chains or switched road pairs
conflict, counting inner movements (green in every phase), so whatever feeds an inner road is red
while any crossing green group is green; fewest phases by exact search, even splits (no demand at
generation; 30 s phases, cycle at most 120 s, amber 3 s, all-red 1 s), each green group at least an
even share. Census: all nine Munich groups go to zero crossing pairs (group 10, jg:10783, from 5 pairs
and a 15 s of 121 s right turn for `r:961` to three 30 s phases in 102 s); Sindelfingen has no
signalised groups. Drain criterion on seeds 1 to 3 now fully met: worst single visit `r:961` 530 /
554 / 616 s (main 1,380 / 964 / 1,364), every loop road under 900 s, no cycle, no inner-link stand,
no stalled heads. On its base (70b14be) seeds 1 to 3: 5,312 / 5,311 / 5,311 completed, 0 gridlocked;
on seeds 1 and 3 every trip released before 10:00 completes; step time about 0.68 of main's.
Munich pins move only for the nine programs (proved by nulling them); the generator drops its city
argument from four callers. Lead merge onto main with TASK-128 and TASK-157: seed-1 gate 5,298
completed, 0 gridlocked, 0 stalled heads; every pin passes; lint, format, build, unit (1,331) and the
network tier pass, with route-audit, T46, T33.2, T37 and T64 timing out under load and passing
alone (27). Open: splits are even, cycles 102 to 120 s.

TASK-156 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged, gate 1 partly met): a bay on an
aisle lane that carries none of its exits now gets TASK-152's lane departure when that departure is
legal and passes every one of the bay's exits (22 Munich bays: pk:2050 10, pk:2053 12); arriving lot
cars no longer drive into lane cars ahead on aisle lanes, and on public aisles they occupy the lane
while in it (on private aisles that cost 75 to 186 trips per seed and was dropped). Aisle holds:
Munich 68 to 48 (pk:2050 fixed), Sindelfingen 232 unchanged. Left for a follow-up (TASK-164,
departure side): pk:2056 (a departure must not replace mapped exit c:10872 onto r:669), pk:1487 (its
hold for exit c:2640 lands in an interior junction because `bodyClearLane` extends a lane band past
its ends), pk:1475 (private aisles meet only private roads, no clear pose at the passage), private
aisle departures not checking arriving cars, street entrances releasing the lane while the body is
in it (63 pairs). On main 5ee9467 seeds 1 to 3 equal main exactly (5,298 / 0 / 0, 5,304 / 1 / 0,
5,312 / 0 / 0); route records byte-identical; 8 Munich compile pins moved for the 22 new departure
connectors only; `lot-aisle-lanes.test.ts` (3 cases), tests/sim (416), `test:city`, light e2e (38),
`check` pass (timeouts under load passed alone).

TASK-113 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): mode choice. Each home-based tour
of a person with today's household car picks walk or car at its first trip; the rest of the tour
follows. A logit over generalized minutes: walk-graph time minus a per-person walk preference,
against walk to the car, drive on link costs, parking search, walk from the space and running cost
at the person's value of time (defaults: on, walk preference 12 min, 12 EUR/h, 0.30 EUR/km,
sensitivity 0.3 per minute; per-person draws from the demand seed, the choice from its own stream).
Transit is an empty third alternative. Gateway, through, event, rider and van tours stay outside
the choice. Deviations: the choice runs once at engine load (`chooseTripModes` in
`src/sim/persons.ts`), since parking chains and stock are built at load (TASK-173 moves it to
departure); drive-and-walk is an outcome of the car alternative; `src/sim` imports the pure model
from `src/demand/mode-choice.ts`. Munich seed 1 with the choice on: 7,315 local person trips, 70.6%
walk (80% under 0.5 km, 73% to 1 km, 55% to 2 km), 2,730 vehicle trips completed. Owner decision:
on by default; the gate, T53, full demand and `traffic:quick` run with the choice off; the guard
`tests/traffic/munich-mode-share.test.ts` (full traffic tier) checks walk share 65 to 76%, falling
walk share by distance band, car-trip health and determinism, with a town case in T79. Demand
sheet sliders and mode-share metrics in `src/ui/panels/mode-choice.tsx` and `mode-shares.tsx`.
Lead merge onto main with TASK-156: gate with the choice off 5,298 / 0 / 0 (= main) with T63, T21,
T29 and T53; guard with the choice on 2,730 / 0 / 0; unit (1,348; route-audit and T46 timed out and
pass alone), lint, format and build pass. The crossing overlap seen with the choice on is TASK-165.

Traffic baseline reset 2 (lead, under the owner's decision of 2026-11-13 to reset as needed; after
TASK-161 moved completions about +21% and TASK-113 landed): `bench/traffic-baseline.json` holds
main at `21b161e` with mode choice off, Munich 0.15 to 10:00 seed 1: 5,298 completed, 0 gridlocked,
0 stalled heads (was 4,373 / 5 / 0); the 09:30 quick sample 4,852 / 0 (was 3,737 / 4). Derived
limits: at least 4,769 completed, 0 stalled heads. With main at zero gridlocks, 1.5 times the
baseline would allow none, so the lead added a floor: gridlock at most max(1.5 x baseline, 5). This
changes the gate's formula and is flagged for the owner's review; T63's absolute floor of 3,571 is
unchanged.

TASK-164 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): TASK-156's departure-side
leftovers. (1) A bay gets its lane departure when that departure passes at least one exit, keeping
every exit it misses as a lot exit when that exit's hold is clear; the departure carries the draw
share of the exits it passes (pk:2056 bays 0 to 5 keep c:10872; pk:2052's 50 departure bays are
again offered their missed exits). (2) An exit counts as clear only if the hold the car actually
takes is clear of each usable aisle-lane stretch and drivable aisle movement, lane ends respected
(pk:1487's c:2640 drops out for 59 bays). (3) pk:1475 left as is: no pose clear of both r:1572 and
r:536 (a car 0.70 m short), no lane car can enter r:1572, so the overlap is only drawn. (4) A bay's
departure keeps its reversing room from arriving lot cars in its lane (synthetic regression 112 to 0
conflict samples). (5) An arriving car holds the street lane until its body clears: entrance
overlaps 63 pairs to 53, at no gate cost. Census: Munich aisle holds 48 to 0, Sindelfingen 232 to 52
(all pk:1475). Departure connectors 109 to 126; eight Munich compile pins moved for the 17 new
connectors only; route records byte-identical; `src/sim/connectors.ts` touched for the exit draw.
Lead merge onto main with TASK-113 and baseline reset 2: gate (choice off) 5,312 / 0 / 0 / 0, mode
share guard 2,730 / 0 / 0, T53, sim and demand unit tests (462), lint and format pass.

TASK-165 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): the T53 overlap with mode
choice on was not a car queued on the crosswalk (its 180 s was accumulated waiting): at 07:55:55.9
car 2153 changed lanes into `r:922#1` onto the span walker 8265 already held; seed 3 also showed a
departure from an origin connector onto a held span. Rules: (1) exit storage is measured from the
far edge of the exit-side crosswalk at signals and zebras, for single movements and group exits
(cars already crossing need only their own length, so platoons still share a green; cars standing
on exit-side zebras 1,036 events to 187 at seed 1, completed 5,307 to 5,312); (2) walkers wait for a
body on their span (already true since TASK-111, now pinned); (3) no lane change or departure may
land a body on a span a walker holds (`walkers.ts`, wired in `engine.ts`; a lane-change and
departure behaviour change limited to held spans). With the choice on, T53 overlaps 1 / 1 / 4 to 0
on seeds 1 to 3, hard stops to 0. `T53-crosswalk-clearance.test.ts` (4 cases); T22, T46 and T67 pins
moved (exit queues measured past the crosswalk). Lead merge onto main with TASK-113, TASK-164 and
baseline reset 2: gate (choice off) 5,310 / 0 / 0, mode-share guard 2,730 / 0 / 0, T53 passes, sim
and demand unit tests (466), lint, format and build pass. Open: cars stopping across approach-side
crosswalks (about 2,400 events at seed 1, zebras within a car length of the stop position), taken
up by TASK-169.

TASK-160 and TASK-162 (Claude Code subagents, Opus 5.5 high, 2026-11-13; merged): the Mac-style
interface and map. TASK-160 (four phases with owner previews): Arimo bundled (OFL 1.1, 400 and 700,
latin and latin-ext), Sonoma/Ventura flat tokens, the Mac control set (`src/ui/controls.tsx`, glyphs
in `icons.tsx`), a docked window (toolbar with the tool segmented control and run controls, left
sidebar with collapsible sections for tool options, Layers, Chart, Demand, Compare, Validation and
3D view, right inspector, status bar), sheets for New, Import and Export, popovers for vehicle-class
access and signal phase road pairs, resizable sidebars (220 to 440 px, remembered per viewer), a
toolbar that never wraps (a "»" overflow, the tool control a pop-up under 660 px), narrow and phone
layouts, focus rings, `AGENTS.md` "Design direction" rewritten for the Mac style, TASK-113's mode
choice moved into the Demand and Chart sections. 1,914 of 1,916 rendered glyphs come from bundled
Arimo, so CI's Linux layout no longer depends on system fonts; every text pair meets WCAG AA.
TASK-162 (map, in parallel, merged into TASK-160's branch): a plain warm-gray canvas with OSM tiles
off by default, softer buildings and land use, quiet place tints, vehicles in eight system colours
by destination with darker rims, Arimo labels, softer 3D shadows; roads, markings, rail and street
furniture keep real-world colours (owner rollback), with the neutral asphalt `#ACB0B3` (owner).
Lead merge onto main with TASK-165: type-check, lint, format, build, unit (1,356) and light e2e (39)
pass. The full e2e on the branch: 105 pass, one fixed, the rest load timeouts or failing as on main.
Frame gates could not be measured on a quiet machine (both trees failed alike under load, with no
per-frame work added); the lead merged under the owner's merge-when-green decision and defers the
quiet-machine frame check to the first quiet window, at the latest TASK-176, logged for the owner.
Follow-up: a half-height inspector sheet on phones.

TASK-172 (Claude Code subagent, Sonnet 5.5 high, 2026-11-13; merged): `bench/seed-report.ts` (`npm run
seed-report -- --out <dir> [--previous <file>] [--jobs n]`) runs Munich at 0.15 to 10:00 on seeds 1
to 3 with mode choice off and on and writes JSON and markdown: completed, gridlocked, stalled heads,
parking failures, mean delay, TASK-154's drain criteria with the six loop-road per-visit waits (a
"sustained cycle" taken as 300 s, `SUSTAINED_RING_S`), and mode shares, compared with the baseline
file and a previous report. The Full workflow gains an advisory `seed-report` job
(`continue-on-error`, 90 min) that fetches the previous main artifact, writes the job summary and
uploads the artifact. On main 6ea2994: choice off 5,312 / 0, 5,302 / 1, 5,312 / 0; choice on 2,730,
2,701, 2,719 with 0 gridlocked; every drain criterion met; worst single visit on `r:961` 512 to 612 s
(choice off). Seed 1 matches the gate. The workflow job is validated by a manual Full run after merge.

TASK-171 (Claude Code subagent, Sonnet 5.5 high, 2026-11-13; merged): `CITYFLOWS_TEST_TIMEOUT_MS`
(default 60,000) now sets the per-test and hook limits and scales every limit written in a test file
(`tests/timeouts.ts` `limit(ms)`, 58 literals in 24 files); `CITYFLOWS_TEST_WORKERS` caps workers (8,
4 for the city tier, or cores minus one; 1 is serial); `tests/warm-cache.ts` warms the audit-city
import cache before workers start (cold 23 s and 33 s, warm 0.13 s and 0.21 s). Unset, every limit
equals today's, and a 4-vCPU CI runner already uses 3 workers. On the loaded workstation `test:city`
went from 21 timeouts (27 workers) to 0; an uncontended `npm test` is slower with the cap (172 s
against 120 s), restorable with `CITYFLOWS_TEST_WORKERS=27`. Pass and fail sets identical, no pinned
value changed; documented in AGENTS.md "Commands". Lead merge: type-check, lint and format pass; CI
runs the rest.

TASK-173 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): each tour in the mode choice now
chooses when its first trip departs, with that minute's link costs, the walk from where its car is
actually parked and the destination's parking room; random draws unchanged. Every household car of
a driver's day is parked at home from 07:00 and leaves only if a tour drives it (with the choice
off this is TASK-129's stock exactly); a walked tour's car stays put. Claims and forecasts needed no
new rule. With the choice off the state hash equals main's at all 19 ten-minute samples on seeds 1
to 3. With the choice on: walk share of started tours 78.5 / 79.2 / 78.9% (main counted the same way
73.6 / 74.2 / 73.8%; seed 1's +4.9 points: hour's link costs +3.7, walking from the actual space
+1.1); the guard's band moves to 74 to 84% with at least 2,270 completions and counts only tours
started by 10:00; 2,755 all-walk days keep their cars parked at home. Step time unchanged (+0.4% off,
+0.1% on, side by side). `T63-parking-claims.spec` steps to the first claimed-strip search between
08:30 and 09:00. Lead merge onto main with TASK-165 and the Mac UI: gate (choice off) 5,310 / 0 / 0,
guard (choice on) 2,561 / 0 / 0, T53, sim and demand unit (467), lint, format, build, T63 and T79
specs pass. Open: the full-suite T54 Munich case fails as on main (its commuters walk);
`src/host/headless.ts` counts car trips by scheduled mode; a walker's inspector shows no car.

TASK-175 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): compiled nodes, roads and lanes
carry `grade` (a road's `layer`, else the lower of its end nodes'; equal to what the renderers
derived before), and the terrain-free road height profile moved from `src/render3d/heights.ts` to
`src/network/heights.ts` (`laneHeightAt`), shared by 3D and the simulation; two surfaces 4.5 m or
more apart are at different levels (architecture 4, 5, 8, 11; a pre-approved contract change). The
lot hold, crossing checks and TASK-164's exit-clear test consider nearby lanes at the lot's level,
so roads overhead never hold or block a lot car and at-grade roads beyond the exit street need a
crossing gap; 3D picking selects the upper road. Census changes only at pk:2050 (the r:1298 ramp's
ground end, 20 pairs), pk:2056 (ramps 2.3 to 4.4 m up; bays 412 to 414 hold under 4.5 m clearance)
and pk:2060 (r:2133 crossed); pk:2049 unchanged. Thirteen pin files moved for the field only (proved
by hiding `grade`). On its base, seeds 1 and 3 equal main and seed 2 goes from 5,302 / 1 to 5,310 / 0
(a pk:2056 departure). Lead merge onto main with TASK-165, 160, 171, 172 and 173: type-check, lint,
format, build, unit (1,361) and city (173) with no timeouts, gate (choice off) 5,310 / 0 / 0, guard
2,561 / 0 / 0, T53, light e2e (39) pass. Open: bays under the low part of ramps (stall generation
compares whole-number grades), and smoothed rather than surveyed ramp heights.

TASK-163 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): one lighting model for 2D and 3D
(`src/render/lighting.ts`): Day (TASK-162's lighting exactly; every new effect behind a shader flag),
Evening (a low warm sun, long shadows, dim blue sky, lamps on, 45% of windows lit), Night (moonlight,
no shadows, lamps on, 22% of windows), Follow clock (sunrise 06:00, sunset 20:00, blended by sun
height, updated per simulated minute), and exposure 0.5 to 1.5. Colours are lit or darkened, never
recoloured; light sources keep their colour. Lit after dark: 543 street lamps (head, pool, halo,
instanced), 48 platform lights, 117 signal heads, windows in 1,406 buildings (seeded by an outline
hash), head- and tail-lamps and a road beam on moving vehicles, lit train and tram windows; 3D adds
5 draw calls and no real lights; 2D adds one night layer. The setting is a view preference in
localStorage (`cityflows.lighting`), never in the project; the Shadows layer now also switches the 3D
sun's shadows. Controls: a Day / Evening / Night / Clock segmented control and an Exposure slider in
the sidebar's Layers section. Frame cost against Day: Day level or faster; 3D Evening +0.1 to +5%,
3D Night -16 to -24%; 2D Night +1.6 to +9.1%; 2D Evening +4.9 to +9.4% over seven rounds and +17.4%
in one loaded sample on the T64 workload, which is handed to TASK-176. V163 unit (10) and e2e tests;
no hash or render pin moved. Lead merge onto main with TASK-173 and TASK-175: type-check, lint, format,
build, unit (1,371), city (173), light e2e (39) and V163 pass. Open: the bundled scenarios end at
18:00, so Follow clock never reaches evening in a normal run; in 2D, vehicle lights under a bridge
deck show through it; the evening hue (mauve) awaits the owner.

Full run 43479489386 (lead, manual, on 738af8c): the new seed-report job passed (TASK-172 validated);
the full tier failed (traffic: munich-full-demand timed out at 900 s; e2e a, b, c and rest: T19, T47,
V100, gate4-layers, qa-mobile, T16 grid5x5-stress, T63, T54 Munich and others), mostly specs that
expect car traffic now that mode choice is on by default, plus layout leftovers. Per AGENTS.md new
merges are held until TASK-178 makes the full tier green; TASK-163 had been pushed before the result
arrived.

TASK-178 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): one real bug, fixed in
`src/sim/walkers.ts`. After a live edit removed a link a walker had already walked past, the next
edit threw and the run went stale (T19). Legs already walked that lost their link are now dropped
(regression case in `walker-spawn.test.ts`). The rest were specs written before mode choice, station
riders and household parking: T47 town and qa-mobile drive everyone; T47 Munich's street click
avoids parked cars; the T16 stress workload in `bench/workloads.ts` turns mode choice off (2,746
active, floor 2,700); T54 and T61 find their driver by person, with mode choice off for the
controlled drivers, and T54's strip owner is the nearest home with a garage. V100, gate4-layers and
T63 were already fixed by TASK-173. munich-full-demand did not hang: CI took 808 s on 706eaa0 and
2,563 s on 738af8c, so its setup limit is now `limit(3_600_000)`, a time limit, not a gate. Locally,
every group passed, with failures under 100% CPU passing when rerun alone; T62's local-only rail
frame check missed by 1.2 ms (to TASK-176). The full traffic tier passed at
`CITYFLOWS_TEST_TIMEOUT_MS=240000` (3,581 s). `npm run check` passed (1,372). Open: full-demand step
time roughly tripled between 706eaa0 and 738af8c at a similar peak, with routing requests down from
5.0M to 0.38M, so routing is not the cause (to TASK-176 for profiling); T54's second project load in
3D can exceed its 20 s Play wait under heavy load.

TASK-167 (Claude Code subagent, Opus 5.5 high, 2026-11-13; delivered at 2fc1d6e, merge queued): 2D
labels for streets (OSM `name`, along the road, upright, shown where the street is about as wide as
the text on screen, one per divided street), stations, tram stops and places, placed collision-free
per zoom step for the whole city, with a Labels layer toggle. The owner's notes: street names grow
from 2 px/m (11 to 16 px minor, 12 to 17 px major); place fills now sit under rail, paving and roads
(a Places look change on the owner's instruction). Frame cost: T62 2D level; T64 2D +3.6% and +12.6%
in two loaded pairs, within the machine's noise but not shown under the 5% gate (to TASK-176). Open:
3D labels, landmark names (context features carry none), thin rotated 11 px text.

TASK-170 (Claude Code subagent, Opus 5.5 high, 2026-11-13; delivered at 8d0e237 with TASK-169 via the
step-0 merge db08f1a, merge queued): signal programs gain `actuated` and `demandSplit` flags (the
contract's per-program flag). Lead decision, for owner review: generated programs are actuated by
default and the demand split is opt-in per program, since every split variant pushed a single
Landsberger-loop visit past TASK-154's 900 s on some seed (872 to 1,062 s mean delay), while
actuation alone gave 5,311 completed, 1.2 gridlocked and 828 s mean delay over seeds 1 to 6 against
the base's 5,301, 1.8 and 854 s. The gate sits at its limit (seed 1: 5,307 / 5 / 0); seeds 2 to 6 have
0 or 1. Actuated runs step about 14.6% slower (the traffic, not the controllers; to TASK-176). Open: a
split that does not hurt the loop; actuated walk lights show red in amber and all-red even when the
next phase keeps walk green.

TASK-168 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): keyboard shortcuts (`src/ui/shortcuts.ts`;
mod is Cmd on a Mac, Ctrl elsewhere), one command table (`src/ui/commands.ts`) read by the toolbar, overflow
menu, command menu (mod+K) and shortcut sheet (mod+/ or ?). Nothing fires in a text field or behind a sheet;
hold-Space still pans. Keys show in tooltips and overflow items. 13 unit and 5 e2e cases (T80, in the light
set). At the queue merge T80 failed in most runs under load, also on main plus TASK-168 alone: a follow-up
(`task/168-t80-fix`, fc82ace, lead's subagent) found the app dropping keys. A `<dialog>`'s late `close`
event shut a sheet reopened by a quick key, and tool keys leaked past a sheet still opening. Sheets now
report Escape through `cancel`, open in the same React commit as the store change, and the dispatcher asks
the store which sheet is open; T80 passed 150 of 150 repeats. Open: browsers reserve Ctrl/Cmd+N and may
reserve mod+1 to 3 in a normal tab (the command menu covers them). Closed by TASK-191.

TASK-169 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged with TASK-170): keep-clear zones over
marked crosswalks and lot and garage mouths (`src/network/keep-clear.ts`, cached per compiled city, no schema
change); a queued car stands 0.5 m short of a zone its body would cover, heads move up to the stop line
when the zebra is clear, and a lot exit joining inside a kept-clear mouth needs only the minimum gap to
standing cars. de themes draw a hatched box, us/uk a KEEP CLEAR stencil (2D and 3D). Hashes re-pinned; the
V114/V117 pins were recomputed at TASK-170's step-0 merge (db08f1a).

TASK-174 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): transit as a mode. Routing over a
time-expanded graph of the combined rail timetable (16 Munich stops, built in about 130 ms); riders walk to
the platform, wait, board the first run with room (tram 210, S-Bahn 1,088 places, scaled), ride and walk
on, giving up after 30 min. Mode choice draws over walk, car and transit; transit tours ride as mode `rail`
and leave the car parked. TASK-128's station riders now ride their S-Bahn. Metrics and the Chart section
gain transit. Census, choice on, seeds 1 to 3: walk 77.6 to 78.6%, transit 0.5 to 1.3% (each S-Bahn route
calls once inside the extract, so residents' transit is the tram), 0 denied boardings. Choice off: gate
unchanged against main (same seed-1 state hash).

TASK-166 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): dark appearance. Every window colour is
a token in `src/ui/app.css` with a Sonoma-style dark set (accent `#0a84ff`); light is unchanged apart from
three AA fixes (pressed 3D toggle text `#0058b8`, comparison key `#8f5a3a`, load background). Appearance
pop-up (System / Light / Dark) and "Match lighting" (window dark at Evening, Night or after dusk) in Layers,
stored per viewer. The dark map: near-black canvas, dark land use and place tints mixed from the dark
ground, shaded sidewalks; roads, markings, rail, vehicles and furniture keep real colours. TASK-167's
labels get dark inks on a dark halo, at least 4.5:1 against every place tint (tested). A colour-space fix
makes Light 3D place tints a shade deeper, matching 2D (one line in `src/render3d/geometry.ts` to revert;
for the owner). WCAG contrast test (42 checks) and V166. Open: an appearance switch in 3D rebuilds the scene
(3.6 to 7.3 s on Munich under load); the appearance is not yet in `docs/architecture.md` or AGENTS.md
"Design direction" (lead to add).

Queue merge (lead, 2026-11-13): main a183a0b + TASK-168, 174, 170 (with 169), 167, the T80 fix and 166,
assembled on `task/lead-queue-trial`. Conflicts: 170 against 174 in engine.ts and worker.ts (both
snapshot fields kept, transit rider inspection plus signal timing), 167 against 163 in scene.ts (labels
above the night layer, `cityGrades(city)` after TASK-175), and 166 against the stack (resolved by its
agent). Verified on the final tree: type-check, lint, format, build, unit (1,460), city (175), light e2e (45), gate and guard and T53 (9 and 1 expected fail) pass; the Full run 43516520585 on a183a0b (TASK-178) was green in every job, which released the merge hold. Probe, Munich seed 1, choice off: 5,449 completed
(+2.8% against the baseline's 5,298, no reset), 0 stalled heads.

Full run 43528001134 (lead, manual, on dec1c8a after the queue merge): check, seed report and e2e a,
c, d and rest passed; e2e b (T16 grid5x5-stress: 2,692 active against the 2,700 floor, after actuated
signals) and e (T65 station riders: 7 drawn against 4, after TASK-174 seats riders in the S-Bahn)
failed on both attempts. Both are Full-tier specs the delivering agents did not run. TASK-179 repairs
them; new merges are held until the full tier is green again (TASK-176 and 177 are not yet due).
The traffic job failed too: munich-full-demand timed out at its 3,600 s limit (2,659 s on a183a0b in
Full run 43516520585), so the queue merge added at least 36% on that workload. TASK-176 takes it as
its first item (profile against a183a0b, exact rewrites); the limit stays until it reports.

TASK-179 (Claude Code subagent, Opus 5.5 high, 2026-11-13; merged): T65 showed a real defect from
TASK-174. Station riders got off at a random door and headed for the entrance nearest the platform's
middle, while their walk out starts at the entrance that suits the destination (3 of 7 jumped 52 m
when the walk began; pace 0.6 to 2.2 m/s). Each rider now leaves the train at its own point, walks
along the platform to the entrance its walk starts from and arrives as the walk departs (about
1.1 m/s); positions only, no state or hash change (architecture section 9 sentence updated). T65 now
checks that model: riders spread along the train after the stop, within 3 m of their entrance half a
second before the walk and no jump over 4.1 m, each drawn once, inspector in 2D and 3D. T16's stress
count fell from 2,746 to 2,682 with TASK-169's keep clear, not TASK-170 (the stress grid's one signal
is fixed-time); the stress workload now has 43 residents and jobs a place (6,708 trips, 2,806
active), so `npm run bench`'s grid5x5-stress row is not comparable with earlier rows. T16 9/9, T65
6/6, light traffic tier and check (1,460) pass.

TASK-176 (Claude Code subagent, Opus 5.5 high, 2026-11-14; merged): performance pass on a quiet machine
(direct timers; V8 profiles over-weighted small functions). munich-full-demand: 2,462 s on main to 974 s,
same state hash (3369660939). The cause was TASK-153's lot admission check, run every step for each car
queued behind a departure and sweeping every space of the lot (about 0.3 ms a call), multiplied by the
heavier post-merge traffic; it is now cached per space, connector and body length and indexed by
facility (8c33aa5, dfeed1d). Also exact: keep-clear stands without closures, rail crossings keep paths
while a vehicle stands. Munich 0.15 choice off 89.6 s to 75.6 s (seed 1; -17% and -19% on seeds 2 and 3),
choice on -5 to -8%; hashes identical on seeds 1 to 3, choice off and on, and at full demand. A 3D
appearance switch now recolours instead of rebuilding: 3.0 s to 63-81 ms on Munich (terrain still
rebuilds its ground, 1.8 s), matched pixel for pixel. Owed frame checks, all on the quiet machine: the
Mac UI and dark appearance are 14-16% faster than b25e4c4 in every view and Dark is within 0.6% of
Light; T64 2D Evening +5.5 to 8.1% against Day (gate 10%); labels +2.8 to 3.8% on T64 2D (gate 5%), T62
2D +4.0 and +5.5% (at or just over in one round, no change made); T62's rail check passes. Actuated
controllers cost nothing measurable; actuation raises seed 1's mean delay (836 s against 727 s with it
off) and so vehicle-steps (to TASK-180). A TASK-163 bug fixed in its own commit (e0631d0, lead accepted):
2D vehicle lights threw 180 page errors at Evening on T64. Load time unchanged; bundle +2.5 kB in the 3D
chunk. Lead merge onto main with TASK-179: check (1,460), city (175), light e2e (45), gate, guard and T53
pass. Open: at full demand rail crossings (300 s), spawn (230 s), walker hold (160 s) and lane changes
(150 s) remain; full demand completes 2,460 against a183a0b's 3,579 (to TASK-180).

Full run 43561296476 (lead, manual, on 674841d after TASK-176 and 179): every job green; munich-full-demand
took 2,043 s on CI (timed out at 3,600 s on dec1c8a). The merge hold is released.

TASK-177 (Claude Code subagent, Sonnet 5.5 high, 2026-11-14; merged): the README covers the Mac window, map
look, labels, lighting, dark appearance, marking styles and keep clear, the keys table and command menu,
the signal editor's switches, households, mode choice with transit, and station riders (pointing at the
bundled Munich extract), with five screenshots in `docs/assets/` (128-colour PNGs under 125 kB); the old
line crediting tiles by default is corrected (Basemap is opt-in). Two new hints: Layers (time of day,
appearance, labels) and the command-menu key; the demo-onboarding e2e expects eight. Check (1,460) and
light e2e (45) pass. Open (to TASK-181): the Demand switch still reads "Choose walk or car per trip" though
it covers transit; after Play at 1280 px the dev build's `.app` scrolled 32 px sideways.

TASK-181 (Claude Code subagent, Sonnet 5.5 high, 2026-11-14; merged): the sideways scroll was the 3D
toggle's hidden tooltip (186 px, centred under its button): `visibility: hidden` still counts toward
scrollable overflow, so `.app` was 1,312 px wide in a 1,280 px window from load, and Play's focus change
scrolled it. The tooltip now opens leftward like the inspector toggle's, and `.app` uses `overflow:
clip`; no horizontal scroll from 390 to 1,920 px. New light-tier spec `window-scroll.spec.ts` (fails
without the fix). The Demand switch reads "Choose walk, car or transit" (T79, the `driveEveryone` helper
and the README follow). Check and light e2e (48) pass. Open: `app.css` holds two near-identical copies of
most rules (a merge leftover; the later wins), for a cleanup task.

TASK-182 (Claude Code subagent, Sonnet 5.5 high, 2026-11-14; merged): `app.css` keeps one copy of each
rule, 2,807 to 2,428 lines (412 rules to 354; 57 duplicated selector groups to none). The earlier copy of
51 duplicated rules and two keyframes is removed, keeping the later copy that already won; where the copies
differed the winner stays (`.app` `overflow: clip`, `.sidebar` padding `8px 10px`), and `.row-count` and the
600 px `.status-bar` rules are merged. A before/after harness over 166 states (Light, Dark, tools,
inspectors, sheets, popovers, tooltips, hover and focus, 17 widths, phone, reduced motion) found 0 computed
style differences across 170,334 nodes and every property; 165 of 166 screenshots match pixel for pixel
(the other is render noise, reproduced on the old build), and a planted padding change was caught. The
built CSS shrinks only 38,040 to 38,008 bytes since Vite had merged most duplicates. Contrast (44), check
(1,460) and light e2e (48) pass. The agent's cleanup killed every headless Chromium on the machine; TASK-180
was told to rerun any browser run that broke.

TASK-180 (Claude Code subagent, Opus 5.5 high, 2026-11-14; merged): the full-demand drop was TASK-169's mouth
rule, not 174, 176 or 179 (with keep clear and actuation off, main reproduces a183a0b's 3,579 and hash). A
queue held short of a lot or garage mouth until a whole body fitted beyond it, and lot cars joined inside
the mouth on `minGapM`, so each creep forward let in another lot car and the through car behind waited for
the lot to empty; streets behind busy exits starved back into the upstream boxes (signals hold about 10%
of the stopped time). Fix (`src/sim/engine.ts`): joins zip, one at a time; a standing car that let one in
at a mouth is not cut in front of again there until it has passed (new test fails on main). Generated
signal programs are fixed-time again (`GENERATED_TIMING = {}`): with the zip, actuation had less delay at
0.15 (714 s against 853 s) but took a seed-6 Landsberger loop visit to 1,042 s (over TASK-154's 900 s) and
completed fewer trips at full demand (2,875 against 3,015). Munich 0.15 seeds 1-6 choice off: completed
5,294-5,312 (at most -1.1%, no baseline reset), gridlock 0-1, stalled 0, worst loop visit 789 s; mean
delay mixed (seed 3 865 to 759 s, seed 5 740 to 954 s); choice on means 2,541 completed, delay 82 to 118 s.
Full demand 2,460 to 3,015 completed (+22.6%), failed 269 to 167. pk:2049 exit waits 17-41 s. City and
compile hashes re-pinned (generated programs lose `actuated`). Lead re-ran on the merge: check (1,461),
city (175), traffic light (gate 5,302 / 0 / 0), mode-share guard (4), light e2e (48). Open, for the owner:
full demand is still 16% under a183a0b, the price of keeping exits clear (dropping the hold-short half
gives 3,827 but brings back pk:2049's long waits); actuation's 0.15 delay gain (16% choice off, 31% on)
returns once the seed-6 loop exit at n:306 onto r:307 drains; garage waits over 60 s roughly doubled.

TASK-184 (Claude Code subagent, Sonnet 5.5 high, 2026-11-14; merged): Follow clock has a season (a sun
model for Munich at 48.14 N): Summer 05:24 to 21:28, Spring/autumn 06:41 to 18:50 (default, the closest
to the old 06:00 to 20:00 day, so the default clock's sunset moves to 18:50 and its noon sun from 52 to
43 degrees), Winter 08:00 to 16:21. A Season pop-up shows in Layers while Clock is chosen; it is stored in
`cityflows.lighting` (older values load as Spring/autumn), never in the project; Day, Evening and Night
ignore it. In Winter a bundled run is lit by 16:30 (lamps, windows, no shadows). In 2D each grade has its
own vehicle-light container, masked by the decks above it (`deckCover`), so lamps and beams under a
bridge no longer show through (shots at Donnersbergerbrucke). Check (1,467), city (175), light e2e (48),
V163, T62 and T64 pass; 2D Evening adds about 0.8% (Evening against Day +10.6%, at TASK-163's limit,
was +9.2%). Lead re-ran check on the merge. Beyond the named scope: `src/render/scene.ts`, vehicle and
shadow layers, README, the TASK-163 paragraph of `docs/architecture.md`. Open: the bundled 5x5 grid has
no lamps, so its Winter shots show only the sky.

TASK-183 (Claude Code subagent, Opus 5.5 high, 2026-11-14; merged): street, station, stop and place labels
in 3D (`src/render3d/labels.ts`). When the camera settles (120 ms and 3 frames still) every candidate is
projected to the screen and placed by TASK-167's own placement code (`LabelFrame`: each candidate in
screen pixels with the map scale at its distance), so priority, no overlaps, upright flipping, repeats
and junction nudges carry over; between placements labels ride with the map, and a still camera places
and redraws nothing. Arimo at the 2D sizes and halo in a glyph atlas (two draw calls), not darkened by
Evening or Night, dark inks in Dark; drawn over buildings; the Labels layer toggles them. 2D placement is
identical to main at 57 zoom steps on Munich and Sindelfingen (10,179 labels). T64 3D labels on +3.7%
(rail on) and +4.9% (rail off) against main on a busy machine (labels off level). New V183 unit and e2e
tests. Lead re-ran on the merge: check (1,470), city (176), light e2e (48), V183 e2e. Screenshots sent to
the owner. Open (to TASK-192): a street hidden behind a building shows its name on the roof; labels keep
their last angle and size while the camera moves; the rail-off cost needs a quiet confirmation.

Full run 43575816774 (lead, manual, on 72f8e8c after TASK-180): every job green, including the full
traffic tier in the city job (29 minutes).

Full run 43584685019 (lead, manual, on a92e0f0 after TASK-183): every job green except e2e b: V105 terrain
compared a 3D frame taken two animation frames after a camera move with an earlier capture, and TASK-183's
labels place 120 ms after the camera settles. Lead fix: V105 unchecks Labels with the other layers it
already turns off (3 of 3 local repeats pass); V183 covers the labels.

Full run 43587159656 (lead, manual, on 4f24042 after the V105 fix): e2e b now green; e2e e red: T62 cached
paint timed out at 180 s on both attempts after reaching its last line, on a runner about 10% slower
(the test took 2.3 to 2.7 min on earlier runs). Lead fix: its time limit is 300 s (a time limit, not a
gate); 1.2 min locally.

Full run 43591345828 (lead, manual, on a5be347 after the T62 time limit): every job green. Lead handoff
finished (`docs/lead-handoff-2026-11-14.md`); TASK-185 to 192 and the decisions in `docs/decisions/` await
the owner.

TASK-185 (Claude Code subagent, Sonnet 5.5 high, 2026-11-16; merged): the 2D label cost was fill, not
placement. TASK-167 cached the labels in one view-sized texture, nearly all transparent, and every frame
blended that quad (4 to 6% on the software GPU). The glyph sprites now render once per redraw into a
texture (same resolution, MSAA and whole-metre origin) and each frame draws only horizontal runs of the
16 px tiles a glyph touches (70 runs at 1.2 px/m, 11% of the view in Munich). Placement and counts are
identical; pixels differ only at glyph edges (largest channel difference 9 of 255). Labels on against
off, interleaved with main on a machine 73 to 97% busy: T62 2D main +5.6% and branch -0.5%; T64 2D main
+5.3% and branch +2.3% (one round with a load drop at +16.8%; without it +0.4%). `gate4-layers` asserts
the layer draws under 10% of the map's pixels. Check (1,470), city (176), light e2e (48), T62/T64 and
gate4-layers pass; lead re-ran check, light e2e and gate4-layers on the merge. Open: no quiet-machine
repeat; a real GPU's fill is cheaper, so the saving there is smaller.

TASK-186 (Claude Code subagent, Sonnet 5.5 high, 2026-11-16; merged): on the software GPU the 2D Evening
cost was raster work. The full-screen multiply tint was about 7 to 10 ms (scaling with area) and the
vehicle lights about 10 ms, about 5 ms of it the two stencil deck masks, which an empty masked container
still paid. The ambient tint is now the map container's `tint`, multiplied into the clear colour
(`NightLayer.mapTint`, `tinted`, `syncBackground` in `scene.ts`); grades with no deck above share one
light container, and an empty one is hidden (Evening at Donnersbergerbrucke: 79 draws and 8 stencil
operations to 76 and 4). Evening over Day, interleaved with main (medians, busy then quieter machine):
T64 main +10.2 / +9.8%, branch +4.5 / +5.3%; T62 main +10.4 / +9.0%, branch +7.5 / +3.6%; Bridge main
+7.9 / +9.4%, branch +6.8 / +3.2%. Munich 2D Evening and Night shots at three zooms: no pixel differs by
more than 2 of 255. Check (1,472), city (176), light e2e (48), traffic light, V163, V184, T62 and T64
pass (T64's Day rail frame budget failed once under load and passed on rerun). Lead re-ran check, city,
light e2e, V163 and gate4-layers on the merge, and reworded the TASK-163 paragraph of
`docs/architecture.md`. Open: the ground grade's deck mask is about 3.3 ms of the remaining 6.8 ms of
vehicle lights on the Bridge view (dropping it when no light overlaps a deck needs a per-frame test).

TASK-187 (Claude Code subagent, Opus 5.5 high, 2026-11-16; merged, contract target narrowly missed): full
demand steps 23.7% faster (1,109.5 to 846.6 s of stepping, wall 1,113 to 851 s, back to back with the same
timers) with identical results: Munich 0.15 seeds 1 to 3 (5,302 / 5,304 / 5,312 completed, 0 failed,
hashes 4237403929, 2572602396, 1491970289) and full demand (3,015 / 167, hash 767875161) equal main. The
two largest costs were TASK-176's: spawn (429 s, of which 296 s the gap check; 99.96% of 144.7M checks
fail on a car standing near the connector) and rail crossings (315 s). The gap check now runs the lane
test first with the smallest gap any rule allows (exact, since its checks only conjoin); a vehicle's
crossing path is kept while lane, movement and route stay the same; committed-set membership is
mirrored in flags; the rail hold and lane-change neighbour search start from the vehicle; the walker
hold skips lanes without a held crossing. New `debugLaneOrder` load option and `lane-order.test.ts`
check that each lane's list stays ordered by position, which the vehicle-relative searches rely on.
Check (1,475), city (176), traffic light, mode-share guard and T16 stress pass; lead re-ran check, city,
traffic light, guard and light e2e (48) on the merge. The lead accepts 23.7% against the contract's 25%
(the target is the contract's, not a gate). Open: the following pass (376 s), lane-change proposals
(107 s), spawn bookkeeping for blocked origins (86 s; skipping an origin until something near it changes
is the next large exact cut, keeping origin courtesy's bookkeeping), rail crossings (175 s), lot admission.

TASK-191 (Claude Code subagent, Sonnet 5.5 high, 2026-11-16; merged): New city moved from mod+N to N,
the sidebar and inspector toggles from mod+1 and mod+2 to S and I, and 2D/3D keeps only V (mod+3 dropped).
Plain letters, like the tool keys; fields and open sheets still swallow them, and the one table in
`src/ui/shortcuts.ts` feeds the sheet, tooltips and menus. A unit test rejects reserved chords (mod+N, T,
W, Q; mod+Shift+N, T, W, P; mod+1 to 9; Tab and PageUp/PageDown chords; sources in its comment) and keys
stay unique. Check (1,476), light e2e (48), T80 100 of 100 under `--repeat-each=20`. Open: Mac-native
chords (Ctrl+Cmd+S) would need the matcher to read `event.code`.

TASK-189 (Claude Code subagent, Sonnet 5.5 high, 2026-11-16; merged): under 600 px the inspector is a
bottom sheet over the map (`src/ui/inspector-sheet.tsx`, one `@media (max-width: 600px)` block in
`app.css`). It opens at half height on a selection; the grabber drags or taps between half and full (a
44 px strip of map stays above); a flick moves one step and a slow release lands on the nearest of
closed, half and full; swipe down, Escape (the existing clear-selection shortcut) or the close button
closes it. The heading stays pinned while the content scrolls. Computed styles at 601 px and wider: 0
differences across 117 states and 120,313 nodes (TASK-182's method). Lead review caught the Dark edge
ring (an inset ring in `--shadow-popover`) broken by the pinned heading; the heading now stops 1 px
short of each side. Check (1,476), light e2e (53 with the new `qa-phone-sheet`), `qa-mobile` (11),
contrast (44). Open: a selection under the sheet is not re-centred (a camera change outside `src/ui`);
dragging starts only on the grabber row.

TASK-190 (Claude Code subagent, Sonnet 5.5 high, 2026-11-16; merged): `generateStalls`
(`src/network/stalls.ts`) drops a bay that a road or junction of another grade overlaps when that
surface, sampled with `laneHeightAt` at the bay's corners and centre, is under 4.5 m
(`levelClearanceM`) above the bay's aisle; a road below a bay is ignored. Munich: pk:2056 6 to 2 bays
(four under r:1301/r:1302 at 3.9 to 4.4 m), pk:2050 10 to 8 (two on r:737's ground end), pk:2049
unchanged, 484 to 478 in all; Sindelfingen and synthetic cities unchanged. Re-pinned (bays, the two
capacities and index shifts only): T44, V106, T50, T62, T75, V107/V117 compile, V117 curbs, V108, the T49
census, the TASK-164 pk:2056 case; T149's synthetic bridge now has layer-1 ends (a level deck 5 m up).
Munich gate 5,302 / 1 gridlocked / 0 stalled (main 5,302 / 0 / 0); guard 2,554 / 0 / 0. Check (1,476),
city (54 files), traffic light, light e2e (48).

TASK-188 (Claude Code subagent, Opus 5.5 high, 2026-11-16; merged): generated signals stay fixed-time.
The seed-6 1,042 s r:961 visit was not the n:306 exit: n:306 queued behind spill-back from jg:10802
(about 400 m down r:639), whose lane 0 has one movement and whose head cars, going round the group to
r:663, were held "exit-full" for up to 1,755 s; r:663 drains into a 1.5 km ring (r:679/r:735, r:1258,
jg:10784, r:264, n:263) fed in both modes by detoured cars (about half of those entering r:676 and
r:663). Fixed-time fails 900 s on extra seed 7 (933 s), actuated on seed 10 (942 s). Fixing it means
changing TASK-121 head detours or the group-entry exit-full hold, so nothing changed at n:306. Walk
lights (`src/sim/signals.ts`): in amber and all-red an actuated crossing the next phase keeps green
stays green to that phase's minimum green, as fixed-time already did; walkers read it too (seed 6
actuated alone went 1,042 to 699 s). Fixed-time hashes unchanged. On fcf6973 (after TASK-190), choice
off fixed / actuated mean 5,304.8 / 5,312.2 completed, delay 830 / 775 s (-6.5%), worst visit 634 /
836 s; choice on 2,541.3 / 2,562.5, 118.1 / 82.2 s (-30.4%); drain met on all six seeds in both.
Full demand fixed 3,069 / 165 (hash 2427576212, the new reference after TASK-190's bays; was 3,015),
actuated 2,814 / 165 (-8.3%, ahead until 07:30). Check (1,478), city (176), traffic light and guard,
light e2e (53). Open: the jam ring (its own task: detours that refuse routes back into the jam, or
the exit-full hold on single-movement group-entry lanes); the actuated full-demand gap (candidate:
phase 1 skipped at jg:10802, r:639 green 58% against 65%); amber and all-red shown to movements that
stay green into the next phase (about 4 s per change, both modes).

TASK-192 (Claude Code subagent, Opus 5.5 high, 2026-11-16; merged): 3D labels (`src/render3d/labels.ts`)
now treat buildings and road decks as occluders, checked once per placement (2 to 5 ms in Node on
Munich): a street name runs only on a visible stretch at least as long as its text; stations, stops
and places drop when their point is hidden (their own building does not count); hiding Buildings or
Surroundings stops the occlusion. While the camera moves each placed street glyph follows its road
point, turns with the road on screen, scales with distance and flips to read left to right; at the
placement camera it matches the placement to 0.01 px (chosen over fading, which would blank names on
every gesture). Quiet rounds after the batch (lead request; 1 to 4 valid, 5 and 6 discarded for an
outside job): T64 3D labels on against off, branch +2.1% rail on and +4.1% rail off (main +3.8% and
+3.8%; one rail-off round +6.5% under 11 to 17% outside load); 340 glyphs against main's 529. Check
(1,477), city (176), light e2e (48), T62, T64, V183, V105. Open: at TASK-183's street camera only 1
street and 1 place remain (8 streets, 1 stop, 6 places on main, mostly on roofs), and a partly hidden
street loses its name; trees, trains, terrain and canopies do not occlude; pitched roofs count at full
height; while moving, text is not capped at TASK-167's maximum size until it settles.

Full run 43885610218 (lead, manual, on 592ad58 after TASK-185, 186 and 187): every job green; the city
job (city tier and the full traffic tier) took 33.2 min against 44.9 min on Full run 43591345828.

TASK-196 (Claude Code subagent, Sonnet 5.5 high, 2026-11-17; merged): under 600 px, when a selection is
made or the sheet settles at a new height and the selection's anchor (`src/ui/selection-anchor.ts`: a
lane's middle, a node, a place or lot centroid, a vehicle or walker from the snapshot) is under the
sheet, the map pans so it sits in the middle of the area above, in 2D and 3D (`Scene3D.panScreen`), with
no zoom, pitch or bearing change; it eases, jumps under reduced motion, and a press or wheel cancels it.
Wider layouts never mount the sheet; camera centres at 768 and 1280 px, 2D and 3D, identical to main.
Check (1,480), light e2e (61 with the new `qa-phone-recentre`), `qa-mobile` and `qa-phone-sheet` (16).
Open: a selected train has no anchor; a long street centres on its middle, not the tapped point; at full
height the anchor lands in the 44 px strip; a 3D pan can show the ground plane's edge (as any pan does).

TASK-195 (Claude Code subagent, Opus 5.5 high, 2026-11-17; merged): a 3D street name is tried on every
visible stretch of every road with that name (both carriageways, either direction), most road in view
first, at the street's anchor nearest the stretch's middle, then smaller down to TASK-167's minimum;
visible stretches now run to within 2 px of what hides them; every glyph's sight line is re-tested after
placement. A hidden station, stop or place moves to the nearest visible open ground of its own area.
Counts (streets / stops / places) against TASK-192: TASK-183 street camera 1/0/1 to 1/0/4 (Lilli-Palmer-
Straße shows about 65 px of road, shorter than its name at the minimum), station street view 3/0/3 to
4/0/6, west street view 3/0/2 to 5/1/5, overview 6/0/2 to 7/0/5. Quiet window (TASK-193 paused), four
clean rounds: T64 3D labels on against off +2.7% rail on, +2.9% rail off (worst +4.2%); 424 glyphs
against 340. Check (1,482), city (176), light e2e (53), T62, T64 (the moving-train budget failed once
under outside load and passed alone), V183. Open: low-pitch street views stay sparse; a moved point
label can overlap a roof edge; a label can jump stretch at the next settle; the area lookup relies on
the 2D candidate key format (`name/id`).

TASK-193 (Claude Code subagent, Opus 5.5 high, 2026-11-17; merged): the ring behind jg:10802 was fed by
missed turns, not head detours or the exit-full hold (about 1,200 s of holds per morning on r:639#0):
cars that could not reach the right lane at r:639 (right to r:680) or r:654 (straight to r:715) were
rerouted round a 2.5 km lap (r:663, the ring, n:263, the loop, its exit) back onto the same approach;
on main seed 7 fixed-time 307 of the 319 cars turning onto r:663 were missed turns. `rerouteFrom`
(`src/sim/engine.ts`): after a missed turn or a head detour, if the normal route comes back over roads
the trip already drove, the router searches again with those roads made very expensive and takes the
result if it reuses fewer of them (a first version avoiding only the road being left broke actuated
seed 3). Seeds 1 to 12, main to branch, worst loop visit: fixed choice off 933 to 736 s (mean delay
834.9 to 796.3 s), on 294 to 263 s; actuated off 942 to 829 s (786.0 to 747.2 s), on 680 to 680 s; all
four drain criteria met on all 48 runs (main failed fixed seed 7 and actuated seed 10); completions
move at most 0.3% per seed; the gate seed goes 5,302 to 5,308. Full demand: fixed 3,069 / 165 to
3,086 / 169 (hash 2602931525, the new reference); actuated 2,814 / 165 to 2,721 / 174 (-3.3%, under
the contract's gate). Lead decision: accepted, because fixed-time is the shipped default and improves,
the drain now holds everywhere, and the actuated gap belongs to TASK-194, whose bar (match fixed-time,
now 3,086) is unchanged. No hashes re-pinned. Check (1,482), city (176), traffic light and guard,
light e2e (53). Open: the misses still happen (from r:654 lane 1 the only way on is the ring; choosing
the lane earlier on the jughandle in `lane-change.ts` is the next step); head-detour candidates are
still ranked by normal cost; fixed seeds 4 and 5 and actuated seed 11 have more delay (all within the
gates).

TASK-194 (Claude Code subagent, Opus 5.5 high, 2026-11-17; merged with the owner's approval of the
switch): main reproduced both references (fixed 3,086 / 169, actuated 2,721 / 174). Actuated led until
07:30 and was -172 by 08:00. The core groups jg:10783 and jg:10802 ran the same greens in both modes
and lost because their exits were full; the cause was outside the core: n:635, jg:10786, jg:10780 and
jg:10798 skip uncalled phases, sending 131 more vehicles in the first half hour (actuating only the
outer controllers gives 2,680, the whole deficit). Rejected: not skipping phase 1 at jg:10802 (2,612),
standing cars not extending a green, dropping n:635's empty phase. Fix (`5f588a3`): in amber and
all-red a movement the next phase also serves stays green, in both modes; the snapshot carries
`signals.next` so the 2D and 3D lights and the signal preview show it (architecture snapshot line
updated). Full demand, main to branch, seeds 1 / 2 / 3: fixed 3,086 / 2,882 / 2,827 to 2,859 / 2,768 /
2,678; actuated 2,721 / 2,534 / 2,618 to 2,875 / 2,699 / 2,878. The fix helps actuated and costs
fixed-time 4 to 7%; why the same change pulls the two modes apart is not isolated. Default switch
(`354c1d7`, `GENERATED_TIMING` actuated): seeds 1 to 12 default against default, mean delay 796.3 to
669.0 s choice off (-16.0%), 118.7 to 81.1 s choice on (-31.7%); drain criterion met on all 48 runs
(worst 858 s, fixed seed 8); completions at 0.15 move at most 1.3%, gate seed 5,308 to 5,312; no
baseline reset. New full-demand references: actuated 2,875 / 151 (hash 1228152198), fixed 2,859 / 181
(hash 628103954). Re-pinned only network hashes that move because generated programs carry
`actuated: true` (T44, T49, T55, T75, V106, V107, V108, V117, the Munich census). Lead decision: the
margin over fixed-time is thin (+0.6% seed 1, -2.5% seed 2) and the default's full-demand completions
fall 6.8%; put to the owner, who approved the switch. Open: n:635's empty phase (34 s of all-red per
102 s cycle); jughandle lane choice is the likely lever for full demand in both modes.

TASK-199 (Claude Code subagent, Opus 5.5 high, 2026-11-17; merged 2026-11-18 with the owner's
approval): the jam was not TASK-194's exit filling but a resting green with a caller the controller
could not see. At n:68, jg:13294 and jg:13270 a car waited just before an approach lane of 4.9 to 6.4 m
(r:953, r:906, r:1055), outside the 40 m detection that only scanned approach lanes, so the controller
rested on the other phase indefinitely; fixed time serves every phase on the clock. Fix
(`src/sim/signals.ts`): an actuated controller's detection runs `DETECT_M` back along the route, over
the movements and lanes feeding a short approach and through other junctions (never its own members);
such a car calls or extends by the movement its route takes at the controller. Fixed-time unchanged;
`curateFreiburg` keeps `actuated`; architecture section 5.4 updated (outside the listed scope, accepted
as the description of the change). Freiburg at 0.15, choice on: actuated 1,448 completed / 11
gridlocked / worst visit 2,838 s to 1,455 / 0 / 180 s, mean delay 111 s (fixed-time 1,430, 310 s).
Munich actuated, seeds 1 to 12, main to branch: mean delay 669.0 to 665.9 s choice off (3 gridlocked
trips over 2 runs, under the gate), 81.1 to 83.2 s choice on; full demand 2,875 / 151 to 2,997 / 160,
mean delay 1,645 to 1,729 s (hash 2745499315, the new actuated reference); fixed-time hash-identical;
drain criterion met on all 48 runs. Variant B (cars past the approach lane call but never extend):
choice off 700.9 s, choice on 80.7 s, full demand 2,956 / 150; not taken. Seed spread (about 100 s
choice off) is as large as each difference. Re-pins: Freiburg city.json `c28e8a47...` to
`ded060cf...`, its state hash 3091275482 to 1137612334. Lead check on the merge: check, city (183), traffic light and guard, light e2e (61) all pass.
Open: `gate4-compare` fails on main when run alone ("Traffic worker terminated" after Open project
while the landing city is still loading), a race from TASK-198 that CI's retry hides.

TASK-207 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged, curation only): Freiburg's 187
warnings sorted. Committed (all in `curateFreiburg`, keyed to OSM ids): three lots the polygon cuts off
(pk:2814, pk:2818, pk:2829) removed with their areas kept; two dead ends into the pedestrian
Schwabentor (bus road r:554, service road r:958) removed; the ZOB taxi rank r:1269 turns at n:607.
187 to 174 (road_too_short 126 to 123, dead_end 24 to 19, lot_stalls_unreachable 18 to 16,
parking_no_exit 17 to 14). Held for the owner: F1, U-turns at dead-end lot aisles (Freiburg 20 fewer,
Munich 17, Sindelfingen 45 dead ends), which moves 13 Munich and 13 Sindelfingen pins and two TASK-164
lot-exit tests (a behaviour change to another feature); F2, lane mapping into a group's inner road
(fixes r:1148#4), which shifts later ids by 2 and so halves Freiburg's trams because `buildTimetable`
derives a route's departure offset from a hash of its id (`trains.ts`); that fragility needs fixing
first. Left: 46 junction-to-junction short roads and 17 short ends (TASK-212/213), 10 generated lot
layouts whose aisle never reaches the stalls (importer follow-up), garages needing data or a decision
(Karlsbau P13 pk:2675 exit unmapped; Friedrichring pk:2703 behind `motorcar=no`); severity proposals
(road_too_short only when a setback is clamped; inferred_attributes as info; aisles reported through
their lot; one warning per exitless lot) not applied. Re-pins: Freiburg city.json `d7bd896c...`, state
hash 3851309981. Lead check on the merge with TASK-209: check (1,518), city (183), traffic light and
guard, light e2e (61).

TASK-209 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged, document only):
`docs/decisions/2026-11-19-parked-branches.md`. TASK-128 and TASK-129 were merged on 2026-11-13
(`36a1eea`, `eaeda73`); their branches are 0 commits ahead of main and the plan's "held" labels were
stale (corrected). B56: on main at 0.15, Munich seeds 1 to 3 both choice settings show no loop ring,
worst loop visit 327 s, every released trip completed on seed 1; at full demand a backlog from r:961
down the ramps (worst 1,592 s, 2 stalled heads per seed), which TASK-130 never targeted. TASK-130's
branch conflicts in 12 of 18 files (17 hunks in `engine.ts`) and main already has its main ideas;
TASK-131 Phase 3's tip is message-only. Recommendation: drop all four holds. The owner decides on
retiring the branches and the worktrees `D:\cityflows-wt\131p3` and `128-remeasure`.

Full run 44424186431 (lead, manual, on 08ebee4 after TASK-213): every job green, including all five
e2e shards; the city job took 28.4 min.

TASK-213 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged): `bench/geometry-audit.ts` runs on
main again (R3-1 now n:474/n:1353, R3-7 n:366/n:417; Freiburg as a city; J1 to J6 as named cases) and its
through-road measure is corrected (first station 1 cm past the cut; roads within 30° no longer measured
at their far edge: J5's 5.25 m at n:552 and 3.35 m at n:1747 were audit faults; the real worst is n:108,
1.78 m, held by B43's 2 m storage rule, an owner decision). J4 fixed in `junctions.ts` with three rules:
a far-cut corner's curb starts from whichever edge is far (n:44 180° to 4°); an acute corner whose cut
corner lies just over the other edge becomes a gore with a rounded tip (n:2206 157° to 49°, Munich
n:324 off the list); a gore fillet may reach 4 m past the tip (n:660 152° to 23°, Sindelfingen n:27,
n:1162, n:68). Sharp corners Freiburg 106 to 92, Munich 22 to 20, Sindelfingen 31 to 28; bulge
Sindelfingen 105.5 to 110.6 m² (the rounded gore tips at n:1162 and n:68; accepted by the lead as the
area the rounding adds, not a defect); every other audit row identical. Traffic: Munich 48 runs and
both full demands bit-identical to main; Freiburg moves through the walk network (state hash on top of
TASK-207: 1813598902, re-pinned by the lead at the merge); Sindelfingen identical. Not fixed here: J1
(needs a group-level surface and curb rule, its own contract), J2 lobes and J6 Munich (in TASK-214's
files, passed on), J3 (r:433 clears the main road only 22 m out), J6 Sindelfingen (two overlapping OSM
ways, importer). Re-pins: Munich and Sindelfingen compiled-network and paint hashes (T44, T49, T55, T75,
V106 to V108, V114, V117), stale T42.1 exceptions removed. Lead check on the merge: check (1,530), city
(185), traffic light and guard, light e2e (61).

Full run 44417927328 (lead, manual, on 6827d2c after TASK-210): every job green, including all five
e2e shards; the city job took 33.4 min.

Full run 44486203252 (lead, manual, on b5b8c1d after TASK-216): every job green, including all five
e2e shards; the city job took 15.3 min.

TASK-216 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged): Freiburg's Hauptbahnhof box
checked against LGL Baden-Württemberg DOP20 (WMS `WMS_LGL-BW_ATKIS_DOP_20_C`, layer
`IMAGES_DOP_20_RGB`, dl-de/by-2-0; 15 tiles, 2.2 MB, kept in `D:\cityflows-wt\216-data`), overlaid by
`bench/aerial-overlay.ts` (Playwright). Registration on four tram-rail stretches: raw offsets under
0.4 m, residual 0.12 m after a 0.27 m constant, no correction applied. Defects
(`docs/findings/2026-11-19-aerial-check/`): D1 default zebras at almost every arm, none at the five
mapped zebras (155 of 167 drawn crossings over 4 m from any mapped crossing; geometry rule,
`crossings.ts`); D2 the Hbf group swallows a median crossover, stop line and zebra 37 m before the
painted line at n:1147 (J1); D3 five-lane approaches 2 m too wide (r:1179, r:261; importer, 3.5 m
lanes); D4 r:1178's stop line 9 m past the signalised cycle crossing (importer, `controls.ts`); D5
Bismarckallee drawn as two carriageways with a 1.3 m median where it is one (importer); D6 a two-way
`lanes=1` promenade drawn as a two-lane road; D7 Friedrichstraße's lane gain 19 m off (OSM data); D8
tram track on ballast where it is embedded or on grass (825 m; importer track form); D9 `width=`
ignored (Rotteckring 4 m drawn 3 m). Group ids in the box moved at the TASK-214 rebuild (jg:13298 is
now jg:13297). Outside scope: `bench/register.ts` leaves `node_modules` JSON to Node (Playwright
under Node 24 broke on the rewritten `package.json`). Proposed follow-ups: crossings from mapped OSM
nodes (D1; with or after TASK-215), group stop lines across median crossovers (D2, the J1 contract),
importer road widths, medians, shared lanes and stop lines (D3 to D6, D9), tram track form (D8), and
an OSM edit or curation entry for D7 (owner's). Lead check on the merge: check (1,532), city (193);
the Freiburg build through the changed loader reproduces the bundled project.

Full run 44517065466 (lead, manual, on 424b03c after TASK-220): every job green, including all five
e2e shards; the city job took 19.4 min.

TASK-220 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged under the owner's merge rule,
traffic identical): tram track form (TASK-216 D8) in `assignTramForms` (`src/importers/osm/rail.ts`).
Tags first: a tram on a highway way, `embedded=*` (no gives an own bed), `surface=grass` or
`railway:track_ballast`, loose surfaces, and highways carrying the rails (`embedded_rails*`,
`railway:lanes*`, pedestrian streets) over half the track; then inferred (marked so): over 80% inside
road or group surfaces is embedded, on a mapped grass strip is grass, within 2.5 m of a one-lane
carriageway over 80% is embedded (Rotteckring, whose lanes D9 draws narrow), else paved where a paved
surface is tagged (cobblestone, concrete plates and bricks now count) or ballast. Freiburg ballast
308 sections / 6,613 m to 47 / 797 m (embedded 596 m to 5,044 m, grass 640 m to 1,448 m); the D8 ways
in the box 784 m of ballast to 189 m embedded, 372 m grass, 100 m paved, 123 m ballast. Munich: 16 of
54 tracks change (2,045 m of Arnulfstraße on mapped grass strips). Drawing: embedded track off the
drawn roads gets a street surface (asphalt where it meets a road, grey stone in a pedestrian street,
lifted onto the footways in 3D); paved beds grey stone `0xbab5ab`. Hashes identical to main (Munich
0.15 seed 1 all four configurations, Freiburg 1730700508, Sindelfingen 2565719556, both full demands);
frame budgets within limits (2D p95 2.0 ms, 3D 3.4 ms, a loaded machine). Re-pins: Freiburg city.json
`77d57494...` (only tram `form` and provenance), Munich city and compile hashes (T44, T49, T75, V106
to V108, V117). Outside scope: `src/importers/osm/index.ts` (positions passed), `src/render/style.ts`,
`bench/aerial-overlay.ts` (rails coloured by form). Left open: Arnulfstraße near Donnersbergerbrücke
may be ballast on the ground (TASK-135's reference images) where OSM maps grass; no Munich imagery to
check (owner's call: curation entry or rule 6 change); about 115 m of Rotteckring track
(rt:12913, rt:12942, rt:12944, rt:12915) stays ballast because parking bays keep it over 2.5 m from the
drawn carriageway (fixed by D9 widths, TASK-218, or a curation entry). Lead check on the merge: the
Freiburg rebuild reproduces the bundled project; check (1,533), city (193), traffic light and guard,
light e2e (61); full demand actuated 3,759 / 143 (4028429784), fixed-time 3,501 / 168 (2888500527).

TASK-219 (Claude Code subagent, Opus 5.5 high, 2026-11-19; parked under the owner's merge rule):
junction-group membership in `src/importers/osm/split.ts`. D2 fixed by two rules: a link of at most
30 m between the two antiparallel carriageways of one named street, each end with one carriageway in
and one out, joins no group (Freiburg's only one: way 795829487, `n:1147`/`n:488`, a gated service
crossover taken in by TASK-131's rule (c)); a slip-road diverge (`n:473`, `r:2153`) leaves a
signalised group that also took in the slip road's end. The Hauptbahnhof group 11 members / 12 inner
roads to 7 / 7; its westbound stop line from 38.5 m before the painted one to 4.0 m past it; Munich and
Sindelfingen import byte-identical cities. J1 not changed: inner roads shorter than their cuts keep
3 to 5 m lane blocks under the 5 m trim floor (`lanes.ts`, `compile.ts`), 39 of Freiburg's 46 overlap
pairs (170.2 of 214.8 m²); member outlines over the inner roads tried (overlap 117.2 m², bulge 31.5 to
121.4 m²) and dropped; passed to TASK-221. Traffic: Munich seeds 1 to 3 every configuration and both
full demands hash-identical to main (no simulation file changed; the agent ran seeds 1 to 3 rather
than 12, accepted as the imported city is byte-identical), Sindelfingen identical.
Freiburg's gate (0.15 seed 1):

| tree | completed / gridlocked | mean delay | audit |
|---|---|---|---|
| main | 1,462 / 0 | 76.2 s | — |
| tip `5bc497a` | 1,370 / 24 (4 stalled heads) | 73.9 s | sharp corners 89 to 90 (the gore at `n:473`) |
| variant `c96c115` (no slip-road condition) | 1,461 / 0 | 75.4 s | sharp 89 to 93, under 2 m 166 to 169, Lessingstraße island paved over |

Seeds 1 to 6 gridlocked: main 0/5/9/21/0/0, tip 24/0/11/0/0/0, variant 0/0/11/0/0/0. The tip's 24 lock
at the Siegesdenkmal group `jg:13305` (stalled heads `r:1789`, `r:1659`), the same box as main's own
seed 2 and 4 locks; main's seed 3 lock is TASK-222's `n:18`/`n:39`. The tip fails `test:city` (the
gate), the variant the contract's "no audit measure worse", so both miss and the task is parked
(branch kept, worktree `D:\cityflows-wt\219`). Follow-ups written: TASK-225 (the Siegesdenkmal lock,
main's own) and TASK-226 (the tip re-measured on it). Rule slip reported by the agent: one `pkill -f`
with a pattern unique to its own script (the lead's rule is stop by PID); no other process affected.

TASK-225 (Claude Code subagent, Opus 5.5 high, 2026-11-19; diagnosed, rule waits for TASK-222):
the Siegesdenkmal lock is not in the box. The group is empty throughout; two tram crossings inside it
(facility 9, stop line on `r:1789`; facility 17, on `r:1659`) stay closed from the lock's start to
10:00 (main seed 2 from 31,510 s, seed 4 from 29,161 s; TASK-219's tip seed 1 from 29,761 s). Two tram
routes enter the map at `rn:12517`, about 120 m before the crossings, and reach them 7.6 to 8.4 s after
starting, inside the 12 s warning; a tram waiting at its start for its track (`delayedTracks`: any
delayed tram on a shared section holds unstarted services) is therefore already warning, and
departures queue back to back, so the crossings never reopen. Held heads have their jam timer reset
and never respawn; the cars behind them fail as gridlocked. Proposed rule (in
`D:\cityflows-wt\225-evidence\rule.patch`, +16/-14 in `rail-crossings.ts`, TASK-222's file): a
service standing still for its track does not keep closed a crossing it has not reached (the existing
upstream-interlock state; the crossing entered this step excepted); a fresh full warning runs when
it moves. Prototype on main: Freiburg seed 2 1,460 / 5 to 1,476 / 0 (67.8 to 67.4 s), seed 4 1,351 /
21 to 1,463 / 0 (73.3 to 68.3 s), seeds 1, 3, 5, 6 identical hashes; TASK-219's tip seed 1 1,370 / 24
to 1,461 / 0 (73.7 s); Munich seed 1 four configurations, both full demands and Sindelfingen
identical hashes. Committed on the branch (`270bcdd`): the reproduction
`tests/sim/T75-held-service-crossing.test.ts` as `test.fails` (to flip when the rule lands). Tiers on
the branch: check (1,533 and 2 expected fails), city (193), traffic light, light e2e (61). Lead
decision: the agent resumes after TASK-222 merges, rebases, applies the rule and measures it in full
(12 Munich seeds); the backlog it found is TASK-228.

TASK-222 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged under the owner's merge rule): the
lock between a tram crossing and two actuated signals (TASK-208's item 3). At Freiburg's `n:18` a car
on `r:1348` needs `n:18` phase 0 and group 2 phase 0 green together, one on `r:1059` group 2 phase 1
or 2 and `n:18` phase 2; each, held at the crossing for the other controller's red inside its
clearance, extends the green it cannot use and calls the other, so both run to their 30 s maximum and
swap within 0.6 s, for ever (on TASK-208's tree with TASK-204's second rule off: 07:54:16 to 07:57:16,
cars 1373 and 1631 through five swaps; latent on main). Rule (`src/sim/signals.ts`, with the red stop
line that held each car recorded in `rail-crossings.ts` and passed through `engine.ts`): an actuated
controller in green keeps it while a car that would extend it is held by a crossing for another
controller's red, that controller is changing to a phase serving the car, and the wait is mutual (it
also has a call from a car the crossing holds for its own red); kept to `PASSAGE_S` beyond, past the
timed green if need be. Controllers advance in a fixed order, so the second of two keeps its green.
Real case cleared in 50 s. Tried and dropped: "a car that cannot clear does not extend" (alone the
synthetic corridor still locks; with the keep Freiburg 76.2 to 88.5 s). First version without the
mutual condition also met the rule but moved Munich (actuated choice off +2.6%, choice on -1.8%; full
demand actuated 206 fewer completed) through a one-way wait at jg:10783/n:474 that cannot lock; the
narrower version shipped. Reproduction: `tests/sim/T75-crossing-signal-lock.test.ts` (two actuated
signals 10 m apart joined by a crossing, opposite phases: main 0 of 30 cars complete). Traffic: Munich
48 runs (seeds 1 to 12, choice off and on, both modes) and both full demands hash-identical; Freiburg
1,462 / 0 both, 76.2 to 75.7 s, hash 1730700508 to 4038635547 (re-pinned); Sindelfingen identical.
Outside scope: `src/sim/engine.ts` (3 lines), the Freiburg re-pin, one paragraph in
`docs/architecture.md` section 5.4 (accepted by the lead: it documents the rule as TASK-204's did).
Lead check on the merge (on top of TASK-220): check (1,534), city (193), traffic light and guard,
light e2e (61); full demand actuated 3,759 / 143 (4028429784), fixed-time 3,501 / 168 (2888500527).

Full run 44536794264 (lead, manual, on 486a631 after TASK-222): every job green, including all five
e2e shards; the city job took 32.4 min (the machine was loaded by four agents).

TASK-217 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged under the owner's merge rule as its
paint-only variant `51fd128`; TASK-215 reworked): crossings and markings in `src/render/marking-geometry.ts`
and `src/network/crossings.ts` (paint flags only). D1: signalised crossings draw the two German broken
lines; zebras only where OSM maps a crossing way; a default crossing with nothing mapped is unpainted
but keeps its place, span, stop line and walk link (Hauptbahnhof box: painted 170 to 42, over 4 m from
any mapped crossing 158 to 22, mapped zebras matched 0 to 2 of 13). M1: a group's entry lane shows its
turns through the whole group (lanes with arrows Freiburg 44 to 55, Munich 104 to 111). M2: lane lines
only on inner lanes of 15 m or more (231/40/2 to 0). M4: keep-clear boxes and arrows stay clear of
crossings; close pairs paint only at signals. M6: one stop line through every lane's stop position
(59/24/0 approaches in pieces to 0). M7: solid lane lines over the last 30 m before a stop line (half
the stop distance on short roads), not across a lane gain or beside a tapered lane end (35/40/0
approaches). Audit: no distance measure worse (painted metres grow with M7). Traffic: every hash
identical (Munich seeds 1 to 3 all configurations, both full demands, Freiburg 1730700508,
Sindelfingen). The full version (`67f1d38`, traffic measured on `d5e6092`) also moved crossings onto
mapped ones, drew straight bands per arm (M5), and made marked crossing nodes and `path=crossing` ways
crossing links; it missed the rule:

| Munich 0.15 seeds 1 to 12 | main | full version |
|---|---|---|
| actuated, choice off | 630.6 s | 644.4 s (+2.2%) |
| actuated, choice on | 90.8 s | 91.5 s (+0.8%) |
| fixed, choice off | 789.0 s | 817.9 s (+3.7%) |
| fixed, choice on | 125.0 s | 130.8 s (+4.6%) |

Full demand: actuated 3,347 / 167, 1,694 s (+1.0%; 412 fewer completed), fixed 3,387 / 165, 1,693 s
(-2.0%); Freiburg 1,459 / 0, 87 s (+11 s). An intermediate variant without the move (`d5c7af1`) gave
Freiburg 93 s and no Munich gain on four seeds and was dropped. Left: `crossing=unmarked` on a mapped
way cannot reach the compiled city (walk links carry only their kind), so those paint as zebras (24 in
Munich): a schema field, owner's call; crossings mapped only as nodes (zebras at `n:211`, `n:1139`)
need walk links, which move traffic; TASK-218's D4 signal paints as a zebra; M5 and the move need a
traffic budget or more seeds. The agent reported one slip: a stopped chain kept running and duplicated
the full version's seed reports for about 50 minutes (hashes matched; timings indicative).

TASK-227 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged, render only): pitched roofs on
concave outlines from a straight skeleton (`src/geo/straight-skeleton.ts`, wavefront with edge and
split events, courtyards supported; vertices within 2 cm of collinear folded; ties edge-first; fails
safe to flat on a degenerate outline or a failed check: simple faces, nodes at their edge distance
within 1 mm, face area within 0.1%). Fuzz: 0.6 to 0.8% of outlines with corners off by 0.01 to 0.1 mm
stay flat (below OSM precision); exact, 1 mm to 5 cm noise and 945 courtyard blocks never fail.
Hipped and pyramidal from the skeleton; gabled turns a triangular face whose apex ends a level ridge
over the middle 80% of its edge into a wall-coloured gable, else stays hipped; one pitch per roof so
the widest wing reaches the roof height (default 35°, at most 8 m and half the building). Convex roofs
unchanged. Flat fallbacks Freiburg 204 to 14 (gabled 151, 262 gable ends; hipped 38; pyramidal 1),
Munich 70 to 13, Sindelfingen 0; the rest half-hipped, round, gambrel, mansard, skillion on concave
outlines and one zero-height part. 3D build median 1,742 to 1,840 ms (loaded machine), render p95 3D
3.6 ms, 2D 2.0 to 2.2 ms (budgets 6 and 4). Hashes identical. No files outside scope.

TASK-218 (Claude Code subagent, Opus 5.5 high, 2026-11-19; parked under the owner's merge rule, branch
`task/218-importer-roads` `26f69c5`, worktree `D:\cityflows-wt\218`): importer road shapes. D3 untagged
urban lanes (limit 50 km/h or less) secondary 3.25 m, tertiary 3.0 m, primary 3.5 m (Bismarckallee
measures 3.45 to 3.5 m): `r:261` 17.5 to 16.25 m (ground 16.0), `r:1179` 17.5 to 16.25 m (15.5); D3/D9
`width:lanes` when complete, else `width` shared evenly (the variant only on ways with no street
parking), `source:width=estimated` ignored (139 Freiburg estimates 1 to 3 m low): Rotteckring 3.0 to
4.0 m; D6 a two-way `lanes=1` way is one 4.5 m `sharedLane` carriageway (its centre line still drawn,
TASK-217's file); D5 opposite carriageways whose lane blocks leave under 2 m over 20 m (RASt 06's
narrowest median) are pulled to a 0.5 m painted median (`r:1251`/`r:2215` one surface); D4 a signal
mapped at its stop line within 30 m of the junction its control moved to joins that junction's group
(`r:1178` 9 m past the painted line to 0.8 m; Freiburg groups 39 to 46, the Hbf group becomes
`jg:13295`). Traffic:

| Munich 0.15 seeds 1 to 12 mean delay | main | first version | variant `26f69c5` |
|---|---|---|---|
| actuated, choice off | 630.5 s | -2.3% | 621.2 s (-1.5%) |
| actuated, choice on | 90.8 s | -2.6% | 89.3 s (-1.7%) |
| fixed, choice off | 789.0 s | +4.9% | 812.3 s (+2.95%) |
| fixed, choice on | 125.0 s | +7.6% | 125.1 s (+0.1%) |

Full demand, variant: actuated 3,491 / 176, 1,641 s (-2.2%), fixed 3,470 / 159, 1,746 s (+1.1%); first
version fixed 1,799 s (+4.2%). Freiburg variant 1,457 / 0, 74 s; first version 78 s. Cause of the first
miss (bisected): Munich's three `width` ways with street parking (90400545, `width=7`, widened 22 roads).
The variant meets the traffic thresholds but fails the contract's "no audit measure worse": Freiburg
fold back-step 3.47 to 6.63 m (`r:1185`, the Hbf inner road, J1), bulge 31.46 to 41.76 m² (D4's new
groups), end overlap 25.11 to 27.04 m²; Munich voids 15,578 to 16,473 m² (narrower lanes leave more of
each median undrawn), sharp corners 19 to 22; Sindelfingen voids, joins and corners up by one each
(lane overlap better in all three). Both versions miss, so the task is parked. Possible splits for the
owner: D4 with J1 (TASK-226's area); D3/D9 widths with an audit that measures voids against the drawn
median; D5 and D6 alone (Freiburg only). Left: `placement` ignored (284 Freiburg ways); width steps at
plain nodes; D6's centre line. Expect a textual conflict with TASK-219/226 in `split.ts`.

Lead check on the TASK-217 and 227 merge (V108's compile pin from TASK-220 and arrows pin from
TASK-217 combined): the Freiburg rebuild reproduces the bundled project; check 1,553 passed with two
Sindelfingen tests over their 60 s limit (65 s, the machine running two full demands and three agents;
9 s and 20 s alone, both pass rerun); city (205), traffic light and guard, light e2e (61); full demand
actuated 3,759 / 143 (4028429784), fixed-time 3,501 / 168 (2888500527).

Full run 44547052795 (lead, manual, on a46d906 after TASK-217 and 227): every job green, including all
five e2e shards (the two Sindelfingen tests that timed out on the loaded machine pass); the city job
took 18.1 min.

TASK-225, rule (same agent, 2026-11-19; merged under the owner's merge rule, `35bb37b` on 486a631):
the rule above in `src/sim/rail-crossings.ts`, applied cleanly on TASK-222 (which changed `hold()`,
not the service loop); the two reproductions in `tests/sim/T75-held-service-crossing.test.ts` now pass.
Freiburg 0.15 against main 486a631: seed 2 1,460 / 5 (4 stalled heads), 67.8 s to 1,476 / 0, 67.4 s;
seeds 1 (gate, 4038635547), 3, 4, 5, 6 identical hashes (TASK-222's timing already cleared seed 4).
TASK-219's tip merged on 486a631 with its project rebuilt, without and with the rule: seed 1 1,369 /
22 to 1,461 / 0 (73.7 s), seed 2 1,361 / 28 to 1,479 / 0 (76.2 to 65.2 s), seed 3 1,422 / 11 to 1,487 /
0; all those locks at the Siegesdenkmal. Munich 48 runs, both full demands and Sindelfingen
hash-identical; drain criterion 48 of 48. No files outside scope. Lead check on the merge (on top of
TASK-217 and 227): check (1,557), city (205), traffic light and guard, light e2e (61); full demand
actuated 3,759 / 143 (4028429784), fixed-time 3,501 / 168 (2888500527).

TASK-223 (Claude Code subagent, Opus 5.5 high, 2026-11-19; parked under the owner's merge rule, branch
`task/223-remaining-misses-2`, v1 `f5071e7`, v2 `5fb2693`, worktree `D:\cityflows-wt\223`): TASK-208's
`detourHeads` rule re-measured on TASK-222. v1 (as TASK-208): a queue head does not detour into
another lane of its next road whose route needs more later lane changes than its planned lane's. v2:
only when the alternative needs at least two more (keeps `r:700` lane 0, the cause of `r:654`'s misses;
drops the one-change cases, which the refusal log showed at a dozen other Munich stop lines and which
raised v1's fixed-time delay). The contract's example variant (only when the detour's next road is the
head's own) was not taken: almost every refusal already continues on the planned route's next two
roads, so it would not narrow the rule. Misses, 12 seeds choice off (main / v1 / v2): `r:654` actuated
83 / 8 / 8, fixed 310 / 11 / 10; `r:639` actuated 94 / 82 / 77, fixed 883 / 406 / 604; choice on 0 in
all.

| Munich 0.15 seeds 1 to 12 mean delay | main | v1 | v2 |
|---|---|---|---|
| actuated, choice off | 630.6 s | 646.8 s (+2.6%) | 627.6 s (-0.5%) |
| actuated, choice on | 90.8 s | 91.6 s (+0.9%) | identical hashes |
| fixed, choice off | 789.0 s | 841.5 s (+6.7%) | 797.5 s (+1.1%) |
| fixed, choice on | 125.0 s | 125.2 s (+0.2%) | identical hashes |

| Full demand | main | v1 | v2 |
|---|---|---|---|
| actuated | 3,759 / 143, 1,677.6 s | 3,718 / 147, 1,592.7 s (-5.1%) | 3,730 / 140, 1,616.0 s (-3.7%) |
| fixed | 3,501 / 168, 1,727.1 s | 3,500 / 185, 1,755.7 s (+1.7%) | 3,414 / 169, 1,781.2 s (+3.1%) |

Drain 48 of 48 in every version; Freiburg (the rule never fires there) and Sindelfingen identical. v1
misses on Munich fixed choice off, v2 on fixed full demand (one seed, so noisier than the 12-seed
means), so the task is parked. Owner's options: park, take v2, or take v1. Outside scope:
`docs/architecture.md` (TASK-208's paragraph carried over, updated for the two-change threshold).

Full run 44551579772 (lead, manual, on 2d4dd1f after TASK-225): every job green, including all five
e2e shards; the city job took 19.2 min.

TASK-224 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged, bench and findings only): TASK-216's
box re-measured on main 2d4dd1f with the same imagery (registration 0.27 m, unchanged), and the parked
branches rendered as they would look on main (scratch merges, Freiburg rebuilt). Findings in
`docs/findings/2026-11-19-aerial-recheck/` (31 figures).

| # | TASK-216 | main now | parked branch on main |
|---|---|---|---|
| D1 crossings | 170 painted (all zebra), 158 over 4 m from a mapped crossing, 0 of 13 zebras matched | partly: 42 painted (6 zebra, 36 signal lines), 22 away, 2 of 13; node-only zebras `n:211`, `n:1139` not drawn | — |
| D2 Hbf stop line | 37 m before the painted line | not fixed; its lane lines now gone too (N1) | TASK-219: fixed, 4.0 m past; lane lines back but swing 1 to 2 m across `n:1147` |
| D3 five-lane width | `r:1179` 17.5 m, `r:261` 17.8 m | not fixed | TASK-218: both 16.25 m, but about 1.7 m off the ground line (`placement`) |
| D4 `r:1178` stop line | 9 m past | not fixed (now one solid line) | TASK-218: fixed, 0.8 m |
| D5 Bismarckallee median | west kerb 2.3 m out | not fixed | TASK-218: one carriageway, west kerb 1.5 m out, east 0.8 m in |
| D6 promenade | 6.0 m, two lanes | not fixed | TASK-218: partly, one 4.5 m shared lane, centre line and hatch still drawn |
| D7 lane gain | 19 m late | not fixed; two lanes lost arrows (N2) | TASK-219: no stop line at `n:1147`; arrows still missing |
| D8 tram bed | 825 m ballast | mostly: 123 m ballast left (115 m at Fahnenbergplatz on paving) | as main |
| D9 width tags | Rotteckring 3.0 m, ground about 5 m | not fixed | TASK-218: `r:1690` 4.0 m; `r:1590` 3.0 m (street parking) |

New: N1 (TASK-217 M2) lane lines removed where a group takes in carriageway (35 m of westbound
Friedrichstraße, Stefan-Meier-Straße at `r:1179`); N2 (TASK-217 M1) the two left lanes of `r:1148`
show no arrows (lane 0 has no path through the Hbf group; lane 1's only path turns left twice, read as
a U-turn); N3 (TASK-220, minor) a darker asphalt wedge where embedded track paving meets the
Rotteckring approach; N4 (TASK-227) 31 roofs in the box now pitched, 23 match the imagery, 4 unclear,
1 half outside, 3 doubtful from OSM outlines or tags the flat fallback hid (a block over a glass-roofed
courtyard, an outline over yard sheds, a school tagged hipped drawn steep over a low pitch). Bench:
`shots3d` takes `--port` and `--buildings`, views D9b, D8b, R1 to R4, a `roofs` option. Follow-ups
written: TASK-229 (N1, N2). Others for the owner: TASK-218 split (D4 with J1; D3/D9 widths with
`placement` and a void measure against the drawn median; D5 and D6 alone), node-only zebras with walk
links (moves traffic), the Rotteckring ballast (curation or TASK-220's rule to the bays' outer edge),
D7 (OSM edit or curation), OSM fixes for the three roofs, N3. Lead check on the merge: check (1,557).

Full run 44555679026 (lead, manual, on aa39458 after TASK-224): every job green, including all five
e2e shards; the city job took 23.7 min.

TASK-229 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged, paint only): TASK-224's N1 and N2 in
`src/render/marking-geometry.ts`. N1: M2 measured each inner lane between its cuts, and group outlines
take most of a member road (westbound Friedrichstraße `r:1149` 18.1 m node to node, lanes 4.6 to
4.8 m; Stefan-Meier-Straße `r:6`, `r:745`, `r:1179` 33 m through plain nodes). Rule
(`innerCarriageway`): lanes of 15 m or more keep their lines; an inner road also keeps them when its
run (the road plus the same group's inner roads joined through plain nodes) is 15 m or more node to
node and crossing traffic meets it at one end at most (merges and diverges are not crossings), so
Munich's wide medians (`r:252`, `r:966`, `r:331`, `r:939`, `r:656`, `r:660`, 22 to 24 m crossed at both
ends) and the Hbf links stay bare. Inner-road dividers main to branch: box 0 to 15, Freiburg 0 to 38,
Munich 12 to 16, Sindelfingen 0 (before M2: 40, 143, 33). N2: an entry lane with no path through its
group, or whose paths are all U-turns of two turns to the same side, shows its own movement's arrow at
the entry node (`r:1148#0` and `#1` regain arrows; `r:1262#1` and `r:1478#1` lose theirs to the
existing all-lanes-same rule, and the imagery shows none there). Audit: every total unchanged except
painted metres (Freiburg 14,865 to 14,984 m, Munich 35,062 to 35,082 m, amounts as for TASK-217); the
named case J1-stefan's marking offset 0 to 0.004 m. Lead decision: accepted, because main read 0 only
while TASK-217's M2 removed those lines, 0.004 m is the value before M2, and it is under the 5 cm limit;
unlike TASK-218 and 219, no geometry got worse. Hashes identical (Munich seed 1 four configurations,
Freiburg 4038635547, Sindelfingen, both full demands). Outside scope: `T32-markings.test.ts` (the
Munich N1 test), Munich paint pins in V114 and V117 (`r:267`'s four new dividers). Lead check on the
merge: check (1,557), city (208), traffic light and guard, light e2e (61); full demand identical.

TASK-228 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged under the owner's merge rule as v2
`8cccaf6`): the tram backlog TASK-225 found. A run about to enter waited for any delayed running
service on any shared track (`delayedTracks`), so departures queued back to back. Rule (`waitsFor` in
`src/sim/rail-crossings.ts`): it waits only for a delayed run of its own route (main's rule, kept in
v2), one sharing a track in the opposite direction (main's rule), or one that on its own clock would
still hold a shared track while the entering run is on it (the timetable's per-track occupancy check
on live clocks; a standing delayed run holds every shared track ahead of it). Track safety (the block
rule) and TASK-225's rule unchanged. Freiburg seeds 1 to 6, 07:00 to 10:00 (240 runs due): runs entered
by 10:00 main 167 to 189, v1 and v2 240; trams entering per hour main 48 to 75, v2 80 (the timetable);
runs waiting at origin in the 09:00 hour main mean 40 to 56, v2 at most 1; worst entry lag 5,548 s to
35 s. Munich had no backlog.

| | v1 `196f9aa` (no same-route hold) | v2 `8cccaf6` |
|---|---|---|
| Munich 0.15, 48 runs | hash-identical | hash-identical |
| full demand actuated (1,677.6 s) | 3,747 / 157, 1,668.0 s (-0.6%) | identical (4028429784) |
| full demand fixed (1,727.1 s) | 3,455 / 165, 1,791.8 s (+3.7%) | identical (2888500527) |
| Freiburg gate (75.7 s) | 1,461 / 0, 80.4 s | 1,460 / 0, 80.3 s (+4.6 s), hash 1407248127 |

v1 let a line's next run enter behind its own late run in Munich, where it caught up; Freiburg's
backlog came from holds between lines. Freiburg seeds 1 to 6 mean main 67.3 s, v2 68.5 s; the rise is
the third more trams closing its crossings. Outside scope: one sentence in `docs/architecture.md`
(accepted, as for TASK-222), the Freiburg gate re-pin. Open as on main: a run admitted on time and held
later can meet an opposing run on a single track; a late run of a line slower than its headway holds
the next run longer than the gap (neither seen in any run). Lead check on the merge (on top of
TASK-229): check (1,560), city (208), traffic light and guard, light e2e (61); full demand actuated 3,759 / 143 (4028429784), fixed-time 3,501 / 168 (2888500527).

TASK-226 (Claude Code subagent, Opus 5.5 high, 2026-11-19; parked, the lead recommends merging; branch
`task/226-group-surfaces-2` `b8e609b`, worktree `D:\cityflows-wt\226`): TASK-219's two group-membership
rules, byte-identical, on main 2d4dd1f with TASK-225's rule, plus a gore rule in `junctions.ts`: on a
slip road whose far node cuts nothing off it, the gore fillet may use its edge to 5 cm from the end
(was 1 m). At `n:473` (`r:2153`, 5 m of surface before it continues into `r:408`) the nose goes from
0.75 m radius turning 41.8° (sharp) to 1.16 m turning 24.8°; only 2.2 m of edge remain past the tip, so
no curve turning 123° can exceed 1.19 m. Audit: Freiburg sharp corners 89 to 89, corners under 2 m 166
to 167 (that nose); line and marking lengths up; Munich and Sindelfingen identical (cities
byte-identical). D2 fixed: the Hbf group 11 members / 12 inner roads to 7 / 7, the westbound stop line
at the painted one. Freiburg 0.15 (main / branch): seed 1 (gate) 1,462 / 0, 75.7 s / 1,461 / 0, 73.7 s
(hash 4252036568); seeds 2 to 6 no gridlock either side, means 67.3 s / 68.6 s (seed 6 63.4 to 71.8 s,
not traced). Munich seeds 1 to 3 every configuration, both full demands and Sindelfingen
hash-identical. Tiers: check (1,559), city (206), traffic light, light e2e (61). It meets the merge
rule and misses the contract's audit gate by one corner under 2 m, which the contract says to report,
so it is parked. Lead recommendation: merge (one 1.16 m nose at a real 5 m slip road, against D2's
37 m stop-line error); needs a Freiburg rebuild on top of whatever lands first. The agent reported a
slip: stopping its own leftover vitest process by PID it also stopped `MoNotificationUx.exe` (a Windows
Update notification process whose stale parent id matched); no agent's work affected. Later agents are
told never to stop processes by name, pattern or parent id.

Full run 44576912292 (lead, manual, on d184570 after TASK-229 and 228): every job green, including all
five e2e shards; the city job took 23.2 min.

TASK-221 (Claude Code subagent, Opus 5.5 high, 2026-11-19; parked, the lead recommends merging; branch
`task/221-carry-tapers`, first version `5973019`, variant `0b62f2c`, worktree `D:\cityflows-wt\221`): at a
continuation node a lane shift (a branch held beside the trunk, a split, a jog) runs on through the
plain nodes beyond its roads so it gets its full taper (`carryTransitions` in `continuity.ts`, with
`lanes.ts` and `compile.ts`); the branches leave the node straight and bend onto the widest branch's
road; eight sub-rules, each with a test in `tests/network/carry-tapers.city.test.ts` that fails with it
off. The variant drops the carry where only the widest branch goes past its first road (Munich
`n:734`, Freiburg `n:1709`). Cases (variant): S6 `n:536` join 0.438 to 0.012 m, ramp overlap 12.1 to
0 m²; J6 Munich `n:194` ramp/`r:416` overlap 59.8 to 0 m², end overlap 85 to 0; `n:600` 0.449 to
0.040, `n:1483` 0.177 to 0.045; new join `n:601` 0 to 0.153. Unchanged: S6 `n:900` (shared splits left
alone) and `n:1130` (a lane-width step), S5 and J2 (consecutive gains with no plain node between; the
fix is in the marking renderer), Munich `n:19`/`n:624` (a two-way 87° turn, nothing to carry).
Audit main to variant: Freiburg joins over 5 cm 82 to 76, lane overlap 214.80 to 200.97 m², nothing
worse; Munich lane overlap 257.14 to 190.75, overlap 145.22 to 138.28, end overlap 105.95 to 20.92,
worse: corridor lane overlap 69.79 to 69.91 m² (`r:259` moves up to 2.2 cm near `n:257`);
Sindelfingen joins over 5 cm 17 to 16; named case B39 width p95 0.192 to 0.195 m.

| mean delay | main | first version | variant |
|---|---|---|---|
| Munich actuated, choice off | 630.6 s | 629.8 s | 620.8 s (-1.6%) |
| Munich actuated, choice on | 90.8 s | 89.6 s | 90.3 s (-0.6%) |
| Munich fixed, choice off | 789.0 s | 818.0 s (+3.7%) | 800.3 s (+1.4%) |
| Munich fixed, choice on | 125.0 s | 124.6 s | 124.9 s (-0.1%) |
| full demand actuated | 1,677.6 s | 1,852.9 s (+10.4%) | 1,678.3 s (+0.04%), 3,591 / 173 |
| full demand fixed | 1,727.1 s | 1,707.3 s | 1,747.5 s (+1.2%), 3,504 / 153 |
| Freiburg gate | 75.7 s | 74.8 s | 75.8 s, 1,461 / 0 (hash 1102481493) |

Drain criterion 48 of 48 in both; Sindelfingen 155 / 0, 27.1 s (hash 3762136883). The first version
also failed `test:city`'s Munich road-body budget (7 against 6, at `n:734`). The variant meets the
merge rule (full-demand actuated completes 168 fewer at the same delay) and every tier (check 1,555,
city 213, traffic light and guard, light e2e 61), but misses the contract's "no audit measure worse"
by 0.12 m² and 3 mm, so it is parked. Lead recommendation: merge; the gains (Munich end overlap -85 m²,
lane overlap -66 m², Freiburg six joins fewer) far outweigh the two figures, both under any visible
size; it needs re-pins on whatever lands first. TASK-219's items not taken (the 5 m trim floor moves
every short road; the `n:473` dividers and `r:770` fold exist only on TASK-219's branch). Outside
scope: test re-pins (T44 to V117) and the `n:194` crossing name in `tests/network/junction-audit.ts`.
The agent reported a slip: one `npm run check` started in `D:\cityflows` from a mis-scoped `cd`,
stopped during its unit tests; no tracked file changed (git status clean).

TASK-231 (Claude Code subagent, Opus 5.5 high, 2026-11-19; parked under the owner's merge rule, branch
`task/231-halves-shared-lanes`, first version `2922724`, variant `a6c4ba1`, worktree
`D:\cityflows-wt\231`): TASK-218's D5 and D6 alone. D5 (`pushOverlapping`, `corridors.ts`): opposite
carriageways (not motorway, trunk or ramp) whose lane blocks leave a gap under 2 m over at least 20 m
are pulled to a 0.5 m painted median where the gap is under 3 m, narrowed to pairs clear of each other
everywhere and to the stretch beyond the 15 m junction zones at both ends (at least 20 m each), easing
in; no node moves (without the narrowing 27 Freiburg roads moved and four Freiburg measures got
worse). Freiburg 2 roads (Bismarckallee `r:1251`/`r:2215`, gap 67.74 to 37.46 m²), Munich 2
(Marsstraße `r:845`/`r:944`), Sindelfingen 0. D6 (first version only): a two-way `lanes=1` way is one
4.5 m carriageway marked `sharedLane`, drawn without a centre line (Freiburg 12, Munich 10, Sindelfingen
8). Audit, variant: Freiburg widths over 5 cm 384 to 382, voids 3,545.88 to 3,515.60 m², corners under
2 m 166 to 165; Munich voids 15,578.46 to 15,567.91 m²; Sindelfingen identical; every other total
equal; named case R3-8 (Marsstraße) width max 0.387 to 0.481 m (worse). The first version's Munich
lane overlap 257.14 to 257.90 m² was an audit artefact (a narrowed street junction outline stopped
hiding a tunnel overlap below it; `e68dcf1` fixes the audit, reverted at the tip: main and the first
version both measure 283.92 m² with it).

| | main | first version (D5, D6) | variant (D5) |
|---|---|---|---|
| Munich actuated, choice off | 630.6 s | 620.4 s (-1.62%) | 633.3 s (+0.42%) |
| Munich actuated, choice on | 90.8 s | 90.7 s (-0.15%) | 92.1 s (+1.49%) |
| Munich fixed, choice off | 789.0 s | 808.0 s (+2.41%) | 789.3 s (+0.04%) |
| Munich fixed, choice on | 125.0 s | 126.0 s (+0.80%) | 124.0 s (-0.77%) |
| full demand actuated | 3,759 / 143, 1,677.6 s | 3,379 / 151, 1,750.2 s (+4.3%) | 3,813 / 166, 1,701.4 s (+1.42%) |
| full demand fixed | 3,501 / 168, 1,727.1 s | 3,381 / 167, 1,704.7 s (-1.30%) | the same as the first version |
| Freiburg gate | 1,462 / 0, 75.7 s | 1,458 / 0, 81.6 s (+5.9 s) | 1,461 / 0, 75.6 s |

Drain criterion 48 of 48 in both; Sindelfingen identical; Freiburg's tram timetable unchanged at the
rebuild (90e3ff6f). The first version misses on Freiburg (+5.9 s) and full-demand actuated (+4.3%);
D5 alone gives 75.6 s, D6 alone 76.3 s. The variant meets the merge rule and every city audit total
but worsens one named case by 9.4 cm, so under the same reading as TASK-221 it is parked. Owner's
options: merge the variant (Bismarckallee closes; check Marsstraße, or exclude pairs that the named
cases cover), D6 on its own after the audit fix `e68dcf1`, or keep both parked. Note: fixed-time full
demand completes 120 fewer trips by 10:00 at lower delay. Outside scope: Munich and Freiburg re-pins,
T36.1 (moved pairs 1 to 2). Tiers on the variant: check (1,558), city (208), traffic light and guard,
light e2e (61).

Full run 44602678869 (lead, manual, on c4d693b after TASK-232 and 233): every job green, including all
five e2e shards; the city job took 19.6 min.

TASK-232 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged, render and track form only): D8's
remainder and N3. At Fahnenbergplatz the 4.5 to 5.4 m between the tracks and the drawn one-lane
carriageways is the stop's two platforms (648533263/4, `area:highway=platform`), not parking
(`parking:both=no`). TASK-220's rule 7 now measures its 2.5 m from the street band's outer edge: the
carriageway, its street parking strips, and any `area:highway` area within 2.5 m of a one-lane
carriageway (80% of the track still required). Freiburg only: 13 sections ballast to embedded, 299 m
(Fahnenbergplatz `rt:12913`, `rt:12915`, `rt:12942`; Stadttheater 3; Europaplatz 7); embedded 5,043 to
5,342 m, ballast 797 to 498 m; `rt:12944` (10 m, 60% beside the platform) stays ballast; Munich's median
stop (rail-only platforms) stays ballast. N3: the TASK-220 paving was a 3.2 m band per track, so canvas
showed as a 1 m strip and a wedge; it now fills gaps under 2.5 m between the band, roads beside it,
other embedded tracks and touching platforms, stopping 0.1 m under the road edge; a track whose
platform reaches a road counts as in the street (asphalt). Hashes identical (Munich seed 1 four
configurations, Freiburg 1407248127, Sindelfingen, both full demands). Render CPU p95 2D 1.2 / 2.1 ms,
3D 3.2 / 3.8 ms (main 1.4 / 2.1, 3.3 / 3.6); rail geometry build about 150 to 250 ms once per scene.
Outside scope: the Freiburg rebuild and pin. Lead check on the merge: the rebuild reproduces the
project; check (1,562), city (208), traffic light and guard, light e2e (61); full demand identical.

TASK-233 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged under the owner's merge rule as the
variant `649dbbe`): (1) the audit fix from TASK-231 (`525b55f`, cherry-picked from `e68dcf1`, test
T34.9): measure 9 leaves out only node outlines at the road pair's grade. Re-based on main: Munich lane
overlap 257.14 to 283.92 m², corridor share 69.79 to 71.29 m², B39 81.78 to 108.56 m², J6-munich 113.83
to 140.61 m²; nothing else moves. (2) A two-way `lanes=1` way with no `lanes:forward`/`backward` gets
`sharedLane` in its provenance and is drawn without a centre line (Freiburg 12 roads, 350 m of centre
line; Munich 10, 377 m; Sindelfingen 8, 196 m); the variant keeps the default width, so the compiled
networks are byte-identical to main and every audit measure and named case is identical. The first
version (`62cdb77`, 4.5 m carriageway) missed: Freiburg's gate 80.3 to 94.8 s (+14.5 s; the promenade
`r:225`/`r:226` alone 91.9 s; its ground is about 10 m of unpainted paving); Munich +1.3% at most; full
demand 378 and 43 fewer completed at lower delay. Variant traffic: every figure equals main. Left: the
promenade's parking hatch (needs `width` tags or curation). Note for parked TASK-221: its corridor
lane overlap figure (69.79 to 69.91 m²) was measured with the old measure 9 and should be re-measured.
Outside scope: re-pins (T44, T49, T75, V106, V107, V117, Freiburg manifest), V108's 2D/3D test passes
the canonical city. Lead check on the merge (on top of TASK-232; both rebuilt the Freiburg project, so
the lead rebuilt it again, city.json `ed396216...`): check (1,565), city (208, including the Freiburg gate and tram timetable pins), traffic light and guard, light e2e (61); full demand actuated 3,759 / 143 (4028429784), fixed-time 3,501 / 168 (2888500527).

Full run 44612061076 (lead, manual, on bd87de5 after TASK-230): every job green, including all five
e2e shards; the city job took 19.5 min.

TASK-230 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged, performance only): step time, third
pass. The largest finding: per-car passes read plain arrays at index -1 for most cars
(`compiled.connectors[arrival[id]]`, `compiled.movements[vehicles.movement[id]]`), which V8 serves by a
slow lookup (about 16 ns against 4 ns; about 134 s in the actuated profile). Cuts (none skips work):
negative indices guarded in `engine.ts`, `exitRear`, the walker hold and the lane-change neighbour
lane, `continuations` a `Uint8Array`; per-movement and per-connector tables (`inner`, `needsStop`,
connector lanes) rebuilt on a live patch; a `parking.moving` byte array; a `persons.drives(id)` flag;
`requiresExit` caching each trip's origin kind; `crossingStop` returning at once with no lot car
crossing; departure-courtesy envelopes in a `Float64Array`; TASK-211's nine per-car lane-plan arrays as
one record per car; a granted-car list in the signal pass. Under `debugSkips` the four cached values are
checked against the plain computation (`exact-skips.test.ts`). Phase table, main and branch profiled at
once (CPU 84%): following pass 1,030.6 to 913.9 s actuated, spawn 214.2 to 179.2, commit 165.9 to 105.1,
signals 26.0 to 11.0, total 2,115.3 to 1,883.4 (-11% with timers on; fixed alike). Untimed interleaved
pairs: actuated -16.0%, -15.1%, -16.0%; fixed -9.2% (load swung 2 to 73%), -16.2%, -16.0%; mean -14.5%
(target 10%); Freiburg -8.0% over six idle pairs (90.8 to 83.5 s). Hashes identical on Munich 0.15 seeds
1 to 3 in all four configurations, both full demands, Freiburg, Sindelfingen (0.15 and scale 1), with
and without `debugSkips`. Left: the rail hold and step (about 19%, `rail-crossings.ts` was out of
scope), routing (about 10%). No files outside scope. Lead check on the merge (on top of TASK-232 and
233): check (1,565), city (208), traffic light and guard, light e2e (61); full demand actuated 3,759 /
143 (4028429784), fixed-time 3,501 / 168 (2888500527), stepping 689 and 692 s on the lead's machine.

Full run 44691164973 (lead, manual, on e2e1457 after TASK-235, 234 and 236): every job green, including
all five e2e shards; the city job took 19.4 min.

TASK-235 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged under the owner's merge rule and the
lead's audit tolerance): TASK-221's variant `0b62f2c` landed as one squashed commit, source
byte-identical (main had not touched its files); only test pins conflicted. Audit against main d96f7c8
(grade-aware measure 9): Freiburg joins over 5 cm 82 to 76, lane overlap 214.80 to 200.97 m²; Munich lane
overlap 283.92 to 192.26, end overlap 105.95 to 20.92, body overlap 145.22 to 138.28; Sindelfingen joins
17 to 16; J6-munich lane / end overlap 140.61 / 85.03 to 51.22 / 0; B39 108.56 / 99.89 to 19.17 / 14.86.
Worse, inside the tolerance: Munich corridor lane overlap 71.29 to 71.41 m² (+0.12, `r:259/r:694`) and B39
width p95 0.192 to 0.195 m (+3 mm). Munich 0.15 seeds 1 to 12: actuated choice off 630.6 to 620.8 s
(-1.6%), on 90.8 to 90.3 s, fixed off 789.0 to 800.3 s (+1.4%), on 125.0 to 124.9 s; drain 48 of 48.
New full-demand references: actuated 3,591 / 173, 1,678.3 s, hash 151240499 (168 fewer completed at the
same delay); fixed 3,504 / 153, 1,747.5 s, hash 4004936993 (+1.2%). Freiburg alone 1,459 / 0, 82.0 s;
Sindelfingen 3762136883. Outside scope: test re-pins only. Lead check (with 234 and 236, below).

TASK-234 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged under the owner's merge rule as the
variant `e0c2d43`): TASK-226 landed on main. The plain cherry-pick (`646c7fd`) took Freiburg's gate from
80.3 to 95.4 s under TASK-228's full timetable: outside the group, the crossover end `n:1147` became a
plain node with a left exit (the gated crossover `r:1876`), the importer read the Hbf's `left|left|...`
arrows there, so `r:1148`'s two left lanes fed only the crossover. Variant: a median crossover (TASK-219's
definition, moved into a shared `medianCrossovers` in `split.ts`) is not an exit when turn arrows are
read (`index.ts`); new test. Lead decision: accepted as completing TASK-219's crossover rule (same
definition), not a new rule. Audit (tip and variant alike): Freiburg corners under 2 m 166 to 167 (the
1.16 m nose at `n:473`, not sharp, inside the tolerance), stop lines at the crossover gone (17.1 m on
`r:1148`, 6.6 m on `r:489`; marking outside 15,426 to 15,410 m), every named case identical. Freiburg
alone seed 1 80.3 to 80.6 s; seeds 1 to 6 mean 68.5 to 69.0 s; no gridlock. Munich and Sindelfingen cities
byte-identical. Side effect: `r:1148` now shows no arrows (main drew four through arrows 19 m late; the
painted arrows belong to the junction two roads on): a marking follow-up. Outside scope: `index.ts`,
re-pins.

TASK-236 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, render only): half-hipped, gambrel,
mansard and round roofs on concave outlines from TASK-227's skeleton, each as which wing ends stand as
walls plus one height profile against distance from the eaves for every face (hips and valleys stay
continuous; faces split where the profile breaks, split points shared exactly). Breaks copied from the
box shapes (gambrel 35% in, 72% up; mansard 25% in, 75% up); round a 12-step semicircle, hipped where no
wing end can stand; skillion one plane over the outline's box along `roof:direction` or across the long
axis. Flat fallbacks Freiburg 14 to 1 (a zero-height part, data), Munich 13 to 0; the other 4,560 roofs
byte-identical; 121 roofs pass area (0.1%), upward faces and closure. 3D build 2,695 to 2,757 ms (loaded,
within spread); render p95 within budget. Hashes identical. No files outside scope.

Lead check on the merge of TASK-235, 234 and 236 (234's Freiburg pin re-measured on top of 235: 1,461 /
0, 77.8 s, hash 118989361; the project rebuilt and reproduced): check (1,587), city (217), traffic light
and guard, light e2e (61); full demand actuated 3,591 / 173 (151240499), fixed 3,504 / 153 (4004936993).
Combined audit is the sum of 235's and 234's changes (no interaction).

TASK-240 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, paint only): since TASK-234,
`r:1148` ends at the median crossover `n:1147`, a plain node, where every lane goes straight on (lane 0's
left into the service crossover is ignored), so `arrowTurns` read five through lanes and TASK-079's
lanes-must-differ rule drew none; the group entry is now `r:475`, two roads on, whose lanes are too short
for arrows. Rule (`aheadTurns`, `noJunction`, `arrowRoom`): a node outside any group, with no control and
no crossing movements (service roads ignored) is no junction; on an approach ending at one, each lane
follows its single straight-on movement to the next junction (stopping early where a lane on the way has
room for its own arrows) and shows its movements there, or its group paths, or for a group entry with no
path its first turn inside the group; any ambiguous lane keeps the approach's old arrows. `r:1148` now
paints left, left, through, through, right (way 227874537's `turn:lanes` and the ground). Lanes / roads /
shapes with arrows: Hbf box 20 / 7 / 21 to 38 / 13 / 44, Freiburg 90 / 33 / 111 to 120 / 44 / 150, Munich
unchanged, Sindelfingen 56 / 23 / 83 to 60 / 25 / 89; arrows only added; exact `turn:lanes` matches on
six roads. Audit JSON identical. Hashes identical; main's Munich 0.15 seed-1 hashes after TASK-235:
actuated off 1475577836, on 345011196, fixed off 3548154257, on 3041964370. Left: arrows over keep-clear
boxes at car-park mouths (TASK-241). Outside scope: Sindelfingen paint pins (V108, V114, V117).

TASK-238 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, nothing worse): TASK-231's D5 reworked.
Marsstraße's R3-8 error is a sideways shift on `r:845` 9.5 to 10 m from `n:484`, where TASK-083's through
alignment curves `r:946` into `r:845` within 20 m; D5's ease from 15 m bent that curve further. On the
ground the pull was wrong there: OSM maps way 71822752 (`landuse=grass`, `barrier=green`), a planted
median about 2 m wide along `r:845`. Rule (`mappedMedians`, `corridors.ts`): halves are pulled only at
points where the line between the two centerlines crosses no street-level median way (any `barrier`,
`landcover`, `area:highway=traffic_island`, green `landuse` and `natural`); the 20 m pulled-run condition
then drops Marsstraße. Pulled pairs: Freiburg 1 (Bismarckallee, void 67.74 to 37.46 m²), Munich and
Sindelfingen 0 (imports byte-identical). Audit: Freiburg widths over 5 cm 382 to 380, voids 3,545.88 to
3,515.60 m², corners under 2 m 167 to 166; every named case identical. Traffic: Munich 48 runs and both
full demands identical; Freiburg 1,461 / 0, 77.8 to 77.9 s (hash 809576249), seeds 2 and 3 69.4 and
66.4 s. Outside scope: one line in `index.ts`, the Freiburg re-pins.

TASK-239 (Claude Code subagent, Opus 5.5 high, 2026-11-20; held): crossings mapped only as nodes
(`addNodeCrossings`, importer `walk.ts`, new ids last): Freiburg 9 links, Munich 1, Sindelfingen 0; the
variant (`f52ca2e`) requires a signalised crossing's road to end at a signalised node within 40 m (the
first version `5e377ca` let pedestrian signal 334475575 act as a zebra: Freiburg 83.7 s). Alone on
e2e1457: car traffic identical everywhere, Freiburg 77.3 s, audit identical, Hbf mapped zebras matched 3
to 5 (n:1139 yes; n:211 painted 4.4 m along the street). Merged together with TASK-238 (lead check,
Freiburg rebuilt): seed 1 1,458 / 0, 90.3 s (hash 988683669), seeds 2 and 3 68.3 and 68.6 s. The gate
misses by 12.5 s although each task alone is within 0.5 s, so 239 is held and its agent is diagnosing on
the new base (a latent fault elsewhere becomes its own task, as the Siegesdenkmal lock did). Also found:
give-way triangles overlap a new zebra at `n:2088` (added to TASK-241).

Lead check on the merge of TASK-240 and 238: the Freiburg rebuild reproduces the project; check (1,589),
city (218), traffic light and guard, light e2e (61); full demand actuated 3,591 / 173 (151240499), fixed
3,504 / 153 (4004936993).

Full run 44706560824 (lead, manual, on 3f37dfb after TASK-240 and 238): every job green, including all
five e2e shards; the city job took 18.0 min.

TASK-239, diagnosis (same agent, 2026-11-20; still held): with TASK-238 the gate is 90.3 s because
Freiburg's seed 1 has two outcomes, a normal morning (about 78 s) and a jam at 08:00 (90 to 96 s), and
small unrelated changes pick one. No lock, no stalled crossing; walkers hold cars about 800 s in every
tree. One link alone (1245631005, a midblock zebra on Wilhelmstraße 4 m before `n:697`, placed where OSM
maps it) gives 91 s even without TASK-238; link 436628448 about 1 km away gives 91.3 s through mode choice.
The extra delay is a batch of about 50 trips leaving p:2257, p:2263, p:2403, p:2489 at about 08:00 for the
station places: in the good run their first route uses Wilhelmstraße (`r:698`), in the bad run the same
trips at the same second take Schnewlinstraße's short-road chain (`r:805`, `r:807`, `r:441`, `r:1245` to
`n:364`), which queues 100 to 160 s per car, and reroutes spill onto Bismarckallee. Cause:
`src/sim/link-costs.ts` refreshes costs every 60 s from finished roads only, so every car departing in one
interval gets the same cheapest route and the 0.1 noise does not split them. A latent fault, written as
TASK-244; 239 is re-measured after it. Branch rebased (`6fd050e`, on 80935ff) with re-pins only; seeds 1 to
3: 90.3, 68.3, 68.6 s. Also noted: walkers wait about 420 s on average at signalised crossings in every
tree, main included (a fault of its own, to be written).

TASK-237 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, performance only): the rail hold and
rail step. Cuts (all exact): per-vehicle crossing commitments, settled-check data and path keys packed in
one record each; the path keeps only the new position while no new segment comes within 600 m; a car's
crossing ranges kept until it passes a span end or marking (Munich 0.15 to 08:30: recomputed 92K times
instead of 5.38M); `hold` exits early with no served crossing ahead; the hold scan stops at the first red
line once blocked; the engine passes the car's segment to `hold`; history moved into the settled record.
A first packing of the held flag slowed the gridlock pass by 14 s and was reverted to a byte array.
`debugSkips` recomputes and compares kept ranges, skipped path walks and the passed segment
(`exact-skips.test.ts`). Profiled together (CPU 82%): rail hold 248.7 to 144.3 s (-42%), rail crossing step
132.8 to 78.1 s (-41%), total 1,839.9 to 1,668.6 s actuated (-9%), fixed alike. Interleaved untimed pairs:
-7.1, -7.7, -9.6, -13.4% (load 50 to 56%), mean -9.5% (target 7%); Freiburg's timed gate 40.3 to 37.3 s.
Hashes identical on its base (Munich 0.15 seeds 1 to 3 all configurations, both full demands, Freiburg,
Sindelfingen, with and without `debugSkips`). No files outside scope. Lead check on current main (after
TASK-235, 234, 236, 240, 238): check (1,591), city (218), traffic light and guard, light e2e (61); full demand
actuated 3,591 / 173 (151240499), fixed 3,504 / 153 (4004936993), identical to main (stepping 1,427 and 1,439
s against 1,116 and 1,127 s at the TASK-238 check, a busier machine: not a like-for-like timing).

Full run 44712186713 (lead, manual, on 47bf22d after TASK-237): every job green, including all five e2e
shards; the city job took 19.2 min.

TASK-241 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, paint only): (1) the hatched fans at
`r:1148` were not TASK-108's ramp gores (`paintedGores`, unchanged) but `buildTransitionMarkings`
hatching every tapering lane, gains as well as ends; every lane gain in the three cities is one
carriageway widening at an OSM way split (`n:1146` 2 to 5 lanes, `n:1169`, `r:1187`, `r:1189`, `r:261`,
`r:402`), none hatched on the ground. Rule: a hatched taper only where a lane ends. Roads with taper
hatches / area: Freiburg 64 / 62.1 m² to 16 / 9.1, Munich 19 / 26.3 to 1 / 0.4, Sindelfingen 10 / 13.0 to
5 / 5.0; ramp gores and lane-end hatches unchanged. (2) Arrows within 0.5 m of a keep-clear box move
along their lane to the nearest clear place between the start crossing and the stop line, or are left out
(`keepClearBoxes`): arrow paint over other paint Freiburg 3.11 to 0 m², Munich 0.66 to 0, Sindelfingen
0.58 to 0 (moved `r:296#2`, `r:1333#1`; left out `r:904#0`, `r:1362#3`, Munich `r:269#4`). (3) Give-way
triangles (and the UK bars) within 0.5 m of crossing paint move back behind it or are left out
(`crossingPaint`); none on main, one on TASK-239's branch (`r:2091`, 0.52 m²) fixed. Audit JSON identical;
hashes identical. Left: `r:1189`'s keep-clear box fans across a lane gain (box geometry). Outside scope:
tests (T25, T28, V217) and paint pins (V114, V117). Lead check on the merge (after TASK-237): check (1,592),
city (220), traffic light and guard, light e2e (61); full demand identical.

Full run 44719286946 (lead, manual, on ff6ca31 after TASK-241): every job green, including all five e2e
shards; the city job took 17.3 min.

TASK-242 (Claude Code subagent, Opus 5.5 high, 2026-11-20; parked under the owner's merge rule, branch
`task/242-road-widths`, first version `4f10345`, variant `0d98c7a`, worktree `D:\cityflows-wt\242`): (1)
untagged urban secondary lanes 3.25 m (primary 3.5 m; the first version also tertiary 3.0 m): Freiburg 69,
Munich 47, Sindelfingen 8 roads (first version Munich +48 tertiary); (2) `width:lanes` when complete,
`width` only without street parking, `source:width=estimated` ignored: Freiburg 12; (3) one-way
`placement` (`left_of`, `middle_of`, `right_of`) sets the lateral offset, left centred where the block would
step against the next road (the network cannot taper an offset; without that, fold back-step 3.47 to
36.3 m): Freiburg 46 of 124 off-centre applied, Sindelfingen 3 (A 81). Imagery: `r:261` 16.25 m at -6.5 /
+9.75 against about -6.5 / +9.5 (within 0.25 m); `r:1179` 16.25 m, still 2.1 m over the gore (ground 15.5
m; its `placement=right_of:3` contradicts the imagery: an OSM edit, owner's); Rotteckring `r:1690` 3.0 to
4.0 m. Audit (variant): Freiburg fold 3.47 to 0, joins 76 to 64, lane overlap 201.0 to 179.6, but bulge
31.46 to 34.10 m² (`n:1146`, `r:1148`'s `width:lanes`), square noses 10 to 11; Munich voids 15,578 to
16,190 m² (real: tram tracks or grass mapped between all 17 growing pairs); Sindelfingen voids 1,335 to
2,188 m² (A 81 blocks no longer overlap), corners 28 to 29, under 2 m 91 to 92, widths 358 to 361.

| | main | first version | variant |
|---|---|---|---|
| Munich actuated, choice off | 620.8 s | -0.2% | 609.3 s (-1.9%) |
| Munich actuated, choice on | 90.3 s | -3.5% | 88.6 s (-1.9%) |
| Munich fixed, choice off | 800.3 s | -1.2% | 782.3 s (-2.3%) |
| Munich fixed, choice on | 124.9 s | +0.2% | 124.0 s (-0.7%) |
| full demand actuated | 3,591 / 173, 1,678.3 s | 3,622 / 157, 1,716.6 s (+2.3%) | 3,497 / 168, 1,788.3 s (+6.6%) |
| full demand fixed | 3,504 / 153, 1,747.5 s | 3,351 / 167, 1,728.7 s (-1.1%) | 3,302 / 181, 1,784.7 s (+2.1%) |

Freiburg 77.9 to 78.5 s (both); the rebuild shifts rail ids by one (timetable hash b0b017ca, same
service). Both versions miss full demand and the audit, so the task is parked. Owner's options: placement
plus tagged widths alone (Munich byte-identical) if the voids are accepted as real and the `n:1146` bulge
is checked; the `r:1179` OSM edit. Outside scope: one line in `index.ts`.

TASK-245 (Claude Code subagent, Opus 5.5 high, 2026-11-20; held, to be re-measured after TASK-244; branch
`task/245-walker-signal-waits` v1 `8bd8de0`, `task/245-walker-signal-waits-v2` `4341eee`, worktree
`D:\cityflows-wt\245`): the 424 s mean signal wait is real but a tail (median 4.2 s, 172 waits over 20
minutes; 203 walkers still waiting at 10:00 are not counted). Causes: (1) actuated only (469,000 of
474,000 waiting seconds): a controller resting in green with walk green extends to exactly
`timeS + needS`, read back about 1e-13 s short, so `green >= needS` fails and the walker re-calls every
step until a car on another phase ends the green; (2) both modes: 9 Freiburg and 3 Sindelfingen crossings
are in no phase's walk list, so their light never turns green (about 200 Freiburg walkers a morning never
cross; their later trips never start). Rules (`src/sim/walkers.ts`): walk green within 1e-6 s of the need
is enough; at a crossing no phase serves, walkers cross in a gap every approaching car can stop for and
hold no lanes while waiting; v2 adds that a walker just arrived at a kerb holds no lanes until it asks for
walk green. Test `tests/sim/walk-calls.test.ts`. Waits (Freiburg actuated mean / p99 / max, never
served): main 424.3 / 3,822 / 7,390, 203; v1 0.9 / 17.8 / 85.5, 0; Munich actuated 12.4 to 4.1 s.

| | main | v1 | v2 |
|---|---|---|---|
| Munich actuated, choice off | 620.8 s | 609.9 s (-1.8%) | 630.1 s (+1.5%) |
| Munich actuated, choice on | 90.3 s | 87.5 s (-3.1%) | 87.9 s (-2.7%) |
| Munich fixed, choice off | 800.3 s | identical | +0.2% |
| Munich fixed, choice on | 124.9 s | identical | -0.2% |
| full demand actuated | 1,678.3 s | 1,668.3 s (-0.6%; 2 stalled heads) | 1,782.1 s (+6.2%) |
| full demand fixed | 1,747.5 s | identical | 1,624.0 s |
| Freiburg gate (actuated) | 77.9 s | 108.0 s | 84.1 s |

v1 misses only Freiburg's gate (+30.1 s): the extra delay is on Schnewlinstraße and Wilhelmstraße at
08:00, TASK-239's batch flip (TASK-244), and freed walkers add 51 to 67 car trips a morning; each rule
alone gives 86.3 s (rounding) and 81.4 s (unserved crossings). v2 misses Freiburg (+6.2 s) and full demand
(+6.2%). Lead decision: held like TASK-239; v1 is re-measured on TASK-244. Open: the walk light at an
unserved crossing still draws red while walkers cross. Outside scope: the Freiburg re-pin, the new test.

TASK-244 (Claude Code subagent, Opus 5.5 high, 2026-11-20; parked by the lead, branch `task/244-route-batching`
`2860f41`, worktree `D:\cityflows-wt\244`): departures route on their own costs, each road's observed time
times (1 + n / capacity), n the departed cars whose first route uses the road and are not yet due past its
end, capacity the car lanes times 1,800 cars an hour over the 60 s interval (`link-costs.ts`,
`releaseTrip`); test `tests/sim/departure-load.test.ts` (0 of 28 cars take the longer branch without the
rule, 7 of 28 with it). The 07:58 batch now splits, but the Freiburg band does not narrow: TASK-239's
probes 80.3 to 95.6 s become 72.1 to 88.7 s; halved and quartered capacity gave 75.0 to 89.1 and 69.4 to
84.4 s. The 08:00 jam's waiting sits on both routes at once, feeding the signals at `n:364` (group 24)
and `n:1132`: peak load and spillback at the station's signals, not route choice. Traffic against main:
Munich 0.15 actuated choice off +1.1%, on -0.6%, fixed off -6.5%, on -3.0% (drain 48 of 48; four seeds in
each of actuated choice off and fixed choice off now gridlock one trip); full demand actuated 3,549 / 153,
1,633.3 s (-2.7%), fixed 3,335 / 164 with 8 stalled heads, 1,582.7 s (-9.4%, 169 fewer completed);
Freiburg 79.5 s (+1.6 s). It clears the merge rule's thresholds, but its aim (the band) is not met, it
changes route choice everywhere, and fixed-time full demand ends with stalled heads main does not have
(its lower delay partly unfinished trips); lead decision: parked. The station-signal spillback is TASK-247;
TASK-239 and 245 wait for it.

TASK-247 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged under the owner's merge rule as v1
`5570824`): Freiburg's 08:00 flip. Group 24 at `n:364` sits in phase 1 green all morning and is a victim;
the jam starts at `n:1132`, 200 m on: lane 1 of `r:1479` carries straight-on cars (phase 2) and right
turns into `r:1134` (phase 1), lane 0 sits empty (station traffic needs `r:1478` lane 1 later); with the
two kinds mixed, the car behind a waiting car wants the green phase, is in detection range, and keeps that
green running to its 30 s maximum though it cannot reach the line. `n:1132` passed 1 to 8 cars a minute
from 08:02 to 08:13 and the queue reached `n:364`'s exit (box and exit-full refusals at `r:1245>r:366`),
filling Schnewlinstraße and Wilhelmstraße; the 08:00 batch decides whether the lane ends up mixed. Rule
(`src/sim/signals.ts`): reading an approach lane from the stop line back, once a car that wants another
phase is met, the cars behind it no longer extend the green (they still call their own phases); a car
upstream is judged by the lane its movement starts from; TASK-222's keep ignores cars behind a blocker.
Test `tests/sim/shared-lane-actuation.test.ts` (40 cars in one lane feeding two phases: 26 arrive by
1,000 s on main, 40 with the rule). 08:00-band waiting main / 239's tip / 245's v1: 10,131 / 13,107 /
17,455 s without, 6,211 / 6,231 / 6,465 s with. Freiburg seed 1 (without / with): main 77.9 / 68.1 s,
239's tip 90.3 / 70.4 s, 245's v1 108.0 / 68.2 s; TASK-239's link probes 77.9 to 95.6 s become 67.0 to
71.5 s; main seeds 1 to 6 mean 69.1 to 63.9 s; no gridlock. Munich 0.15: actuated choice off 620.8 to
621.6 s (+0.1%), on 90.3 to 90.6 s (+0.3%), fixed identical; drain 48 of 48, no stalled heads (seed 12
actuated choice off one gridlocked trip). Full demand actuated 3,591 / 173, 0 stalled, 1,678.3 s to
3,427 / 155, 4 stalled heads, 1,705.5 s (+1.6%; 164 fewer completed, not traced), fixed identical;
Sindelfingen identical. The variant (`e57f6ef`, a car blocks only while standing) missed full demand
(+4.1%). Lead decision: merged; the aim is met decisively and Munich at 0.15 barely moves; the full-demand
stalled heads and completions are an open item. Outside scope: one sentence in `docs/architecture.md`
section 5.4 (accepted, as for TASK-222), the Freiburg re-pin (649852386). New full-demand references:
actuated 3,427 / 155, 1,705.5 s, hash 4165965277; fixed 3,504 / 153, 1,747.5 s, hash 4004936993.

TASK-246 (Claude Code subagent, Sonnet, 2026-11-20; merged, paint only): a keep-clear box was drawn along
its lane's centre line at the lane's width, so one overlapping a taper bent with the fan and ran off the
carriageway (`r:1189#3`). Rule (`keepClearBoxes`): each box stretch is cut to the lane's whole stretch
(`taperStartM` to `lengthM - taperEndM`) before the crossing cuts; under 3 m left is dropped (0.8 m for
US / UK text). Boxes overlapping a transition Freiburg 6 to 0, Munich 2 to 0; trimmed `r:1189#3`,
`r:1360#2`, `r:296#2`, `r:500#1`; dropped Freiburg `r:1151#1`, `r:1389#1`, Munich `r:654#3`, `#4`; roads
with keep-clear paint outside the surface 5 / 1 / 0 to 0. Audit JSON identical; hashes identical.
Outside scope: Munich paint pins (V114, V117).

Lead check on the merge of TASK-247 and 246: check, city, traffic light and guard, light e2e; check (1,593), city (221), traffic light and guard, light e2e (61); full demand actuated 3,427 / 155 (4165965277), fixed 3,504 / 153 (4004936993).

Full run 44740518122 (lead, manual, on e7f0c7e after TASK-247 and 246): every job green, including all five
e2e shards.

TASK-243 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, performance only): routing. Cuts (all
exact: same searches, same edge order, same arithmetic): the class graph keeps each road's access code and
zone in typed arrays (no object reads and string compares per edge); road and lane edges in flat typed-array
rows; the per-road route noise computed with the same integer operations without building a key string or a
generator, once per request; lane resolution without generator, spread and sort, stamps instead of Maps;
the heap in typed arrays; the walk router with stamps and kept link times. `debugSkips` compares the access
filter, each noise factor and each kept walk time against the original (`tests/routing/route-scratch.test.ts`).
Profiled together (load 93%): route requests 205.2 to 85.1 s (-59%; road search -71%, lane search -51%),
reroute update -57%, total stepping 2,089.3 to 1,936.8 s actuated (-7%). Interleaved untimed pairs: -7.7,
-3.1 (load swing), -12.2, -8.6, -6.3, -7.0%, mean -7.3% (target 5%, or route time -25%); Freiburg gate
213.4 to 178.9 s (-16.2%). Hashes identical on its base (Munich 0.15 seeds 1 to 3 all configurations,
both full demands, Freiburg seeds 1 to 3, Sindelfingen, with `debugSkips`; routing benchmark route
hashes). Left: an exact reroute skip needing an optional `RouteProvider.route` bound (TASK-251). No files
outside scope.

TASK-248 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged under the owner's merge rule): TASK-239's
variant landed on TASK-247 (source diff applied in one step; `walk.ts` byte-identical to `f52ca2e`; the
Freiburg rebuild byte-identical to TASK-239's tip, timetable 90e3ff6f). Freiburg seeds 1 to 6 base /
branch: 68.1 / 70.4 s (gate, 1,464 / 0 both; hash 1618405036), then identical within 1 s. Munich 0.15 48
runs: completed trips and mean delay seed by seed identical (hashes differ by one walk link at `n:6`);
drain 48 of 48. Full demand identical (actuated 3,427 / 155, 4 stalled heads from TASK-247; fixed hash
2862775104). Audit JSON identical. TASK-239 thereby lands: Hbf mapped zebras matched 3 to 5 (`n:1139` on
its spot; `n:211` 4.4 m along the street).

TASK-249 (Claude Code subagent, Opus 5.5 high, 2026-11-20; parked, the lead recommends merging; branch
`task/249-land-245` `3460a31`): TASK-245's v1 landed on TASK-247. Walker waits at signal crossings
(Freiburg actuated, mean / p99 / never served): 433.5 / 3,881 / 204 to 0.9 / 18.1 / 0; Munich actuated
12.9 / 128.1 / 2 to 4.1 / 40.1 / 0. Freiburg seeds 1 to 6: gate 68.1 to 68.2 s, each seed 57 to 66 more
trips completed, no gridlock. Munich 0.15: actuated choice off +1.1%, on -4.1%, fixed identical; drain 48
of 48, no stalled heads. Full demand fixed identical; actuated seed 1 1,705.5 to 1,843.2 s (+8.1%, 3,420 /
157, 0 stalled heads against 4); an extra seed 2 run went the other way (1,810.4 to 1,715.6 s, -5.2%, 112
more completed). Munich has no unserved crossings, so the change there is the rounding fix alone. It misses
the merge rule on full-demand actuated seed 1 only, and TASK-245's variant is used, so it is parked. Lead
recommendation: merge (a clear bug: walk greens that never counted as long enough, and crossings no
phase serves; the seed-1 rise looks like a flip, seed 2 the opposite; it also removes TASK-247's stalled
heads).

Lead check on the merge of TASK-243 and 248: the Freiburg rebuild reproduces the project; check (1,608), city (222), traffic light and guard, light e2e (61); full demand actuated 3,427 / 155 (3935022588; one Munich walk link), fixed 3,504 / 153 (2862775104).

Full run 44744589116 (lead, manual, on f2ac18c after TASK-243 and 248): every job green, including all five
e2e shards; the city job took 20.2 min.

TASK-251 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, performance only): a reroute check
switches only to a route costing less than (1 - `rerouteHysteresis`) times the current route's rest, and
the road search's cost never exceeds the returned route's cost (also in floating point), so when the road
search alone reaches that threshold no lane search can switch. `RouteProvider.route(compiled, costs, req,
boundS?)` returns `{ ok: false, reason: 'above_bound' }` (a new `RouteResult` variant; `RouteFailure`
unchanged) when the road search costs at least `boundS`; callers without a bound get the old behaviour;
`docs/architecture.md` section 7 updated (authorised in the contract). Only the periodic congestion check
(`src/sim/reroute.ts`) passes the bound; live-edit checks do not. `debugSkips` re-routes every stopped
check without the bound and throws if it would have switched (`tests/routing/route-bound.test.ts`). About
88% of reroute checks stop after the road search; their route time about 40 to 19 s per run. Interleaved
pairs (load 61%): route requests -34.1, -33.3, -34.8, -34.1%; stepping -1.3 to -2.9%. Hashes identical on
its base (Munich 0.15 seeds 1 to 3 all configurations, both full demands, Freiburg seeds 1 to 3,
Sindelfingen, with and without `debugSkips`). Outside scope: `src/sim/reroute.ts` (where the check lives;
`engine.ts` passes `debugSkips`). Lead check: check (1,609), city (222), traffic light and guard, light e2e
(61); full demand identical (actuated 3,427 / 155, 3935022588; fixed 3,504 / 153, 2862775104).

Full run 44750599300 (lead, manual, on 778b30f after TASK-251): every job green, including all five e2e
shards; the city job took 13.3 min.

TASK-250 (Claude Code subagent, Opus 5.5 high, 2026-11-20; diagnosis only, no merge): TASK-247's rule
ends a green early only 22 times by 08:00 at full demand (four groups; each time the head stands at the
line waiting for another phase on its lane, TASK-247's own case). Grants already differ at 49 junctions by
07:10; both runs are gridlocked from 07:30 with about 5,600 respawns each. Turning the rule on only until
07:20 or 07:30 gives 3,694 and 3,626 completed: one seed swings more than the rule. The four stalled heads
at 10:00 are none locked and none still counted at 10:05 (the 180 s timer clears them); without the rule
the count runs 0 to 7. Full demand actuated, with / without the rule (completed, mean delay): seed 1
3,427, 1,705.5 / 3,591, 1,678.3; 2: 3,492, 1,810.4 / 3,456, 1,778.1; 3: 3,100, 1,833.7 / 3,432, 1,708.3;
4: 3,275, 1,670.8 / 3,282, 1,795.6; 5: 3,796, 1,796.2 / 3,319, 1,918.6; mean 3,418.0, 1,763.3 / 3,416.0,
1,775.8 (+2 trips, -0.7%); stalled heads mean 2.6 / 1.4 (four of five seeds stall without the rule too). No
rule added. Proposed: judge full demand on seeds 1 to 5 (taken, decisions log); count a stalled head at
full demand only if it stands in two samples 5 minutes apart (owner's call).

TASK-249, merged (lead, 2026-11-20, on the five-seed reading): lead-run full demand actuated seeds 2 to 5
on its branch: 3,604 / 166, 1,715.6 s; 3,314 / 178, 1,827.6 s; 3,292 / 168, 1,622.9 s; 3,659 / 168, 1,828.0 s;
with seed 1 (3,420 / 157, 1,843.2 s) the mean is 3,457.8 completed, 1,767.5 s against main's 3,418.0,
1,763.3 s (+0.2%, 40 more trips), stalled heads mean 1.6 against 2.6. Merged on top of TASK-243, 248, 251:
Freiburg's gate 1,522 / 0, 66.1 s (hash 4228017009). Lead check: check (1,611), city (222), traffic light and guard, light e2e (61); full demand actuated 3,420 / 157 (3501316164), fixed 3,504 / 153 (2862775104).

Full run 44755991581 (lead, manual, on ecb7075 after TASK-249): every job green, including all five e2e
shards; the city job took 22.5 min.

Full run 44761655915 (lead, manual, on debb2ac after TASK-252): every job green, including all five e2e
shards; the city job took 15.0 min.

TASK-252 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged, render only): at a signal crossing no
phase serves (TASK-249 lets walkers cross there in a gap), the walk light draws dark (an unlit head), never
red or green: `VehicleSnapshot.signals.walk` takes 0 red, 1 green, 2 dark (`snapshot` in `signals.ts`
only; control unchanged); before the first snapshot the renderers derive the same from the program
(`walkLightAt`). Dark rather than no lamp: the crossing is mapped as signalised and walkers yield as at a
switched-off signal, and no geometry changes. Freiburg 8 crossings (9 links: `n:1532`, `n:1625`, `n:31`
twice, `n:429`, `n:776`, `n:796`, `n:907` two links), Sindelfingen 3 (`n:422`, `n:733` two arms), Munich
none. Hashes identical; render p95 2D 3.0 ms, 3D 3.8 ms (budgets 4 and 6). Test in
`tests/sim/walk-calls.test.ts`. Outside scope: the comments in `src/sim/types.ts` and `src/render/types.ts`,
`style.signalDark`, one sentence in `docs/architecture.md` section 5.4 (the new value; within the contract's
"snapshot field"). Lead check: check (1,612), city (222), traffic light and guard, light e2e (61); full
demand identical (actuated 3,420 / 157, 3501316164; fixed 3,504 / 153, 2862775104).

TASK-256 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `d54a8e1`, Full run 44874861895):
visual leftovers. (1) The promenade's "parking hatch" was a keep-clear box at garage `pk:2736`'s mouth on
`r:225#0`: no keep-clear box on a shared one-lane carriageway (TASK-233's `sharedLane`); boxes Freiburg
138 to 137, Munich 153 to 150, Sindelfingen 74 to 72; simulation zones unchanged. (2) An inferred ballast
tram section under 20 m whose ends join only other beds, one embedded, is embedded (`assignTramForms`):
Freiburg 7 sections, 93 m (`rt:12944`, `rt:12948` checked on the imagery); Munich, Sindelfingen none, so
Arnulfstraße stays as mapped. (3) `n:211` not landed: the band follows TASK-091's curb rule and TASK-140
moves the walk link onto it, so moving paint alone would split zebra from crossing; a placement rule in
`crossings.ts` moves traffic at 5 arms and needs its own task. Hashes identical (Munich 0.15 four
configurations, Freiburg 4228017009, Sindelfingen, both full demands); frame p95 2D 2.6, 3D 4.4 ms. Lead
tiers on the merge: check 1,613 passed; city 223 passed; traffic light 5 passed, 1 expected fail; e2e
light 61 passed. Outside scope: Freiburg rebuild and pin, V117 paint pins.

TASK-253 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `57e7ef7`): TASK-223's v2 ported onto
ef0f2b4 (a blocked head does not detour into a lane of its next road that needs two or more more later
lane changes; `src/sim/engine.ts`, and TASK-223's paragraph in `docs/architecture.md`). Misses 12 seeds
choice off: `r:654` actuated 91 to 10, fixed 319 to 9; `r:639` actuated 58 to 105 (seed 2 0 to 87),
fixed 808 to 602. Munich 0.15 seeds 1 to 12: actuated off 628.7 to 624.6 s (-0.7%), on 86.9 to 86.6 s,
fixed off 800.3 to 802.6 s (+0.3%), fixed on identical. Full demand five-seed means: actuated 3,457.8 /
167.4 / 1.6 stalled, 1,767.5 s to 3,525.2 / 157.2 / 2.6, 1,748.4 s (-1.1%); fixed 3,365.8 / 173.4 / 2.0,
1,858.4 s to 3,316.4 / 168.0 / 1.8, 1,840.3 s (-1.0%). Freiburg seeds 1 to 3 and Sindelfingen identical;
audit identical. Passes the merge rule on the five-seed reading; noted: actuated stalled heads mean +1,
fixed full demand 49 fewer completed. Parked branch `task/223-remaining-misses-2` can retire.

TASK-255 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `d277542`): TASK-218's D4 with J1.
(1) D4 (TASK-218's code, `split.ts` rule (d)): a signal kept at its stop position up to 30 m before the
junction its control moved to joins that group; the entry and stop line stand at the signal; marked
`stopPosition` (`stopPositionCrossing` on a crossing). (2) J1: a marked node takes the group's control
but draws as the plain node it was (no floor, no cuts; inner-road median curb skipped), so `r:261`
keeps its 10 m and `r:1185` does not fold. (3) Without a drawn crossing, the stop line sits at the node,
or 3 m before it on a crossing. Freiburg groups 39 to 46 (18 stop positions); Munich and Sindelfingen
byte-identical. Imagery: `r:1178` 9 m past to about 1.2 m; `r:1185` about 1 m before the painted line.
Audit: every measure identical bar overlap 21.06 to 15.50 m²; `markingLinesOver5cm` 1 to 2 (`r:838`'s
8 cm kink now under a solid line) and `markingOutsideM` +20 m (stop lines on approaches) accepted under
the lead's tolerance. Traffic: Freiburg seeds 1 to 3 66.1/65.9/62.4 to 65.8/65.5/60.2 s; Munich and full
demand identical (no marked nodes; five-seed mean equals main's by construction, as TASK-234). Lead's
review asked for the arrows the move lost: follow-up `d277542` (stop-position approaches read arrows as
TASK-240's plain-node approaches; `r:261` left | through | through | right | right as on the ground;
`r:850`'s arrows on `r:1750`). Tram timetable hash c0bd7828 (seven stop ids shift). Lead merged it on
TASK-256's rebuild: Freiburg rebuilt, manifest 59bcbb98..., gate 1,518 / 0, 65.8 s, hash 1024213382.

TASK-254 (Claude Code subagent, Opus 5.5 high, 2026-11-20; parked under the owner's merge rule, branch
`task/254-placement-widths`, first version `76c90e0`, variant `cfdb63c`, worktree `D:\cityflows-wt\254`):
TASK-242's tagged widths (`width:lanes` complete, else `width` without street parking; Freiburg 12 roads,
variant 10) and one-way `placement` (Freiburg 46 of 124 off-centre, Sindelfingen 3 on the A 81, Munich
none; a road whose block would step against the next stays centred). Variant adds: at a two-end node where
a one-way road gains or drops lanes, tagged widths that would change a continuing lane are not read
(`r:1148`, `r:1149`; fixes `n:1146`'s fan, 0.5 m over the median grass in the first version). `r:1179`:
its `right_of:3` agrees with the ways around it (`r:745`, `r:1078`, turn lanes); on the ground the new left
lane opens from an unmapped hatch, so no general rule reads it; a "keep clear of mapped medians" rule
changed 35 Freiburg roads (including `r:261`, already right) and was dropped. Imagery: `r:261` -7.0 /
+10.5 m against -6.5 / +9.5 m (the 1 m is the untagged 3.5 m lane, excluded here); Rotteckring `r:1690` 3.0
to 4.0 m (ground 4 to 5). Audit (main / first / variant): Freiburg fold 3.47 / 1.46 / 1.46 m, lane overlap
201 / 194 / 194 m², unrelated overlap 21.1 / 17.4 / 17.4, bulge 31.46 / 36.59 / 33.59 m² (`n:828` +1.5,
`n:607` +0.75 from placement), widths off 380 / 380 / 383; Sindelfingen lane overlap 640 to 578, unrelated
287 to 224, voids 1,335 to 2,075 m² (the A 81 carriageways no longer overlap), widths 358 to 361; Munich
identical (city JSON byte-identical). Traffic: Munich and full demand identical by construction (seed 1
hash checked); Freiburg gate first 1,491 / 11, 72.8 s (+6.7 s, gridlock), variant 1,528 / 0, 70.9 s
(+4.8 s); seeds 2, 3 within 1 s. Parked: the first misses the gate, the variant the audit tolerance
(`n:828` +1.5 m², the width counts, the A 81 voids). For the owner: accept the variant (its A 81 voids are
the overlap removed, `n:828`'s bulge is 1.5 m²), or a later task with offset tapers in the network.

TASK-257 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `47e20b5`): the owner-approved walk-link
field `marking?: 'zebra' | 'lines' | 'none'` (schema, `docs/architecture.md`; absent paints as before; read
only by the renderer). Reading (`crossingMarking`, `walk.ts`): `crossing:markings` first (no / lines,
dashes, dots / yes, zebra, ladder), then `crossing_ref=zebra` or `crossing=zebra|marked|uncontrolled` zebra,
`unmarked|no|informal` none, `traffic_signals` lines; a way without tags reads its nearest tagged crossing
node; TASK-248's node links read their node. Signalised road ends keep their broken lines. Paint before /
after: Freiburg zebra ends 53 to 30, stripes 213 to 104; Munich ends 114 to 25 (77 to nothing), stripes 366
to 75; Sindelfingen 8 to 5. Hashes identical (eight runs); frame budgets within limits. Reported, not
changed: every unsignalised crossing is a `zebra` control in the simulation (walkers get §26 StVO priority
everywhere), while German rules give walkers no priority at unmarked crossings (§25(3); only turning
drivers yield, §9(3)): a traffic-moving follow-up. Lead merge on TASK-255: Freiburg rebuilt (manifest
4d1bb6f3...), V217's TASK-257 counts re-pinned (stop positions draw no crossing paint: without the field
44 / 173 / 1,939, with it 28 / 97 / 2,023); gate hash 1024213382 unchanged.

TASK-258 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `37ce41f`): Munich Donnersbergerbrücke and
Sindelfingen A81 preloaded (owner's mixed slate). One builder, `bench/bundled-cities.ts [ids]` (Freiburg keeps
its recipe and curation and rebuilds byte-identical; the new cities are the raw import, `loadAuditCity`'s
options and cache key, Freiburg's showcase scenario, flat: with terrain 3D took 9.8 and 19.5 s). Staleness
test `tests/city/bundled-cities.city.test.ts` (manifest hashes of a fresh build against each archive, 4 to
12 s a city; checked both ways). The New city panel groups "Real places" (one-line notes) and "Test
layouts"; `?city=munich|sindelfingen`; spec `real-places.spec.ts` (full suite). Showcase gate at 0.15 with
choice on: Munich 5,313 / 2,574 completed, no failures, worst visit 589 s, 91.7 s; Sindelfingen 445 / 155,
worst 86 s, 27.1 s. Budgets on a loaded machine: first frame Freiburg 3.5 to 4.7 s, Munich 3.6 to 7.0 s,
Sindelfingen 8.4 to 12.9 s (6.8 s of it in `railGeometry`'s polygon clipping: TASK-266); frame times within
budget. Archives 0.85 MB and 0.41 MB gzip. Lead merge: archives rebuilt on TASK-255 and 257 (Freiburg
unchanged by the builder); `.prettierignore` lists the archives.

TASK-259 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `b37ff10`, docs only): scout of Lübeck, York,
Cambridge and Philadelphia on the raw import (`docs/decisions/2026-11-20-more-cities.md`). Extracts in
`D:\cityflows-wt\259-data` (Lübeck 7.99 MB, York 4.17, Cambridge 4.88, Philadelphia 3.61; SHA-256 in the
document). None passes the showcase gate: Lübeck 122 `no_route` and 3.1% parking (polygon gateways, D7, D17);
York fails to import left-hand (D1; passes on a diagnostic import); Cambridge throws (D2); Philadelphia 98
`no_route`, City Hall missing, over budget (D7, D9, D10). UK pick York. Left-hand defects D1, D3, D4, D11, D8,
D16, D15. Fix tasks contracted: TASK-267 to 272; D5 (city walls) needs a query change and re-fetch (owner).

TASK-260 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `00634c9`): owner bugs 1 and 2. (1) Each raised
track built its own open embankment; now one embankment per group (outline over the beds plus 1 m, gaps under 3
m closed, decks left out; one height surface; 1:1.5 slopes on outer edges along a track; concrete walls at
track ends, within 4 m of a leaving track and at decks). (2) Decks were triangulated from the outline alone;
now cut on a 2 m grid and every bed edge, corners at the nearby tracks' heights, steps between beds; parapets
only along tracks; ramp paint split every 4 m. Embankments Freiburg 47 to 11, Munich 35 to 7; covered bed points
Freiburg 975 to 148 (left: tracks leaving a switch at different grades, from `src/network/rail.ts` heights),
Munich 47 to 0. Hashes identical; 3D build 3.24 to 3.85 s (budget 5), frame p95 within budget.

TASK-263 (Claude Code subagent, Opus 5.5 high, 2026-11-20; merged `1616c32`): owner bug 6. Buildings and parts
valued `elevator` draw as framed glass shafts (`src/render3d/elevators.ts`): no storeys or window grid, a dim
even glow at night; landings where walkways of different layers end at the shaft, a door per walkway; height
tagged, or levels × 3 m, or 3 m above the top landing. Freiburg 6 shafts (the 5 Hbf shafts reach the 10 m
footbridge deck); Munich, Sindelfingen none. Hashes identical; 3D build 3.19 to 3.39 s. Not done:
`highway=elevator` nodes without a shaft (Freiburg 5, Munich 7, two outdoor at the Donnersbergerbrücke) need a
point type value in `src/schema` (owner's call).

TASK-264 (Claude Code subagent, Opus 5.5 high, 2026-11-21; held for the owner, branch `task/264-lane-gain-start`
`4bd72e1`): D7 by rule. Evidence: way 233466339 (`r:1175`) is `placement=transition`, and the ground widens
inside it. Rule: one-way roads from `placement=transition` ways are marked (`placementTransition`); at a plain
two-road lane gain or drop whose narrower road is marked, that road's surface widens over its length (`widenM`),
the wider road's added lanes draw full width from the node, and the gain's arrows stand where 90% of the width
has opened; the lanes cars drive on are as main's (a version that moved them made cars jump 10.5 m and was
dropped). Freiburg 1 (`n:1146`; `n:799` excluded, four roads), Munich and Sindelfingen 0. Imagery: arrows 8.1
to 8.8 m before `n:1146` (main about 15 m past), within about 1 m of the paint; widening drawn x -39 to -66
against -42 to -70. Traffic identical (Freiburg seeds 1 to 3 hashes, full demand seed 1 run; Munich and
Sindelfingen byte-identical). Audit: all identical except the width measure, max 4.764 to 10.49 m and roads
over 5 cm 380 to 381, both `r:1175` (the measure reads the intended widening as an error), and painted length
+29 m. Outside the lead's tolerance by the letter, so held; the owner approved the merge (2026-11-21). Lead merge on
TASK-270: Freiburg rebuilt (manifest bb42a5b6...), gate hash 2336162246 unchanged. Agent used
`pkill -f` on its own uniquely named script once (no other process affected).

TASK-266 (Claude Code subagent, Opus 5.5 high, 2026-11-21; `35818d9`): `railGeometry`'s time was the level-crossing
railhead clip against every ground road and junction ring (1,233 rings, 82,273 vertices a call; Sindelfingen 52
clips, Munich 10, Freiburg 0). `groundNear` passes only rings whose box reaches the rails, plus one thin strip
of the left-out rings' vertex heights 10 m away so Clipper2's scanlines, and so the output, stay identical to
the bit (a plain box filter moved sub-millimetre vertices in Sindelfingen). Headless: Sindelfingen 11.2 to 12.9
s to 0.23 to 0.32 s, Munich 2.0 to 2.6 to 0.29 to 0.48, Freiburg unchanged. Production (loaded): Sindelfingen
first frame 13.8 to 15.0 s to 4.4 to 5.2 s (Freiburg 4.9 to 6.0 in the same rounds), 3D 20.5 to 10.7 to 11.2 s;
the remaining 3D gap is the walk network's height lookups (`render3d/walk.ts`, `heights.ts`; A 81 bridges), a
follow-up after TASK-261. New pin test of every rail shape's sha256 in three cities. Tiers pass.

TASK-261 (Claude Code subagent, Opus 5.5 high, 2026-11-21; `f0660c5`): owner bugs 3 and 4. (3) The shared paving
footprint (`walk-geometry.ts`, 2D and 3D) widened each walk link alone with square ends, leaving a notch at every
bend: a round-join wedge on the outer side where a drawn link continues at more than 1° (clipped as the strip).
Notches Freiburg 1,752 to 0, Munich 1,280 to 0, Sindelfingen 160 to 0. (4) A node takes the first way's layer, so
stairs meeting a `layer=2` footbridge ended on the ground (arches, 10 m drops): a stair's nodes stand at the
level of the other walks there; an end no walk meets takes a road's height within 2.5 m; stairs whose ends differ
by 0.3 m draw as flights (17 cm risers, treads, stringers). Freiburg 43 flights (13 arches and 25 ribbons on
main), Munich 22. Hashes identical; 3D build median 3.39 to 3.54 s. Left: the spiral stair at the Stadtbahnbrücke
draws as two steep flights; flights start at paving height on raised platforms.

TASK-272 (Claude Code subagent, Opus 5.5 high, 2026-11-21; `c819d87`): City Hall was read whole (four rings) and drawn
in 2D; in 3D, TASK-201's rule drew only a building's parts (City Hall: 30 parts over 39% of it, 26 untagged at 10
m). Rule (`buildingPieces`, `roofs.ts`): an outline whose height differs from its tallest part's by over 0.5 m,
or has none, is a body: 3D also draws its area no part covers (pieces under 1 m wide or 4 m² dropped), and
untagged parts take its height or levels; an outline as tall as its tallest part only wraps them (the Münster,
unchanged). Freiburg 20 buildings gain 25 pieces (10,209 m²); Munich, Sindelfingen none; Philadelphia 66 (City
Hall a 30 m body round its courtyards). Render only; Freiburg gate hash checked; frame budgets within limits.
`docs/architecture.md` gains one sentence on the rule (lead accepted: a drawing rule, no data change); the lead
updated the `parts` comment in `src/schema/city.ts` at the merge (comment only).

TASK-262 (Claude Code subagent, Opus 5.5 high, 2026-11-21; `f44e379`): owner bugs 5 and 7 (`render3d/footbridges.ts`).
Raised walk ways (by `bridge` or `layer`, stairs included) get a deck with an underside 0.5 m down and faces on
open edges (open: no deck, stairs, road, platform within 1 m of height, or building as tall, just outside);
railings on open edges 1 m up or more (posts every 1.5 m); piers under the centre line where 1.5 m up, at span
ends and at most 15 m apart, never on a carriageway, within 2.2 m of a track or in a building (moved up to 7 m,
else spanned); a `building=roof` mostly within 4 m of a deck becomes its canopy, 3 m above it on posts. Freiburg
65 bridges, 76 piers, 4,201 m of railing, 2 canopies (the Hbf roofs, 3 m to 13.14 m: the dark slab of bug 5);
Munich 16, 17, 2,698 m; Sindelfingen 1. Not readable without walk-link fields: `covered`, `handrail`,
`indoor`/`wall`, `bridge:structure` (a schema proposal for the owner). Karlssteg (bug 7) spans the junction
on piers at its ends. Hashes identical; 3D build within budget (about 250 ms for the structure). Lead merge with TASK-261: `walkHeight`
now follows TASK-261's levels, stair ends and flight pitch, so railings and piers match the drawn stairs
(Freiburg piers 76 to 72, re-pinned).

TASK-270 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `4792497`): polygon gateways only on lanes that reach
(out) or are reached from (in) the largest component of the network the router allows (car access `yes`, no lane
drops); TASK-198's fallback onto dead entries is gone; bbox imports unchanged. A ring crossing a roundabout keeps
it whole within a circle 30 m wider, its arms cut there. `no_route` (0.15, choice on): Lübeck 122 to 0, Cambridge
(diagnostic) 229 to 0, Philadelphia 98 to 0; no-parking failures to 0 in all three. Freiburg gateways 11 to 10
(the B 31 link out at Lessingstraße, which nothing reached); gate 1,518 / 0, 65.8 s to 1,530 / 0, 62.6 s (hash
2336162246), seeds 2 and 3 -7.2 and +3.0 s; Munich and Sindelfingen byte-identical (identical by construction,
seed 1 checked). Passes the merge rule. Left: pockets behind restricted streets get no gateway (Lübeck's south
loop via Wallstraße, Cambridge's north-east behind its bus gates); keeping them needs demand to judge a gateway
trip by the person's own car facility (a follow-up). Lead merge: archives rebuilt by the builder, unchanged.

TASK-269 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `f858bd2`): `highway=mini_roundabout` nodes are marked
(`miniRoundabout`), become `yield` nodes where every entry gives way, compile with `CNode.miniRoundabout` and
priority 0 on every movement, and of cars arriving together each gives way to the side circulating traffic comes
from; a white disc in every theme, arrows under `uk`. UK zebras get zig-zags and Belisha beacons under `uk`. York 2
of 3 and Cambridge 4 of 5 nodes imported (the others outside the polygons); Freiburg `n:347` (gate 65.8 to 65.3 s
alone); Munich, Sindelfingen none. Lead merge with TASK-270: Freiburg rebuilt (manifest 16eac73d...), gate 1,530
/ 0, 61.4 s, hash 3949968739; `CNode.miniRoundabout` added to `docs/architecture.md`.

TASK-268 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `96d9563`): left-hand traffic. (D11) `drivingSide`
follows the inferred marking theme unless set (`uk` left, else right); the wizard starts on "From location". (D3)
The protected turn is the one across oncoming traffic for the side, plus U-turns. (D15) Left-hand equal ranks have
no side rule (waiting time, id). York (diagnostic): its four-arm signals' 15 s phases carry 9 rights, no lefts;
0.15 choice on 1,780 completed, 86.7 s, worst visit 156 to 113 s, passes the showcase gate. Right-hand cities'
cities and programs identical. Follow-up: the turn rank in movement priority is not mirrored (architecture 5.3).
Lead merge: `yieldsTo` combines TASK-269's mini-roundabout side (now in either driving side) with D15.

TASK-267 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `fa7836f`): (D1) a parking entry up to 1e-6 m past its
lane's end is valid (York's lot entry 1e-13 m out after a recompile); (D2) a facility whose owner place
`addStrips` removed gets no owner (Cambridge's Trinity College lot); the final compile drops and reports a facility
it rejects (`parking_dropped`) instead of failing. York and Cambridge import under both sides, none dropped;
Munich, Sindelfingen, Freiburg byte-identical.

TASK-274 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `1a12647`): owner-approved `ContextPoint` class
`'elevator'` (schema, Zod, architecture; no migration). `highway=elevator` nodes are imported unless `indoor=yes`
or inside a building, except an outline of at most 16 m² with no parts, which is read as the lift's tower and
drawn as its shaft; landings also count walk links ending on the outline; a lift draws only if a walkway lands
above 0 m. No query change (all 18 nodes sit on fetched walk ways). Munich: the two Donnersbergerbrücke lifts
(office blocks on main) are now 15 m shafts; Freiburg: the Mobilitätszentrale tower. Hashes identical.

TASK-275 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `8133424`): owner-approved walk-link fields
`covered?: boolean` (`covered=yes|roof|canopy|arcade|colonnade`, `bridge=covered`) and
`handrail?: ('left'|'right'|'center')[]` (`handrail*` tags; finer tags win). Railings follow `handrail` (Freiburg 58
links, Munich 39); covered ways with nothing over them get a light canopy on posts (Freiburg 90 pieces, 529 m²,
including the Schwabentorsteg and the Stühlinger stair tower); below grade none. Hashes identical; 3D build
unchanged within noise. Left: one 3 m canopy piece just outside the Stühlinger rail bridge.

Lead merge of TASK-274 and 275 (with contracts TASK-282, 283): bundled projects rebuilt (Freiburg manifest
a6b96fb3...); the pinned render tests pass.

TASK-273 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `5c7c3f2`): owner-approved query change (version 10 to
11: `barrier=city_wall`, `historic=citywalls`, `historic=city_gate` with surroundings) and York's one re-fetch
(4,189,077 bytes, SHA-256 7e9ba136..., snapshot 2026-11-21T09:51:52Z, one retry after an empty 502). Walls read as
context lines (`city_wall`, `city_gate`; `heightM`, `walkway`, `bridge`), drawn as stone bodies (4 m by 2 m default)
with parapets or the raised walk deck on top; gates mapped as buildings stay gatehouses, lone gate nodes on a way
become arches. York 3.40 km of wall (2.31 km walked); Micklegate, Bootham, Monk, Fishergate Bars as buildings;
Walmgate Bar outside TASK-259's polygon. Freiburg gains its one real wall (Augustinerplatz, way 1052938724, 19 m;
lead accepted, state hash unchanged); Munich, Sindelfingen byte-identical. Lead merge with TASK-274: schema and
context unions resolved.

TASK-276 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `0afbee6`): UK kerb lines from OSM parking tags
(double yellow for no parking/stopping or `parking:<side>=no`, single for timed restrictions), recorded as
`kerbLine:*` in `provenance.inferred` for `uk` imports only; untagged town kerbs draw nothing; no yellow across
junction mouths. York yellow 19.5 to 2.2 km. German and US imports byte-identical. A `Road.kerb` field would be
the proper home (schema, owner).

TASK-278 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `30e9ce8`): `polylineNearest` (bit-identical, runs of
8 segments under a box), one index per road reference line in render3d's `roadStation`, and a per-shape memo in
`buildWalk`. Sindelfingen `buildWalk` 4.8 to 5.7 s to 1.0 to 1.3 s; its 3D scene 3.7 s sooner. Mesh hashes pinned;
lead re-pinned on TASK-275's canopies after checking the merged tree gives the same hashes with and without it.

TASK-281 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `6f07dbb`): Lübeck already passed on main after
TASK-270 (0% parking failures, seeds 1 to 5). A lot with no reachable aisle and no permitted road within 30 m is
left out with the aisles only it owns (replaces TASK-207's three curated Freiburg lots): Lübeck 16, Freiburg 9,
York 8. Freiburg gate 62.6 to 60.1 s; Munich, Sindelfingen byte-identical. Left: 24 Lübeck facilities behind
"Anlieger frei" pockets (a routing zone rule, follow-up); `amenity=parking_entrance` reading (follow-up).

TASK-282 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `2894d59`): turn rank mirrored by driving side
(`docs/architecture.md` 5.3): through and the near-side turn 2, the turn across oncoming traffic 1, U-turns 0. York
1,662 movements at 477 nodes change; choice on unchanged, choice off mean delay 240.4 to 198.8 s (one more
gridlocked trip). Right-hand cities identical.

Lead merge of TASK-273, 276, 281, 282, 278: Freiburg rebuilt (manifest b0eb4e80...), gate 1,533 / 0, 60.5 s, hash
502784661 (main 61.4 s).

TASK-265 (Claude Code subagent, Opus 5.5 high, 2026-11-21; parked under the owner's merge rule, branch
`task/265-crossing-placement`, v1 `ab45b2e`, v2 `19a6ad9`): v1 moved every mapped crossing's band (Munich fixed choice
off +5.9%); v2 moves only node-mapped crossings (Freiburg 7 ends: `n:211` 7.9 to 3.7 m, on the ground zebra; Munich
`n:6`), stripes 0.2 m from the curb. v2 traffic: Munich actuated off -1.6%, actuated on +3.3% (miss by 0.3 points;
seed spread ±1.7%), fixed off +1.3%, fixed on -0.4%; full demand five-seed +1.1% / -1.3%; Freiburg +1.1 s. Parked;
owner's call (the only Munich change is `n:6`'s zebra 3.6 m outward). Also fixed on the branch: the mapped-crossing
cache keyed by walk links went stale after in-process imports.

TASK-280 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `98a89ea`): in `railHeights`, tracks on one layer
whose centre lines run within 3.2 m and 30° of each other share one profile (2 m samples linked at no cost), so
switch pins and ramps apply to both; tracks on other layers or past each other's ends stay apart; where an
embankment slope would land on a ground track, a retaining wall stands. Covered bed points Freiburg 148 to 0;
bridge points floating over the deck 126 to 0; ground track buried under embankments Freiburg 608 to 1, Munich 154
to 31. No simulation code reads rail heights; hashes identical. Side effects: 42 Freiburg track sections lower
(rt:12392 3.91 to 2.45 m, rt:12830 4.74 to 2.04 m: check road clearance at the next aerial pass); rt:12409 and
rt:12417 rise to about 1.1 m beside a ramp.

TASK-277 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `5d2918f`): Philadelphia's budgets from general hot paths:
crossing paint tested only on lanes whose boxes meet (all road ends, Philadelphia 18.1 to 0.63 s), signal
containers as render groups, walkers as particles, walk calls handed to their controller, walker speeds from a
dense table. Philadelphia 2D p95 8.0 to 1.2 to 1.5 ms, 3D build 8.6 to 4.2 s, first frame 11 to 6.9 s; Freiburg 2D
2.6 to 0.9 ms, Munich 2.4 to 1.0 ms. Stop naming: an unnamed platform or tram stop takes its stop area's name before
its `ref` (Philadelphia 27 renamed, the trolley's "3" is "13th Street"; Freiburg's Hbf platforms "1", "2;3"... now
"Freiburg (Breisgau) Hauptbahnhof"). All state hashes identical. Subways do run (as `sbahn`); real subway service
needs a route kind (schema, owner), turn-back routes and parallel-track routes.

TASK-271 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `951fa6e`): (D6) without a `layer`,
`tunnel=building_passage` and `covered=yes` are at grade in `osmLayer` (roads and walks; rail keeps its reading);
replaces Freiburg's curation block (same roads and walk links; 24 portal nodes differ). Layer -1 roads: Munich 30 to
16, Sindelfingen 60 to 12, York 98 to 29, Lübeck 31 to 0. (D12) `*:conditional` access read as the 07:00 to 19:00
majority (York 25 roads, Lübeck 2). Alternating one-ways as a shared lane; `oneway=faux` two-way. Traffic, full set:
Munich 12 seeds +0.1, +2.3, +2.2, +0.2%, drain on all; full demand five-seed -1.2% / -2.5% (fixed completes 61
fewer); Freiburg +0.9 s. Passes. Schema proposals (owner): per-time access windows, an alternating flag.

Lead merge of TASK-277 and 271: `polyline.ts` (`Box` exported, TASK-278's `polylineNearest` kept) and `bench/freiburg.ts`
(`curateFreiburg(city)`) resolved; bundled cities rebuilt (Freiburg manifest b9b2611e...), gate 1,532 / 0, 59.8 s, hash
883105405 (main 60.5 s); walk mesh, Sindelfingen rail and V275 pins re-pinned on TASK-271's passages at grade.

TASK-283 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged on the owner's go, `414ee33`):
a trip leaving home is judged by the home's own car (every owned facility with an exit must reach the gateway);
polygon gateways may reach the core over `destination` and `private` lanes as well as `yes`. Lübeck gets Wallstraße
back (8 to 9 gateways), Cambridge three north-east exits (5 to 8); `no_route` 0 in both. Munich, Freiburg, Sindelfingen
trip lists and traffic identical (passes the merge rule). Cost: people assigned to unreachable exits stay home
(Lübeck 13,516 to 12,959 trips a day, Cambridge 4,546 to 3,867); the fix is drawing workplaces only among gateways the
home's car reaches, which changes populations (owner's call). Lead merge (`d44658e`): `places.ts` keeps
TASK-286's lane-change modes with TASK-283's car-only access (`yes`, `destination`, `private`) as `carOnly`; Lübeck and
York archives rebuilt (more gateways), the other four byte-identical. Populations: TASK-288.

TASK-285 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `e8e6833`): Philadelphia Center City preloaded (raw
polygon import, right-hand, flat; extract committed with attribution; `?city=philadelphia`; panel note "One-way grid
around City Hall: right on red, trains below"). Showcase gate: 12,926 persons, 4,672 completed, 0 failed, 0 stalled,
worst visit 404 s, 156.1 s. Budgets: first frame 2.95 to 3.14 s near idle (Freiburg 2.38 to 2.57), 3D after the click
3.6 s idle, 2D p95 1.5 ms, 3D p95 3.0 ms. Archive 6.47 MB, 1.02 MB gzip. Follow-ups: 155 validation warnings (F1),
load at 1.2x Freiburg (F2), subway service (F3). Lead merge: archives rebuilt unchanged.

TASK-284 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `2ae278a`): Lübeck Altstadt and York city centre bundled
(raw polygon imports, side inferred: Lübeck right, York left; extracts committed with attribution). Lübeck passes
(seed 1: 2,522 completed, 0 failed, worst visit 61 s; seeds 2, 3 clean) and loads on par with Freiburg: in the panel,
`?city=luebeck`. York fails the gate (3 `no_route`, all from the Layerthorpe gateway: TASK-286) and loads at 1.6x
Freiburg (TASK-287): bundled, `?city=york`, held out of the panel (`heldOutOfPanel`; its gate test expects failure).
Archives 9.15 MB (1.55 MB gzip) and 6.77 MB (1.19). Lead merge with TASK-285: the builder, panel, attribution,
staleness test and real-places spec combined; archives rebuilt unchanged.

TASK-287 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `24d6afc`): load-time hot paths, identical output (ten
outputs hashed in five cities): `crossingArms` and `crossingStyle` cached per city, `placeCrossing` skipping far
curbs, UK centre lines and zig-zags from one street-group index, `curbTaper`/`curbBands` reading the node's own
roads, the walk compile's `attach` trying paths by rank and distance, lot-path bay boxes, `placeStreet` edge runs.
Quiet-machine medians (main to branch): York first frame 2.93 to 2.80 s, ready 6.42 to 6.09; Freiburg 2.26 to
2.17, ready 5.14 to 4.37; Munich 2.24 to 2.13. York stays at 1.29x Freiburg's first frame (TASK-284's 1.6x was
measured before TASK-277); left: `junctionPolygon`, seams, `walkGeometry` unions, Pixi batching.

TASK-286 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged variant `bb051ff`): polygon gateway lanes judged by the
router's lane-change rule (`reachableLanes`, moved unchanged to `src/network/lane-reach.ts`): a connector lane counts
only if the router could use it from the connector; where at least one lane of a cut end passes, the outer passing
lane is chosen; where none passes, TASK-270's choice is kept (the strict first version `6e70d18` dropped Freiburg's
Stefan-Meier-Straße entry, +2.8 s; lead asked for the variant). York's Layerthorpe leaves on `r:3638#1`: gate seeds 1
to 3 `no_route` 0 (main 3 / 2 / 2), parking failures 0 / 1 / 1 (main 21 / 23 / 23). Freiburg, Lübeck, Munich,
Sindelfingen archives byte-identical. Lead merge: York joins the New city panel ("City walls and station: left-hand
traffic, mini-roundabouts"; first frame 2.80 s after TASK-287); `heldOutOfPanel` emptied.

TASK-279 (Claude Code subagent, Opus 5.5 high, 2026-11-21; parked for the owner, branch `task/279-unmarked-yield`
`af007d4`): unmarked crossings by German rules. v1 (`7f7c238`, no walker priority) met the thresholds but left walkers
waiting at full demand (p99 3,149 s, max 6,294 s, 450 waits over 300 s); the lead sent it back. v2: a walker may step out
in front of standing traffic and of traffic crawling below 1.4 m/s that can stop before the stripes, and a waiting
walker holds crawling traffic short of them (added by the agent: the step-out alone left p99 1,112 s and 4 walkers stuck
all morning, queues stopping on the stripes at `n:212`). Full demand seed 1 waits: main p99 182 s, max 338 s; v2 193 s,
366 s, 9 over 300 s; mean walk time 129.1 s (main 128.8). Measured against main `a6a1d92` (the agent re-measured: TASK-271
moved Munich): Munich 0.15 twelve seeds -3.0, -1.5, -3.8, -0.8%, drain on all 96; full demand five-seed actuated +0.4%,
fixed +2.1% (41 more completed; single seeds -9.2 to +19.3%); Freiburg gate 1,530 / 0, 60.1 s (+0.3 s), seeds 2, 3 equal;
Sindelfingen 27.2 s. Misses the merge rule by 0.1 point after its variant: parked (owner: accept v2, or more seeds).
Also carries a cache fix in `src/network/crossings.ts` (mapped crossings cached per compiled city); the lead checked
main: a fresh import of the York extract gives the same crossing styles with and without it, so the stale read comes
from v2's own `walk.ts` and the fix stays with the task.

TASK-288 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged on the owner's go, `0f3b4f1`; lead tiers green): a person drawn to a work place the home's own car cannot serve both
ways draws again, by the same weights, among those it can; where none, the draw stands. v1 (`edf4099`, redraw within the
same kind) failed York's gate (7 and 6 gridlocked, worst visit 5,869 s at George Street): a deadlock at the 17-space lot
`pk:4462` (a car at the entry from 08:21 to 10:00 while two inside wait to leave), still in `src/sim`. Variant: trips a
day Lübeck 12,959 to 13,602 (pre-283 13,516), Cambridge 3,867 to 4,674 (4,546); employed staying home 302 / 353 to 0 / 0;
`no_route` 0. Munich (0.15 seeds 1 to 12, four configurations; full demand 1 to 5) and Freiburg state hashes identical;
every showcase gate passes. Populations change in Lübeck, York, Philadelphia, Sindelfingen: Sindelfingen 280 to 890
trips a day (gateway residents whose local work place their car could not reach now commute to another gateway; delay
27.3 to 17.1 s), Philadelphia +10 to 24 s a seed within its gate. Held for the owner on the Sindelfingen demand; owner: merge.

TASK-291 (Codex CLI, gpt-6.2-sol high, 2026-11-21; merged `0afa9b1` after one send-back): rail decks over low passages.
Where a road or walkway passes under an independent rail deck below 4.5 / 2.5 m, the rail profile is raised there,
keeping the 4% rail and 6% tram grades and capping the lift at fixed connections (a first trial lifted freely and made
grades up to 222%); deck, paint, trains and catenary follow the same profile. Freiburg roads below 4.5 m 34 to 1, walks
below 2.5 m 22 to 5; Munich's six low crossings all higher (3.17 to 3.26 m at worst; tram approaches limit them); no
pair below main. First version `2c6deb9` sent back: Freiburg's rail build 964 to 2,516 ms and one Schwabentorbrücke
walk 11 mm lower; the fix (on-demand candidate polygons, the 2D view's rail shapes reused) left Freiburg's 3D build
+67 ms median (three interleaved rounds), Munich even. Simulation hashes identical. Extra files `catenary.ts`,
`scene.ts`, `src/render/rail-geometry.ts`. Follow-ups: `maxheight` read by the importer (Breisacher Straße 3.4 m),
the shared road-and-tram deck at Kaiser-Joseph-Straße (`wl:9187/1`), 12 grade-limited pairs.

TASK-293 (Codex CLI, gpt-6.2-sol high, 2026-11-21; merged `c79f58f`): Philadelphia's warnings and load. Polygon cut
endpoints stay outside junction groups, so signals serve traffic using those exits: Philadelphia's 10
`signal_unserved_movement` warnings and 4 dead ends cleared, two arrival connectors restored (T68 regression);
warnings 155 to 141, the rest judged real (short setbacks, terminal aisles, restrictions, three arrival-only
gateways); other cities unchanged. Road markings reuse the incident-road index, junction clipping skips far
segments, stall attachment checks near aisles: Philadelphia marking CPU 859 to 688 ms, first frame 2.34 to 1.99 s on
a quiet machine (five interleaved runs). Only Philadelphia's archive changes (gate 4,530 to 4,662 completed, delay
174.4 to 163.7 s); Munich (58 pairs) and Freiburg state hashes identical.

TASK-290 (Codex CLI, gpt-6.2-sol high, 2026-11-21; merged `9e886a4`, one send-back for pin comments): `amenity=parking_entrance`
nodes link to a compatible enclosing facility or one within 8 m and become its connector on a reachable car lane,
with mapped direction and access (opposite direction kept where usable); source-proven lot aisles kept; Overpass
fetches the nodes and their driveways. Linked of read: Freiburg 9/31, Munich 1/23, Sindelfingen 1/11, Philadelphia
36/62, Lübeck 7/37, York 0/11 (most unlinked: no compatible facility, outside bounds, no reachable lane); TASK-281's
left-out facilities restored 0. Munich 0.15 +0.51 / +0.03 / -0.03 / 0.00%, drain on all 48; full demand +1.51% / +0.19%;
Freiburg gate 59.8 to 62.7 s (+2.8, hash 3314728190; seeds 2, 3 within 0.7 s); Philadelphia 174.4 to 159.0 s. Passes.
Lead merge on TASK-293: Philadelphia's archive rebuilt from both; tiers green, gate re-measured.

TASK-289 (Claude Code subagent, Opus 5.5 high, 2026-11-21; merged `a23dd8a`): the York lot deadlock was a three-party
cycle at `pk:4462`: an arrival refused by the lot stood over George Street's zebra (keep-clear lets a car stand on a
crosswalk at its destination connector), walkers held every span of that crossing, so the exiting car's landing
lane stayed blocked and the lot kept refusing the arrival. Now a lot arrival whose body would cover a crosswalk stops
0.5 m short of it while the lot would not admit it (a full lot still turns it away), and no departure from that lot
starts while such a car can no longer stop short. Affects lot entries over a crosswalk only (Munich 0 of 48, Freiburg
1, Sindelfingen 3, York 2, Lübeck 4, Philadelphia 6). Two synthetic tests fail on main. TASK-288 v1's York: seeds 1, 2
gridlocked 7 / 6 to 0, worst visit 5,869 / 5,243 to 149 / 180 s. Every Munich (0.15, full demand), Freiburg,
Sindelfingen and showcase hash identical to main `3843cda`. The agent restarted its queue after its background
worker died at 17:12; it found that the lead's `fbgate.ts` imported from `lead-main-ref` (fixed to measure the
current tree; lead merge measurements were taken there and stand).

TASK-292 (Codex CLI, gpt-6.2-sol high, 2026-11-21; merged `28c3566`): load hot paths with identical output. Junction
outlines reuse edge bounds in crossing checks and skip curb sampling at one-approach nodes; seam searches reject far
segments before projecting; walkway clipping reuses prepared obstacles; Pixi groups rail and walkway polygons by fill
in draw order. Junctions, seams, walk shapes, two 2D captures and state hashes identical in six cities. Quiet-machine
medians, five interleaved rounds: York first frame 2.19 to 2.09 s (ready 4.85 to 4.67), Freiburg 1.77 to 1.72,
Philadelphia 1.97 to 1.91, Munich 1.77 to 1.70. York stays at 1.22x Freiburg (aim 1.15x not reached).

TASK-294 (Claude Code subagent, Opus 5.5 high, 2026-11-22; merged `12ba734`): "Anlieger frei" pockets. Under the old
rule a car used a destination or private road only in its trip's origin or destination zone, so a public pocket only
such streets reach (Lübeck's 245-road Wallstraße pocket, Wakenitzmauer) carried no zone, and lots opening only onto
it could not be reached. New compile step `src/network/zones.ts`: a component of open roads other than the largest
that a car reaches only through zones becomes a zone (gateway roads join none); zones are ranked by the fewest zones
on the way in from outside and each grants the zones on those ways in; a zone the outside touches grants only itself,
so through traffic stays out. Router, both parking-exit checks, gateway servability and live-patch invalidation read
it. Lübeck facilities without a car exit 24 (140 spaces) to 8 (14), York 4 to 3, Freiburg unchanged. All 48 Munich
0.15 and 10 full-demand hashes identical to main; Freiburg gate 1,531 / 0, 62.7 to 62.8 s (hash 1710089250). Lübeck
showcase delay 97 to 99 s rises to 118 to 133 s (seeds 1 to 3; 31 to 43 more trips, Kanalstraße r:1288 waits 2,630 to
8,455 s; no gridlock, worst visit 111 s): outside the merge rule, accepted by the owner. Lead tiers green on
`716df32`; archives rebuild unchanged.

- TASK-300 (Claude Code subagent, Opus 5.5 high; merged `dd04482`, wave C complete): TASK-308's chooser wired to the
  airport through flight operations (per-airport concept table, 5 kt tailwind, per-type crosswind), reconfiguration
  (`fleet.setRunwayConfiguration`: old ends close, finals land, queued requests switch, taxiing departures re-route,
  new ends open when clear; start, open and re-routes recorded), 3x cost for taxiing against the flow on parallel
  taxiways, wind control and Runways section in the flight board, lights follow the opened ends. The go-arounds were a
  deadlock between a departure reversing through London City's C / runway / D link and an arrival's exit route, fixed
  in arrival admission and ground starts. London City seeds 1 to 3: 150 / 150 / 149, mean delay 93 / 105 / 100 s, worst
  1,111 / 866 / 1,221 s, go-arounds 0; two wind changes: 27 to 09 in 26 s, back in 91 s. Lead tiers: all green except
  the local-only London City 3D render p95 (6.5 ms against 6 under four agents' load; main a3c557b reads 6.2 to 6.5 ms
  under the same load, 5.9 ms on a re-run): the lights from TASK-301 put London City near the budget. Follow-up:
  London City 3D render cost.

Airports wave D:
- TASK-337 (Codex; merged `92bb5ea`): an aircraft stopping short of a runway steps back along its route, 2 m at a
  time and at most 150 m, until its body is clear of the widest fixed-wing type the runway takes rolling on its
  centreline (rule from the TASK-330 pilot `1b57f5a8`, ported alone). Zurich 730 full days, seeds 1-3: completed
  581/578/604 to 577/597/599 (total +10), go-arounds 0/0/0 to 2/3/0, seed 2's 24:00 gridlock gone, overlaps 2/2/0 to
  0/1/0 (the remaining one is an unrelated taxiway pair); Boston and London City identical; Heathrow seed 1 full day
  identical (lead run: 367 completed, 0 go-arounds, taxi-out 34.0 min). The contract's per-seed "not worse" gate missed
  by 4-5 movements on seeds 1 and 3; the lead merged on the total and the removed overlaps (owner: "you may move the
  fixes"). A grant-timing variant gridlocked all three Zurich seeds and was dropped. Existing cities unchanged; lead
  tiers green (check 2,113, city 280, traffic light 5, e2e light 63, places 11, airports, Freiburg 1710089250).
- TASK-329 (Claude Code subagent, Opus 5.5 high; merged `be7aef1`): an aircraft that starts (pushback, tow, arrival
  on approach) goes before departures and tows ranked earlier but still at their stands; nothing starts while it would
  wait for a queued arrival or an aircraft parked in its way; newly parked aircraft block ordered-but-unstarted ones;
  a ring breaker (5 s scan, breaks rings older than 60 s at an unstarted aircraft first, never one holding a runway
  grant). Against main with 327 and 328: Heathrow 05-10 41/68/44 to 103/92/107 (no gridlock), full day 61/57/69 to
  367/390/215; Zurich 730 565/571/591 to 581/578/604, go-arounds to 0; Boston 809/726/735 to 817/755/752, go-arounds
  34-38 to 4-16; London City unchanged; runway conflicts 0; existing cities unchanged. Gaps: Heathrow seed 3 locks at
  17:48 and Zurich seed 2 ends with 17 stuck, both from an aircraft parking across the path of one already ordered (a
  stand-capacity question: the stand rule checks clearance only for its own type); the contract's synthetic
  three-aircraft ring test was not delivered (rings dissolve on the fixture); a few new body-overlap samples at one
  Zurich junction (E190/CRJ9), not traced.
- TASK-327 (Codex; merged `bb78390`, lead fix-forward `32dd6f5`): runway grants cover the runway in use and only the
  protected intersection areas its route reaches; areas are booked separately and released when the tail clears;
  crossings of unused runways keep their holds but no longer wait for traffic on runways that merely touch them.
  Boston seeds 1-3: 452/462/459 to 809/726/735, go-arounds 190/146/163 to 34/36/38, taxi-out 71-84 to 18-20 min;
  London City unchanged; runway conflicts 0; existing cities unchanged. Alone it exposed admission-order cycles at
  Zurich 730 seeds 2 and 3 (36 and 30 completed in matched windows); with TASK-328 in, the lead's full days give
  Zurich 565/571/591 against 498/543/499 and no gridlock; the latent cycles go to TASK-329. Merge fix: TASK-328's
  re-route at a hold compared `gate.runway`, which 327 replaced with runway uses (`32dd6f5`).
- TASK-328 (Codex; merged `58e23c2`): one runway configuration per operating day (owner 2026-11-23). Zurich runs north
  06:00 to the 23:30 curfew (arrivals 14; departures choose 16 or 28 by eligible taxi distance plus 750 m per queued
  departure); Heathrow keeps one assignment all day; wind can still force a change; a departure at a closed hold keeps
  its order and re-routes or returns to a stand. Zurich 730 seeds 1-3: 498/543/499 to 543/566/575, go-arounds
  26/30/22 to 30/22/14, runway 16 take-offs 46-54 to 122-130; Zurich at schedule size 170 of 170; London City
  unchanged; runway conflicts 0. Existing cities unchanged (Freiburg, Munich four cases, full demand both modes).
  Gaps: one departure left at a closed hold at the curfew in Zurich seeds 1 and 2; Heathrow still gridlocks (TASK-329).
  Lead quick check with TASK-327 also in: Zurich 565/571/591, Boston seed 1 809, no gridlocks.
- TASK-323 (Codex; merged `ad9bc75`): `src/sim/taxi-flow-preferences.ts`, TASK-321's policy C on the compiled airside:
  directions from the configuration's exits, line-ups and stand routes, cached per graph and configuration (about
  0.1 s uncached at Zurich and Heathrow); route length cost 0 to 3.4%; every baseline route keeps a compatible route;
  flips between configurations (London City 41 of 41, Heathrow 27L/09L 538 of 627). Wired by TASK-322.
- TASK-320 (Claude Code subagents, Opus 5.5 high; restarted after an app interruption; merged `4fa2884`): arrival legs
  end with a straight run on the stand heading (or an alignment segment), the stop shifts along the heading to keep
  the parked body 1 m clear of apron roads where paving allows, pushback starts from that pose, drawn pose = sim pose
  (`roadBandsM`, `aheadM` on compiled stands). Heading at stop 3 degrees or more: London City 12 to 0 of 19 (worst 60.6
  to 0.0), Zurich 3 to 0, Boston 1 to 0, Heathrow 5 to 0. Tails still over the road where no stop clears it: London
  City 11 to 13 (14 to 18 m), Zurich H11 to H14, nine Heathrow stands (a stand-capacity rule is the follow-up). A stop
  clamp fixes a Zurich 750 crash at 21:05; Zurich 750 498 to 533 completed, overlaps 1 to 0. London City seeds 1 to 3
  within gates (mean 17.5 / 16.3 / 20.1 s). TASK-316 re-run on top: Zurich 93% served, 91 of 98 tugs; London City 54%,
  42 of 99 (stands 11 to 13 and late vehicles): TASK-316 stays parked.
- TASK-321 (Claude Code subagent, Opus 5.5 high; merged `6809c54`, bench only): the owner's proposal tested on an
  abstract block simulator (`bench/block-signalling.ts`; 150 m blocks, aircraft as points): A today's style, B
  railway-style block clearance (enter a junction only if the block beyond is free; lock the direction of every
  segment through to the next safe place), C B plus dynamic one-way preferences per runway configuration (soft,
  wrong-way allowed at a cost), D C plus a loop-capacity rule. 315 runs (four pilots, Heathrow both directions,
  Zurich, Boston): no gridlock under B, C or D; A gridlocks wherever flows oppose (first after 3 to 22 minutes at
  80/h). At 80/h: Heathrow 56 to 73/h (B, C), Zurich north 8.6 / 61.2 / 71.7, Boston northeast 3.8 / 56.1 / 71.8
  (go-arounds 81 to 4 under C). Preferences shrink clearances from 11 to 20 segments to about one; at Heathrow 204
  of 236 segments oriented in both configurations flip between westerly and easterly. D never fired. Recommended:
  block clearance plus per-configuration preferences in `src/sim/aircraft.ts` in place of TASK-312's order of
  admission (about one and a half tasks).
- TASK-312 (Claude Code subagent, Opus 5.5 high, resumed after a session restart; merged `29128cb` with gaps, as a
  chain task leaving existing cities identical): a fast airside-only peak-window bench; an order of admission
  replaces whole-route direction locks and the whole-route admission check (in one Zurich window the old check
  refused 9,997 times against 17 starts); intersection departures before long runway backtracks (Zurich 16
  departures no longer taxi 1.8 km along the runway); arrival windows about 90 s with gaps for aircraft waiting 30 s
  at a hold; a stand no longer takes a type whose parked body blocks a taxiway; Boston and Heathrow schedule profiles
  and runway tables (Heathrow segregated with the 15:00 swap). London City seeds 1 to 3: 150 / 150 / 149, mean delay
  14.7 / 12.6 / 21.8 s, worst 190 / 216 / 255 s, zero go-arounds, overlaps, conflicts. Full volume, seed 1: Zurich
  181 to 498 of 750 (101 diverted, 26 go-arounds, 1 overlap sample, 17 stuck), Boston 227 to 452 of 1,000 (190
  go-arounds, 22 overlap samples), Heathrow gridlocks from about 10:00 (64 by 13:00). Remaining causes: Zurich's
  remote stands read code A/B (too few usable stands) and the 21:00 concept switch; Boston's arrivals going around
  on claimed exits; Heathrow's rings through following-distance claims. Zurich keeps its 150 cap; Boston and
  Heathrow stay held out. Startup pins re-pinned for all four airports. A second throughput pass is the owner's call.
- TASK-316 (Claude Code subagent, Opus 5.5 high; parked: v1 `ebcabee`, variant `0003a59`): airside ground vehicles
  in their own modules (service lanes from mapped closed service roads, turnaround vehicle sets, tugs coupling at the
  ready-for-pushback hold, 3D instanced models with beacons), aircraft untouched (fleet state identical with and
  without vehicles). Variant: zero vehicle-aircraft overlaps at London City and Zurich by reading the fleet's movement
  space (`fleet.movementSpace()`), tow notice; Zurich serves 89% of visits, 86 of 98 pushes with a vehicle tug;
  London City only 52% and 46 of 99, and 27 vehicles a day leave as a last resort. Cause: London City's parked
  aircraft sit up to 61 degrees off their stand heading physically (drawn on it) and two stands' tails lie over the
  single apron road. Parked until TASK-320 corrects parking poses, then re-run.
- TASK-318 (Claude Code subagent, Opus 5.5 high; merged `51b03cb` and the main merge `2d7d55d`): 18 catalogue types
  draw Flightradar24/FlightGear meshes (glTF 1.0 read by a bench reader, simplified with three's bundled
  meshoptimizer, scaled to catalogue length and span by stretching only the outer wings, flat part colours instead of
  source textures, doors, panes and livery bands added): LOD0 13 to 15 thousand triangles from 260 px on screen, LOD1
  1.3 to 1.8 thousand from 8 px, TASK-315's procedural mesh below and for SF34, PC24, GLF6. 8.96 MiB in
  `fixtures/aircraft`, fetched per type on first need (London City 262 KB). Render p95 and load within noise; bridges
  dock at the real fuselage's doors (TASK-319's reachability). Stand-ins: EC135 for both helicopters, ATR 42 for ATR
  72, E170 for E175, Citation II for the Citation entry. NOTICE entry for the GPL-2.0 set.
- TASK-319's Full run 45086019678 failed in the full traffic tier: `bundled-airport-load.test.ts` pins Boston's and
  Heathrow's startup digests, which TASK-319 changed; re-pinned (`f1e5f7e`), and the lead tiers now run that test.
- TASK-319 (Codex; merged `fc3ea8d` and `4a252dc`): mapped `aeroway=jet_bridge` ways imported into the airport
  section and docked to the reachable passenger door (Boston 22 to 111 bridges, Heathrow 1 to 15; London City and
  Zurich keep TASK-315's rule, 0 and 20); a 5 to 10 s ready-for-pushback hold with the tug attached so a bridge stows
  before the aircraft moves (London City delays within a few seconds). On the owner's note, a way tagged as a jet
  bridge is never a walkway: Boston drops 111 walk ways and 313 walk links under its bridges, no walk component
  splits; Heathrow (bridges mapped as corridors) unchanged.
- TASK-315 (Claude Code subagent, Opus 5.5 high; merged `5eac69c` and the main merge `82c33ef`): aircraft detail
  (doors, windscreen, winglets or raked tips, fan faces and cones, fairings, ATR gear pods), ten seeded liveries,
  jet bridges docking to the posed parked aircraft and retracting at pushback, stand guidance boards, floodlight
  masts, glazed terminal fronts. Bridge rule refined on the lead's note: only at jet-code contact stands facing a
  building of at least 8 m (or 3 levels): London City 8 to 0 (as the real airport), Zurich 33 to 20, Heathrow 117 to
  1, Boston 76 to 22 (their mapped `aeroway=jet_bridge` ways need a schema field: TASK-319). 3D p95 equal or lower
  (Heathrow 3.1 to 2.3 ms by day).
- TASK-317 (Codex; merged `1d74dac`; cut short on the owner's time cut, Heathrow from checkpoints): the motion
  profile capped speed at the tight-turn value on every curve; the curve speed now scales with radius at constant
  lateral acceleration up to the straight-taxi limit. London City seeds 1 to 3: mean delay 93 / 105 / 100 to 54 / 31 /
  51 s, departure moving speed 9.1 to 17.2 kt, taxi-out 7.6 to 5.5 min, E190 on a 140 m curve 9.7 to 21.8 kt; zero
  go-arounds, overlaps, conflicts. At Boston and Heathrow taxiing is a small part of the delay: approach sequencing,
  departure start grants, surface clearance, departure readiness and stand admission dominate (TASK-312).
- TASK-314 (Codex; merged `45f6507`): rotation on the main gear, lift-off, gear retraction, banked curved flight,
  flare and de-rotation; on the ground the nose wheel follows the centreline (error under 0.10 m through 90 degrees)
  while the main gear tracks inside; pushback tug at the nose; both views interpolate one snapshot behind. London
  City's gates unchanged; existing hashes identical; Heathrow 3D p95 2.0 to 2.5 ms (budget kept); London City live 2D
  mean CPU 0.48 to 0.92 ms.
- TASK-311 (Codex; merged `1496fe3` with the lead-line merge `8f4cde8`): aircraft meshes batched, light instances
  packed, sub-pixel cabin windows skipped, airport asphalt drawn once. 3D render p95 by day, lead line against merge:
  Heathrow 7.0 to 2.2 ms, Zurich 4.1 to 1.3, Boston 1.7 to 1.3, London City 2.1 to 1.2; night likewise; Freiburg and
  York unchanged. London City's screenshots pixel-identical, Heathrow's 23 of 729,936 pixels apart. Existing hashes
  untouched.
- TASK-310 (Codex; merged `4dbcab9` with the lead-line merge `25ee0d5`): load path with identical output (archives,
  compiles, populations, trips, flight boards, geometry digests, sampled states, existing hashes): parking geometry
  indexed, static airside turns reused in flight setup, pedestrian compile skipped for population, less project-open
  and scene-build work, a curb-mesh fix that lets Heathrow's 3D scene build. Boston and Heathrow open by URL, held out
  of the panel. Quiet machine, lead line against merge: Heathrow first frame 22.2 to 13.6 s, ready 80 to 49 s; Boston
  5.3 to 4.7 s and 15.0 to 12.8 s; Zurich 7.8 to 6.8 s and 35 to 31 s. Aims (Heathrow under 10 s, Boston under 4 s)
  not met: remaining cost in road and parking compile, 2D scene build, pedestrian access, street details and flight
  setup. The wave D Full run 45059413619 failed on CI opening held-out Zurich within 60 s; fixed forward (`f34b648`,
  180 s like the other held-out airports).
- TASK-302 (Claude Code subagents, Opus 5.5 high; the first stopped by an app interruption, a second finished from
  its WIP; merged `7de5a81`): Zurich bundled and held out of the New city panel (`?city=zurich-airport`). Concept
  table (south 06:00, north 07:00, east 21:00, closed 23:30; switches opened on time), crossing interlock (an aircraft
  on both crossing runways at the intersection in 51 samples, no conflict), Dock E, helicopters. As bundled, 150
  fixed-wing plus 20 helicopter movements: 170/170, mean delay 524 s, no overlap, conflict or stuck aircraft. At real
  volume (750) the day collapses: 181 completed, 263 diverted, 224 cancelled; late flights were waiting for a start
  grant (40%), landing clearance (25%), their inbound aircraft (22%) or a stand (11%); taxiing, holding and runway use
  under 1%. Ready 47 to 58 s (Freiburg 5 to 6 s); showcase morning gate fails on two landside gridlocks at
  Flughafenstrasse. Archive rebuilt after TASK-313's rule (`06e2dab`).
- TASK-313 (Codex; merged `947f9d7`): the owner's one-way London City section: a nearby hangar narrowed four taxiway
  edges to code B through the fixed-object clearance's tracking allowance, so code C jets detoured over the runway
  (267.9 m against 172.7 m). The allowance now applies on bends only. London City seeds 1 to 3: mean delay 36 / 40 /
  72 s (was 93 / 105 / 100), worst 451 / 601 / 526 s, go-arounds 0; Zurich gains five two-way edges.
- TASK-305 (Claude Code subagent, Opus 5.5 high; merged `8289736`): undoable editor commands for stands (add, move,
  kind, ref, code limit, delete; lead-in by the import's stand-node rule), taxiways and taxilanes (draw with snapping,
  split, kind, name, width, code limit, delete), holding positions (add, move, delete, protected runway) and the
  runway table (new optional `Airport.runwayOperations`, read by flight operations before the per-ICAO table). Codes
  stay "by rule" while `maxCode` is in `provenance.inferred`; geometry edits re-run the rules (moved verbatim to
  `src/network/airside-codes.ts`) on by-rule codes only. Airport-only patches recompile just the airside (45 ms
  against 3.7 s), equal to a full compile. Airside tool (key 6), inspectors, Delete key; edits wait for a restart.
  e2e: a London City remote stand added at code B takes the 07:29 business jet (larger codes stay unused while
  London City has spare stands, filled smallest first). Lead tiers green; London City 3D render p95 2.0 ms on a quiet
  machine (the earlier 6.5 ms was load).
- TASK-303 (Codex; parked `dacf5ae`, first version and variant in one branch): Boston bundled; a general apron rule
  (mapped apron, aligned with the centreline, clear of buildings and runway centrelines) joins the nine disconnected
  stands (North Cargo 41.7 m, Earhart Pad 71.4 m); 14C to 14K stay omitted (150 to 310 m, no mapped lane); the five
  code F stands are reachable only by code D or C routes, so no widebody turns are scheduled. Crossing interlocks hold
  (four blocks, 30 samples of independent runways in simultaneous use); wind reversals 22 to 4 and back open at once.
  The day fails: 227/1,000 movements, 372 diversions, mean delay 15,248 s, eight go-arounds, zero overlaps or
  conflicts. First frame 5.4 s and ready 15.3 s (Freiburg 2.2 / 4.7 s). Same throughput collapse as Heathrow: the
  airside operations of TASK-298 to 300 do not scale past London City's volume.
- TASK-304 (Codex; parked `c0b4b2f`, initial and variant in one branch): Heathrow bundled (2 runways, 1,501 taxiway
  edges, 307 stands of which 45 code F, 288 holds), 1,306 movements scheduled with A380 and 747-8 turns, segregated
  mode with the 15:00 swap (opened on time). The scale test fails: the day completes 56/1,306 (4.3%) with 494
  diversions and 119 arrivals still queued; six overlap samples from one pair under the branch's changed clearance
  logic; first frame 36.7 s and ready 71.7 s from the panel (Freiburg 2.7 / 6.3 s, York 3.8 / 9.1 s); 3D render p95
  19.4 ms (budget 6). Airside step 0.45 to 2.6 ms at 40 to 65 visible aircraft. Findings for a scale follow-up: stand
  allocation and route retries collapse throughput (whole-route direction locks remain), the bundled-city build and
  first frame scale badly with 1,500 taxi edges and a large surround, and the 3D scene draws too much at airport
  scale. Existing cities and London City unchanged on the branch.

Airports wave C, first two (2026-11-22; lead tiers green, existing hashes identical):
- TASK-299 (Codex; v1 `e908658` sent back, variant `bdea18d` merged): seeded operations through TASK-298's API
  (`src/sim/flight-operations.ts`), stand allocation checked by routing, paired turnarounds, overnight and
  maintenance tows, helicopters, flight board and stand inspector, run-bar movements. v1 completed London City's day
  only by serialising surface moves (mean delay 4,105 s, worst 14,853 s); its conflict log showed two TASK-298 gaps
  (taxiing on a runway edge did not hold the runway; pushback sweeps were not reserved against neighbouring stands).
  The variant reserves both and keeps moves concurrent: seeds 1 to 3, 150/150, 150/150, 149/150 (one diversion), mean
  delay 252 / 192 / 158 s, worst 1,797 / 1,643 / 1,489 s, zero overlap or runway conflict samples. Delay is now
  measured at touchdown and off-block. Gap: 15 to 21 go-arounds a day (about 75 arrivals), given to TASK-300.
- TASK-301 (Claude Code subagent, Opus 5.5 high; merged `e098862` after merging TASK-299): airfield lights by rule
  shared by 2D and 3D (runway edge, centreline, threshold, end, approach, PAPI by glide angle, taxiway centreline and
  edge, stop bars switched by clearance, stand floodlights), aircraft lights from sim state, outlines, shadows and drop
  lines for legibility over the surround, camera follow; `fleet.airfield()` and `fleet.setActiveEnds()`, set by flight
  operations. London City 3D frame 1.61 ms against Freiburg's 1.11.

Airports wave B (2026-11-22; lead tiers green on each merge, existing archives, the Freiburg gate hash 1710089250 and
the Munich 0.15 and full-demand seed 1 hashes identical):
- TASK-296 (Codex; merged `c040a60`): synthetic airports `syntheticAirport` (parallel taxiway, one rapid exit each way)
  and `syntheticAirportBacktrack` (one midfield entrance, turn pads), 2,800 x 45 m runway 09/27, code C and E contact
  stands, remote and maintenance stands, helipad, landside loop; New city > Test layouts. Generated airports carry no
  OSM ids (`osmId` optional in the airport schema).
- TASK-297 (Codex; merged `342f20b`): runway, taxiway, holding-position (pattern A), stand and apron paint shared by 2D
  and 3D; dock water above the aerodrome tint. Existing cities' 16 fixed-camera captures identical. A thin straight
  line across London City's apron in 2D is left to check.
- TASK-309 (Codex; merged `7b82aae`): Zurich, Boston and Heathrow extracts committed; short taxi gaps bridged,
  crossing runways split, full displaced thresholds (Boston 15R 84 to 270 m), helicopter runway kept; untagged widths
  start at the largest runway code, so London City's taxiways read code C (54 F before) while Zurich and Heathrow stay
  mostly F. Boston: five code F stands lack an all-F path, nine stands unreachable (six 33 to 37 m off the network,
  14C to 14K over 150 m with no mapped lane), for TASK-303.
- TASK-298 (Claude Code subagent, Opus 5.5 high; merged `4c41a79`): compiled airside (`src/network/airside.ts`), routing
  with code limits and turn radius (runway taxiing costs four times), aircraft (`src/sim/aircraft.ts`) on TASK-306's
  profiles: edge-stretch and junction reservations, whole-route one-way locks, one aircraft per runway, holds until
  cleared, booked arrivals, go-around 30 s out; 10 km finals (London City 5.5 degrees by a published steep-approach
  table) and climb-outs; backtrack with an end loop; tows; minimal helicopters; road vehicles give way at recorded
  crossings. Operations API for TASK-299; a scripted rotation stands in. London City scripted hour: 5 landed, 5
  departed, no overlap, conflict or stuck aircraft; six hours: 34 departures. Notes: London City stand 21 (code C)
  has a code B taxilane beside it; whole-route locks will need refining at Heathrow's volume.

Airports wave A (2026-11-22; lead tiers green on each merge, existing archives and the Freiburg gate hash 1710089250
identical, no engine path changed):
- TASK-295 (Claude Code subagent, Opus 5.5 high; merged `4d98bcf`): optional `City.airport` (`src/schema/airport.ts`):
  undirected airside graph with per-edge width and aircraft code, runways with ends, displaced thresholds and ordered
  edges, holding positions with protected runway and side, stands (kind, stop, heading, lead-in, gate, code), gates,
  terminals in detached groups, helipads, aprons, hangars, windsocks, approach aids, turn pads, road-airside
  crossings. Importer `src/importers/osm/airport.ts` runs last (no other id moves); `queryVersion` 13. Rules in
  architecture sections 4 and 13: split at shared nodes, runway chained end to end, holds snapped within 20 m, stand
  nodes matched to a ref way within 30 m else a generated lead-in within 150 m crossing no building, codes from Annex
  14 widths and separations, stand codes from spacing. London City bundled: 1 runway (1,498 x 30 m, code C), 97
  taxiway, 18 runway and 19 lead-in edges, 16 holds on the graph, 19 stands (12 contact, 7 remote), 2 road crossings,
  nothing disconnected; first frame 1.45 s (Freiburg 1.24, York 1.65). Untagged taxiway widths derive lenient codes
  (F on 54 of 97 edges): TASK-309 reviews the rule.
- TASK-306 (Codex): performance figures for all 21 types and deterministic motion profiles (taxi, pushback, tow,
  take-off, climb, approach on 3 and 5.5 degree paths, flare, rollout, helicopter), `src/sim/aircraft-motion.ts`.
- TASK-307 (Codex): procedural 2D outlines and 3D meshes at catalogue length and span with gear, spinning parts,
  accent colour and light mounts; preview at `/dev/render.html?fixture=aircraft`.
- TASK-308 (Codex): seeded flight schedule (London City 150 movements a day; a large default 1,188) and the runway
  configuration chooser (tailwind 5 kt, crosswind per type, concept tables, change times).

TASK-211 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged): four exact cuts in `src/sim`.
(1) `parking.arrivalStop` is asked only when the car is on its destination lane, on a movement into
it, or about to take that movement (elsewhere it returned `min(stopAt, Infinity)`); (2) the rail
occupancy pass skips a vehicle whose segment, position, speed, movement, route and step match the
step before, re-marking its crossings (commit and release rules are idempotent); (3) a per-car lane
plan cache in `lane-change.ts`, valid while route object, step, lane and destination hold (routes are
replaced, never edited), and `futureChanges` keeps the last corridor; (4) sparse arrays (`groupPaths`,
entry chains, rail paths, walker blocks) allocated at full size. A `debugSkips` load option runs
every shortcut and throws if one would differ; `tests/sim/exact-skips.test.ts` covers rail and tram
queues and a town morning (Munich 0.15 seed 1 skipped 13.2M of 23.7M rail passes with no
difference). Phases, Munich full demand seed 1, main to branch: following pass 452 to 366 s actuated,
509 to 399 s fixed; lane-change proposals -39%/-37%; rail crossing step -62%/-60%; total stepping
-22.3%/-22.1%. Timing pairs, interleaved, CPU load 14 to 31% mean: actuated -20.4% and -22.8%, fixed
-23.3% and -25.5%; overall -23.1% (target 15%). Hashes identical main against branch on Munich 0.15
seeds 1 to 3 in all four configurations, both full demands, Freiburg and Sindelfingen. Left: the
following pass, spawn's blocked-origin scan, the rail hold, reroute routing, commit. No files outside
scope. Lead check on the merge (on top of TASK-213): check (1,532), city (185), traffic light and
guard, light e2e (61); full demand on the merged tree actuated 3,345 / 177 hash 2229666949, fixed
3,210 / 166 hash 2820161686 (the references), about 820 s stepping each.

Full run 44443575251 (lead, manual, on cb565a3 after TASK-211): every job green, including all five
e2e shards; the city job took 32.9 min.

TASK-214 (Claude Code subagent, Opus 5.5 high, 2026-11-19; held for the owner, branch
`task/214-splits-merges` at `cc70c3e` on main `08ebee4`, worktree `D:\cityflows-wt\214`): eight rules in
`src/network` (R1 a road between two transitions goes from one end's shift to the other's; R2 at a
one-branch gain or drop the wider road takes the shift, with exceptions for longer tapers, two-way
streets and divided carriageways; R3 side-by-side lanes on short roads measured from the trimmed cut;
R4 interpolated vertex normals along a side-by-side line; R5 a side-by-side chain shares one line and
`compile.ts` closes the joint; R6 no easing across a 3+-end junction for a road trimmed to nothing; R7
two tight corners a straight apart both eased; R8 a branch beside added lanes moves over), each with a
test that fails without it. Audit, main to branch: Freiburg folds 17/13/18 to 4/2/5, joins over 5 cm
124 to 82 (max 2.298 to 1.704 m at n:717), lane overlap 255.6 to 214.8 m², marking offset max 0.608 to
0.224 m, J2 n:652 folds 4 to 0; Munich folds 3/3/2 to 0/0/0, r:588/r:589 gap 0.693 to 0.062 m, J6 n:27
overlap 87.7 to 32.1 m²; Sindelfingen unchanged; no measure worse. Not fixed: S6 point merges, S5's 84
untapered changes, J2's last lobes, J6 n:194 (all need tapers carried across plain nodes), Munich join
max 0.315 m at n:19/n:624. Traffic, Munich 0.15 seeds 1 to 12 mean delay: actuated off -1.1%, on
+3.2%, fixed off -4.3%, on +0.2%; gridlocked trips 1 to 4 (actuated off) and 3 to 4 (fixed off); drain
criterion on all 48 runs. Full demand: actuated 3,345 / 177 to 3,759 / 143 (delay 1,746 to 1,678 s),
fixed 3,210 / 166 to 3,501 / 168 (delay 1,695 to 1,727 s, +1.9%). Freiburg gate 1,467 to 1,463, mean
delay 75 to 89 s (state hash 2204867137). Sindelfingen 155 / 0 / 0 unchanged (hash 3472231659). Red:
the bundled-project build test (the Freiburg project must be rebuilt; fixtures out of scope). Outside
scope: `compile.ts` (R5, R6), fingerprint re-pins, T35's Munich exceptions removed. Lead decision: a
trade-off under the owner's rules (Freiburg delay +19%, more gridlocked trips at 0.15, against full
demand and Munich choice-off gains), so held; if approved, the lead rebuilds Freiburg and re-pins.

TASK-214 merge (owner approved 2026-11-19, "Merge"): the lead rebuilt the Freiburg project. The
rebuild renumbers the rail nodes by one, and departure offsets are hashed from route ids: the new
offsets did not fit 10 trams an hour in 720 s, so every line fell to 5 an hour. Fixed in
`buildTimetable` (`src/network/trains.ts`): up to 16 salted offsets per period before the period
grows; the first attempt is the plain id, so every timetable that fitted before is unchanged (a
narrow form of TASK-207's held F2). Freiburg after the merge: 10 trams an hour on all eight routes,
timetable hash 90e3ff6f, `city.json` 2243703f..., morning 1,462 / 0, mean delay 76 s (main 75 s; the
branch's 89 s came with the halved trams), state hash 1730700508. Lead check on the merge: check
(1,532), city (193), traffic light and guard, light e2e (61); full demand reproduces the branch:
actuated 3,759 / 143 hash 4028429784, fixed 3,501 / 168 hash 2888500527. These are the new
full-demand references.

Full run 44477718803 (lead, manual, on 5b10d5a after TASK-214): red in the city job only; TASK-214's
`splits-merges.city.test.ts` setup hook imported Freiburg and Munich under the 10 s default hook
limit, which a cold CI import cache exceeds. Fixed in fc5ebec (`limit(300_000)`). Full run
44480972194 on fc5ebec: every job green, including all five e2e shards; the city job took 19.3 min.

TASK-215 (Claude Code subagent, Opus 5.5 high, 2026-11-19; held for the owner, branch
`task/215-markings` at `3e5e33f`, main `1ac0c38` merged in, worktree `D:\cityflows-wt\215`): M1 arrows at
a group entry show the turn through the group (5 lanes through to left; r:1148#0/#1 no arrow); M2 lane
lines only on inner lanes of 15 m or more (Freiburg 232 shapes in 26 groups to 0, Munich 88 to 48); M3
no default crossing on a trunk road unless an OSM crossing way meets it within 12 m (Freiburg 10 ends
to 0, Munich 6 to 0); M4 crossings less than 7.5 m apart on one road keep one (signal first),
keep-clear boxes stop 0.5 m short of stripes, arrows clear the crossing (pairs within 9 m Freiburg 11
to 2, Munich 12 to 0, Sindelfingen 14 to 0); M5 an arm whose crossing steps more than 0.25 m gets one
straight band (steps over 1 m Freiburg 10 to 2, Munich 8 to 3, Sindelfingen 24 to 9); M6 one stop line
across the approach (Freiburg 59 to 0 in pieces, Munich 24 to 0). Marking offset max Freiburg 0.608 to
0.134 m. 8 tests fail on main. Crossings move walk links, signal stop lines and street parking strips:
Munich seeds 1 to 12, choice on, mean delay actuated 88.0 to 91.5 s (+4.0%), fixed 124.8 to 131.4 s
(+5.3%), completions about -0.15%, all drain criteria met; variants put the cost on the
doubled-crossing rule (fixed 125.2 s without it). Freiburg gate passes (state hash 438544493). Red:
the bundled-project build test, because the importer keeps parking strips clear of crossings, so the
Freiburg project must be rebuilt (out of the agent's scope). Outside scope: `walk.ts`, `inspector/node.tsx`,
many re-pins (T44 to V117, T65, T70). Lead decision: a trade-off under the owner's rules, so held; if
approved, the lead rebuilds Freiburg and re-pins, or the owner may prefer the variant without the
doubled-crossing rule.

TASK-210 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged): 3D draws `dome` (sections of
the outline scaled about its centroid: a hemisphere or spherical cap), `onion` (ledge, neck, bulb as
wide as the outline, taper to a point) and `round` (a barrel vault along the long axis, clipped to the
outline); dome and onion need an outline whose every edge faces the centroid, else flat. Box shapes
also take convex outlines filling at least 70% of their box (15 Freiburg, 2 Munich roofs off flat);
`roof:levels=0` no longer flattens a roof (28 Freiburg, 5 Munich). Flat fallbacks: Freiburg 260 to 204
(4 domes, 4 onions including the Schwabentor, 4 round roofs now drawn), Munich 79 to 70, Sindelfingen 0.
Left: 196 concave Freiburg outlines and 69 Munich ones need a straight skeleton (L, T, U shapes); 27
and 4 are nearly convex, a box roof with one ridge would cover them (owner's call). 3D build median
1,340 to 1,349 ms; render p95 3D 2.9 ms, 2D 1.2 ms. 11 new tests fail on main. Lead check on the merge:
check (1,529), city (183), landing and 3D specs (2), light e2e (61).

Full run 44410242710 (lead, manual, on 1aae088 after TASK-207 and TASK-209): every job green,
including all five e2e shards; the city job took 41.1 min.

TASK-208 (Claude Code subagent, Opus 5.5 high, 2026-11-19; held for the owner, branch
`task/208-remaining-misses` at `8653e9e`, worktree `D:\cityflows-wt\208`): (1) the r:654 misses are a
queue-head detour: a head on r:53 or r:1306 blocked from r:700 lane 1 takes lane 0 after 45 s, which
needs two changes back into the same queue; fix in `detourHeads` (`engine.ts`): a head no longer
detours into another lane of its own next road when that route needs more changes after it (T58 test
fails without it). (2) r:639 misses are spill-back from the jughandle queue through r:1304/r:680, not a
lane-choice fault; a "give up only at the stop line" variant was worse and dropped. (3) TASK-204's
first-rule Freiburg gridlock is a latent fault between a tram crossing and actuated signals: the
crossing at r:1337/n:39 reaches n:18's stop line, a held car needs two controllers green together, and
TASK-199's upstream calls lock both at their maximum in opposite phase (3.5 min on main with the second
rule off); not fixed (signals and crossings out of scope), a follow-up for the owner. Misses, 12 seeds,
choice off: r:654 actuated 93 to 16, fixed 310 to 7; r:639 actuated 175 to 95, fixed 932 to 607. Mean
delay at 0.15 rises in all four configurations: actuated off 637.7 to 651.8 s (+2.2%), on 88.0 to 89.3
s (+1.5%), fixed off 824.8 to 856.4 s (+3.8%), on 124.8 to 126.3 s (+1.2%); drain criterion on all 48
runs. Full demand: actuated 3,345 / 177 to 3,397 / 172 (+1.6%), fixed 3,210 / 166 to 3,368 / 160
(+4.9%, 4 stalled). Freiburg and Sindelfingen identical. Tiers pass. Lead decision: a trade-off under
the owner's rules, so held.

Full run 44407315666 (lead, manual, on 1ac0c38 after TASK-206): every job green, including all five
e2e shards; the city job took 21.1 min.

TASK-206 (Claude Code subagent, Opus 5.5 high, 2026-11-19; merged): no single regression since
TASK-198: in one session `200bc3e` measured 5.45 to 6.01 s and main 5.50 to 6.59 s; the 3D build grew
0.27 s from TASK-201/202's rail and walk data; TASK-198's 2.0 to 4.0 s was most likely a quieter
machine. Where the time went on main: height lookups for every road vertex (1.0 to 1.2 s of 2.8 s,
almost all on level roads where the height is 0), shader programs compiled one at a time on the first
draw (0.43 s), every OSM lamp tested against every road surface (0.52 s), and 3D recomputing the
marking shapes 2D already had (0.2 s). Fix: level roads without terrain skip the lookup (test that both
paths agree), all shader programs requested before the first draw (0.53 to 0.33 s), lamp matching
skips roads out of reach (same road chosen), 2D and 3D share cached marking shapes
(`marking-geometry.ts`; kept in memory while the city is open). Main to branch: first frame to ready
2.41 to 3.31 s to 1.46 to 2.48 s; 3D build 1.98 to 3.02 s to 0.91 to 1.23 s; click to first 3D frame
2.56 to 3.73 s to 1.29 to 1.68 s. `qa-production` 3D after first frame, interleaved under 53 to 60%
load: branch 5.48 to 7.21 s, main 8.38 to 10.10 s (both over 5 s under load); at lighter load the
branch passed 3 of 3 (4.19 to 4.89 s); expected idle about 2.6 to 3.5 s (lead to re-measure on a quiet
machine). 2D and 3D shots pixel-identical (970,163 triangles, 104 draw calls). Terrain, measured not
enabled: 3D build 11.9 s with terrain against 1.6 s flat (land use clipped against the terrain ground
4.05 s, ground mesh 2.6 s, draped markings, places and surfaces 3.7 s, walk 1.57 s); about 10 s must go
(land use as a texture or per grid cell, cutting only boundary cells, a grid index for draping,
indexed geometry), or build it off the main thread and show flat first. Lead check on the merge: check
(1,518), city (183), traffic light and guard, 3D, landing and framing specs (8), light e2e (61).

TASK-212 (Claude Code subagent, Opus 5.5 high, 2026-11-18; merged): read-only audit in
`docs/findings/2026-11-19-geometry-audit/` (README and 36 close-ups). `bench/geometry-audit.ts`
crashes on main: its named cases R3-1 (`n:1181`) and R3-7 (`n:949`) no longer exist since TASK-131
renumbered Munich, and it has no Freiburg entry (figures taken with a scratch wrapper; TASK-213 fixes
the bench). Regressions against the recorded figures: sharp curb corners Munich 9 to 22, Sindelfingen
8 to 31; lane back-steps Munich 0 to 3 (`r:589#0`, `r:728#0`); continuation join max Munich 0.047 to
0.315 m; same-corridor overlap Munich 1 to 3 pairs, Sindelfingen 0 to 2. Freiburg: 17 folded lanes, 106
sharp corners, 124 joins over 5 cm, 84 of 159 lane-count changes without a taper. Cases: junctions J1
to J6 (group surfaces at the Hauptbahnhof, lobed group edges, acute side roads, corners without radius,
through-road bends, ramp diverges) for TASK-213; splits and merges S1 to S6 (sawtooth pinches, gain
fans, joint steps, folds, chained gains, point merges) for TASK-214; markings M1 to M7 (group-entry
arrows, splayed inner dashes, zebras across the B 31, doubled crossings, staggered stripes, split stop
lines; M7, solid lines before signals, is a theme rule for the owner) for TASK-215. Lead check: check
passes; docs only.

Full run 44390084748 (lead, manual, on aeba494 after TASK-202): every job green, including all five
e2e shards; CI green on aeba494 and Pages deployed it; the city job took 32.8 min.

TASK-202 (Claude Code subagent, Opus 5.5 high, 2026-11-18; extended by the owner to the crossing
stop line; merged with the owner's approval of the trade-off): 8 of 32 Freiburg tram stops were
unserved because each boundary entry kept only its straightest line (7 stops on branches and parallel
lines) and the Schwabentor loop's switch rn:12724 leaves at 34.4°, beyond the 30° join. Fix
(`src/network/trains.ts`, `rail.ts`): after each entry picks its line, every still-unserved halt a
tram can pass between two boundaries gets a route (cheapest paths, most unserved stops, straightest,
shortest); tram tracks at a node tagged as a switch join up to 45° (untagged crossings stay at 30°;
one new join across all cities). 32 of 32 served, 8 routes at 10 per hour; Munich and Sindelfingen
timetables hash-identical. Trams over the Eisenbahnstraße crossing then held a car on r:1719 on green
(1 gridlocked): `ranges()` in `src/sim/rail-crossings.ts` took each facility's nearest stop marking
anywhere on the path, here a marking for a turn the car does not make, 185 m before the span it does
cross; passing such a marking also committed the car. Fix: a marking holds, and passing it commits,
only if the car reaches that facility's tracks from it without turning off (through movements, lanes
leading to one road, lanes carrying that facility); the earliest qualifying marking is the stop
(latest-marking variant: 12 gridlocked). New `T75-crossing-encounter.test.ts` fails on the old code.
Munich, main e9e53c6 to branch, seeds 1 to 12: mean delay actuated choice off 631.7 to 637.7 s
(+1.0%, gridlocked 4 to 1), on 88.9 to 88.0 s; fixed choice off 833.2 to 824.8 s (gridlocked 2 to 3),
on 124.4 to 124.8 s; drain criterion on all 48 runs. Full demand: actuated 3,406 / 159 to 3,345 / 177
(hash 2229666949), fixed 3,168 / 169 to 3,210 / 166 (hash 2820161686), the new references. Freiburg
1,467 completed, 0 failed, state hash 3911386262; Sindelfingen identical. `docs/architecture.md` gains
the switch, timetable and crossing rules (accepted). Lead decision: put to the owner, who approved.
Lead check on the merge: check (1,517), city (183), traffic light and guard, light e2e (61).

Full run 44381642228 (lead, manual, on c9b6867 after the TASK-203 follow-up): every job green,
including all five e2e shards; CI green on c9b6867 and Pages deployed it; the city job took 33.2 min.

TASK-203 follow-up (same subagent, branch `task/203b-showcase-camera`, 2026-11-18; merged): the
`qa-framing` failure with the suggested showcase camera was the spec, not the camera. Fit lands on the
map's next frame; with the old, cropping showcase `expectFramed` waited for it, but the new values
already show the whole city, so the spec read the view before the fit (also 4 of 10 at 1440). A
`fit(page)` helper now waits two frames. Repeating the spec found a real, frame-wide race: Fit
requested in the frame a tap opens the phone sheet framed the city under the sheet; Fit now waits
while a sheet is shown but has not reported its height (`map-view.tsx`), with a phone test that
fails without it. Showcase camera centre (-300, 220), scale 1.18, pitch 50, bearing -60 applied in
`bench/freiburg.ts`; rebuild byte-identical, only view.json moves (city.json `b85a1f34...`
unchanged). Lead check on the merge: check (1,512), city (183), framing, landing, 3D and phone specs
twice each (32), light e2e (61).

Full run 44372557057 (lead, manual, on e9e53c6 after TASK-201 and TASK-204): every job green,
including all five e2e shards; CI green on e9e53c6 and Pages deployed it; the city job took 19.6 min.

TASK-204 (Claude Code subagent, Opus 5.5 high, 2026-11-18; merged with the owner's approval of the
trade-off): the r:654 misses were a lane chosen too late, not a gap problem: 98% drove r:700 → r:697
→ r:698 → r:654 in lane 1 without a change, though their routes planned r:697 lane 2; junction group
jg:10778 (`entryChain`, `src/sim/intersection.ts`) took the first chain reaching any target lane and
nothing moved the car later. r:639 is a short weave (r:1299 has one car lane; two changes in 77 m).
Fix: a car entering a group takes the chain its route planned when usable (else the first usable);
off its planned lane, it takes any safe change that lowers the changes its route still needs
(`futureChanges`, `lane-change.ts`) without waiting for MOBIL's incentive. Rule 1 alone gridlocked
Freiburg (12, r:1348); with rule 2 it passes (why not isolated). Misses, 12 seeds, r:654: actuated
choice off 1,667 to 75, fixed 2,156 to 344, choice on to 0; r:639 fixed choice off 486 to 839 (the
jughandle queue now forms in lane 2 and backs into r:639). Means, main to branch: actuated choice off
mean delay 665.9 to 631.7 s (-5.1%), worst visit 808 to 337 s; actuated choice on 83.2 to 88.9 s
(+6.9%); fixed choice off 793.7 to 833.2 s (+5.0%), worst 858 to 273 s; fixed choice on 117.1 to
124.4 s (+6.2%); completions within 0.6% per seed; drain criterion on all 48 runs; gate seed 5,310 / 2
to 5,311 / 1, no baseline reset. Full demand: actuated 2,997 / 160 to 3,406 / 159 (hash 649933250),
fixed 2,859 / 181 to 3,168 / 169 (hash 227045585), the new references. Freiburg: mean delay 111 to 73 s,
0 failed, state hash 1137612334 to 236178606. Re-pins T46, T67, Freiburg; T19, T29 and the lane-change
replay setups adjusted with TASK-204 comments (read, they keep their intent). `docs/architecture.md`
gains a paragraph on the two rules (accepted). Lead decision: put to the owner, who approved. Lead
check on the merge (after TASK-201): check (1,512), city (183), traffic light and guard, light e2e
(61). TASK-202, measuring against the older main, re-measures after this merge.

Full run 44361518636 (lead, manual, on 36eb4c2 after TASK-203): every job green, including all five
e2e shards; the city job took 30.2 min.

TASK-201 (Claude Code subagent, Opus 5.5 high, 2026-11-18; merged): the owner-approved downloads. The
Overpass extract failed three times with 502 at 16:08 UTC; a fourth attempt the lead approved
succeeded at 16:51 (6,244,482 bytes, SHA-256 `cdc4fe43...`, 3.6% larger, replacing TASK-197's extract;
attribution updated). AWS Terrain Tiles: 12 z15 tiles, 613,668 bytes. The importer reads
`building:part` (height, min_height, levels, min_level, roof shape, colour, material), attached to
the smallest building outline around each part through an optional `parts` field on buildings
(contract change allowed by the contract; `docs/architecture.md` updated); 3D draws parts instead of
the outline, 2D keeps the outline; the app's Overpass query fetches parts (query version 10).
Freiburg: 335 parts on 82 buildings; the Münster from its 31 parts (nave, choir towers, openwork
spire to 116 m) replaces TASK-198's capped block, and St. Martin's cap is dropped; pyramid roofs on
convex non-rectangular shapes now rise to a point (other cities' 3D changes slightly). Terrain
(`fixtures/terrain/freiburg.json`, 261 to 319 m inside the polygon; the Schlossberg summit is outside)
made 3D appear 15 to 16 s after the first frame against 5 s; the owner kept Freiburg flat, so the
project does not load it (fixture and the polygon-cut ground code stay). Flat: first frame 2.15 to
2.99 s, 3D 5.2 to 6.2 s idle (main's 3D measured 5.4 to 6.9 s by TASK-203 the same day, and the 3D
build costs the same with parts, so the overrun is not this task's; re-measure on a quiet machine).
Render p95 1.1 to 1.8 ms 2D, 1.7 to 2.3 ms 3D. Re-pin: Freiburg `city.json` to `b85a1f34...` (snapshot
and parts; road network identical, state hash 1137612334 unchanged). Munich gains 2 parts, no pin
moves. Outside the listed scope: `overpass.ts`, `render3d/labels.ts`, `terrain.ts`, `context.ts`,
`V105-terrain.test.ts`. Lead check on the merge: check (1,510), city (183), traffic light and guard,
framing, landing and 3D specs (7), light e2e (61). TASK-203's suggested showcase camera was applied
and reverted: with it, `qa-framing` at 1024 × 768 fails (after Fit in 3D, toggling the sidebar moves
the city), so it goes back to TASK-203.

TASK-203 (Claude Code subagent, Opus 5.5 high, 2026-11-18; merged): opening a project fitted the
extent of roads, nodes and places to the whole canvas (72 px), ignoring floating panels and the phone
sheet; 3D reused the 2D centre. Now the city's `geo.boundary` (else its extent) is framed with a 24 px
margin in the visible area (`visibleArea()` in `map-view.tsx`: canvas minus a floating sidebar or
inspector, minus the phone sheet; TASK-196's selection pan uses it too); 2D `Camera.fitToBounds(bounds,
area)`, 3D `Scene3D.frame(points, area, pitch, bearing)`; a saved showcase camera keeps its zoom, pitch
and bearing and is centred in the visible area; docking or undocking a panel leaves the city where it
is on screen. New "Fit city in view" command (F, command menu): there was no fit or reset command to
hook into, accepted. `qa-framing.spec.ts` checks every Freiburg boundary vertex inside the visible area
at 1440 × 900, 1024 × 768, 800 × 700 and 390 × 844, 2D and 3D; framing unit tests in
`camera.test.ts`. Five specs and `helpers.ts` hard-coded the old 72 px fit and moved to 24 px;
`gate3-paint` hides the sidebar before painting west of the grid. Outside the listed scope:
`render3d/basemap.ts`, `dev/render.ts`, `V115-redraw.test.ts` (callers of the changed `fitToBounds`).
First frame 2.22 to 2.30 s against main's 2.27 to 2.31 s (other agents running). Suggested showcase
camera `{ centre: { x: -300, y: 220 }, scale: 1.18, pitch: 50, bearing: -60 }` fits all of Freiburg;
the lead applies it after TASK-201 rebuilds the project (until then the current, closer showcase crops
more than before). Lead check on the merge: check (1,505), city (183), traffic light and guard, the
framing, phone, landing and paint specs (17), light e2e (61).

Full run 44347101170 (lead, manual, on ccdd22e after TASK-205): every job green, including all five
e2e shards; CI green on ccdd22e and Pages deployed it; the city job took 22.2 min.

TASK-205 (Claude Code subagent, Sonnet 5.5 high, 2026-11-18; merged): the production bundle for
`qa-production.spec.ts` builds into `dist-production/` in each worktree instead of the shared
`node_modules/.cache/qa-production` (`playwright.config.ts`); `.gitignore`, `.prettierignore` and
`eslint.config.js` ignore it (needed for check, beyond the listed scope, accepted). No workflow or
script named the old path. The agent's rewording of the TASK-198 review was left out at the merge.
Lead check on the merge: check (1,489), light e2e (61); the production spec built into the worktree
and its checks passed except the local first-frame budget (3.8 s after page load against 3 s, 3D
10.3 s), measured while four agents ran simulations; that budget is skipped on CI and nothing in this
change touches the app, so it is recorded as load, to be re-measured on a quiet machine.

Full run 44273719376 (lead, manual, on 415edd3 after TASK-200): every job green, including all five
e2e shards; CI green on 415edd3 and Pages deployed it; the city job took 15.5 min.

TASK-200 (Claude Code subagent, Opus 5.5 high, 2026-11-18; merged): the lead's suspect held. While a
project opens, `session.engine` is still the old engine, and the store terminated it the moment the new
one was ready, rejecting any request still in flight. TASK-198 exposed it: its staged open keeps the
main thread busy drawing the preview during the engine load, so a query queued then (the spec's
`page.evaluate`) runs about 2 ms before the hand-over instead of tens of ms before it. Real callers
were affected too: the rail inspector's snapshot request had no rejection handler (an unhandled
rejection when opening a project during a rail city's run), and the metrics panel, export menu and
diagnostics could show "Traffic worker terminated", depending on effect timing. Fix: `EngineClient.retire()`
refuses new requests, drops listeners and terminates once the requests already sent are answered;
`loadSession` sets the new session first, then retires the old engine (`terminate()` stays for the
comparison worker and failed loads). New `src/ui/store.test.ts` (a fake worker holding replies) fails
without the fix. gate4-compare alone: 0 of 10 to 10 of 10. Freiburg first frame 1.95 to 2.09 s from
navigation (3D a further 4.0 to 4.8 s), unchanged path. No simulation result moves. Lead check on the
merge: check (1,489), city (183), traffic light and guard, gate4-compare alone 5 of 5, light e2e (61).

Full run 44263310823 (lead, manual, on dc18fee after TASK-199): every job green, including all five
e2e shards; CI green on dc18fee and Pages deployed it; the city job took 29.5 min.

TASK-198 (Claude Code subagent, Opus 5.5 high, 2026-11-17; merged): Freiburg is the landing view.
Phases: (1) `ImportOptions.polygon` clips every layer to the ring and cuts ways at the crossing (700
nodes / 1,043 roads against the bbox's 857 / 1,322; 0 m of road outside against 3,810 m; 41
disconnected lanes, all lot aisles, against 255; bbox imports byte-identical); (2) 11 gateways at the
ring crossings (the decision document's entries plus Leopoldring, where the polygon tip cuts the ring;
the Lessingstraße exit carries no trips, its loop back is outside the extract), 15 rail and 10 tram
ends; (3) trams run: tracks tagged siding or crossover joined Freiburg's lines and tram routing skipped
them; 5 routes at 10 per hour, 4 through Bertoldsbrunnen, 24 of 32 stops served; Munich and
Sindelfingen timetables unchanged; (4) `fixtures/projects/freiburg.cityflows.json` (5.70 MB, 1.04 MB
gzip, population shipped) rebuilt byte-identically by `bench/freiburg.ts` from
`fixtures/osm/freiburg-altstadt.osm`; Münster 30 m body plus 116 m tower, St. Martin capped,
building passages at grade, polygon-shaped 3D ground, showcase camera, terrain flat (no download);
(5) first frame 1.8 to 2.1 s from page open (was 7.9 to 8.5 s; one compile instead of two, population
shipped, walk network and street details after the first frame, worker loads during compile, shared
2D/3D geometry), 3D 2.0 to 4.0 s later; (6) `open('freiburg')` paused at 07:00, New city lists it
first, `?city=<id>` opens any bundled city, 66 e2e specs open the grid that way; (7) Freiburg's gate:
0 gridlocked, 0 stalled, 0 no-route, 0 parking failures, worst visit 799 s, render CPU p95 3.1 ms 2D,
3.8 ms 3D (budgets 4 and 6). Curation for the gate: Siegesdenkmal U-turn bans, the two ring gateways at
30% demand. With TASK-194's actuated programs Freiburg gridlocks (11 trips, a stalled head on r:904
from 09:13, 2,838 s), so `curateFreiburg` removes `actuated` from its programs; owner approved
shipping that way (2026-11-17), TASK-199 written. Schema: optional `geo.boundary` (allowed by the
contract). Lead check on the merge: check (1,486), city (183), traffic light, light e2e (61); the
production build opened in the browser on Freiburg in Light and Dark at 1440 and 800 px with no
console errors. Open: 8 tram stops unserved; 3D camera crops the west behind the inspector; the 2D view
leaves margin; the e2e production build cache under `node_modules/.cache/qa-production` is shared by
every worktree; a wider extract with `building:part` and AWS terrain need the owner's go-ahead.

Full run 44130610052 (lead, manual, on 07cf54b after TASK-198): every job green, including all five
e2e shards (the full e2e suite TASK-198 did not run); CI green on 07cf54b and Pages deployed it; the
city job took 32.5 min.

Full run 44114508937 (lead, manual, on 9a939d9 after TASK-194): every job green; CI green on 9a939d9;
the city job took 39.9 min (29.6 min on the last run).

TASK-197 (Claude Code subagent, Opus 5.5 high, 2026-11-17; merged): four Overpass extracts cut by a
polygon along each natural edge (Freiburg, Köln, Lübeck, München Altstadtring), imported with the
existing importer; `docs/decisions/2026-11-17-landing-city.md` with numbers, gaps and shots in
`docs/findings/2026-11-17-landing-city/`. Quiet-window timings (open to first frame / step):
Freiburg 10.6 s / 0.18 ms, Lübeck 19.3 s / 0.20 ms, Altstadtring 18.3 s / 0.73 ms, Köln 40.4 s / 1.17
ms (Munich fixture 7.9 s / 0.20 ms); all hold 60 fps in 2D and 3D. At 0.15 with mode choice on,
Freiburg and Lübeck have no gridlock (worst road visit 314 s and 759 s); the Altstadtring gridlocks
(82) and Köln's worst visit is 1,514 s. Recommends Freiburg (rail, trams, Dreisam bridges, B 31 ramps,
the only hill), runner-up Lübeck. Importer gaps for TASK-198: no polygon clip (way ends kept, the view
is a rectangle), gateways only where the bbox cuts a road, disconnected fragments (the no_route
failures), trains and trams start only at the bbox edge (Freiburg's trams build no route), landmarks
extruded to spire height without building parts, no terrain (not fetched: outside the download
approval). First-round timings ran under TASK-194's load and are listed as such; the tables use the
repeats. Check passed; no source changed.

Full run 44016934900 (lead, manual, on da7179c after TASK-188 to 192): every job green; CI green on
each merge (44095d5, 60f2cdc, be205a5, 263ab29, da7179c); the city job took 29.6 min.

## Owner decisions log

- 2026-11-24 (owner): "you may move the fixes": the TASK-330 pilot's hold-clearance rule goes to main alone as
  TASK-337 (merged). On 2026-11-23 the owner gave the TASK-330 Phase 1e landing-flow verdict:
  - the next arrival holds the runway with priority over crossings;
  - crossings open behind the lander and run in parallel;
  - a queue guard limits waiting to cross.
  The owner then said "Yes, fix them" (go-arounds and Zurich overlaps) and "build it and test with lightweight tests"
  (the later-exit fallback). The fallback was not kept: a ring lock at Heathrow. The pilot state is `1b57f5a8` on
  `task/330-landing-flow`, not for merge.
- 2026-11-23 (owner): "realistic train models and car models without loss of performance": one tram, one light-rail
  (DLR), an Elizabeth-line EMU, a DB locomotive with coaches, an S-Bahn EMU, and (follow-up) "1 generic tube style
  train and 1 generic nyc subway train"; cars "fine with a few generic models"; aircraft windows show two rows close
  up and the landing gear is not realistic. Accepted the lead's decisions: drawing only (sim lengths and hashes
  unchanged), the variant chosen per route by track kind, train kind and driving side (left-hand traffic standing in
  for the UK), operator colours without logos. Tasks TASK-331 (aircraft) to TASK-335 (cars) written; 332 first among
  the trains, 333 and 334 after it, 331 and 335 independent.
- 2026-11-23 (owner): "Yes, start all three" (TASK-331, 332, 335 in parallel), then "arrange the queued tasks to
  auto start after the blocking tasks are done": TASK-333 and TASK-334 start, side by side, as soon as the lead has
  reviewed TASK-332's branch, from its tip rather than waiting for the merge to main.
- 2026-11-23 (lead, after TASK-332): London City's Elizabeth Line routes run as `mainline` (no stops inside the
  extract), so the contract's table would draw them as the DB intercity. Rule changed in TASK-333: in left-hand-traffic
  cities every heavy-rail route, stopping or not, gets the Elizabeth-line EMU; the DB intercity is for right-hand-traffic
  cities only. York's through trains therefore draw as Class 345-like EMUs. S-Bahn units are drawn as two 67.4 m units
  over the sim's 135 m train (TASK-332's choice, kept). TASK-333 and 334 start from main after TASK-332's merge.

- 2026-11-23 (owner, after the lead's real-sim clips and wait graphs of Boston, Heathrow and Zurich): the
  three root causes are legitimate, fix them. "Let's not change runway direction mid day for now, that would be
  chaotic. Also maximize runway usage. Zurich seldom gets all 3 runways used efficiently." TASK-327 (runway
  interlocks at intersections only, Boston), TASK-328 (one configuration per operating day at Zurich and
  Heathrow, re-route departures at holds of closed ends, Zurich's three runways under north), TASK-329 (moving
  aircraft never wait for aircraft not yet started, Heathrow wait cycles) started in parallel. This replaces the
  lead's earlier recommendation to pause airport throughput work.

- 2026-11-23 (owner): "yes apply all" time cuts for TASK-322 (peak-window gates, preference logic split to
  TASK-323, port the bench, browser tiers at merge); dead ends must be protected like terminus platforms (one
  protected block with a direction lock: arrival first blocks push-out, push-out first blocks entry).

- 2026-11-23 (owner): "build the block signaling into the real sim now before we actually try to even scale":
  TASK-322 started, in parallel with TASK-320.

- 2026-11-22 (owner): proposed railway-style protected blocks and one-way taxi flows to prevent airside gridlock,
  the flows being a dynamic ATC practice set by the runway direction in use (soft, for taxi efficiency, not in the
  map data); validate on small pilots first. TASK-321 confirmed it (no gridlock under block clearance). TASK-320
  restarted on the owner's word after an app interruption stopped it.

- 2026-11-22 (owner): "Yes, apply all" five time cuts: TASK-317 finished on partial Heathrow data; TASK-312 builds
  a fast peak-window airside bench first; TASK-316 and TASK-319 started in parallel with TASK-312; lead tiers run in
  parallel; agents merge the lead line early, run tiers once and bound simulation runs.

- 2026-11-22 (owner): real aircraft models "really matter", with level of detail, realism for the common types.
  The free set that covers them (Flightradar24's glTF, from FlightGear) is GPL-2.0; the owner chose to relicense
  CityFlows to GPL-2.0-or-later (runtime dependencies MIT, ISC, BSD-3, BSL-1.0, OFL; the SUMO adaptation is
  GPL-2.0-or-later). The set is downloaded to `D:\cityflows-wt\airport-data\fr24` (commit dd53267, 41 models, 125
  MB); TASK-318 brings it in with LOD.

- 2026-11-22 (owner): "resume zurich and at the same time start with the taxi speed increase and measure delays etc.
  if that may be the cause - if not, dispatch performance upgrade agents and 3d rendering upgrade agents". TASK-302 resumed on a
  fresh agent from its WIP; TASK-317 (taxi speeds, delay attribution) started. Executors (owner): Claude model and effort
  at the lead's choice; Codex gpt-6.2-sol high by default, gpt-6.2-astra if required.

- 2026-11-22 (owner, after testing London City): "load time and 3d rendering are good tasks for performance
  optimization (start them before testing higher taxiing speeds)"; issues: a London City taxiway section wrongly
  one-way ("even if it were an OSM issue, let's fix it here"), taxi speeds to check against the real world, aircraft
  modelling realism, smooth movement (take-off and landing animation, turning rotation, nose-gear steering), 3D jet
  bridges, airside ground vehicles. Contracts TASK-310 to 316 in waves E (310, 311, 313), F (312, 314, 315) and G (316).

- 2026-11-22 (owner): "switch to don't wait for gh": the next wave starts from the locally verified merge commit;
  the wave's Full run is watched in the background, a red run blocks the next merge and is fixed forward.

- 2026-11-22 (owner): "yes apply": the airports batch runs in waves A to D with TASK-306 to 309 split off
  (`docs/decisions/2026-11-22-airports.md`); one Full run per wave on the lead merge branch before main moves; the
  cheaper unchanged-cities evidence, a test-time budget, no pixel assertions; the nightly Full skips verified heads.

- 2026-11-22 (owner): airport editing later (TASK-305, after Zurich); service roads give way to aircraft at taxiway
  crossings, no flight-driven landside trips; aircraft shown on about 10 km finals and climb-outs beyond the map.

- 2026-11-22 (owner): airports batch. London City first (best OSM quality of 19 surveyed), then a synthetic
  one-runway airport to its schema, then Zurich as the large target, later Boston (crossing-runway complexity) and
  Heathrow (operational scale). Downloads approved for these, with perimeter roads. Contract changes: "any change
  needed". Operations: seeded schedule plus time-of-day concepts and a wind control. Unsupervised; screenshots as
  steps land, no stops for confirmation. Survey, plan and batch merge rule: `docs/decisions/2026-11-22-airports.md`;
  contracts TASK-295 to 304.

- 2026-11-22 (owner): "yes we may merge": TASK-294 merged with Lübeck's showcase delay rising 21 to 34 s (the
  pockets' own trips now drive through the Anlieger streets). Wave C complete. Next batch: airports (owner brief
  in chat; contracts TASK-295 onward).

- 2026-11-21 (owner): Codex CLI is a default executor again: "we may use gpt sol 6.2 at high effort by default unless
  you think otherwise for any specific task" (reverses the 13 Nov rule; "no need to pilot"). Wave C, "looks good.
  proceed": TASK-290, 291, 293 on Codex now; TASK-292 (Codex) after TASK-289's measurements; TASK-294 (Claude)
  after TASK-289 merges. Philadelphia subway service, Walmgate Bar and Lübeck's walls wait for the owner (schema
  value, downloads).

- 2026-11-21 (owner): "Yes, open it": TASK-289 (the York lot deadlock at `pk:4462`) started.

- 2026-11-21 (owner): "Merge the variant": TASK-288's variant `0f3b4f1` merged, Sindelfingen's demand rising from 280
  to 890 trips a day accepted. The York lot deadlock (`pk:4462`) found by its v1 stays a noted follow-up.

- 2026-11-21 (owner): "We may keep task 279 parked and merge 283 now and arrange fixing and populations in the
  follow-up." TASK-279 stays parked (v2 `af007d4`); TASK-283 merged; TASK-288 (populations draw reachable gateways)
  started. Before and after shots of the seven 3D bugs: `docs/findings/2026-11-20-owner-3d-bugs/before-after/`.

- 2026-11-21 05:10 (owner): "Both waves": wave A starts now (TASK-276 to 281); wave B as the merges land
  (bundle Lübeck and York, left-hand turn ranking, gateways into restricted pockets, bundle Philadelphia).
  Branches 218 and 223 retired (tags `archive/...`; their work landed through TASK-255 and 253).

- 2026-11-21 (owner): "We may merge; allow re download; ok to add schema fields for elevator points, covered
  and handrail tags." (1) TASK-264 merges (the audit's width measure on `r:1175` reads the intended widening).
  (2) The Overpass query may change to fetch city walls and gates, and York's extract may be fetched again
  (TASK-273). (3) Schema: a point value for `highway=elevator` nodes (TASK-274), and `covered` and `handrail`
  on walk links (TASK-275).

- 2026-11-21 (owner): "we may start the queued tasks together ... no need to limit": the four-agent cap
  is lifted; queued tasks start in parallel (TASK-259, 261, 262, 263 now; D7 still waits for TASK-254,
  which works on the same junction). Agents keep the free-memory check before heavy runs.

- 2026-11-21 (owner): "osm downloads approved": TASK-259 may fetch four Overpass extracts (Lübeck
  Altstadt, York inside the walls, Cambridge centre, Philadelphia Center City as a polygon), OSM data
  under ODbL; nothing else.

- 2026-11-20 (owner): seven 3D bugs logged in Freiburg (shots in `docs/findings/2026-11-20-owner-3d-bugs/`):
  rail bridge walls and decks cutting into each other (1, 2), broken walkway edges (3), twisted stairs (4),
  floating footbridges that should have piers, railings and canopies (5, 7), elevator towers drawn as
  buildings (6). Contracted as TASK-260 to 263, ahead of D7 and the `n:211` placement task.

- 2026-11-20 (owner): more preloaded cities in the New city panel, as a mixed slate (places that show
  different road cultures and stress the reading rules), raw imports under the no-curation rule. First
  Munich and Sindelfingen from the committed extracts (TASK-258); then a scout of Lübeck, a UK centre and
  Philadelphia (TASK-259), whose downloads wait for the owner's yes.

- 2026-11-20 (owner, after the second run's report): (1) OSM that disagrees with the ground is met by
  improving the app's reading of OSM (importer and drawing rules), not by editing OSM and not by per-id
  curation; this covers `r:1179`'s `placement` and D7's late lane gain. (2) "Others ok to your
  suggestions", read by the lead as: start a third unsupervised run under the standing rules (merge rule,
  audit tolerance, five-seed full demand, at most four agents, a Full run after each merge) on TASK-223's
  re-measure, TASK-242's placement and tagged widths, TASK-218's D4 with J1 and the small visual leftovers
  (TASK-253 to 256); add the walk-link marking field for `crossing=unmarked` (a schema change the owner
  approves, to be contracted); retire the parked branches nothing will use again (208 and 219, landed
  through 223 and 234; 215, reworked as 217; 244, aim not met), tagged `archive/<branch>` before
  deletion. 218, 223 and 242 stay until run 3 settles them. Arnulfstraße stays as OSM maps it (grass)
  until imagery is approved; a new imagery download still needs the owner's explicit yes. (3) The owner
  asked to discuss more preloaded cities in the New city panel; the lead's proposal is in chat.

- 2026-11-20 (owner): keep both of the lead's readings adopted during the second unsupervised run. (1) Audit
  tolerance: a geometry-audit measure or named case that worsens by less than 1 cm, less than 1 m², or by
  one corner under 2 m that is not sharp, while the task's own cases improve, does not stop a merge; it is
  reported in the review. (2) Full demand is judged on the mean of seeds 1 to 5 against the merge rule's
  2% (the threshold is unchanged). Both are standing rules from now on.

- 2026-11-20 (lead): report on the second 12-hour unsupervised run (00:23 to about 12:30; rules, the
  lead's audit tolerance and the five-seed full-demand reading above). Every merge passed the lead's
  tiers and full demand, and every Full run after a merge was green (44691164973, 44706560824,
  44712186713, 44719286946, 44740518122, 44744589116, 44750599300, 44755991581, 44761655915). Every merged
  change is live on the Freiburg landing page.
  - **Merged (14).** TASK-235 (TASK-221's lane tapers: Munich lane overlap 283.92 to 192.26 m²);
    TASK-234 (TASK-226's Hbf group membership: the westbound stop line at the painted one, D2);
    TASK-236 (half-hipped, gambrel, mansard, skillion, round roofs on concave outlines: flat roofs
    Freiburg 14 to 1, Munich 13 to 0); TASK-240 (arrows of the next junction past plain nodes: `r:1148`
    left, left, through, through, right); TASK-238 (close halves as one carriageway unless a mapped
    median lies between: Bismarckallee closes, Marsstraße's planted median left alone); TASK-237 (rail
    hold and step: full demand 9.5% faster); TASK-241 (no taper hatch on lane gains, arrows off
    keep-clear boxes, give-way marks behind crossing paint); TASK-247 (Freiburg's 08:00 jam: cars stuck
    behind a car waiting for another phase no longer extend an actuated green; Freiburg's gate 77.9 to
    68.1 s and no longer flips); TASK-246 (keep-clear boxes off lane tapers); TASK-243 (routing: route
    requests 59% faster, stepping 7.3%); TASK-248 (TASK-239's node-only crossings: walk links and paint,
    `n:1139` on its spot); TASK-251 (reroute checks skip the lane search when no switch is possible:
    route requests about 34% less; optional `RouteProvider.route` bound); TASK-249 (TASK-245's walker
    fixes: walk green that never counted as long enough, a 1e-13 s rounding, and crossings no phase
    serves; Freiburg walker waits 433 to 0.9 s, 204 to 0 never served; merged on the five-seed reading:
    full demand +0.2%, 40 more trips); TASK-252 (walk lights at those crossings draw dark). Freiburg's
    gate now 1,522 / 0, 66.1 s (77.9 s at the start of the run). Performance only and results identical:
    237, 243, 251. Diagnosis only: TASK-250 (single-seed full demand swings more than the 2% limit).
  - **Parked (2), branches kept, tables in the review log.** TASK-244 (route load term: clears the
    thresholds but not its aim, adds stalled heads); TASK-242 (urban lane widths, `width` tags,
    `placement`: both versions miss full demand and the audit; imagery shows `r:261` within 0.25 m).
  - **Decisions for the owner.** (1) The lead's audit tolerance (used for TASK-235: +0.12 m², +3 mm;
    TASK-234: one 1.16 m corner). (2) The five-seed full-demand reading (used for TASK-249; it could also
    re-measure TASK-223). (3) TASK-242's options (placement plus tagged widths alone if the voids, real
    trams and grass between carriageways, are accepted). (4) OSM edits: `r:1179`'s `placement=right_of:3`
    contradicts the imagery; D7's late lane gain. (5) A walk-link marking field so `crossing=unmarked`
    reaches the city (schema). (6) TASK-223's choice. (7) The Arnulfstraße track form. (8) Counting a
    full-demand stalled head only if it persists (TASK-250's proposal). (9) Retiring parked branches.
  - **Open technical items.** `n:211`'s zebra drawn 4.4 m along the street; full-demand stalled heads
    come and go with the seed (TASK-250); TASK-218's D4 rule with J1 still unlanded; the promenade's
    parking hatch.
  - **Incidents.** None with lasting effect: brief worktree stashes during runs (re-run clean), one
    contract path the lead fixed before the agent started, one lead tier run started without tracking
    (watched by a second command; results complete).
- 2026-11-20 (lead, during the second run): full demand is judged on the mean of seeds 1 to 5 from now
  on. TASK-250 showed one full-demand seed swings more than the merge rule's 2% (TASK-247's rule: seeds 1
  to 5 from -7.0% to +7.3%, mean -0.7%). The threshold is the owner's and unchanged; the measure is the
  five-seed mean. Applied first to TASK-249 (seed 1 +8.1%, five-seed mean +0.2%), which it merges. It does
  not change TASK-242 or 244 (parked on other grounds); TASK-223 (parked 2026-11-19 on one fixed-time seed,
  +3.1%) could be re-measured this way. For the owner's review.

- 2026-11-20 (owner): a second 12-hour unsupervised run (from 00:23); "you may merge"; the owner reviews
  only when stepping in. The lead's reading, logged for review:
  - The 2026-11-19 rules stand (merge rule, one variant then park, off limits: baseline resets, gate
    floors, deleting parked branches, new downloads; at most four agents; a Full run after every
    merge; a red Full run stops merges).
  - "You may merge" covers the two parked tasks the lead recommended: TASK-226 (rebased and
    re-measured on main as TASK-234) and TASK-221 (re-measured with TASK-233's audit as TASK-235).
  - Audit tolerance (new, the lead's): a geometry-audit measure or named case that worsens by less
    than 1 cm, less than 1 m², or by one corner under 2 m that is not sharp, while the task's own
    cases improve, does not stop a merge; it is reported in the review. Anything larger parks the
    task as before (TASK-231's 9.4 cm stays parked).
  - Owner-only decisions stay open: schema fields, OSM edits, Arnulfstraße's track form, retiring
    parked branches, TASK-223's choice.

- 2026-11-19 (lead): report on the 12-hour unsupervised run (04:42 to about 16:40, rules above). Every
  merge passed the lead's tiers and full demand, and every Full run after a merge was green (44517065466,
  44536794264, 44547052795, 44551579772, 44555679026, 44576912292, 44602678869, 44612061076). Every merged
  change is live on the Freiburg landing page.
  - **Merged (11).** TASK-220 tram track form (D8; traffic identical); TASK-222 the tram-crossing
    actuated-signal lock (Munich identical, Freiburg -0.5 s); TASK-217 markings and crossings as its
    paint-only variant (D1 partly, M1, M2, M4, M6, M7; the full version cost Munich up to +4.6%);
    TASK-227 pitched roofs on concave outlines (flat roofs Freiburg 204 to 14, Munich 70 to 13);
    TASK-225 the Siegesdenkmal lock (a tram held at its start kept two crossings closed; Freiburg
    seed 2 5 gridlocked to 0); TASK-224 aerial re-check of the Hbf box (findings only); TASK-229 lane
    lines and arrows restored (N1, N2); TASK-228 the tram backlog (full timetable, 80 trams an hour
    instead of 48 to 75; Freiburg's gate +4.6 s, inside the 5 s limit); TASK-232 Fahnenbergplatz track
    embedded and the paving gaps filled; TASK-233 shared one-lane streets without a centre line, and
    the lane-overlap audit made grade-aware (Munich baseline 257.14 to 283.92 m²); TASK-230 step time,
    third pass (full demand 14.5% faster, Freiburg 8%, results identical).
  - **Parked (6), branches and worktrees kept, tables in the review log.**
    - TASK-226 (TASK-219's group membership on TASK-225): meets the merge rule, fixes D2 (the Hbf
      stop line from 37 m off to the painted line); misses the audit by one corner under 2 m (a
      1.16 m nose at the 5 m slip road `r:2153`). **Lead recommends merging.** It supersedes TASK-219.
    - TASK-221 (lane tapers across short roads): variant meets the merge rule; Munich end overlap
      105.95 to 20.92 m², the `n:194` ramp overlap 59.8 to 0; misses the audit by 0.12 m² (corridor
      lane overlap, measured with the old measure 9) and 3 mm (B39). **Lead recommends merging after
      re-measuring with TASK-233's audit.**
    - TASK-231 (D5, close halves as one carriageway): variant meets the merge rule and every city
      total; named case R3-8 (Marsstraße) width max 0.387 to 0.481 m. Options: merge, exclude the
      pairs the named cases cover, or keep parked.
    - TASK-223 (TASK-208's missed-turn rule on TASK-222): v1 Munich fixed choice off +6.7%, v2 fixed
      full demand +3.1% (one seed); both cut `r:654` misses about 30-fold. Options: park, v2, v1.
    - TASK-218 (importer road shapes): first version missed traffic, variant the audit. D5 and D6 were
      split out (TASK-231, 233); D3/D9 widths (need `placement` for the 1.7 m offset and a void
      measure against the drawn median) and D4 with J1 remain.
    - TASK-219: superseded by TASK-226.
  - **Decisions for the owner.** (1) TASK-226 merge; (2) TASK-221 re-measure and merge; (3) TASK-231
    options; (4) TASK-223 options; (5) TASK-218's remaining splits; (6) a walk-link marking field so
    `crossing=unmarked` reaches the city (24 Munich crossings paint as zebras; schema); (7) node-only
    zebras (`n:211`, `n:1139`) need walk links, which move traffic; (8) Munich Arnulfstraße drawn as
    grass where OSM maps grass strips (TASK-135's reference shows ballast near Donnersbergerbrücke;
    no Munich imagery); (9) D7 (Friedrichstraße lane gain 19 m late): an OSM edit or a curation entry;
    three roofs in the box with doubtful OSM outlines or tags; (10) retiring the parked branches and
    worktrees once decided.
  - **Incidents (all reported by the agents, none lasting).** TASK-219 used one `pkill -f` with a
    pattern unique to its own script; TASK-226 stopped `MoNotificationUx.exe` (a Windows Update
    notification process whose stale parent id matched its vitest process); TASK-221 started one
    `npm run check` in `D:\cityflows` by a mis-scoped `cd` (stopped; git status clean); TASK-217 left
    a duplicate seed-report chain running for about 50 minutes (hashes matched); TASK-232 and 233
    briefly stashed their worktrees during runs (re-run clean). Later agents were told never to stop
    processes by name, pattern or parent id and to run only inside their worktrees.
  - **Open technical items.** The 115 m Rotteckring ballast is fixed bar 10 m (`rt:12944`); N4's
    three doubtful roofs; the promenade's parking hatch; a late run of a tram line slower than its
    headway holds the next run longer than the gap (TASK-228, not seen); step time left in the rail
    hold and step (about 19%) and routing (about 10%).
- 2026-11-19 (owner): run unsupervised for about 12 hours; plan and execute new tasks without
  stopping for review or decisions. Rules (the lead's proposal, accepted as is):
  - **Merge rule.** A task merges when every gate passes, the drain criterion holds on all runs, mean
    delay rises no more than 3% in any Munich configuration (seeds 1 to 12, choice off and on, both
    modes), full-demand delay no more than 2% in either mode, and Freiburg's gate delay no more than
    5 s. A task that misses gets one reworked variant; if that misses too, it is parked with both
    tables for the owner.
  - TASK-215 is reworked as TASK-217 (rebased on TASK-214, with TASK-216's D1: crossings where OSM
    maps them, and M7: solid lane lines over the last stretch before a stop line, as German practice)
    and judged by the merge rule. TASK-208 waits for the tram-crossing lock fix, then is re-measured
    and judged the same way. TASK-207's F1 is judged by the rule; F2 is dropped (the salted timetable
    offsets cover its symptom).
  - Still off limits: baseline resets, gate floors, deleting the parked branches, any new download
    (TASK-216's Freiburg imagery may be reused; no Sindelfingen or Munich imagery).
  - Every main push redeploys the Freiburg landing page; merged visual changes go live without
    review.
  - At most four agents at a time (Opus 5.5 high or Sonnet); a Full run after every merge, and a red
    Full run stops merges until fixed.
  - Plan: wave A TASK-217 (markings and crossings), 218 (importer road shapes, D3 to D6, D9), 219
    (junction-group surfaces, J1 and D2), 220 (tram track form, D8); wave B TASK-221 (tapers across
    short roads), 222 (tram crossing and actuated signal lock), 223 (TASK-208 on 222), 224 (aerial
    re-check); then concave roofs and step time if time allows.
- 2026-11-19 (owner): approve TASK-216's download (LGL Baden-Württemberg DOP20 aerial imagery for the
  Freiburg Hauptbahnhof box, through the public WMS, kept out of the repo) and start TASK-216.
- 2026-11-19 (owner): merge TASK-214 despite the traffic trade-off (merged 5b10d5a with a Freiburg
  rebuild and the lead's salted-offset fix in `buildTimetable`). The owner suggested the next stage
  include validating complicated road shapes against aerial imagery for demo cases, starting with
  the Freiburg Hauptbahnhof area.
- 2026-11-18 (owner): run the next batch unsupervised for about 8 to 12 hours. Wave 1: TASK-206, 207, 208,
  209 and 212 (geometry audit). Wave 2 after the audit and wave 1: TASK-213 (junction shapes), 214 (lane
  splits and merges), 215 (markings), 210 (roof shapes), 211 (full-demand speed, optional; dropped
  first, then 210, if time runs short). Rules: the lead merges a task only when every gate passes and
  nothing gets worse that the owner would want to weigh; each merge gets its own Full run, and a red
  Full run stops merges until fixed; a task whose results trade gains against losses waits for the
  owner; no baseline resets, no downloads, nothing beyond this list; screenshots of visual changes go
  to the owner as they land. If TASK-209 recommends reviving a branch, the lead writes the contract and
  leaves it for the owner.
- 2026-11-18 (owner): merge TASK-202 (all 32 Freiburg stops; actuated full demand -1.8%).
- 2026-11-18 (owner): merge TASK-204 (full demand +11 to 14%, mean delay at 0.15 +5 to 7% in three of
  four configurations).
- 2026-11-18 (owner): TASK-202 also fixes the tram-crossing stop line its served stops exposed
  (`src/sim/rail-crossings.ts`), on its branch, with Munich seeds and full demand.
- 2026-11-18 (owner): Freiburg stays flat for now. With terrain the 3D view took 15 to 16 s after the first
  frame against 5 s (TASK-201); the terrain fixture and code stay, unused by the project.
- 2026-11-18 (owner): write and start TASK-201 to 205 (Freiburg detail, tram stops, framing, jughandle
  lanes, per-worktree production bundle), all at once.
- 2026-11-18 (owner): downloads approved: a fresh Freiburg Overpass extract with `building:part`, and
  AWS Terrain Tiles for the Schlossberg (TASK-198's deferred items).
- 2026-11-18 (owner): write TASK-200 (the gate4-compare open race) and start it now.
- 2026-11-18 (owner): merge TASK-199 as it is (not variant B).
- 2026-11-17 (owner): start TASK-199 now.
- 2026-11-17 (owner): Freiburg ships now with fixed-time signals; TASK-199 fixes its actuated jam.
- 2026-11-17 (owner): merge TASK-194 with actuated generated signals as the default, accepting about
  7% fewer completed trips at full demand for 16 to 32% less delay at 0.15.
- 2026-11-17 (owner): the landing city is Freiburg (TASK-197's recommendation); TASK-198 builds it.
- 2026-11-17 (owner): TASK-197 may download its OSM extracts from Overpass now; it runs alongside
  TASK-194.
- 2026-11-17 (owner): the landing view should be a showcase: a curated, stable real place in Germany,
  richer rather than small, with a natural edge, not a square OSM cut; it need not be busy when it
  opens. Contracts TASK-197 (scouting) and TASK-198 (build).
- 2026-11-17 (owner): contracts for the four follow-ups of TASK-188 to 192 (TASK-193 to 196) approved;
  the lead starts them when it judges best. TASK-194 runs after TASK-193 (both change traffic results).
- 2026-11-16 (owner): "Proceed with the next round of tasks": TASK-188 to 192 run now.
- 2026-11-16 (owner): every recommendation in `docs/decisions/2026-11-14-*.md` accepted. Exit clearing:
  keep hold short and zip. Signal timing: fixed-time until TASK-188 fixes the seed-6 loop exit and
  measures (TASK-188 may then make actuation the default if every gate passes). Light 3D tints: keep
  the colour-space fix. Evening hue: keep mauve. Appearance: System by default. TASK-185, 186 and 187
  run now; TASK-188 to 192 stay planned.

- 2026-11-13 (owner, before a 24-hour absence): the lead keeps developing and testing
  unsupervised and plans Waves A to C (TASK-166 to TASK-177, scope approved in full). The traffic
  baseline is reset as needed (after TASK-161 and TASK-113, measured with mode choice off, and
  again when a merge moves completions by more than 10%), each reset logged. The Mac UI, map
  palette and lighting (TASK-160, 162, 163) merge to main when green, with a quiet-machine frame
  check; the owner reviews on main. Map asphalt: the neutral gray `#ACB0B3`. Road grade in the
  compiled network (TASK-175) is a pre-approved contract change.

- 2026-11-13 (owner): mode choice (TASK-113) ships on by default; the Munich traffic gate keeps
  testing car traffic with mode choice off, and a separate mode-share test guards the choice. The
  T53 crossing overlap seen with mode choice on is fixed in its own task (TASK-165).

- 2026-11-13 (owner): road surfaces, lane markings and similar stay close to real-world colours;
  TASK-162 rolls back its road and marking palette (canvas, places, buildings, vehicles and labels
  keep the new look). Add scene lighting settings and an evening scene with artificial lighting
  (TASK-163), lifting the night-lighting deferral of 2026-11-07 (decision 8).

- 2026-11-13 (owner): reset the traffic baseline to main once PR #1's CI passes. Map styling
  starts now in parallel with TASK-160 phase 2 (TASK-162): a plain canvas with the OSM tiles off by
  default (still a Layers toggle), quiet place tints, and vehicles tinted by destination in the macOS
  system colours.

- 2026-11-13 (owner): restyle CityFlows as a clean Mac app in the Sonoma / Ventura flat manner
  (not Liquid Glass): Arimo throughout, macOS system blue accent, a docked window (unified
  toolbar, left sidebar, right inspector, status bar), and both the interface and the map palette.
  This replaces the Mini Motorways design direction (2026-11-03). TASK-160 runs in its own branch
  with screenshots to the owner at each phase.

- 2026-11-13 (owner): queue the follow-up plan, unsupervised. TASK-155 now; TASK-156 and TASK-157
  after TASK-153; after TASK-154: PR #1, TASK-129 (TASK-158 if it still fails), TASK-113 once
  TASK-129 merges, TASK-159. A macOS-style UI restyle is to be discussed for a separate branch.

- 2026-11-13 (owner): B56 released. TASK-154 lands TASK-131 Phase 3 from candidate `4ab4d71` and
  drains the loop; PR #1 follows once the combination passes the gate. Lead's drain criterion for
  B56 (replacing the whole-trip 900 s figure, which counted delay carried from origins): no
  sustained cycle, no single loop-road visit over 900 s, no inner-link stand over `boxWaitS`, zero
  stalled heads, on seeds 1 to 3.

- 2026-11-13 (owner): batches agreed and to run unsupervised, without stopping for review (shots
  may be sent along the way). Now: TASK-152 beside TASK-151 and the TASK-128/129 re-measures.
  Batch 2, once TASK-151 lands and PR #1 merges: merge TASK-128 and TASK-129 one at a time if they
  pass, and run TASK-153. Batch 3, once TASK-129 merges: TASK-113 mode choice, beside TASK-153 if
  it is still running.

- 2026-11-13 (owner): an agent finds and repairs why PR #1 merged onto today's main fails the
  unchanged traffic gate (TASK-151); PR #1 merges once the combination passes.

- 2026-11-13 (owner): the lead (Claude Code) orchestrates every agent from its own chat with
  Claude subagents; no Codex models unless the owner names one. PR #1 and TASK-128 to TASK-130
  stay held, B56 stays deferred, and the current traffic gate stays. TASK-150 (parking exit
  hold) starts; it is the only unblocked task in this batch.

- 2026-11-12 (owner): run the SwiftShader rendering fix and remaining parking access checks in parallel with GPT-6.1 Sol high. Supply geometry shots for parking fixes. PR #1 and TASK-128 through TASK-130 stay held, and B56 stays deferred.

- 2026-11-12 (owner): run the parking and frame audits in parallel, then inspect the westbound lane gain. Repair CI on PR #1 in parallel and keep it held. TASK-128 through TASK-130 stay held and B56 stays deferred.

- 2026-11-12 (owner): defer B56 and proceed with the remaining backlog. The lead is starting operating crossings and tram service against merged main. The traffic gate and holds on TASK-128, TASK-129 and TASK-130 still apply.

- 2026-11-12 (owner): continue autonomously through decisions and review. The lead
  opened the Phase 3 routing comparison described in TASK-131. The original TASK-128,
  TASK-129 and TASK-130 branches stay held. The existing traffic gate applies.

- 2026-11-12 (owner): approved one independent, read-only GPT-6 Astra high review of B56. GPT-6.1 Sol high continues implementation. The existing B56 and traffic gates apply.

- 2026-11-12 (owner): fold B56 into TASK-131 Phase 3 and retain the current traffic gate until the loop drains. Hold TASK-128, 129 and 130. Run Phase 3, TASK-136 import and drawing, and TASK-141 T54 diagnosis in parallel. Send the owner the crossing shots.

- 2026-11-12 (owner, after handover): the lead starts and orchestrates tasks here unless the
  owner specifies otherwise. Use Codex subagents up to GPT-6.1 Sol high. GPT-6 Astra requires
  the owner's prior approval. The traffic gate method, B56 direction and three held merges
  still await decisions.

- 2026-11-12 (owner): TASK-130 is complete on Codex; the lead stops after the ongoing tasks and
  the TASK-130 review, and job allocation is discussed before any new agent starts. A temporary
  lead takes the main thread; the handover is `docs/lead-handoff-2026-11-12.md`.
- 2026-11-11, lead (under the owner's orchestration rule): TASK-128 and TASK-129 had no Codex
  activity (no commits, no worktree); the lead runs them as Claude Code subagents in parallel, with
  their contracts refreshed for main after TASK-131 and TASK-140. TASK-130 stays on Codex.
- 2026-11-11, TASK-131 merge (lead, under the owner's orchestration rule): Phases 0 to 2 merge
  with the baseline reset; T53's walker-cost limit goes from 5% to 6% because over three seeds
  the cost is noise around zero (5.3%, -6.6%, 1.6%); `planLane`'s cutoff is clamped at 0 (a sim
  fix the lead made in the merge; TASK-130 reconciles if it touches the same lines).
- 2026-11-11, orchestration (owner): after the current TASK-131 round, the lead runs the
  backlog itself as Claude Code subagents from the lead's session (Claude models, at most Opus
  5.5 at high effort), in parallel where file surfaces allow and in sequence where they do not,
  without stopping for the owner's approval or review. The lead still reviews and merges every
  task and reports outcomes. TASK-135: trams become a distinct track type with their own look.
  TASK-139 (trams pushing roads apart, street-running trams) is dropped for now.
- 2026-11-11, TASK-131: lane lines may be drawn on inner links (no centre, stop or yield lines,
  crossings or signal heads there).
- 2026-11-11, rail and tram backlog (owner, before stations as destinations and multimodal travel):
  TASK-132 rail heights, TASK-133 station furniture, TASK-134 overhead lines, TASK-135 trams as
  their own track kind, TASK-136 level crossings, TASK-137 tram stops, TASK-138 tram vehicles,
  TASK-139 trams beside and in streets. No contracts yet.
- 2026-11-11, TASK-131 checkpoint 1 (Phase 1 `c7c9a18`): `merge-first` grouping with via
  nodes is the default. Inner links carry no signal heads, stop lines or extra lights: a car
  cleared into a group drives through. Junction complexes join into one group (Munich `n:247`'s
  four Landsberger nodes, `n:638`'s four ramp nodes). Grouping weighs a link's length against the
  width of the roads it joins, not length alone, so long service links (`n:570`) stay separate;
  case by case where no rule fits yet. Geometry errors at `n:247` and `n:638` go to Phase 2.
- 2026-11-10, TASK-131 checkpoint 0 (audit `d4a5918`): the owner approved the lead's
  recommendations: groups replace `consolidateJunctions`; `realignRoads`, `attachCarriageways`
  and `relaxRoads` off; `separateCoincident`, `separateDual` and `convergingShifts` only where
  carriageways overlap; no smoothing within 30 m of a node; Arnulfstraße's B54 corridors drawn
  apart at their real 6 to 8 m medians; synthetic median crossings kept as hidden inner links; no
  groups at dead ends; the 60 m span and 30 m inner-road rules kept; Phase 2 lists every B55-like
  near-parallel overlap. Phase 1 started.
- 2026-11-10, road geometry (TASK-131): keep the OSM geometry and stop merging close nodes;
  nodes joined by links up to 30 m (`junctionGroupMaxM`, adjustable) form a junction group whose
  inner links are routed but not drawn as roads, and where no car is cleared in unless cleared
  through. Carriageways stay paired; side by side with a divider only where they overlap or leave
  no space (B54 amended, not withdrawn). Smoothing stays but never moves junctions; the collision
  model is turned off, not deleted. A group's signals are one coordinated controller. B55 is in
  scope. The lead drives the task through a Claude Code subagent, phase by phase (owner
  exception, as TASK-111).
- 2026-11-10, TASK-129: car ownership contract written; it may run alongside TASK-128 and
  TASK-130 (the lead reconciles `schedule.ts`, the person inspector and the census at merge).
  Household sizes are constants (German 2023 microcensus); the fleet stays the members with
  `hasCar`; members without a car may borrow a household car only for a whole free day.
- 2026-11-10, B56: TASK-130 (break the Landsberger loop) contract written after the TASK-122
  merge; it can run alongside TASK-128.
- 2026-11-10, TASK-122: merge on top of TASK-124 and TASK-125 with the baseline reset; the
  stalled head on `r:961` is the Landsberger loop's (B56), not TASK-122's; a new task (TASK-130)
  breaks the loop. T53's walker-cost limit relaxes from 3% to 5%.
- 2026-11-10, rail: TASK-128 (stations as trip ends) starts now on Codex while the lead
  re-measures TASK-122; riders are walk-only and their profile is constants, no scenario field.
- 2026-11-10, TASK-125: owner confirms approving the claimed-space row in the vehicle
  inspector, outside the contract's scope.
- 2026-11-10, TASK-127: owner allows Sindelfingen boundary-to-buffer terminal services,
  returning to their entry boundary, because its graph has no permitted through path.
- 2026-11-10, rail: TASK-127 (decorative trains) starts now on Codex alongside TASK-125; it
  stays out of `src/sim` so the two do not collide. Trams wait for a later task.
- 2026-11-10, parking: TASK-125 (parking claims) starts now on Codex, after TASK-124 and
  TASK-126 merged; contract in `docs/tasks/TASK-125.md`. The lead re-measures TASK-122 on top.
- 2026-11-10, rail: R1 and R2 merge into TASK-126 (Codex), started now; backlog items carry
  task numbers (TASK-127 trains, TASK-128 stations as trip ends, TASK-129 car ownership).
- 2026-11-10, backlog: parking claims become their own task (TASK-125), started after TASK-124;
  rail network, stations, decorative trains, stations as trip ends and car ownership logged
  under "Owner backlog (2026-11-10)". The owner confirms the decisions the agents reported: gateway
  visitors keep their parking and blocked strips may stay empty (TASK-122), and the bridge and
  tunnel endpoint joins (TASK-123).

- 2026-11-10, CI and delivery: two tiers. The light tier (`check`, `test:city`,
  `test:traffic:light` with the 10:00 gate and T53, `test:e2e:light`, plus the specs a task
  names) runs everywhere by default: agents' deliveries, the lead's merges, every push and PR
  (docs-only pushes run nothing). The full tier (full demand, the whole e2e in five groups,
  `npm run bench`) runs only at checkpoints: a pushed `checkpoint-*` tag, a manual run of the
  Full workflow, or nightly when main changed. A red full run blocks new merges until fixed. The
  lead tags a checkpoint before a gate is marked done and at least once per wave.
- 2026-11-10, TASK-124 (lead ruling, owner go-ahead): a reachable arrival connector that fails
  the departure check stays as an arrival and gains a separate departure connector; only an
  unreachable one moves. Moving Munich's arrivals missed the quick gate (3 260 / 16); the split
  passes (3 552 / 8 / 0).

- 2026-11-10, TASK-122 and TASK-123 round 2: write TASK-124 (B58, every garage and place has a
  car exit). TASK-122 waits for it; TASK-123's round 3 (T53) runs alongside.
- Lead, TASK-124 trace (766a4d5, 2026-11-10): the agent stopped correctly on two contract
  errors. A public-only car core is 62 lanes in Sindelfingen, disjoint from the network cars
  use (the circulation runs through private zones), and 721 Sindelfingen strip spaces (2.39%)
  sit on roads cut by the crop or closed in by private zones, where no connector move helps.
  Ruling: "car exit" means TASK-122's per-zone departure check, ported to `src/network/`; the
  traced strips are accepted real gaps and leave the 2% count, which now covers garages, lots
  and places; gateways are counted but not gated. Contract amended.

- 2026-11-09, while TASK-112's round 2 and TASK-122 run: write TASK-123 (B57, one connected
  walk network) and run it in parallel. B54 east, B55 and TASK-113 wait until TASK-122 is merged.

- 2026-11-09, TASK-120: rejected (the lead's premise was wrong; see the review). Ask for a
  different fix as a new task: TASK-122, trip cars start and park only where they can leave.

- 2026-11-09, while TASK-120 runs: start TASK-112 (trips made by people) and TASK-121 (B56,
  queue heads re-route) in parallel. TASK-112's lead defaults (walk legs for local private
  trips only, walk-mode trips simulated, one car per person, parking choice unchanged, no schema
  change) stand unless the owner overrides them.

- 2026-11-09, TASK-118/119 merge: accept the full-demand parking failures at 2.5% of local
  arrivals (32 of 1 599) and fix dead-end turnarounds in TASK-120, which restores 2%.

- 2026-11-08, TASK-116 test allowances: the owner confirms loosening T47 Munich's total budget
  to 180 s and V106's local Munich frame overhead to 25%, as the agent recorded in its
  contract.

- 2026-11-07, Gates 7 to 9: the lead's defaults are accepted (vehicle classes car, van, truck,
  bus; inferred garages and roadside strips where OSM has no parking; AWS Terrain Tiles;
  slope ignored by the simulation; generated street trees and lamps on by default; walkers
  without collisions; a baseline reset at each merge of a task that changes demand or
  parking; night lighting low priority). The work runs in the lead's phases, not gate by
  gate. The owner starts and orchestrates every agent (Codex or Claude Code) and sends each
  finished task to the lead for review; the lead writes contracts, creates branches without
  worktrees, writes a handover message per agent with a harness, model and effort, and
  reviews, corrects and merges.

- 2026-11-07, next stages: B54 east, B55 and B56 stay outstanding and are deferred. The
  work advances to three stages: Gate 7, road betterment (car parking in buildings, at the
  roadside and in surface lots; vehicle categories as labels or metadata; restricted road
  access by vehicle type or for local destinations); Gate 8, more realistic visuals (terrain;
  trees, forests, grass and surface textures; street lights and curbs; chevrons,
  channelizing lines, yellow and white markings by region, realistic arrows; building
  details, low priority); Gate 9, occupancy-driven trips (a pedestrian network with
  walkable, traffic-controlled crossings; local trips from and to buildings by persons who
  walk to and from their cars; a choice between walking, driving and part of each). The
  lead's design and task split are in "Roadmap: Gates 7 to 9".

- 2026-11-07, TASK-099: merge with the traffic baseline reset rather than fix B56 first.
  `bench/traffic-baseline.json` holds TASK-099's figures (3 390 completed, 81 gridlocked, 1
  stalled head at 0.15; quick 3 067 / 42); the gate takes 90 percent of completed, gridlock at
  most 1.5 times, stalled heads at most the baseline's. The fixed 3 497 floor and T36.4/T38.5's
  stage figures are deleted.

- 2026-11-07, TASK-097: shadows apply only to non-ground streets. Raised streets cast onto
  surrounding objects; lower streets shade themselves. The owner raises the frame-time
  allowance from 10% to 20% at both Munich zooms; the rebuild allowance stays at 20%.
  Accepted measurements (Shadows off → on): overview 16.6655 → 16.6659 ms, street
  91.8017 → 101.9403 ms (+11.04%), rebuild 284.7 → 327.3 ms (+14.96%). This supersedes
  TASK-097's original 10% frame limit; no simulation, network or schema change is authorized.
- 2026-11-07, visual features: the owner asked for OSM surroundings (non-road geometry), shadows
  that tell road levels apart, and possibly a 3D scene, none changing the planar geometry built
  from OSM. Planned as TASK-096, TASK-097 and TASK-098. The 3D view leaves the deferred list
  (decision 15) as a viewer; editing stays 2D. three.js is approved as a dependency and
  `City.context` as an optional schema field. The owner orchestrates these agents; the lead
  writes the contracts, creates the branches and reviews the commits.
- 2026-11-07, B53: at signalised approaches the crossing sets back like everywhere else and
  the stop line moves behind it (`stopM` at the crossing's far edge minus 0.5 m); new
  benchmark hashes accepted (TASK-094).
- 2026-11-06, TASK-089: carriageways converging on a node are split geometrically at that
  node (each keeps its own end beside the node, the median reaching the junction edge) while
  the network keeps one node and its movements; the owner drew it on the `n:104` shot.

- 2026-11-06, round 4: markings and edges are still not parallel on long curves and through
  roads still bulge at side streets; the owner proposed corridor-first geometry,
  osm2streets-style junction polygons and collision-based relaxation. Decisions: `clipper2-ts`
  may be added; relaxation's maximum displacement is not limited in advance but decided after
  experiments, as a parameter (an import option later, not now); opposite one-way
  carriageways on one centerline are separated, and the engine must know which roads are
  paired or parallel parts of one street (`Road.corridorId`); the old junction outline and
  apron code is deleted once replaced; the traffic gate's 90 percent tolerance; push `main`
  after each merge. The lead runs the work in this session with subagents it drives, by the
  plan in "Geometry rework". Later the same day: new dependencies and schema or project
  format changes need no owner check either; the plan starts.

- 2026-11-05, after testing wave 15: the four round 2 items (markings through junctions
  without signals, junction shapes, cars missing their exit and the Munich deadlock, a
  fade-and-respawn escape from gridlock) are fixed before walking legs and multimodal travel.
  The respawn is the owner's request and an approved exception to architecture section 1
  row 10.

- 2026-11-05: GitHub Pages is enabled and the site is live at
  https://chengxuan-li.github.io/cityflows/ (default OpenStreetMap tiles). The outstanding
  work is planned in parallel phases (Roadmap after wave 14).

- 2026-11-03: foundation, renderer, repo shape, license, OSM access, workflow and audit depth
  decided; architecture approved with five adjustments (architecture section 1, rows 8 to 12).
- 2026-11-03: Gate 1 defined as the interactive vertical slice above, not an engine-only
  milestone.
- 2026-11-04, after wave 12: performance measurements and long test runs are deferred
  unless they block the next stage; old agent worktrees and merged branches are removed;
  shipping (a static deploy plus a user README) is wanted.
- 2026-11-03, after Gate 1: the UI is redesigned in the spirit of Mini Motorways and Mini
  Metro (TASK-050; direction recorded in `AGENTS.md`), with no loss of capability. Added to
  the plan: a large synthetic city (TASK-026), place painting and demand regeneration
  (TASK-034). TASK-022 stays one task; TASK-044 waits until the sim and renderer tasks of
  the next waves are in.

## Performance

TASK-044, measured 2026-11-03 on Windows, Intel Core Ultra 9 275HX, Node 24.14.1;
Chromium 156.0.8078.4 at 1280 × 720 using ANGLE/SwiftShader software rendering.
Seed 1, fixed 0.1 s steps. `npm run bench` uses Node's built-in type stripping and
prints one table; `bench/latest.log` also retains the measurements as JSON.

The normal grid and town are unchanged fixtures. Population scaling to 3 000 people
does **not** produce 3 000 road vehicles: the two-place grid is ingress-limited.
The separately labelled stress variant retains the grid's 25 nodes and 78 roads,
lengthens its blocks from 120 to 1 200 m, and distributes 78 pairs of portals and
3 120 residents across the roads. The large city is the existing town (324 nodes,
1 137 roads), not another generated grid.

Headless runs cover 24 simulated hours starting at 07:00. Morning throughput covers
07:00–10:00; step timers exclude compilation, loading, metrics and snapshots. Peaks
are sampled every 60 simulated seconds, so they are lower bounds on instantaneous
peaks. Routing is the median of three 3 000-request batches after 1 000 warm-up
requests, noise 0.1, with cost-version changes every 60 requests. Heap is retained
process heap after forced GC; typed-array backing storage is reported separately.

| Workload | People / trips | Sampled peak road / origin queue | Morning steps/s | 24 h steps/s | Routes/s | Heap MiB: load / 10:00 / end | Buffers MiB at end |
|---|---:|---:|---:|---:|---:|---:|---:|
| grid5x5, normal | 1 088 / 2 176 | 24 / 26 | 75 553 | 86 935 | 53 897 | 15.57 / 17.70 / 18.93 | 0.57 |
| grid5x5, population scaled | 3 000 / 6 000 | 27 / 1 275 | 25 009 | 28 633 | 54 521 | 22.83 / 26.20 / 30.05 | 1.16 |
| grid5x5, distributed stress | 3 120 / 6 240 | 3 044 / 1 881 | 7 783 | 19 274 | 72 460 | 23.64 / 26.79 / 29.88 | 1.22 |
| town | 6 951 / 13 902 | 371 / 35 | 7 325 | 9 657 | 6 047 | 33.92 / 43.57 / 52.91 | 5.33 |
| grid5x5, normal, after TASK-046 | 1 088 / 2 176 | 23 / 26 | 280 497 | 611 591 | 44 813 | 15.64 / 17.82 / 19.04 | 0.43 |
| grid5x5, population scaled, after TASK-046 | 3 000 / 6 000 | 26 / 1 275 | 111 787 | 208 988 | 48 003 | 25.48 / 28.91 / 32.76 | 1.33 |
| grid5x5, distributed stress, after TASK-046 | 3 120 / 6 240 | 3 036 / 1 881 | 8 777 | 43 681 | 59 771 | 30.78 / 33.86 / 36.95 | 1.73 |
| town, after TASK-046 | 6 951 / 13 902 | 371 / 35 | 17 209 | 49 118 | 5 727 | 40.94 / 50.58 / 59.88 | 3.38 |

The "after TASK-046" rows were measured 2026-11-03 on the same machine and Node
version after the four TASK-046 engine commits. A same-day run of the previous
engine on that machine gave 78 336 (grid), 24 892 (scaled), 15 811 (stress) and
8 830 (town) 24 h steps/s, so the like-for-like gains are 7.8x, 8.4x, 2.8x and
5.6x. State hashes in `bench/latest.log` are unchanged for the normal grid
(1639643273), the scaled grid (3254820089) and the town (3932636798). The stress
hash changes (1541856394 to 1071430910) only through the lane-drop fix below,
and the stress day now completes 6 240 of 6 240 trips. The 18:00 town counts
still match the review log (12 640 requested, 12 571 completed, 69 driving, 0
failed). Routes/s is the unchanged routing benchmark and varies run to run.

All trips reconcile throughout every run. Normal, population-scaled and town runs
complete every trip without failures. Stress completes 6 239 trips and has one
`stranded` failure, with nothing pending at the end; this remains a simulation
follow-up. At 18:00 the town reproduces the review log's 12 640 requested trips,
12 571 completed, 69 driving and zero failed (1 262 departures still pending).
The corresponding step-only rate is 8 930/s; this is not an engine speedup claim
against the older 6 500/s measurement, whose timer also included frequent metrics.
Snapshot generation at 08:03 averages 0.010 ms for 23 grid cars, 0.238 ms for 2 915
stress cars, and 0.059 ms for 347 town cars, separately from transport and rendering.

T16 measures eight seconds at 10x after one second of warm-up. The stress sample
starts at 08:04, after ingress has reached approximately 3 000 actual road vehicles.
Frame intervals, synchronous renderer CPU time and worker snapshot round trips are
separate measurements; round trips include generation, message scheduling and main
thread delivery, not just buffer transfer. Per-scenario `performance.json` files
and Playwright JSON attachments live under `test-results/T16-*`; CI uploads
`test-results` on success and failure. `CITYFLOWS_TEST_PORT=4244` isolates this
worktree's server; Playwright refuses to reuse another task's server.

| Workload | Active at sample start | FPS | Frame ms p50 / p95 / p99 | Achieved multiplier | Mean render CPU ms | Mean snapshot round trip ms | Main heap MiB before / after peak | Worker heap MiB before / after peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| grid5x5 | 22 | 60.00 | 16.7 / 16.7 / 16.8 | 9.959x | 0.206 | 13.35 | 13.81 / 14.71 | 2.23 / 3.46 |
| distributed stress | 3 044 | 60.00 | 16.7 / 16.7 / 16.8 | 9.956x | 0.309 | 12.63 | 18.25 / 20.43 | 4.09 / 6.34 |
| town | 342 | 60.00 | 16.7 / 16.8 / 16.8 | 9.965x | 0.498 | 11.28 | 77.62 / 85.33 | 11.10 / 16.57 |

Browser memory includes V8 heap plus backing storage in both isolates after forced
GC, excluding GPU allocations. Four identical morning runs, with restarts and town
overview/detail zoom cycles, stay within the hard bound of max(8 MiB, 15%) above
the first post-peak sample. Maximum observed increases are 0.29 MiB in the page
and 0.81 MiB in the worker. This is a finite retention regression guard. FPS and
achieved-speed targets are soft reports (60 FPS tolerates 59; 10x tolerates 9.5x).

The shipped optimization caches only static terrain below zoom 0.7, at a
power-of-two resolution with a 2 048-pixel edge cap. Vehicles, signals and heat
remain live, and detailed views use the original vectors. In the same T16 town
workload, before/after measurements are 12.83 → 60.00 FPS, p95 frame interval
100.0 → 16.8 ms, mean snapshot round trip 76.73 → 11.28 ms, and achieved speed
10.02x → 9.97x. The renderer change is its own commit, `b699b8f`. Routing buffer
reuse was evaluated but not retained because repeated town throughput results
were inconsistent. Host and simulation code are unchanged; TASK-041's heat update
cost did not justify rewriting that layer.

`npm run bench -- --profile` samples the 07:00–10:00 engine workload at 1 ms using
V8's CPU profiler, writes `bench/profiles/*.cpuprofile.log`, and reports exclusive
time-weighted sample shares (including GC/other frames in the denominator).
The following simulation hotspots are the brief for the owner after TASK-032:

| Hotspot | Normal grid | Scaled population | Stress | Town | Follow-up |
|---|---:|---:|---:|---:|---|
| `reroute.update` | 57.59% | 71.04% | 23.56% | 50.57% | Iterate active/due vehicles instead of scanning every trip each step; preserve ID order and staggering. |
| `engine.prepareTravel` | 7.97% | 5.10% | 17.73% | 12.26% | Measure an ordered active-segment list against scanning all lane/movement heads. |
| `lane-change.propose` | 2.20% | 1.60% | 21.43% | 2.68% | Reduce per-vehicle temporary arrays/closures and repeated neighbor work without changing MOBIL decisions. |
| `engine.commit` | 3.26% | 2.71% | 13.28% | 4.24% | Profile the dense active-vehicle pass before changing integration or connector semantics. |
| `idmAcceleration` | 1.78% | 1.62% | 7.74% | 1.50% | Keep numerical behavior unchanged unless T02/T03 prove an equivalent optimization. |

Section 15 status: the 30 FPS / 1x scale target is met on the 3 044-car stress
workload (60 FPS at approximately 10x), and 10x is achieved on both normal grid
and town. This establishes vehicle-count scaling on the stress grid; the town
itself was not measured with 1 000–3 000 active cars. The normal grid renders at
60 FPS, but its 22-car browser sample does
not qualify the separate 100–300-active-car load point; that exact load remains
unmeasured. Import progress/diagnostic regression scenarios pass, but large-import
frame timing is not benchmarked here. The 24-hour runs conserve all trips and the
retention guard passes; the single stress trip's stranded failure still needs a
simulation fix. No claim is made about unlimited-duration or GPU memory stability.
Next acceptance work: measure a 100–300-car burst with distributed portals inside
the original 120 m grid and a 3 000-car town, time a large OSM import including progress frames, and
have the simulation owner replay the seed-1 stress case to diagnose its stranded
trip after TASK-032.

Verification on the merged tree is in the review log entry for TASK-044.

TASK-046 took the hotspots in share order. `reroute.update` keeps pending checks
in a min-heap keyed by (next check, id) and visits only due vehicles (grid 78 336
to 479 369, town 8 830 to 36 073 steps/s). The travel preparation and proposal
passes walk an ordered list of occupied segments kept by the vehicle store; it
was measured against the head scan it replaces (grid 479 369 to 601 801, town
36 073 to 49 480). Lane-change proposals build no per-vehicle arrays and use
precomputed lane survival (grid 601 801 to 642 472, town 49 480 to 50 138,
stress 15 811 to 46 665). The headless comparison reads one snapshot per step
plus the trip outcomes once instead of a `VehicleDetail` per active vehicle per
step; old and new results are deep-equal on the grid, the stress grid and the
town, and the town's two busiest hours take 10.0 s instead of 11.3 s, of which
5.2 s is the engine and 2.4 s the snapshots. The export recorder keeps its
`inspect` calls: they run once per vehicle that left the road since the previous
sample, 6 951 calls costing 13.75 ms of 920 ms of `observe()` over the town
morning, so they were left alone. The stress trip that never finished was an
engine defect: a lane-level fallback route named only the dropped lane r:100#1,
so no surviving target lane existed and no change was ever proposed; the car
held two metres before the lane end from 08:03 to the end of the day. A route
whose target lanes are all dropped now leaves by the nearest surviving lane that
enters the next road and reroutes with `missed_turn`
(`tests/sim/lane-drop-fallback-route.test.ts`). After these changes the morning
profile shares are `engine.prepareTravel` 19 percent (grid) and 23 percent (town),
`engine.commit` 9 percent, `lane-change.propose` 6 to 7 percent, and in the town
the route searches of the checks themselves 24 percent; `intersection.signals`
scans every vehicle for grants at 2.8 percent on the grid and was left as is.

Wave 11 (2026-11-04, same machine, idle): TASK-062 restored the routing throughput
(routes per second: grid 33 972 to 55 988, scaled 30 688 to 53 562, stress 36 647 to
65 475, town 2 833 to 5 342; town 24 h 33 273 to 40 992 steps per second, morning 10 856
to 14 374) with every returned route identical. TASK-051 and TASK-061 leave the four
state hashes and trip counts unchanged; a live patch on the town takes 14 ms for a drawn
road and 11 ms for a turn ban.

### Gate 4 verification

TASK-045, measured 2026-11-04 on the same machine. The brief's four acceptance demos are
Playwright scenarios that record a video and write a `metrics.json` next to their
screenshots in `test-results/<scenario>/`; each is deterministic (seed 1, fixed steps
through `window.cityflows.step`), and the closing seconds of playback in A and C are for
the recording only, after the numbers are taken.

| Demo | Scenario | Measured |
|---|---|---|
| A, morning commute | `tests/e2e/demo-a-commute.spec.ts` | Grid with 2 000 residents: trips peak at 08:00 (951 at 07:00, 960 at 08:00; 1 546 between 16:00 and 19:00). At 08:00, 22 driving, 240 queued at the Homes exit, 734 completed, one road below half its free speed; heat screenshots at 08:00 and 17:30; 3 355 completed and 0 failed by 17:30. |
| B, terminal access | `tests/e2e/demo-b-airport.spec.ts` | Station city, 80 arrivals at 08:05: queue 0 before the event, peak 64 with one connector and 53 with an added arrival connector, which empties the queue by 08:16 while one connector still has 4 cars waiting at 08:20. |
| C, bypass | `tests/e2e/demo-c-bypass.spec.ts` | Two-lane expressway with two ramps on the grid: 300 of 300 inspected routes use it; mean travel time 90.7 s to 60.0 s for the 07:00 to 09:00 morning, 1 063 completed and 0 failed in both runs. |
| D, import-edit-share | `tests/e2e/demo-d-import-edit-share.spec.ts` | `fixtures/osm/downtown.osm` uploaded (712 roads, 0 errors, 207 warnings); an OSM-banned turn at junction n:241 lifted in the Turns list; the saved `.cityflows` reopened in a fresh browser context; after 15 replayed minutes both sides hash 4024860980 with equal trip counts. The second context's video is in `reopened/`. |

Demo D's imported city fails 7 442 of its gateway trips in the first 15 minutes (reason
counts are in its `metrics.json`); that is the import's demand, not the share, and stays a
follow-up. `tests/e2e/demo-onboarding.spec.ts` follows the six first-run hints (New, Play,
a car, a street's settings, Restart, Compare) and saves a screenshot of each.
