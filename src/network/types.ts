import type Flatbush from 'flatbush';
import type { WalkGraph } from './walk';
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
  AccessValue,
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
  walk: WalkGraph;
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
  /** Closed junction polygon (TASK-083): the region between the road ends' cuts, the curb arcs
   * and every movement surface; empty at through and continuation nodes. */
  outline: Vec2[];
  control: Control;
  movements: number[];
  signal: CSignal | null;
}
export interface CRoad {
  access: AccessValue[]; // indexed by vehicleClasses
  zone: Int32Array; // per class; -1 outside destination/private zones
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
  corridorId: string | null; // canonical corridorId, else streetGroupId
  surface: Vec2[]; /* polygon for rendering: left edge, then right edge reversed, in travel direction */
  /** TASK-082: the union of the surfaces of the road's corridor (its own when it has none),
   * cleaned by clipper2-ts; outer rings and holes. */
  corridorSurface: Vec2[][];
  /** TASK-082: the reference line the lanes are offset from, in travel direction, untrimmed;
   * shared (reversed) by the roads of a corridor drawn on one centerline. */
  reference: Vec2[];
  /** Station on `reference` of each vertex of the road's lane polylines and surface edges. */
  stations: Float64Array;
  startOffsetM: number; // change from canonical lateralOffsetM at a continuation
  endOffsetM: number;
  /** TASK-089: the lane block's shift to the right of travel from `lateralOffsetM`, by distance
   * along `reference` from the start (end) node every `SHIFT_STEP_M`, where the road converges
   * there with its other carriageway or continues one that does (`convergingShifts`); zero
   * beyond the last value, empty when none. */
  startShift: Float64Array;
  endShift: Float64Array;
}
export interface CLane {
  idx: number;
  id: LaneId;
  road: number;
  lane: number;
  polyline: Vec2[];
  /** The road's reference normal at each polyline vertex: the lanes and edges of a road are
   * offsets along it (TASK-082), also where a converging shift curves them (TASK-089). */
  normals: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
  stopM: number; // ungranted stop line; granted travel continues to lengthM
  widthM: number;
  taperStartM: number;
  taperEndM: number;
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
