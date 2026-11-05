import type { SimParams } from '../schema';

export const DEFAULT_SIM_PARAMS: SimParams = {
  dtS: 0.1,
  vehicleLengthM: 4.5,
  idm: { aMps2: 1.5, bMps2: 2, headwayS: 1.2, minGapM: 2, desiredSpeedSd: 0.08 },
  mobil: { politeness: 0.3, thresholdMps2: 0.2, safeDecelMps2: 3 },
  laneChangeDistanceM: 30,
  laneChangeDurationS: 2,
  mandatoryUrgencyM: 10,
  intersection: { decisionDistanceM: 15, gapS: 4, creepSpeedMps: 1, zoneMarginS: 1, boxWaitS: 10 },
  spawnMinGapM: 8,
  linkCostAlpha: 0.3,
  linkCostIntervalS: 60,
  rerouteIntervalS: 120,
  rerouteHysteresis: 0.15,
  maxReplans: 3,
  routeNoise: 0.1,
};
