import type Flatbush from 'flatbush';
import type { Vec2 } from '../geo/vec2';
import type {
  Control,
  DrivingSide,
  NodeId,
  RoadId,
  LaneId,
  MovementId,
  PlaceId,
  ConnectorId,
  RoadClass,
  VehicleClass,
  PlaceKind,
  PlaceEvent,
} from '../schema';

export type CompileResult =
  | { ok: true; compiled: CompiledCity; diagnostics: Diagnostic[] } // warnings and notes
  | { ok: false; diagnostics: Diagnostic[] }; // contains errors

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string; // architecture section 5.5
  message: string; // human readable, names the entities
  refs: string[]; // entity ids
}

export interface CompiledCity {
  version: number;
  drivingSide: DrivingSide;
  nodes: CNode[];
  roads: CRoad[];
  lanes: CLane[];
  movements: CMovement[];
  places: CPlace[];
  connectors: CConnector[];
  index: {
    node: Map<NodeId, number>;
    road: Map<RoadId, number>;
    lane: Map<LaneId, number>;
    movement: Map<MovementId, number>;
    place: Map<PlaceId, number>;
    connector: Map<ConnectorId, number>;
  };
  laneSpatial: Flatbush; // lane segments, for picking and snapping
}

export interface CNode {
  idx: number;
  id: NodeId;
  pos: Vec2;
  radiusM: number;
  setbacks: number[]; // incident roads in compiled index order
  outline: Vec2[]; // closed road-end edges and curb arcs; empty at through nodes
  control: Control;
  movements: number[];
  signal: CSignal | null;
}
export interface CRoad {
  idx: number;
  id: RoadId;
  from: number;
  to: number;
  lanes: number[];
  roadClass: RoadClass;
  classRank: number;
  speedLimitMps: number;
  lengthM: number;
  streetGroupId: string | null;
  surface: Vec2[]; /* polygon for rendering */
}
export interface CLane {
  idx: number;
  id: LaneId;
  road: number;
  lane: number;
  polyline: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
  widthM: number;
  allowed: VehicleClass[];
  speedLimitMps: number;
  left: number; // adjacent lane idx or -1
  right: number;
  out: number[]; // movement idx
  in: number[];
  connectors: number[]; // connector idx, sorted by positionM
}
export type Turn = 'through' | 'left' | 'right' | 'uturn' | 'merge' | 'diverge';
export interface CMovement {
  idx: number;
  id: MovementId;
  fromLane: number;
  toLane: number;
  node: number;
  turn: Turn;
  polyline: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
  conflicts: number[];
  conflictZones: [startM: number, endM: number][]; // parallel to conflicts, along this movement
  priority: number;
  neverGreen: boolean;
  turnOnRed?: boolean;
}
export interface CSignal {
  offsetS: number;
  amberS: number;
  allRedS: number;
  cycleS: number;
  phases: { durationS: number; movements: number[] }[];
}
export interface CConnector {
  idx: number;
  id: ConnectorId;
  place: number;
  lane: number;
  positionM: number;
  direction: 'in' | 'out' | 'both';
  throughputPerMin: number;
}
export interface CPlace {
  idx: number;
  id: PlaceId;
  kind: PlaceKind;
  centroid: Vec2;
  connectorsIn: number[];
  connectorsOut: number[];
  capacity: number | null;
  events: PlaceEvent[];
}
