import type { CompiledCity } from '../network';
import type { City } from '../schema';
import type { Camera } from './camera';
import type { EditOverlay } from './layers/edit-overlay';
import type { Vec2 } from '../geo/vec2';

export interface RoadDifference {
  id: string;
  surface: Vec2[];
  vehicles: number;
}

export interface VehicleSnapshot {
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
  walkers?: WalkerSnapshot; // TASK-111: test pedestrians, when the scenario has them
}

export interface WalkerSnapshot {
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  state: Uint8Array; // 1 walking, 2 waiting at a kerb, 3 crossing
  layer: Int8Array;
}

export type Pick =
  | { kind: 'vehicle'; id: number }
  | { kind: 'walker'; id: number }
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
  buildingDetails: boolean;
  parkingStalls: boolean;
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
  buildingDetails: true,
  parkingStalls: true,
  sidewalks: true,
  footways: true,
  pedestrians: true,
  terrain: true,
  shadows: true,
  roadClasses: false,
  vehicleClasses: false,
  basemap: true,
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
  readonly ready: Promise<void>;
  readonly camera: Camera;
  setActive(active: boolean): void;
  /** Supply source geometry to draw place rings and stack grade-separated roads. */
  setCity(compiled: CompiledCity, source?: CityGeometry): void;
  setTiles(enabled: boolean): void;
  setSnapshot(snapshot: VehicleSnapshot): void;
  setSignalPreview(loaded: CompiledCity | null, timeS: number): void;
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
  parking?: City['parking'];
  markingTheme?: City['markingTheme'];
  nodes: City['nodes'];
  roads?: City['roads'];
  places: City['places'];
  geo?: City['geo'];
  context?: City['context'];
  terrain?: City['terrain'];
};
