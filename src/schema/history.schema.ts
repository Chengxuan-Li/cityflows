import { z } from 'zod';
import { nodeSchema, placeSchema, roadSchema } from './city.schema';
import type { HistoryEntry } from './history';

const nodeId = z.string().regex(/^n:\d+$/);
const roadId = z.string().regex(/^r:\d+$/);
const placeId = z.string().regex(/^p:\d+$/);

export const patchSchema = z.object({
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
