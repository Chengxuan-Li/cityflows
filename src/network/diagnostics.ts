import { polylineLength } from '../geo/polyline';
import {
  placeSchema,
  signalProgramSchema,
  type City,
  type Node,
  type Place,
  type Road,
} from '../schema';
import type { CompiledCity, CRoad, Diagnostic } from './types';

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

// Weakly connected: direction ignored, so one-way-only networks are not flagged. Directional
// reachability is reported by dead_end and connector_unreachable.
function largestWeakComponent(links: number[][]): number[] {
  const visited = new Uint8Array(links.length);
  let largest: number[] = [];
  for (let root = 0; root < links.length; root++) {
    if (visited[root]) continue;
    const members = [root];
    visited[root] = 1;
    for (const lane of members) {
      for (const next of links[lane]!) {
        if (visited[next]) continue;
        visited[next] = 1;
        members.push(next);
      }
    }
    if (members.length > largest.length) largest = members;
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
  const links = lanes.map((): number[] => []);
  for (const { fromLane, toLane, neverGreen } of movements) {
    links[fromLane]!.push(toLane);
    links[toLane]!.push(fromLane);
    if (neverGreen) continue;
    out[fromLane]!.push(toLane);
    incoming[toLane]!.push(fromLane);
  }
  // Lane changes join adjacent lanes for connectivity and reachability.
  for (const lane of lanes) {
    if (lane.right < 0) continue;
    for (const list of [links, out, incoming]) {
      list[lane.idx]!.push(lane.right);
      list[lane.right]!.push(lane.idx);
    }
  }

  const largest = new Set(largestWeakComponent(links));
  const disconnected = lanes.filter((lane) => !largest.has(lane.idx)).map((lane) => lane.id);
  if (disconnected.length) {
    warn(
      'disconnected_component',
      disconnected,
      `${disconnected.length} lanes are not connected to the main network`,
    );
  }

  const firstDeparture = new Float64Array(lanes.length).fill(Infinity);
  const lastArrival = new Float64Array(lanes.length).fill(-Infinity);
  for (const { lane, positionM, direction } of connectors) {
    if (direction !== 'in') firstDeparture[lane] = Math.min(firstDeparture[lane]!, positionM);
    if (direction !== 'out') lastArrival[lane] = Math.max(lastArrival[lane]!, positionM);
  }

  const roadHasArrival = new Uint8Array(city.roads.length);
  for (const lane of lanes) {
    if (lastArrival[lane.idx] !== -Infinity) roadHasArrival[lane.road] = 1;
  }
  for (const lane of lanes) {
    if (lane.out.length === 0 && !roadHasArrival[lane.road]) {
      warn('dead_end', [lane.id], `Lane ${lane.id} has no outgoing movement or arrival connector`);
    }
  }

  // A node joined only by the two directions of one street (a cul-de-sac) has no movements by
  // design; any other node with both an entry and an exit should have some.
  const entries = city.nodes.map((): CRoad[] => []);
  const exits = city.nodes.map((): CRoad[] => []);
  for (const road of city.roads) {
    exits[road.from]!.push(road);
    entries[road.to]!.push(road);
  }
  for (const node of city.nodes) {
    if (node.movements.length > 0) continue;
    const crossing = entries[node.idx]!.some((entry) =>
      exits[node.idx]!.some(
        (exit) => entry.streetGroupId === null || entry.streetGroupId !== exit.streetGroupId,
      ),
    );
    if (crossing) warn('node_no_movements', [node.id], `Node ${node.id} has no movements`);
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
