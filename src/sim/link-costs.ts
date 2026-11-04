import type { CompiledCity } from '../network';
import { freeFlowLinkCosts } from '../routing';
import type { SimParams } from '../schema';

export function createLinkCosts(compiled: CompiledCity, params: SimParams, startS: number) {
  const costs = freeFlowLinkCosts(compiled);
  const freeFlow = costs.roadTravelTimeS.slice();
  const total = new Float64Array(compiled.roads.length);
  const count = new Uint32Array(compiled.roads.length);
  let nextUpdateS = startS + params.linkCostIntervalS;

  return {
    costs,
    // Connectors can start/end a traversal partway along a road. Normalize to a full road.
    record(road: number, elapsedS: number, distanceM: number) {
      if (distanceM <= 0) return;
      total[road] = total[road]! + (elapsedS * compiled.roads[road]!.lengthM) / distanceM;
      count[road] = count[road]! + 1;
    },
    update(timeS: number) {
      while (timeS + 1e-9 >= nextUpdateS) {
        for (let road = 0; road < total.length; road++) {
          const observed = count[road] ? total[road]! / count[road]! : freeFlow[road]!;
          const previous = costs.roadTravelTimeS[road]!;
          costs.roadTravelTimeS[road] = previous + params.linkCostAlpha * (observed - previous);
        }
        total.fill(0);
        count.fill(0);
        costs.version++;
        nextUpdateS += params.linkCostIntervalS;
      }
    },
  };
}
