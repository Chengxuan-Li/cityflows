import type { Vec2 } from '../geo/vec2';
import type { AircraftCode } from './aircraft';
import type { Provenance } from './city';

/** `lead_in`: a stand's lead-in from the taxi network to its stop position. */
export const airsideEdgeKinds = ['runway', 'taxiway', 'taxilane', 'lead_in'] as const;
export type AirsideEdgeKind = (typeof airsideEdgeKinds)[number];
export const standKinds = [
  'contact',
  'remote',
  'cargo',
  'general_aviation',
  'maintenance',
] as const;
export type StandKind = (typeof standKinds)[number];
export const airsideSurfaceKinds = [
  'apron',
  'runway',
  'taxiway',
  'taxilane',
  'turn_pad',
  'helipad',
] as const;
export type AirsideSurfaceKind = (typeof airsideSurfaceKinds)[number];

export interface AirsideNode {
  id: string; // an:<n>
  pos: Vec2;
  layer: number;
  osmId?: number;
  /** `generated` for a node the import added: a lead-in's root or end, a snapped hold. */
  provenance: Provenance;
}

/** An undirected airside edge (a `oneway` one runs along its line only). */
export interface AirsideEdge {
  id: string; // ae:<n>
  from: string;
  to: string;
  /** Centreline; first point at `from`, last at `to`. */
  line: Vec2[];
  kind: AirsideEdgeKind;
  layer: number;
  /** Mapped `width`, else the code's width (`inferred: ['widthM']`). */
  widthM: number;
  /** The largest aircraft code the edge admits, by rule (null: none clears). */
  maxCode: AircraftCode | null;
  ref?: string;
  name?: string;
  surface?: string;
  oneway?: true;
  /** Runway edges: the runway; lead-ins: the stand. */
  runway?: string;
  stand?: string;
  provenance: Provenance;
}

export interface RunwayEnd {
  designator: string; // '09'
  /** The graph node where the runway's pavement ends and the take-off run starts. */
  node: string;
  pos: Vec2;
  /** The landing threshold: the end itself unless a displaced threshold is mapped. */
  threshold: { node: string; pos: Vec2 };
  displacedM: number;
  /** Direction of travel taking off from this end, local frame (atan2(dy, dx)). */
  heading: number;
}

export interface Runway {
  id: string; // rw:<n>
  ref: string; // '09/27'
  ends: [RunwayEnd, RunwayEnd];
  /** Its edges in order from `ends[0]` to `ends[1]`, each oriented that way. */
  edges: string[];
  lengthM: number;
  widthM: number;
  surface?: string;
  maxCode: AircraftCode | null;
  /** Mapped stopways beyond its ends (paved, not graph). */
  stopways: Vec2[][];
  osmIds: number[];
  provenance: Provenance;
}

export interface HoldingPosition {
  id: string; // hp:<n>
  node: string;
  ref?: string;
  kind: 'runway' | 'intermediate';
  /** The protected runway; null for an intermediate hold. */
  runway: string | null;
  /** Side of the protected runway, looking from its `ends[0]` to `ends[1]`. */
  side: 'left' | 'right' | null;
  /** The edge at the hold that leads to the protected runway. */
  toward: string | null;
  osmId?: number;
  provenance: Provenance;
}

export interface Stand {
  id: string; // st:<n>
  ref?: string;
  kind: StandKind;
  /** The stop (nose) position, and the aircraft's heading there (local frame). */
  pos: Vec2;
  heading: number;
  /** The lead-in path from the taxi network to the stop position, network side first. */
  leadIn: string[];
  gate: string | null;
  maxCode: AircraftCode | null;
  osmIds: number[];
  provenance: Provenance;
}

export interface Gate {
  id: string; // gt:<n>
  ref?: string;
  pos: Vec2;
  terminal: string | null;
  osmId?: number;
}

export interface Terminal {
  id: string; // tm:<n>
  name?: string;
  /** Outer ring then holes, open. */
  rings: Vec2[][];
  /** Terminals within 30 m of each other share a group: a detached terminal is a group alone. */
  group: number;
  osmId?: number;
}

export interface Helipad {
  id: string; // hl:<n>
  pos: Vec2;
  ring?: Vec2[];
  ref?: string;
  name?: string;
  osmId?: number;
}

export interface AirsideSurface {
  kind: AirsideSurfaceKind;
  rings: Vec2[][];
  name?: string;
  ref?: string;
  surface?: string;
  osmId?: number;
}

/** A road crossing an airside edge at grade: a node the road's OSM way shares with the edge's,
 * or a crossing of their lines on one layer. `roads` are the directed roads there as imported (an
 * edit can retire them; `roadOsmIds` and `pos` still name the place), as rail level crossings
 * name their roads by OSM way (TASK-295, for TASK-298's give-way to aircraft). */
export interface RoadCrossing {
  edge: string;
  pos: Vec2;
  roads: string[];
  roadOsmIds: number[];
  /** The shared OSM node; absent for a crossing of lines. */
  osmId?: number;
}

export interface Airport {
  name: string | null;
  iata?: string;
  icao?: string;
  /** The aerodrome's outline, outer ring then holes. */
  boundary?: Vec2[][];
  nodes: Record<string, AirsideNode>;
  edges: Record<string, AirsideEdge>;
  runways: Record<string, Runway>;
  holdingPositions: Record<string, HoldingPosition>;
  stands: Record<string, Stand>;
  gates: Record<string, Gate>;
  terminals: Record<string, Terminal>;
  helipads: Record<string, Helipad>;
  /** Paved areas: aprons, runway, taxiway, turn-pad and helipad areas. */
  surfaces: AirsideSurface[];
  hangars: { rings: Vec2[][]; name?: string; ref?: string; osmId?: number }[];
  windsocks: { pos: Vec2; lit?: boolean; osmId: number }[];
  /** `aeroway=navigationaid`: `kind` is its `navigationaid` value (papi, als, ...), `facing` its
   * `direction` in the local frame, `runway` and `end` the nearest runway end within 1.5 km. */
  approachAids: {
    kind: string;
    pos: Vec2;
    facing?: number;
    runway?: string;
    end?: string;
    osmId: number;
  }[];
  turnPads: { pos: Vec2; node?: string; osmId?: number }[];
  roadCrossings: RoadCrossing[];
}
