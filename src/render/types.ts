import type { CompiledCity } from '../network';
import type { City } from '../schema';
import type { Camera } from './camera';
import type { EditOverlay } from './layers/edit-overlay';
import type { Vec2 } from '../geo/vec2';
import type { TrainPose } from '../network/trains';
import type { AircraftVisualPose } from '../sim/aircraft-motion';
import type { GroundVehiclePose } from '../sim/ground-vehicles';

export interface RoadDifference {
  id: string;
  surface: Vec2[];
  vehicles: number;
}

export interface VehicleSnapshot {
  poseLane?: Int32Array;
  timeS: number;
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
  lateralM: Float32Array;
  lane: Int32Array; // lane index, or -(movement index + 1)
  state: Uint8Array; // 1 driving, 2 queued_destination
  vclass: Uint8Array; // schema vehicleClasses index: car, van, truck, bus
  fade: Float32Array; // sprite alpha: 1, falling to 0 before a gridlock respawn (TASK-077)
  walkers?: WalkerSnapshot;
  rail?: { crossings: Uint8Array; railReady: Uint8Array; trains: TrainPose[] };
  signals?: SignalStates;
  aircraft?: AircraftPose[];
  airfield?: AirfieldState;
  /** TASK-316: airside ground vehicles (`sim/ground-vehicles.ts`). */
  groundVehicles?: GroundVehiclePose[];
}

/** TASK-301: the airfield's light state as the sim gives it (`sim/aircraft.ts`), by compiled
 * index: per runway the end (0 or 1) arrivals and departures use (-1: none), the holding
 * positions whose stop bars are off, and the glide slope. */
export interface AirfieldState {
  arrivalEnds: number[];
  departureEnds: number[];
  clearedHolds: number[];
  glideSlopeDeg: number;
}

/** TASK-298: an aircraft as the sim's snapshot gives it (`sim/aircraft.ts`). */
export interface AircraftPose {
  id: number;
  registration: string;
  typeId: string;
  x: number;
  y: number;
  heightM: number;
  heading: number;
  speedMps: number;
  state: string;
  pushbackReadySinceS?: number;
  enginesRunning: boolean;
  onRunway: boolean;
  airborne: boolean;
  gearDown: boolean;
  visual?: AircraftVisualPose;
  stand: string | null;
  runwayEnd: string | null;
  /** Airside edges ahead on its legs. */
  route: number[];
}

/** TASK-170: the signals as the run drives them: each node's phase (-1 without a signal) and
 * stage (0 green, 1 amber, 2 all-red), the phase its amber and all-red lead to (TASK-194), and
 * each walk link's walk light (0 red, 1 green, 2 dark: TASK-252, a crossing no phase serves). */
export interface SignalStates {
  phase: Int16Array;
  state: Uint8Array;
  next: Int16Array;
  walk: Uint8Array;
}

export interface WalkerSnapshot {
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  state: Uint8Array; // 1 walking, 2 waiting at a kerb, 3 crossing
  layer: Int8Array;
  tripLeg: Uint8Array; // 0 test, 1 access, 2 egress, 3 whole walk
}

export interface ParkedCarsSnapshot {
  occupied: Uint8Array;
  vclass: Uint8Array;
  id: Uint32Array;
  hues: Uint32Array;
}

export type Pick =
  | { kind: 'train'; id: string; route: number }
  | { kind: 'aircraft'; id: number }
  | { kind: 'stand'; stand: number }
  // TASK-305: a taxiway or taxilane edge and a holding position, by compiled airside index.
  | { kind: 'taxiway'; edge: number }
  | { kind: 'hold'; hold: number }
  | { kind: 'flight-board' }
  | { kind: 'track'; track: number }
  | { kind: 'platform'; platform: number }
  | { kind: 'vehicle'; id: number }
  | { kind: 'walker'; id: number }
  | { kind: 'parked'; space: number }
  | { kind: 'lane'; lane: number; road: number }
  | { kind: 'node'; node: number }
  | { kind: 'place'; place: number }
  | { kind: 'parking'; parking: number }
  | { kind: 'connector'; connector: number };

export interface RouteOverlay {
  lanes: readonly number[];
  movements: readonly number[];
}

export interface LayerVisibility {
  rail: boolean;
  labels: boolean;
  overheadLines: boolean;
  buildingDetails: boolean;
  parkingStalls: boolean;
  parkedCars: boolean;
  sidewalks: boolean;
  footways: boolean;
  pedestrians: boolean;
  terrain: boolean;
  shadows: boolean;
  roadClasses: boolean;
  vehicleClasses: boolean;
  basemap: boolean;
  context: boolean;
  trees: boolean;
  streetTrees: boolean;
  streetLights: boolean;
  signs: boolean;
  curbs: boolean;
  markings: boolean;
  difference: boolean;
  heat: boolean;
  queues: boolean;
  parkingOccupancy: boolean;
  places: boolean;
  connectors: boolean;
  signals: boolean;
  routes: boolean;
  disconnected: boolean;
}

export const defaultLayers: LayerVisibility = {
  rail: true,
  labels: true,
  overheadLines: true,
  buildingDetails: true,
  parkingStalls: true,
  parkedCars: true,
  sidewalks: true,
  footways: true,
  pedestrians: true,
  terrain: true,
  shadows: true,
  roadClasses: false,
  vehicleClasses: false,
  basemap: false,
  context: true,
  trees: true,
  streetTrees: true,
  streetLights: true,
  signs: true,
  curbs: true,
  markings: true,
  difference: false,
  heat: false,
  queues: false,
  parkingOccupancy: false,
  places: true,
  connectors: true,
  signals: true,
  routes: true,
  disconnected: false,
};

export interface Scene {
  aircraftPosition(id: number): Vec2 | undefined;
  readonly ready: Promise<void>;
  readonly camera: Camera;
  setActive(active: boolean): void;
  /** Supply source geometry to draw place rings and stack grade-separated roads. */
  /** `deferDetails` (TASK-198): trees, street furniture, the walk network, stations, walk
   *  signals and junction guides wait for `drawDetails`, as the landing city's first frame does
   *  while its walk graph compiles. */
  setCity(compiled: CompiledCity, source?: CityGeometry, deferDetails?: boolean): void;
  drawDetails(): void;
  setTiles(enabled: boolean): void;
  setSnapshot(snapshot: VehicleSnapshot, playbackSpeed?: number): void;
  setParkedCars(snapshot: ParkedCarsSnapshot | null): void;
  /** `states`: the snapshot's signal states, in the loaded city's node order (TASK-170). */
  setSignalPreview(loaded: CompiledCity | null, timeS: number, states?: SignalStates): void;
  setSelection(selection: Pick | null): void;
  setMultiSelection(roads: readonly number[]): void;
  setRouteOverlay(route: RouteOverlay | null): void;
  setEditOverlay(overlay: EditOverlay | null): void;
  /** Speed divided by free-flow speed, indexed by compiled road. */
  setHeat(roadSpeedRatio: ArrayLike<number> | null): void;
  setParkingOccupancy(counts: ArrayLike<number> | null): void;
  setDifference(roads: readonly RoadDifference[] | null): void;
  setQueues(snapshot: VehicleSnapshot): void;
  setLayerVisibility(layers: LayerVisibility): void;
  setDisconnected(lanes: readonly number[]): void;
  /** Coordinates are CSS pixels from the top left of the canvas. */
  pick(screenX: number, screenY: number): Pick | null;
  destroy(): void;
}

export type CityGeometry = {
  rail?: City['rail'];
  airport?: City['airport'];
  parking?: City['parking'];
  markingTheme?: City['markingTheme'];
  nodes: City['nodes'];
  roads?: City['roads'];
  places: City['places'];
  geo?: City['geo'];
  context?: City['context'];
  terrain?: City['terrain'];
  /** TASK-198: the mapped walk network, for its grades while the walk graph is deferred. */
  walk?: City['walk'];
};
