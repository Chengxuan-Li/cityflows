import { z } from 'zod';
import { citySchema, projectNodeSchema, placeSchema, roadSchema } from './city.schema';
import type { HistoryEntry } from './history';

const nodeId = z.string().regex(/^n:\d+$/);
const roadId = z.string().regex(/^r:\d+$/);
const placeId = z.string().regex(/^p:\d+$/);
const parkingId = z.string().regex(/^pk:\d+$/);

export const patchSchema = z.object({
  markingTheme: citySchema.shape.markingTheme.nullable(),
  metadata: z
    .object({
      name: citySchema.shape.name,
      drivingSide: citySchema.shape.drivingSide,
      geo: citySchema.shape.geo,
    })
    .optional(),
  set: z.object({
    nodes: z.record(nodeId, projectNodeSchema).optional(),
    roads: z.record(roadId, roadSchema).optional(),
    places: z.record(placeId, placeSchema).optional(),
    parking: citySchema.shape.parking,
  }),
  remove: z.object({
    nodes: z.array(nodeId).optional(),
    roads: z.array(roadId).optional(),
    places: z.array(placeId).optional(),
    parking: z.array(parkingId).optional(),
  }),
  nextId: z.int().nonnegative().optional(),
});

export const historyEntrySchema = z.object({
  label: z.string(),
  patch: patchSchema,
  inverse: patchSchema,
  version: z.int().nonnegative(),
}) satisfies z.ZodType<HistoryEntry>;

/** Shape of history.json in a project (architecture section 12); versioned apart from the city. */
export const historyFileSchema = z.object({
  historyVersion: z.literal(1),
  entries: z.array(historyEntrySchema),
});
