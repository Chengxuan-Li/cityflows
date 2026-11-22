import type { Vec2 } from '../geo/vec2';
import type {
  Connector,
  Node,
  NodeId,
  Road,
  RoadId,
  Place,
  PlaceId,
  TurnRule,
  Lane,
  RoadClass,
  Control,
  SignalProgram,
  City,
  ParkingFacility,
  ParkingId,
  ParkingAccess,
  ParkingLayout,
  JunctionGroup,
  JunctionGroupId,
} from './city';
import type { AircraftCode } from './aircraft';
import type {
  AirsideEdge,
  AirsideNode,
  HoldingPosition,
  RoadCrossing,
  Runway,
  RunwayOperations,
  Stand,
  StandKind,
} from './airport';

/** TASK-305: a taxiway vertex: an airside node, a point on an edge (split there), or free. */
export type AirsideVertex = { node: string } | { edge: string; atM: number } | { pos: Vec2 };

export type Command =
  | { kind: 'setMarkingTheme'; theme: NonNullable<City['markingTheme']> }
  | { kind: 'restoreCity'; city: City }
  | {
      kind: 'setParkingAttributes';
      parkingId: ParkingId;
      capacity?: number;
      access?: ParkingAccess;
      source?: ParkingFacility;
    }
  | { kind: 'setRoadLanes'; roadId: RoadId; lanes: Lane[] }
  | {
      kind: 'setRoadParking';
      roadId: RoadId;
      side: 'left' | 'right';
      layout: ParkingLayout | null;
      access?: ParkingAccess;
    }
  | { kind: 'setRoadAccess'; roadId: RoadId; access: Road['access'] | null }
  | {
      kind: 'setRoadAttributes';
      roadId: RoadId;
      speedLimitMps?: number;
      roadClass?: RoadClass;
      name?: string | null;
    }
  | { kind: 'setStreetDirection'; streetGroupId: string; direction: 'both' | RoadId } // RoadId = keep only this direction
  | { kind: 'reverseRoad'; roadId: RoadId }
  | { kind: 'setCrossing'; roadId: RoadId; end: 'start' | 'end'; crossing: boolean | null } // null = default
  | { kind: 'setTurnRule'; nodeId: NodeId; rule: TurnRule } // replaces an equal-key rule
  | { kind: 'clearTurnRule'; nodeId: NodeId; rule: Omit<TurnRule, 'allowed' | 'provenance'> }
  | {
      kind: 'setControl';
      nodeId: NodeId;
      control: Control;
      signal?: SignalProgram;
      minorRoads?: RoadId[];
    }
  | { kind: 'setSignal'; nodeId: NodeId; signal: SignalProgram }
  // TASK-131: the owner's case-by-case tools for junction groups.
  | { kind: 'joinJunctions'; nodeIds: [NodeId, NodeId] }
  | { kind: 'leaveJunctionGroup'; nodeId: NodeId }
  | { kind: 'addRoad'; road: Omit<Road, 'id'>; newNodes: Omit<Node, 'id'>[] } // Gate 2
  | { kind: 'deleteRoad'; roadId: RoadId } // Gate 2
  | { kind: 'splitRoad'; roadId: RoadId; atM: number } // Gate 2
  | { kind: 'mergeRoads'; roadId: RoadId; otherRoadId: RoadId }
  | { kind: 'addRamp'; from: { roadId: RoadId; atM: number }; to: { roadId: RoadId; atM: number } }
  | { kind: 'removeRamp'; roadId: RoadId }
  | { kind: 'addRoundabout'; nodeId: NodeId; radiusM: number }
  | { kind: 'removeRoundabout'; nodeId: NodeId }
  | { kind: 'moveNode'; nodeId: NodeId; pos: Vec2 } // Gate 2
  | { kind: 'addPlace'; place: Omit<Place, 'id'> }
  | { kind: 'updatePlace'; placeId: PlaceId; patch: Partial<Omit<Place, 'id' | 'connectors'>> }
  | { kind: 'setConnectors'; placeId: PlaceId; connectors: Connector[] }
  | { kind: 'deletePlace'; placeId: PlaceId }
  // TASK-305: the airside. `maxCode` 'rule' (or absent on an add) derives the code by TASK-295's
  // import rules; a code or null sets it.
  | {
      kind: 'addStand';
      pos: Vec2;
      standKind: StandKind;
      ref?: string;
      maxCode?: AircraftCode | null | 'rule';
    }
  | { kind: 'moveStand'; standId: string; pos: Vec2 }
  | {
      kind: 'setStand';
      standId: string;
      standKind?: StandKind;
      ref?: string | null;
      maxCode?: AircraftCode | null | 'rule';
    }
  | { kind: 'deleteStand'; standId: string }
  | {
      kind: 'addTaxiway';
      edgeKind: 'taxiway' | 'taxilane';
      vertices: AirsideVertex[];
      ref?: string;
      widthM?: number;
      maxCode?: AircraftCode | null | 'rule';
    }
  | { kind: 'splitTaxiway'; edgeId: string; atM: number }
  | {
      kind: 'setTaxiway';
      edgeId: string;
      edgeKind?: 'taxiway' | 'taxilane';
      ref?: string | null;
      widthM?: number | null; // null = the code's width
      maxCode?: AircraftCode | null | 'rule';
    }
  | { kind: 'deleteTaxiway'; edgeId: string }
  | { kind: 'addHold'; edgeId: string; atM: number; runway?: string | null; ref?: string }
  | { kind: 'moveHold'; holdId: string; edgeId: string; atM: number }
  | { kind: 'setHold'; holdId: string; runway?: string | null; ref?: string | null }
  | { kind: 'deleteHold'; holdId: string }
  | { kind: 'setRunwayOperations'; operations: RunwayOperations | null }
  | { kind: 'batch'; label: string; commands: Command[] }; // Gate 2

/** TASK-305: an airport edit: its records set and removed, and the whole of the smaller parts. */
export interface AirportPatch {
  set: {
    nodes?: Record<string, AirsideNode>;
    edges?: Record<string, AirsideEdge>;
    runways?: Record<string, Runway>;
    holdingPositions?: Record<string, HoldingPosition>;
    stands?: Record<string, Stand>;
  };
  remove: {
    nodes?: string[];
    edges?: string[];
    runways?: string[];
    holdingPositions?: string[];
    stands?: string[];
  };
  roadCrossings?: RoadCrossing[];
  runwayOperations?: RunwayOperations | null; // null = none
}

export interface Patch {
  markingTheme?: City['markingTheme'] | null;
  metadata?: Pick<City, 'name' | 'drivingSide' | 'geo'>;
  set: {
    nodes?: Record<NodeId, Node>;
    roads?: Record<RoadId, Road>;
    places?: Record<PlaceId, Place>;
    parking?: Record<ParkingId, ParkingFacility>;
    junctionGroups?: Record<JunctionGroupId, JunctionGroup>;
  };
  remove: {
    nodes?: NodeId[];
    roads?: RoadId[];
    places?: PlaceId[];
    parking?: ParkingId[];
    junctionGroups?: JunctionGroupId[];
  };
  airport?: AirportPatch;
  nextId?: number;
}

export interface HistoryEntry {
  label: string;
  patch: Patch;
  inverse: Patch;
  version: number;
}
