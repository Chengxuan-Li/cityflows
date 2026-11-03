# Browser-Based City Traffic Game — Product, Architecture, Reuse, and Agent Handoff

**Status:** Planning brief; not an implementation decision or permission to silently reduce scope  
**Prepared:** 2026-11-03  
**Audience:** Lead planning agent (Fable / GPT Astra), collaborating with the project owner; subsequent delegated coding agents (e.g. Opus 5.5 / GPT 5.6 Sol)  
**Working title:** City Traffic Sandbox (placeholder; the lead agent should not block on naming)

> **Lead-agent directive**  
> Design a playable **browser-first, 2D, microscopic road-traffic game** using real-city roads, editable lane-level infrastructure, and synthetic but plausible work/life trip demand. The player should be able to load a real urban area; create, modify, and remove roads, intersections, restrictions, signals, and high-volume destination access points; and watch thousands of individual vehicles adapt to congestion and routes. A local simulation backend and Electron-style browser desktop packaging are acceptable, but **Unity, Unreal, and comparable heavyweight game engines are out of scope**. Preserve a clear path to multi-modal, person-based mobility in later releases. **The user's eight requirements below are contractual: do not downgrade or omit them simply because a reference repository lacks them.**

**What the lead agent must do first:** inspect existing code and licenses, run candidate prototypes, identify reusability and gaps, propose 2–3 architectures, recommend one with evidence, agree on milestone acceptance tests with the owner, then delegate narrow implementation tasks. This brief is a starting point for that planning process—not an instruction to immediately write the entire application.

---

## 1. Product definition and non-negotiable requirements

### 1.1 Product pitch

A city-scale traffic playground between **Mini Motorways** (accessible game feedback), **A/B Street** (real street geometry and editing), and **Cities: Skylines** (people undertake daily activities), but with a lightweight cartoon 2D presentation and **no building-level simulation**. Vehicle flows emerge from residential areas, workplaces, shopping, community entrances, airports, stations, car parks, highway boundaries, and other *places*, each connected to the road network through one or more physically meaningful entry/exit points.

It is **not** a calibrated transport-engineering system. All traffic-demand estimates are synthetic unless real traffic data are explicitly provided. Avoid game mechanics that hide fundamental routing or connectivity problems.

### 1.2 Binding user requirements (R1–R8)

| ID | Requirement | Mandatory player-visible outcome | Timing |
|---|---|---|---|
| **R1** | Individual road vehicles on multi-lane networks | Simulated vehicle entities with positions, speed, car-following, lane assignments/changes, turning movements and queues; not flows drawn as animated textures | Core |
| **R2** | Import real cities and author roads | Load geographically meaningful roads from OpenStreetMap (OSM) and retain provenance; create an entire synthetic network as an alternative | Core |
| **R3** | Quasi-realistic work/life travel | Daytime demand driven by residential/work/retail/other activities and OD relationships, not merely random vehicles uniformly spawned at nodes | Core, incrementally refined |
| **R4** | High-ingress/egress special places | Configurable parking lots/garages, railway stations, airports, schools, large employers, shopping destinations, communities and region boundaries; controllable temporal peaks and queues | Core |
| **R5** | Advanced road & traffic controls | Construct expressways/ramps; add/delete/modify roads and lanes; one-ways, turn/access restrictions, intersections, signal timing; vehicles prefer plausible **fast/generalized-cost routes**, can reroute in response to changed congestion | Core (start with a subset; complete in early gameplay milestones) |
| **R6** | Browser-first, no heavyweight game engine | Usable in a normal browser; workers/WASM accepted; local server if necessary; desktop packaging with a browser-based UI permitted | Core |
| **R7** | Person agents and later multimodal mobility | Design travel demand in terms of people/activity chains; allow future bus, metro, tram, rail, air and intermodal trips without rewriting demand model | Architectural invariant now; vehicle operations later |
| **R8** | Batch road import + user modifications; no buildings | Editable imported roads, customized places, entrances, exits and spawning points; vehicles originate/terminate at connectors instead of requiring building meshes or individual-building data | Core |

**Interpretation of “Core”:** must be included in the architectural contract and delivered through a staged playable path. It does **not** mean every advanced variant needs to ship in the first coding sprint. Later-phase deferrals must be explicit and must not make the required feature impossible to add.

### 1.3 Explicit non-goals

- Engineering-grade calibration, legal advice about traffic design, or claiming simulated numbers predict actual congestion.
- High-fidelity vehicle physics, crashes, damage, manually driving individual cars, pedestrians/metro/rail/aircraft vehicle simulation in first release.
- Individual building geometry, parcel-specific inhabitants, property economics, or a full city-builder economy.
- Mandatory cloud service, mandatory account, game streaming, Unity, or Unreal.
- Traffic that only follows geometric shortest paths or ignores lane/turn/one-way connectivity.

### 1.4 Product principles

1. **Gameplay first, mechanisms honest.** Readable queues, visible route behavior, responsive editing, consistent outcomes.
2. **Cities are editable systems, not immutable basemaps.** Imported geometry is a starting state; authored changes are first-class.
3. **The place–person–trip abstraction is primary; buildings are optional decoration.**
4. **The simulation is headless and render-independent.** Browser renderer, future desktop runtime, experiments, and tests consume the same state.
5. **Deterministic scenarios.** Seed, clock, network version, activity model and policies produce replayable results.
6. **No silent fabrication on import.** Inferred lanes/turns/speeds must be tagged with confidence/provenance and editable.
7. **Make reversible decisions early.** Keep road-import, traffic-engine, routing, renderer, and persistence behind versioned interfaces.

---

## 2. Evidence-backed upstream repository and product references

All links below were checked against public project descriptions or source listings on **2026-11-03**. A listed feature is a **project claim**, not a guarantee it works correctly: hands-on audit is required. Check each repository's pinned commit and current license before incorporating code. Distinguish code reuse from study-only UI or algorithm references.

### 2.1 Priority A — inspect and benchmark first

| Resource | URL and relevant directories/docs | Reuse candidate | License / caution |
|---|---|---|---|
| **TRIZHAX Traffic Flow Simulation** | [Repository](https://github.com/TRIZHAX/trizhax-traffic-flow-simulation), [README](https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/main/README.md), [license](https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/main/LICENSE), [live demo](https://trizhax-traffic-flow-simulation.vercel.app/) | Browser-native TypeScript structure, IDM/MOBIL, signal logic, OSM import, network editor, world validation, deterministic tests, export/replay UI, optional 2D/3D rendering. README identifies `src/simulation/`, `src/world/`, `src/rendering/`, `src/components/`, `src/analysis/`, and `scripts/selftest.mjs`. | **MIT**. Only one public commit at time of review; zero-star/fork project. Treat as *promising but unproven*. Do not automatically fork it as the main product without tests and architecture audit. |
| **A/B Street** | [Repository](https://github.com/a-b-street/abstreet), [technical traffic simulation](https://a-b-street.github.io/docs/tech/trafficsim/), [map editing](https://a-b-street.github.io/docs/tech/map/edits.html), [simulation live edits](https://a-b-street.github.io/docs/tech/trafficsim/live_edits.html), [live game](https://play.abstreet.org/) | Mature reference for lane geometry, intersections, parking, map edits, activity/person behavior, feedback and game UX. Repository top-level contains `sim/`, `synthpop/`, `importer/`, `map_model/`, `map_gui/`, `raw_map/`, `convert_osm/`, `headless/`. | **Apache-2.0**. Rust and a large historical architecture; parent project notes focus shifted to narrower projects after 2021. The historical engine has known simplifying assumptions (e.g. older lane choice, acceleration, congestion routing)—do **not** assume these match R5. |
| **osm2streets** | [Repository](https://github.com/a-b-street/osm2streets), [README](https://github.com/a-b-street/osm2streets/blob/main/README.md), [StreetExplorer](https://a-b-street.github.io/osm2streets/) | OSM → geometrically detailed streets and lanes; representation and rendering of road/lane polygons; Rust `osm2streets/`, OSM reader `streets_reader/`, JS/WASM `osm2streets-js/`, regression tests and web interface. Especially valuable for difficult imported intersections and divided roads. | **Apache-2.0**. API explicitly described as unstable; turning movements and crosswalk behaviors may be incomplete/planned. Its street geometry is **not** a complete traffic-dynamics engine. |
| **Nitai Aharoni's Traffic Simulator** | [Repository](https://github.com/nitaiaharoni1/traffic-simulator), [live demo](https://nitai-traffic-simulator.web.app/), repository `ARCHITECTURE.md`, `src/`, `fixtures/`, `experiments/` | High-quality browser architecture reference: OSM-derived lanes, junction movements, IDM, deterministic headless tests, signal controls, instanced WebGL vehicles, route demand, comparison harness. Specifically study its **limitations** on dynamic rerouting, land-use demand, public transit. | **PolyForm Noncommercial 1.0.0**; **NOT OSI open source**. Inspect/learn for planning, but **do not copy source into a commercially unrestricted game or distribute derived code** without a compatible license/permission. Public repo availability sometimes intermittently fails; record exact access outcome. |
| **CityFlow** | [Repository](https://github.com/cityflow-project/CityFlow), [road-network JSON specification](https://github.com/cityflow-project/CityFlow/blob/master/docs/source/roadnet.rst), [flow specification](https://github.com/cityflow-project/CityFlow/blob/master/docs/source/flow.rst) | Strong lane graph representation: directional roads, lane links, intersections, movements, signal phases, flows; fast multithreaded vehicle simulation and optional C++ engine precedent. | **Apache-2.0**. Its traffic-demand and interactive road-editor features are not interchangeable with your required activity model/editor. Use as schema/infrastructure and backend candidate, not an assumed turnkey game. |

### 2.2 Priority B — supporting engine, data, UI and future modules

| Resource | URL | Use / warning |
|---|---|---|
| **Eclipse SUMO** | [Source](https://github.com/eclipse-sumo/sumo), [Netconvert](https://github.com/eclipse-sumo/sumo/blob/main/docs/web/docs/netconvert.md), [Netedit docs](https://sumo.dlr.de/docs/Netedit/index.html) | Optional high-capability **local backend** for dynamic microscopic traffic/intermodal expansion; OSM imports; routes, connections, signals, person plans. **EPL-2.0** with GPL secondary option; scrutinize binary/tool dependencies and distribution. Backend adapter should not leak SUMO-specific IDs into canonical game save files. |
| **GraphHopper** | [Source](https://github.com/graphhopper/graphhopper) | Advanced routing and OSM-import design, turn restrictions, vehicle profiles, alternatives, routing cost handling. **Apache-2.0**, Java; probably not a first-phase runtime dependency. |
| **traffic-simulation.de** | [Source](https://github.com/movsim/traffic-simulation-de), [README](https://github.com/movsim/traffic-simulation-de/blob/master/README.md) | Browser-based IDM/MOBIL and on-ramp/merging demonstrations; concept and test-case inspiration. **GPL-3.0**: don't incorporate code in a differently licensed product without choosing compatible licensing. |
| **MapLibre GL JS** | [Source](https://github.com/maplibre/maplibre-gl-js), [docs](https://maplibre.org/maplibre-gl-js/docs/) | Browser map camera, GeoJSON/vector overlays, custom WebGL layers; background **basemap** and editor view, not road topology or simulation. Verify deployed version and compatible rendering API. |
| **Terra Draw** | [Source](https://github.com/JamesLMilner/terra-draw), [getting started](https://github.com/JamesLMilner/terra-draw/blob/main/guides/1.GETTING_STARTED.md) | MapLibre-compatible geometry authoring and vertex manipulation. **MIT**. Useful UI primitive, but must add domain-specific snap-to-road, junction/turn editing, graph validation and undo/redo. |
| **deck.gl** | [Source](https://github.com/visgl/deck.gl) | **MIT** WebGL map overlays/large-scale visualization, instanced vehicle symbols/heatmaps/inspection; alternative to custom MapLibre layer, not necessarily both. |
| **MATSim** | [Source](https://github.com/matsim-org/matsim-libs) | Study person/activity plans, departure-time preferences, mode choices and iterative learning for long-term mobility agents. Java research framework; **do not** make a compulsory first-release dependency; review license separately before reuse. |
| **OpenTripPlanner** | [Source](https://github.com/opentripplanner/OpenTripPlanner) | Future public transit/multimodal route planning using OSM + GTFS; not a microscopic traffic simulator. |
| **GTFS specification** | [Official documentation](https://gtfs.org/documentation/overview/) | Future bus/tram/metro/train stops, routes, trips, stop times, service calendars; don't implement GTFS import in the first engine milestone unless it has a clear scoped task. |
| **Electron** | [Source](https://github.com/electron/electron) | Browser-UI desktop wrapper with a bundled local process; candidate when a backend becomes necessary. Consider Tauri only after checking process architecture/performance/bundling. |

### 2.3 UI/design references (not automatically reusable assets/code)

- [**A/B Street game & interface**](https://a-b-street.github.io/docs/software/abstreet.html): navigable map; person/car inspector; road-section lane editor; signal phases; side-by-side scenario comparison. Specific visual reference: [lane editing screenshot](https://a-b-street.github.io/docs/tech/map/geometry/edit_transit.png); [signal editor screenshot](https://a-b-street.github.io/docs/project/history/retrospective/tsig_four_stage.png); [traffic screenshot](https://a-b-street.github.io/docs/tech/map/geometry/chorlton_traffic.jpeg).
- [**Junctiona**](https://junctiona.com/): browser workshop for editing streets and intersections, OSM imports, JSON project workflow and traffic source controls. **Its site explicitly states a server connection is required** for imports and simulation. No reuse license/source availability established: design/product reference only.
- [**Junxions**](https://store.steampowered.com/app/1447250/Junxions/): reference for lane-by-lane road authoring, tram corridors, junction/signal visualization and game-like interaction. Treat as a **commercial visual reference only**, not a code source.
- [**Mini Motorways**](https://store.steampowered.com/app/1127500/Mini_Motorways/): restrained presentation, immediate visual consequences, accessibility; *not* a suitable model of lane geometry or demand.

**Explicit research assignment for lead agent:** run A/B Street, TRIZHAX, and at least one browser alternative; inspect a **four-way signal, highway on-ramp, one-way/turn-restriction, and imported urban map** in each. Capture actual issues, FPS/step time, data schema, code maturity and missing functionality. Do not select a foundation purely by feature list in README.

---

## 3. Recommended starting architecture (hypothesis to validate)

### 3.1 Default recommendation

**An original TypeScript monorepo with a pure, headless simulation core; Web Worker host; MapLibre-based 2D editor; React UI; JSON/Zod versioned scenario documents; initially no backend.** Reuse permissive libraries or independently adapt selected modules from TRIZHAX or osm2streets only after a code audit. Do not blindly fork A/B Street or TRIZHAX: user-specific graph editing and demand requirements may be more expensive to retrofit than to build behind clean interfaces.

Target runtime progression:

1. **Browser-only:** core in TypeScript Web Worker; main thread UI/rendering; OSM imported through user-selected small extracts or responsibly cached API queries.
2. **Accelerated browser:** profile bottlenecks; move expensive routing/vehicle stepping into WASM or optimized Web Workers only when measured.
3. **Optional desktop:** Electron browser window with local importer/simulation service (SUMO or custom Rust/C++), IPC/WebSocket. Browser and desktop consume exactly the same scenario format and engine adapter protocol.

This is a preferred starting hypothesis—not a license to skip benchmarks. The lead agent should compare (A) original TS + targeted reuse, (B) TRIZHAX fork/refactor, (C) native backend + browser UI and document the decision.

### 3.2 Logical dependency diagram

```text
                         UI (React / MapLibre)
                map / edit mode / controls / analytics
                               |
                     Command + Query API
                               |
                 Game State / Scenario Service
              /                  |                \
       Import/Export        Graph Editor         Run Control
      OSM/JSON/ZIP         undo/redo/valid.     pause/step/replay
              \                  |                /
                   CANONICAL CITY MODEL
             roads, lanes, movements, signals,
              places, portals, person demand
                         /       \
                 Routing Engine   Demand Scheduler
                         \       /
                       Traffic Engine
             fixed-step, headless, deterministic
                               |
                     Vehicle State Snapshots
                               |
                     Renderer / Metrics

        Optional native/backend adapter mirrors engine API
        (not a second independent source of road truth)
```

### 3.3 Proposed packages (adapt after audit)

```text
apps/
  web/                        # browser game, editor, maps, panels, examples
  desktop/                    # deferred Electron shell; not required by MVP
packages/
  schema/                     # shared types, Zod schemas, migrations, units
  geo-import/                 # OSM/GeoJSON adapters, projection, provenance
  network/                    # roads, lanes, intersections, movements, indexes
  editor/                     # domain commands, patches, undo/redo, validation
  routing/                    # path search, generalized costs, route cache
  demand/                     # places, people, activity schedules, trip generator
  simulation/                 # clocks, vehicle dynamics, movements, signals
  engine-host/                # worker messages and optional backend contract
  visualization/              # overlays, vehicle layers, metrics, inspectors
  scenarios/                  # seeds, save/load, autosave, comparisons
fixtures/
  synthetic-grid/
  motorway-interchange/
  station-surge/
  osm-neighborhood/          # small OSM-derived sample + attribution
  broken-network/
docs/
  adr/                        # architecture decisions, alternatives, evidence
  design/                     # UX and systems specs
  references/                 # upstream audit + license manifest
  tasks/                      # small agent-ready task contracts
AGENTS.md
CLAUDE.md                      # optional if using Claude Code
```

**Ownership rule:** `packages/schema` and the canonical graph are lead-agent-controlled interfaces; worker agents do not independently invent competing `Road`, `Lane`, `Trip`, or `Place` models.

### 3.4 Interfaces to design *before* implementation

- `ImportAdapter`: raw data -> normalized road graph + diagnostics/provenance.
- `NetworkEditCommand`: immutable/transactional edit -> graph patch + inverse patch + affected IDs + validation report.
- `DemandProvider`: `seed`, time range, network and place snapshot -> person trips and/or incremental departure events.
- `RouteProvider`: origin connector, destination connector, departure time, vehicle mode, network version, traffic costs -> legal lane-aware route or structured failure.
- `TrafficEngine`: load/start/pause/step/restore, accepts committed road and demand snapshot; returns typed snapshots and metrics.
- `EngineHost`: worker/native bridge with versioned request/reply and cancellation; no direct renderer imports.
- `ScenarioStore`: import/export/save/open/check migrations, checksums, provenance and edit history.

**Hard interface invariant:** a vehicle never materializes at an arbitrary map pixel; it enters a valid lane via a **typed place/portal connector** with explicit capacity/queue logic, and exits at a compatible destination connector.

---

## 4. Canonical world and traffic data model

### 4.1 Spatial/network entities

- `Road`: physical corridor with source geometry and attributes (names, road class, provenance, speed, restrictions, grade separation).
- `DirectedRoadSegment`: drivable direction between graph nodes; contains ordered lane IDs, real projected geometry, travel direction, permissions.
- `Lane`: centerline/offset geometry; width, allowed vehicle classes, direction, max speed, changes/restrictions, provenance/confidence.
- `Intersection`: topology node or area grouping complex OSM intersections, geometry, legal turns and control policy.
- `LaneMovement`: legal connection from incoming lane to outgoing lane, including curve through intersection, conflict groups, priority and signal stage dependency.
- `Ramp / Merge / Diverge`: special lane-to-lane transition controls with realistic yielding/acceleration approximation. **Grade-separated crossovers must not connect by geographic coincidence.**
- `SignalProgram`: named phases, permitted movements, minimum/maximum green, amber/all-red, offsets and optional sensors; signal editor must validate conflicts.
- `NetworkBoundaryPortal`: region entry/exit mapped to one or more road lanes; controls external traffic and continuation outside cropped map.
- `Place`: ID, type, optional display polygon/point, population/jobs/activity weight, arrival/departure temporal profile, parking/loading capacity, optional service timetable.
- `AccessConnector`: one or more entrance/exit edges linking a place to valid lane(s) with in/out permissions, capacity, queues, behavior for full parking or blocked lanes.
- `Zone`: optional district aggregation for demand generation; **not** a building or parking lot object.

**Use projected metric coordinates internally** (e.g. a suitable local meter-based projection) while preserving WGS84 geographic coordinates and source OSM identities in the import metadata. Do not mix longitude/latitude degrees with traffic distances or vehicle dimensions.

### 4.2 Stable identifiers and edit semantics

- Namespace IDs: `osm:way/...`, `osm:node/...` for provenance; `game:road/...`, `game:lane/...`, `game:place/...` for canonical/edit-created entities. No promise that one OSM way equals one canonical road.
- Each import creates a **base map snapshot**. Player operations are semantic commands or patches referencing canonical IDs, with **stable remap tables** after splitting/merging roads.
- All writes are validated transactions; a failed edit must leave graph and simulation consistent.
- Undo/redo and `reset to imported baseline` are mandatory editor capabilities.
- On graph change, recompute affected lane geometry/movements, connectivity and routing caches. In early milestones require **paused edit + deterministic restart/replan**; later incremental/live edit support is optional. Display when a run becomes incomparable due to live edits.
- `networkVersion` increments on committed topology/permission changes; route caches must invalidate correctly.

### 4.3 People, activities, trips, vehicles

Keep distinct objects:

```ts
interface PersonAgent {
  id: string;
  homePlaceId: string;
  attributes: { travelerClass?: string; carAccess?: boolean };
  agenda: Activity[];
}
interface Activity {
  kind: 'home' | 'work' | 'school' | 'shop' | 'leisure' | 'airport' | 'other';
  placeId: string;
  earliestStartSeconds?: number;
  targetStartSeconds: number;
  durationSeconds?: number;
}
interface TripRequest {
  id: string;
  personId?: string;
  originPlaceId: string;
  destinationPlaceId: string;
  desiredDepartureSeconds: number;
  modePreference: 'car' | 'bus' | 'rail' | 'walk' | 'future';
}
interface Vehicle {
  id: string;
  tripId: string;
  kind: 'car' | 'taxi' | 'truck' | 'bus';
  laneId: string;
  positionMeters: number;
  speedMps: number;
  plannedMovements: string[];
  state: 'queued_at_origin' | 'driving' | 'queued_at_destination' | 'completed';
}
```

**These are illustrative contracts, not final compile-ready types.** For example, a person's multi-leg journey, parked-car ownership, multiple passengers and rail/air services will require extensions; keep `PersonAgent`, `TripRequest`, `Vehicle` separable.

### 4.4 Mode extensibility

Every trip is initiated by a person or an aggregate person-flow source, **not by a road vehicle by definition**. In the initial car-only game, mode selection maps the trip to a car/taxi. Later: transit itinerary creates wait, walk, board, ride, transfer and alight legs; intercity/airport schedules induce access trips; rail/air vehicles can use different network graphs. Avoid designing a shared road-vehicle class for trains and aircraft.

---

## 5. Real-city road import and authoring

### 5.1 Minimum import pipeline

1. **Select geographic extent**: map viewport/bounding rectangle, city search, GeoJSON boundary or uploaded `.osm/.pbf/.geojson` (PBF can be server/import-worker mediated).
2. **Acquire raw OSM data** responsibly; include relevant nodes, highway ways, turn restriction relations, access and lane tags, driving side, road classification, major transit station/airport/parking POIs when available.
3. **Normalize** topology and detect connected components; handle road splitting at intersections, divided carriageways, dual carriageways, tunnels/bridges and grade separation.
4. **Build lanes** from explicit tags (`lanes`, `lanes:forward/backward`, `turn:lanes`, `oneway`, `maxspeed`, `access` and relations); mark inferred defaults as such. Where data are ambiguous, offer an editable import wizard/default policy.
5. **Create legal lane movements** (turn restrictions, access, signal conflict geometry); run routing connectivity diagnostics.
6. **Clip and place boundary portals** at each drivable entry/exit to the selected region; ensure highway links are neither arbitrarily discarded nor treated as home origin points.
7. **Generate initial candidate places** from limited OSM POI/landuse data *if permitted/available*; otherwise show the user a simple place-paint/zone workflow. Never pretend the POIs constitute a complete activity model.
8. **Save import artifact** and full provenance (OSM attribution, snapshot timestamp, bbox, importer version, inferred assumption count).
9. **Expose diagnostics**: disconnected roads, duplicated intersections, missing turns, unconnected access points, broken ramps, suspicious inferred lane counts.

### 5.2 Two input pathways

- **Small map/browser path:** directly process modest OSM extracts/queries. Great for first gameplay; bound geographic area and entity count. Use an explicit provider adapter and cache, with rate limiting.
- **Bulk/desktop/server path:** import PBF/regional extracts using a local binary or service (e.g. osmium / SUMO `netconvert`, or `osm2streets`); produce canonical compact graph JSON/binary. Do not ship a synchronous giant PBF parser on the UI thread.

**OSM access constraints:** public Overpass services are shared resources and **not** an unlimited production data backend; use caching and extract/bulk options. Public Nominatim has an absolute maximum **1 request/second per application**, forbids client-side autocomplete and has other conditions; avoid depending on it as an unconstrained game-search API. Support direct bbox input and alternative geocoding providers, and keep provider configuration swappable. OSM data and derivatives are under ODbL; show attribution and assess derived-database distribution and export obligations. See official sources in §15.

### 5.3 Batch editing/import additions

Core editor must allow:

- load imported base map, select multiple roads; bulk change lane counts, direction, types, widths, speed limits and permitted turns;
- draw/connect new roads including **expressways with proper merges, splits, off-ramps, on-ramps** and bridges;
- split/merge roads and intersections, convert intersection control (yield/stop/signal/roundabout when supported), customize signal phases;
- change one-way, lane direction, road access class, turn bans, bus lanes later;
- add/edit/move/delete places and connectors, set entrances/exits and daily trip profiles;
- import user-authored road and place features from **documented JSON/GeoJSON**; merge/conflict handling and validation rather than silently overwrite IDs.

**UX rule:** editing visually modifies canonical simulation topology, not merely a decorative polyline overlay. Every feature must have a test showing that it changes legal vehicle movements or network connectivity as expected.

### 5.4 Dedicated import test areas

- **Small one-way downtown grid:** one-way correctness, legal turns, lane directions.
- **Highway corridor with ramps/interchange:** freeways, divided carriageways, merges, choice between highways and local streets.
- **Railway station or airport perimeter:** scheduled ingress/egress spike, multiple access portals, queue spillback.
- **Tricky grade-separated crossing:** avoid phantom turns.
- **Suburban residential road network:** places inside streets, non-arterial departures and destinations.

Test with synthetic fixtures first; add small OSM-derived fixtures (with attribution) for regression after functionality is stable.

---

## 6. Traffic behavior and routing requirements

### 6.1 Vehicle dynamics: adequate for a game, real enough to be interesting

- Fixed simulation timestep, independent from render FPS; deterministic seeded random driver parameters.
- Car following (IDM or a clearly documented stable simplified analog), acceleration/braking, safe headway, queues propagating upstream through intersections.
- Multi-lane overtaking/lane-changing (MOBIL-like safety and incentive, plus **mandatory route-aware lane selection** before a turn or ramp). The latter is essential: lane changing alone does not solve approach-to-turn lanes.
- Valid movement path through junctions with yield, stop signs, traffic signal conflict groups, intersection occupancy, turn radius and basic priority.
- Motorway joins/diverges, lane drop, bottleneck and jam formation; no teleporting from one lane to a disconnected lane.
- Spawn queue and destination connector queue: when blocked/full, maintain pending vehicles and track waiting time instead of dropping demand.
- Add simple heterogeneous cars/taxis/trucks later; avoid elaborate vehicle physics before legal routing works.

### 6.2 Routing: explicit rejection of shortest-distance-only behavior

A useful **initial** generalized travel cost is:

```text
edgeCost = predictedTravelTime
         + turnDelay
         + laneChangeOrTurnRiskPenalty
         + roadClassPreferenceOrAvoidancePenalty
         + tollOrRestrictionPenalty (future)
```

- Default speed-aware shortest **expected-time** path, not geometric shortest distance.
- Model access restrictions and legal lane-to-lane connectivity as **hard constraints**, not penalties.
- Initially A*/Dijkstra on turn/movement-aware graph; include approximate intersection wait/turn penalties.
- Introduce EWMA observed link speeds and queues for congestion-aware rerouting, with bounded replan frequency, hysteresis and alternative-route diversity to avoid synchronized oscillations.
- Plan at a coarser road-graph level if needed, then resolve into legal lanes with mandatory advance lane selection. The route cannot be considered valid if lane assignment becomes impossible at an upcoming turn.
- New expressway/ramp construction must trigger routing cost and connectivity update; a sufficiently faster **longer** expressway route must be selected in a deterministic test.
- Manage failures: disconnected graph, no legal route, closed destination, unsafe vehicle reroute, edit while driving; expose reason codes rather than silently teleporting or deleting cars.

### 6.3 Traffic lights and intersection policy

- Phase editor with explicit allowed lane movements; amber/all-red; minimum phase timings; conflict detection; preview the currently active green and corresponding vehicles.
- Defaults for uncontrolled intersections (yield/stop) and auto-generated safe signal programs where feasible.
- Stop-line queues and spillback must affect upstream throughput.
- Optional later: protected/permissive turns, actuated timing, coordination, adaptive signals and incident-induced overrides.

---

## 7. Synthetic population, places, and demand

### 7.1 No-building activity model

**Do not require detailed parcels/buildings.** Aggregate people/jobs/visitors into user-defined `Place`s or `Zone`s. Give each one place type, capacity/activity weights, and a time-of-day profile. The player can override profiles or create special scheduled events.

Suggested first generator:

1. User paints or imports coarse residential, workplace, retail, school, airport/station and gateway zones (or accepts editable defaults).
2. Assign population, jobs, visitor attractions and accessible car share to those zones.
3. Generate reproducible persons/households at **aggregated place level** with work/home pairings based on accessibility, gravity weighting and controlled random variation.
4. Build simple activity chains: `home -> work -> shop? -> home`, plus school, leisure and non-work trips; distribute departure times rather than simultaneous pulses.
5. Choose mode = car initially; preserve mode-choice and itineraries interfaces for later phases.
6. Map trip ends to legal entrance/exit connectors; generate vehicles only when space permits, queue otherwise.
7. External boundary portals supply through-traffic and commuter entries/exits, with configurable profiles.

Generate validation summaries showing **trip productions and attractions by place/hour**, total trips, mean journey lengths, queued unspawned trips, completed trips and canceled/unreachable trips. Allow playback/inspection of an individual commuter's agenda and route.

### 7.2 Special-place event model

Each place may have `arrivalRate(t)`, `departureRate(t)`, `capacity`, `openingHours`, `eventSchedule`, `entrances[]`, `exits[]`, and optional `dwellTimeDistribution`.

- **Rail station:** train arrival at 08:05 releases passengers over a short interval into taxis/drop-off/pickup traffic; peak roadside demand and queue at pickup area.
- **Airport:** time-banded departures and arrivals create arrival/departure curb waves, employee shifts, taxis, parking access and regional motorway traffic.
- **Shopping center:** stronger weekend/afternoon demand, parking capacity and queue.
- **School:** pronounced morning pickup/drop-off, afternoon release.
- **Residential community:** morning outflow/evening inflow, multiple entrances with turning restrictions.
- **Regional exits:** external inflow/outflow with no modeled off-map buildings.

Car parking is a **capacity and access constraint**, not a demand for individual parking-space rendering. Fully spatial parking circulation is out of initial scope.

### 7.3 Future multi-modal interface

Represent a trip as `Leg[]` (`drive`, `walk`, `wait`, `bus`, `tram`, `metro`, `rail`, `air`) and transfers with time/capacity; preserve one stable `PersonAgent` across trips. A later transit implementation can be GTFS-based; airports may initially **generate road access demand** without rendering aircraft. This distinction prevents overbuilding the first release.

---

## 8. Game design and user interface

### 8.1 Primary user workflow

**Choose a city → inspect imported roads → fix/import defaults → place trip generators → press Play → observe congestion → edit roads/lights → rerun or compare → save/share scenario.** A user should be able to learn the entire loop without engineering documentation.

### 8.2 Layout concept

```text
┌───────────────────────────────────────────────────────────────────┐
│ City / Scenario   Undo Redo   Import Export   Run controls  Speed │
├───────────┬──────────────────────────────────────┬────────────────┤
│ TOOLBOX   │                                      │ INSPECTOR      │
│ Select    │       2D CITY MAP + CARS             │ Road / Place   │
│ Draw Road │       multi-lane shapes, routes      │ Lane editor    │
│ Junction  │       congestion colors, signals     │ Turns/signals  │
│ Place     │       portals, queues                │ Demand profile │
│ Restrict  │                                      │ Validation     │
├───────────┴──────────────────────────────────────┴────────────────┤
│ Time 07:45 ▷ 1x 5x 20x | completed trips | delay | queues | chart │
└───────────────────────────────────────────────────────────────────┘
```

UI style: elegant, legible, **cartoon 2D top-down**. Building footprints are decorative backdrop at most, not simulation objects. Vehicle rectangles/colored shapes are acceptable. Avoid photorealistic 3D overhead; optional tilt/Three.js should be modular and deferred.

### 8.3 Core panels and interactions

- **City picker/import wizard:** bbox/location or file upload; road types, driving side, import progress, warnings, source attribution.
- **Road/segment inspector:** lanes shown as editable direction-aware strips; speeds, access rules, turns, parking/portal proximity.
- **Intersection editor:** readable phase timeline and movement arrows, conflict warnings, preview step.
- **Place editor:** class, population/jobs/custom arrivals, hourly bar chart, access portals, spawn queues and capacity.
- **Vehicle inspector:** origin/destination, person-trip, current speed/lane, chosen route, cost estimate, reason for reroute or wait.
- **Layers:** vehicle density/speeds, queues, travel-time cost, route selection, disconnected segments, place inflow/outflow, signals.
- **Transport/time controls:** pause/play/step, speed multiplier, jump-to-time, seeded restart, scenario baseline/variant.
- **Compare view:** before/after average trip time, percentile delay, failed trips, road usage; same seed and base demand to isolate edit effects.
- **Validation sidebar:** critical failures block run; warnings explain what was inferred or remains unrealistic.

### 8.4 UX behavior rules

- Geometry edits are staged and visually previewed; **commit, validate, undo** should be intuitive.
- Paused editing is allowed during a run. First release can require restart to apply structural changes; **tell the player explicitly**. Signal edits may be supported between safe phase boundaries in a later milestone.
- Hover/click every vehicle and road, view its route and destination, and optionally follow a vehicle.
- The road visual must reflect actual permitted lane connections: no rendered lane arrows for illegal movements.
- Optimize readability at 5–20 pixels per vehicle; use LOD (vehicles aggregated/dots at low zoom).
- Game metrics use plain language; include a visible **“synthetic traffic, not observed traffic”** notice.

### 8.5 Gameplay rather than only a tool

Early sandbox mode is mandatory; optional simple challenges can be added after core works: clear station queue, reduce downtown delay, maintain network accessibility while adding a one-way, design expressway bypass within a budget, handle stadium event. Avoid prematurely implementing a full economy/budget engine.

---

## 9. Import/export, persistence and reproducibility contract

### 9.1 Versioned project file

Prefer a **portable ZIP** (`.citytraffic` or another agreed extension) holding JSON/GeoJSON assets. Support a compact single JSON export for tiny examples. Make the complete user-authored city reproducible without needing a live Overpass query.

```text
mycity.citytraffic   (ZIP archive)
  manifest.json                 # schemaVersion, appVersion, checksums, data licenses
  world/base-network.json       # normalized imported base; provenance
  world/edits.json              # ordered semantic edits / reversible patch set
  world/places.json             # zones/places and access portals
  world/signals.json            # signal policies and control configurations
  demand/model.json             # demographics weights, timetable/events, mode params
  scenarios/baseline.json       # seed, time window, params, network refs
  scenarios/variant-01.json    # alternate patches/parameters
  ui/view-state.json            # camera, layers, saved selections (optional)
  runs/run-summary.json         # optional provenance-stamped results
  attribution/OSM.txt           # attribution, snapshot/source and ODbL link
```

Do not duplicate entire huge network into every scenario variant. `manifest.json` must carry schema version, source provenance and per-file integrity hashes. Loaders should migrate prior versions explicitly.

### 9.2 Minimal manifest (illustrative)

```json
{
  "schemaVersion": "0.1.0",
  "projectId": "demo-city",
  "name": "Demo City",
  "coordinateSystem": { "source": "EPSG:4326", "internal": "local-meters" },
  "roadSource": {
    "kind": "openstreetmap",
    "snapshotDate": "YYYY-MM-DD",
    "bbox": [0, 0, 0, 0],
    "attribution": "© OpenStreetMap contributors; ODbL 1.0"
  },
  "defaultScenario": "baseline",
  "seed": 24680,
  "files": []
}
```

### 9.3 Three export classes

1. **Project exchange:** ZIP/json with graph, edits, places, demand, scenario, provenance. Import into another installation with deterministic playback.
2. **Interoperability:** road geometry GeoJSON and simple CSV trip list with node/connector IDs; future adapters for SUMO networks/routes and GTFS stops/trips. Mark loss of lane/signal semantics if exporting plain GeoJSON.
3. **Analysis:** travel-time and delay distributions, throughput, queue lengths, vehicle trajectories, OD counts and signal states in CSV/JSON. Generated outputs labelled **synthetic**, with seed/engine version/time-step.

**Migration test:** export scenario → import in clean browser → compare network/places/demand IDs and first N fixed simulation steps. The save file is the canonical reproducibility contract, not a screenshot or a UI local-storage blob.

---

## 10. Backend and performance strategy

### 10.1 Browser-first default

- Keep headless sim in a Web Worker using a fixed simulation clock; send lightweight typed snapshots to main-thread renderer.
- Sim stepping independent from `requestAnimationFrame`; allow adjustable time acceleration by advancing several fixed steps per rendered frame.
- Use dense arrays and spatial indexes for active vehicles if profiling shows object-heavy iteration is costly.
- Render only needed elements at current zoom; batch vehicle draw calls (MapLibre custom WebGL layer or deck.gl). Avoid one DOM node per car.
- Calculate routes in worker and cache appropriately; recompute dynamic weights at intervals rather than on every vehicle frame.
- Export/save off main UI thread where practical.

### 10.2 Provisional performance *targets* (to benchmark, not claims)

| Scenario | Initial goal |
|---|---|
| Tiny synthetic four-way / 100–300 cars | Smooth 60 FPS on modern desktop; deterministic and no crashes |
| Neighborhood / ~1,000–3,000 active vehicles | 30+ FPS UI and 1× simulation speed in contemporary desktop browser |
| 10× speed-up | Works for small test networks; gracefully throttles on larger maps |
| Imported regional network | Load-time progress, validation and explicit size limits; no UI freeze |
| Long-running game | Memory stable, no accumulating lost vehicles/trips |

These are initial **acceptance targets for empirical revision**. No one should claim city-wide 10k+ fully microscopic traffic in-browser until profiling demonstrates it. Benchmark CPU simulation time, worker transfer time, rendering time, memory and routes/sec separately.

### 10.3 Switching to a backend

Decision trigger: a core required scenario demonstrably cannot run acceptably in browser/WASM within a reasonable optimization budget, or imported road data exceeds bounded browser memory. Then prototype a backend adapter, compare against CityFlow and SUMO (or custom Rust), and retain the same UI and schema. A desktop distribution can embed the backend and communicate over a local protocol; the web deployment may use a remote service, with concurrency and cost limits documented.

**Do not architect every edit as a synchronous remote call.** UI editing and camera interactions remain local even if the traffic engine moves to a server.

---

## 11. Phased delivery: preserve required scope without big-bang implementation

### Gate 0 — Evidence, running prototypes, architecture decision

**Lead-owned, before substantial delegation.** Clone/run TRIZHAX, A/B Street and the selected alternative; inspect imports, graph/movement schemas, routing, tests, UI, export, licenses; benchmark a reproducible grid/map. Produce an **upstream reuse matrix**, ADR for fork vs original TS vs native backend, and a short demonstrable spike (e.g. OSM map → lane graph → one car, if required). Set exact MVP and early-gameplay gates with owner.

**Exit:** written architecture choice, known blockers, license inventory, first 6–10 tasks with crisp contracts.

### Gate 1 — Playable microscopic traffic vertical slice

- Headless deterministic sim, small synthetic multi-lane 2D grid with signalized intersection, 100+ individual cars, car following, legal turns, basic speed-time routing, pause/play/speed/inspect.
- Decoupled renderer and worker; simple add-place and entrance/exit spawn.
- V1 JSON save/open of tiny world and scenario.

**Exit:** can watch a meaningful queue form/dissipate, inspect a car's path, restart with the same result.

### Gate 2 — Real-city import and genuine network editor

- Import a small OSM urban map, lane topology/one-way/turn rules/inference warnings, boundary portals.
- Edit/add/split/remove roads, lanes, junctions, and access/turn restrictions; lane-accurate rendered state; undo/redo and topology validation.
- Batch edits and saved user modifications; import/export round-trip.

**Exit:** imported city remains editable; changing a one-way or adding a road changes legal routes, not only the image.

### Gate 3 — Places, daily life and useful routing

- Residential/job/retail/school/activity place generator, daily schedule, basic person/home/work/return chains.
- Special station/airport/mall parking and regional boundary sources; configurable tidal flows/arrival pulses, entry queues/capacity.
- Expressway/ramp construction; realistic vehicle merging and route-aware lane choice.
- Congestion-aware alternate routes, rerouting safeguards.

**Exit:** a morning rush has identifiable home→work directionality; adding a longer but faster expressway changes route choice and bottlenecks; station pulse creates measurable spillback.

### Gate 4 — Compelling sandbox and scenario comparisons

- Full signal phase UI; traffic heatmaps/metrics; baseline-vs-variant playback, stable seeds; user-friendly import wizard, vehicle inspector, project ZIP and CSV export.
- Benchmark optimization, tutorial/challenges; polished visual hierarchy.

**Exit:** a new user can independently import a neighborhood, add a station, build a bypass, edit signals, and compare before/after without opening developer tools.

### Gate 5 — Optional future development

- Bus lines/stops, transit vehicle operations, schedule/GTFS; walk/access legs and real person modal choice.
- Tram/metro/rail graph, timed transfers and journey planning; air services as scheduled person movement when justified.
- Desktop/native backend/WASM acceleration; large region processing; advanced demand behavior; adaptive signals; 3D variant.

**Do not quietly move R1–R6 or R8 into Gate 5.** R7's multimodal **architectural readiness** is required from Gate 0; actual transit operations are later.

---

## 12. Mandatory tests and acceptance scenarios

Tests should run **headless in CI** and drive a few real browser scenarios in Playwright. Prefer properties/behavior over screenshots alone.

| Test ID | Fixture/action | Pass criterion |
|---|---|---|
| **T01 vehicle conservation** | Inject N valid car trips | Each car is pending, active, completed, or explicitly failed; none silently disappears; accounting identity holds |
| **T02 determinism** | Replay same seed, map, version and demand | Identical state/event hashes after fixed timesteps (within documented numeric tolerance) |
| **T03 multi-lane queue** | Two approach lanes, congestion at signal | Vehicles occupy distinct lanes, observe headways, queue and pass legally |
| **T04 turn restriction** | Ban a previously available right/left turn | No vehicle traverses prohibited movement; routes replan or return structured no-route |
| **T05 expressway preference** | A longer but faster highway alternative | At least some eligible vehicles choose it based on expected time, not shorter distance |
| **T06 congestion reroute** | Hold queue or close key corridor | Some vehicles select alternate valid paths; bounded replanning avoids route oscillation |
| **T07 lane-aware ramp** | On-ramp and exit with multiple lanes | Vehicles merge via valid transitions and approach correct lane before exit |
| **T08 place connectors** | Residential exit, workplace entrance | Cars enter/leave **at portals**; full/blocked entry creates an observable queue |
| **T09 daily activity** | Synthetic residents and workplaces | Morning workward, afternoon homeward volumes differ in expected directions; total trips reconcile |
| **T10 station surge** | Timetable arrival + pickups | Time-localized surge, roadway queue/throughput consequences; repeated seed replay matches |
| **T11 real-map import** | OSM fixture with one-way, divided highway, bridge | Geospatial placement and lane/connectivity consistent; no fictitious bridge-level turn |
| **T12 graph edit** | Add a connecting bypass, split road, reverse a lane | All new IDs/movements are valid; routing updates; undo restores exact pre-edit graph |
| **T13 signal safety** | User creates conflicting green movements | Editor rejects/flags unsafe phase; legal program permits intended flows |
| **T14 round-trip** | Export, clear storage, reimport | Canonical road/place/scenario hashes and simulation outcomes match |
| **T15 multimodal contract** | One person with future bus/rail mode preference | Person trip serializes without requiring a `Vehicle` object; no invalid road-car spawn |
| **T16 UI performance** | Fixed small/medium workload | Measured frame time and sim steps/sec reported; no unbounded memory growth |
| **T17 edit live-state policy** | Edit road while simulation running | Safe pause/restart or transactional update; never an inconsistent partial graph |
| **T18 import diagnostics** | Missing lanes, disconnected components, invalid file | Actionable warnings/errors; imported assumptions identified, no silent map fabrication |

**Gameplay acceptance demonstrations** (record short clips or deterministic Playwright artifacts):

A. **“Morning commute”**: residential community → offices → home with observed rush periods; streets visibly congestion-limited.  
B. **“Airport access”**: 20-minute arrival/departure burst creates traffic from parking/terminal portals; player adds a dedicated road/changes signal and sees improvement.  
C. **“Bypass”**: player adds an expressway with on/off ramps and a properly connected interchange; vehicles prefer it if travel-time costs justify it.  
D. **“Import-edit-share”**: load real OSM neighborhood, fix road restrictions, save ZIP; someone else imports and replays same experiment.

---

## 13. Lead agent responsibilities and delegation protocol

### 13.1 Role split

**Lead agent (Fable / GPT Astra):** architecture, upstream diligence, data contracts, license review, technical strategy, scope protection, integration planning, acceptance gates, merge review and high-risk algorithm assessment. Consult owner on substantive choices. Do not delegate ambiguous tasks that require independent redesign of core schemas.

**Implementation agents (Opus 5.5 / GPT 5.6 Sol):** scoped modules with named files/interfaces, bounded acceptance tests, documentation and implementation evidence. They may propose contract changes, but cannot silently change the public schema or remove features.

### 13.2 First lead-agent deliverables

Create these files **in the actual project repository** after owner agrees to structure:

1. `docs/PRD.md`: exact R1–R8 and user journey, scope/status by gate.
2. `docs/references/upstream-audit.md`: pinned repos/commit IDs, install commands, actual execution results, relevant source paths/functions, reuse/quality/license matrix; explicitly record unsupported claims.
3. `docs/adr/0001-engine-foundation.md`: compare original TS, TRIZHAX-based and native backend; risks, measured benchmarks and decision.
4. `docs/adr/0002-road-schema.md`: canonical graph/lanes/turns/place/portal model and edit ID strategy.
5. `docs/adr/0003-simulation-api.md`: deterministic clock, worker API, optional native adapter.
6. `docs/adr/0004-project-format.md`: save/export and migration/versioning.
7. `docs/plan.md`: dependency diagram, milestones, owner decision list and acceptance matrix.
8. `AGENTS.md` and optional `CLAUDE.md`: worker rules, test commands, directory ownership, no license-incompatible copying.
9. `docs/tasks/TASK-001.md` etc.: first delegated work packages (see format below).

**Planning-first instruction:** present the comparison/ADR to the owner *before* creating large permanent implementation scaffolding if choosing between fork/new core/backend remains genuinely unresolved.

### 13.3 Task template for delegated agents

```md
# TASK-XXX — Short name
Owner: <agent/worktree>
Depends on: <approved ADRs, prior task IDs>
Goal: <one independent, user-visible or testable capability>
In scope: <files/submodules, API methods and exact behavior>
Out of scope: <specific forbidden redesigns>
Interfaces: <versioned types, error conventions, event formats>
Fixtures: <test data paths and seed>
Acceptance tests: <Txx IDs + precise expected outcomes>
Commands: <build/test/lint/e2e/bench commands>
Deliverable: <PR, tests, screenshots or metrics, limitations>
Integration notes: <migration, conflict, performance or license changes>
```

Task acceptance is **test-based, not prose-based**. Avoid tasks like “implement traffic engine” or “build nice UI”; instead separate *IDM stepping for lane leaders*, *movement legality*, *signal phase validator*, *OSM oneway converter*, *place portal capacity queue*, etc.

### 13.4 Initial delegable task backlog (after schemas are frozen)

| Task | Module | Prerequisites | Required proof |
|---|---|---|---|
| W01 | TS workspace, CI, reproducible test harness | ADR-001 | `build/test/lint` in CI |
| W02 | Canonical schema, validators and migrations | ADR-002/004 | schema fixture round-trip |
| W03 | Projected coordinate helpers, 2D viewport and renderer spike | W02 | displayed synthetic roads / camera / picking |
| W04 | Graph editor command log + undo/redo + connectivity checks | W02 | T12 subcases |
| W05 | Fixed-step headless engine and vehicle conservation | W02 | T01/T02 |
| W06 | Multi-lane car following and turn movement geometry | W05 + W02 | T03/T04 |
| W07 | Routing legality and travel-time preference | W02 | T04/T05 |
| W08 | OSM sample import and diagnostics | W02/W03 | T11/T18 |
| W09 | Place, portal and queue model | W02/W05 | T08 |
| W10 | Day-activity trip generator | W09 | T09 |
| W11 | Ramp/lane selection/rerouting | W06/W07 | T06/T07 |
| W12 | Signal inspector/editor | W04/W06 | T13 |
| W13 | Save/export/import project ZIP | W02/W04/W10 | T14 |
| W14 | Station/airport event schedules | W09/W10 | T10 |
| W15 | Scenario comparison + metrics | W05/W13 | same-seed baseline/variant proof |
| W16 | Playwright gameplay acceptance and performance suite | W03 + key modules | A–D clips and T16 |

**No broad parallel coding before W02:** unconstrained agent parallelism tends to create incompatible graph models. Parallelizable work after contracts include OSM import adapters, UI components, telemetry/benchmark harness, documentation, and isolated simulation modules.

### 13.5 Git/worktree and merge discipline

- One feature branch/worktree per task, no two agents writing same canonical interface files without lead coordination.
- All worktree tasks include base commit SHA, required package versions and an explicit file ownership surface.
- CI gates for formatting, typecheck, unit tests, fixture migration tests and selected Playwright tests.
- Lead reviews **semantic compatibility** (graph connectivity, movement legality, deterministic snapshot, license impact) instead of only compilation.
- Do not use upstream screenshots/artwork/code without a documented attribution/license decision; screenshot references are for design research, not assets to redistribute.
- All new architectural decisions captured in short ADRs, not in buried agent-chat context.

---

## 14. Critical architectural risks and mitigation

| Risk | Why it matters | Response |
|---|---|---|
| **Fork seems convenient but is incompatible with desired editor** | Cars may render perfectly while map topology cannot be created/changed safely | Audit graph mutation and save format first; prototype an actual add-road/edit-turn case |
| **OSM has imperfect lane/turn data** | “Real city import” can appear correct but route illegally | Inference flags, diagnostic layer, editable assumptions, regression fixtures |
| **Shortest-path road graph ignores lane assignment** | Vehicles fail to reach exits or take impossible turns | Explicit lane movements; mandatory approach-lane strategy; test ramps and turns |
| **Rerouting causes grid oscillation** | All cars chase the same fast route and create new jams | Update intervals, hysteresis, individual cost variation and bounded replan |
| **Demand looks random despite real maps** | No recognizable morning rush or special-purpose traffic | Person agendas, places and capacity-constrained portals must be part of core architecture |
| **Road edits corrupt active vehicles** | Runtime crashes, invalid references, teleportation | Initial paused edits / transactional rebuild + restart; later planned safe live edits |
| **Vehicle performance vs map rendering** | UI frame rate hides sim slowdown or vice versa | Distinct CPU/worker/render timers, headless scale tests, LOD |
| **Incorrect license assumptions** | Noncommercial/GPL code contaminates intended distribution model | License manifest and explicit reuse clearance before copy; prefer MIT/Apache code |
| **OSM API dependence** | Public services rate-limit or change; gameplay becomes unreliable | Cached small extracts, provider abstraction, local file import, production extract strategy |
| **Modal expansion requires rewrite** | Person is implicitly equivalent to car | Person/activity/trip contract independent of vehicle; future leg modes |
| **Simulation overclaims realism** | “Actual city traffic” misleads users | Synthetic-demand notice, source tags, seed and limitations in exports/UI |
| **Overspecified first milestone** | Never reaches a playable game | Vertical slices and acceptance gates; stretch features deferred with explicit contracts |

---

## 15. Legal/data access and source-of-truth links

- **TRIZHAX MIT**: https://raw.githubusercontent.com/TRIZHAX/trizhax-traffic-flow-simulation/main/LICENSE
- **A/B Street Apache-2.0**: https://github.com/a-b-street/abstreet
- **osm2streets Apache-2.0**: https://github.com/a-b-street/osm2streets
- **CityFlow Apache-2.0**: https://github.com/cityflow-project/CityFlow
- **Nitai PolyForm Noncommercial**: https://github.com/nitaiaharoni1/traffic-simulator ; https://polyformproject.org/licenses
- **traffic-simulation.de GPL-3.0**: https://github.com/movsim/traffic-simulation-de
- **SUMO EPL-2.0 with GPL secondary option**: https://github.com/eclipse-sumo/sumo ; https://github.com/eclipse-sumo/sumo/blob/main/docs/web/docs/Downloads.md
- **OSM copyright/ODbL**: https://www.openstreetmap.org/copyright ; https://osmfoundation.org/wiki/Attribution_Guidelines
- **Overpass background and public-instance constraints**: https://wiki.openstreetmap.org/wiki/Overpass_API
- **Nominatim official API policy**: https://operations.osmfoundation.org/policies/nominatim/
- **GTFS specification**: https://gtfs.org/documentation/overview/

**Interpretation warning:** OSM ODbL attaches to data, not automatically to independent simulation code. Whether a scenario export is a derivative database, and which component files must be available under ODbL, depends on the actual data processing and distribution. Keep imported OSM assets and authored edits separable and obtain license review before public/commercial distribution. The handoff is not legal advice.

---

## 16. Decision register for the owner and lead agent

The lead should make an evidence-backed recommendation on each item and only solicit owner decisions where tradeoffs affect product scope or irreversibility.

| Decision | Preferred default for planning | Alternatives and trigger |
|---|---|---|
| Foundation | TS original core + selective reuse | Fork TRIZHAX only if editor/network schema audit succeeds; native engine if benchmark forces it |
| Framework | React + Vite + TypeScript | Svelte acceptable if lead identifies compelling reuse; don't delay first slice for taste |
| Renderer | MapLibre + single custom WebGL or deck.gl vehicle overlay | Canvas2D for initial prototype; optimize once measured |
| Road importer | OSM small extract → normalized schema, evaluate osm2streets/WASM | Native PBF and `netconvert` for region-scale imports |
| Micro engine | Headless TS worker initially | WASM/custom Rust/C++/SUMO/CityFlow if scale test proves need |
| Road editing | Domain commands + graph validation + undo/redo | Avoid raw GeoJSON editing as the authoritative graph |
| Demand | Place zones + simple person agendas | External OD matrix support; calibrated data later |
| Topology edit while running | Pause, commit, validate, restart | Incremental live update later when safe |
| Save format | Versioned ZIP + JSON/GeoJSON + provenance | Binary graph payload for volume later; always maintain schema migration |
| Desktop wrapper | None until required | Electron with local service; revisit Tauri if package footprint matters |
| 3D | No in initial release | Optional orthographic/isometric overlay after 2D meets acceptance |
| Commercial posture | Keep reuse license-flexible | Explicitly decide if GPL/NC licenses are acceptable before bringing in code |

---

## 17. Concrete initial demonstration brief for coding agents

After architecture Gate 0, require this shortest integrated proof **before broad feature work**:

1. In a browser, load a **fixed synthetic 5 × 5 street grid** with 2–3 lanes on some roads, one signalized intersection and two place connectors.
2. Generate 100–300 actual vehicle objects from one community to one workplace with a seeded rush-hour departure curve; animate queues and following behavior.
3. Provide a visible road edit (reverse one street or add a legal connector) that **modifies routing** after validation/restart.
4. Make lane-level chosen routes and movement restrictions inspectable for a selected car.
5. Export/import a one-file scenario; replay same seed with same first N-step hash.
6. Load a tiny, bundled OSM-derived fixture next, with inferred lane warnings. No live API dependency is required for the demonstration.

Then expand to highway ramps, realistic lane selection, special-place timetables, daily person chains and congestion-sensitive routing in the subsequent gates.

**Failure conditions:** animated cars with no real physics/state; real-city basemap but decorative roads; vehicles that follow only shortest geometric distance; no route updates after edit; trips that originate halfway down an expressway; no edited project export; or a simulator requiring Unity/Unreal.

---

## 18. Copy-paste bootstrap prompt for the lead agent

> You are the **lead architect and planning agent** for a browser-first, real-city microscopic traffic game. Read `browser_city_traffic_game_agent_handoff.md` in full. Preserve the owner's R1–R8 requirements as binding. Do not begin a large implementation immediately.
>
> **Phase A — evidence:** evaluate A/B Street, TRIZHAX, osm2streets, CityFlow, and other source references; inspect code paths for graph representation, importing, lanes, intersections, routing, vehicle dynamics, places, UI, serialization and tests. Run appropriate prototypes; note license and reliability. Pin upstream commits and document relevant paths with code evidence. Avoid noncommercial or GPL code reuse unless the owner explicitly decides on compatible licensing.
>
> **Phase B — choices:** compare at least three architectures: (1) new TypeScript headless core + permissive reuse, (2) TRIZHAX fork/refactor, and (3) local native backend with a browser frontend. Produce explicit constraints/benchmarks and recommend one, including migration path to desktop. Specify canonical network, people/trips/places, simulation API, editing and project-file contracts.
>
> **Phase C — delivery plan:** decompose work into independently testable tasks with file ownership, dependencies, exact acceptance criteria mapped to R1–R8 / T01–T18, worker/lead review responsibilities, and milestone demos. Prioritize a small playable vertical slice, not visualization-only smoke tests. Include repo/AGENTS.md/CLAUDE.md conventions, quality gates and reusable fixtures.
>
> **Phase D — dialogue:** present the architecture recommendation and only substantive owner choices before committing to the foundation. Once approved, delegate narrowly specified tasks to implementation agents and integrate them behind frozen interfaces. Treat every feature as an executable acceptance criterion; record any approved deferral explicitly.
>
> Remember: **the canonical game must model individual cars on a lane-level road network, accept real-city imports and edited/new roads, generate work-life and special-place traffic via entrances/exits, permit advanced route choice, remain browser-first, and leave person-based multimodal travel possible.** No building-level modeling is required.

---

## Appendix: quick research assignments for the lead agent

| Research question | Start here | Outcome to report |
|---|---|---|
| Does TRIZHAX truly support runtime modification + save/load of lane graph? | `src/world/`, `src/simulation/`, `src/state/`, `src/analysis/` | Exact modules and demo trace; list contract gaps and test failures |
| Can osm2streets normalize city-sized networks in WASM? | `osm2streets-js/`, `streets_reader/`, `tests/`, `web/` | Throughput/memory on 2 named sample areas; API stability issues |
| What is the minimal correct lane/movement schema? | CityFlow [roadnet format](https://github.com/cityflow-project/CityFlow/blob/master/docs/source/roadnet.rst), A/B Street `map_model/` | Proposed schema + route/turn-restriction invariants |
| Which car-following/merge implementation is safest to reuse? | TRIZHAX `src/simulation/`; A/B `sim/`; traffic-simulation.de for conceptual comparison | Test result at signal, on-ramp, lane drop; licensing decision |
| What import diagnostics will stop bad maps? | OSM fixture with one-way, bridge, ramp; osm2streets regression cases | Named validation rules and human-readable warnings |
| Does dynamic routing actually prefer a faster expressway? | A/B Street routing docs, GraphHopper route costs, own fixture | Controlled test: longer-but-faster road wins, legal turns retained |
| How many cars can run in-browser? | TRIZHAX and Nitai browser implementations; headless test harness | Reproducible CPU/memory/FPS curves, not README estimates |
| Can edited scenarios round-trip across backends? | Proposed portable project format; optional SUMO adapters | Schema round-trip proof, lossy fields identified |

**End of handoff.**
