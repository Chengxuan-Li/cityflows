import type { CompiledCity } from './types';

export function populateStops(city: CompiledCity): void {
  for (const lane of city.lanes) {
    const road = city.roads[lane.road]!;
    const crossing =
      city.nodes[road.to]!.signal !== null &&
      road.lanes.some((index) =>
        city.lanes[index]!.out.some((movement) => !city.movements[movement]!.neverGreen),
      );
    lane.stopM = lane.lengthM - (crossing && lane.lengthM >= 10 ? 3 : 0);
  }
}
