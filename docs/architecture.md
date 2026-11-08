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
| 8 | Road geometry | Every directed carriageway owns its centerline. `streetGroupId` optionally groups the two directions of a simple street for editing; `corridorId` (geometry rework, owner 2026-11-06) groups every carriageway of one street, including divided pairs and dual carriageways, for geometry. | Two directions sharing one centerline: cannot represent divided highways, medians, ramps or real OSM geometry. |
| 9 | Movements | Lane-to-lane movements are generated at compile time from connectivity and lane rules; the canonical model stores only explicit allow/ban overrides. Structural errors block commits; connectivity problems are warnings that do not. | Every movement as a canonical entity: edits to lane counts would orphan thousands of records. |
| 10 | Routing | Road-level search, then lane resolution with a feasibility check from the vehicle's current lane. Lane-level search is the fallback. A vehicle never teleports or takes an illegal movement; an infeasible plan becomes a legal movement plus a reroute with a reason code. Owner-approved exception (TASK-077): a car stuck at the head of a jam for `gridlock.respawnS` leaves the road and its trip starts again from its origin; it is never moved along the road. | Road-level only: vehicles stuck in the wrong lane at a turn. |
| 11 | Persistence | The canonical `City` snapshot is the authoritative saved state. Editor history is optional, separately versioned, and droppable. Migrations operate on snapshots. | Replaying a patch log on load: couples saved files to editor code history. |
| 12 | Intersections | Vehicles explicitly occupy movement paths; entry needs free space on the exit lane; conflicts are resolved by deterministic arbitration each step; signals are conservative (enter on green with space). Permissive turns and finer gap acceptance come later. | Implicit intersections: gridlock and phantom collisions. |
| 13 | Edits during a run | Release 1 required a paused run and a restart (T17). TASK-051: a committed edit is patched into the running engine (section 8, live edits): the compiled city is swapped, vehicles are remapped by id or by position, and only vehicles whose remaining route touches a changed element reroute, staggered over the reroute interval. Edits that change demand (place kind, population, jobs, places added or removed) or trip scheduling (a place's profile, events or attraction) still need a restart, which regenerates the population only in the first case. | Live topology edits without remapping: invalid vehicle references. |
| 14 | Demand | Persistent person-level home and work assignments with activity schedules, saved with the project. | Random origin-destination trips: no recognizable rush. |
| 15 | Not in release 1 | Desktop wrapper, transit vehicle operations, PBF import. A 3D view joined on 2026-11-07 as a viewer (TASK-098); editing stays 2D. | |

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

Deployment (TASK-067): the app is a static site. CI builds it on every push to `main` and
publishes it to GitHub Pages with the repository's base path; pull requests build but do not
publish. Test hooks stay out of the production build (`MODE` is neither `development` nor
`test`). The raster tile URL and the Overpass endpoint come from build-time variables
(`VITE_TILE_URL`, `VITE_OVERPASS_URL`) defaulting to today's values, so a public deploy can
point at a provider whose usage policy fits; OpenStreetMap attribution is shown wherever
tiles or imported data are.

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
- TASK-105 terrain uses the same local frame: `originM` is the north-west cell centre,
  rows grow south and columns east. Elevations are metres above the source datum, stored
  as little-endian Int16 decimetres relative to `baseM`; they never modify planar coordinates.

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
type VehicleClass = 'car' | 'van' | 'truck' | 'bus';
type AccessValue = 'yes' | 'no' | 'destination' | 'delivery' | 'private';
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
  layer?: number;          // visual grade; omitted uses the lower endpoint grade
  centerline: Vec2[];      // >= 2 points; first equals nodes[from].pos, last equals nodes[to].pos
  lateralOffsetM: number;  // lane block center relative to centerline; positive = right of travel
  lanes: Lane[];           // index 0 = leftmost in travel direction
  roadClass: RoadClass;
  speedLimitMps: number;
  access?: { all?: AccessValue } & Partial<Record<VehicleClass, AccessValue>>;
  name: string | null;
  streetGroupId: string | null;  // groups the two directions of a simple two-way street
  corridorId?: string | null;    // carriageways of one street side by side; absent = streetGroupId
  crossings?: { start?: boolean; end?: boolean }; // TASK-091: crossing overrides; absent = default
  sidewalk?: { left?: 'yes' | 'no' | 'separate'; right?: 'yes' | 'no' | 'separate' }; // Phase 2
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
  schemaVersion: 3;
  version: number;         // bumps on every committed edit; caches key on it
  name: string;
  drivingSide: DrivingSide;
  geo: (GeoReference & { bbox: [number, number, number, number]; source: GeoSource }) | null;
  nodes: Record<NodeId, Node>;
  roads: Record<RoadId, Road>;
  places: Record<PlaceId, Place>;
  context?: { features: ContextFeature[] }; // display-only OSM surroundings, see below
  parking?: Record<ParkingId, ParkingFacility>; // Phase 2 format, see below
  walk?: { nodes: Record<WalkNodeId, WalkNode>; links: Record<WalkLinkId, WalkLink> };
  terrain?: { source: string; originM: Vec2; cellM: number; cols: number; rows: number;
              baseM: number; heights: string }; // base64 Int16 LE decimetres above baseM
  nextId: number;          // single counter for all id kinds
}
```

TASK-100 advances the city schema to 3. Version 2 lanes gain `van` immediately after `car`
where cars were allowed; version 1 first restores its node defaults, then follows the same
migration. Current cities retain explicit class restrictions. TASK-096 adds optional display-only surroundings without a schema-version change. Old
projects omit the field; current and TASK-042 baseline cities retain it through ZIP/JSON save
and open. Context is never edited, never increments city.version, and is ignored by compile,
routing, demand and simulation.

TASK-101 adds optional road access without a schema-version change. The effective rule is
the class entry, then `all`, then `yes`. `vehicleClasses` in `city.ts` is the single ordered
class constant used by access validation, compilation, import and the inspector. Lane
reservations remain `Lane.allowed`. `setRoadAccess` replaces or clears the road's access
object in one undo entry, using the normal version bump and live-edit path; project and
history validation preserve it.

Phase 2 formats (lead, 2026-11-08) add optional parking facilities, a mapped walk network and
road sidewalk tags without a schema-version change; old files omit them and open unchanged.
IDs use the shared counter with prefixes `pk:`, `wn:` and `wl:`. TASK-102 to TASK-104 and
TASK-110 own their meaning and may refine these shapes in their contracts.

~~~ts
type ParkingKind = 'garage' | 'roadside' | 'lot';
type ParkingAccess = 'public' | 'private' | 'customers';
interface ParkingFacility {
  id: ParkingId; kind: ParkingKind; name: string | null;
  capacity: number;               // slots
  access: ParkingAccess;          // private and customers belong to placeId
  placeId: PlaceId | null;        // the place it serves
  connectors: Connector[];        // garage and lot entries/exits; a roadside strip has none
  shape: { kind: 'point'; pos: Vec2 } | { kind: 'polygon'; ring: Vec2[] } | null;
  strip?: { roadId: RoadId; side: 'left' | 'right'; fromM: number; toM: number;
            layout: 'parallel' | 'angled' | 'perpendicular' };   // roadside only
  aisles?: RoadId[];              // a lot's parking_aisle service roads
  occupancyAtStart?: number;      // 0..1; absent = derived from residents
  provenance: Provenance;         // inferred marks facilities generated where OSM has none
}
type WalkKind = 'footway' | 'pedestrian' | 'path' | 'steps' | 'living_street' | 'crossing';
interface WalkNode { id: WalkNodeId; pos: Vec2; layer: number;
  entrance?: { placeId: PlaceId | null }; provenance: Provenance }
interface WalkLink { id: WalkLinkId; from: WalkNodeId; to: WalkNodeId; line: Vec2[];
  kind: WalkKind; widthM: number | null; provenance: Provenance }
~~~

Stall geometry, sidewalks along streets and walk links over TASK-091 crossings are derived at
compile and never saved. `sidewalk` sides are relative to the road's travel direction; absent
means the default by road class. Compile, routing and the simulation ignore these fields until
the tasks that own them wire them in.

TASK-105 adds optional display-only terrain without a schema-version bump. The boundary
validates positive spacing, at least two rows and columns, base64 and exactly two bytes per
sample. Old files omit terrain. Edits retain it without incrementing `city.version`, and
`compile(city)` ignores it. Geography, entity geometry, IDs and the compiled network are
identical with terrain present or absent.

~~~ts
type ContextArea = 'building' | 'water' | 'green' | 'landuse' | 'parking';
type ContextPoint = 'tree';
type ContextLine = 'rail' | 'tram' | 'waterway' | 'tree_row';
type ContextFeature =
  | { kind: 'area'; class: ContextArea; rings: Vec2[][]; sub?: string; heightM?: number; levels?: number }
  | { kind: 'line'; class: ContextLine; line: Vec2[]; widthM?: number; layer?: number; spacingM?: number }
  | { kind: 'point'; class: ContextPoint; pos: Vec2; heightM?: number; crownM?: number; sub?: string };
~~~

Rings are closed, outer first then holes, in local metres rounded to 0.1 m. Optional sub is the
source tag value; tagged building height/levels and line width/layer are retained.
TASK-106 adds tree points (`sub` is `leaf_type`, dimensions are metres) and tree-row lines
with optional `spacingM` (minimum 2 m) from OSM `spacing` (default 8 m). This is an optional context
extension without a schema-version bump. Only imported context is saved; generated trees
are derived display geometry and never enter the project or compiled network.

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
  access: AccessValue[]; zone: Int32Array; // indexed by vehicleClasses
  roadClass: RoadClass; classRank: number; speedLimitMps: number; lengthM: number;
  streetGroupId: string | null; corridorId: string | null;   // corridorId ?? streetGroupId
  surface: Vec2[]; /* polygon for rendering */ }
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

TASK-101 resolves `CRoad.access` for every class. `zone[classIndex]` is `-1` outside local
access zones. For each class, destination/private roads connected through either shared
endpoint form one zone, independent of travel direction; mixed destination/private rules
join the same zone. Zones are assigned deterministically in compiled road order.

### 5.1 Lane layout

- Let `W` be the sum of a road's lane widths. Lane `i` runs parallel to the centerline at
  lateral offset `lateralOffsetM - W/2 + sum(widths before i) + widths[i]/2`, positive to the
  right of travel. The right-hand normal of heading `(dx, dy)` is `(-dy, dx)`.
- Offsetting a polyline uses per-vertex miter joins with the miter length clamped to twice the
  offset; sharper vertices get a bevel. Good enough for a cartoon look. As merged (TASK-082,
  `src/network/corridor.ts`), network geometry no longer uses it: the roads of one corridor
  that share a source centerline share one reference line, resampled by curvature (points
  under 0.2 m apart dropped, spacing at most 1 m where the radius is under 30 m and 5 m
  elsewhere, endpoints exact). Every lane centerline, lane edge, road edge and taper is an
  offset of it by arc length, so station s of each lies on the reference normal at station s.
  Where the corridor's outermost offset exceeds the radius on the inside of a bend the
  reference line is eased into a fillet that keeps the offset (bounded; a `reference_eased`
  info when it leaves the source by over 5 cm). At a continuation joint (two roads meeting
  end to end, setback 0, turning at most 45 degrees) both reference lines take the bisector
  as their tangent at the node, the node point exact, and ease back to the source over 10 m or
  what a 30 m radius needs (at most half the road), so lanes and edges meet without a step.
  `CRoad.reference` and the stations of its lane vertices are kept; `CRoad.surface` keeps its
  left-edge/right-edge layout, checked as one clean ring with `clipper2-ts`, and
  `CRoad.corridorSurface` is the clipper union of the corridor's road surfaces (for TASK-083).
  Inside TASK-071/080 transitions lanes follow the lane block's own line.
- Default `lateralOffsetM` for a two-way street made of two roads with one shared geometry:
  `+W/2` of each road under right-hand traffic, `-W/2` under left-hand traffic, so the two lane
  blocks sit side by side. One-way and divided carriageways use 0.
- At each node, `radiusM = max over incident roads of (W/2 + |lateralOffsetM|) + 1.0`. Lanes
  are trimmed by `radiusM` at each end along their road. A road shorter than `2 * radiusM + 5`
  is trimmed proportionally to keep at least 5 m and gets warning `road_too_short`.
- `CRoad.surface` is the union outline of the lane block, for rendering only.
- TASK-061 (junction geometry): the single `radiusM` becomes a per-road-end setback. At a
  node with three or more road ends, or two ends that are not sections of one street, the
  setback of a road end is the distance along its centerline from the node to the farthest
  intersection of its lane-block edges with the lane-block edges of the two road ends
  adjacent to it in angular order, plus 1.0 m, with a floor of `W/2 + 1`; where adjacent
  edges do not intersect (nearly parallel ends, as at a ramp merge) the setback is the floor,
  and a setback is never more than `max(floor, 10 m, the widest neighbouring road end's half
  extent + 1)` (`SETBACK_CAP_M` = 10): at an acute approach the lane blocks overlap beyond
  the cap and the junction surface covers them, rather than holding cars ever farther from
  the junction on a movement that blocks every conflicting one for its whole length (lead
  decision at the TASK-061 review, after the Munich morning lost 40 percent of its completed
  trips to 50 to 115 m movements). The cap stays: with conflict zones (TASK-064) and timed
  reservations (TASK-065) the uncapped Munich morning still completes a quarter fewer trips,
  because uncapped setbacks cut acute approach lanes to stubs (4.8 m where 41.5 m stood) and
  remove their queue storage. Acute approaches are to be realigned instead (B31).
  A node with two ends of one street has setback 0: the road draws and drives through.
  Lanes are trimmed by their own road end's setback; `road_too_short` keeps its rule with the
  two setbacks in place of `2 * radiusM`. `CNode.radiusM` stays as the largest setback, for
  picking and the spatial index; `CNode.setbacks: number[]` (by incident road order) and
  `CNode.outline: Vec2[]` are added. The outline is the closed polygon of the road-end edges
  joined, between two adjacent road ends, by a curb arc: a circular arc tangent to both outer
  lane edges with radius `min(8 m, half the gap between them)`, sampled every meter.
  TASK-061 clarification approved by the owner on 2026-11-04: intersections use the
  road-end tangent edges; angles within 5 degrees of parallel use the floor. Opposing
  carriageways of a street form one angular arm. Through cuts share the offset miter at
  the seam. Fixed `0.4 * chord` movement curves can escape the curb boundary at unequal
  cuts or irregular imported nodes. Only at those nodes, extend the outline to the convex
  envelope of the curb outline and sampled movement surfaces; preserve setbacks and
  movement curves. Other junctions retain their curb arcs. T20 reports canonical imported
  road-body overlaps separately and requires zero remaining junction-end crossings;
  this task does not repair duplicate or coincident source carriageways.
- TASK-063 (junction surface, replaces the convex envelope above). Walking the road ends in
  angular order, the outline is: the trimmed end of one road end, then from its outer corner
  a curb fillet tangent to that road's outer edge and to the facing outer edge of the next
  road end, then the next trimmed end, and so on, closed. A fillet's radius is the largest
  value up to 8 m that keeps every movement surface between those two ends inside the
  outline (0.1 m tolerance); where no radius does, the join is the straight line between the
  two corners, extended outward along both edges to their intersection when a movement
  still escapes. No convex hull. An acute pair whose setback was capped (the two facing edges
  intersect beyond the trimmed ends) is a gore: between them the outline runs out along the
  first end's facing edge to the gore tip, where the facing edges meet, and back along the
  second's, so the surface covers the overlapping lane blocks and their markings. The result
  is a simple polygon whose boundary is smooth (tangent-continuous) from each road edge into
  the next except at gore tips. Once the cap is lifted a gore tip coincides with the trimmed
  corner and the rule reduces to the fillet.
- TASK-071 (lane continuity). A continuation node is an uncontrolled node whose movements are
  all through, merge or diverge, with every road end within 30 degrees of one axis: a road
  splitting into branches (5 lanes into 3 + 2), branches joining (3 + 2 into 5), a narrowing
  or a widening. Branches joining into fewer lanes than they bring (an on-ramp without a lane
  of its own) are not a continuation: the merge keeps its junction and a movement long enough
  for gap acceptance. At such a node lanes sit side by side across the node instead of each road
  being centred on the node:
  - The trunk (the one road on its side of the node) keeps its lanes. The branches on the
    other side are ordered left to right across the axis, and each takes the slice of the
    trunk's lane block that its lanes connect to through the movements; its end at the node
    gets the lateral offset that puts its lanes exactly where those trunk lanes end.
  - From that end offset the branch eases back to its own `lateralOffsetM` over
    `taperM = min(60 m, half the road)` with a smoothstep, so its lanes leave the trunk's
    line gradually. `CRoad.startOffsetM` and `CRoad.endOffsetM` carry the end offsets (0
    where nothing changes); lane polylines and `CRoad.surface` follow the varying offset.
  - Setbacks are 0 and the outline is empty at a continuation node; every movement there is
    a straight join of coincident lane ends, as at a through node, so the road reads as one
    continuous surface with no pinch.
  - A lane with no through continuation at a narrowing (a dropped lane) keeps its polyline
    and its simulation behaviour (vehicles change out before its end, section 8) but is drawn
    narrowing to zero width over the last `taperM` of its road; a lane added at a widening
    is drawn growing from zero over the first `taperM`. `CLane.taperStartM` and
    `CLane.taperEndM` (0 when none) carry the lengths.
- TASK-074 (junction shapes, refines TASK-063 for ordinary junctions). Measured first: per
  node, the area where two road surfaces of the node overlap outside the outline, outline
  self-intersections, movement surfaces escaping the outline, road-end edges off the
  outline, the largest tangent turn where a fillet meets a road edge, and corners sharper
  than 30 degrees that are not gore tips. The shape follows SUMO netconvert's node-shape
  computation: each road end's setback is where its curb lines meet the facing curb lines of
  its angular neighbours (plus the fillet's tangent length), not a single radius per node;
  with the 10 m cap kept, the part of a capped pair's overlap that the setbacks cannot
  remove is covered by the outline (the TASK-063 gore) rather than left as two road
  surfaces drawn over each other. Continuation nodes are unchanged. Acceptance and the
  measures are T27.
- TASK-078 (curbs, B32). The drawn curb is separate from the setback. For each concave corner
  between two angular neighbours at a node with an outline, a curb apron fills the corner with
  an arc tangent to the two roads' facing edges, radius by the lower-ranked road's class
  (service and residential 6 m, tertiary and secondary 9 m, primary, trunk and ramp 12 m),
  shrunk until its tangent points lie on those roads (within their first 40 percent) and the
  apron overlaps no other road's surface and no other apron. The apron is the region between
  the two edges and the arc outside both road surfaces; `CNode.curbs` carries the polygons
  (empty at continuation and through nodes), drawn in the junction colour with the node area.
  Setbacks, outlines, lanes, movements and the simulation are unchanged, so lane storage and
  every benchmark hash stay as they are. Gores (acute capped pairs) get no apron.
- TASK-083 (junction polygons, geometry rework stage 3; replaces the TASK-063/074 outline and
  the TASK-078 aprons at ordinary junctions, whose code is deleted; continuation and through
  nodes unchanged). Road ends in angular order form approaches: consecutive ends of one
  `corridorId` within 20 degrees approach together. Each end is cut square to its own
  reference line where its edges first meet a neighbouring approach's facing edge at a
  concave corner, plus the tangent of a 1 m radius, with the `W/2 + 1` floor and the 10 m cap
  (TASK-061's farthest crossing for acute neighbours whose edges never meet; shadowed ends as
  TASK-074). Through roads: an incoming and an outgoing end within 30 degrees of opposite and
  of the node's highest class keep their alignment; within 20 m of the node (at most half the
  road) both reference lines become one cubic across it, used only where it passes within
  2 m of the node, and their through movements follow it (5.2). `CNode.outline` is the
  `clipper2-ts` union of a fan over the cut corners, each through road's surface across the
  node, the corner pieces between neighbouring approaches (a curb arc of the lower-ranked
  road's class radius, 6, 9 or 12 m, tangent to both road edges and running along them
  beyond the cuts; a gore over a capped acute pair's overlap; a tangent arc at an outer
  corner beyond 180 degrees), S-curves tangent to both edges where two ends' edges run on into
  each other, a cap at a dead end, and every movement surface; curb circles are cut out so
  the boundary follows the arc. `CNode.curbs` is removed. The importer's realignment (13 step
  12) groups road ends by `corridorId`, so a street's carriageways are one arm there too.
- TASK-089 (split converging carriageways; owner decision: split the node geometrically,
  not the network). Where an incoming and an outgoing carriageway of one street meet a node
  within 45 degrees (60 for a crossing's arms), each gets its own end beside the node: its
  median-side edge a quarter metre off the node point, held over the junction mouth and eased
  away from the node (monotone, over the TASK-080 taper), and pushed apart no more than the pair
  actually overlaps. Lanes are laid out from the reference line plus the per-road shift profile
  `CRoad.startShift`/`endShift` (sampled every 0.5 m); cuts, curbs and the polygon follow the
  split ends; each direction's carriageways cross the node as a forced through pair; the median
  reaches the junction edge, and opposite carriageways side by side draw their touching edges as
  a solid double line. Movements, ids and routing are as imported. Divided pairs keep their
  median across a node (B43).
- TASK-092 (corners, B48, B51). Every corner between neighbouring arms gets a curb of at least
  its class radius (TASK-083's table), shrunk only where the arms leave less room and not below
  2 m without a named reason (T42.1); curbs are edge-following cubics that leave and meet the
  road edges along them (TASK-089), reaching at most half of each arm. A split pair's median
  ends in a half-circle nose at the junction edge. The audit's measure 10 (corner sharpness:
  a missing or degenerate curb, or a turn over 30 degrees between 0.5 m samples) checks it.
- TASK-093 (one street's carriageways, B49, B45, B47). A second OSM way of a carriageway (the
  importer pairs one partner per road) joins its pair's corridor after realignment, so
  realignment and relaxation are unchanged; TASK-089's jog rule measures the lanes that
  actually join; shallowly converging pairs stay attached to the node instead of opening a
  lens. Median voids between one corridor's carriageways running between the same two nodes
  close to the 0.5 m median where they are narrower than `ATTACH_GAP_M` = 15 m (TASK-095
  salvage, B54; 3 m before), eased where the source median widens past it; a pair opening at
  more than 20 degrees from where it ran together parts there. `MEDIAN_VOID_M` = 3 m remains
  only for the junction-mouth hold of shallowly converging pairs (`continuity.ts`). Where a road's lane
  count or directions change across a two-arm or through node (a one-way continuing as a
  two-way street), the road with fewer lanes shifts so its lanes continue the matching travel
  direction's lanes (within 0.1 m at the node), eased over the TASK-080 taper; a direction of a
  two-way street is never shifted, and a shift steeper than 1 in 4 is not applied.
- TASK-099 (attached carriageways, B54). After `separateDual`, `attachCarriageways` pulls one
  corridor's two carriageways together until their lane blocks meet at the 0.5 m median: the
  gap is measured between the blocks' median edges along rays, the pull is smoothed so it never
  undershoots and fades over 15 m from every chain end, and at a lane-count joint it follows
  the network's lane blend. Where a TASK-083 through alignment continues one carriageway, that
  one keeps its imported line for 20 m from the node and the other takes the whole pull. It
  applies only to the corridors named in `ATTACHED` (two in Munich). `convergingShifts`
  follows the actual shortfall where source lines already run attached, and an attached pair
  whose edges cross past the cuts ends its gore in a rounded nose (`junctions.ts`).
- TASK-101 retains access boundaries during import, which can split these chains differently.
  The two named attached corridors keep that treatment before dual separation is considered.
  Dual separation tests crowding against the shared arm axis. Converging shifts measure the
  width and offset of the chain segment reached, blending the narrow side of a lane-count
  joint over its existing taper. When both ends converge, each junction caps its demand at
  the gap minimum and retains that residual; the far junction supplies the remaining shift.
- TASK-080 (short transitions, B37). Every taper of TASK-071 (a branch easing to its own
  offset, a dropped lane narrowing, an added lane growing) takes
  `taperM = min(half the road, clamp(0.4 * speed limit in km/h, 15 m, 40 m))`: 20 m at
  50 km/h, 40 m at 100 km/h. B36: splits and merges outside the continuation rule (an angle
  over 30 degrees between a branch and the trunk axis while the lanes still run side by side,
  or an absorbing merge, which keeps its junction and movements) draw as lanes continuing side
  by side with dividers to the point where the branches separate, and an absorbing merge's
  outer edge as one smooth taper over `taperM`; a change to which nodes are continuation
  nodes is allowed only where every movement stays as compiled.

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
TASK-083: a through movement on a through road (5.1) follows the road's joined reference
line across the node, offset by the lanes' positions, instead of a Bezier.
TASK-061: a movement's curve runs from the trimmed end of the from-lane to the trimmed start
of the to-lane, so it spans both setbacks, with the lanes' tangents and control distance
`0.4 * chord`; a through movement whose ends are within 5 degrees and 0.5 m of lateral
offset is a straight segment. Stop lines and give-way markings sit at the trimmed lane end.
A merge is not a point join: `addRamp` lays a taper, a split of the receiving road `taperM =
60 m` past the join whose first section carries one extra curb-side lane that the ramp alone
feeds and that drops at the split (the lane-drop rules of section 8 then apply); `removeRamp`
removes the taper. The compiler invents no lanes: an imported merge gets a taper only where
the OSM `lanes` tags carry one.

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

- TASK-064 (conflict zones). Each conflict carries where it happens:
  `CMovement.conflictZones: [startM, endM][]`, parallel to `conflicts`, in meters along this
  movement. The zone is the stretch of this movement whose centerline is closer than
  `(own lane width + other lane width) / 2` to the other movement's centerline; for two
  movements ending in the same lane it runs from the first such point to `lengthM`. Zones are
  computed from the sampled polylines (about one meter apart) and rounded outward to the
  sample spacing, so they never under-cover a contact.

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

TASK-069: a third severity, `info`, for facts that need no action. `Diagnostic.severity`
is `'error' | 'warning' | 'info'`. The validation badge counts errors and warnings only; the
panel lists infos last, under "Notes". `lane_requires_merge` is an info: an ordinary lane
drop, such as a two-lane street narrowing to one, is how roads are built. So is
`realign_limited` (13 step 12): it reports what the importer did, nothing to act on. So is
`reference_eased` (TASK-082, 5.1): a reference line eased more than 5 cm from its source.

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
`lane_requires_merge` (a lane whose only continuation into a narrower road is the clamped
fallback movement; the router does not use it, so a car there must merge upstream),
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
  | { kind: 'setCrossing'; roadId: RoadId; end: 'start' | 'end'; crossing: boolean | null } // TASK-091; null = default
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
- The run loaded in the engine is tied to a `city.version`. After a commit the UI sends the
  new compiled city to the engine as a patch (section 8, live edits; section 10, `patch`)
  and the run goes on. It marks the run stale and offers restart only when the commit changed
  demand (place kind, population, jobs, places added or removed), trip scheduling (a place's
  profile, events or attraction; restart reschedules the same population) or the patch was
  refused (T17 as amended by TASK-051).
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
  purpose?: 'private' | 'delivery' | 'service' | 'taxi' | 'through';
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
   TASK-076 (replaces the choice per lane): among a lane's movements into `enterable[i]`, the
   chosen one is the movement whose landing lane needs the fewest lane changes to reach
   `feasible[i]` (on the last road, the connector lane), then the lowest penalty, then the
   lowest movement idx. In the forward pass, the reachable lanes of the entry lane are tried
   in order of fewest changes, then left before right, so a route never plans a change it can
   avoid (a lane that feeds two lanes of a short ramp lands in the one that serves the next
   road).
3. Origin check: the vehicle's lane must reach `feasible[0]` starting at `fromPosM` with
   budget `lengthM` of its lane.
4. Fallback when 2 or 3 fail: Dijkstra over lanes, edges = movements (same costs) plus lane
   changes to adjacent lanes costing 3 s each; `k` successive changes on one lane need
   `k * laneChangeDistanceM` of that lane (from the current position on the origin lane). The
   result keeps its selected roads, movements and cost, then resolves feasible target sets
   on that road chain. If that fails too:
   `lane_infeasible`.
5. `targetLanes[i]` is `feasible[i]`, with the selected movement's departure lane first;
   the destination road always targets only the connector lane. Mandatory changes are needed
   only outside the set; MOBIL may use any feasible lane without adding a required change.
   TASK-116 generalises TASK-101's restricted-route fix: both routing searches return the
   sets directly, preserving the chosen roads, movements, cost and failures. The engine no
   longer widens targets in a class-dependent wrapper. Reroutes and live patches carry the
   ordered sets, including through lane-index remapping; dropped-lane recovery stays exact.
   `desiredSpeedFactor` is carried in the request for congestion-aware costs (Gate 3) and
   unused in Gate 1. A `toConnector` with direction `out` yields `destination_unreachable`.

`laneChangeDistanceM` is a simulation parameter (default 30 m) shared with the sim through
`SimParams`. Congestion-aware costs (Gate 3) replace `roadTravelTimeS` with EWMA observed
travel times and add bounded, hysteretic rerouting; the provider contract does not change.

TASK-101 removes `no` roads from the class graph, including its origin and destination
checks. Each request filters road-search and lane-search edges: destination/private roads
are allowed only in the origin road's or destination connector road's zone; delivery roads
require `purpose: 'delivery'`. The same checks apply to endpoints. A topologically possible
route that requires violating access returns `class_forbidden`, including when lane
feasibility forces a restricted detour. No successful fallback relaxes access. A vehicle
already in a local zone can route out of it through that origin zone.
Live patches compare effective access and zone arrays. A remaining route crossing an
access-changed road is checked immediately as invalid, bypassing congestion hysteresis;
otherwise an edit could retain a faster but forbidden route.
Missed-turn fallback candidates use that same access filter with the vehicle's actual
current lane and destination before entry; testing recovery from the candidate road alone
would incorrectly grant origin-zone permission before the car entered it.

There is no route-result cache. Graphs are cached by compiled identity/version and class;
lane edges by graph identity and the provider's lane-change distance. Those caches contain
only request-independent edges. Origin/destination zones and purpose are evaluated on each
request after cache lookup, so local and delivery permissions cannot leak between requests.

## 8. Simulation

Lives in `src/sim`. Fixed step `dtS = 0.1`. All randomness from the seeded generator in
`src/geo/random.ts` (mulberry32 or xoshiro128**, with uniform and normal sampling; shared by
sim, demand and routing); all iteration in index order.

```ts
interface SimParams {
  dtS: 0.1;
  vehicleClasses: Record<VehicleClass, {
    lengthM: number; widthM: number; maxSpeedMps: number; accelFactor: number; decelFactor: number
  }>;
  idm: { aMps2: 1.5; bMps2: 2.0; headwayS: 1.2; minGapM: 2.0; desiredSpeedSd: 0.08 };
  mobil: { politeness: 0.3; thresholdMps2: 0.2; safeDecelMps2: 3.0 };
  laneChangeDistanceM: 30;
  laneChangeDurationS: 2;
  mandatoryUrgencyM: 10;         // extra margin before a required change becomes forced
  cooperativeYieldS: 3;          // TASK-076: held this long, a car gets a gap from behind
  missedTurnAfterS: 30;          // TASK-076: held this long, it gives the change up
  intersection: { decisionDistanceM: 15; gapS: 4; creepSpeedMps: 1.0;
                  zoneMarginS: 1.0; boxWaitS: 10 };   // TASK-065, B27 and B28
  spawnMinGapM: 8;
  gridlock: { respawnS: 180; fadeS: 5; maxRespawns: 3 };   // TASK-077
  linkCostAlpha: 0.3;
  linkCostIntervalS: 60;
  rerouteIntervalS: 120;
  rerouteHysteresis: 0.15;
  maxReplans: 3;
  routeNoise: 0.1;
}

type VehicleState = 'queued_origin' | 'driving' | 'queued_destination' | 'completed' | 'failed';
type FailReason = 'no_route' | 'unsupported_mode' | 'destination_unreachable' | 'stranded'
  | 'no_origin_connector' | 'no_destination_connector'
  | 'gridlocked';                                     // TASK-077, after maxRespawns

interface TrafficEngine {
  load(input: { compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario; params?: Partial<SimParams> }): void;
  patch(compiled: CompiledCity): PatchResult;   // TASK-051, live edits below
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
  vclass: Uint8Array;                                 // car 0, van 1, truck 2, bus 3
  fade: Float32Array;                                 // TASK-077: 1, or falling to 0 before a respawn
}

interface PatchResult {
  version: number;        // compiled.version now loaded
  relocated: number;      // vehicles moved by projection (see live edits)
  stranded: number;       // vehicles that failed because their segment disappeared
  rerouted: number;       // vehicles scheduled for an `edit` route check
}

interface Metrics {
  timeS: number;
  trips: { pending: number; queuedOrigin: number; driving: number; queuedDestination: number;
           completed: number; failed: number };       // sum equals trips loaded (T01)
  failedByReason: Record<FailReason, number>;
  completedByClass: Record<VehicleClass, number>;
  meanTravelTimeS: number; meanDelayS: number;        // delay = travel - free-flow estimate
  roadSpeedRatio: Float32Array;                       // mean speed / limit per compiled road, for heat
  stepsPerSecond: number;                             // measured by the host, 0 headless
  respawns: number;                                   // TASK-077, over all trips
}

interface VehicleDetail {
  id: number; tripId: string; personId: string | null;
  vehicleClass: VehicleClass; purpose: VehiclePurpose;
  originPlace: PlaceId; destinationPlace: PlaceId; state: VehicleState;
  lane: number; positionM: number; speedMps: number;
  route: Route | null;
  routeReason: 'initial' | 'missed_turn' | 'congestion' | 'edit' | 'respawn';   // TASK-077
  waitingS: number; departedS: number | null; arrivedS: number | null;
  failReason: FailReason | null;
  respawns: number;                                   // TASK-077
}
```

TASK-100 stores class and purpose as dense `Uint8Array` indices. Class profiles default to:

| Class | Length m | Width m | Maximum km/h | Acceleration factor | Deceleration factor |
| --- | --- | --- | --- | --- | --- |
| car | 4.5 | 1.8 | unlimited | 1 | 1 |
| van | 5.5 | 2 | 120 | 0.85 | 0.95 |
| truck | 12 | 2.5 | 80 | 0.5 | 0.8 |
| bus | 12 | 2.55 | 80 | 0.6 | 0.8 |

Factors multiply IDM acceleration and comfortable deceleration. Desired speed is the road
limit times the trip's existing speed factor, capped by its class maximum. Following gaps
subtract the leader's length; rear clearance and follower space use the occupying vehicle's
own length. Spawn, MOBIL, merges, junction boxes, zone forecasts and committed exit clamps
use these same profiles. Lane permissions and patch projection use the trip's class;
rerouting also carries its purpose for TASK-101. Respawn preserves both indices. Old saved
`vehicleLengthM` is ignored. An unlimited maximum is `Infinity` internally and `null` in JSON;
the boundary schema restores it. T46 pins grid/town cars-only outcomes, travel times and
state hashes, and compares explicit all-car trips with legacy trips on the same tree.
TASK-116 re-pins these outcomes because feasible target sets let cars pass queues.

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
     the lane end (TASK-072: at the lane's `stopM`, see below); an arrival connector is a
     standing obstacle at its position when the place cannot accept the vehicle.
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
     no vehicle holds a grant on or drives on a conflicting movement (TASK-064: no vehicle
     holds a grant on a conflicting movement while still on its approach lane, or drives on
     it with its rear not yet past the end of that movement's conflict zone with the
     candidate's movement, `position < endM + occupant.lengthM`; a vehicle that has cleared the
     zone no longer blocks), the last vehicle on the
     exit lane is at least `candidate.lengthM + minGapM` along it (downstream blocking), and for
     yield and stop nodes every vehicle approaching on a conflicting higher-priority movement
     is at least `gapS` away (TASK-064: measured to the start of its conflict zone with the
     candidate, the rest of its lane plus `startM`, not to its stop line). Stop nodes require a minor-approach vehicle to stand at the
     stop line continuously for at least one second before requesting entry. Waiting behind
     another car away from the line does not count. Several vehicles may hold grants on the same movement (movements
     from one lane never conflict); car-following keeps their spacing. A grant persists until
     the vehicle leaves the movement, except that a signal change revokes grants of vehicles
     still on the approach whose movement can no longer be entered.
   - TASK-065, zone reservations by time (B27). A vehicle holding a grant, on its approach
     or on its movement and before a zone's end, no longer blocks a candidate outright. Both
     occupancy windows are forecast from current speed with the car's current IDM
     acceleration, the approach and the movement each at their own speed limit: the holder's
     from reaching `startM` to its rear passing `endM`, the candidate's likewise for its own
     zone. The candidate is refused when the two windows, each widened by `zoneMarginS`,
     overlap; it may go before a distant holder or after one that will have cleared. A
     vehicle whose rear is past the zone end never blocks, as before. (As merged: expected
     arrival rather than the earliest possible one, which the backstop below makes safe;
     T21 sampling found no overlap.) Safety backstop: a vehicle on a movement
     treats the start of a conflict zone as a standing obstacle while another vehicle is
     inside that zone (front past `startM`, rear not past `endM`), and the commit clamps it
     there like an ungranted stop line; the run counts such hard zone stops in `Metrics`
     (`zoneStops`), which T22 expects to be rare, not zero.
   - TASK-065, keep the box clear (B28). A candidate whose exit lane does not have room for
     its whole length past the movement (the rear of the exit lane's last vehicle, projected
     forward by that vehicle's speed over the candidate's time to cross, at least
     `candidate.lengthM + minGapM` along the lane) is not granted, so it waits at the stop line
     rather than in the junction. After `boxWaitS` of waiting at the line it falls back to
     the older rule (the last vehicle's front at least `candidate.lengthM + minGapM` along), so a
     jammed junction still drains.
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

Stop positions (TASK-072, TASK-094). `CLane.stopM` is where an ungranted vehicle stops. On a
signalized approach with a served movement and a crossing, `stopM` is the crossing's far edge
minus 0.5 m (`crossingSpan` in `src/network/crossings.ts`, shared with the renderer), so a
waiting car's front stays 0.5 m short of the stripes; where that would fall in the lane's
first half, or the crossing is turned off, the end draws no crossing and `stopM` is
`lengthM - 3.0` (TASK-072's 2.5 m crossing and 0.5 m clearance). Elsewhere `stopM` is
`lengthM`; a lane shorter than 10 m gets no crossing. TASK-091's decorative crossings at other
junctions do not change `stopM`. A car that passed the stop line on a grant and loses it at
red stands where it is (the grant-release rule is unchanged). Every rule that treats the lane end as the stop line for an ungranted vehicle uses
`stopM` instead: the standing obstacle, the commit clamp, the stop sign's one second at the
line, the entry request distance, junction waiting time, and the distance a yield or stop
gap is measured over. A granted vehicle drives on to `lengthM` and onto its movement as
before; conflict zones, grants and movements are unchanged.

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

Mandatory changes (TASK-076). A car that needs a mandatory change and has stood (speed below
0.1 m/s) at its stop position, or crept there, for `cooperativeYieldS` becomes a requester.
In proposal order, each requester picks one yielder: the nearest driving vehicle behind its
position on the target lane, within `laneChangeDistanceM`, that holds no grant and is not
itself a requester or a yielder, and that can stop behind the requester's projected rear
(its position on the target lane) at no more than `bMps2`. The yielder treats that projected
rear as its leader (a virtual leader, `minGapM` behind it) until the requester changes lane,
gives up, or the yielder would have to brake harder than `bMps2`; the ordinary safe-gap
check then accepts the change. A requester that has been held for `missedTurnAfterS` gives
the change up: it takes the TASK-048 fallback from its current lane (the cheapest legal
movement whose landing lane routes to its destination), which now also applies when the
route still needs another lane on this road and to a required diverge, and reroutes with
`missed_turn`. With no such movement it keeps waiting, and gridlock recovery below applies.
TASK-076, second round (lead, after the first round's Munich trace): a discretionary (MOBIL)
change is never proposed to a lane from which the car needs more changes to reach its route's
target lanes than from its current lane, on any road of the route, not only the last (on
Munich `r:639` cars landed on the one lane that serves their next road and then changed off
it by MOBIL). A lane is dropped before a narrower next road (`isLaneDrop` in the compiler,
`laneSurvives` in the simulation, one shared rule) only by its ordinal among the lanes of its
road that have a through, merge or diverge movement into that next road, counted from the
side the section 8 ramp rule names, against the next road's lane count; lanes that only turn
elsewhere do not count (on `r:968` a through lane beside two turn lanes was treated as
dropped and its cars held for a change they did not need).

Gridlock recovery (TASK-077, owner-approved exception to section 1 row 10). A driving
vehicle is a jam head while it is on a movement, or first on its lane, and not standing at a
red signal for its own movement. Its jam time grows by `dtS` each step it is a jam head with
speed below 0.1 m/s and resets to 0 when it moves or stops being a jam head. TASK-077 as
merged (lead, after the agent's Munich measurements): a red for its own movement neither
starts nor stops the timer. A car that arrives at red waits without a timer; a head that
stood through green with its exit full keeps counting through the red that follows, so a
ring of queues through signals (Munich `n:262`, `n:963`, `n:967`) unlocks like any other. From
`respawnS - fadeS` its snapshot `fade` falls linearly from 1 to 0 (1 again if it moves). At
`respawnS` the commit removes it, in id order: its grants and zone occupancy are released, it
leaves its lane or movement, and its trip returns to `queued_origin` at its origin connector,
ahead of trips with later departure times, keeping its first `departedS` so travel time and
delay include the stall. At release it gets a fresh route with `routeReason: 'respawn'`.
`VehicleDetail.respawns` and `Metrics.respawns` count respawns; the respawn after
`maxRespawns` fails the trip as `gridlocked` instead. Respawns are deterministic (T02) and
keep T01's sums.

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

Live edits (TASK-051). `patch(compiled)` replaces the engine's compiled city between two
steps without touching the clock, the trip list, the seed or the random state, and returns
`PatchResult` for the UI. Everything the engine indexes by compiled index is remapped by id:
lanes by lane id, movements by movement id, roads (link costs, EWMA state, route cursors) by
road id, connectors by connector id, signals by node id. Order of the patch:

1. Costs: a surviving road keeps its EWMA travel time; a new road starts at free flow; the
   cost version bumps so the routing caches rebuild for the new city.
2. Vehicles, in id order. A vehicle whose lane or movement id survives keeps its position
   (clamped to the new length) and speed. A vehicle whose segment id is gone is projected
   from its world point onto the new city's lanes and movements (`laneSpatial`, nearest
   polyline with a heading within 30 degrees, within 4 m): the lane that now occupies the
   place where the car physically stands is the one it drove to, which is how a split, a
   merge, a moved node or a lane count change keeps the car. The projection counts as an
   instantaneous lane change: followers brake for it as for a cut-in. A vehicle with no
   lane or movement within tolerance (its road was deleted) fails as `stranded`.
3. Grants: every intersection grant at a node whose movement set changed is released; a
   vehicle already on a surviving movement keeps it. A patched signal restarts its program
   from the current time, so a phase edit shows at once.
4. Routes: a route is remapped by ids. A vehicle whose remaining route (from its cursor) has
   a missing road, movement or target lane, or that was relocated, reroutes with reason
   `edit`: at once when the break is on its current road or its next movement, otherwise at
   its next due check, which the patch spreads over `rerouteIntervalS` by id. A vehicle whose
   remaining route touches a changed road (a surviving road whose lanes, speed limit or
   movements at either end changed) gets the same staggered check with the normal
   hysteresis; `edit` checks do not count against `maxReplans`. A vehicle whose route touches
   nothing that changed is not checked.
5. Queued and pending trips keep their place ids; connectors are resolved at release as
   before, so a place that lost its connectors fails its trips at release with the existing
   reasons.

A patch is deterministic: the same patches at the same steps give the same state hash (T19).
The engine never applies a patch mid-step; the host handles the request between loop ticks
and pauses nothing. `restart` after a patch reloads the latest patched compiled city with the
original trips and seed.

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
  destinationPlaceId: PlaceId; departS: number; mode: TripMode; legs: Leg[];
  vehicleClass: VehicleClass; purpose: VehiclePurpose }
type VehiclePurpose = 'private' | 'delivery' | 'service' | 'taxi' | 'through';

interface DemandConfig {
  seed: number;
  personsPerResident: number;     // sampling, 1 = everyone, 0.2 = one in five
  carShare: number;               // 0..1
  workStart: { meanS: number; sdS: number };       // default 08:00, 30 min
  workDuration: { meanS: number; sdS: number };    // default 9 h, 1 h
  gravityScaleM: number;          // home-work distance decay, default 5000
  throughTripsPerHour: number[];  // 24 values, gateway to gateway (Gate 3)
  classShares?: { local: Record<VehicleClass, number>; through: Record<VehicleClass, number> };
  chains?: { schoolShare?: number; shopShare?: number; leisureShare?: number }; // 0..1, omitted = 0
}

interface Scenario { id: string; name: string; seed: number; startS: number; endS: number;
  demand: DemandConfig; simParams: Partial<SimParams> }   // SimParams type lives in src/schema/sim.ts; defaults in src/sim/params.ts

function generatePopulation(city: City, config: DemandConfig): Person[];
function scheduleTrips(city: City, persons: Person[], scenario: Scenario): TripRequest[];  // sorted by departS
```

TASK-100 assigns class after mode choice, using a separate demand-seeded stream keyed by
trip id, leaving every existing agenda, mode and timing draw unchanged. Omitted shares resolve
to local car 0.92 / van 0.08 and through car 0.80 / van 0.08 / truck 0.12; buses default to
zero. Local vans split delivery/service equally by a seeded draw; other local trips are
private and through trips retain purpose through. Unsupported modes keep car/private metadata
and still fail as unsupported. Saved trips missing labels parse as car/private, or through
for established `through:` trip IDs. Summary counts include each class; the demand panel also
shows completed trips per class. Buses have no stops, routes or transit operations.

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
  resident sampling and car share; visitors and through trips use road vehicles drawn from their
  respective class shares. No transit is simulated.
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
  | { id: number; type: 'patch'; compiled: CompiledCity }        // TASK-051: live edit, replies PatchResult
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
- TASK-100: the class-index `vclass` buffer transfers with every vehicle snapshot. Inspector
  replies carry class and purpose, headless metrics preserve `completedByClass`, and trip CSV
  records include `class` and `purpose` columns after destination.
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
- TASK-051: `patch` carries the compiled city in the same wire form as `load`. The worker
  applies it between ticks whether playing or paused, stores it as the input `restart`
  reloads, resets the heat throttle and the recorder's road statistics mapping, and replies
  with the engine's `PatchResult`. A comparison worker in flight is terminated by the UI as
  for any edit. `metricsSeries` continues across a patch.
  The host reply additionally carries `timeS`, the simulation time at which the patch was
  applied. The UI uses that exact epoch for patched signal previews; restart restores the
  canonical program offsets. The engine's `PatchResult` remains unchanged.

## 11. Rendering and UI

`src/render` draws a `CompiledCity` and the latest `VehicleSnapshot` with PixiJS 8:

- TASK-108: `render/marking-geometry.ts` owns world-metre paint shapes (role-coloured
  polylines with widths and dash metadata, and filled polygons). Road clipping, dash phase,
  approach controls and arrows, continuation seams/tapers, junction guides and crossing
  polygons moved out of the 2D layers; 2D and 3D consume the same shapes. Dash footprints
  are expanded before either renderer draws them. `render/style.ts` selects the `de`
  marking theme: warm white in every role, 0.12 m urban and 0.15 m motorway/trunk lane
  lines, 0.30 m broad edge/channel lines, 3/6 m and 6/12 m lane dash/gap patterns, and
  1.5/1.5 m junction guides. Theme polygons supply straight, left, right, combined and
  diagonal lane-ending arrows; approach glyphs are 5 m long, 7.5 m at 70 km/h and above.
  Existing lane/turn eligibility and stop-relative placement rules remain. Longer glyphs
  clamp behind crossings; their tails clip at the start of a very short approach.
  Ramp gores use existing corner pieces and actual facing lane edges, excluding full
  lane and movement footprints. Owner-authorized renderer-only pavement fills the neutral
  gap at continuation splits/merges that have no compiled junction surface; both views
  share it, and it changes no compiled surface, lane or movement. Raised-nose
  fillets are excluded. Channel borders and 0.5 m chevron bands (2 m urban, 4 m highway
  spacing) are clipped as filled footprints, with apexes against traffic. Taper paint is
  limited to the taper's station range and excludes centrelines, replacing TASK-071's
  two taper chevrons; lanes tapering at both ends retain both painted tapers. The 3D adapter triangulates
  paint with per-role vertex colours. Added gore pavement and paint interpolate the two
  branch-edge heights together on one tessellated surface; paint is clipped to those
  triangles and uses their interpolation, retaining its 0.025 m clearance on ramps.
  Flat paint strips need no height subdivision. Movement paths remain beneath junction
  fills in both views; approach arrows remain above.
  The adapter samples road/node elevations only through
  `render3d/heights.ts`; no compiled geometry or network behaviour changes.
- TASK-100: one generated texture atlas contains class shapes: rounded car, short-bonnet van,
  cab-and-box truck and long rounded bus. Street zoom uses each class's length and width;
  overview uses compact dots. Optional Layers setting "Colour vehicles by class" defaults
  off; it uses a muted four-colour palette in both views and leaves destination colouring
  as the default. 3D instances use class footprints and heights 1.5/2.2/3.5/3.2 m in class
  index order. Class-sized selection and existing picking work for all four. The inspector
  shows class and purpose under the vehicle heading. Presentation changes never alter physics.

- TASK-096: optional Surroundings draws above tiles and below every grade group. Muted
  land use, water, green, parking and building fills (courtyard holes, hairline building edges)
  and rail/tram/waterway lines are static and never pickable. Rail cross ties appear at detail
  zoom. Surroundings sits first in the lowest grade's terrain, under every road surface.
  Overview shares that terrain's power-of-two texture cache and 2048 px cap, avoiding an
  extra map-sized textured quad. Geometry builds once per setCity; visibility toggles refresh
  the shared texture without rebuilding geometry. LayerVisibility.context
  defaults true; the Layers control appears only for cities with context. Tiles and context
  can both be visible. The canvas contextFeatures dataset reports the visible feature count.
- Layers, bottom to top: tile backdrop (Gate 2, optional), surroundings, road surfaces, lane markings and
  movement arrows (legal movements only), node areas, places and connectors, signal heads
  colored by current state, vehicles (ParticleContainer, rounded rectangles colored by state,
  dots below a zoom threshold), selection and route overlays, road heat coloring.
- Camera: pan and zoom at the pointer, world units meters, y-south so no flip is needed.
- Picking: `laneSpatial` for roads and lanes, nearest snapshot vehicle within a pixel radius,
  place polygons by point-in-polygon.
- Static geometry is rebuilt only when `compiled.version` changes.
- TASK-061: node areas draw `CNode.outline` (road-end edges and curb arcs) instead of the
  polygon through the lane-edge corners plus a disc; through nodes (setback 0) draw nothing,
  the road runs through. Movement surfaces, stop lines, give-way triangles, arrows and
  crossings follow the compiled geometry, so they move with the setbacks.
- TASK-063: the order along an approach is stop line at the trimmed lane end (where an
  ungranted car stops, `minGapM` behind it), then the pedestrian crossing, then the junction.
  The crossing is drawn in the junction mouth: 0.5 to 3.0 m past the trimmed end across the
  road end's full width, inside the outline, or omitted where the setback leaves less than
  3.5 m. Node areas draw above lane markings, so markings inside a gore are covered.
- TASK-072 (replaces the crossing placement above): the crossing is on the road, not in the
  junction. The stop line is at `stopM`; the crossing spans `stopM + 0.25` to `lengthM - 0.25`
  across the road's full width; the junction surface begins at the lane end. The crossing on
  the exit side of a signalized junction lies on the exit road's first 0.25 to 2.75 m. Same
  serving rule as before (a signalized approach with a served movement).
- TASK-091 (B50, B52; replaces the serving rule above). Crossings are decorative: no simulation
  effect, `stopM` keeps TASK-072's rule. Arms: a node's road ends, where ends within 20 degrees of
  each other that share a corridor or run in opposite directions form one arm. Default: a road end at a node of three or more arms, or at a
  signalized node, has a crossing unless the road is a motorway or a ramp (the importer's
  `_link` class, which also covers slip lanes), every arm of the node is one (a motorway merge or
  diverge), or the road belongs to a roundabout ring (a closed chain of one-way roads, each
  continuing into the next within 30 degrees). `Road.crossings` overrides the default per road
  end; only explicit edits are stored, a value equal to the default clears the entry, and old
  files load unchanged. Place (TASK-094 for signalized approaches): the near edge lies 1 m beyond
  the farthest point where a curb return of the node meets a road edge of the arm, measured
  along each road, and no stripe comes within 1 m of a curb return. At a signalized approach
  that can get green the crossing stays there (no move-out), keeping the stop line close to the
  junction; signal heads are drawn just behind the stop line. Elsewhere TASK-089's move-out (up to
  6 m, all stripes together) clears the node's and the road's far node's outline; lanes shorter
  than the near edge plus 9.75 m carry no stripes. Dividers and centre lines end, and turn
  arrows stay, 0.5 m behind a crossing (on a signalized approach the stop position, before the
  crossing, still ends them).
  The node inspector lists the arms with a "Crossing" checkbox each (disabled, with the reason,
  where no stripe fits).
- TASK-091 (B46): a centre line (a two-way street's, or the solid median edge of TASK-089) ends
  at the junction mouth: it is clipped out of both its nodes' outlines, also where an outline
  reaches back over the approach (TASK-079's stretch drawn above the junction now applies to
  dividers only); a piece shorter than a dash (2.7 m) is not drawn.
- TASK-071: at a continuation node no stop line, crossing or junction surface is drawn; lane
  dividers continue through it, the dividers beside a tapering lane converge or diverge with
  it, and a dropped lane carries two merge chevrons inside its taper.
- TASK-074: a road's lane markings stop where its surface enters another road's surface or
  its node's outline, so no divider is drawn on a neighbouring road.
- TASK-075 (junction guide markings). At a node that is not signalized, has an outline, and
  has a major road (two opposing groups of through movements whose priority is higher than
  every other movement's, or one through group on a one-way major road), dashed guide lines
  cross the junction along the major road, drawn above node areas: the dividers between
  adjacent through movements of one direction (midway between their paths), the centre line
  between the two directions (midway between the innermost through movements, where they are
  within 30 degrees of each other), and the edge line across a side road's mouth (along the
  outer edge of the outermost through movement). Short dashes (1.5 m, gap 1.5 m), the
  divider width. A node without a major road (all-way stop, equal-priority crossing) and a
  signalized node get none; turns get none.
- TASK-077: a car's sprite alpha is the snapshot's `fade`.
- TASK-079 (markings at the junction, B33 to B35). Dividers and centre lines run up to the
  lane's `stopM` on every approach (the TASK-074 clip removes only what lies inside another
  road's surface beyond the stop line, never a stretch of the road's own approach). Turn
  arrows are drawn once per lane, centred 6 to 9 m before `stopM`, only on approaches where
  the lanes of the road differ in the turns they allow, never at a node whose only other
  movements are u-turns or service-road turns, and never on a lane shorter than 12 m. Every
  marking keeps its offset through curves: a marking is built from the road centerline at
  its offset with arc-length resampling (at most 1 m spacing, joins by angle bisector), so
  its distance to the lane polyline stays within 0.05 m except at tapers.
  As merged: markings use `parallelOffset` (`src/geo/polyline.ts`) with mitred joins on both
  sides, so the two directions' centre lines coincide, rather than 1 m resampling; the stretch
  of an approach under its own node outline (82 Munich lanes, where the outline reaches back
  over the lane) is drawn above the junction surface with its arrows and stop line; and no
  arrow is drawn where it would lie on a road running the other way (coincident one-way
  carriageways from the importer, such as Marsstraße `r:368`/`r:480`, the owner's X marks).
  The TASK-074 marking-length measure counts dividers and centre lines only (`lineOutsideM`),
  since arrows are now drawn on far fewer lanes.
- TASK-063: roads and junction surfaces share one asphalt colour by default. A Layers entry
  "Road classes" (off by default) turns on the per-class tones of `roadStyle`; then a
  junction takes the tone of its incident road with the highest `classRank`. Presentation
  only, like every Layers entry.
- `Scene.setCity(compiled, city)` also takes the canonical `City`, because place shapes and
  road and node layers are not in the compiled model. Grade groups draw from lowest to
  highest, with roads in compiled index order inside each grade.
  TASK-097 (owner revision): the default-on "Shadows" layer affects non-ground streets only.
  Raised grades use 5 m per grade and cast a south-east shadow at 0.6 m per metre above the
  next lower grade. Three unioned fills (16%, 7%, 4%, the latter two offset another 0.75 m
  and 1.5 m) soften the edge without a blur filter or dark seams between surfaces. At a
  ground endpoint the whole offset, including the penumbra, tapers to zero over the
  final 20 m from the road's surface cut. Raised shadow graphics sit first in their terrain;
  0.35 m parapets sit above it, clipped away from junction mouths and same-grade surfaces.
  Negative-grade terrain uses 55% opacity and 3 m dashed edges with 3 m gaps. Static effects
  share the terrain's overview cache. Lower streets receive an inset shadow on their own
  north-west edge: their surface minus its south-east-shifted copy, using 5 m depth per
  negative grade and the same penumbra and portal taper. These shadows draw above the
  lower surfaces, clipped inside them. Ground streets cast no shadows. A spatial index
  limits 35% signal ghosts to covered heads above all decks. Heads share original graphics
  contexts and live tints; vehicle ghosts share
  whole animated particle arrays unmasked to avoid per-car coverage work. The Signals toggle
  also hides signal ghosts. Disabling Shadows removes the added graphics and ghosts and
  restores tunnel opacity, preserving the original rendering and picking.
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

The optional viewer-only **3D view** (`src/render3d`, TASK-098) dynamically loads
three.js and MapControls into a separate chunk. It reads the same compiled city and running
snapshot as 2D; editing remains in 2D. Shared grade resolution and vehicle poses live in
`src/render/grades.ts` and `vehicle-pose.ts`. Grade g is 5g metres above the flat ground;
`heightAt` interpolates the full compiled surface's station span with a monotone cubic
Hermite profile, retaining smoothstep easing where the endpoint slopes are zero.
Node heights remain fixed; at a simple, uncontrolled one-to-one road
continuation, a PCHIP weighted harmonic tangent matches the adjoining slopes. Junctions,
branches, flats and reversals retain level endpoints. A road grade above or below both end
heights retains its level bridge/tunnel core and end transitions capped at 60 m. For
approaches, this inferred geometry replaces the original 60 m/half-road easing and its
premature flat plateaus; no surveyed elevations are claimed.
Surfaces, marking strips, signal poles and pitched instances share this
height rule; movements use their node's height and retain the through slope where applicable.
Raised decks have 0.8 m slabs and piers every 30 m. The 3D camera starts at the 2D centre and
hands its ground target and scale back on
return; the hidden Pixi ticker stops while 3D is active. Vehicle raycasting opens the existing
inspector, with the same eight-pixel picking tolerance as 2D; playback stays live and a
ground-opacity toggle reveals tunnels. Pedestrian stripes reuse the 2D crossing polygons.
Signal heads face the approaching lane and hang at 5.5 m from 6 m curbside cantilevers.
A ground-mesh adapter reuses the 2D tile loader, projection, cache, retry and URL settings;
the Basemap layer also works in 3D and follows the ground-opacity toggle. Surface normals
are shared across ramp triangles for smooth lighting. Phase B reads `City.context`:
flat-roof buildings use `heightM`, else `levels * 3 m`, else 10 m, with courtyard holes
and inner walls. Extrusions share one coloured mesh; ground areas and rail/tram/waterway
strips share another, using the 2D palette and line widths. Ground context sits at -0.025 m,
above tiles and below places/roads; overlapping areas draw in the 2D category order without
writing depth against one another. Flat context stays in the transparent render queue even at
full opacity so it draws after basemap tiles. The existing Surroundings layer controls both meshes;
Buildings (default on, in 3D) independently hides extrusions. Toggles do not rebuild geometry.
Flat context follows the below-ground opacity, while buildings retain their shadows.
The shadow normal offset scales with one world-space shadow texel (minimum 0.05 m) to keep
broad roofs free of self-shadow stripes.
TASK-106: `src/render/vegetation.ts` is the shared pure placement module. Seeded per-source
streams produce OSM node/row trees, street trees and Poisson-disc woodland/scrub/park fills.
Tree rows use 8 m or tagged spacing. Eligible residential/tertiary/secondary/primary road
edges get trees 2.5 m outside the compiled surface, every 12 m with ±2 m station jitter;
inward sides of a corridor pair are omitted. Full canopy circles exclude road surfaces,
junction outlines and 15 m node buffers, crossing stripes, connector buffers (carriageway
width + 4 m), buildings, water areas/lines, rail/tram strips, parking, pitches and playgrounds.
Street trees additionally keep 8 m from imported node/row trees. Forest/wood, scrub and park
sampling targets one tree per 40, 60 and 300 m², respectively, with minimum separation
0.7 times the square root of that area per tree. Holes and canopy margins are preserved;
obstacles can reduce achieved density in small/narrow polygons. Grass/meadow/grassland
remain open. OSM dimensions win; defaults are 8–14 m tall, 3–4.5 m street crowns or 4–6 m
woodland crowns; scrub is 3–6 m tall with 3–4 m crowns. Explicit OSM nodes are uncapped;
all derived row, street and area trees share a 60,000 limit, with counts/cap status exposed.

2D draws three soft green canopy tones above surroundings and below roads, in the same
base overview texture. 3D batches each trunk and round/conical crown into one coloured instance (four near-tree draw calls); beyond 1200 m
camera distance these become low-detail crown blobs. Trees use Lambert lighting without casting or sampling shadow maps.
Every instance reads its base through the `groundAt` callback in `render3d/vegetation.ts`
(default `groundHeight`, 0 m); the 3D scene passes TASK-105's `groundAt`, rebuilt when Terrain
toggles.
Trees and Street trees are independent default-on Layers switches, shown only when placement
produces their content. Neither changes saved data or rebuilds geometry when toggled.
Procedural 64×64 repeatable, faint grain textures tint grass, meadow, forest floor, pavement
and asphalt with the existing palette. 2D context uses repeating world-space fills; 3D ground
uses one five-slot grain atlas in one ordered mesh, and roads receive world-space asphalt UVs.
Test-mode scene attributes expose counts, cap, placement and 2D rebuild milliseconds;
`cityflows:render` and `cityflows:render3d` measures support the on/off frame comparisons.

TASK-105 terrain is presentation-only. `createTerrain` decodes once and exposes edge-clamped
bilinear `groundAt(x, y)`. Ground roads add sampled terrain to the existing grade profile;
decks and tunnels add the linear baseline between their surface ends, with ramps blending
from sampled ground as the existing grade profile reaches the deck. Ground-road surfaces,
crossings, markings (TASK-108's shapes, draped over the grid on ground roads and junctions;
gore paint keeps its pavement heights), signals and vehicle positions share the elevation/crossfall rule.
The mesh starts with one fixed diagonal per 10 m grid cell. Coplanar ground cells merge after
checking every corner against the grid's exact quantized plane. Folds and shared edge vertices
remain split to avoid cracks. Flat asphalt is unioned inside each triangle, avoiding redundant
strip seams. Ground surroundings split this same mesh at class
boundaries, with vertex colours, courtyard holes and line widths; buildings remain geometry.
Ground-level paint is split at grid triangles rather than at redundant half-metre stations;
straight level decks and level junctions retain only segment endpoints. Ramps retain their
finer grade-profile sampling.
The opaque backdrop replaces the fallback ground when basemap is off, and a second mesh
omits background regions to reveal tiles when basemap is on. Both meshes are disposed with the city. Basemap
tiles drape with matching UVs. Buildings retain their original extrusion height and stand
at the lowest sampled ground under
their footprint. Displayed ground is cut to that foundation inside the footprint, preserving
courtyards, so elevation samples affected by roofs cannot protrude through the extrusion.
Water stays level at its outline's lowest elevation, with the ground and
overlapping ground fills cut away beneath it, preserving islands. Raised/tunnel junctions
retain level deck heights; ground junctions follow the terrain. Basemap meshes collapse
the edge-clamped exterior into broad strips rather than tessellating outside the grid.
Only asphalt above ground enters the terrain view's shadow pass. The draped backdrop uses
one opaque pass, or one transparent pass with basemap/below-ground visibility. With no
vehicles, an unchanged camera and layer visibility reuse the
static shadow map; camera changes, layer changes and vehicles refresh it. The visible scene
still renders every frame.
Camera targets follow
the ground. Terrain off rebuilds the original flat geometry and removes the 2D hillshade;
cities without terrain follow the same path as before. `LayerVisibility.terrain` defaults
on and its control appears only when the city has terrain. The 2D hillshade uses north-west
light at 45 degrees, low opacity, below surroundings in the shared overview texture cache.
3D editing remains out of scope.

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
- TASK-105 terrain is embedded in `city.json`, including baseline cities, and shares its
  integrity hash. The manifest attribution combines the map and terrain sources. ZIP and
  JSON preserve the grid verbatim; no terrain file or migration is required.
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

TASK-101 reads access tags per directed road. Precedence for `all` is `access`, `vehicle`,
`motor_vehicle`, `motorcar`; per-class tags override that (`goods` for van when present in
`vehicleClasses`, `hgv` for truck, `psv` then `bus` for bus). A tag's direction suffix
overrides its unsuffixed value. `yes`, `permissive`, `designated` map to `yes`; `no`,
`destination`, `delivery`, `private` retain their meaning; `customers` maps to `private`.
Unknown values map to `yes` and their tag names enter `provenance.inferred`. Private
service roads stay imported. Numeric `maxweight` below 3.5 t closes truck/bus; `maxheight`
below 3 m also closes van when that class is available. Tonnes/metres are default; kg/lbs
and ft are converted. Unparsed limits are inferred, with no fabricated size restriction.

Bus reservations use `bus:lanes` then `psv:lanes` exact directional patterns (`designated`
and `exclusive` reserve a lane, `yes` keeps mixed traffic, `no` excludes buses); unsuffixed
patterns apply only to one-way ways. Unrecognized per-lane values are inferred.
Otherwise `lanes:bus`/`lanes:psv` counts and `busway=lane` reserve curb lanes. Directional
counts win; a total on a two-way way splits ceil/floor forward/backward unless a busway
side locates it. `busway:forward`/`:backward` and physical `:left`/`:right` locate lanes;
unsuffixed `busway=lane` applies in both directions. Counts respect driving side; exact
patterns remain left-to-right in travel direction. Invalid patterns/counts are inferred.
Junction consolidation preserves a short restricted segment whenever its effective access
or lane reservations differ from the roads outside the proposed cluster. A closure or bus
lane between open roads cannot disappear; uniform access zones still simplify normally.
Signal controls are enabled before compiling the geometry used to generate their phases;
after phase generation, a fresh compile supplies the usable graph for connector placement.
Time-conditional rules, signs and lane text are outside TASK-101.

Lives in `src/importers/osm`, runs inside an import worker.

TASK-105: after the unchanged road import, the worker fetches terrain unless
`ImportOptions.terrain` is false (the wizard's "Include terrain", default on).
AWS Terrain Tiles Terrarium PNGs at zoom 15 decode with `fast-png` in workers and Node,
without canvas: `R * 256 + G + B / 256 - 32768` metres. Up to six requests run at once,
with a 20-second timeout per tile. Tiles are cached by z/x/y in the import IndexedDB store.
The bbox plus 100 m is sampled bilinearly to a 10 m local grid, including across tile seams;
stored elevations round to decimetres. Any fetch/decode/cache failure retains the road city
and adds one `terrain_unavailable` warning to the diagnostics step. The Node city-tier entry
attaches committed grids for the two reference extracts without network requests.
`bench/terrain-fetch.ts` produces those grids in `fixtures/terrain/` and prints sizes,
height ranges and fetch times; its tile cache lives in this worktree's `node_modules/.cache`.

1. Parse `.osm` XML with `fast-xml-parser` into nodes, ways, relations.
2. Keep drivable highways: motorway, trunk, primary, secondary, tertiary, unclassified,
   residential, living_street, service (only when `service` is not `parking_aisle` or
   `driveway`), and their `_link` variants as `ramp`.
3. Junction nodes: nodes shared by two or more kept ways, way ends, nodes tagged
   `traffic_signals`, `stop` or `give_way`, and `via` nodes of restriction relations. Split
   ways there.
4. Project with a `GeoReference` at the bbox center. One `Node` per junction node, with its
   tagged layer if present or the grade of the way it serves. At mixed grades, prefer a
   through way, then a continuation across way boundaries, then ground in a tie. Bridge
   endpoints without a deck continuation use ground. Connectivity starts from shared OSM
   node ids. TASK-048 adds inferred
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
5. Roads: an integer `layer` tag takes precedence. With the tag absent, a bridge other
   than `bridge=no` uses +1, a tunnel other than `tunnel=no` or `covered=yes` uses −1,
   and other roads use 0.
   `oneway=yes` (or `-1`, or implied by motorway and roundabout) gives one road;
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
   TASK-096 separately imports display-only context after place generation (default on;
   ImportOptions.context=false omits it). Areas: building=* except no; natural=water,
   waterway=riverbank and landuse=reservoir|basin as water; leisure=park|garden|pitch|playground,
   landuse=grass|meadow|forest|recreation_ground|village_green|allotments|cemetery and
   natural=wood|scrub|grassland as green; landuse=residential|commercial|retail|industrial|
   railway|construction as landuse; amenity=parking as parking. Lines: railway=rail|light_rail|
   subway|narrow_gauge as rail, railway=tram as tram, waterway=river|stream|canal as waterway.
   Abandoned/disused rail and tunnel=yes lines at negative layer are omitted. Multipolygons
   share the building ring assembler and bbox clipper. Geometry is clipped, simplified at
   0.3 m, rounded to 0.1 m inside the bbox; areas below 4 m² and lines below 2 m are dropped.
   TASK-106 also imports `natural=tree` nodes inside the bounds as points (height from `height`,
   crown diameter from `diameter_crown`, leaf type from `leaf_type`) and clips `natural=tree_row`
   ways as lines, retaining positive tagged `spacing` in metres. Footway/path/cycleway/
   pedestrian/steps/track ways intersecting wood/forest/scrub/park areas become clipped display-only `landuse` areas with `sub: path`,
   using tagged width or 2 m (pedestrian: 3 m). They supply pavement and vegetation exclusions,
   draw above green areas, and never become canonical roads or affect connectivity. Invalid optional dimensions
   are omitted. Raw imported node/row counts and visible counts by placement source are
   reported by V106 for each bundled city; the older bundled extracts contain neither tree
   nodes nor rows. The dedicated importer case exercises these tags and ZIP/JSON persistence.
   Building height (metres or feet) and building:levels, line width and integer layer are
   retained when valid. Place generation and every network byte stay unchanged.
10. Diagnostics (T18): everything in section 5.5 plus `osm_unsupported_tag`, `osm_clipped`,
    counts of inferred lanes and speeds. The wizard shows them before the city is accepted.
    `osm_incomplete_way` (TASK-070): a drivable way that references nodes missing from the
    file, as extracts clipped by osmium or osmconvert do, keeps its longest run of present
    nodes; a way left with fewer than two is dropped. One warning lists both; the import
    fails only when no drivable way remains.
11. Smooth centerlines (TASK-066, B29). After topology, consolidation and splitting, every
    interior vertex of an imported road's centerline becomes a circular-arc fillet tangent to
    its two segments, and so does a degree-two node that joins two sections of one street
    (the node moves onto the arc so both sections stay tangent at it). Junction nodes (three
    or more road ends, any control, restriction via nodes, layer changes, gateways) never move
    and are never filleted. The radius is the class radius (motorway 400 m, trunk 250,
    primary 120, secondary 80, tertiary 50, ramp 60, residential 25, service 12), reduced so
    the tangent length fits in half of each adjacent segment and the fillet strays at most
    2 m from the original vertex; arcs are sampled at most 2 m or 5 degrees apart. Roundabout
    rings and hand-drawn or GeoJSON roads are unchanged; provenance records
    `smoothed:<count>` per road.
12. Realign acute approaches (TASK-068, B31). After smoothing, at every junction node (three
    or more road ends, or two that are not sections of one street), take each pair of
    angularly adjacent arms whose headings at the node differ by less than 45 degrees. Leave
    the pair alone when it is a merge or diverge by design: either arm is a motorway, trunk
    or ramp, or both arms carry traffic the same way relative to the node (both only
    incoming or both only outgoing). Otherwise the minor arm (lower class rank; on a tie the
    one whose realignment needs the smaller shift) is realigned: its last `L` meters toward
    the node, `L` between 15 and 25 m and at most half the road, are replaced by a smooth
    curve tangent to the unchanged centerline at `L` that meets the node at 60 degrees or
    more from the neighbour, bending away from it, with a lateral shift of at most 8 m from
    the original line. Both directions of a two-way street change identically. The node,
    the neighbour and every other road stay where they are. Where the bounds stop short of
    60 degrees the arm gets as far as they allow and a `realign_limited` info names it.
    Provenance records `realigned:<degrees>`. Roundabout rings, layer changes and controlled
    nodes whose control would change meaning are left alone.

Overpass provider: query drivable highways and restriction relations in a bbox capped at
50 km squared, one request at a time, results cached in IndexedDB by bbox and query version,
endpoint configurable, OSM attribution recorded. TASK-096 adds the context tag selectors
(ways and multipolygon relations) inside the same bbox while retaining the road selector.
TASK-106 adds `node[natural=tree]` and `way[natural=tree_row]` to surroundings only.
Query version 3 invalidates older extracts that lack tree selectors; the road-only selector
and restriction closure are unchanged. Imports with surroundings disabled
fetch the road-only query and bypass the full-context cache, so they cannot poison it. Nominatim, when used, is limited to one
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
| T17 edit live-state policy | ui, editor | grid-5x5 | TASK-010, TASK-051 |
| T18 import diagnostics | importers, network | broken fixtures | TASK-001, TASK-020 |
| T19 live edit: conservation, determinism, bounded reroute | sim, host, e2e | grid-5x5, bypass | TASK-051 |
| T20 junction geometry: no overlap, setback markings, taper | network, render | irregular junction fixture, Munich | TASK-061, TASK-063 |
| T21 conflict zones: no two vehicles inside contacting zones at once; cleared zones free | network, sim | four-way signal, junction fixture, Munich | TASK-064, TASK-065 |
| T22 zone timing and box: a far grant lets a crossing car through; no waiting in the box | sim | four-way signal, grid, Munich | TASK-065 |
| T23 smooth imports: tangent continuity, bounded deviation, fixed junctions | importers | Munich, Sindelfingen, downtown | TASK-066 |
| T24 acute approaches: realigned to 60 degrees, merges untouched, shorter setbacks | importers, network | Munich, Sindelfingen, an acute-Y OSM fixture | TASK-068 |
| T25 lane continuity: no pinch at splits and merges, tapers at drops | network, render | grid, a split-merge fixture, Munich | TASK-071 |
| T26 stop positions: cars stop before the crossing, crossings on the road | network, sim, render | four-way signal, grid, Munich | TASK-072 |
| T27 junction shapes: no overlap outside outlines, smooth curbs, markings clipped | network, render | grid, town, Sindelfingen, Munich | TASK-074 |
| T28 junction guide markings: lanes continue dashed through junctions without signals | render | T-junction, four-way, grid, Munich | TASK-075 |
| T29 mandatory changes: avoidable changes not planned, cooperative gaps, give-up | routing, sim | ramp fixture, platoon, Munich | TASK-076 |
| T30 gridlock recovery: a stuck jam head fades and its trip starts again | sim, render | square deadlock, grid, Munich | TASK-077 |
| T31 curbs (removed by TASK-083; its curb and fingerprint checks moved to T38) | network, render | grid, town, Sindelfingen, Munich | TASK-078 |
| T32 markings at the junction: to the stop line, arrows once, offsets kept on curves | render | grid, curve fixture, Munich | TASK-079 |
| T33 transitions: short tapers, side-by-side lanes at the remaining splits and merges | network, render | split-merge fixture, Munich | TASK-080 |
| T34 geometry audit: each of the eight measures detects its planted defect | bench | synthetic defects, the four cities | TASK-081 |
| T35 corridors: constant offsets, centre lines together, no folds, smooth joints | network | grid, town, Sindelfingen, Munich | TASK-082 |
| T36 importer corridors, separated pairs, relaxation | importers | OSM fixtures, Munich, Sindelfingen | TASK-084 |
| T37 through movements at multi-lane splits and merges | network | Munich, Sindelfingen | TASK-085 |
| T38 junction polygons: through roads keep their line, simple polygons, curbs, storage | network, render | grid, town, Sindelfingen, Munich | TASK-083 |

Tiers (TASK-090). `npm test`, which `npm run check` runs, imports and simulates no Munich;
`npm run test:city` runs Munich's import and geometry; `npm run test:traffic` runs the Munich
mornings. Real-city imports are cached on disk (`bench/city-cache.ts`). A test file that imports
`tests/tier.ts` runs in both the unit and the city tier, each with its own cities.

| Tier | Test families |
|---|---|
| unit (`npm test`) | T01 to T19, T22, T26, T30, T34; the synthetic and Sindelfingen cases of T20, T21, T23 to T25, T27 to T29, T32, T33, T35 to T40 and the routing throughput sample; the import warning baselines; the route audit of the grid, the town and Sindelfingen |
| city (`test:city`) | the Munich cases of T20, T23 to T25, T27, T28, T32, T33, T35 to T40 and the routing throughput sample; the Munich import (topology, demand, every connector pair routed and audited); the import cache |
| traffic (`test:traffic`) | the Munich morning at 0.15, run once for the traffic gate, T21, T29, T36.4 and T38.5; the Munich morning at full demand |
| e2e (`test:e2e`) | Playwright: T16, T17, T19, the demos, the gate and QA scenarios; about ten tagged `@smoke` (`test:e2e:smoke`) |

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

Transit vehicles and GTFS, PBF import and bulk extracts, permissive and actuated signals,
adaptive routing beyond EWMA, editing in 3D, desktop packaging, bicycles. Parking circulation
and walking legs are planned for Gates 7 and 9 (plan, "Roadmap: Gates 7 to 9"); their
contracts are added here when those tasks start. R7's multimodal readiness is covered by `TripRequest.legs` and
`TripMode` in section 9; nothing in the sim assumes a person equals a car.
