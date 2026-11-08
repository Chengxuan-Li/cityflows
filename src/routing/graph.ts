import type { CompiledCity } from '../network';
import { isLaneDrop } from '../network/lane-drop';
import type { VehicleClass } from '../schema';
import { vehicleClasses } from '../schema';
import { movementPenaltyS } from './costs';

interface RoadEdge {
  to: number;
  penaltyS: number;
}

export interface RoadGraph {
  roads: RoadEdge[][];
  outgoing: number[][];
  allowed: boolean[];
  penalties: Float64Array;
}

function buildGraph(compiled: CompiledCity, vehicleClass: VehicleClass | null): RoadGraph {
  const classIndex = vehicleClass === null ? -1 : vehicleClasses.indexOf(vehicleClass);
  const allowed = compiled.lanes.map(
    (lane) =>
      vehicleClass === null ||
      (lane.allowed.includes(vehicleClass) &&
        compiled.roads[lane.road]!.access[classIndex] !== 'no'),
  );
  const outgoing = compiled.lanes.map((): number[] => []);
  const penalties = new Float64Array(compiled.movements.length);
  const neighbors = compiled.roads.map(() => new Map<number, RoadEdge>());
  for (const movement of compiled.movements) {
    if (
      movement.neverGreen ||
      !allowed[movement.fromLane] ||
      !allowed[movement.toLane] ||
      isLaneDrop(compiled, movement)
    )
      continue;
    const from = compiled.lanes[movement.fromLane]!.road;
    const to = compiled.lanes[movement.toLane]!.road;
    const penaltyS = movementPenaltyS(compiled, movement);
    penalties[movement.idx] = penaltyS;
    outgoing[movement.fromLane]!.push(movement.idx);
    const edges = neighbors[from]!;
    const existing = edges.get(to);
    if (!existing || penaltyS < existing.penaltyS) edges.set(to, { to, penaltyS });
  }
  return { roads: neighbors.map((edges) => [...edges.values()]), outgoing, allowed, penalties };
}

export function createGraphCache() {
  const cache = new WeakMap<
    CompiledCity,
    { version: number; graphs: Map<VehicleClass | null, RoadGraph> }
  >();
  return (compiled: CompiledCity, vehicleClass: VehicleClass | null): RoadGraph => {
    let entry = cache.get(compiled);
    if (entry?.version !== compiled.version) {
      entry = { version: compiled.version, graphs: new Map() };
      cache.set(compiled, entry);
    }
    let graph = entry.graphs.get(vehicleClass);
    if (!graph) {
      graph = buildGraph(compiled, vehicleClass);
      entry.graphs.set(vehicleClass, graph);
    }
    return graph;
  };
}
