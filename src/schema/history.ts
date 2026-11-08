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
} from './city';

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
  | { kind: 'batch'; label: string; commands: Command[] }; // Gate 2

export interface Patch {
  markingTheme?: City['markingTheme'] | null;
  metadata?: Pick<City, 'name' | 'drivingSide' | 'geo'>;
  set: {
    nodes?: Record<NodeId, Node>;
    roads?: Record<RoadId, Road>;
    places?: Record<PlaceId, Place>;
    parking?: Record<ParkingId, ParkingFacility>;
  };
  remove: { nodes?: NodeId[]; roads?: RoadId[]; places?: PlaceId[]; parking?: ParkingId[] };
  nextId?: number;
}

export interface HistoryEntry {
  label: string;
  patch: Patch;
  inverse: Patch;
  version: number;
}
