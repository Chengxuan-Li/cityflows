import { polylineLength } from '../geo/polyline';
import {
  placeSchema,
  signalProgramSchema,
  type City,
  type Node,
  type Place,
  type Road,
} from '../schema';
import type { CompiledCity, Diagnostic } from './types';

export function validateCity(
  city: City,
  nodes: Node[],
  roads: Road[],
  places: Place[],
  diagnostics: Diagnostic[],
): void {
  const error = (code: string, refs: string[], message: string) => {
    diagnostics.push({ severity: 'error', code, refs, message });
  };

  for (const road of roads) {
    const from = city.nodes[road.from];
    const to = city.nodes[road.to];
    if (!from || !to) {
      error(
        'dangling_ref',
        [road.id, ...[road.from, road.to].filter((id) => !city.nodes[id])],
        `Road ${road.id} references a missing node (${road.from} or ${road.to})`,
      );
    } else {
      const first = road.centerline[0];
      const last = road.centerline.at(-1);
      const length = polylineLength(road.centerline);
      if (
        from.id === to.id ||
        !Number.isFinite(length) ||
        length <= 0 ||
        first?.x !== from.pos.x ||
        first?.y !== from.pos.y ||
        last?.x !== to.pos.x ||
        last?.y !== to.pos.y
      ) {
        error(
          'road_degenerate',
          [road.id, from.id, to.id],
          `Road ${road.id} needs a positive-length centerline between its distinct endpoint nodes`,
        );
      }
    }

    if (
      road.lanes.length === 0 ||
      road.lanes.some((lane) => !Number.isFinite(lane.widthM) || lane.widthM <= 0)
    ) {
      error(
        'lane_invalid',
        [road.id],
        `Road ${road.id} needs at least one lane and positive lane widths`,
      );
    }
    if (
      !Number.isFinite(road.lateralOffsetM) ||
      !Number.isFinite(road.speedLimitMps) ||
      road.speedLimitMps <= 0
    ) {
      error(
        'road_degenerate',
        [road.id],
        `Road ${road.id} needs a finite lateral offset and a positive finite speed limit`,
      );
    }
  }

  for (const node of nodes) {
    for (const roadId of node.minorRoads) {
      if (city.roads[roadId]?.to !== node.id) {
        error(
          'dangling_ref',
          [node.id, roadId],
          `Minor road ${roadId} does not enter node ${node.id}`,
        );
      }
    }
    for (const rule of node.turnRules) {
      const from = city.roads[rule.from];
      const to = city.roads[rule.to];
      if (
        !from ||
        !to ||
        from.to !== node.id ||
        to.from !== node.id ||
        (rule.fromLane !== undefined && !from.lanes[rule.fromLane]) ||
        (rule.toLane !== undefined && !to.lanes[rule.toLane])
      ) {
        error(
          'turnrule_invalid',
          [node.id, rule.from, rule.to],
          `Turn rule at ${node.id} has invalid roads or lanes (${rule.from} to ${rule.to})`,
        );
      }
    }
    if (node.control !== 'signal') continue;
    if (!node.signal) {
      error('signal_missing', [node.id], `Signal-controlled node ${node.id} is missing a program`);
    } else {
      const program = signalProgramSchema.safeParse(node.signal);
      if (!program.success) {
        error(
          'signal_phase_invalid',
          [node.id],
          `Signal ${node.id} has an invalid program: ${program.error.issues[0]!.path.join('.')}`,
        );
      }
    }
  }

  const connectorIds = new Set<string>();
  for (const place of places) {
    const validation = placeSchema.safeParse({ ...place, connectors: [] });
    if (!validation.success) {
      error(
        'place_invalid',
        [place.id],
        `Place ${place.id} is invalid: ${validation.error.issues[0]!.path.join('.')}`,
      );
    }
    for (const connector of place.connectors) {
      const { id, roadId, lane, positionM, throughputPerMin } = connector;
      if (
        connectorIds.has(id) ||
        !city.roads[roadId]?.lanes[lane] ||
        !Number.isFinite(positionM) ||
        positionM < 0 ||
        !Number.isFinite(throughputPerMin) ||
        throughputPerMin <= 0
      ) {
        error(
          'connector_invalid',
          [id, place.id, roadId],
          `Connector ${id} at ${place.id} has an invalid id, lane, position or throughput on ${roadId}`,
        );
      }
      connectorIds.add(id);
    }
  }
}

export function warnAboutProvenance(
  entities: (Node | Road | Place)[],
  diagnostics: Diagnostic[],
): void {
  const inferred = entities
    .flatMap((entity) => [
      { id: entity.id, provenance: entity.provenance },
      ...('turnRules' in entity
        ? entity.turnRules.map((rule) => ({ id: entity.id, provenance: rule.provenance }))
        : []),
    ])
    .filter(({ provenance }) => provenance.source === 'osm' && provenance.inferred?.length);
  if (inferred.length === 0) return;
  const count = inferred.reduce((sum, entity) => sum + entity.provenance.inferred!.length, 0);
  diagnostics.push({
    severity: 'warning',
    code: 'inferred_attributes',
    refs: [...new Set(inferred.map((entity) => entity.id))],
    message: `Inferred ${count} attributes on imported entities`,
  });
}

// Iterative Kosaraju traversal keeps large imported networks off the call stack.
function largestComponent(out: number[][], incoming: number[][]): number[] {
  const visited = new Uint8Array(out.length);
  const finish: number[] = [];
  for (let root = 0; root < out.length; root++) {
    if (visited[root]) continue;
    const stack = [root];
    while (stack.length) {
      const lane = stack.pop()!;
      if (lane < 0) finish.push(~lane);
      else if (!visited[lane]) {
        visited[lane] = 1;
        stack.push(~lane);
        for (const next of out[lane]!) if (!visited[next]) stack.push(next);
      }
    }
  }

  visited.fill(0);
  let largest: number[] = [];
  for (const root of finish.reverse()) {
    if (visited[root]) continue;
    const members = [root];
    visited[root] = 1;
    for (const lane of members) {
      for (const previous of incoming[lane]!) {
        if (visited[previous]) continue;
        visited[previous] = 1;
        members.push(previous);
      }
    }
    if (members.length > largest.length) {
      largest = members;
    }
  }
  return largest;
}

function reachedBeyondStart(edges: number[][], starts: Float64Array): Uint8Array {
  const visited = new Uint8Array(edges.length);
  const queue: number[] = [];
  function visit(lane: number) {
    if (visited[lane]) return;
    visited[lane] = 1;
    queue.push(lane);
  }
  for (let lane = 0; lane < starts.length; lane++) {
    if (Number.isFinite(starts[lane]!)) edges[lane]!.forEach(visit);
  }
  for (const lane of queue) edges[lane]!.forEach(visit);
  return visited;
}

export function warnAboutConnectivity(city: CompiledCity, diagnostics: Diagnostic[]): void {
  const { lanes, movements, connectors } = city;
  const warn = (code: string, refs: string[], message: string) => {
    diagnostics.push({ severity: 'warning', code, refs, message });
  };
  const out = lanes.map((): number[] => []);
  const incoming = lanes.map((): number[] => []);
  for (const { fromLane, toLane, neverGreen } of movements) {
    if (neverGreen) continue;
    out[fromLane]!.push(toLane);
    incoming[toLane]!.push(fromLane);
  }

  const largest = new Set(largestComponent(out, incoming));
  const disconnected = lanes.filter((lane) => !largest.has(lane.idx)).map((lane) => lane.id);
  if (disconnected.length) {
    warn(
      'disconnected_component',
      disconnected,
      `${disconnected.length} lanes are outside the largest strongly connected component`,
    );
  }

  const firstDeparture = new Float64Array(lanes.length).fill(Infinity);
  const lastArrival = new Float64Array(lanes.length).fill(-Infinity);
  for (const { lane, positionM, direction } of connectors) {
    if (direction !== 'in') firstDeparture[lane] = Math.min(firstDeparture[lane]!, positionM);
    if (direction !== 'out') lastArrival[lane] = Math.max(lastArrival[lane]!, positionM);
  }

  for (const lane of lanes) {
    if (lane.out.length === 0 && lastArrival[lane.idx] === -Infinity) {
      warn('dead_end', [lane.id], `Lane ${lane.id} has no outgoing movement or arrival connector`);
    }
  }
  for (const node of city.nodes) {
    if (node.movements.length === 0)
      warn('node_no_movements', [node.id], `Node ${node.id} has no movements`);
  }

  const fromDeparture = reachedBeyondStart(out, firstDeparture);
  const toArrival = reachedBeyondStart(incoming, lastArrival);
  for (const { id, lane, positionM, direction } of connectors) {
    if (direction !== 'out' && !fromDeparture[lane] && firstDeparture[lane]! > positionM) {
      warn(
        'connector_unreachable',
        [id, lanes[lane]!.id],
        `Arrival connector ${id} cannot be reached from a departure connector`,
      );
    }
    if (direction !== 'in' && !toArrival[lane] && lastArrival[lane]! < positionM) {
      warn(
        'connector_unreachable',
        [id, lanes[lane]!.id],
        `Departure connector ${id} cannot reach an arrival connector`,
      );
    }
  }
}
