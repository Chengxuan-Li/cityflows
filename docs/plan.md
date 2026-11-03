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
| [TASK-003](tasks/TASK-003.md) | 1 | Simulation core | `src/sim` (except lane changes), `tests/sim` | 001, 002 | T01, T02, T03 (single lane), T08, T15 (sim side), intersections | todo |
| [TASK-004](tasks/TASK-004.md) | 1 | Lane changing and route following | `src/sim/lane-change.ts`, engine hooks, `tests/sim/T03*`, `T07*` | 003 | T03, T07 (partial) | todo |
| [TASK-005](tasks/TASK-005.md) | 1 | Engine host (worker) | `src/host`, `tests/host` | 003 | protocol, play loop, snapshot transfer | todo |
| [TASK-006](tasks/TASK-006.md) | 1 | Renderer | `src/render`, `dev/render.html` | 001 | drawn city, camera, picking, vehicles | done |
| [TASK-007](tasks/TASK-007.md) | 1 | Editor core | `src/editor`, `tests/editor` | 001 | T12 (attribute and rule commands), T04 (editor side) | done |
| [TASK-008](tasks/TASK-008.md) | 1 | Project persistence | `src/project`, `tests/project`, `fixtures/projects` | 001 | T14 | done |
| [TASK-009](tasks/TASK-009.md) | 1 | App shell, run controls, inspectors | `src/ui`, `src/main.tsx`, `tests/e2e/gate1-run.spec.ts` | 005, 006, 008, 011 | Gate 1 items 1 to 4, 7 | todo |
| [TASK-010](tasks/TASK-010.md) | 1 | Editing UI and restart policy | `src/ui/inspector/*`, `src/ui/run-bar*`, `tests/e2e/gate1-edit.spec.ts` | 007, 009 | Gate 1 items 5, 6; T17 | todo |
| [TASK-011](tasks/TASK-011.md) | 1 | Demand v1: population and commute trips | `src/demand`, `tests/demand` | 001 | T09 (commute), T15 (data side) | done |
| [TASK-012](tasks/TASK-012.md) | 1 | Gate 1 integration and acceptance | anywhere (lead), `tests/e2e/gate1-*.spec.ts` | 004, 010 | Gate 1 checklist, CI green | todo |
| [TASK-020](tasks/TASK-020.md) | 2 | OSM importer and fixtures | `src/importers/osm`, `src/importers/types.ts`, `fixtures/osm`, `tests/importers` | 001 | T11, T18 | done |
| [TASK-021](tasks/TASK-021.md) | 2 | Import wizard, Overpass provider, file upload | `src/ui/import`, `src/importers/overpass.ts`, `src/importers/cache.ts`, `src/importers/worker.ts` | 020, 009 | import workflow end to end | todo |
| [TASK-022](tasks/TASK-022.md) | 2 | Topology editing: draw, split, delete, move | `src/editor/commands/topology.ts`, `src/ui/tools/*`, `src/render/layers/edit-overlay.ts`, `tests/editor/T12-topology.test.ts`, `tests/e2e/gate2-edit.spec.ts` | 007, 010 | T12 (full) | todo |
| [TASK-023](tasks/TASK-023.md) | 2 | Multi-select and batch editing | `src/ui/selection`, `src/editor/commands/batch.ts` | 022 | bulk edits, one undo entry | todo |
| [TASK-024](tasks/TASK-024.md) | 2 | Raster tile backdrop | `src/render/layers/tiles.ts`, layer toggle in `src/ui/layers*` | 006, 020 | tiles align with imported roads | todo |
| [TASK-025](tasks/TASK-025.md) | 2 | GeoJSON feature import and export | `src/importers/geojson`, `src/project/geojson.ts` | 008, 020 | documented interchange, id conflict handling | todo |
| [TASK-030](tasks/TASK-030.md) | 3 | Activity chains, through traffic, place events | `src/demand`, `src/sim/connectors.ts` (events, capacity), `tests/demand`, `tests/sim/T10*` | 011, 003 | T09 (full), T10 | todo |
| [TASK-031](tasks/TASK-031.md) | 3 | Congestion-aware routing | `src/sim/link-costs.ts`, `src/sim/reroute.ts`, `src/routing` (costs) | 002, 004 | T06 | todo |
| [TASK-032](tasks/TASK-032.md) | 3 | Ramps, merging, expressway construction | `src/sim/merge.ts`, `src/editor/commands/ramp.ts`, `src/ui/tools/ramp*`, `tests/sim/T07*` | 004, 022 | T07 (full), demo C | todo |
| [TASK-033](tasks/TASK-033.md) | 3 | Place editor and demand panel | `src/ui/inspector/place*`, `src/ui/panels/demand*`, vehicle inspector reasons | 030, 010 | demos A and B reachable from the UI | todo |
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
- Gate 1 routing uses free-flow travel times; congestion-aware rerouting arrives in TASK-031.
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

## Owner decisions log

- 2026-11-03: foundation, renderer, repo shape, license, OSM access, workflow and audit depth
  decided; architecture approved with five adjustments (architecture section 1, rows 8 to 12).
- 2026-11-03: Gate 1 defined as the interactive vertical slice above, not an engine-only
  milestone.
