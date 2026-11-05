import { z } from 'zod';
import type { DemandConfig, Person, Scenario, TripRequest } from './demand';
import type { SimParams } from './sim';

const placeId = z.string().regex(/^p:\d+$/);
const seconds = z.number().nonnegative();
const mode = z.enum(['car', 'walk', 'bus', 'rail']);

export const personSchema = z.object({
  id: z.string(),
  homePlaceId: placeId,
  workPlaceId: placeId.nullable(),
  hasCar: z.boolean(),
  agenda: z.array(
    z.object({
      kind: z.enum(['home', 'work', 'school', 'shop', 'leisure', 'other']),
      placeId,
      startS: seconds,
      durationS: seconds,
    }),
  ),
}) satisfies z.ZodType<Person>;

export const tripRequestSchema = z.object({
  id: z.string(),
  personId: z.string().nullable(),
  originPlaceId: placeId,
  destinationPlaceId: placeId,
  departS: seconds,
  mode,
  legs: z.array(z.object({ mode, fromPlaceId: placeId, toPlaceId: placeId })),
}) satisfies z.ZodType<TripRequest>;

const distribution = z.object({ meanS: seconds, sdS: seconds });

export const demandConfigSchema = z.object({
  seed: z.int(),
  personsPerResident: z.number().nonnegative(),
  carShare: z.number().min(0).max(1),
  workStart: distribution,
  workDuration: distribution,
  gravityScaleM: z.number().positive(),
  throughTripsPerHour: z.array(z.number().nonnegative()).length(24),
  chains: z
    .object({
      schoolShare: z.number().min(0).max(1).optional(),
      shopShare: z.number().min(0).max(1).optional(),
      leisureShare: z.number().min(0).max(1).optional(),
    })
    .optional(),
}) satisfies z.ZodType<DemandConfig>;

export const simParamsSchema = z
  .object({
    dtS: z.number(),
    vehicleLengthM: z.number(),
    idm: z.object({
      aMps2: z.number(),
      bMps2: z.number(),
      headwayS: z.number(),
      minGapM: z.number(),
      desiredSpeedSd: z.number(),
    }),
    mobil: z.object({
      politeness: z.number(),
      thresholdMps2: z.number(),
      safeDecelMps2: z.number(),
    }),
    laneChangeDistanceM: z.number(),
    laneChangeDurationS: z.number(),
    mandatoryUrgencyM: z.number(),
    cooperativeYieldS: z.number().nonnegative(),
    missedTurnAfterS: z.number().nonnegative(),
    intersection: z.object({
      decisionDistanceM: z.number(),
      gapS: z.number(),
      creepSpeedMps: z.number(),
      zoneMarginS: z.number().nonnegative().default(1),
      boxWaitS: z.number().nonnegative().default(10),
    }),
    spawnMinGapM: z.number(),
    gridlock: z.object({
      respawnS: z.number().positive().default(180),
      fadeS: z.number().nonnegative().default(5),
      maxRespawns: z.int().nonnegative().default(3),
    }),
    linkCostAlpha: z.number().positive().max(1),
    linkCostIntervalS: z.number().positive(),
    rerouteIntervalS: z.number().positive(),
    rerouteHysteresis: z.number().min(0).max(1),
    maxReplans: z.int().nonnegative(),
    routeNoise: z.number().min(0).max(1),
  })
  .partial() satisfies z.ZodType<Partial<SimParams>>;

export const scenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.int(),
  startS: seconds,
  endS: seconds,
  demand: demandConfigSchema,
  simParams: simParamsSchema,
}) satisfies z.ZodType<Scenario>;
