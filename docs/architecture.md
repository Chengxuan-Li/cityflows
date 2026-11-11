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

Deployment (TASK-067): the app is a static site. CI builds it on every push to `main` (docs-only
pushes excepted) and
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
  phases: { durationS: number; groups: { from: RoadId; to: RoadId }[];     // green groups
            walk?: { roadId: RoadId; end: 'start' | 'end' }[] }[];          // TASK-111
}

interface JunctionGroup {  // TASK-131, id "jg:<int>"
  id: JunctionGroupId;
  nodes: NodeId[];         // two or more; a node is in at most one group
  innerRoads: RoadId[];    // directed roads with both ends in the group
  signal: SignalProgram | null; // the group's one program; null = no signals
  provenance: Provenance;
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
  station?: { platforms: string[]; entrances: WalkNodeId[] }; // TASK-126
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
  rail?: RailNetwork;      // TASK-126: independent track network
  schemaVersion: 3;
  version: number;         // bumps on every committed edit; caches key on it
  name: string;
  drivingSide: DrivingSide;
  geo: (GeoReference & { bbox: [number, number, number, number]; source: GeoSource }) | null;
  nodes: Record<NodeId, Node>;
  roads: Record<RoadId, Road>;
  places: Record<PlaceId, Place>;
  markingTheme?: 'de' | 'us' | 'uk'; // display only; absent = geography default
  context?: { features: ContextFeature[] }; // display-only OSM surroundings, see below
  parking?: Record<ParkingId, ParkingFacility>; // Phase 2 format, see below
  walk?: { nodes: Record<WalkNodeId, WalkNode>; links: Record<WalkLinkId, WalkLink> };
  junctionGroups?: Record<JunctionGroupId, JunctionGroup>; // TASK-131, absent = none
  terrain?: { source: string; originM: Vec2; cellM: number; cols: number; rows: number;
              baseM: number; heights: string }; // base64 Int16 LE decimetres above baseM
  nextId: number;          // single counter for all id kinds
}
```

TASK-131 adds optional junction groups without a schema-version change: an old city has none
and compiles to the same result. A group is nodes joined by short links that are controlled and
drawn as one junction; each member keeps its position, the inner roads stay real roads with
their true lengths. Drawing: the members and inner roads are one surface (one tone with road classes on;
curbs only on the group's outside, a median between member arms rounded at both ends); an inner
road draws its lane lines (dashed between lanes of one direction) but no centre, edge, stop or
yield line, crossing, arrow or signal head; turn arrows stand at entries only. B55: two
different streets (or a street and a service road) on their OSM lines within 30 degrees whose
surfaces overlap or touch get a 0.5 m edge strip midway between the lines, in 2D and as a low
curb in 3D (`render/side-by-side.ts`, once per compiled city). A group is signalised if and only if `signal` is not null: every member
then has `control: 'signal'` and `signal: null`, and the program's green groups name an entry
road (ending at a member, not inner) and an exit road (starting at one, not inner); walk entries
name a road end at any member's crossing. Members of a group without signals keep their own
control, minor roads and turn rules. The city schema and the compile (`junction_group_invalid`)
check that members and inner roads exist, that a node is in one group, that inner roads join
members, and the control rule; a signal node needs its own program unless it is a member of a
signalised group.

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
            layout: 'parallel' | 'angled' | 'perpendicular'; ring?: Vec2[] }; // roadside only
  aisles?: RoadId[];              // a lot's parking_aisle service roads
  entries?: NodeId[];             // lot aisle nodes shared with permitted non-aisle roads
  exclusions?: Vec2[][];          // lot courtyards/buildings; nearby buildings for safe strip edits
  occupancyAtStart?: number;      // 0..1; absent = derived from residents
  provenance: Provenance;         // inferred marks facilities generated where OSM has none
}
type WalkKind = 'footway' | 'pedestrian' | 'path' | 'steps' | 'living_street' | 'crossing';
interface WalkNode { id: WalkNodeId; pos: Vec2; layer: number;
  entrance?: { placeId: PlaceId | null }; provenance: Provenance }
interface WalkLink { id: WalkLinkId; from: WalkNodeId; to: WalkNodeId; line: Vec2[];
  kind: WalkKind; widthM: number | null; layer?: number; provenance: Provenance }
~~~

Stall geometry, sidewalks along streets and walk links over TASK-091 crossings are derived at
compile and never saved. `sidewalk` sides are relative to the road's travel direction; absent
means the default by road class. TASK-103 materializes roadside strips during import only;
opening a file without strips does not infer any. A strip is one safe run on one directed
road side, with canonical centreline stations in metres; `angled` represents diagonal bays.
Its capacity is the whole slots at 5.5/2.8/2.5 m pitch (parallel/angled/perpendicular).
Road-inspector strip edits regenerate safe runs and are ordinary undoable parking patches.
TASK-119 optionally saves the mapped area's clipped outer `ring` on a strip. Absent rings
retain the generated-band behavior, including in older saved files. Numeric mapped capacity
is retained; compiled capacity is the number of slots that fit its run and polygon.

TASK-102 persists OSM garages and inferred private garages on the same `City.parking` format.
An implicit garage reuses its place's connectors and is marked `implicitGarage` in provenance;
compile follows the current place connectors after road edits. Capacity is the larger of jobs
and residents times the inference car share (default 1, matching default demand). A place
with an explicit facility normally needs no implicit garage. For block-aggregated places
with several source buildings, mapped slots describe only part of the block: an inferred
garage supplies the positive remainder, without changing mapped capacities or demand.
Editor entry and place creation materialize these facilities for stable saved IDs; compile
derives them on a copy for legacy files and headless callers. Gateways have no garage.

TASK-110 gives a mapped link its way's `layer` (old links use
their from-node's layer). Shared OSM walk endpoints retain explicit connectivity across grades;
an untagged bridge endpoint without a continuing deck meets ground. Interior bridge nodes stay
on the deck. Project boundaries validate walk-link references and line endpoints. An entrance's
place association may be dormant after place deletion; undo restores it, and an absent place
is treated as unmatched without changing the editor's patch/history contract. Vehicle routing,
demand and simulation ignore walk data.

TASK-105 adds optional display-only terrain without a schema-version bump. The boundary
validates positive spacing, at least two rows and columns, base64 and exactly two bytes per
sample. Old files omit terrain. Edits retain it without incrementing `city.version`, and
`compile(city)` ignores it. Geography, entity geometry, IDs and the compiled network are
identical with terrain present or absent.

~~~ts
type ContextArea = 'building' | 'water' | 'green' | 'landuse' | 'parking';
type ContextPoint = 'tree' | 'street_lamp';
type ContextLine = 'rail' | 'tram' | 'waterway' | 'tree_row';

type RoofShape = 'flat' | 'gabled' | 'hipped' | 'pyramidal' | 'skillion' | 'mansard'
  | 'gambrel' | 'half-hipped' | 'round' | 'dome' | 'onion';
type ContextFeature =
  | { kind: 'area'; class: ContextArea; rings: Vec2[][]; sub?: string; heightM?: number; levels?: number;
      roof?: { shape: RoofShape; heightM?: number; levels?: number; colour?: string;
               material?: string; orientation?: 'along' | 'across'; directionDeg?: number };
      colour?: string; material?: string; minHeightM?: number }
  | { kind: 'line'; class: ContextLine; line: Vec2[]; widthM?: number; layer?: number; spacingM?: number }
  | { kind: 'point'; class: ContextPoint; pos: Vec2; heightM?: number; crownM?: number; sub?: string };
~~~

Rings are closed, outer first then holes, in local metres rounded to 0.1 m. Optional sub is the
source tag value; tagged building height/levels and line width/layer are retained.
TASK-109 adds the optional building roof, facade colour/material and clearance fields above,
without a schema-version bump. Colours are lowercase `#rrggbb`; roof dimensions and clearance
are nonnegative metres/levels; `directionDeg` is a downhill compass bearing in [0, 360).
Old files omit these fields. They remain display-only and survive project save/open; no
network, demand or simulation module reads them.
TASK-106 adds tree points (`sub` is `leaf_type`, dimensions are metres) and tree-row lines
with optional `spacingM` (minimum 2 m) from OSM `spacing` (default 8 m). This is an optional context
extension without a schema-version bump. Only imported context is saved; generated trees
are derived display geometry and never enter the project or compiled network.

TASK-107 adds `street_lamp` context points: optional `heightM` from `height` and `sub`
from `lamp_mount`, falling back to `support`. No schema-version bump; old files still open.
Imported lamps persist, while generated furniture stays renderer-only and is never saved.

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

TASK-114 adds optional display-only `City.markingTheme` without a schema-version bump.
Compile, routing and simulation ignore it. Import uses explicit OSM country tags first,
then coarse offline bounds: US/Canada → `us`, UK/Ireland → `uk`, elsewhere → `de`.
Files without the field resolve from their geographic bounding box, else `de`.
The Layers “Marking style” choice is undoable; its history patch uses `null` to restore an
absent override. A pure marking-style edit retains the city version and compiled object.

TASK-111 adds optional `SignalProgram.phases[].walk` without a schema-version bump: the
crossings with walk green in that phase, each named by a road end of its arm (section 5.4).
Absent means derived; an empty list means none. Road deletion drops entries naming the road,
a split renames them with its group entries; an entry that names no crossing of the node is
ignored at compile, so stale entries never fail an edit.

TASK-126 adds optional `City.rail: RailNetwork` and `Place.station?: { platforms: string[];
entrances: WalkNodeId[] }` without a version bump. Old projects omit them; current, v2 and
v1 boundary schemas retain them through JSON/ZIP save/open. Rail IDs use the shared counter,
after vehicle, parking and walk import allocation: `rn:` nodes, `rt:` tracks, `rp:` platforms.
`schema/rail.ts` defines nodes (position, layer, plain/switch/buffer_stop/stop/level_crossing,
optional OSM ID and signal flag), undirected tracks (endpoints, polyline, kind, layer, optional
bridge/tunnel/service/usage/name/maxSpeedMps/OSM ID), and platforms (polygon, line or mapped point, layer,
mode rail/tram/bus, name, served track IDs, station place ID or null). Boundary validation
checks IDs, track references/endpoints and positive lengths, platform track references and
closed platform rings. No rail data is a road lane or a car connector. Station car demand,
connectors and parking retain their imported values. Stations without mapped buildings gain
a platform-covering bounding polygon; mapped building shapes remain intact.

TASK-127 adds optional track `preferredDirection: 'forward' | 'backward' | 'both'`, relative
to the stored polyline, from `railway:preferred_direction`. No schema-version bump: omitted
values leave direction undecided and all existing migration/boundary schemas preserve it.

TASK-135 adds optional tram-track `form: 'embedded' | 'grass' | 'paved' | 'ballast'` and
`provenance` (`{ source: 'osm', inferred: ['form'] }` when no tag decided the form). The import
sets `form` on every tram track and on no other kind. The way's tags decide first:
`embedded=yes` is embedded; `embedded=no` is an own bed of the tagged surface or ballast;
`surface=grass` or `railway:track_ballast=no` is grass, `railway:track_ballast=yes` ballast. A
track lying over half its length inside highways tagged `embedded_rails=tram` is embedded. Any
other track is inferred from the compiled geometry: inside same-grade road or junction surface
over at least 80% of its length (sampled every metre) it is embedded, otherwise an own bed,
paved under a paved `surface` (asphalt, paving_stones, concrete, sett, paved) and ballast
otherwise. No schema-version bump: older projects omit both, and a tram without a form draws as
embedded.

TASK-132 adds optional track `covered: true` for `tunnel=building_passage` and `covered=yes`
ways: the track stays at grade under its roof. Its `layer` (-1 by the road rule) and `tunnel`
flag are unchanged, so crossings, continuations and drawing order are as before. No
schema-version bump: older projects omit it and their building passages draw as tunnels.
TASK-137 adds optional `RailNetwork.tramStops`, a record of `TramStop` keyed `ts:<n>` (ids from
the shared counter, allocated after the junction groups') without a version bump; cities without
tram stops and older projects omit it. A stop is one platform island and the tram track sections
it serves: `name`, `lines` (from `route_ref`, else tram route relations in the data, else the
`Tram 18/19/N19` of the stop's or platform's description), `layer`, served `tracks`, `halts` (a
point on a served track per stop position), `platform` (`{ kind: 'mapped', platform: rp:… }`
keeps an imported polygon or line platform as it is, `{ kind: 'generated', ring }` is an island
the import laid beside the track, `null` when no room was left), the tags `shelter`, `bench`,
`covered` and `tactilePaving` as booleans where the platform or stop gives them, `osmIds` and
`provenance` (`inferred: ['platform']` on a generated island). Boundary validation checks that
the ids match, tracks and platforms exist and generated rings are closed. Tram stops are not
network: compile ignores them, and no lane, connector, route or simulation hash reads them.

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
  rail?: RailGraph;        // TASK-126: derived tracks, continuations and crossings
  version: number;
  drivingSide: DrivingSide;
  nodes: CNode[];
  roads: CRoad[];
  lanes: CLane[];
  movements: CMovement[];
  places: CPlace[];
  connectors: CConnector[];
  parking: CParking[];            // dense garage, lot and roadside facilities
  lots?: CLot[];                  // surface lots and generated stalls, TASK-104
  index: {
    node: Map<NodeId, number>; road: Map<RoadId, number>; lane: Map<LaneId, number>;
    movement: Map<MovementId, number>; place: Map<PlaceId, number>; connector: Map<ConnectorId, number>;
    parking: Map<ParkingId, number>;
    group?: Map<JunctionGroupId, number>;   // TASK-131, with `groups`
  };
  groups?: CGroup[];       // TASK-131; absent, with CNode.group and CRoad.group, without groups
  laneSpatial: Flatbush;   // lane segments, for picking and snapping
}

interface CNode { idx: number; id: NodeId; pos: Vec2; radiusM: number; control: Control;
  movements: number[]; signal: CSignal | null; group?: number; }
interface CGroup { idx: number; id: JunctionGroupId; nodes: number[]; innerRoads: number[];
  entries: number[]; exits: number[];          // road idx entering / leaving the group
  chains: { from: number; to: number; movements: number[] }[]; signalised: boolean; }
interface CRoad { idx: number; id: RoadId; from: number; to: number; lanes: number[];
  access: AccessValue[]; zone: Int32Array; // indexed by vehicleClasses
  roadClass: RoadClass; classRank: number; speedLimitMps: number; lengthM: number;
  streetGroupId: string | null; corridorId: string | null;   // corridorId ?? streetGroupId
  surface: Vec2[]; /* polygon for rendering */ group?: number; /* inner road's group */ }

A group's chains (TASK-131) are its lane paths: from a lane of an entry road, the member-node
movements along inner-road lanes to a lane of an exit road, no lane twice in a chain. The road
pairs with a chain are the group's turn permissions, those the merged node of TASK-049 allowed.
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
interface CConnector { idx: number; id: ConnectorId; place: number; parking?: number; lane: number;
  positionM: number; direction: 'in' | 'out' | 'both'; throughputPerMin: number; }
interface CPlace { idx: number; id: PlaceId; kind: PlaceKind; centroid: Vec2;
  connectorsIn: number[]; connectorsOut: number[]; capacity: number | null; events: PlaceEvent[]; }
```

`CParking` carries canonical identity/kind/access/capacity, owner place index (`-1` when
unowned), centroid, entry/exit connector indices, initial occupancy fraction, resident count
and the source facility for inspection. An unowned garage connector has `place: -1` and a
parking index. Implicit entries share their place's connector indices; explicit entries
are separate. Garage entries obey ordinary road/lane/position validation and route access.

TASK-101 resolves `CRoad.access` for every class. `zone[classIndex]` is `-1` outside local
access zones. For each class, destination/private roads connected through either shared
endpoint form one zone, independent of travel direction; mixed destination/private rules
join the same zone. Zones are assigned deterministically in compiled road order. TASK-104 keeps each lot's aisle
zone separate from non-lot roads and other lots, even when the adjoining street is private.
An aisle listed by overlapping facilities belongs to the first facility in compiled id order
for zone assignment. Thus a neighbouring private-road origin cannot grant aisle access.

TASK-104 derives `CompiledCity.lots?: CLot[]` only when lots exist. Each lot has its
facility id, entry node ids, aisle road ids, `stalls` and `stallCount`. A stall stores `position`, `heading`,
`widthM`, `lengthM`, `aisleRoad`, `positionM` along that canonical aisle, and four `corners`.
Capacity remains the canonical facility value; derived geometry is never saved. Both sides
of each physical aisle are sampled at 2.5 m pitch for perpendicular 2.5 × 5 m bays; a
one-way aisle at most 4 m wide uses 60-degree bays and the corresponding pitch. Bays are
kept wholly inside the lot and clear of road/junction surfaces, exclusions and earlier bays.
Six metres at aisle ends and around entry/junction nodes remain clear. Facility, road and
bay ordering is deterministic. Building exclusions are saved with lots so disabling display
surroundings never changes compiled stalls.

TASK-103 compiles lots and roadside facilities into `CParking`. `parkingSpaces` is a dense,
deterministic array: each space has its facility, lane, lane station, centre pose, dimensions,
layout, connector and manoeuvre flag. Facilities carry space indices. Strip slots have
derived, facility-local entry/exit connectors. TASK-118 ends a lot road
route at a canonical entry or the end of a mapped aisle lane; stalls share these entries.
Lot simulation capacity equals the reachable generated stall count. A lot without mapped
aisles gets a derived grid of stalls clipped to its polygon and saved exclusions, without
inventing vehicle roads.
TASK-118 adds `CLot.circulation`: local nodes, bidirectional edges and adjacency, one access
node per stall, and entry connector nodes with precomputed shortest-path distances and
predecessors. Mapped aisle lane centrelines and their existing joining curves are read-only
geometry inputs, retaining every split section. Generated row gaps and short visible bridges
between disconnected aisle ends stay inside the polygon and clear of stalls and exclusions.
Bridges join the closest disconnected pieces without crossing another path. This handles
lots whose adjacent access spine lies outside their mapped polygon. Generated rows leave end
circulation gaps; shallow layouts retain their paint but cannot admit cars without a reachable driving gap.
Entry links may cross the lot boundary from the street and never cross stalls. An entry
prefers a link clear of exclusions; only when none exists may it pass under a building
exclusion, a courtyard reached through a building passage (Munich `pk:2037`, Sindelfingen
`pk:1475`). A stall's access point joins the nearest aisle point over a clear link of up to
5 m (one stall length), so a single row beside its aisle is usable.
`lot_stalls_unreachable` reports stalls without both an inbound and an outbound path.
A bay retains its physical lane/station separately from its admission connector; curb
openings and lamps continue to use physical bay access. No circulation edge enters the
vehicle router.

`strips` carries pavement polygons and space indices outside the unchanged carriageway:
bands are 2/4.5/5 m wide. Sidewalks offset outward beside these bands. Vehicle roads, lanes,
nodes, movements, conflict geometry and existing connectors retain their original data.
TASK-119 uses a strip's mapped `ring` directly as `CStrip.polygon`. At each slot's centreline
station, the curb lane's normal intersects the ring; the widest outward interior interval
supplies the slot centre. Stations with no interior interval produce no slot. Both renderers
consume this same band and slot geometry.

TASK-126 derives optional `CompiledCity.rail` after walk compilation, in `network/rail.ts`.
Dense nodes list incident track indices; dense tracks carry canonical identity/geometry,
endpoint indices, cumulative metres and length. Directed continuation pairs connect different
tracks only at a shared node and at deflection <=30 degrees: shallow turnout branches connect
to their stem, while branch-to-branch reversals and sharp corners do not. Buffer stops have
no continuations. Geographic crossings never create rail connectivity; explicitly shared nodes
may join grades at mapped abutments. Components report physical track connectivity, including
branches that cannot be traversed directly. Same-grade road/track intersections carry road ID,
track index, position and metre station on both polylines. They are derived from current road
geometry, so deleting a road drops only its crossing records. No car/walker control reads them.

TASK-127 marks degree-one, non-buffer nodes within 0.1 m of the geographic bbox as boundary
ends (synthetic cities use their rail extent). `network/trains.ts` builds oriented paths through
the compiled continuations only. Preferred direction is binding; untagged parallel running
tracks within 12 m favor right-hand operation. Route search penalizes service tracks and
opposing parallel geometry, rejects paths with more than 15% against that geometry, and keeps
the longest station-serving paths first, excluding duplicated directed sections. Station rail
platforms classify S-Bahn routes; other running paths are main line. A route ends at another
boundary, never at a switch or an arbitrary dead end. Owner-approved exception (2026-11-10):
Sindelfingen has no permitted boundary-to-boundary path; there, boundary-to-buffer services
stop with their nose at the buffer, dwell 40 s, and reverse back to their boundary. They never
reverse at a switch, and preferred-direction tracks cannot carry a reversing service.

The derived timetable is cached by rail graph identity, outside `CompiledCity` and simulation
state. Defaults in one module: S-Bahn 240 s / 135 m / 80 km/h, main line 360 s / 200 m /
100 km/h; tagged track speeds override these. Route-ID hash offsets are deterministic. Motion
uses 0.8 m/s² acceleration/braking and 40 s platform dwells with the train's middle at the
projected platform middle. A periodic reservation table reserves every occupied section from
nose entry through tail exit, including adjacent cycles. Conflicts delay departure outside
the boundary. The nominal cycle is 720 s; an overloaded network lengthens that cycle until
all requests fit, reporting actual rates and boundary waits in `trainCensus`. Terminal services
reserve each section through their return, conservatively. `trainsAt(rail, timetable, timeS)`
returns whole-train occupancy and articulated car poses without frame history. Arrivals are
the timetable departure plus each route stop's `arrivalS`, repeated by `periodS`; terminal
services include station visits on both legs.

TASK-132 derives each track's height profile, `railHeights(compiled, roadGrades, nodeGrades)`
in `network/rail.ts`, cached by rail graph identity outside `CompiledCity` like the timetable.
Tags decide the grade, not `layer`: `covered` track is at grade; a tunnel's rail top lies at
-7 m (a 4.5 m train under 1 m of structure and 1.5 m of cover) and 5 m deeper per layer below
-1; a bridge deck at 5 m per layer, raised to clear every lower road it crosses by 4.7 m and
every lower non-tunnel track by 6 m (overhead line), each under a 1 m deck; any other track,
whatever its `layer`, at grade. Profiles are sampled every 2 m over the whole graph. Pins hold
0 m: switches between non-structure tracks, level-crossing nodes, covered track, ground-track
samples on a road or junction surface at grade or above (one sample beyond each edge), within
4 m of a crossing with a non-tunnel track away from shared nodes, within 5 m of a served
platform's extent, and a structure's single-track end node mapped at layer 0. A structure's
level is first clamped within the 4% (trams 6%) cone from the nearest pin; then every pin and
structure sample bounds the profile above and below by its cone, and each sample takes its
track's level (0 at grade) within those bounds, or their midpoint where two structures are too
close for both (the bounds cross). So ramps lie on the ground-level side of a portal or
abutment unless a pin is too close, and then continue inside the structure; no sample-to-sample
slope exceeds the track's limit. Heights are rounded to micrometres. Portals are structure ends
at a node shared with another grade (or a pinned single-track end). Nothing here enters
routing, demand, the timetable or simulation state.

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
  TASK-131: where the edges' lines meet far behind one cut and just behind the other (an arm
  meeting a group's short inner road, n:638's members), the arc's tangent point on the far edge
  lies on that edge's line behind its cut, and the curb runs straight to it from the cut corner
  (limit `far`). A curb's cut region is closed on its far side along the corner's bisector, and a
  dead end's cap is joined to every end's cut.
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
  two-way street is never shifted (TASK-131: also where a carriageway continues into one at a
  node of its own; that node stays a junction), and a shift steeper than 1 in 4 is not applied.
- TASK-099 (attached carriageways, B54; removed by TASK-131: nothing called it, and the
  owner's TASK-131 decision keeps OSM geometry). After `separateDual`, `attachCarriageways` pulled one
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

- TASK-131: a signalised junction group's program runs at every member in lockstep. Each member
  compiles a derived program: the group's timing, and in each phase the road pairs at that member
  of the chains of the phase's green groups (entry to exit), so one green clears a car from the
  entry to the exit. Its walk entries are those at the member; derived walk green stays per
  crossing. A green group that does not name an entry and an exit is `signal_phase_invalid`.
  Until Phase 3 there is no box rule: a car can stop on an inner road at the next member.
- Each phase's `groups` expand to every movement between the named road pair. A movement may
  appear in several phases. `cycleS = sum(durationS + amberS + allRedS)`.
- State at simulation time `t`: `((t + offsetS) mod cycleS)` locates the phase and whether it
  is in green, amber or all-red. Amber means vehicles that can stop before the stop line do.
- Error `signal_conflict`: two conflicting movements in the same phase (T13). TASK-131: two
  movements into one lane of a group's inner road are not a conflict for the signal; they merge
  inside the junction as at a lane drop, ordered by the grant rule (Munich r:480's two lanes into
  the one-lane crossing r:713).
- Warning `signal_unserved_movement`: a movement at a signalized node that is in no phase. It
  is compiled with `neverGreen: true` and routing excludes it.

TASK-111 (walk groups and crossing spans). Every crossing walk link (section 5.6) carries
`crossing.node` and `crossing.arm` (the `crossingArms` index; -1 for a midblock zebra) and
`crossing.spans`: for each lane it crosses, `atM` along the lane where the link meets its
centreline, `halfM` half the 2.5 m stripes' extent along the lane (divided by the sine of the
crossing angle, at least 0.3), and `linkM`/`linkHalfM`, the same along the link for the lane's
width. A generated crossing crosses the lanes of its arm's roads (both directions of a street,
any carriageway of the arm); a mapped one the same-grade lanes its line meets, or, in a
junction mouth, the straight 12 m extension of a lane of its arm, the span then sitting at that
lane end. Crossings near a signal (generated at a signalized node, mapped within 40 m) are
`signal` crossings; all others are zebras. Spans are derived, never saved, and change no lane,
movement or stop position.

`CSignal.phases[].walk` lists the node's signal crossing links with walk green, compiled after
the walk graph (`compileSignalWalk`). Explicit entries select the arms whose road end they
name. Absent entries are derived, concurrent operation as in Germany: an arm's crossing is
green in every phase in which no movement from the arm is green; movements into the arm may be
green at the same time and their drivers yield. A phase without vehicle groups derives none:
an exclusive pedestrian phase (walk groups, no vehicle groups) is always explicit. Walk green
follows the green of the phases that list the link and runs on through the amber and all-red
between two such phases (`walkWindows`, `walkGreenS`); amber and all-red stay vehicle rules.

### 5.5 Diagnostic codes

Errors (compile fails, editor rejects the commit):
`dangling_ref`, `road_degenerate`, `lane_invalid`, `connector_invalid`, `turnrule_invalid`,
`signal_missing`, `signal_phase_invalid`, `signal_conflict`, `place_invalid`,
`junction_group_invalid` (TASK-131).

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

TASK-124 adds `place_no_exit` and `parking_no_exit`: no departure connector of a place,
or of a garage or lot, can reach its car circulation core. Each warning names the owner,
the trapped connectors and their lanes (or reports that no departure connector exists).
The check uses TASK-122's largest movement SCC per origin access zone, excluding
`neverGreen` and lane-drop fallback movements; adjacent-lane changes need 30 m each,
measured from the connector's actual station. Car access is `yes`, or `private`/`destination`
in the origin's own zone. Tied largest SCCs all seed the check. Strips retain their mapped
roads and are counted separately by the import probe. Warnings do not move saved connectors
or prevent compilation; re-import repairs the source portals.

### 5.6 Pedestrian graph (TASK-110)

`CompiledCity.walk: WalkGraph` is derived after the unchanged vehicle compile. Dense nodes
carry position, layer, incident link indices and mapped source IDs. Dense bidirectional links
carry a polyline, cumulative metres, length, width, grade, kind and `generated`. Sidewalk links
name their compiled road and travel-relative side; corners name their node. Crossings name
their road, `start`/`end` (or `midblock` for mapped crossings) and `zebra`/`signal` control.
`places`, `parking`, `connectors` and `sourceNodes` maps expose walk-node access indices.

Default 2 m sidewalks follow the compiled outer curb, their centre 1 m beyond it, on
residential, tertiary, secondary and primary streets. Motorways, trunks, ramps and service
roads get none by default. Explicit `no` suppresses generation; `yes` enables it. For
`separate`, a parallel same-grade mapped path on that side within 12 m supplies the curb.
Four-metre coverage samples use the road tangent and follow continuous mapped ways through
their vertices, without extending coverage past a true path end beyond the 4 m snap range.
Generated infill remains only where it connects distinct existing walk components, supplies
otherwise missing anchor access, or forms a standalone walk network (TASK-123 round 2).
An inward side of paired carriageways is always suppressed, including divided corridors.
Corners follow the existing curb returns on the outside; through seams join the same curb.
TASK-123 fills disconnected same-grade curb ends within 12 m along the junction's outer
boundary (at most 40 m), including service-driveway mouths and dead-end caps. These joins
cannot cross an ordinary road reference. Local endpoint joins also run from generated
sidewalk ends to mapped through paths within 4 m; additions join disconnected sets only.
An inferred `separate` curb can hand off to its parallel mapped path within the 12 m coverage
range, on the same layer and without crossing an ordinary road. Existing main-network access
takes precedence over an inferred curb. Infill cannot conceal a gap between existing curbs
when their joins are compiled, and unused branches into one existing component are discarded.
TASK-091/094 crossing placement and road-end overrides supply cross-street walk links,
including separately mapped curbs. Generated walk crossings exclude motorway, trunk and
ramp arms. The vehicle network, crossing placement and stop positions are unchanged.
New mapped-curb corners and crossings are added only where the existing network has a gap.

TASK-140 (B59): the stripes' centreline is a crossing's one position (`crossingCentreM`,
`crossingLine` in `src/network/crossings.ts`). A crossing link runs across each road end it
crosses at the centre of the stripes that end draws, through every lane's edges, so it meets each
lane there; at a served signal approach that draws none, at TASK-072's crossing 1.5 m from the cut
(in front of its `lengthM - 3` stop line); the ends of one arm are joined in order across, over a
median or a jog. A generated crossing follows this line, extended 100 m each way, between its
outermost curb hits; its other ends without stripes use 1.5 m. A mapped crossing at a junction
(`end` start or end, or a signal's) does the same: its links at that node, joined through nodes
no other walk link uses (the node where OSM splits a crossing way on a road's centreline), become
one link that keeps the first link's id and crossing data and reaches 1 m beyond the outer road
edges; two straight kerb links (`<id>:kerb:0|1`, kind `crossing`, generated, no crossing data:
not drawn, no wait, never a join target) tie it to the chain's mapped end nodes, so mapped
connectivity is unchanged; the dissolved nodes stay as nodes without links. An unmarked road end
(no stripes, no served signal) keeps the mapped crossing's own position. A mapped crossing stays
as mapped if it crosses no lane, crosses a lane of a road that does not end at its node, crosses
no marked end, or lies more than 12 m from the stripes (another crossing along the street, Munich
`n:16`). The walk lights stand at the link's ends (`walkSignalMarks`), so at the stripes' ends.

Same-grade mapped intersections split links. Mapped endpoints snap within 4 m (curb width
and imported alignment), with no inferred shortcut across an ordinary street; explicit OSM
shared endpoints can join grades at abutments. Generated sidewalks on mapped bridge/tunnel
roads also retain the shared road node's grade
at an explicit approach to a road on that grade (TASK-123, owner-approved endpoint rule).
Their interiors retain the deck/tunnel grade; coincident but unshared roads do not join.
Entrances attach their places; otherwise
access uses the nearest part of the place shape. Short access links prefer the main walk
component within 150 m, retaining local paths when no main-component access fits. Access
links may cross service driveways,
but never an ordinary road centreline. A door with no viable attachment falls back to the
place shape. Parking shapes, roadside strips and car connectors use the same access rule. Equidistant
connector curb candidates prefer the owning place or facility's chosen access curb on that
same road (TASK-123). A parallel mapped path also identifies that curb within 12 m of the
road edge, on the same grade and without an intervening ordinary road. A remote entrance
does not change the stable nearest-curb order. This prevents both long local detours and
remote entrances flipping an already usable car access to the opposite curb.
No access is invented beyond the distance limit or across an incompatible grade. Access is a
straight connection, not obstacle-avoiding navigation through a block. Building clipping is
presentation-only; display context still cannot change compiled connectivity.

TASK-126 associates public-transport station entrances with canonical walk nodes, preserving
existing walk IDs. Entrance association uses a matching name when present, then the nearest
station within 250 m, excluding foot/access=no. The existing 150 m, same-grade, no-road-crossing
access attachment above supplies streets; stations without doors use the platform/building shape.

## 6. Editing

TASK-131: patches carry `junctionGroups` (set and remove), so undo restores a group. A topology
edit (`addRoad`, `deleteRoad`, `splitRoad`, `mergeRoads`, roundabouts, ramps, `reverseRoad`,
`setStreetDirection`) that touches a member node, an inner road or a road at a member dissolves
the group; each remaining member of a signalised group gets its own generated program
(`network/signal-program.ts`). `setControl` and `setSignal` on a member apply to the whole group.
The node inspector shows the group and its program read-only.

TASK-102 adds `setParkingAttributes` (capacity and access) and parking collections to patches
and inverse patches. Inferred facilities become canonical when editing begins or a place is
added; undo removes newly inferred facilities with their place. Garage connectors follow
road topology and lane edits. The live engine rejects reducing capacity below occupied slots;
the inspector uses current occupancy as the minimum. Restart can apply a lower capacity.

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
  | { kind: 'setParkingAttributes'; parkingId: ParkingId; capacity?: number; access?: ParkingAccess; source?: ParkingFacility }
  | { kind: 'batch'; label: string; commands: Command[] };                      // Gate 2

interface Patch {
  metadata?: Pick<City, 'name' | 'drivingSide' | 'geo'>;
  set: { nodes?: Record<NodeId, Node>; roads?: Record<RoadId, Road>; places?: Record<PlaceId, Place>; parking?: Record<ParkingId, ParkingFacility> };
  remove: { nodes?: NodeId[]; roads?: RoadId[]; places?: PlaceId[]; parking?: ParkingId[] };
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

TASK-110 adds `createWalkRouter(graph: WalkGraph)` independently of `RouteProvider`. Its
`route({ from, to, speedMps?, stepsFactor? })` accepts a place ID, dense walk-node index, or
`{ link, positionM }`. A deterministic heap Dijkstra minimizes walking time, default speed
1.4 m/s and steps factor 0.6. Partial first/last links and same-link shortcuts are included.
The result contains directed legs `{ link, fromM, toM }`, link indices, metres and seconds;
failures are `position_unreachable` or `no_path`. Scratch arrays are reused per router; no
request-dependent route is cached. The simulation consumes these routes for test and person walkers.
TASK-111's test walkers use it once per source (place to place, `walkSpeedMps`,
`walkStepsFactor`), sharing the route among the source's walkers; live edits route again.

## 8. Simulation

TASK-102 keeps garage stock and person car chains in `sim/parking.ts`, separate from place
event admission. Initial residential stock uses residents times scenario car share, bounded
by slots and distributed across facilities; explicit `occupancyAtStart` wins. Otherwise work
and school garages start 70% occupied from 09:00 to 17:00, retail 35% from 09:00 to 20:00,
and other non-residential garages start empty. Initial trips reserve distinct parked cars;
an exhausted origin is a counted `no_parking` failure. A successful departure decrements
stock once, including across gridlock respawns (recovery queues sit outside garage stock).
Arrivals increment atomically, never beyond
capacity, and keep the car's facility for its next trip. These states participate in hashes.

TASK-125 claims parking when the room-required choice pass accepts a reachable entry. A car
holds at most one claim: an exact roadside space, or one capacity unit in a hard garage or lot.
Claimed roadside spaces are unavailable to other cars; hard facilities drop out when occupied
plus claimed reaches capacity. Entry checks exclude the asking car's own claim. The full-facility
departure forecast makes no claim. Soft inferred garages remain unlimited and are not counted.
Choosing again, entry rejection, parking, failure and gridlock respawn release through the same
parking release operation; trip accounting covers every terminal path. Claims never move origin
stock. Live edits remap claims by facility/entry id and space ordinal, releasing removed targets.
Claims and their start times participate in parking hashes and the engine's claim snapshot;
parking detail reports a claimed strip space before its manoeuvre. A debug engine flag checks
claim ownership and counts after each step. Metrics record entry rejection locations and the
empty time of released and still-active strip claims (including the pull-in).

TASK-103 gives visible spaces exclusive stock and arrival reservations. TASK-118 replaces
its stationary holds with front-bumper trajectories. A strip arrival stops at its slot,
then drives forward and reverses along an S-curve for parallel parking, or takes a forward
arc for angled/perpendicular parking. The pull-in lasts `parkManoeuvreS` (8/4/4 s); the lane
is held until the entire body clears it. A departure removes the parked sprite, follows the
reverse path over `leaveManoeuvreS` (4 s), holds its accepted lane gap and joins at speed 0.
Both admission directions require room ahead for the full swept body, including the forward
setup of a parallel manoeuvre. Local reversing departures also allow for traffic that can
reach their access point during the leave duration.
Curve progress is eased, and snapshots carry the moving body throughout the handover.

A lot arrival obeys connector admission, reserves a free reachable stall, releases its lane
and becomes `in_lot` (counted among driving trips). It follows its local shortest path at
`lotSpeedMps` (2.5 m/s), keeps `minGapM` behind a leader and gives a merge to a car already
across it; tied approaches use distance, then id. Narrow local paths admit one entry/direction
cohort at a time to prevent opposing cars deadlocking. Reversing departures take an aisle
gap, leave their stall, follow the local path to an outbound entry, wait for the existing
spawn/insertion gap and connector budget, and enter the street at speed 0. Gridlock recovery
never applies inside a lot. Trucks and buses use garages only; garage admission and stock
rules are unchanged.

Occupancy changes atomically, and a dependent trip keeps the preceding trip's exact space.
An edit that removes an occupied visible space, or changes an active lot's circulation topology
(including bridges and portal directions) or a strip trajectory,
requires a restart before mutating the run. Unaffected edits remap stock, reservations and
moving cars by facility/connector id and local space ordinal. Motion phase and progress
participate in the deterministic hash. Active parking trajectories advance after the lane
commit and before gridlock recovery. Off-lane trajectory exports use `parking:<facilityId>`
as their segment id and do not contribute to road speed or queue statistics. Parking metrics
add mean entry-to-park, local drive and departure times, strip manoeuvres per simulated hour
and mean chosen stall rank.

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
  headDetourS: 45;               // TASK-121: a stopped head tries another exit
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

type VehicleState = 'queued_origin' | 'driving' | 'queued_destination' | 'in_lot' | 'completed' | 'failed';
type FailReason = 'no_route' | 'no_walk_route' | 'unsupported_mode' | 'destination_unreachable' | 'stranded'
  | 'no_origin_connector' | 'no_destination_connector'
  | 'gridlocked';                                     // TASK-077, after maxRespawns

interface TrafficEngine {
  load(input: { compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario; population?: Person[]; params?: Partial<SimParams> }): void;
  patch(compiled: CompiledCity): PatchResult;   // TASK-051, live edits below
  step(n?: number): void;
  readonly timeS: number;        // seconds since midnight of the scenario day
  snapshot(): VehicleSnapshot;
  metrics(): Metrics;
  inspect(vehicleId: number): VehicleDetail | null;
  inspectWalker(walkerId: number): WalkerDetail | null;
  inspectPerson(personId: string): PersonDetail | null;
  stateHash(): number;           // 32-bit FNV-1a, see below
}

interface VehicleSnapshot {
  timeS: number; count: number;
  id: Uint32Array; x: Float32Array; y: Float32Array; heading: Float32Array;
  speed: Float32Array; lateralM: Float32Array;       // lateral offset while changing lanes
  lane: Int32Array;                                   // lane idx, -(movement idx + 1) on a movement, or -2147483648 off-lane
  poseLane?: Int32Array;                             // >=0: authoritative parking pose, reference lane for layer/height
  state: Uint8Array;                                  // 1 driving, 2 queued_destination, 6 in_lot
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
           completed: number; failed: number };       // vehicle trips; whole walks counted separately
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
   connector lane; `no_route` fails the trip without spawning. TASK-112 holds person car trips
   until their access walk arrives. Local walk trips use the walker path; bus, rail and walks
   with a gateway end fail with `unsupported_mode` (T15).
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

Queue-head detours (TASK-121). A driving car first on its lane, within `decisionDistanceM`
of `stopM`, accumulates `headDetourS` while below 0.1 m/s and its planned exit is refused
for `exit-full` or `box`. A red signal pauses the timer; movement, becoming a follower,
changing the lane plan or a live patch resets it. This also checks an approach grant or
an automatic continuation whose exit has filled since admission. After 45 s by default,
it tries other movements from its current lane, excluding `neverGreen`, class/access bans
and movements in its trip's `attemptedFallbacks`. A candidate needs room on its exit now
and a route from that exit to the current destination connector. The lowest remaining
route cost wins, with movement index breaking ties. It releases any approach grant and
requests the chosen movement through ordinary signal, gap and conflict arbitration.
Taking it uses the existing `missed_turn` fallback and reroutes on the next lane, without
spending a congestion replan. After the delay it remains eligible as room opens; an
unsuccessful search does not restart the delay. Without an alternative it keeps waiting;
TASK-077 remains the last resort. Snapshots and the hash keep their existing per-vehicle fields (which do
not contain the other per-vehicle timers).

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

Pedestrians (TASK-111, `sim/walkers.ts`). `Scenario.walkers?: { fromPlaceId, toPlaceId,
perHour }[]` is a test source: a Poisson stream per source over the scenario, from
`createRandom(seed).derive('walkers').derive(source)`, walker ids in spawn order. A source
without a walk route counts its walkers as spawned and dropped. TASK-112 reserves all test
source ids first, then allocates person walker ids monotonically after them without reuse;
adding person walkers leaves the test sources' ids and seeded departures unchanged. Without
test sources or person demand the engine creates no walker state. Walkers advance in the fixed
step at `walkSpeedMps` (1.4 m/s; `walkStepsFactor` 0.6
on steps), right after the signals in each step, and never collide with each other. A crossing run
is the consecutive crossing legs of one crossing (one node and arm, or one road's midblock
zebra); a walker waits at its kerb (state waiting) and steps out (state crossing) once

- at a signal, every signal leg of the run has walk green for at least the run's length at
  walking speed plus `walkClearanceS` (2 s), and
- every vehicle that reaches a crossed lane up to its span (on the lane, on a movement into it,
  or on that movement's approach planning it, two levels upstream within 100 m) has passed the
  span (rear beyond it), or stands, or can stop before it at its class `bMps2` with `minGapM`
  to spare; a vehicle over the span, or that turned off the lane with its rear still over a span
  at the lane end, keeps the walker waiting.

A waiting walker that would step out but for the traffic (any zebra walker; a signal walker
with enough walk green), and a crossing walker for each span it has not passed by
`crossingClearM` (1 m), hold those lanes: the span's near edge is a standing obstacle for every
vehicle whose front is still short of it and that can stop before it at `bMps2` (its own lane,
its planned movement's exit lane and the next route lane, within 100 m), and the commit clamps
such a vehicle like an ungranted stop line (`edge - minGapM`, or where it stands). A vehicle too
close to stop passes. A walker already inside a lane's band holds even a vehicle that cannot
stop comfortably (counted in `hardStops`); a crossing walker does not enter a lane's band while
a vehicle is over its span or will not stop for it. These give the zebra rule, the turning
yield at signals (movements into an arm with walk green) and gate 4's invariant: no vehicle body
overlaps a span while a walker is inside it on that lane. TASK-140 (B59): a crossing link meets
every lane of a road end that draws stripes at the stripes' centre (section 5.6), so each span
covers the stripes, the stop line (`farM - 0.5`) stays behind it, and a walker waits at the
stripes' end, where the kerb link from a mapped kerb node meets the crossing (kerb links are not
crossing legs).

Once a walker has spawned, the hash appends, per spawned walker in id order, `[id, state, leg,
round(position along leg or run * 100)]`, with the trip-leg code for person walkers. `Metrics.walkers` reports
spawned, completed, dropped and active walkers, mean walk time, mean wait and crossings by
crossing kind, vehicles that came to a stop for a walker and the time they lost against desired
speed while yielding (zebra; signal), hard stops and peak active walkers. Snapshots carry
`walkers` (id, position 0.35 m right of the walking direction, heading, state, grade,
`tripLeg`: 0 test, 1 access, 2 egress, 3 whole walk); `inspectWalker(id)` returns route,
state, waits, `personId`, `tripId` and the named trip leg. A live edit keeps walkers by link id and walk green by the patched
signal epochs; a walker whose remaining route lost a link reroutes from where it stands, and is
dropped when its own link is gone or no route remains.

TASK-112 keeps person journeys in `sim/persons.ts`, leaving parking choice and stock in
`sim/parking.ts`. A local private car trip starts with an access walk from the origin's walk
anchor to its parked car. Strip slots and lot stalls project to a walk link within 30 m,
otherwise use their facility anchor; garages use their connector anchor. The queued car
becomes ready only when the walker arrives. Parking completes the drive leg and starts an
egress walk to the destination; the person trip completes at the building. A dependent trip
waits for this arrival. Gateway ends have no walk leg. Vans, trucks, buses and through trips
have no occupant or person legs. A local walk-mode trip is one whole-walk leg; a missing route
fails as `no_walk_route`.

The walker spawn API accepts a routed path, departure time, places, person/trip owner and leg,
and reports arrival or a dropped walker through its callback. Person routes cache by their
place/parking anchors. A missing access or egress route advances the person invisibly in a
straight line at walking speed; it counts a fallback with leg, place, facility and reason,
and the drive continues. A failed drive ends the person journey without an egress walk.
Live edits reroute active walkers through the same TASK-111 patch path.

Vehicle accounting retains drive completion. Whole-walk requests are excluded from vehicle
trip counters; their outcomes and `no_walk_route` failure reasons remain available.
`Metrics.persons` adds door-to-door `started`, `completed`, `failed`, `walkTripsCompleted`,
`walkTripsFailed`, access/egress `{ count, meanTimeS, meanDistanceM }`, `walkFallbacks` and
grouped `fallbacks`. Person state and leg progress participate in the deterministic hash.

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
private and through trips retain purpose through. Walk-mode trips keep car/private metadata
but travel on foot; bus, rail and gateway-ended walks fail as unsupported. Saved trips missing labels parse as car/private, or through
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
  agenda transition, mode `car` for persons with a car and `walk` for those without one.
  TASK-112 simulates local walks and derives access/drive/egress legs from parking at runtime;
  `TripRequest.legs` retains the single planned leg. Population
  draws use `DemandConfig.seed`; scheduling draws use `Scenario.seed`; both derive a
  sub-stream per person id, so adding a place does not reshuffle existing persons.
- Trips are not clipped to the scenario window. The sim releases a trip whose `departS` is
  before `startS` at `startS`; a trip after `endS` stays pending in the counts.
- TASK-102 local car trips choose the destination's own admissible garage first, then public
  garages by straight-line walking distance, within `parkingSearchRadiusM` (default 400 m)
  before those beyond it. Each candidate must have room and a class/purpose-feasible route.
  Choice happens at departure and capacity is checked again at the entry; a full entry sends
  the car cruising to the next reachable candidate. Exhaustion fails as `no_parking`. Room at
  departure is a forecast: when every admissible candidate is full, the car heads for the
  first one with any slots, and the entry check decides (lead, TASK-102 merge: a morning
  where every home garage is full until its residents leave failed every trip). An inferred
  garage whose capacity is still inferred compiles with at least its place's current
  population and jobs as slots, so its nameplate always holds the initial stock, and it never
  turns a car away: not every owner parks there, and mode choice will thin car demand
  (owner, 2026-11-08, after a 1 200-slot inferred office garage failed 800 of demo A's 2 000
  commuters). Mapped capacities and capacities set in the inspector are hard limits.
  Search time starts on entering the search radius for a fallback, or when an entry is
  rejected, and ends on parking; parking choice still uses straight-line walking distance.
  TASK-112 records the actual walk time and distance separately. A person's next car trip
  waits for the preceding person journey's arrival and leaves from the parked facility,
  not the activity place. Gateway trips never park at their gateway end. Places with no
  facilities retain legacy connector admission, including zero-demand event portals.
- Validation summary (Gate 3 UI): trips by place and hour, total trips, mean length, queued
  unspawned, completed, failed by reason.

TASK-128 station riders (`demand/stations.ts`, constants in `demand/rider-profile.ts`). After
through and event trips, `scheduleTrips` appends S-Bahn riders: walk-only persons outside the
population, with no household, car or parking. Every S-Bahn stop over the day (TASK-127's
timetable, `stationArrivals` in `network/trains.ts`) at a platform listed by a station place
brings riders who get off: commuters by the train's arrival hour (05:00 10, 06:00 30, 07:00 50,
08:00 50, 09:00 30, 10:00 15 per stop), visitors 10 per stop from 11:00 to 21:59, none from
22:00 to 04:59; at full population, scaled by `personsPerResident`, fractional counts rounded by a
seeded draw per stop (`riders` stream keyed by the stop). Main-line trains have no stops and
bring none. A rider is `rider:<station>:<platform>@<arrival second>:<i>`. The walk out, station to
destination, departs at the arrival plus the platform-to-door delay: straight line from the
train's middle to the nearest entrance x 1.3 at the scenario's walking speed (default 1.4 m/s);
the walk itself leaves from the station's walk anchors (its entrances) by the cheapest route. The
destination is a place within 1 500 m straight line of the station, never a gateway, parking
place or the station, by `jobs x exp(-d / 600 m)` for commuters and `attraction x exp(-d / 600 m)`
for visitors; a stop with no eligible place or no entrance brings nobody. The walk back departs at
the walk out's departure + the straight-line walk (x 1.3) + the stay (commuters the scenario's
work duration, visitors a uniform 1 to 3 h) and ends at the station, where the rider boards and
is done. A rider whose walk out would leave before the scenario starts is at the destination
already: only the walk back is emitted. Riders run through TASK-112's person walks unchanged; the
person inspector reads a rider's day from the id and the trips.

TASK-103 extends parking choice: work and school keep own garages first; a seeded person
share `streetParkingShare` (default 0.3) seeks visible parking before their home garage.
Other visits rank admissible strips/lots within the walking radius first, then the own
garage, public garages within the radius, then farther facilities by distance. Public
spaces admit anyone; private/customers spaces admit their destination's visitors. The same
share of initial residential garage stock moves to nearby visible facilities, nearest first
up to capacity; eligible spaces within each facility are shuffled with the scenario seed;
explicit starting occupancy wins. Imported inferred garages retain their existing unlimited
admission rule. Owned lots and garages share one initial resident-stock
budget. TASK-118 also chooses each initial person's exact space by a seeded draw rather
than compiled order. At a lot entry, free/unreserved stalls are scored by local path length
plus straight-line walking distance to the destination. Stalls within `stallChoiceSlackM`
(default 25 m) of the best score are equally likely, on a per-vehicle scenario-seeded stream;
reservation is immediate. The inspector records the space, score, best score and rank.
Destination-only road access retains spaces for local parking trips. No fee,
time-limit or conditional-tag rules are modeled.

TASK-122 derives departure reachability once per compiled city, vehicle class, delivery
purpose and origin access zone. It reuses routing's legal movement graph and selects its
largest strongly connected components (including equal-size ties, so small one-way fixtures
do not depend on an arbitrary component). Private/destination roads are legal only in the
origin zone, and delivery roads only for delivery trips. Reverse propagation includes the
distance needed for each lane change, so a late strip slot cannot borrow an upstream exit.
A lot stall also needs a local circulation path to a usable outbound connector.

Residential street-stock transfers and first-trip origin allocation skip unusable spaces;
virtual garages need a usable exit too. Assigned cars stay in their garages or use the next
eligible space in the existing choice order. Explicit background occupancy is retained.
Arrival choice prefers an available, reachable space within the search radius with a usable
departure when the person's linked next car trip starts at that activity place, including
trips beyond the run window. If none is available, it retains the existing parking choice
instead of cruising for an occupied safe space or extending the search. The chosen fallback
also applies during space admission and manoeuvres. Reachability is tested from the car's
current lane and position, not the originally chosen garage's arrival road. While searching,
the engine checks once per simulated second for a filled safe target or newly available
alternatives to a fallback. A temporarily rejected facility may qualify again once it has a
free safe space. Keeping the same target preserves the installed route. Terminal visits retain their
existing choices. Owner exception (TASK-122): arrivals from gateways retain their existing
parking choices while gateway routing is deferred. The preference still applies to local
arrivals whose next trip is gateway-bound. The next trip's class and purpose determine
the departure requirement; ranking, walking distance, search radius and stall-choice draws
are unchanged. `Metrics.parking.parkedWithoutExit` counts actual arrivals with a later car trip
whose admitted space (or virtual garage) has no usable departure, including gateway visitors.
Forecasts, rejected choices, terminal visits and starting stock do not increment it. Arrival
uses the current compiled reachability, so a live edit that opens an exit before parking
avoids the count. Reachability is not saved and is rebuilt after live edits; existing parked cars keep their spaces and
their existing departure behavior.
The owner accepts empty default blocked strips to preserve the residential street-share
budget; explicit background occupancy remains unchanged.

Lead follow-up (2026-11-08). Starting stock holds the cars of the persons demand
generation makes: `ceil(round(residents × personsPerResident) × carShare)` per home, not the
full population, so every visible parked car belongs to someone; a resident whose moved
street car a neighbour took starts from the home's inferred garage while the home has cars
left. A lot whose own place has no demand (an OSM lot imports as its own `parking` place)
serves the places within 200 m as their car park: a customers lot the visitors of
non-residential places, a private lot also their workers and residents (and their share of
starting stock). It ranks first for those destinations, and a lot whose free stalls are all
spoken for by cars on their way drops out of the choice.

## 10. Engine host

Lives in `src/host`. The worker owns the engine, the route provider and link costs. The main
thread owns the editor and the compiled city for rendering and picking; it sends the compiled
city (structured clone) to the worker on load.

```ts
type HostRequest =
  | { id: number; type: 'load'; compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario; population?: Person[] }
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
  | { id: number; type: 'inspect'; vehicleId: number }
  | { id: number; type: 'inspectWalker'; walkerId: number }
  | { id: number; type: 'inspectPerson'; personId: string }
  | { id: number; type: 'hash' };
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
- TASK-112 includes saved population in interactive, restarted and comparison loads. Walker
  buffers, including `tripLeg`, transfer with the existing snapshot. `inspectPerson` returns
  id, home/work, agenda, journey state, current leg, current car facility/space and trip history.
  Each trip has places, scheduled departure, state, failure reason and legs; each leg has kind,
  state, start/arrival times, distance and walker id. Metrics and headless results retain the
  person metrics alongside vehicle, parking and crossing metrics.
- TASK-102 adds `parkingOccupancy`, a separate count array in compiled facility order,
  transferred with heat at most once per 500 ms; load/restart/patch resets the throttle.
  Minute metrics history also records occupancy keyed by facility ID. Parking metrics expose
  current stock, successful parking arrivals, mean search time and counted failures.
  Inspect/trip outcomes and CSV include facility ID, walking distance and parking search time.
- TASK-100: the class-index `vclass` buffer transfers with every vehicle snapshot. Inspector
  replies carry class and purpose, headless metrics preserve `completedByClass`, and trip CSV
  records include `class` and `purpose` columns after destination.
- TASK-103 adds a separate changed-only `parkedCars` set: bit-packed occupancy in
  `parkingSpaces` order, plus class, trip vehicle ID (0 for initial stock) and colour arrays
  indexed by space. A revision changes on stock changes and patches; load/restart resets
  delivery. Both views retain the set between deliveries and remap by facility/local space
  when displayed geometry is ahead of a restart-required run. Garages have no visible spaces.
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

TASK-126 draws rail from shared `render/rail-geometry.ts` triangles in both views: muted main
line beds, thinner sidings, cool station-serving/light-rail/subway beds, twin street-running tram rails,
switch discs, platforms and small station discs. Same-grade asphalt clips non-tram paint;
each 2D grade caches rail beds below roads and a separate tram-rail batch above road and junction surfaces, below crossing paint. 3D uses one vertex-colour batch with mapped grades
and existing terrain/height interpolation; tunnels follow grade visibility. The default-on
Rail layer is independent of Surroundings. Imported network rails replace context rail/tram
lines permanently, so turning Rail off cannot restore the old lines. Tracks/platforms and
station markers are pickable in both views; inspectors expose track kind/name/service/length,
platform served tracks and station platform/entrance counts. Tracks have no editing tools.

TASK-135 gives trams their own look from `style.tram`, railways unchanged. An embedded track is
two dark grooved rails at the 1 435 mm gauge, flush with the road, in the tram-rail batch above
road and junction surfaces and below crossing paint. An own bed is a 3.2 m bed (green grass,
warm grey paving, stone grey ballast) clipped by same-grade asphalt like railway beds, drawn
below roads; its rails lie on the bed, and where the bed gives way to asphalt they continue as
grooved street rails. Ballast beds show sleepers every 0.9 m with the detail rails (from
3 px/m); grass and paved beds show none. 3D raises each part: the bed to 0.12 m with darker
sides (below the 0.14 m kerbs, so median islands cover it as in 2D), sleepers 0.13 m, rails
0.17 m on the bed and 0.06 m in the street; grass beds take a per-vertex procedural tone in the
same vertex-colour batch. The track inspector names a tram's form and whether it was inferred.

TASK-132 draws rail at its grade (section 5). 2D: tunnel and covered track keep their faded bed
in their grade and add a dashed outline (0.3 m outside the bed, 3 m dashes) in the tram-rail
batch of the ground grade, above road surfaces and ground-level beds, so a tunnel under a track
field or a road shows; tunnel portals get a bar across the track with its ends turned out to the
ground; bridges get a deck 1 m beyond their beds, one union per grade, outlined in the deck-edge
colour, below their beds. Trains hide on tunnel and covered track only, so ground track at a
negative `layer` shows its trains. 3D: beds follow the profiles above the terrain; tunnel track
is a separate batch inside a translucent tube (walls 1 m beyond the bed, roof 6.3 m over the
rail), both shown only with See below ground, which also reveals the trains in it (they hide on
tunnel track otherwise; covered track stays visible at grade). Portals are two jambs and a
lintel at the tunnel's end, up to a headwall 0.9 m above the ground; ground track below grade
runs between cutting walls that end in 0.9 m parapets; bridges have a 1 m slab with parapets
on piers every 20 m; ground track raised toward a bridge stands on 1:1.5 embankments. Tunnel
tracks are not pickable in 3D unless See below ground is on.

TASK-127 draws articulated red/white S-Bahn and blue/grey main-line cars in grade-local 2D
layers and two instanced 3D batches. Train poses use snapshot/simulation time only; paused
trains request no frames. Bridges occlude lower trains; tunnels hide train bodies (3D reveals
them with See below ground). Rail hides tracks and trains together. Picking exposes train
kind, route ends, station stops and next stop/exit; no train state enters car/walker counts,
traffic controls, routing, demand or simulation hashes.

TASK-133 dresses stations (places with `station`, their rail platforms and entrances) in both
views from one pure placement, `render/station-furniture.ts`. It is display-only: no schema,
simulation, routing, demand, walk or timetable change, and the Rail layer hides it with the
tracks. A polygon platform gets a centreline and half widths from slices across its principal
axis (a mapped platform edge is the 2 m strip the rail layer draws, too narrow for anything).
Every item is an oriented box whose centre, corners and side midpoints lie inside the polygon
and at least 0.6 m from its edge, or it is dropped. Name boards (station name, 4.4 m) stand on
the centreline at both ends and every 40 m or so. Shelters are canopy bays of at most 12 m where
a mapped `building=roof` or `train_station` overlaps the centreline for 3 m or more (the 3D
view already draws that roof, so it adds only posts); without one a 10 m shelter stands near the
middle. A platform's `covered`, `shelter`, `bench` and `bin` tags are not in `City`, so they are
not read. Benches and bins come every 25 m, jittered and put on a side by a generator seeded
from the platform id. One display per platform stands near its middle, clear of boards and
canopies. It shows the next three departures from `platformDepartures` (a read-only helper in
`network/trains.ts`) at the simulation time: line kind, compass direction of travel (the
timetable names no destinations) and minutes, "now" while the train stands. An entrance sign
(a train seen from the front, no operator mark, with the station name) stands at
each entrance node, facing away from the station. 2D draws symbols from 1.5 px/m, benches and bins from 4,
and text from 6 to 12 px/m, only for the at most 24 labels nearest the view centre. 3D batches
posts, roofs, benches and bins as instanced meshes, boards and entrance signs as one instanced
mesh per station name with a cached canvas texture, and each display as a mesh whose canvas
repaints, when it is in view, at most once per 30 simulated seconds.

TASK-137 draws tram stops (`City.rail.tramStops`) in both views from one pure placement,
`render/tram-stops.ts`, display-only like station furniture and hidden with the Rail layer. The
island is the mapped platform's shape (a line draws 2 m wide, as the rail layer does) or the
generated ring, with a curb edge and a tactile strip 0.4 m wide, ribbed every 0.6 m, along the
kerb facing the track. Items are oriented boxes at least 0.25 m inside the island: a shelter of 8 m
(12 m where `covered=yes`; none where `shelter=no`) at the island's middle on its back side, away
from the track, narrowed to leave 0.9 m to walk; a name board at both ends; and one display of
1.2 m near the shelter showing the name and the lines. A thin box across the track at each halt
marks where trams stop. 2D draws the island from 1.5 px/m, the marking from 3, the strip and
furniture from 4, and the name above the lines on the island's clear back half from 12, at most
12 labels. 3D raises the island 0.25 m (kerb sides a shade darker), lays the strip and marking
(0.145 m on a bed, 0.075 m in the street) in the same vertex-coloured mesh, and instances posts,
canopies, a translucent back wall, and one panel mesh per board name or display text with cached
canvas textures. Mapped islands are the rail layer's platforms and pickable as such, and the
platform inspector names the stop, its lines and tagged amenities; generated islands are not
pickable.


TASK-111/112: the default-on Pedestrians layer (shown for person demand or test pedestrians) draws
walkers as dots at least 2.4 px across in their grade's group above vehicles in 2D (warmer
while waiting at a kerb), and as instanced upright capsules in 3D at ground plus 5 m per grade
and the 0.14 m curb. Both kerb ends of each signalised crossing get a small walk light, green
while `walkGreenS` is positive: rounded squares among the signal heads in 2D (the Signals
toggle and zoom fade apply), heads on 2.4 m posts in 3D. Walkers are pickable in both views; the
walker inspector shows places, state, waits and route length, and 2D draws the selected
walker's route. Walker frames follow the snapshot rule of TASK-115: each new snapshot while
playing requests a frame. The demand sheet lists the test pedestrians (from, to, per hour) with
add, remove and rate edits; they are scenario inputs, so the run waits for a restart, and
Undo/Redo step through them and city edits in one order. The signal inspector lists each
phase's walk groups (derived or set by hand, with Derive to clear), toggles them from checkboxes
or the schematic's crossing lines, and adds an exclusive pedestrian phase.
`window.cityflows.setWalkers` sets the source and restarts (test mode).

TASK-112 opens a person's view when their walker is selected or their occupant line is clicked
in the vehicle inspector. It shows home/work, agenda times, current leg/state, parked car and
each started trip's leg times and distances. Vehicles without persons show no occupant.
The demand sheet adds door-to-door and whole-walk counts, mean access/egress walks, grouped
fallbacks and the existing crossing/vehicle-delay counts. Person walkers use the same 2D dots
and 3D capsules as test walkers, with the same picking and snapshot update path.

TASK-103 adds a default-on “Parked cars” layer in both views, independent of stall paint and
facility occupancy labels. TASK-118 draws in-lot travel and strip manoeuvres in the existing
moving-vehicle layer. A nonnegative snapshot `poseLane` identifies a parking pose: both views
use its supplied position/heading without projecting or extrapolating it along a road.
`lane` is the off-lane sentinel while a car is inside a lot or has cleared a strip lane;
`poseLane` supplies only the grade/layer reference. Parked sprites leave when departure starts
and appear only after the pull-in ends. Snapshot changes invalidate frames under TASK-115.
Parked class shapes are instanced at compiled space poses,
slightly dimmed, destination-tinted, and pickable (including initial stock without a trip).
Bands draw beside carriageways, with bay ticks only on mapped strips. Derived curbs and
generated lamp positions move to the band's outside edge. The road inspector exposes each
physical side's layout, capacity, access and mapped/inferred origin with undo.

TASK-110 adds independent default-on Sidewalks and Footways layers. Both renderers consume
`render/walk-geometry.ts`: pale paving outside the curb, thinner mapped paths, clipped against
same-grade asphalt and building footprints, with steps hatched. Boolean fragments below
0.005 m² are discarded before triangulation. Existing crossing markings remain unchanged.
Access links and shared living-street links are graph-only. The 2D geometry shares each grade's
static texture cache. In 3D paving follows terrain folds at 0.14 m curb height; steps and bridge
paths interpolate their endpoint grades. Visibility toggles do not rebuild geometry or alter
the city, and roads retain the strongest tone.

`src/render` draws a `CompiledCity` and the latest `VehicleSnapshot` with PixiJS 8:

- TASK-107: `render/street.ts` derives lamps, access-entry signs and broken curb paths once per
  city for both views. Imported lamps retain source positions and tagged heights/mounts.
  Generated lamps use 30 m residential/service or 40 m arterial spacing, 0.5 m outside the
  outer edge. Wide roads share a reference-station grid across both verges, with a half-spacing
  offset even on paired directed roads. No generation on motorway,
  trunk, ramp or negative-grade roads; none within 25 m of an imported lamp, 8 m of a placed tree,
  near junctions/crossings/connectors, or inside road surfaces, buildings or water. Tree input
  excludes lamp points without changing TASK-106's placement. One curb-side access sign marks
  each entering road with changed class access/zone, deduplicated across lanes/classes;
  internal zone roads and open exits have none. Shapes and label textures are drawn in code.
  2D furniture appears above its road grade at street zoom (1.5 px/m), hidden at overview.
  Imported lamp points within 2.5 m of an edge inherit that road height; other points stand on terrain. 3D lamps and signs are
  instanced, with generated lamp bases and signs following their road height; ground-level outer curbs are 0.2 m wide and 0.12 m high, broken at crossings,
  6 m driveway openings and same-grade junction surfaces, following road/terrain heights.
  Overpasses do not cut ground curbs below them. The 3D strips
  simplify both final edge profiles within 1 cm in plan and 1 mm vertically, retaining every gap endpoint. No sidewalks.
  Bus-only lanes receive vector `BUS` glyphs at the start and every 50 m from shared
  `marking-geometry.ts`; the 3D adapter retains 0.025 m paint clearance. Street lights, Signs
  and 3D Curbs default on; BUS uses the Lane markings switch. Counts and placement timings
  are exposed on the map canvas in test mode. Neither canonical network nor compile changes.

- TASK-108: `render/marking-geometry.ts` owns world-metre paint shapes (role-coloured
  polylines with widths and dash metadata, and filled polygons). Road clipping, dash phase,
  approach controls and arrows, continuation seams/tapers, junction guides and crossing
  polygons moved out of the 2D layers; 2D and 3D consume the same shapes. Dash footprints
  are expanded before either renderer draws them. `render/style.ts` holds a `de`/`us`/`uk` theme table, selected per project through
  `City.markingTheme` (or its geography default). The `de` theme remains unchanged: warm white in every role, 0.12 m urban and 0.15 m motorway/trunk lane
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
- TASK-114: both views receive the selected theme through shared paint geometry. US paint
  has double solid yellow opposing centre lines (passing permission is not inferred), 3/9 m
  white lane dashes, white outer edges and yellow left edges on divided roads and ramps.
  UK paint has white centre lines (6/3 m warning lines on primary/secondary/trunk, 3/6 m
  otherwise), 2/4 m white lane dashes and double dashed give-way bars.
  Each theme supplies arrow polygons, guide widths/dashes and gore stripe dimensions;
  UK approach arrows are elongated to 6 m (9 m on fast roads). Edge strokes follow compiled
  tapered lane boundaries; close opposing carriageways share centre paint rather than kerb
  lines. Crossings retain their layout.
  Style switches redraw both views even when compiled identity/version stays unchanged;
  the animation loop and simulation remain unchanged.
- TASK-117: access signs resolve in compiled road order, merging entries with the same street
  group, effective class access and entry rules when they stand within 15 m of each other (the
  far end of a long restricted street keeps its own sign). A later sign advances in 0.5 m steps along its
  own kerb, from the existing 4 m station to at most 12 m (or the edge end). Conservative
  world-metre disc and label rectangles cover all three themes, keeping posts fixed on theme
  switches; posts also keep 1.5 m separation. Unresolved pairs stay at the limit and are counted
  with road indices alongside before/after overlaps, moved and merged counts. Lamps and curbs
  retain their placement. German signs retain their drawing; US uses R5-1 DO NOT ENTER or white
  LOCAL TRAFFIC ONLY / DELIVERIES ONLY / PRIVATE ROAD plates. UK uses diagram 616 or diagram
  619 with Except for access / Except for loading / Private road plates. Both views redraw
  signs through the existing marking-style invalidation path. UK edge colour is chosen by
  road and side: yellow only on the nearside of urban residential/tertiary/secondary/primary
  streets (imported unclassified/living streets use residential); offside/median edges and
  motorway/trunk/ramp edges are white. `edgeLineColor` is the shared TASK-103 merge hook for
  omitting no-waiting paint beside parking strips. German and US paint retain their bytes.
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
- Static geometry is rebuilt when `compiled.version` or the selected marking style changes.
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
  continuing into the next within 30 degrees). TASK-104: a lot's `parking_aisle` road has no
  default crossing and an arm of aisles alone does not count, so a lot entry adds none to its
  street. `Road.crossings` overrides the default per road
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
return; the hidden 2D scene stops drawing while 3D is active. Vehicle raycasting opens the existing
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
TASK-109: Building details defaults on, appears in Layers while Buildings is shown in 3D,
and switches between two prebuilt batches. Off uses the original boxes and colours. Detailed
walls use tagged colour, then a material palette, then the existing tone varied by a stable
footprint hash. Tagged colours mix 28% into the neutral palette so roads stay prominent.
Roofs use tagged colour/material, then muted tile or flat grey. Facade window
bands use wall-distance and height attributes in the shared Lambert shader: one band per
tagged level, otherwise approximately 3 m levels. They fade between 150 and 600 m from the
camera and do not appear on roofs, canopies, garages, sheds, or tall unlevelled industrial walls.
`render3d/roofs.ts` clips planar roof patches to the exact footprint. Gabled, hipped,
half-hipped, pyramidal, skillion, mansard and gambrel roofs require a footprint/minimum
oriented rectangle area ratio of at least 0.85. The ridge follows its long side unless
orientation is across or a downhill direction is supplied. Roof height uses tagged metres,
then roof levels times 3 m, otherwise 35-degree pitch capped at 8 m and half the total height;
explicit values cap at total height minus minimum clearance. Walls end at total height minus roof height, with
boundary infill up to the roof. Untagged roofs stay flat; courtyard, irregular and curved
roof fallbacks stay flat and report their reasons. Courtyard holes remain open. Canopies
have a 0.2 m roof slab above their tagged clearance (3 m default), reserving its thickness
below the eaves, with no facade or gable-end infill.
The scene exposes context build time, plain/detailed building triangles and roof/fallback
counts alongside the existing frame measures for the geometry-shot harness.
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
overlapping ground fills cut away beneath it, preserving islands. TASK-109 closes each
excavated footprint in the ground itself: its floor plus vertical banks along every outer
and inner ring. Bank tops split at terrain cell boundaries and fixed diagonals to meet the
exact rendered surface. Banks survive the coloured-ground overlay, basemap and
Buildings/Building details/Surroundings visibility switches. Raised/tunnel junctions
retain level deck heights; ground junctions follow the terrain. Basemap meshes collapse
the edge-clamped exterior into broad strips rather than tessellating outside the grid.
Only asphalt above ground enters the terrain view's shadow pass. The draped backdrop uses
one opaque pass, or one transparent pass with basemap/below-ground visibility. With no
vehicles, an unchanged camera and layer visibility reuse the
static shadow map; camera changes, layer changes and vehicles refresh it. The visible scene renders on demand (TASK-115).
Camera targets follow
the ground. Terrain off rebuilds the original flat geometry and removes the 2D hillshade;
cities without terrain follow the same path as before. `LayerVisibility.terrain` defaults
on and its control appears only when the city has terrain. The 2D hillshade uses north-west
light at 45 degrees, low opacity, below surroundings in the shared overview texture cache.
3D editing remains out of scope.

TASK-115: each view coalesces visible changes with one scene-owned invalidation flag,
consumed at most once per animation frame. Zoom-dependent marking/sign opacity is applied
before drawing, including after geometry rebuilds; render hooks never leave opacity for a
following frame. Pixi's automatic ticker rendering is disabled;
its scene explicitly renders after camera/resize, city, selection, overlay, layer or snapshot
changes. Vehicles redraw on every playing frame or while their extrapolation age changes,
then settle when paused. The UI does not reapply heat/queues for an unchanged simulation snapshot. The 3D
scene follows the same rule, with MapControls change events keeping damping live, and
setters invalidating layer, signal, selection, terrain and shadow changes. Hidden 2D draws
nothing; returning to it invalidates once. Tile reconciliation runs after view changes,
loads/retries and during fades, and stops after settling. Vegetation detail and caches
refresh in the same frame as their triggering camera/layer changes.

In test mode only, `window.cityflowsRenderContinuously = true` overrides the idle guard
in both views so `cityflows:render` / `cityflows:render3d` keep measuring actual frame cost.
T16, T44, V106 and geometry shots opt in while measuring. The switch is ignored in production.
Test canvases expose `data-frames` (actual draws) and 2D `data-active` (visible view);
V115 proves paused Munich draws zero frames over two seconds in either view.

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

TASK-104 draws each lot surface once, independently of display surroundings. The shared
compiled bay corners draw three thin warm-white edges, open toward the aisle. The 2D
paint fades at overview zoom; 3D paint is split and draped over the terrain triangles like
other ground paint. The default-on “Parking stalls” layer controls paint in both views,
leaving the lot surface visible. No parked vehicles or parking simulation are introduced.

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

TASK-126's queryVersion 8 requests active rail/light_rail/subway/narrow_gauge/tram ways,
railway/public-transport platforms (including multipolygons), station and entrance nodes and
stop areas independently of display surroundings. Rail import runs after existing ID allocation,
clips to the metric bbox, breaks at missing nodes, and splits at shared/tagged railway nodes.
Platform polygons reuse the existing multipolygon assembler. Platforms serve same-grade,
mode-compatible tracks within 5 m of their boundary. A mapped stop area's explicit station
membership wins; otherwise rail platforms match the same normalized station name within 500 m.
Bus/tram platforms do not inherit a rail station by proximity/name alone. Tram tracks then take
their form (section 4) from their tags and the import's compiled road surfaces.

TASK-137 groups tram stops last, after the junction groups have their ids (`osm/tram-stops.ts`).
Stop positions are `railway=tram_stop`, or `public_transport=stop_position` / `railway=stop` with
`tram=yes`; a `public_transport=station` node names a stop and is no halting position, even on the
line. A mapped platform is any rail platform with `tram=yes` (read from the tags, since the rail
layer's `mode` lets `bus=yes` win), or a `railway=platform` that no railway claimed beside a tram
track. It serves the tram tracks within 2.5 m of its edge and takes the stop positions of its name
that lie on those tracks, the nearest platform first; a platform with no stop position is a stop
too. Stop positions left without a platform join the nearest same-name stop within 80 m (a marker
or station node), or make a stop of their own: an island 2.5 m wide and 30 m long is laid beside
the track from 1.4 m off its axis, on the side of a platform node or marker if one is near, else
the side with more room. Two such stop positions of one name on tracks 4.8 to 12 m apart share a
centre island between them. An island is clipped clear of every same-grade road surface and
junction outline and of other tram beds; under 8 m² is no island (`osm_tram_stop_no_island`, an
info). Stop positions outside the area, or over 25 m from a tram track, are left out and listed in
`osm_tram_stop_skipped` infos by node. The Overpass query is unchanged: it fetches the stop
positions on the ways and the platforms, but no route relations, so `lines` come from
`route_ref` or descriptions unless the data carries tram route relations.
 The bundled extracts
append only missing IDs at each original historical snapshot; ATTRIBUTION.txt records queries
and original-file hashes. T62 proves original bytes and lane/movement hashes remain unchanged.


TASK-103 maps `parking:left|right|both` lane/street_side/on_kerb/half_on_kerb/shoulder
and orientation tags, plus legacy `parking:lane:<side>` layouts. Explicit no/no_parking/
no_stopping/separate suppress inference. Sides follow source-way direction, mirrored onto
each directed carriageway's outside curb. Private access/restriction stays private;
other entries are public. Untagged residential/unclassified streets infer parallel parking
on both physical curbs of two-way streets and the right curb of one-way streets, excluding
ramps, bridges and tunnels. Runs clear junction cuts by 5 m, crossings and their approaches,
connectors by 3 m, and restricted/bus-only curb lanes. Bands intersecting buildings shorten
their runs; nearby footprint exclusions are saved so context-disabled layout edits stay safe.
Inference is saved with provenance.

TASK-119 imports `amenity=parking` way/multipolygon areas tagged `parking=street_side|lane|
layby|on_kerb|half_on_kerb` as mapped roadside strips. It chooses the nearest car-permitted
outside curb within 15 m, with its projected run at least 90% of its depth (allowing near-square
or slightly skewed bays). Subdividing the long boundary does not affect matching. Both travel
directions are considered;
side follows travel direction. The area's centreline projection supplies the clipped run.
`orientation` or `parking:orientation` supplies parallel/diagonal/perpendicular, otherwise
depth up to 3/5.5 m selects parallel/angled, then perpendicular. Numeric capacity wins,
otherwise the existing pitches apply. Private/customers access is retained, otherwise public.
Restricted strips infer one existing non-parking owner within 200 m, preferring an identical
name, then a containing footprint, then the nearest centroid with an ID tie-break. Customers
exclude residential owners. This uses canonical `placeId` and existing simulation admission;
without a nearby eligible place the facility remains unowned. Public strips remain unowned.
The mapped polygon supplies the band and slots; its obsolete parking place is removed while
retaining the legacy ID allocation sequence for unrelated entities. Generated road-tag and
inferred strips lose only intervals covered by mapped strips on the same directed curb.
`separate` still suppresses generation. Unmatched areas reuse the surface-lot importer and
inferred driveway, without adding aisle roads. Incomplete or out-of-bounds areas are diagnosed.
This happens only on import; opening an existing project materializes nothing new.

TASK-102 imports `amenity=parking` with `parking=underground|multi-storey`, and buildings
tagged `parking|garage|garages`, from nodes, ways and multipolygons. Numeric capacity wins;
otherwise footprint area times levels / 25 m² estimates slots (levels capped at 20, inferred
capacity capped at 10000). Guessed/capped values are marked inferred. Amenity parking without
access is public; yes/permissive/designated are public, customers stays customers and other
restricted or unlabelled building garages are private. A garage touching an original place
building footprint serves that place. Garage entrance nodes supply entries; otherwise the
nearest car-permitted lane is snapped with the shared connector logic. Disconnected garages
remain mapped and route feasibility excludes them from a particular trip's choices. Implicit
garages are added after building-demand aggregation. Surface lot and aisle import is deferred.

TASK-124 repairs trapped place, garage and lot portals after the original parking layout is
materialized, preserving the vehicle graph, strip bands, slots and their IDs. The importer
and compile diagnostics share the per-zone departure check in `src/network/parking-egress.ts`.
Replacement arrival/departure portals also have a forward path from that core; out-only
portals need only the departure check. All replacements keep 3 m clear of existing
roadside bay centres. Mapped parking replacements are at most 30 m from the footprint
(including its interior), or from a point facility; no connection is invented beyond that
limit and the original portal remains diagnosed. Inferred place portals use the nearest
compatible lane to the place's point or polygon centre. Private and destination portals
remain when their departure check passes. Mapped aisle roads and junctions never move.

When an existing portal fails departure but is reachable by car from its core, it remains
at the same station as `in` and a separate `out` portal supplies the car exit. Only an
unreachable arrival moves. Implicit garages share their place's split portals. The exit
warnings examine only departure portals; a split pair retains ordinary connector reachability.
Saving generated lot entries records `materializedAisleEntries` in provenance. Their unchanged
endpoints and car-only split exits retain the lot's existing pedestrian door, avoiding new walk
shortcuts solely from saving the entries. Moved arrivals can attach to their new curb.

TASK-110 imports footway, pedestrian, path, steps and living_street ways into `City.walk`,
using `footway=crossing` for the crossing kind, positive metre widths, and the existing OSM
bridge/tunnel/layer rules. Present consecutive vertices become links; missing references break
a run, and geometry clips to the bbox. `foot=no` and `access=no` are omitted. Closed pedestrian
ways retain their boundary links; the graph does not add plaza-interior navigation. A
`footway=crossing` way is kept even when its highway tag describes a shared cycleway.
Entrance nodes are retained, matched first by building provenance, then by touching place
footprint; unmatched doors retain `placeId: null`. Walk IDs are allocated after all vehicle
entities, preserving their IDs. Sidewalk tags (`sidewalk`, `sidewalk:both`, per-side overrides)
are reversed for backward directed roads. The Overpass query (version 6 with
TASK-102's garages and TASK-104's lots) adds a separate pedestrian
ways/entrance clause even with surroundings disabled; its drivable selector is unchanged.

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
Time-conditional rules are outside TASK-101; TASK-107 renders its access signs and bus-lane text.

TASK-104 appends surface lots after the original public-road and place import. Closed
`amenity=parking` polygons with `parking=surface`, or absent parking and absent/no building,
become `lot` facilities. Multipolygon inner rings and intersecting building footprints become
stall exclusions. Numeric capacity wins; otherwise capacity is the generated count. Access
maps absent/yes to public, customers to customers, private to private. One touching place
footprint or matching name supplies `placeId`; ambiguous matches remain null. TASK-119 gives
the parking place with the identical OSM source priority over footprint matches for both lots
and garages, so a mapped car park remains a usable destination. Only clipped
parking-aisle sections inside or touching a lot become service roads, at 10 km/h; driveways
and aisles outside lots remain dropped. Original access restrictions and directional/class
overrides are retained; otherwise-public aisle access is inferred as destination-only under
TASK-101, preventing through shortcuts without changing routing or simulation.
Entries reuse mapped public nodes (including consolidated-node provenance). TASK-103 gives
a lot with no reachable aisle one inferred driveway connector on the nearest permitted car
lane within 30 m of its polygon; no vehicle road is fabricated. Only lots without a road
that close retain `parking_unreachable`.
A mapped mouth that would consume an existing place connector remains disconnected with
`parking_entry_unreachable`, preserving the original place and demand. Original roads,
controls, places and their IDs remain untouched. T49 removes
appended aisles, nodes and facilities, normalizes allocator/provenance counts, and proves
the canonical and compiled hashes equal main. Overpass query version 4 appends a separate
parking/aisle clause in both road-only and surroundings queries.

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
   junction. TASK-131 replaces this merge with junction groups. First the controls on
   non-junction nodes move to the nearest junction and degree-two artefacts (a signal's stop
   position) join (`prepareJunctions`); corridors are assigned; then close nodes form groups:
   (a) a median crossing of at most 30 m between the two carriageways of one corridor, (b) a
   complex, two signalised crossings joined by opposite one-way carriageway links of at most
   60 m, (c) any other link of at most `junctionGroupMaxM` (default 30 m) and at most 1.5 times
   the widest road block at its ends; (a) and (c) span at most 60 m. A candidate needs an entry,
   an exit and three street arms; restriction via nodes may join, their restrictions staying at
   the member. Every node keeps its OSM position and its turn rules, and the inner roads stay.
   One signal anywhere in a group makes the group signalised, with one program over its
   entry-to-exit chains. Group ids are allocated last, so they move no other id. Residential/service cul-de-sacs get an inferred turnaround. All inferences appear
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
   TASK-131: at a junction group's member, an entry's arrows are matched against the group's
   exits, reached along the inner roads (no member twice, no road-level ban), with the angle
   between the roads' chords over 20 m from the junction, as at the node the merge made; a
   marked lane may enter an inner road if an exit beyond it takes one of its arrows, in lane
   order. Two one-way carriageways of one name meeting at more than 90 degrees are a U-turn.
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
   TASK-109 also reads `roof:shape`, `roof:height`, `roof:levels`, `roof:colour`,
   `roof:material`, `roof:orientation`, `roof:direction`, `building:colour`,
   `building:material`, `min_height` and `building:min_level` on building ways and
   multipolygons. Metres/feet use the existing dimension parser; clearance prefers
   `min_height`, then minimum levels times 3 m, then 3 m for `building=roof`. Materials
   trim and lowercase. Common colour names and three/six-digit hex normalize; unknown
   colours drop. `quadruple_saltbox` maps to hipped, `saltbox` to gabled, other unknown
   shapes to flat, with grouped mapping counts in `osm_unsupported_tag` diagnostics.
   Roof metadata without a shape retains flat. Direction accepts degrees or compass
   points and normalizes to [0, 360). Building parts remain excluded.
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
    `smoothed:<count>` per road. TASK-131: smoothing moves no node (a degree-two node stays on
    its OSM position and only interior vertices are filleted), and no fillet lies within 30 m of
    a road's end nodes (`SMOOTH_CLEAR_M`). Relaxation (`relaxRoads`) defaults to 0 m: the owner
    asked for no collision model, so roads keep their OSM lines; `separateDual` only pushes a
    corridor's carriageways apart where their lane blocks overlap. Opposite carriageways of one
    road that share no node (one corridor, one name, or one class and `ref` with at most one
    named: Sindelfingen's A 81) are pushed apart the same way only where their blocks overlap or
    leave less than the 0.5 m median, each by its share, eased to nothing over the taper toward
    each end, so no node moves (`pushOverlapping`); such a pair is also a dual-carriageway
    corridor candidate by its `ref`. A median crossing (`joinDividedFeeders`) takes half its
    feeder's lane block as its offset.
12. Realign acute approaches (TASK-068, B31; removed by TASK-131, which keeps OSM geometry:
    `realignRoads` is deleted and acute approaches keep their lines). After smoothing, at every junction node (three
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
TASK-102 adds a separate garage and entrance clause to both queries, TASK-104 the lot
clause, TASK-110 the walk clause and TASK-107 a separate `node[highway=street_lamp]`
surroundings clause (lamps clipped to the bounds with metric height and mounting
retained). Query version 7 invalidates cached extracts missing any of them; the road
selector and restriction closure stay
unchanged. Imports with surroundings disabled fetch roads and garages and bypass the
full-context cache, so they cannot poison it. Nominatim, when used, is limited to one
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
| T24 acute approaches (retired by TASK-131: realignment removed) | importers, network | Munich, Sindelfingen, an acute-Y OSM fixture | TASK-068 |
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
adaptive routing beyond EWMA, editing in 3D, desktop packaging, bicycles, mode choice and
households sharing a car. R7's multimodal readiness is covered by `TripRequest.legs` and
`TripMode` in section 9; nothing in the sim assumes a person equals a car.
