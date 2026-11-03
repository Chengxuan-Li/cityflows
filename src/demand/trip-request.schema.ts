import { z } from 'zod';
import { placeSchema, type TripRequest } from '../schema';

const placeId = placeSchema.shape.id;
const mode = z.enum(['car', 'walk', 'bus', 'rail']);

export const tripRequestSchema = z.object({
  id: z.string(),
  personId: z.string().nullable(),
  originPlaceId: placeId,
  destinationPlaceId: placeId,
  departS: z.number().nonnegative(),
  mode,
  legs: z.array(z.object({ mode, fromPlaceId: placeId, toPlaceId: placeId })),
}) satisfies z.ZodType<TripRequest>;
