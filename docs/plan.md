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
| 5 | Future: transit, walking legs, bulk import, desktop | Not planned here; the contracts keep it possible (R7) |

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
| [TASK-063](tasks/TASK-063.md) | 5 | Junction surface, crossings, one asphalt colour (B21, B23, B24, B25) | `src/network/junctions.ts` (outline only), `src/geo/polyline.ts` (additive), `src/render/layers/nodes.ts`, `roads.ts`, `src/render/style.ts`, `scene.ts`, `types.ts` (layer flag), `src/ui/layers.tsx`, `tests/network/T20*`, `tests/render`, `tests/e2e/gate4-layers.spec.ts` | 061; design in architecture 5.1, 11 | T20 additions; hashes unchanged | todo |
| [TASK-064](tasks/TASK-064.md) | 5 | Conflict zones instead of whole-movement conflicts (B26) | `src/network/conflicts.ts`, `src/network/types.ts` (additive), `src/sim/intersection.ts`, conflict reads in `engine.ts`, `merge.ts`, `patch.ts`, `tests/network/conflict-zones.test.ts`, `tests/sim` | 049, 051, 057, 061; design in architecture 5.3, 8 | T21; uncapped Munich at least as fast as capped | todo |
| [TASK-060](tasks/TASK-060.md) | 5 | Tooling: workflow actions and audit advisories | `.github/workflows/ci.yml`, `package.json` devDependencies, lockfile, `eslint.config.js` | - | CI green without deprecation notes, audit clean | done (actions only; see review) |

### Waves

Tasks in the same wave run in parallel on disjoint file surfaces. A wave starts when every
dependency of its tasks is merged to `main`.

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

## Lead handover

How the lead runs this project, for whoever takes the role on another machine. Everything
else is in this file, `AGENTS.md`, `docs/architecture.md` and `docs/tasks/`.

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

## Owner decisions log

- 2026-11-03: foundation, renderer, repo shape, license, OSM access, workflow and audit depth
  decided; architecture approved with five adjustments (architecture section 1, rows 8 to 12).
- 2026-11-03: Gate 1 defined as the interactive vertical slice above, not an engine-only
  milestone.
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
