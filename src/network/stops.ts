import type { City } from '../schema';
import { crossingSpan, servedSignal, STOP_CLEAR_M, type CrossingSource } from './crossings';
import { STOP_POSITION, STOP_POSITION_CROSSING } from './junctions';
import type { CompiledCity } from './types';

/** Where an ungranted vehicle stops on each lane (architecture, TASK-072 stop positions). At a
 * served signal (TASK-094, B53) the stop line lies 0.5 m short of the far edge of the crossing,
 * which `crossingPlacement` keeps out of the lane's first half; without a crossing (turned off,
 * or none fits) TASK-072's 3 m before the lane end on lanes of 10 m or more. Elsewhere the lane
 * end: other crossings are decorative. TASK-255: at a signal's stop position (`STOP_POSITION`)
 * whatever the lane's length, at the node where the signal is mapped at its stop line, and 3 m
 * before it where it is mapped on its crossing (`STOP_POSITION_CROSSING`: Freiburg's r:1078, 5 m,
 * stopped on the cycle crossing, 4.3 m past the painted line; r:838's lanes of 9.7 to 11.2 m
 * stopped at the node or 3 m before it). */
export function populateStops(
  city: CompiledCity,
  source?: CrossingSource & { nodes?: City['nodes'] },
): void {
  for (const lane of city.lanes) {
    // TASK-131: an inner road of a junction group carries no control and no stop line.
    if (city.roads[lane.road]!.group !== undefined || !servedSignal(city, city.roads[lane.road]!)) {
      lane.stopM = lane.lengthM;
      continue;
    }
    const span = crossingSpan(city, lane, true, source);
    const inferred =
      source?.nodes?.[city.nodes[city.roads[lane.road]!.to]!.id]?.provenance.inferred;
    lane.stopM = span
      ? span.farM - STOP_CLEAR_M
      : inferred?.includes(STOP_POSITION)
        ? Math.max(0, lane.lengthM - (inferred.includes(STOP_POSITION_CROSSING) ? 3 : 0))
        : lane.lengthM - (lane.lengthM >= 10 ? 3 : 0);
  }
}
