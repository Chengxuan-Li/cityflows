/** Simulation parameters (architecture section 8). Defaults live in src/sim/params.ts. */
export interface SimParams {
  dtS: number;
  vehicleLengthM: number;
  idm: { aMps2: number; bMps2: number; headwayS: number; minGapM: number; desiredSpeedSd: number };
  mobil: { politeness: number; thresholdMps2: number; safeDecelMps2: number };
  laneChangeDistanceM: number;
  laneChangeDurationS: number;
  mandatoryUrgencyM: number; // extra margin before a required change becomes forced
  intersection: {
    decisionDistanceM: number;
    gapS: number;
    creepSpeedMps: number;
    zoneMarginS: number;
    boxWaitS: number;
  };
  spawnMinGapM: number;
  linkCostAlpha: number;
  linkCostIntervalS: number;
  rerouteIntervalS: number;
  rerouteHysteresis: number;
  maxReplans: number;
  routeNoise: number;
}
