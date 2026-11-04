import type { CompiledCity } from '../network';
import type { City } from '../schema';
import type { Camera } from './camera';
import type { EditOverlay } from './layers/edit-overlay';

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

export interface Scene {
  readonly ready: Promise<void>;
  readonly camera: Camera;
  /** Supply source geometry to draw place rings and stack grade-separated roads. */
  setCity(compiled: CompiledCity, source?: CityGeometry): void;
  setTiles(enabled: boolean): void;
  setSnapshot(snapshot: VehicleSnapshot): void;
  setSelection(selection: Pick | null): void;
  setRouteOverlay(route: RouteOverlay | null): void;
  setEditOverlay(overlay: EditOverlay | null): void;
  /** Speed divided by free-flow speed, indexed by compiled road. */
  setHeat(roadSpeedRatio: ArrayLike<number> | null): void;
  /** Coordinates are CSS pixels from the top left of the canvas. */
  pick(screenX: number, screenY: number): Pick | null;
  destroy(): void;
}

export type CityGeometry = { nodes: City['nodes']; places: City['places']; geo?: City['geo'] };
