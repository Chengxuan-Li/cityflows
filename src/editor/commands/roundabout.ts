import { cumulativeLengths, pointAtDistance, polylineLength } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { compile } from '../../network';
import { allocateId, type City, type Command, type Node, type Road } from '../../schema';
import { applyPatch, diffCity } from '../patch';
import { editTopology, nearestPointOnLine, newRoadNode, relocateConnectors } from './topology';
import { mapConnectors, requireEntity, type CommandPatch } from './types';

function ringCentroid(ring: Road[], origin: Vec2): Vec2 {
  let area = 0;
  let x = 0;
  let y = 0;
  for (const { centerline } of ring) {
    for (let i = 1; i < centerline.length; i++) {
      const a = centerline[i - 1]!,
        b = centerline[i]!;
      const ax = a.x - origin.x,
        ay = a.y - origin.y;
      const bx = b.x - origin.x,
        by = b.y - origin.y;
      const cross = ax * by - ay * bx;
      area += cross;
      x += (ax + bx) * cross;
      y += (ay + by) * cross;
    }
  }
  if (area === 0) return origin;
  const offset = { x: x / (3 * area), y: y / (3 * area) };
  return Math.hypot(offset.x, offset.y) < 1e-8
    ? origin
    : { x: origin.x + offset.x, y: origin.y + offset.y };
}

function removeRoundabout(city: City, center: Node): CommandPatch {
  const { roundabout, ...junction } = center;
  if (!roundabout) throw new Error('Select the center of a built roundabout');
  const ring = roundabout.ringRoads.map((id) => {
    const road = city.roads[id];
    if (!road) throw new Error(`Roundabout ring road ${id} was deleted`);
    return road;
  });
  const ringNodes = new Set(ring.map((road) => road.from));
  for (const [i, road] of ring.entries()) {
    const next = ring[(i + 1) % ring.length]!;
    if (road.to !== next.from || ringNodes.size !== ring.length || road.from === center.id)
      throw new Error(`Roundabout ring roads ${road.id} and ${next.id} no longer join in a cycle`);
  }

  const pos = ringCentroid(ring, center.pos);
  const roads = { ...city.roads };
  const nodes: City['nodes'] = {
    ...city.nodes,
    [center.id]: { ...junction, ...roundabout.restore, pos },
  };
  for (const road of ring) delete roads[road.id];
  for (const id of ringNodes) delete nodes[id];
  const remaining = Object.values(roads);
  const legs = remaining.filter((road) => ringNodes.has(road.from) || ringNodes.has(road.to));
  const legIds = new Set(legs.map((road) => road.id));
  const replacements = new Map<string, string>();
  const roadsAt = new Map<string, Road[]>();
  for (const road of remaining) {
    for (const id of [road.from, road.to]) {
      const incident = roadsAt.get(id);
      if (incident) incident.push(road);
      else roadsAt.set(id, [road]);
    }
  }
  const restoredIncoming = new Map<string, string>();
  const visitedSeams = new Set<string>();

  const idNumber = (id: string) => Number(id.slice(2));
  const followsSplit = (road: Road, seamId: string) => {
    // splitRoad allocates the seam followed by one new road per direction.
    const offset = idNumber(road.id) - idNumber(seamId);
    return offset === 1 || offset === 2;
  };
  function sourceBeforeSplit(road: Road, seamId: string): string | undefined {
    // An inbound approach can have been split again between the outer endpoint and this seam.
    while (idNumber(road.id) > idNumber(seamId)) {
      if (!followsSplit(road, road.from)) return undefined;
      const predecessors: Road[] = roadsAt
        .get(road.from)!
        .filter(
          (other) =>
            other.to === road.from &&
            other.from !== road.to &&
            idNumber(other.id) < idNumber(road.id),
        );
      if (predecessors.length !== 1) return undefined;
      road = predecessors[0]!;
    }
    return road.id;
  }

  for (const leg of legs) {
    const inbound = ringNodes.has(leg.to);
    const seamId = inbound ? leg.from : leg.to;
    if (ringNodes.has(seamId) || seamId === center.id || visitedSeams.has(seamId)) continue;
    visitedSeams.add(seamId);
    const seam = nodes[seamId]!;
    const incident = roadsAt.get(seamId)!;
    const inner = incident.filter((road) => legIds.has(road.id));
    const outer = incident.filter((road) => !legIds.has(road.id));
    const entry = inner.find((part) => part.from === seamId && followsSplit(part, seamId));
    const incoming = outer
      .filter((road) => road.to === seamId)
      .map((road) => ({ road, originalId: sourceBeforeSplit(road, seamId) }))
      .filter(({ originalId }) => originalId !== undefined);
    if (entry && incoming.length === 1) restoredIncoming.set(incoming[0]!.originalId!, entry.id);

    if (
      seam.control !== 'uncontrolled' ||
      seam.signal ||
      seam.roundabout ||
      seam.turnRules.length ||
      seam.minorRoads.length ||
      inner.length !== outer.length ||
      inner.length > 2
    )
      continue;
    const pairs = inner.map((part) =>
      part.from === seamId
        ? part === entry && incoming.length === 1
          ? incoming[0]!.road
          : undefined
        : outer.find((road) => road.from === seamId && followsSplit(road, seamId)),
    );
    if (pairs.some((road) => !road) || new Set(pairs).size !== inner.length) continue;

    delete nodes[seamId];
    for (const [i, part] of inner.entries()) {
      const approach = pairs[i]!;
      const entering = part.from === seamId;
      const id = entering ? approach.id : part.id;
      const line = [...approach.centerline];
      if (!entering) line.reverse();
      if (nearestPointOnLine(line.at(-1)!, [line.at(-2)!, pos]).distance < 1e-8) line.pop();
      line.push(pos);
      if (!entering) line.reverse();
      const suffix = `@${seamId}`;
      const group = approach.streetGroupId;
      delete roads[part.id];
      delete roads[approach.id];
      roads[id] = {
        ...approach,
        id,
        from: entering ? approach.from : center.id,
        to: entering ? center.id : approach.to,
        centerline: line,
        streetGroupId: group?.endsWith(suffix) ? group.slice(0, -suffix.length) : group,
      };
      replacements.set(entering ? part.id : approach.id, id);
    }
  }

  // Keep approaches at edited seams and roads newly attached to the ring.
  for (const road of legs) {
    if (roads[road.id] !== road) continue;
    const from = ringNodes.has(road.from) ? center.id : road.from;
    const to = ringNodes.has(road.to) ? center.id : road.to;
    if (from === to) delete roads[road.id];
    else roads[road.id] = { ...road, from, to };
  }
  for (const road of Object.values(roads)) {
    if (road.from !== center.id && road.to !== center.id) continue;
    const line = [...road.centerline];
    if (road.from === center.id) line[0] = pos;
    if (road.to === center.id) line[line.length - 1] = pos;
    roads[road.id] = { ...road, centerline: line };
  }

  // Restore controls against the surviving roads and remap far-end references from merges.
  const resolve = (id: string) => replacements.get(id) ?? id;
  for (const node of Object.values(nodes)) {
    const resolveIncoming = (id: string) =>
      resolve(node.id === center.id ? (restoredIncoming.get(id) ?? id) : id);
    const pairs = (pair: { from: string; to: string }) => ({
      ...pair,
      from: resolveIncoming(pair.from),
      to: resolve(pair.to),
    });
    const incident = ({ from, to }: { from: string; to: string }) =>
      roads[from]?.to === node.id && roads[to]?.from === node.id;
    const updated = {
      ...node,
      minorRoads: node.minorRoads.map(resolveIncoming).filter((id) => roads[id]?.to === node.id),
      turnRules: node.turnRules
        .map((rule) => ({ ...rule, ...pairs(rule) }))
        .filter(
          (rule) =>
            incident(rule) &&
            (rule.fromLane === undefined || rule.fromLane < roads[rule.from]!.lanes.length) &&
            (rule.toLane === undefined || rule.toLane < roads[rule.to]!.lanes.length),
        ),
      signal: node.signal && {
        ...node.signal,
        phases: node.signal.phases.map((phase) => ({
          ...phase,
          groups: phase.groups.map(pairs).filter(incident),
        })),
      },
    };
    if (JSON.stringify(updated) !== JSON.stringify(node)) nodes[node.id] = updated;
  }

  const draft = { ...city, nodes, roads };
  const patch: CommandPatch = { ...diffCity(city, draft), warnings: [] };
  mapConnectors(city, patch, (connector, ownerId) => {
    const road = roads[resolve(connector.roadId)];
    if (!road) {
      patch.warnings!.push({
        severity: 'warning',
        code: 'connector_removed',
        refs: [ownerId, connector.id, connector.roadId],
        message: `Removed connector ${connector.id} with road ${connector.roadId}`,
      });
      return null;
    }
    if (connector.lane < road.lanes.length) return connector;
    patch.warnings!.push({
      severity: 'warning',
      code: 'connector_lane_clamped',
      refs: [ownerId, connector.id, road.id],
      message: `Moved connector ${connector.id} to the outermost lane on ${road.id}`,
    });
    return { ...connector, lane: city.drivingSide === 'right' ? road.lanes.length - 1 : 0 };
  });
  return relocateConnectors(
    city,
    patch,
    Object.fromEntries([...replacements].map(([from, to]) => [from, [to]])),
  );
}

export function editRoundabout(
  city: City,
  command: Extract<Command, { kind: 'addRoundabout' | 'removeRoundabout' }>,
): CommandPatch {
  const center = requireEntity(city.nodes, command.nodeId);
  if (command.kind === 'removeRoundabout') return removeRoundabout(city, center);
  if (center.roundabout) throw new Error('This junction is already a roundabout');
  const radius = command.radiusM;
  if (!Number.isFinite(radius) || radius < 20)
    throw new Error('Roundabout radius must be at least 20 m');
  const incident = Object.values(city.roads).filter(
    (r) => r.from === center.id || r.to === center.id,
  );
  if (incident.length < 3) throw new Error('A roundabout needs at least three approach roads');
  if (incident.some((r) => polylineLength(r.centerline) <= radius * 2 + 15))
    throw new Error('Radius leaves too little road for the approach legs');
  const compiled = compile(city);
  if (!compiled.ok) throw new Error('Roundabout requires a valid city');
  const busiest = incident
    .filter((r) => r.to === center.id)
    .sort(
      (a, b) =>
        b.lanes.length - a.lanes.length ||
        compiled.compiled.roads[compiled.compiled.index.road.get(b.id)!]!.classRank -
          compiled.compiled.roads[compiled.compiled.index.road.get(a.id)!]!.classRank ||
        a.id.localeCompare(b.id),
    )[0];
  if (!busiest) throw new Error('A roundabout needs an incoming approach');
  let draft = city;
  const warnings: NonNullable<CommandPatch['warnings']> = [];
  const split = new Set<string>();
  for (const original of incident) {
    if (split.has(original.id)) continue;
    const road = draft.roads[original.id]!;
    const length = polylineLength(road.centerline);
    const patch = editTopology(draft, {
      kind: 'splitRoad',
      roadId: road.id,
      atM: road.to === center.id ? length - radius * 2 : radius * 2,
    });
    for (const id of Object.keys(patch.set.roads ?? {})) split.add(id);
    draft = applyPatch(draft, patch);
    warnings.push(...(patch.warnings ?? []));
  }
  const splitCity = draft;
  draft = { ...draft, nodes: { ...draft.nodes }, roads: { ...draft.roads } };
  draft.nodes[center.id] = {
    ...center,
    control: 'uncontrolled',
    minorRoads: [],
    turnRules: [],
    signal: null,
  };
  const sign = city.drivingSide === 'right' ? -1 : 1;
  const legs = Object.values(draft.roads).filter((r) => r.from === center.id || r.to === center.id);
  const endpoints = legs
    .map((road) => {
      const incoming = road.to === center.id;
      const line = road.centerline,
        cumulative = cumulativeLengths(line);
      const outside = pointAtDistance(line, cumulative, incoming ? 0 : cumulative.at(-1)!);
      const radial = Math.atan2(outside.y - center.pos.y, outside.x - center.pos.x);
      const angle = radial + (incoming ? 1 : -1) * sign * 0.22;
      const pos = {
        x: center.pos.x + radius * Math.cos(angle),
        y: center.pos.y + radius * Math.sin(angle),
      };
      const id = allocateId(draft, 'n');
      draft.nodes[id] = {
        ...newRoadNode(pos, center.layer),
        id,
        control: incoming ? 'yield' : 'uncontrolled',
        minorRoads: incoming ? [road.id] : [],
      };
      draft.roads[road.id] = {
        ...road,
        from: incoming ? road.from : id,
        to: incoming ? id : road.to,
        lateralOffsetM: 0,
        streetGroupId: null,
        centerline: incoming ? [outside, pos] : [pos, outside],
      };
      return { id, angle, road, incoming };
    })
    .sort((a, b) => sign * (a.angle - b.angle));
  for (let i = 0; i < endpoints.length; i++) {
    const a = endpoints[i]!,
      b = endpoints[(i + 1) % endpoints.length]!;
    let sweep = sign * (b.angle - a.angle);
    if (sweep <= 0) sweep += 2 * Math.PI;
    if (sweep * radius < 8) throw new Error('Approaches are too close for this radius');
    const count = Math.max(4, Math.ceil((sweep * radius) / 2));
    const centerline = Array.from({ length: count + 1 }, (_, j) => {
      const angle = a.angle + (sign * sweep * j) / count;
      return {
        x: center.pos.x + radius * Math.cos(angle),
        y: center.pos.y + radius * Math.sin(angle),
      };
    });
    centerline[0] = draft.nodes[a.id]!.pos;
    centerline[count] = draft.nodes[b.id]!.pos;
    draft = applyPatch(
      draft,
      editTopology(draft, {
        kind: 'addRoad',
        newNodes: [],
        road: {
          from: a.id,
          to: b.id,
          centerline,
          lateralOffsetM: 0,
          lanes: [{ widthM: 3.5, allowed: ['car', 'van', 'truck', 'bus'] }],
          roadClass: busiest.roadClass,
          speedLimitMps: 30 / 3.6,
          name: 'Roundabout',
          streetGroupId: `roundabout:${center.id}:${i}`,
          provenance: { source: 'authored' },
        },
      }),
    );
  }
  const ringRoads = Object.values(draft.roads)
    .filter((r) => r.streetGroupId?.startsWith(`roundabout:${center.id}:`))
    .map((r) => r.id);
  for (const endpoint of endpoints) {
    const node = draft.nodes[endpoint.id]!;
    const incoming = Object.values(draft.roads).filter((r) => r.to === node.id);
    const outgoing = Object.values(draft.roads).filter((r) => r.from === node.id);
    draft.nodes[node.id] = {
      ...node,
      turnRules: incoming.flatMap((from) =>
        outgoing.flatMap((to) =>
          from.lanes.flatMap((_, fromLane) =>
            to.lanes.map((_, toLane) => ({
              from: from.id,
              to: to.id,
              fromLane,
              toLane,
              allowed: true,
              provenance: { source: 'authored' as const },
            })),
          ),
        ),
      ),
    };
  }
  draft = applyPatch(splitCity, relocateConnectors(splitCity, diffCity(splitCity, draft)));
  const patch = diffCity(city, draft);
  const { control, signal, minorRoads, turnRules } = center;
  patch.set.nodes![center.id] = {
    ...draft.nodes[center.id]!,
    roundabout: { radiusM: radius, ringRoads, restore: { control, signal, minorRoads, turnRules } },
  };
  return { ...patch, warnings };
}
