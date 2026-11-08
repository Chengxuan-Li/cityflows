import { z } from 'zod';
import { vehicleClasses } from './city';
import {
  DEFAULT_CLASS_SHARES,
  vehiclePurposes,
  type DemandConfig,
  type Person,
  type Scenario,
  type TripRequest,
} from './demand';
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

export const tripRequestSchema = z
  .object({
    id: z.string(),
    personId: z.string().nullable(),
    originPlaceId: placeId,
    destinationPlaceId: placeId,
    departS: seconds,
    mode,
    legs: z.array(z.object({ mode, fromPlaceId: placeId, toPlaceId: placeId })),
    vehicleClass: z.enum(vehicleClasses).default('car'),
    purpose: z.enum(vehiclePurposes).optional(),
  })
  .transform((trip): TripRequest => ({
    ...trip,
    purpose: trip.purpose ?? (trip.id.startsWith('through:') ? 'through' : 'private'),
  })) satisfies z.ZodType<TripRequest>;

const distribution = z.object({ meanS: seconds, sdS: seconds });
const classShares = z
  .record(z.enum(vehicleClasses), z.number().min(0).max(1))
  .refine(
    (shares) => Math.abs(Object.values(shares).reduce((sum, share) => sum + share, 0) - 1) < 1e-9,
    'Vehicle class shares must sum to 1',
  );

export const demandConfigSchema = z.object({
  seed: z.int(),
  personsPerResident: z.number().nonnegative(),
  carShare: z.number().min(0).max(1),
  workStart: distribution,
  workDuration: distribution,
  gravityScaleM: z.number().positive(),
  throughTripsPerHour: z.array(z.number().nonnegative()).length(24),
  classShares: z.object({ local: classShares, through: classShares }).default(() => ({
    local: { ...DEFAULT_CLASS_SHARES.local },
    through: { ...DEFAULT_CLASS_SHARES.through },
  })),
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
    parkingSearchRadiusM: z.number().nonnegative(),
    dtS: z.number(),
    vehicleClasses: z.record(
      z.enum(vehicleClasses),
      z.object({
        lengthM: z.number().positive(),
        widthM: z.number().positive(),
        maxSpeedMps: z
          .union([z.number().positive(), z.literal(Infinity), z.null()])
          .transform((speed) => speed ?? Infinity),
        accelFactor: z.number().positive(),
        decelFactor: z.number().positive(),
      }),
    ),
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
    walkSpeedMps: z.number().positive(),
    walkStepsFactor: z.number().positive().max(1),
    walkClearanceS: z.number().nonnegative(),
    crossingClearM: z.number().nonnegative(),
  })
  .partial() satisfies z.ZodType<Partial<SimParams>>;

export const scenarioSchema: z.ZodType<Scenario> = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.int(),
  startS: seconds,
  endS: seconds,
  demand: demandConfigSchema,
  simParams: simParamsSchema,
  walkers: z
    .array(
      z.object({ fromPlaceId: placeId, toPlaceId: placeId, perHour: z.number().nonnegative() }),
    )
    .optional(),
});
