import type { GeoReference } from '../geo/projection';
import type { Vec2 } from '../geo/vec2';
import type { RailNetwork } from './rail';

export type NodeId = string; // "n:12"
export type RoadId = string; // "r:12"
export type PlaceId = string; // "p:12"
export type ConnectorId = string; // "c:12"
export type LaneId = string; // derived: `${RoadId}#${laneIndex}`
export type MovementId = string; // derived: `${LaneId}>${LaneId}`
export type ParkingId = string; // "pk:12"
export type WalkNodeId = string; // "wn:12"
export type WalkLinkId = string; // "wl:12"
export type JunctionGroupId = string; // "jg:12"

export type RoadClass =
  'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'ramp';
export const vehicleClasses = ['car', 'van', 'truck', 'bus'] as const;
export type VehicleClass = (typeof vehicleClasses)[number];
export type AccessValue = 'yes' | 'no' | 'destination' | 'delivery' | 'private';
export type Control = 'uncontrolled' | 'yield' | 'stop' | 'signal';
export type DrivingSide = 'right' | 'left';

export interface Provenance {
  source: 'osm' | 'authored' | 'generated';
  osmIds?: number[]; // way or node ids this entity came from
  inferred?: string[]; // attribute names that were defaulted, e.g. 'lanes', 'speedLimit'
}

export interface Node {
  id: NodeId;
  pos: Vec2;
  layer: number; // grade, from OSM `layer` (compiled as CNode.grade); connectivity is by shared ids
  control: Control;
  minorRoads: RoadId[]; // for yield/stop: incoming roads that must yield. Empty = by class.
  turnRules: TurnRule[];
  roundabout?: Roundabout;
  signal: SignalProgram | null; // required when control === 'signal'
  provenance: Provenance;
}

/**
 * TASK-131: nodes joined by short links (`ImportOptions.junctionGroupMaxM`) that are controlled
 * and drawn as one junction. Members keep their positions; inner roads stay real roads. A group
 * is signalised if and only if `signal` is not null: then every member has `control: 'signal'`
 * and `signal: null`, and the group's program runs at all members in lockstep. Members of a
 * group without signals keep their own control, minor roads and turn rules.
 */
export interface JunctionGroup {
  id: JunctionGroupId;
  nodes: NodeId[]; // two or more; a node is in at most one group
  innerRoads: RoadId[]; // directed roads with both ends in the group
  /** Green groups name an entry road (ending in the group, not inner) and an exit road
   * (starting in it, not inner); walk entries name a road end at any member's crossing. */
  signal: SignalProgram | null;
  provenance: Provenance;
}

export interface TurnRule {
  from: RoadId; // incoming road (road.to === node.id)
  to: RoadId; // outgoing road (road.from === node.id)
  fromLane?: number; // lane index on `from`; omitted = all lanes
  toLane?: number; // lane index on `to`; omitted = all lanes
  allowed: boolean;
  provenance: Provenance;
}

export interface SignalProgram {
  turnOnRed?: boolean; // curb-side turn after a full stop; omitted = false
  offsetS: number;
  amberS: number; // follows every phase
  allRedS: number; // follows amber
  phases: {
    durationS: number;
    groups: { from: RoadId; to: RoadId }[]; // green groups
    /** TASK-111: the crossings with walk green, each named by a road end of its arm. Absent =
     * derived: an arm's crossing is green where no movement from the arm is (none in a phase
     * without vehicle groups). Walk groups without vehicle groups: an exclusive pedestrian phase. */
    walk?: { roadId: RoadId; end: 'start' | 'end' }[];
  }[];
}

export interface Lane {
  widthM: number;
  allowed: VehicleClass[];
}

export interface Road {
  id: RoadId;
  from: NodeId;
  to: NodeId;
  /** Grade, independent of endpoint grades; omitted = the lower endpoint grade. Compiled as
   * CRoad.grade, the level of its deck (TASK-175, architecture section 5). */
  layer?: number;
  centerline: Vec2[]; // >= 2 points; first equals nodes[from].pos, last equals nodes[to].pos
  lateralOffsetM: number; // lane block center relative to centerline; positive = right of travel
  lanes: Lane[]; // index 0 = leftmost in travel direction
  roadClass: RoadClass;
  speedLimitMps: number;
  access?: { all?: AccessValue } & Partial<Record<VehicleClass, AccessValue>>;
  name: string | null;
  streetGroupId: string | null; // groups the two directions of a simple two-way street
  /** The carriageways of one street, side by side: the two directions of a two-way street,
   * a divided pair, a dual carriageway (geometry rework). Absent means `streetGroupId`. */
  corridorId?: string | null;
  /** Pedestrian crossing overrides at the road's start and end node (TASK-091): only explicit
   * edits; an absent entry takes the default rule (architecture section 11). Decorative. */
  crossings?: { start?: boolean; end?: boolean };
  /** Sidewalks on each side of the travel direction, from OSM `sidewalk=*` (Phase 2 format,
   * TASK-110): `separate` means a mapped footway runs alongside. Absent = by road class. */
  sidewalk?: { left?: SidewalkValue; right?: SidewalkValue };
  provenance: Provenance;
}

export type SidewalkValue = 'yes' | 'no' | 'separate';

export type PlaceKind =
  | 'residential'
  | 'work'
  | 'retail'
  | 'school'
  | 'station'
  | 'airport'
  | 'parking'
  | 'gateway'
  | 'other';

export interface Connector {
  id: ConnectorId;
  roadId: RoadId;
  lane: number;
  positionM: number; // along the lane, within [0, lane length]
  direction: 'in' | 'out' | 'both'; // 'in' = vehicles arrive here, 'out' = vehicles depart here
  throughputPerMin: number; // max vehicles per minute through this connector
}

export interface PlaceEvent {
  id: string;
  name: string;
  startS: number; // seconds since midnight
  durationS: number;
  arrivals: number; // persons arriving during the event window
  departures: number; // persons leaving during the event window
}

export interface Place {
  station?: { platforms: string[]; entrances: WalkNodeId[] };
  id: PlaceId;
  kind: PlaceKind;
  name: string;
  shape: { kind: 'point'; pos: Vec2 } | { kind: 'polygon'; ring: Vec2[] };
  population: number; // residents (residential, gateway = external commuters)
  jobs: number; // workplaces (work, retail, school, station, airport, gateway)
  attraction: number; // relative weight for non-work visits
  capacity: number | null; // vehicles that can be inside at once; null = unlimited
  connectors: Connector[];
  profile: { arrivals: number[]; departures: number[] } | null; // 24 relative hourly weights
  events: PlaceEvent[];
  provenance: Provenance;
}

/** Phase 2 format (lead, 2026-11-08), used by TASK-102 to TASK-104 and TASK-112. A facility
 * where cars park: a garage in a building (cars vanish inside), a strip along one side of a
 * road, or a surface lot with aisles. Stall geometry is derived at compile, never saved. */
export type ParkingKind = 'garage' | 'roadside' | 'lot';
export type ParkingAccess = 'public' | 'private' | 'customers';
export type ParkingLayout = 'parallel' | 'angled' | 'perpendicular';

export interface ParkingFacility {
  id: ParkingId;
  kind: ParkingKind;
  name: string | null;
  capacity: number; // slots
  access: ParkingAccess; // private and customers belong to `placeId`
  placeId: PlaceId | null; // the place it serves (a building's garage, a shop's lot)
  /** Entries and exits on the road network (garage, lot). A roadside strip has none: cars
   * park from the curb lane of `strip.roadId`. */
  connectors: Connector[];
  shape: { kind: 'point'; pos: Vec2 } | { kind: 'polygon'; ring: Vec2[] } | null;
  strip?: {
    roadId: RoadId;
    side: 'left' | 'right'; // relative to the road's travel direction
    fromM: number; // along the road's centreline
    toM: number;
    layout: ParkingLayout;
    ring?: Vec2[]; // mapped street-side area; absent uses a generated band
  };
  aisles?: RoadId[]; // a lot's `parking_aisle` service roads
  entries?: NodeId[]; // lot nodes shared with a non-aisle road
  /** Source-proven street portals whose local path follows a particular directed aisle. */
  mappedPortals?: {
    connectorId: ConnectorId;
    nodeId: NodeId;
    aisleRoadId: RoadId;
    direction: 'in' | 'out';
  }[];
  exclusions?: Vec2[][]; // courtyards and building footprints beside bands/stalls, including with context off
  occupancyAtStart?: number; // share 0..1 of slots taken at the start of the day; absent = derived
  provenance: Provenance; // `inferred` marks facilities generated where OSM has none
}

/** Phase 2 format (lead, 2026-11-08), used by TASK-110 to TASK-112. Mapped pedestrian ways
 * only; sidewalks along streets and walk links over crossings are derived at compile. */
export type WalkKind = 'footway' | 'pedestrian' | 'path' | 'steps' | 'living_street' | 'crossing';

export interface WalkNode {
  id: WalkNodeId;
  pos: Vec2;
  layer: number;
  entrance?: { placeId: PlaceId | null }; // OSM `entrance=*`; null = not yet matched to a place
  provenance: Provenance;
}

export interface WalkLink {
  layer?: number; // way grade; endpoints may meet a different grade at an abutment
  id: WalkLinkId;
  from: WalkNodeId;
  to: WalkNodeId;
  line: Vec2[]; // >= 2 points; first and last equal the nodes' positions
  kind: WalkKind;
  widthM: number | null;
  provenance: Provenance;
}

export interface GeoSource {
  kind: 'osm' | 'file';
  snapshotDate: string | null;
  attribution: string; // shown in UI and written to the manifest
  importerVersion: string;
  inferredCount: number;
}

export type ContextArea = 'building' | 'water' | 'green' | 'landuse' | 'parking';
export type ContextPoint = 'tree' | 'street_lamp';
export type ContextLine = 'rail' | 'tram' | 'waterway' | 'tree_row';
export type RoofShape =
  | 'flat'
  | 'gabled'
  | 'hipped'
  | 'pyramidal'
  | 'skillion'
  | 'mansard'
  | 'gambrel'
  | 'half-hipped'
  | 'round'
  | 'dome'
  | 'onion';
export type ContextFeature =
  | {
      kind: 'area';
      class: ContextArea;
      rings: Vec2[][];
      sub?: string;
      heightM?: number;
      levels?: number;
      roof?: {
        shape: RoofShape;
        heightM?: number;
        levels?: number;
        colour?: string;
        material?: string;
        orientation?: 'along' | 'across';
        directionDeg?: number;
      };
      colour?: string;
      material?: string;
      minHeightM?: number;
    }
  | {
      kind: 'line';
      class: ContextLine;
      line: Vec2[];
      widthM?: number;
      layer?: number;
      spacingM?: number;
    }
  | {
      kind: 'point';
      class: ContextPoint;
      pos: Vec2;
      heightM?: number;
      crownM?: number;
      sub?: string;
    };

export type MarkingThemeId = 'de' | 'us' | 'uk';

export interface City {
  rail?: RailNetwork;
  schemaVersion: 3;
  version: number; // bumps on every committed edit; caches key on it
  name: string;
  drivingSide: DrivingSide;
  geo: (GeoReference & { bbox: [number, number, number, number]; source: GeoSource }) | null;
  nodes: Record<NodeId, Node>;
  roads: Record<RoadId, Road>;
  places: Record<PlaceId, Place>;
  markingTheme?: MarkingThemeId; // display only; absent = geography default
  context?: { features: ContextFeature[] };
  parking?: Record<ParkingId, ParkingFacility>; // Phase 2; absent = none
  walk?: { nodes: Record<WalkNodeId, WalkNode>; links: Record<WalkLinkId, WalkLink> };
  junctionGroups?: Record<JunctionGroupId, JunctionGroup>; // TASK-131; absent = none
  terrain?: {
    source: string;
    originM: Vec2;
    cellM: number;
    cols: number;
    rows: number;
    baseM: number;
    heights: string;
  };
  nextId: number; // single counter for all id kinds
}

export interface Roundabout {
  radiusM: number;
  ringRoads: RoadId[];
  restore: Pick<Node, 'control' | 'signal' | 'minorRoads' | 'turnRules'>;
}
