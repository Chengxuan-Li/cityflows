# CityFlows architecture and contracts

Status: approved by the owner on 2026-11-03, including the adjustments recorded in section 1.
Sections 3 to 12 are the frozen contracts for Gate 1 and Gate 2 tasks. A task that needs a
contract change stops and reports to the lead; the change lands as a PR that updates this file
and the affected code together.

The product brief is `docs/20261103_browser_city_traffic_game_agent_handoff.md`. Its
requirements R1 to R8 and tests T01 to T18 are binding and referenced below by ID.

## 1. Decisions

| # | Decision | Choice | Rejected and why |
|---|---|---|---|
| 1 | Engine foundation | Original TypeScript headless core in a Web Worker, behind the interfaces in this doc. Selective reuse: TRIZHAX (MIT) is mined for IDM/MOBIL and signal logic after TASK-000's audit; CityFlow's roadnet and osm2streets are schema and geometry references. | Forking TRIZHAX: single-commit project, no undo, no project format, graph model would need retrofitting. Native backend now: doubles the stack; the brief says to do this only when a browser benchmark forces it. |
| 2 | Renderer | PixiJS 8 drawing the world in local meters, optional raster tile backdrop aligned by one affine. MapLibre only inside the import wizard for choosing a bounding box. | MapLibre + deck.gl: custom WebGL layers in Mercator space, Terra Draw for editing, heaviest dependency in the app. Canvas 2D: hits a wall around a few thousand vehicles; rewrite later. |
| 3 | Repository shape | One Vite package; modules under `src/` with the ESLint layer rule. | pnpm workspace with ten packages: config overhead with no current benefit. |
| 4 | License | GPL-3.0-or-later. Permissive and GPL-compatible sources may be adapted with a `NOTICE` entry. PolyForm Noncommercial sources are study-only. | MIT: would forbid adapting traffic-simulation.de (GPL). |
| 5 | OSM data access | Bundled attributed fixtures, upload of `.osm` XML or GeoJSON, and small-bbox Overpass queries with an IndexedDB cache and a swappable endpoint. No PBF parsing in the browser. | Upload only: the "pick a city" step becomes a chore. Local import service: not needed for first-release map sizes. |
| 6 | Workflow | GitHub remote, branch per task, PR, GitHub Actions CI, lead review of semantic compatibility. | Local-only merging. |
| 7 | Upstream audit | Bounded, read-only, parallel to scaffolding (TASK-000). | Full Gate 0 with running every reference first: days of agent time before product code. |
| 8 | Road geometry | Every directed carriageway owns its centerline. `streetGroupId` optionally groups the two directions of a simple street for editing. | Two directions sharing one centerline: cannot represent divided highways, medians, ramps or real OSM geometry. |
| 9 | Movements | Lane-to-lane movements are generated at compile time from connectivity and lane rules; the canonical model stores only explicit allow/ban overrides. Structural errors block commits; connectivity problems are warnings that do not. | Every movement as a canonical entity: edits to lane counts would orphan thousands of records. |
| 10 | Routing | Road-level search, then lane resolution with a feasibility check from the vehicle's current lane. Lane-level search is the fallback. A vehicle never teleports or takes an illegal movement; an infeasible plan becomes a legal movement plus a reroute with a reason code. | Road-level only: vehicles stuck in the wrong lane at a turn. |
| 11 | Persistence | The canonical `City` snapshot is the authoritative saved state. Editor history is optional, separately versioned, and droppable. Migrations operate on snapshots. | Replaying a patch log on load: couples saved files to editor code history. |
| 12 | Intersections | Vehicles explicitly occupy movement paths; entry needs free space on the exit lane; conflicts are resolved by deterministic arbitration each step; signals are conservative (enter on green with space). Permissive turns and finer gap acceptance come later. | Implicit intersections: gridlock and phantom collisions. |
| 13 | Edits during a run | Release 1 requires a paused run; a committed topology or rule change marks the loaded run stale and the UI asks for a restart (T17). Live signal timing edits are a later option. | Live topology edits: invalid vehicle references. |
| 14 | Demand | Persistent person-level home and work assignments with activity schedules, saved with the project. | Random origin-destination trips: no recognizable rush. |
| 15 | Not in release 1 | Desktop wrapper, 3D view, transit vehicle operations, PBF import, live topology edits. | |

## 2. Modules and data flow

```
                UI (React, Zustand)          src/ui
                   |            \
            Editor commands      Run control, inspect
                   |                    |
            src/editor  -->  City  -->  src/network.compile  -->  CompiledCity
                                 \                                   |
                           src/project                 +-------------+-------------+
                        (save / open / ZIP)            |             |             |
                                                 src/routing    src/demand      src/sim
                                                       \             |            /
                                                        +---- src/host (Worker) --+
                                                                     |
                                                        VehicleSnapshot, Metrics
                                                                     |
                                                               src/render (Pixi)
```

`src/importers` produces a `City` from OSM or GeoJSON. `src/fixtures` produces synthetic
cities. Both go through the same compile and validation as hand edits. The layer rule in
`AGENTS.md` is enforced by ESLint.

## 3. Coordinate frame and extent

Internal coordinates are meters in a local frame: Web Mercator scaled by `cos(lat0)` around
the project origin, x east, y south (screen orientation). `src/geo/projection.ts` implements
it. Headings are `atan2(dy, dx)`; because y points south, a positive heading change is a
clockwise turn as seen on screen, which is a right turn for the driver.

- A `City` without geography (synthetic worlds) has `geo: null` and uses origin (0, 0).
- A `City` with geography records `geo.origin`, `geo.scale`, `geo.bbox` and the import source.
  Project files carry this so coordinates are reproducible without the original OSM data.
- Scale error grows with distance from the origin latitude: roughly `d * tan(lat0) / R`. The
  frame is valid for cities up to 50 km from the origin at latitudes up to 60 degrees (error
  under 1.4 percent). The browser importer caps a bounding box at 25 km by 25 km and 50 km
  squared of area; larger areas need the bulk path, which is not in release 1.
- Raster tiles (Gate 2) are placed with the affine `local = (merc - merc0) * scale`.

## 4. Canonical model: `City`

Lives in `src/schema`. Serialized as JSON, validated with Zod at every boundary (project open,
import, fixtures in tests). This is what the editor edits and the project file stores.

```ts
type NodeId = string;      // "n:12"
type RoadId = string;      // "r:12"
type PlaceId = string;     // "p:12"
type ConnectorId = string; // "c:12"
type LaneId = string;      // derived: `${RoadId}#${laneIndex}`
type MovementId = string;  // derived: `${LaneId}>${LaneId}`

type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary'
  | 'residential' | 'service' | 'ramp';
type VehicleClass = 'car' | 'truck' | 'bus';
type Control = 'uncontrolled' | 'yield' | 'stop' | 'signal';
type DrivingSide = 'right' | 'left';

interface Provenance {
  source: 'osm' | 'authored' | 'generated';
  osmIds?: number[];       // way or node ids this entity came from
  inferred?: string[];     // attribute names that were defaulted, e.g. 'lanes', 'speedLimit'
}

interface Node {
  id: NodeId;
  pos: Vec2;
  layer: number;           // from OSM `layer`; informational, connectivity is by shared ids
  control: Control;
  minorRoads: RoadId[];    // for yield/stop: incoming roads that must yield. Empty = by class.
  turnRules: TurnRule[];
  roundabout?: Roundabout; // authored ring restoration, see section 6
  signal: SignalProgram | null;   // required when control === 'signal'
  provenance: Provenance;
}

interface RoundaboutSnapshot {
  nodes: Record<NodeId, Omit<Node, 'roundabout'>>;
  roads: Record<RoadId, Road>;
  connectors: Record<PlaceId, Connector[]>;
}
interface Roundabout {
  radiusM: number; ringRoads: RoadId[];
  before: RoundaboutSnapshot; after: RoundaboutSnapshot;
}

interface TurnRule {
  from: RoadId;            // incoming road (road.to === node.id)
  to: RoadId;              // outgoing road (road.from === node.id)
  fromLane?: number;       // lane index on `from`; omitted = all lanes
  toLane?: number;         // lane index on `to`; omitted = all lanes
  allowed: boolean;
  provenance: Provenance;
}

interface SignalProgram {
  turnOnRed?: boolean;     // omitted = false, curb-side turn after stopping
  offsetS: number;
  amberS: number;          // follows every phase
  allRedS: number;         // follows amber
  phases: { durationS: number; groups: { from: RoadId; to: RoadId }[] }[];  // green groups
}

interface Lane {
  widthM: number;
  allowed: VehicleClass[];
}

interface Road {
  id: RoadId;
  from: NodeId;
  to: NodeId;
  centerline: Vec2[];      // >= 2 points; first equals nodes[from].pos, last equals nodes[to].pos
  lateralOffsetM: number;  // lane block center relative to centerline; positive = right of travel
  lanes: Lane[];           // index 0 = leftmost in travel direction
  roadClass: RoadClass;
  speedLimitMps: number;
  name: string | null;
  streetGroupId: string | null;  // groups the two directions of a simple two-way street
  provenance: Provenance;
}

type PlaceKind = 'residential' | 'work' | 'retail' | 'school' | 'station' | 'airport'
  | 'parking' | 'gateway' | 'other';

interface Connector {
  id: ConnectorId;
  roadId: RoadId;
  lane: number;
  positionM: number;       // along the lane, within [0, lane length]
  direction: 'in' | 'out' | 'both';   // 'in' = vehicles arrive here, 'out' = vehicles depart here
  throughputPerMin: number;           // max vehicles per minute through this connector
}

interface PlaceEvent {
  id: string;
  name: string;
  startS: number;          // seconds since midnight
  durationS: number;
  arrivals: number;        // persons arriving during the event window
  departures: number;      // persons leaving during the event window
}

interface Place {
  id: PlaceId;
  kind: PlaceKind;
  name: string;
  shape: { kind: 'point'; pos: Vec2 } | { kind: 'polygon'; ring: Vec2[] };
  population: number;      // residents (residential, gateway = external commuters)
  jobs: number;            // workplaces (work, retail, school, station, airport, gateway)
  attraction: number;      // relative weight for non-work visits
  capacity: number | null; // vehicles that can be inside at once; null = unlimited
  connectors: Connector[];
  profile: { arrivals: number[]; departures: number[] } | null;  // 24 relative hourly weights
  events: PlaceEvent[];
  provenance: Provenance;
}

interface GeoSource {
  kind: 'osm' | 'file';
  snapshotDate: string | null;
  attribution: string;     // shown in UI and written to the manifest
  importerVersion: string;
  inferredCount: number;
}

interface City {
  schemaVersion: 1;
  version: number;         // bumps on every committed edit; caches key on it
  name: string;
  drivingSide: DrivingSide;
  geo: (GeoReference & { bbox: [number, number, number, number]; source: GeoSource }) | null;
  nodes: Record<NodeId, Node>;
  roads: Record<RoadId, Road>;
  places: Record<PlaceId, Place>;
  nextId: number;          // single counter for all id kinds
}
```

Invariants (checked by compile, section 5):

- Every `road.from` and `road.to` exists; roads never connect by geographic coincidence, only
  by shared node ids. A bridge over a street shares no node with it.
- A road has at least one lane; lane widths are positive; `centerline` has at least two
  points and positive length; `from !== to`.
- Connectors reference an existing road and a lane index within range, with `positionM` in
  range. When a lane-count edit removes a connector's lane, the editor command clamps the
  connector to the outermost remaining lane and reports a warning.
- A node with `control: 'signal'` has a `signal`.
- `turnRules` reference roads incident to that node.

## 5. Compiled model: `CompiledCity`

`compile(city: City): CompileResult` lives in `src/network` and is a pure, deterministic
function. It is the only producer of lane geometry, movements and conflict tables.

```ts
type CompileResult =
  | { ok: true; compiled: CompiledCity; diagnostics: Diagnostic[] }   // warnings only
  | { ok: false; diagnostics: Diagnostic[] };                         // contains errors

interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;            // see list below
  message: string;         // human readable, names the entities
  refs: string[];          // entity ids
}

interface CompiledCity {
  version: number;
  drivingSide: DrivingSide;
  nodes: CNode[];
  roads: CRoad[];
  lanes: CLane[];
  movements: CMovement[];
  places: CPlace[];
  connectors: CConnector[];
  index: {
    node: Map<NodeId, number>; road: Map<RoadId, number>; lane: Map<LaneId, number>;
    movement: Map<MovementId, number>; place: Map<PlaceId, number>; connector: Map<ConnectorId, number>;
  };
  laneSpatial: Flatbush;   // lane segments, for picking and snapping
}

interface CNode { idx: number; id: NodeId; pos: Vec2; radiusM: number; control: Control;
  movements: number[]; signal: CSignal | null; }
interface CRoad { idx: number; id: RoadId; from: number; to: number; lanes: number[];
  roadClass: RoadClass; classRank: number; speedLimitMps: number; lengthM: number;
  streetGroupId: string | null; surface: Vec2[]; /* polygon for rendering */ }
interface CLane { idx: number; id: LaneId; road: number; lane: number; polyline: Vec2[];
  cumulative: Float64Array; lengthM: number; widthM: number; allowed: VehicleClass[];
  speedLimitMps: number; left: number; right: number;   // adjacent lane idx or -1
  out: number[]; in: number[];                          // movement idx
  connectors: number[]; }                               // sorted by positionM
type Turn = 'through' | 'left' | 'right' | 'uturn' | 'merge' | 'diverge';
interface CMovement { idx: number; id: MovementId; fromLane: number; toLane: number;
  node: number; turn: Turn; polyline: Vec2[]; cumulative: Float64Array; lengthM: number;
  conflicts: number[]; priority: number; neverGreen: boolean; turnOnRed?: boolean; }
interface CSignal { offsetS: number; amberS: number; allRedS: number; cycleS: number;
  phases: { durationS: number; movements: number[] }[]; }
interface CConnector { idx: number; id: ConnectorId; place: number; lane: number;
  positionM: number; direction: 'in' | 'out' | 'both'; throughputPerMin: number; }
interface CPlace { idx: number; id: PlaceId; kind: PlaceKind; centroid: Vec2;
  connectorsIn: number[]; connectorsOut: number[]; capacity: number | null; events: PlaceEvent[]; }
```

### 5.1 Lane layout

- Let `W` be the sum of a road's lane widths. Lane `i` runs parallel to the centerline at
  lateral offset `lateralOffsetM - W/2 + sum(widths before i) + widths[i]/2`, positive to the
  right of travel. The right-hand normal of heading `(dx, dy)` is `(-dy, dx)`.
- Offsetting a polyline uses per-vertex miter joins with the miter length clamped to twice the
  offset; sharper vertices get a bevel. Good enough for a cartoon look.
- Default `lateralOffsetM` for a two-way street made of two roads with one shared geometry:
  `+W/2` of each road under right-hand traffic, `-W/2` under left-hand traffic, so the two lane
  blocks sit side by side. One-way and divided carriageways use 0.
- At each node, `radiusM = max over incident roads of (W/2 + |lateralOffsetM|) + 1.0`. Lanes
  are trimmed by `radiusM` at each end along their road. A road shorter than `2 * radiusM + 5`
  is trimmed proportionally to keep at least 5 m and gets warning `road_too_short`.
- `CRoad.surface` is the union outline of the lane block, for rendering only.

### 5.2 Movement generation

For every node, incoming roads are those with `road.to === node`, outgoing those with
`road.from === node`. For each (incoming `i`, outgoing `o`) pair:

1. Classify the turn from the signed heading change `d` between the end of `i` and the start
   of `o`, normalized to (-pi, pi]: `|d| < 30 degrees` through; `30 to 150 degrees` right if
   `d > 0`, left if `d < 0` (y-south frame); `> 150 degrees` uturn. The two directions of one
   `streetGroupId` always classify as uturn. For each pair, count non-U-turn outgoing
   continuations from the incoming road and non-U-turn incoming approaches to the outgoing
   road. Exactly one outgoing continuation and two or more small-angle incoming approaches
   gives `merge`; one incoming approach and several small-angle outgoing continuations gives
   `diverge`. Reverse carriageways at a split two-way street therefore do not suppress ramp
   classification (TASK-032, approved).
2. Pairs classified uturn are excluded unless a turn rule allows them (U-turns and hairpins
   off by default).
3. Default lane assignment, before rules. Lane 0 is the leftmost lane under either driving
   side, so left turns leave from lane 0 into lane 0 of `o` and right turns leave from the
   last lane into the last lane of `o` under both driving sides. The driving side decides
   only which lane is at the curb (the last lane under right-hand traffic, lane 0 under
   left-hand traffic) and which at the median. Through: lanes pair by index counted from the
   median side, clamped to the last lane of `o`; when `o` has more lanes, the curb-side lane
   of `i` also feeds the extra curb-side lanes. A single-lane approach feeds every lane of
   each legal non-U-turn outgoing direction, including merges and diverges (TASK-048
   contract amendment). Explicit turn rules still take precedence. For multi-lane approaches,
   merge and diverge: lanes pair one-to-one by
   index counted from the curb side, with no clamping and no fan-out. U-turns, when allowed, leave from the median-side
   lane into the median-side lane. A single-lane road may do everything. Fallback: a lane that
   ends up with no movement while another lane of the same road has one inherits the
   non-U-turn movements of the nearest such lane (lower index wins ties), with the to-lane
   shifted by the index difference and clamped, unless a rule bans the pair; a two-lane road
   at a T-junction with a single exit therefore gets a dual turn.
4. Apply `node.turnRules`: the most specific matching rule wins (both lanes given, then one
   lane, then road pair). `allowed: false` removes movements; `allowed: true` adds the lane
   pair (or, at road level, restores the defaults for that pair).
5. Vehicle classes: a movement exists only if `toLane.allowed` intersects `fromLane.allowed`.

Movement ids are deterministic, so signal programs and tests can name them. Curves: a cubic
Bezier from the end of the from-lane (tangent along it) to the start of the to-lane, control
distance `0.4 * chord`, sampled about every meter with at least four points; a through
movement between nearly collinear lanes (under 5 degrees) is a straight segment.

### 5.3 Conflicts and priority

- Two movements at the same node conflict if their sampled polylines cross, or they end in the
  same lane. Movements from the same lane never conflict with each other.
- `classRank`: motorway 8, trunk 7, primary 6, secondary 5, tertiary 4, residential 3,
  service 2, ramp uses the rank of the road it joins minus one (minimum 1).
- `priority = majorRank * 10 + turnRank` where `majorRank` is the incoming road's classRank,
  except that roads listed in `node.minorRoads` (yield/stop) get rank 0, and `turnRank` is 2
  for through and right, 1 for left, merge and diverge, 0 for uturn. Ties are broken in the
  simulation by the right-before-left rule (left-before-right under left-hand traffic), then by
  waiting time, then by vehicle id.
- Default `minorRoads` when empty at a yield or stop node: incoming roads whose class rank is
  below the maximum rank among the node's incoming roads.

### 5.4 Signals

- Optional `SignalProgram.turnOnRed` defaults to false. When enabled, the compiler marks
  right turns under right-hand driving and left turns under left-hand driving with
  `CMovement.turnOnRed`. These remain routable even if no phase serves them.
- While red, marked turns stop at the line for one second before requesting entry, then
  yield to all conflicting approaches with a gap below `gapS`, existing grants/occupants,
  and blocked exits. Green candidates resolve first. A granted red turn may finish leaving
  the stop line; a green grant that turns red must stop again. Amber rules are unchanged.
- OSM imports set the flag only if explicit country tags are present: United States true,
  all other or mixed countries false; absent country leaves the flag omitted.

- Each phase's `groups` expand to every movement between the named road pair. A movement may
  appear in several phases. `cycleS = sum(durationS + amberS + allRedS)`.
- State at simulation time `t`: `((t + offsetS) mod cycleS)` locates the phase and whether it
  is in green, amber or all-red. Amber means vehicles that can stop before the stop line do.
- Error `signal_conflict`: two conflicting movements in the same phase (T13).
- Warning `signal_unserved_movement`: a movement at a signalized node that is in no phase. It
  is compiled with `neverGreen: true` and routing excludes it.

### 5.5 Diagnostic codes

Errors (compile fails, editor rejects the commit):
`dangling_ref`, `road_degenerate`, `lane_invalid`, `connector_invalid`, `turnrule_invalid`,
`signal_missing`, `signal_phase_invalid`, `signal_conflict`, `place_invalid`.

Warnings (compile succeeds, shown in the validation panel):
`disconnected_component` (lanes outside the largest weakly connected component, where
movements and adjacent lanes of one road count as links regardless of direction; directional
reachability is covered by `dead_end` and `connector_unreachable`),
`dead_end` (a lane with no outgoing movement whose road has no `in` connector on any lane),
`node_no_movements` (a node joined by an incoming and an outgoing road that are not the two
directions of one street, yet with no movement), `road_too_short`,
`signal_unserved_movement`, `place_no_connector`, `connector_unreachable` (an `in` connector
not reachable from any `out` connector, or an `out` connector that reaches no `in` connector,
following movements and lane changes),
`inferred_attributes` (count of imported defaults, from provenance).

## 6. Editing

Lives in `src/editor`. The editor owns one `City` and exposes:

```ts
type Command =
  | { kind: 'restoreCity'; city: City }
  | { kind: 'setRoadLanes'; roadId: RoadId; lanes: Lane[] }
  | { kind: 'setRoadAttributes'; roadId: RoadId; speedLimitMps?: number; roadClass?: RoadClass; name?: string | null }
  | { kind: 'setStreetDirection'; streetGroupId: string; direction: 'both' | RoadId }  // RoadId = keep only this direction
  | { kind: 'reverseRoad'; roadId: RoadId }
  | { kind: 'setTurnRule'; nodeId: NodeId; rule: TurnRule }        // replaces an equal-key rule
  | { kind: 'clearTurnRule'; nodeId: NodeId; rule: Omit<TurnRule, 'allowed' | 'provenance'> }
  | { kind: 'setControl'; nodeId: NodeId; control: Control; signal?: SignalProgram; minorRoads?: RoadId[] }
  | { kind: 'setSignal'; nodeId: NodeId; signal: SignalProgram }
  | { kind: 'addRoad'; road: Omit<Road, 'id'>; newNodes: Omit<Node, 'id'>[] }   // Gate 2
  | { kind: 'deleteRoad'; roadId: RoadId }                                        // Gate 2
  | { kind: 'splitRoad'; roadId: RoadId; atM: number }                           // Gate 2
  | { kind: 'mergeRoads'; roadId: RoadId; otherRoadId: RoadId }                  // Gate 2
  | { kind: 'addRamp'; from: { roadId: RoadId; atM: number }; to: { roadId: RoadId; atM: number } }
  | { kind: 'removeRamp'; roadId: RoadId }
  | { kind: 'addRoundabout'; nodeId: NodeId; radiusM: number }
  | { kind: 'removeRoundabout'; nodeId: NodeId }
  | { kind: 'moveNode'; nodeId: NodeId; pos: Vec2 }                               // Gate 2
  | { kind: 'addPlace'; place: Omit<Place, 'id'> }
  | { kind: 'updatePlace'; placeId: PlaceId; patch: Partial<Omit<Place, 'id' | 'connectors'>> }
  | { kind: 'setConnectors'; placeId: PlaceId; connectors: Connector[] }
  | { kind: 'deletePlace'; placeId: PlaceId }
  | { kind: 'batch'; label: string; commands: Command[] };                      // Gate 2

interface Patch {
  metadata?: Pick<City, 'name' | 'drivingSide' | 'geo'>;
  set: { nodes?: Record<NodeId, Node>; roads?: Record<RoadId, Road>; places?: Record<PlaceId, Place> };
  remove: { nodes?: NodeId[]; roads?: RoadId[]; places?: PlaceId[] };
  nextId?: number;
}

interface HistoryEntry { label: string; patch: Patch; inverse: Patch; version: number }

type CommitResult =
  | { ok: true; city: City; compiled: CompiledCity; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

interface Editor {
  readonly city: City;
  readonly compiled: CompiledCity;
  apply(command: Command): CommitResult;
  undo(): CommitResult | null;
  redo(): CommitResult | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly history: readonly HistoryEntry[];
}
```

Semantics:

- A command handler is a pure function `(city, command) => Patch`. The editor records the
  inverse by snapshotting the entities the patch touches, applies the patch to a structurally
  shared copy, compiles, and commits only when compile has no errors. On rejection the city,
  compiled network and history are unchanged.
- A commit bumps `city.version`. Undo and redo re-apply stored patches and recompile.
- TASK-042 adds the approved `restoreCity` command. It diffs a saved city into an ordinary
  reversible patch, restoring entity IDs, topology, `nextId` and city metadata. Optional
  `Patch.metadata` carries `{ name, drivingSide, geo }`; older history entries remain valid.
  The current editor version advances normally rather than reverting to the snapshot version.
- `addRamp` splits two distinct roads at interior centerline distances, then adds a one-lane
  ramp with a sampled cubic curve tangent to both carriageways and the target road's speed
  limit. Paired streets split together. `removeRamp` removes the ramp and merges each
  endpoint's split pair; incompatible intervening edits reject the command atomically.
  Undo restores the exact pre-edit entities and `nextId`, except for the version bump.
- `addRoundabout` replaces a junction with a one-way ring, counterclockwise in the
  y-south frame for right-hand driving and clockwise for left-hand driving. Radius is at
  least 20 m; each approach must have more than `2 * radiusM + 15` m available. Existing
  streets split at twice the radius, with separate entry/exit legs meeting the ring.
  The ring has one 3.5 m lane, 30 km/h, and the class of the incoming approach with most
  lanes (class rank then ID break ties). Entry legs yield; every approach lane connects
  to the ring, and every exit lane is served. Driving around the ring permits U-turns.
- The original center remains selectable with optional `Node.roundabout` containing
  `radiusM`, `ringRoads`, and `restore` with the original junction control, signal, minor
  roads and turn rules. `removeRoundabout` rebuilds the junction at the current ring's
  centroid, reconnects the approaches using their current outer road attributes, and
  projects connectors onto surviving lanes. A broken ring blocks removal. Removal
  preserves the allocator, and undo/redo restores exact entities and `nextId`.
- OSM `junction=roundabout` roads retain their imported geometry and direction. At their
  joining nodes non-ring incoming roads are marked as minor yield approaches, preserving
  explicit signals. Imported rings do not carry authored restoration records.
- `addRoad` allocates `newNodes` in array order, then the road, using `nextId`; its endpoint
  references use those allocated ids or existing nodes. Drawing resolves explicit node/road
  snaps and adds both directions in one batch. Unsnapped crossings do not create junctions.
- `splitRoad` keeps the original id on the upstream half and remaps downstream turn rules,
  minor-road references and signal groups. A paired street with a shared centerline splits in
  both directions, with a distinct street group for each section. Connectors are projected
  from their old lane positions onto the new lanes; displacement produces a warning.
- `mergeRoads` joins a continuous pair with equal road attributes at an uncontrolled degree-two
  junction without explicit rules, retaining the upstream id. Paired reverse directions merge
  together. `moveNode` updates incident endpoints; `deleteRoad` removes dependent junction
  references, connectors and newly orphaned endpoints. All are undoable patches; history's
  Zod schema validates patches, not a command-kind enum (including merge history).
- Commands addressed to a `streetGroupId` act on both roads. `setStreetDirection` with a
  `RoadId` deletes the other road, removes rules referencing it, and sets
  `lateralOffsetM = 0` on the survivor; `'both'` recreates the opposite road with mirrored
  centerline and default offset.
- `setRoadLanes` keeps lane-level turn rules whose indices still exist and drops the rest;
  connectors are clamped to the outermost remaining lane with a warning.
- The run loaded in the engine is tied to a `city.version`. The UI marks it stale when the
  editor's version moves ahead and offers restart; it never patches a running engine (T17).
- Command handlers add their own warnings to the commit's diagnostics:
  `junction_references_removed` (turn rules, minor-road entries or signal groups that named a
  deleted or reversed road), `connector_lane_clamped`, `connector_removed`,
  `connector_repositioned`, `orphan_node_removed`.
- `reverseRoad` on one road of a street group dissolves the group (the two roads now run the
  same way). `createEditor` requires a city that compiles without errors; importers and
  fixtures guarantee that.

## 7. Routing

Lives in `src/routing`.

```ts
interface RouteRequest {
  fromLane: number; fromPosM: number;       // compiled lane idx and position
  toConnector: number;                      // compiled connector idx, direction 'in' or 'both'
  vehicleClass: VehicleClass;
  desiredSpeedFactor: number;               // per-driver, from the sim RNG
  noise: number;                            // 0..1, per-vehicle cost perturbation amplitude
  seed: number;                             // for the perturbation
}

interface Route {
  roads: number[];                          // compiled road idx, first = road of fromLane
  movements: number[];                      // movements[i] connects roads[i] -> roads[i+1]
  targetLanes: number[][];                  // lane idx on roads[i] from which movements[i] departs
  costS: number;
}

type RouteFailure = 'no_path' | 'destination_unreachable' | 'lane_infeasible' | 'class_forbidden';
type RouteResult = { ok: true; route: Route } | { ok: false; reason: RouteFailure };

interface RouteProvider {
  route(compiled: CompiledCity, costs: LinkCosts, req: RouteRequest): RouteResult;
}

interface LinkCosts {                        // owned by the sim; free-flow in Gate 1
  roadTravelTimeS: Float64Array;            // per compiled road
  version: number;                          // increments when costs are updated
}
```

Algorithm:

1. Road-level graph: a node per compiled road; an edge road `a` to road `b` for every pair
   joined by at least one movement that is not `neverGreen` and allowed for the vehicle class.
   Edge cost = `roadTravelTimeS[b]` + turn penalty of the cheapest such movement. Turn
   penalties: through 2 s, right 4 s, left 8 s, uturn 15 s, merge 3 s, diverge 2 s; plus 10 s
   for every approach at a signalized node, and 4 s at a stop node or 2 s at a yield node for
   minor approaches only (recognized by a compiled priority below 10). Each cost
   is multiplied by `1 + noise * u` with `u` drawn in [-1, 1] from a generator seeded by
   `req.seed` and the road idx, so vehicles spread over near-equal alternatives. Dijkstra with
   a binary heap; the origin cost counts only the remaining length of the origin road.
2. Lane resolution, backward. A lane change counts `laneChangeDistanceM` of travel; `k`
   changes starting at position `s` are possible only if `s + k * laneChangeDistanceM` stays
   within the budget below and within the length of every lane crossed. `feasible[last]` =
   lanes on the last road from which the connector lane is reachable with budget
   `c.positionM`; the last road has no separate enterable set, since the connector is the
   cutoff. For `i < last`: `enterable[i]` = lanes on road `i` from which some lane in
   `feasible[i]` is reachable with budget `roads[i].lengthM - 10`; `feasible[i-1]` = lanes on
   road `i-1` that have a movement into `enterable[i]`, and the chosen movement per lane is
   the one with the lowest penalty. If any set is empty the road-level route is
   lane-infeasible.
3. Origin check: the vehicle's lane must reach `feasible[0]` starting at `fromPosM` with
   budget `lengthM` of its lane.
4. Fallback when 2 or 3 fail: Dijkstra over lanes, edges = movements (same costs) plus lane
   changes to adjacent lanes costing 3 s each; `k` successive changes on one lane need
   `k * laneChangeDistanceM` of that lane (from the current position on the origin lane). The
   result is converted to a `Route` with singleton target lanes. If that fails too:
   `lane_infeasible`.
5. `targetLanes[i]` is `feasible[i]`. The sim uses it for mandatory lane changes.
   `desiredSpeedFactor` is carried in the request for congestion-aware costs (Gate 3) and
   unused in Gate 1. A `toConnector` with direction `out` yields `destination_unreachable`.

`laneChangeDistanceM` is a simulation parameter (default 30 m) shared with the sim through
`SimParams`. Congestion-aware costs (Gate 3) replace `roadTravelTimeS` with EWMA observed
travel times and add bounded, hysteretic rerouting; the provider contract does not change.

## 8. Simulation

Lives in `src/sim`. Fixed step `dtS = 0.1`. All randomness from the seeded generator in
`src/geo/random.ts` (mulberry32 or xoshiro128**, with uniform and normal sampling; shared by
sim, demand and routing); all iteration in index order.

```ts
interface SimParams {
  dtS: 0.1;
  vehicleLengthM: 4.5;
  idm: { aMps2: 1.5; bMps2: 2.0; headwayS: 1.2; minGapM: 2.0; desiredSpeedSd: 0.08 };
  mobil: { politeness: 0.3; thresholdMps2: 0.2; safeDecelMps2: 3.0 };
  laneChangeDistanceM: 30;
  laneChangeDurationS: 2;
  mandatoryUrgencyM: 10;         // extra margin before a required change becomes forced
  intersection: { decisionDistanceM: 15; gapS: 4; creepSpeedMps: 1.0 };
  spawnMinGapM: 8;
  linkCostAlpha: 0.3;
  linkCostIntervalS: 60;
  rerouteIntervalS: 120;
  rerouteHysteresis: 0.15;
  maxReplans: 3;
  routeNoise: 0.1;
}

type VehicleState = 'queued_origin' | 'driving' | 'queued_destination' | 'completed' | 'failed';
type FailReason = 'no_route' | 'unsupported_mode' | 'destination_unreachable' | 'stranded'
  | 'no_origin_connector' | 'no_destination_connector';

interface TrafficEngine {
  load(input: { compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario; params?: Partial<SimParams> }): void;
  step(n?: number): void;
  readonly timeS: number;        // seconds since midnight of the scenario day
  snapshot(): VehicleSnapshot;
  metrics(): Metrics;
  inspect(vehicleId: number): VehicleDetail | null;
  stateHash(): number;           // 32-bit FNV-1a, see below
}

interface VehicleSnapshot {
  timeS: number; count: number;
  id: Uint32Array; x: Float32Array; y: Float32Array; heading: Float32Array;
  speed: Float32Array; lateralM: Float32Array;       // lateral offset while changing lanes
  lane: Int32Array;                                   // lane idx, or -(movement idx + 1) on a movement
  state: Uint8Array;                                  // 1 driving, 2 queued_destination
}

interface Metrics {
  timeS: number;
  trips: { pending: number; queuedOrigin: number; driving: number; queuedDestination: number;
           completed: number; failed: number };       // sum equals trips loaded (T01)
  failedByReason: Record<FailReason, number>;
  meanTravelTimeS: number; meanDelayS: number;        // delay = travel - free-flow estimate
  roadSpeedRatio: Float32Array;                       // mean speed / limit per compiled road, for heat
  stepsPerSecond: number;                             // measured by the host, 0 headless
}

interface VehicleDetail {
  id: number; tripId: string; personId: string | null;
  originPlace: PlaceId; destinationPlace: PlaceId; state: VehicleState;
  lane: number; positionM: number; speedMps: number;
  route: Route | null; routeReason: 'initial' | 'missed_turn' | 'congestion';
  waitingS: number; departedS: number | null; arrivedS: number | null;
  failReason: FailReason | null;
}
```

Step sequence, in this order every step:

1. Signals: compute each signalized node's phase state at `timeS`.
2. Spawn: for each `out` or `both` connector in index order, release queued trips whose
   departure time has passed while the lane has a free gap of `spawnMinGapM` at the connector
   and the connector's per-minute budget allows. A released trip gets a route request from the
   connector lane; `no_route` fails the trip without spawning. Trips whose mode is not `car`
   fail at load time with `unsupported_mode` (T15).
3. Proposals, for every driving vehicle in (lane idx, position descending) order, from the
   state at the start of the step:
   - Leader: the next vehicle ahead on the same lane, else on the movement the vehicle will
     take, else on the lane after it. A red or ungranted movement is a standing obstacle at
     the lane end; an arrival connector is a standing obstacle at its position when the place
     cannot accept the vehicle.
   - Acceleration from IDM.
   - Lane change proposal: mandatory toward `targetLanes` when the distance to the lane end is
     below `changesNeeded * laneChangeDistanceM + mandatoryUrgencyM` (accepts gaps down to
     `minGapM` and may slow to `creepSpeedMps`), otherwise discretionary by MOBIL. A proposal
     names the target lane and the position.
   - Intersection entry request when no grant exists yet, the vehicle ahead on the lane (if
     any) already holds its grant, and the distance to the lane end is within
     `max(decisionDistanceM, v^2 / (2 * bMps2) + minGapM)`, so a car asks before the ungranted
     stop line would make it brake and a platoon flows through a green.
4. Resolution:
   - Lane changes are accepted in proposal order when the target gap is still free given
     already accepted changes this step.
   - Per node, entry candidates are sorted by (priority desc, right-before-left, waiting time
     desc, id asc). A candidate is granted when its movement is green or uncontrolled-allowed,
     no vehicle holds a grant on or drives on a conflicting movement, the last vehicle on the
     exit lane is at least `vehicleLengthM + minGapM` along it (downstream blocking), and for
     yield and stop nodes every vehicle approaching on a conflicting higher-priority movement
     is at least `gapS` away. Stop nodes require a minor-approach vehicle to stand at the
     stop line continuously for at least one second before requesting entry. Waiting behind
     another car away from the line does not count. Several vehicles may hold grants on the same movement (movements
     from one lane never conflict); car-following keeps their spacing. A grant persists until
     the vehicle leaves the movement, except that a signal change revokes grants of vehicles
     still on the approach whose movement can no longer be entered.
5. Commit: `v = max(0, v + a * dt)`, `x += v * dt`. A vehicle that passes its lane end enters
   its granted movement, then the to-lane. A vehicle that reaches an arrival connector completes
   if the place accepts it (capacity and throughput), otherwise becomes `queued_destination` at
   the connector position and blocks the lane behind it (T08). A vehicle at the end of a lane
   without any usable movement toward its route takes the legal movement with the lowest turn
   penalty whose landing lane can route to its destination (TASK-048, owner-approved simulation
   exception) and gets a reroute with reason `missed_turn`. If no fallback reaches the
   destination but the route needs another lane on this road, it stops before the junction
   and waits for a safe mandatory lane change. Otherwise it fails as `stranded`.
   Nothing is ever moved to a lane it did not drive to.
6. Accounting, metrics, hash.

Implementation notes (TASK-003 as merged): the commit clamps a vehicle's new position to the
start-of-step leader rear minus `minGapM` and to an ungranted stop line, and derives the
committed speed from the clamped displacement, so the integrator never overlaps a leader. A
vehicle that takes a fallback movement remembers it and will not retry it from the same lane;
when every exit has been tried it waits for a required lane change or fails as `stranded`
as above. Vehicle ids in snapshots, `inspect`
and the hash are the trip index plus one; `inspect` returns null for a pending trip. Trips
naming a place that does not exist are an invariant violation and throw at load.

Congestion routing (TASK-031): requests use `routeNoise` and the stable `routeSeed` drawn at
load. Road exits (including completed arrivals at connectors) record elapsed travel time;
partial traversals are normalized by distance to a full-road estimate. Accounting updates
the road EWMA every `linkCostIntervalS`, using the interval's mean observation or free flow
when unobserved. A queue contributes no sample until a vehicle leaves. Only cost arrays are
refreshed on a `LinkCosts.version` change; the topology cache is unchanged. Before proposals,
driving vehicles check routes at `rerouteIntervalS`, with an id-based initial phase after
departure. Checks skip movements and the final `decisionDistanceM` of a lane. A different
route must beat the remaining incumbent's cost, repriced with current costs and the same
noise, by `rerouteHysteresis`; at most `maxReplans` congestion switches occur per trip.
Switches release approach grants, reset the route cursor and lane plan, and set
`routeReason: 'congestion'`.

Lane changes (TASK-004 as merged): proposals are generated before the car-following pass and
applied before it, so following distances and entry requests use the resolved lanes; a vehicle
that changes lane gives up any intersection grant and asks again from its new lane.
Discretionary (MOBIL) changes are not proposed while a vehicle holds a grant, within
`decisionDistanceM` of the lane end, or away from the destination lane on the final road, so
a queue at an arrival connector keeps blocking its lane. A forced change that is blocked by a
close leader or a faster follower caps the vehicle's speed at `creepSpeedMps` until it fits.
When a vehicle cannot reach its planned movement, it prefers a movement from its current lane
into the next road of its route whose landing lane can still reach the route's target lanes,
and only otherwise takes the cheapest legal movement with a feasible destination route and
reroutes with `missed_turn`. This prevents a fallback from choosing an unrelated boundary exit.

Lane changes are discrete in the model (the vehicle switches lane and keeps its position along
the road); `lateralM` animates the switch over `laneChangeDurationS` for the renderer only.

Ramps and lane drops (TASK-032): merge grants additionally require a target-lane bumper gap
of at least `minGapM` and an IDM insertion acceleration no lower than `-safeDecelMps2`.
A ramp waits for competing movement occupants/grants and for approaching mainline followers
that cannot stop within that bound, including one step of reaction travel. An ungranted
mainline follower that can stop yields to a requesting ramp; its merge stop-line acceleration
is bounded by `safeDecelMps2`. Ordinary leader-following safety still takes precedence.
Existing movement occupancy remains exclusive across conflicts, including the merge path.
For a narrower small-angle continuation, lanes beyond the compiler's unclamped ordinal
mapping (median-side for through, curb-side for merge/diverge) must change before the drop.
They target surviving route-compatible lanes with the same urgency threshold as route-required
changes and wait before the lane end if the safe gap is unavailable, rather than using the
compiler's clamped/fallback movement from the dropped lane.
Required diverge changes also wait before the junction and retry at the stop-line margin;
holding releases an approach grant so it cannot block the lane the vehicle needs to join.
The existing missed-turn fallback remains for ordinary turns.

State hash: FNV-1a over the sequence `[round(timeS * 10)]` followed, for every vehicle that
has departed (driving, queued at its destination, completed or failed after departing) in id
order, by `[id, lane field, round(positionM * 100), round(speedMps * 100)]`, then the six
trip counts. Two runs with the same city version, scenario seed and trips produce equal hashes
at every step (T02).

TASK-030 admission windows: compiled places retain a copy of their events. Each event opens
`arrivals` admission slots uniformly over its window (floor of the elapsed fraction times
the count). Quotas add across events, are shared by all arrival connectors, and unused slots
remain available after the window so road delays do not strand late visitors. Before the
first window there are no event admissions. Physical `capacity` and connector throughput
still apply; places without events keep the existing behavior. Event counts describe car
visits in this gate, rather than rail passengers or transit legs.

At parking and event places, a person's next departure waits for their preceding inbound
trip to complete; a failed inbound causes its dependent departure to fail as stranded.
Waiting inbound cars do not block ready parked departures. Occupancy starts at zero and
decreases only when a paired car successfully departs, so an unpaired departure cannot
free another visitor's slot. At capacity-limited places a ready departure may retry another
configured outbound connector in compiled index order when its seeded connector is blocked.
It must have a free spawn gap and budget, and cannot spawn behind traffic arriving at the
same place on that lane. Route planning starts at the actual outlet; its throughput is charged
and occupancy decreases only after successful release. Unpaired outbound event visitors
represent cars already outside the modeled parking stock. No per-space circulation or inferred overnight parking is modeled.

## 9. Demand

Lives in `src/demand`. Population is persistent and saved with the project; trips are
regenerated deterministically from it.

```ts
interface Activity { kind: 'home' | 'work' | 'school' | 'shop' | 'leisure' | 'other';
  placeId: PlaceId; startS: number; durationS: number }
interface Person { id: string; homePlaceId: PlaceId; workPlaceId: PlaceId | null;
  hasCar: boolean; agenda: Activity[] }
type TripMode = 'car' | 'walk' | 'bus' | 'rail';
interface Leg { mode: TripMode; fromPlaceId: PlaceId; toPlaceId: PlaceId }
interface TripRequest { id: string; personId: string | null; originPlaceId: PlaceId;
  destinationPlaceId: PlaceId; departS: number; mode: TripMode; legs: Leg[] }

interface DemandConfig {
  seed: number;
  personsPerResident: number;     // sampling, 1 = everyone, 0.2 = one in five
  carShare: number;               // 0..1
  workStart: { meanS: number; sdS: number };       // default 08:00, 30 min
  workDuration: { meanS: number; sdS: number };    // default 9 h, 1 h
  gravityScaleM: number;          // home-work distance decay, default 5000
  throughTripsPerHour: number[];  // 24 values, gateway to gateway (Gate 3)
  chains?: { schoolShare?: number; shopShare?: number; leisureShare?: number }; // 0..1, omitted = 0
}

interface Scenario { id: string; name: string; seed: number; startS: number; endS: number;
  demand: DemandConfig; simParams: Partial<SimParams> }   // SimParams type lives in src/schema/sim.ts; defaults in src/sim/params.ts

function generatePopulation(city: City, config: DemandConfig): Person[];
function scheduleTrips(city: City, persons: Person[], scenario: Scenario): TripRequest[];  // sorted by departS
```

TASK-042 comparison saves a baseline `{ city, scenario, population? }`. The variant references
the current editor `cityVersion`. Both runs use the baseline scenario, seed and the same trip
list generated once from its saved population (or generated from its demand when absent).
Road, turn, connector and signal changes therefore compare against fixed demand. Removing a
trip's origin or destination place requires restoring that place or saving a new baseline;
comparison reports this before running. New or changed population is not resampled for the
variant. Saving a baseline captures current editor state, including unapplied live-run edits.

- Persons are created per residential place (and gateway places, which stand in for external
  commuters) in proportion to `population * personsPerResident`. Work places are drawn by
  gravity: probability proportional to `jobs * exp(-distance / gravityScaleM)` over places with
  jobs, using straight-line distance between centroids. A person keeps the same home, work and
  car access until the population is regenerated on purpose.
- Gate 1 agendas: home, work (start from `workStart`, duration from `workDuration`), home.
  Gate 3 adds shop, school, leisure legs, gateway through traffic and place events.
- TASK-030 chains are opt-in: `schoolShare` replaces the work activity with a six-hour school
  visit, `shopShare` adds a 30-minute stop before returning home, and `leisureShare` adds an
  evening home-leisure-home outing (departure at 18:00–19:00 or later, two-hour stay).
  School and retail choices use positive `attraction`; leisure uses retail and other places.
  Home and the assigned workplace are excluded from these optional destinations. Without a
  workplace the single-home rule below still applies. Shares omitted or zero preserve the
  original commute draws; existing town and grid scenarios do not opt in.
- For each transition, positive origin `profile.departures` weights override the default
  departure time; otherwise positive destination `profile.arrivals` weights apply. Sample
  uniformly within the chosen hour, conditioned on time at or after the current activity's
  start (18:00 for evening outings). If no weighted time remains, use the next day. All-zero
  profiles use the default timing. Activity starts denote scheduled transitions, not predicted
  road arrivals; travel time is not subtracted. A profile overrides the default dwell duration.
- Through demand draws origins by gateway population and distinct destinations by gateway
  jobs. Gateways without a feasible positive-weight counterpart are excluded; without any
  eligible pair there are no through trips. Integer hourly rates are exact; fractional rates
  use seeded stochastic rounding. Times are uniform in each hour of the scenario day.
- Each place event creates `max(arrivals, departures)` nonresident visitor identities on
  separate streams keyed by place, event and visitor index. The first `min` visitors have
  paired inbound/outbound trips with their two uniform window draws sorted chronologically;
  excess visitors travel one way. Endpoints are other gateways weighted by population plus
  jobs, or residential places by population when there are no other gateways. An event with
  visitors but no positive-weight endpoint fails clearly. Counts are absolute, independent of
  resident sampling and car share; visitors and through trips use cars. No transit is simulated.
- Restart keeps the saved population unless a place was added or removed or a place's kind,
  population or jobs changed since it was generated; then the population is regenerated from
  the scenario demand so new places attract trips. TASK-034 adds explicit regeneration with a
  chosen seed. Connector, road and signal edits never touch the population.
- `scheduleTrips` rebuilds each person's `agenda` in place from the persistent assignments
  (persons without a workplace get a single home activity), then emits one `TripRequest` per
  agenda transition, mode `car` for persons with a car. Persons without a car get mode `walk`
  in Gate 1, which the sim reports as unsupported rather than spawning (T15). Population
  draws use `DemandConfig.seed`; scheduling draws use `Scenario.seed`; both derive a
  sub-stream per person id, so adding a place does not reshuffle existing persons.
- Trips are not clipped to the scenario window. The sim releases a trip whose `departS` is
  before `startS` at `startS`; a trip after `endS` stays pending in the counts.
- Trip ends map to connectors in the sim: origin uses an `out` or `both` connector of the
  origin place, destination an `in` or `both` connector of the destination place. When a place
  has several, the sim picks per trip by seeded choice weighted by `throughputPerMin`.
- Validation summary (Gate 3 UI): trips by place and hour, total trips, mean length, queued
  unspawned, completed, failed by reason.

## 10. Engine host

Lives in `src/host`. The worker owns the engine, the route provider and link costs. The main
thread owns the editor and the compiled city for rendering and picking; it sends the compiled
city (structured clone) to the worker on load.

```ts
type HostRequest =
  | { id: number; type: 'load'; compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario }
  | { id: number; type: 'play' } | { id: number; type: 'pause' }
  | { id: number; type: 'setSpeed'; multiplier: number }       // 1, 2, 5, 10, 20
  | { id: number; type: 'step'; steps: number }
  | { id: number; type: 'restart' }                              // same inputs, same seed
  | { id: number; type: 'snapshot' } | { id: number; type: 'metrics' }
  | { id: number; type: 'metricsSeries' }
  | { id: number; type: 'runHeadless' }
  | { id: number; type: 'tripRecords' } | { id: number; type: 'roadStats' }
  | { id: number; type: 'trajectories'; enabled?: boolean }
  | { id: number; type: 'trajectoryStatus' }
  | { id: number; type: 'inspect'; vehicleId: number } | { id: number; type: 'hash' };
type HostReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
type HostEvent =
  | { type: 'headlessProgress'; timeS: number }
  | { type: 'tick'; timeS: number; achievedMultiplier: number; counts: Metrics['trips'] }
  | { type: 'finished'; timeS: number } | { type: 'error'; message: string };
```

- The play loop runs in the worker on a timer: each wall tick advances enough fixed steps to
  track `wallElapsed * multiplier`, capped per tick, and reports the achieved multiplier. The
  UI shows the achieved speed, so throttling is visible rather than silent.
- Snapshots are pulled: the main thread requests one per animation frame with at most one in
  flight; the worker replies with transferable buffers. `tick` events are pushed at 10 Hz.
- TASK-041: snapshot replies additionally include optional `roadSpeedRatio`, transferred with
  the matching vehicle arrays at most once per 500 ms of wall time. The renderer updates heat
  and lane-end queues only with these replies. Load/restart resets the throttle.
- `metricsSeries` returns the worker's history of `{ timeS, driving, queued, completed,
  meanDelayS }`. Queued means origin plus destination queues; delay is the engine's cumulative
  mean for completed trips. The loop samples on load and every 60 simulated seconds from the
  scenario start, splitting manual step batches at sample boundaries. Load/restart clears the
  history. The chart pulls on open or explicit Refresh; there is no main-thread polling timer.
- `runHeadless` creates a fresh engine from the worker's loaded inputs and advances fixed
  steps to `endS`. It returns minute metrics `series`, final `metrics`, completed-trip
  `travelTime` (raw `travelTimesS` and `delaysS`, `meanS`, `meanDelayS`, nearest-rank
  `p90DelayS`) and `roadVehicleCounts` keyed by canonical road ID. Counts are distinct
  vehicles actually observed on each road, including unfinished trips, not planned routes.
  Delay uses the initial route's physical free-flow time, matching simulation accounting;
  the host decorates the injected route provider's result and captures it at departure.
  Empty distributions return zero; the comparison table displays unavailable time values as
  a dash. No snapshots or tick/finished events are emitted; progress is reported every 600
  steps and at the endpoints. Interactive engine state and metrics history are unchanged.
  The UI uses a second worker for baseline then variant sequentially, terminating it on
  completion, cancellation, edits or project replacement. The interactive worker continues
  independently. Results are invalidated by edits and new baselines.
- TASK-043: `tripRecords` returns one row per loaded trip, including pending and failed trips.
  The additive, lazily materialized `Metrics.tripOutcomes` exposes departure, arrival,
  initial-route free-flow time and failure reason in input order. Unavailable times are null;
  exported completed-trip delay is `max(0, arrival - departure - freeFlow)`.
- `roadStats` returns observations taken every tenth fixed step (one simulated second):
  speed ratios averaged over vehicle observations on each road (1 when unobserved), observed
  road exits into movements or completed trips (a road traversed within one second may be
  missed), and the maximum simultaneous queue across the road's lanes (speed below 0.5 m/s
  within 50 m of a lane end). Lane changes on the same road do not count as passes.
- `trajectories` with `enabled` switches recording and returns `{ enabled, count }`; without
  it, returns samples. `trajectoryStatus` reads that status without copying samples. The
  first sample is 10 simulated seconds after enabling, then every 10 s, at the first fixed
  step at or after each deadline. Lane values are canonical lane IDs or movement IDs at
  junctions. Turning off retains samples; load/restart resets recording, samples and road
  statistics. The loop's optional `afterStep` hook observes every step even in manual batches.
- The worker entry uses `postMessage(data, { transfer })`, which type-checks against the DOM
  lib and works in a worker; no WebWorker lib is added to the TypeScript config.
- Wire form of `load`: a Flatbush index cannot be structured-cloned, so the client sends the
  compiled city with `laneSpatial` reduced to its `data` buffer and `byteOffset`, and the
  worker rebuilds the index with `Flatbush.from` (`HostWireRequest` in `src/host/protocol.ts`).
- Play loop as merged: a 100 ms timer; at most 25 steps per tick (25x at `dtS = 0.1`); whole
  steps the worker cannot keep up with are dropped rather than caught up later, and the
  fractional remainder is kept. `setSpeed` may be called before `load`. Concurrent `snapshot`
  calls share the one in flight and resolve to the same frame.

## 11. Rendering and UI

`src/render` draws a `CompiledCity` and the latest `VehicleSnapshot` with PixiJS 8:

- Layers, bottom to top: tile backdrop (Gate 2, optional), road surfaces, lane markings and
  movement arrows (legal movements only), node areas, places and connectors, signal heads
  colored by current state, vehicles (ParticleContainer, rounded rectangles colored by state,
  dots below a zoom threshold), selection and route overlays, road heat coloring.
- Camera: pan and zoom at the pointer, world units meters, y-south so no flip is needed.
- Picking: `laneSpatial` for roads and lanes, nearest snapshot vehicle within a pixel radius,
  place polygons by point-in-polygon.
- Static geometry is rebuilt only when `compiled.version` changes.
- `Scene.setCity(compiled, city)` also takes the canonical `City`, because place shapes and
  node layers are not in the compiled model; grade-separated roads are drawn in layer order.
  `Scene.setRouteOverlay({ lanes, movements } | null)` takes compiled indices; the UI maps a
  `Route` to it (the lanes of `targetLanes` and the route's movements).
- The renderer owns a structural copy of the `VehicleSnapshot` layout in `src/render/types.ts`
  so it does not depend on `src/sim`; the sim's type must stay assignable to it.
- Layer visibility is presentation-only. Heat uses cached road shapes and a single teal ramp;
  queue dots count cars below 0.5 m/s within 50 m of a lane end, appearing for two or more cars.
  Disconnected lane highlights use `disconnected_component` diagnostic refs.
- Comparison road usage is one additional Layers entry. A sibling of the heat layer draws
  variant-minus-baseline unique vehicle counts in warm brown (up) and teal (down), below
  vehicles. It includes baseline geometry for removed roads; unchanged roads have no tint.

`src/ui` is the React app with one Zustand store. Layout follows the brief:

```
| Scenario name   Undo Redo   Open Save Export   Play Pause Step Speed   [synthetic traffic] |
| Toolbox | Map                                              | Inspector (selection-driven) |
| Select  |                                                   | Street: lanes, direction,    |
| Road    |                                                   |   speed, turn toggles        |
| Place   |                                                   | Node: control, signal phases |
|         |                                                   | Place: profile, connectors   |
|         |                                                   | Vehicle: route, reason       |
| 07:45  x5 (achieved x4.8)   driving 312  queued 18  done 1 204  failed 0   validation (2) |
```

Gate 1 edit flows through the inspector: lane count, speed limit, street direction, turn
allow/ban toggles at a node, signal phase durations. Every committed change shows the
"restart to apply" state on the run bar.

## 12. Project format and migrations

Lives in `src/project`. A project is a ZIP with extension `.cityflows` (fflate), or a single
JSON document for small worlds and tests.

```
manifest.json     { format: 'cityflows', schemaVersion: 1, appVersion, projectId, name, savedAt,
                    files: { 'city.json': sha256, ... }, licenses: string[], attribution: string | null }
city.json         City                      authoritative canonical snapshot
population.json   Person[]                  optional; absent = regenerate from the scenario config
scenarios.json    Scenario[]                at least one
history.json      { historyVersion: 1, entries: HistoryEntry[] }   optional, droppable
view.json         { camera, layers, selection }                    optional
baseline.json     { city: City, scenario: Scenario, population?: Person[] } optional
```

- Single JSON: `{ manifest, city, population?, scenarios, history?, view?, baseline? }`. Each member's
  hash is computed over its compact JSON serialization, which is embedded verbatim, so the
  same manifest verifies both forms. `manifest.schemaVersion` is the city's schema version at
  save time; `openProject` passes `city.json` to `migrateCity` and ignores archive members
  outside the layout.
- TASK-042 adds optional `baseline` to single JSON and optional `baseline.json` to the ZIP
  manifest's hashed members. Both validate the saved city, scenario and optional population;
  omitting them preserves existing project behavior. Schema version remains 1. Baseline is
  separate from current `city.json`; restore history uses the normal history format with
  optional patch metadata described in section 6.
- `openProject(bytes)` verifies hashes, validates every file with Zod, runs
  `migrateCity(json)` keyed on `schemaVersion`, and returns a structured error naming the file
  and the first validation path on failure. Adding a schema version requires a fixture saved in
  the old version and a migration test.
- Round-trip test (T14): save, open in a fresh process, compare city and scenario hashes, run
  N steps on both and compare `stateHash()`.
- Exports (Gate 4): GeoJSON of roads and places (lossy, documented), CSV trip list, CSV of
  per-road metrics. All exports carry seed, engine version, schema version and the synthetic
  traffic notice.
- TASK-043 CSVs (trips, road metrics, trajectories) begin with a `#` provenance comment,
  followed by their header row; provenance also includes the fixed time step. Times are
  simulation seconds, distances meters, speeds m/s. The export menu adds provenance to
  the existing GeoJSON output and names files with the project name and scenario ID.

## 13. OSM import

Lives in `src/importers/osm`, runs inside an import worker.

1. Parse `.osm` XML with `fast-xml-parser` into nodes, ways, relations.
2. Keep drivable highways: motorway, trunk, primary, secondary, tertiary, unclassified,
   residential, living_street, service (only when `service` is not `parking_aisle` or
   `driveway`), and their `_link` variants as `ramp`.
3. Junction nodes: nodes shared by two or more kept ways, way ends, nodes tagged
   `traffic_signals`, `stop` or `give_way`, and `via` nodes of restriction relations. Split
   ways there.
4. Project with a `GeoReference` at the bbox center. One `Node` per junction node, `layer`
   from the tag. Connectivity starts from shared OSM node ids. TASK-048 adds inferred
   crossings from a feeder to the opposing, same-name/class surface carriageway on the same
   layer, within half the combined road width plus 12 m (capped at 30 m). Motorways, ramps
   and restriction-via nodes are excluded from this proximity inference.
   Equal-attribute sections shorter than 30 m join at uncontrolled degree-two nodes,
   retaining their geometry and source way ids. With owner approval (TASK-048), connected
   sub-30 m junction sections consolidate in clusters of at most 60 m diameter; bridges,
   motorway junctions, stop/yield controls, cycleway attribute boundaries and restriction-via
   nodes stay separate.
   External road-pair reachability through each cluster becomes explicit turn rules, and
   signals move to its representative. Canonical lane assignment then applies at the combined
   junction. Residential/service cul-de-sacs get an inferred turnaround. All inferences appear
   in provenance; disconnected roads and remaining short-road/dead-end warnings stay visible.
5. Roads: `oneway=yes` (or `-1`, or implied by motorway and roundabout) gives one road;
   otherwise two roads with mirrored centerlines sharing a `streetGroupId` per split section
   (`osm:way/<id>` for the first section, `osm:way/<id>/<n>` after), since one group per way
   would make the compiler treat continuing along the way as a U-turn. Lane counts from
   `lanes:forward` and `lanes:backward`, else `lanes` (split ceil/floor between the two
   directions and marked inferred), else class defaults (motorway and trunk 2 per direction,
   others 1) marked `inferred: ['lanes']`. Speed from `maxspeed` (km/h or mph) otherwise class
   defaults (motorway 100, trunk 80, primary 60, secondary 50, tertiary 40, residential 30,
   service 20, ramp 40 km/h) marked `inferred`. Widths 3.5 m, 3.0 m for residential and
   service. Only guessed attributes appear in `inferred`.
6. Turn rules: `turn:lanes` (or `turn:lanes:forward` and `:backward` on two-way ways) becomes
   lane-level `TurnRule`s: a marked lane is allowed into exactly one target lane per turn it
   lists (aligned by index, curb-side for merges and diverges, outermost for right turns) and
   banned from the others; unmarked lanes keep the compiler defaults. Restriction relations
   (`no_*`, `only_*` with from, via node, to; `only_*_u_turn` becomes an allow) become
   road-level rules; unsupported or non-incident relations produce `osm_unsupported_tag`.
   TASK-048 single-lane arrows permit every receiving lane of their direction. Through arrows
   align within the through/unmarked lane group, excluding dedicated turn lanes from the
   receiving-lane index. Arrows are
   deferred at intermediate way boundaries; a same-name continuation bending less than 90
   degrees counts as through. An arrow with no matching exit is recorded as `turnLanesDeferred`
   instead of prohibiting every exit at an earlier junction. Relation bans still take priority.
7. Control: `highway=traffic_signals` on the node gives `signal` with a generated program:
   two 30 s phases for the two opposing approach axes with amber 3 s and all-red 1 s; a
   road-pair group that conflicts with its phase, or a left turn at a node with four or more
   approaches, gets an extra 15 s (left) or 30 s phase. TASK-048 resolves conflicting lanes
   within a road-pair group before generating the program: keep the first nonconflicting
   movement in deterministic compiler order, explicitly ban conflicting pairs and record
   `signalLaneAssignment`. Drivers must merge on the approach; unresolved groups still get
   `osm_signal_group_conflict`. `highway=stop` gives `stop`;
   `highway=give_way` gives `yield`; else `uncontrolled`.
8. Clip to the bbox: a road crossing the edge is cut there; the cut end becomes a node and a
   `gateway` place with an `out` connector (5 m into entering roads) or an `in` connector (5 m
   before the end of leaving roads). TASK-048 pairs same-name/class carriageways on the same
   bbox edge within 150 m, then complementary one-way streets within 300 m. Nearby clipped
   ramps share a parent arterial gateway and add no extra demand. Per-direction population
   and jobs use the maximum class demand times lane count: motorway 400, trunk 300, primary
   200, secondary 120, tertiary 80, residential 40, service 20, ramp 80 per lane. An entry-only
   gateway has no jobs; an exit-only gateway has no residents. All values remain editable.
   Portal lanes prefer paths to or from the main strongly connected lane component;
   lane changes count only on sections long enough to traverse the lane block at 30 m per
   change plus 10 m clearance. A corridor without a multi-road cycle retains its directional
   portals. Every clipped motorway, trunk, primary and secondary end retains a portal even
   when disconnected, with diagnostics exposing its lack of access. Isolated minor-road
   fragments retain their roads and diagnostics but generate no gateway demand.
   Local two-way residential/service boundary ends have inferred turnarounds, allowing
   a driver who misses a turn to return instead of stranding at the crop boundary.
9. Preserve `amenity=parking` polygons, `railway=station`, `aeroway=aerodrome`, `amenity=school`
   and `shop=mall`. TASK-048 also imports residential, office/commercial, retail and industrial
   building footprints and land use, including multipolygon courtyards and bbox clipping.
   Known building use wins; `building=yes` uses containing land use, otherwise residential.
   Garages, sheds, roofs and other non-occupancy building types do not generate residents.
   Positive `building:levels` up to 200 wins; defaults are four floors for apartments,
   unspecified residential and commercial buildings, two for houses/detached/terraces, one
   for retail/industrial. Gross floor area per person/job is 45 m² residential, 35 commercial,
   45 retail and 80 industrial. A land-use polygon with no usable building footprints uses
   35% footprint coverage and the same floor/occupancy defaults; it adds no extra floor area
   when footprints already supply its demand. These are editable synthetic estimates.
   Aggregate by bounded surface-street block and use (service accesses do not divide blocks).
   At open map edges, use the containing land-use polygon or nearby footprints within 100 m
   without crossing a street. Round only the aggregated counts. Parking and schools retain
   their existing demand. All local places connect to the nearest car lane in the main
   movement-connected component, inset at most 10 m from lane ends; this avoids snapping
   to isolated accesses or relying on an immediate lane change after spawning. Inferences,
   source ids and block aggregation are recorded in provenance.
10. Diagnostics (T18): everything in section 5.5 plus `osm_unsupported_tag`, `osm_clipped`,
    counts of inferred lanes and speeds. The wizard shows them before the city is accepted.

Overpass provider: query drivable highways and restriction relations in a bbox capped at
50 km squared, one request at a time, results cached in IndexedDB by bbox and query version,
endpoint configurable, OSM attribution recorded. Nominatim, when used, is limited to one
request per second and triggered only by an explicit search action.

## 14. Testing

Headless tests run in Vitest from fixtures in `src/fixtures` (generated) and `fixtures/`
(data). Playwright drives the built app for the handoff demos. Mapping of handoff tests:

| Test | Module | Fixture | Task |
|---|---|---|---|
| T01 vehicle conservation | sim | grid-5x5 | TASK-003 |
| T02 determinism | sim | grid-5x5 | TASK-003 |
| T03 multi-lane queue | sim | two-lane approach with signal | TASK-003, TASK-004 |
| T04 turn restriction | routing, editor | grid-5x5 with a banned turn | TASK-002, TASK-007 |
| T05 expressway preference | routing | bypass fixture | TASK-002 |
| T06 congestion reroute | routing, sim | bypass fixture | TASK-031 |
| T07 lane-aware ramp | sim | ramp fixture | TASK-004, TASK-032 |
| T08 place connectors | sim | grid-5x5 with capacity-limited place | TASK-003 |
| T09 daily activity | demand | grid-5x5 | TASK-011, TASK-030 |
| T10 station surge | demand, sim | station fixture | TASK-030 |
| T11 real-map import | importers | fixtures/osm | TASK-020 |
| T12 graph edit | editor | grid-5x5 | TASK-007, TASK-022 |
| T13 signal safety | network | four-way signal | TASK-001 |
| T14 round-trip | project | grid-5x5 edited | TASK-008 |
| T15 multimodal contract | demand, sim | grid-5x5 | TASK-011 |
| T16 UI performance | e2e | grid-5x5, neighborhood | TASK-044 |
| T17 edit live-state policy | ui, editor | grid-5x5 | TASK-010 |
| T18 import diagnostics | importers, network | broken fixtures | TASK-001, TASK-020 |

Synthetic fixtures (all generated by code with a seed, in `src/fixtures`):

- `grid5x5`: 5 by 5 streets, 120 m blocks, mix of one-lane two-way, two-lane two-way and one
  one-way pair, one signalized intersection at the center, a residential place in one corner
  and a work place in the opposite corner, each with two connectors.
- `signalApproach`: one four-way node, two lanes per approach, signal.
- `bypass`: an origin and destination joined by a slow local street (40 km/h, 1.2 km) and a
  longer expressway (100 km/h, about 2.0 km) with a ramp at each end. The expressway's first
  and last segments continue the ramps' headings, so the joins compile as through movements
  and the ramp ends as diverge and merge; with free-flow costs and the section 7 penalties the
  expressway wins by about 20 s and loses once its speed limit drops below about 75 km/h.
- `ramp`: a two-lane motorway with an on-ramp merge and an exit diverge.
- `dividedHighway`: two carriageways 20 m apart crossed by a bridge road on `layer 1` with no
  shared node, and an at-grade crossing 300 m further with shared nodes.
- `shortTurnLane`: a two-lane road with a left turn whose lane-feasible distance is below
  `laneChangeDistanceM` from an upstream merge.
- `disconnected`: two components and a dead-end lane.
- `station`: a station place with an event, a pickup loop, and a capacity-limited parking
  place (Gate 3).

## 15. Performance targets

Initial acceptance targets to be measured, not claims (brief section 10.2):

| Scenario | Target |
|---|---|
| grid5x5, 100 to 300 vehicles | 60 FPS, deterministic, no crashes |
| Neighborhood, 1 000 to 3 000 active vehicles | 30 FPS UI and 1x simulation speed |
| 10x speed on grid5x5 | achieved; larger maps throttle visibly |
| Imported neighborhood | import progress, diagnostics, no UI freeze |
| 24 h run | stable memory, no lost trips |

Benchmark the sim step, worker transfer, and render time separately (TASK-044).

## 16. Deferred, explicitly

Transit vehicles and GTFS, walking legs, PBF import and bulk extracts, live topology edits,
permissive and actuated signals, adaptive routing beyond EWMA, 3D view, desktop packaging,
parking circulation. R7's multimodal readiness is covered by `TripRequest.legs` and
`TripMode` in section 9; nothing in the sim assumes a person equals a car.
