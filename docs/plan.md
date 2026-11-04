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
| [TASK-021](tasks/TASK-021.md) | 2 | Import wizard, Overpass provider, file upload | `src/ui/import`, `src/importers/overpass.ts`, `src/importers/cache.ts`, `src/importers/worker.ts` | 020, 009 | import workflow end to end | todo |
| [TASK-022](tasks/TASK-022.md) | 2 | Topology editing: draw, split, delete, move | `src/editor/commands/topology.ts`, `src/ui/tools/*`, `src/render/layers/edit-overlay.ts`, `tests/editor/T12-topology.test.ts`, `tests/e2e/gate2-edit.spec.ts` | 007, 010 | T12 (full) | todo |
| [TASK-023](tasks/TASK-023.md) | 2 | Multi-select and batch editing | `src/ui/selection`, `src/editor/commands/batch.ts` | 022 | bulk edits, one undo entry | todo |
| [TASK-024](tasks/TASK-024.md) | 2 | Raster tile backdrop | `src/render/layers/tiles.ts`, layer toggle in `src/ui/layers*` | 006, 020 | tiles align with imported roads | done |
| [TASK-025](tasks/TASK-025.md) | 2 | GeoJSON feature import and export | `src/importers/geojson`, `src/project/geojson.ts` | 008, 020 | documented interchange, id conflict handling | done |
| [TASK-026](tasks/TASK-026.md) | 2 | Large synthetic city fixture | `src/fixtures/town.ts`, `src/fixtures/scenarios.ts`, `fixtures/projects/town.cityflows.json`, `tests/network/town.test.ts`, `tests/sim/town-day.test.ts` | 001 | compiles, full day under 1 percent failed, perf workload | done |
| [TASK-050](tasks/TASK-050.md) | 2 | Game-like UI redesign | `src/ui`, `src/render/style.ts`, `src/render/layers/*` visuals, `tests/e2e` names | 010 | all capabilities reachable, seven e2e scenarios green | done |
| [TASK-030](tasks/TASK-030.md) | 3 | Activity chains, through traffic, place events | `src/demand`, `src/sim/connectors.ts` (events, capacity), `tests/demand`, `tests/sim/T10*` | 011, 003 | T09 (full), T10 | todo |
| [TASK-031](tasks/TASK-031.md) | 3 | Congestion-aware routing | `src/sim/link-costs.ts`, `src/sim/reroute.ts`, `src/routing` (costs) | 002, 004 | T06 | done |
| [TASK-032](tasks/TASK-032.md) | 3 | Ramps, merging, expressway construction | `src/sim/merge.ts`, `src/editor/commands/ramp.ts`, `src/ui/tools/ramp*`, `tests/sim/T07*` | 004, 022 | T07 (full), demo C | todo |
| [TASK-033](tasks/TASK-033.md) | 3 | Place editor and demand panel | `src/ui/inspector/place*`, `src/ui/panels/demand*`, vehicle inspector reasons | 030, 010 | demos A and B reachable from the UI | todo |
| [TASK-034](tasks/TASK-034.md) | 3 | Place painting and demand regeneration | `src/ui/tools/place-paint.tsx`, place controls, regenerate action, `tests/e2e/gate3-paint.spec.ts` | 050, 011 | painted place attracts trips after regenerate | todo |
| [TASK-040](tasks/TASK-040.md) | 4 | Signal editor | `src/ui/inspector/signal*`, `src/render/layers/signal-preview.ts` | 010 | T13 through the UI | todo |
| [TASK-041](tasks/TASK-041.md) | 4 | Metrics, layers and charts | `src/ui/panels/metrics*`, `src/ui/layers*`, `src/render/layers/heat.ts` | 005, 006 | readable congestion feedback | todo |
| [TASK-042](tasks/TASK-042.md) | 4 | Scenario comparison | `src/ui/panels/compare*`, `src/project/scenarios.ts` | 008, 041 | same-seed baseline versus variant | todo |
| [TASK-043](tasks/TASK-043.md) | 4 | Analysis and interchange exports | `src/project/export-*.ts`, export menu | 008, 041 | CSV and GeoJSON exports labelled synthetic | todo |
| [TASK-044](tasks/TASK-044.md) | 4 | Performance and benchmark harness | `bench/`, hot paths in `src/sim`, `src/render` (coordinated), `tests/e2e/T16*` | 003, 004, 005, 006 | T16, targets in architecture section 15 | todo |
| [TASK-045](tasks/TASK-045.md) | 4 | Gameplay acceptance demos and onboarding | `tests/e2e/demo-*.spec.ts`, first-run hint in `src/ui` | all Gate 1 to 4 | demos A to D recorded | todo |

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

- Gate 1 demand is home-work-home only; chains, through traffic and events arrive in
  TASK-030.
- Lane changes are discrete in the model; the renderer animates them (architecture section 8).
- Edits during a run pause the run and require a restart (T17); live signal timing edits are
  not planned before Gate 4.
- `npm audit` reports moderate advisories in dev tooling only (minimatch under
  typescript-eslint); nothing ships to the browser. Revisit when upgrading tooling.

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
