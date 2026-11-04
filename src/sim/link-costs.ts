import type { CompiledCity } from '../network';
import { freeFlowLinkCosts } from '../routing';
import type { SimParams } from '../schema';

export function createLinkCosts(compiled: CompiledCity, params: SimParams, startS: number) {
  const costs = freeFlowLinkCosts(compiled);
  let freeFlow = costs.roadTravelTimeS.slice();
  let total = new Float64Array(compiled.roads.length);
  let count = new Uint32Array(compiled.roads.length);
  let nextUpdateS = startS + params.linkCostIntervalS;

  return {
    costs,
    patch(next: CompiledCity) {
      const times = freeFlowLinkCosts(next).roadTravelTimeS;
      freeFlow = times.slice();
      const nextTotal = new Float64Array(next.roads.length);
      const nextCount = new Uint32Array(next.roads.length);
      for (const road of next.roads) {
        const old = compiled.index.road.get(road.id);
        if (old === undefined) continue;
        times[road.idx] = costs.roadTravelTimeS[old]!;
        nextTotal[road.idx] = total[old]!;
        nextCount[road.idx] = count[old]!;
      }
      costs.roadTravelTimeS = times;
      costs.version++;
      total = nextTotal;
      count = nextCount;
      compiled = next;
    },
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
