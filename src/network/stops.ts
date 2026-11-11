import { crossingSpan, servedSignal, STOP_CLEAR_M, type CrossingSource } from './crossings';
import type { CompiledCity } from './types';

/** Where an ungranted vehicle stops on each lane (architecture, TASK-072 stop positions). At a
 * served signal (TASK-094, B53) the stop line lies 0.5 m short of the far edge of the crossing,
 * which `crossingPlacement` keeps out of the lane's first half; without a crossing (turned off,
 * or none fits) TASK-072's 3 m before the lane end on lanes of 10 m or more. Elsewhere the lane
 * end: other crossings are decorative. */
export function populateStops(city: CompiledCity, source?: CrossingSource): void {
  for (const lane of city.lanes) {
    // TASK-131: an inner road of a junction group carries no control and no stop line.
    if (city.roads[lane.road]!.group !== undefined || !servedSignal(city, city.roads[lane.road]!)) {
      lane.stopM = lane.lengthM;
      continue;
    }
    const span = crossingSpan(city, lane, true, source);
    lane.stopM = span ? span.farM - STOP_CLEAR_M : lane.lengthM - (lane.lengthM >= 10 ? 3 : 0);
  }
}
