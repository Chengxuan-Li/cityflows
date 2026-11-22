import type { CompiledCity } from '../network';
import { isLaneDrop } from '../network/lane-drop';
import type { VehicleClass } from '../schema';
import { vehicleClasses } from '../schema';
import { movementPenaltyS } from './costs';
import { zoneReach } from '../network/zones';

/** A road's access rule for the graph's class, as a code (TASK-243: read per edge). */
export const ACCESS_NO = 0;
export const ACCESS_YES = 1;
export const ACCESS_DELIVERY = 2;
/** `destination` or `private`: allowed in the origin's or the destination's zone. */
export const ACCESS_ZONE = 3;

export interface RoadGraph {
  /** Road edges in compressed rows (TASK-243): road `r`'s edges are `edgeStart[r]` to
   * `edgeStart[r + 1]`, in the order the movements first join the two roads; each edge keeps
   * the cheapest penalty among those movements. */
  edgeStart: Int32Array;
  edgeTo: Int32Array;
  edgePenalty: Float64Array;
  outgoing: number[][];
  allowed: boolean[];
  penalties: Float64Array;
  /** Each movement's landing lane. */
  toLane: Int32Array;
  /** Per road, the class's access code and zone (`road.access[class]`, `road.zone[class]`);
   * all `ACCESS_YES` and -1 for the unrestricted graph. */
  access: Uint8Array;
  zone: Int32Array;
  /** `zoneReach(compiled, class)` (TASK-294); empty for the unrestricted graph. */
  zoneReach: number[][];
}

const accessCodes = { no: ACCESS_NO, yes: ACCESS_YES, delivery: ACCESS_DELIVERY } as const;

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
  const neighbors = compiled.roads.map(() => new Map<number, number>());
  let edgeCount = 0;
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
    if (existing === undefined) edgeCount++;
    if (existing === undefined || penaltyS < existing) edges.set(to, penaltyS);
  }
  const edgeStart = new Int32Array(compiled.roads.length + 1);
  const edgeTo = new Int32Array(edgeCount);
  const edgePenalty = new Float64Array(edgeCount);
  let edge = 0;
  neighbors.forEach((edges, road) => {
    edgeStart[road] = edge;
    for (const [to, penaltyS] of edges) {
      edgeTo[edge] = to;
      edgePenalty[edge++] = penaltyS;
    }
  });
  edgeStart[compiled.roads.length] = edge;
  const access = new Uint8Array(compiled.roads.length).fill(ACCESS_YES);
  const zone = new Int32Array(compiled.roads.length).fill(-1);
  if (classIndex !== -1)
    for (const road of compiled.roads) {
      const rule = road.access[classIndex]!;
      access[road.idx] =
        rule === 'destination' || rule === 'private' ? ACCESS_ZONE : accessCodes[rule];
      zone[road.idx] = road.zone[classIndex]!;
    }
  const toLane = Int32Array.from(compiled.movements, (movement) => movement.toLane);
  return {
    edgeStart,
    edgeTo,
    edgePenalty,
    outgoing,
    allowed,
    penalties,
    toLane,
    access,
    zone,
    zoneReach: classIndex === -1 ? [] : zoneReach(compiled, classIndex),
  };
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
