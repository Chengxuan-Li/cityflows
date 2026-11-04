import { cumulativeLengths, pointAtDistance, polylineLength } from '../../geo/polyline';
import { compile } from '../../network';
import { allocateId, type City, type Command, type RoundaboutSnapshot } from '../../schema';
import { applyPatch, diffCity } from '../patch';
import { editTopology, newRoadNode, relocateConnectors } from './topology';
import { requireEntity, type CommandPatch } from './types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function snapshot(
  city: City,
  nodes: string[],
  roads: string[],
  places: string[],
): RoundaboutSnapshot {
  return {
    nodes: Object.fromEntries(
      nodes
        .filter((id) => city.nodes[id])
        .map((id) => {
          const node = { ...city.nodes[id]! };
          delete node.roundabout;
          return [id, node];
        }),
    ),
    roads: Object.fromEntries(
      roads.filter((id) => city.roads[id]).map((id) => [id, city.roads[id]!]),
    ),
    connectors: Object.fromEntries(
      places.filter((id) => city.places[id]).map((id) => [id, city.places[id]!.connectors]),
    ),
  };
}

export function editRoundabout(
  city: City,
  command: Extract<Command, { kind: 'addRoundabout' | 'removeRoundabout' }>,
): CommandPatch {
  const center = requireEntity(city.nodes, command.nodeId);
  if (command.kind === 'removeRoundabout') {
    const record = center.roundabout;
    if (!record) throw new Error('Select the center of a built roundabout');
    const nodes = Object.keys(record.after.nodes),
      roads = Object.keys(record.after.roads),
      places = Object.keys(record.after.connectors);
    if (
      !same(snapshot(city, nodes, roads, places), record.after) ||
      Object.values(city.roads).some(
        (r) =>
          !roads.includes(r.id) &&
          [r.from, r.to].some((id) => nodes.includes(id) && !record.before.nodes[id]),
      ) ||
      Object.values(city.places).some(
        (p) => !places.includes(p.id) && p.connectors.some((c) => roads.includes(c.roadId)),
      )
    )
      throw new Error('Undo edits to the roundabout and its approaches before removing it');
    return {
      set: {
        nodes: record.before.nodes,
        roads: record.before.roads,
        places: Object.fromEntries(
          Object.entries(record.before.connectors).map(([id, connectors]) => [
            id,
            { ...city.places[id]!, connectors },
          ]),
        ),
      },
      remove: {
        nodes: nodes.filter((id) => !record.before.nodes[id]),
        roads: roads.filter((id) => !record.before.roads[id]),
      },
    };
  }
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
          lanes: [{ widthM: 3.5, allowed: ['car', 'truck', 'bus'] }],
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
  const nodes = Object.keys(patch.set.nodes ?? {}),
    roads = Object.keys(patch.set.roads ?? {}),
    places = Object.values(draft.places)
      .filter((p) => patch.set.places?.[p.id] || p.connectors.some((c) => roads.includes(c.roadId)))
      .map((p) => p.id);
  const before = snapshot(city, nodes, roads, places),
    after = snapshot(draft, nodes, roads, places);
  patch.set.nodes![center.id] = {
    ...draft.nodes[center.id]!,
    roundabout: { radiusM: radius, ringRoads, before, after },
  };
  return { ...patch, warnings };
}
