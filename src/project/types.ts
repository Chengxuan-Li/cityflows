import { z } from 'zod';
import { nodeSchema, placeSchema, roadSchema } from '../schema';
import type { City, HistoryEntry, Person, Scenario, SimParams } from '../schema';

export const projectKeys = ['city', 'population', 'scenarios', 'history', 'view'] as const;
export type ProjectKey = (typeof projectKeys)[number];

export interface Project {
  city: City;
  population?: Person[];
  scenarios: Scenario[];
  history?: readonly HistoryEntry[];
  view?: ProjectView;
}

export type OpenResult =
  { ok: true; project: Project } | { ok: false; file: string; error: string };

const placeId = z.string().regex(/^p:\d+$/);
const seconds = z.number().nonnegative();
const distributionSchema = z.object({ meanS: seconds, sdS: seconds });

const personSchema = z.object({
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

const simParamsSchema = z
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
    intersection: z.object({
      decisionDistanceM: z.number(),
      gapS: z.number(),
      creepSpeedMps: z.number(),
    }),
    spawnMinGapM: z.number(),
  })
  .partial() satisfies z.ZodType<Partial<SimParams>>;

const scenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.int(),
  startS: seconds,
  endS: seconds,
  demand: z.object({
    seed: z.int(),
    personsPerResident: z.number().nonnegative(),
    carShare: z.number().min(0).max(1),
    workStart: distributionSchema,
    workDuration: distributionSchema,
    gravityScaleM: z.number().positive(),
    throughTripsPerHour: z.array(z.number().nonnegative()).length(24),
  }),
  simParams: simParamsSchema,
}) satisfies z.ZodType<Scenario>;

const nodeId = z.string().regex(/^n:\d+$/);
const roadId = z.string().regex(/^r:\d+$/);
const patchSchema = z.object({
  set: z.object({
    nodes: z.record(nodeId, nodeSchema).optional(),
    roads: z.record(roadId, roadSchema).optional(),
    places: z.record(placeId, placeSchema).optional(),
  }),
  remove: z.object({
    nodes: z.array(nodeId).optional(),
    roads: z.array(roadId).optional(),
    places: z.array(placeId).optional(),
  }),
  nextId: z.int().nonnegative().optional(),
});

const historyEntrySchema = z.object({
  label: z.string(),
  patch: patchSchema,
  inverse: patchSchema,
  version: z.int().nonnegative(),
}) satisfies z.ZodType<HistoryEntry>;

export const viewSchema = z.object({
  camera: z.json(),
  layers: z.json(),
  selection: z.json(),
});

export type ProjectView = z.infer<typeof viewSchema>;

export const populationSchema = z.array(personSchema);
export const scenariosSchema = z.array(scenarioSchema).min(1);
export const historySchema = z.array(historyEntrySchema);
