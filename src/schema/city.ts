import type { GeoReference } from '../geo/projection';
import type { Vec2 } from '../geo/vec2';

export type NodeId = string; // "n:12"
export type RoadId = string; // "r:12"
export type PlaceId = string; // "p:12"
export type ConnectorId = string; // "c:12"
export type LaneId = string; // derived: `${RoadId}#${laneIndex}`
export type MovementId = string; // derived: `${LaneId}>${LaneId}`

export type RoadClass =
  'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'ramp';
export type VehicleClass = 'car' | 'truck' | 'bus';
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
  layer: number; // from OSM `layer`; informational, connectivity is by shared ids
  control: Control;
  minorRoads: RoadId[]; // for yield/stop: incoming roads that must yield. Empty = by class.
  turnRules: TurnRule[];
  roundabout?: Roundabout;
  signal: SignalProgram | null; // required when control === 'signal'
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
  phases: { durationS: number; groups: { from: RoadId; to: RoadId }[] }[]; // green groups
}

export interface Lane {
  widthM: number;
  allowed: VehicleClass[];
}

export interface Road {
  id: RoadId;
  from: NodeId;
  to: NodeId;
  layer?: number; // visual grade, independent of endpoint grades
  centerline: Vec2[]; // >= 2 points; first equals nodes[from].pos, last equals nodes[to].pos
  lateralOffsetM: number; // lane block center relative to centerline; positive = right of travel
  lanes: Lane[]; // index 0 = leftmost in travel direction
  roadClass: RoadClass;
  speedLimitMps: number;
  name: string | null;
  streetGroupId: string | null; // groups the two directions of a simple two-way street
  /** The carriageways of one street, side by side: the two directions of a two-way street,
   * a divided pair, a dual carriageway (geometry rework). Absent means `streetGroupId`. */
  corridorId?: string | null;
  /** Pedestrian crossing overrides at the road's start and end node (TASK-091): only explicit
   * edits; an absent entry takes the default rule (architecture section 11). Decorative. */
  crossings?: { start?: boolean; end?: boolean };
  provenance: Provenance;
}

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

export interface GeoSource {
  kind: 'osm' | 'file';
  snapshotDate: string | null;
  attribution: string; // shown in UI and written to the manifest
  importerVersion: string;
  inferredCount: number;
}

export type ContextArea = 'building' | 'water' | 'green' | 'landuse' | 'parking';
export type ContextLine = 'rail' | 'tram' | 'waterway';
export type ContextFeature =
  | {
      kind: 'area';
      class: ContextArea;
      rings: Vec2[][];
      sub?: string;
      heightM?: number;
      levels?: number;
    }
  | { kind: 'line'; class: ContextLine; line: Vec2[]; widthM?: number; layer?: number };

export interface City {
  schemaVersion: 2;
  version: number; // bumps on every committed edit; caches key on it
  name: string;
  drivingSide: DrivingSide;
  geo: (GeoReference & { bbox: [number, number, number, number]; source: GeoSource }) | null;
  nodes: Record<NodeId, Node>;
  roads: Record<RoadId, Road>;
  places: Record<PlaceId, Place>;
  context?: { features: ContextFeature[] };
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
