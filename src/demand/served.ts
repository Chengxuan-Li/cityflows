import { compile, type CompiledCity } from '../network';
import { carService } from '../network/car-service';
import type { City, PlaceId } from '../schema';

export type Served = (from: PlaceId, to: PlaceId) => boolean;

/**
 * TASK-155: whether a car can serve a trip with a gateway end at all (`carService`). `compiled`
 * must be `city` compiled; without it the city is compiled here.
 */
export function servedTrips(city: City, compiled?: CompiledCity): Served {
  if (!Object.values(city.places).some((p) => p.kind === 'gateway')) return () => true;
  if (!compiled) {
    const result = compile(city);
    if (!result.ok) throw new Error(`Cannot schedule trips: ${result.diagnostics[0]!.message}`);
    compiled = result.compiled;
  }
  const { index } = compiled;
  const { served } = carService(compiled);
  return (from, to) => served(index.place.get(from)!, index.place.get(to)!);
}
