import type { VehicleClass } from './city';

/** Simulation parameters (architecture section 8). Defaults live in src/sim/params.ts. */
export interface SimParams {
  dtS: number;
  vehicleClasses: Record<
    VehicleClass,
    {
      lengthM: number;
      widthM: number;
      maxSpeedMps: number;
      accelFactor: number;
      decelFactor: number;
    }
  >;
  idm: { aMps2: number; bMps2: number; headwayS: number; minGapM: number; desiredSpeedSd: number };
  mobil: { politeness: number; thresholdMps2: number; safeDecelMps2: number };
  laneChangeDistanceM: number;
  laneChangeDurationS: number;
  mandatoryUrgencyM: number; // extra margin before a required change becomes forced
  cooperativeYieldS: number; // TASK-076: a car held this long for a mandatory change gets a gap
  missedTurnAfterS: number; // TASK-076: then it gives up the change and takes a legal movement
  intersection: {
    decisionDistanceM: number;
    gapS: number;
    creepSpeedMps: number;
    zoneMarginS: number;
    boxWaitS: number;
  };
  spawnMinGapM: number;
  /** TASK-077: a car stalled this long at the head of a jam fades and its trip respawns. */
  gridlock: { respawnS: number; fadeS: number; maxRespawns: number };
  linkCostAlpha: number;
  linkCostIntervalS: number;
  rerouteIntervalS: number;
  rerouteHysteresis: number;
  maxReplans: number;
  routeNoise: number;
}
