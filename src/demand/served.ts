import { compile } from '../network';
import { carService } from '../network/car-service';
import type { City, PlaceId } from '../schema';

export type Served = (from: PlaceId, to: PlaceId) => boolean;

/** TASK-155: whether a car can serve a trip with a gateway end at all (`carService`). */
export function servedTrips(city: City): Served {
  if (!Object.values(city.places).some((p) => p.kind === 'gateway')) return () => true;
  const result = compile(city);
  if (!result.ok) throw new Error(`Cannot schedule trips: ${result.diagnostics[0]!.message}`);
  const { index } = result.compiled;
  const { served } = carService(result.compiled);
  return (from, to) => served(index.place.get(from)!, index.place.get(to)!);
}
