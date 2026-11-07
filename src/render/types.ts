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
  fade: Float32Array; // sprite alpha: 1, falling to 0 before a gridlock respawn (TASK-077)
}

export type Pick =
  | { kind: 'vehicle'; id: number }
  | { kind: 'lane'; lane: number; road: number }
  | { kind: 'node'; node: number }
  | { kind: 'place'; place: number }
  | { kind: 'connector'; connector: number };

export interface RouteOverlay {
  lanes: readonly number[];
  movements: readonly number[];
}

export interface LayerVisibility {
  roadClasses: boolean;
  basemap: boolean;
  context: boolean;
  difference: boolean;
  heat: boolean;
  queues: boolean;
  places: boolean;
  connectors: boolean;
  signals: boolean;
  routes: boolean;
  disconnected: boolean;
}

export const defaultLayers: LayerVisibility = {
  roadClasses: false,
  basemap: true,
  context: true,
  difference: false,
  heat: false,
  queues: false,
  places: true,
  connectors: true,
  signals: true,
  routes: true,
  disconnected: false,
};

export interface Scene {
  readonly ready: Promise<void>;
  readonly camera: Camera;
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
  setDifference(roads: readonly RoadDifference[] | null): void;
  setQueues(snapshot: VehicleSnapshot): void;
  setLayerVisibility(layers: LayerVisibility): void;
  setDisconnected(lanes: readonly number[]): void;
  /** Coordinates are CSS pixels from the top left of the canvas. */
  pick(screenX: number, screenY: number): Pick | null;
  destroy(): void;
}

export type CityGeometry = {
  nodes: City['nodes'];
  roads?: City['roads'];
  places: City['places'];
  geo?: City['geo'];
  context?: City['context'];
};
