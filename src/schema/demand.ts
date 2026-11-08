import type { PlaceId, VehicleClass } from './city';
import type { SimParams } from './sim';

export interface Activity {
  kind: 'home' | 'work' | 'school' | 'shop' | 'leisure' | 'other';
  placeId: PlaceId;
  startS: number;
  durationS: number;
}
export interface Person {
  id: string;
  homePlaceId: PlaceId;
  workPlaceId: PlaceId | null;
  hasCar: boolean;
  agenda: Activity[];
}
export type TripMode = 'car' | 'walk' | 'bus' | 'rail';
export const vehiclePurposes = ['private', 'delivery', 'service', 'taxi', 'through'] as const;
export type VehiclePurpose = (typeof vehiclePurposes)[number];
export const DEFAULT_CLASS_SHARES = {
  local: { car: 0.92, van: 0.08, truck: 0, bus: 0 },
  through: { car: 0.8, van: 0.08, truck: 0.12, bus: 0 },
} satisfies Record<'local' | 'through', Record<VehicleClass, number>>;
export interface Leg {
  mode: TripMode;
  fromPlaceId: PlaceId;
  toPlaceId: PlaceId;
}
export interface TripRequest {
  id: string;
  personId: string | null;
  originPlaceId: PlaceId;
  destinationPlaceId: PlaceId;
  departS: number;
  mode: TripMode;
  legs: Leg[];
  vehicleClass: VehicleClass;
  purpose: VehiclePurpose;
}

export interface DemandConfig {
  seed: number;
  personsPerResident: number; // sampling, 1 = everyone, 0.2 = one in five
  carShare: number; // 0..1
  workStart: { meanS: number; sdS: number }; // default 08:00, 30 min
  workDuration: { meanS: number; sdS: number }; // default 9 h, 1 h
  gravityScaleM: number; // home-work distance decay, default 5000
  throughTripsPerHour: number[]; // 24 values, gateway to gateway (Gate 3)
  classShares?: { local: Record<VehicleClass, number>; through: Record<VehicleClass, number> };
  chains?: { schoolShare?: number; shopShare?: number; leisureShare?: number };
}

export interface Scenario {
  id: string;
  name: string;
  seed: number;
  startS: number;
  endS: number;
  demand: DemandConfig;
  simParams: Partial<SimParams>;
}
