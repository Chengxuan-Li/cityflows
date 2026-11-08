import { cumulativeLengths, distance, pointAtDistance, polylineLength } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { compile } from '../../network';
import { allocateId, type City, type Command, type Node, type Road } from '../../schema';
import { applyPatch } from '../patch';
import { requireEntity, type CommandPatch } from './types';
import { withCrossings } from './road';

type TopologyCommand = Extract<
  Command,
  { kind: 'addRoad' | 'deleteRoad' | 'splitRoad' | 'mergeRoads' | 'moveNode' }
>;

export type RoadVertex = { pos: Vec2 } & (
  { kind: 'free' } | { kind: 'node'; nodeId: string } | { kind: 'road'; roadId: string }
);
export interface DrawRoadOptions {
  twoWay: boolean;
  lanes: number;
  roadClass: Road['roadClass'];
  speedKph: number;
}

/** Resolve only explicit snaps; crossings between vertices never create connectivity. */
export function drawRoadCommand(
  city: City,
  vertices: readonly RoadVertex[],
  options: DrawRoadOptions,
): Command {
  if (vertices.length < 2) throw new Error('A road needs two vertices');
  let draft = city;
  const commands: TopologyCommand[] = [];
  const descendants = Object.fromEntries(Object.keys(city.roads).map((id) => [id, [id]]));
  function append(command: TopologyCommand) {
    const patch = editTopology(draft, command);
    if (command.kind === 'splitRoad') {
      for (const old of Object.values(draft.roads)) {
        const first = patch.set.roads?.[old.id];
        if (!first || first.to === old.to) continue;
        const second = Object.values(patch.set.roads!).find(
          (r) => r.from === first.to && r.to === old.to,
        )!;
        for (const [id, parts] of Object.entries(descendants))
          descendants[id] = parts.flatMap((part) =>
            part === old.id ? [old.id, second.id] : [part],
          );
      }
    }
    draft = applyPatch(draft, patch);
    commands.push(command);
  }
  const nodes = vertices.map((vertex) => {
    if (vertex.kind === 'free') return null;
    if (vertex.kind === 'node') return requireEntity(draft.nodes, vertex.nodeId).id;
    const candidates = descendants[vertex.roadId]!.map((id) => ({
      road: draft.roads[id]!,
      ...nearestPointOnLine(vertex.pos, draft.roads[id]!.centerline),
    })).sort((a, b) => a.distance - b.distance);
    const target = candidates[0]!;
    if (target.atM < 1e-6) return target.road.from;
    if (polylineLength(target.road.centerline) - target.atM < 1e-6) return target.road.to;
    const id = `n:${draft.nextId}`;
    append({ kind: 'splitRoad', roadId: target.road.id, atM: target.atM });
    return id;
  });
  const ends = vertices
    .map((v, i) => (i === 0 || i === vertices.length - 1 || v.kind !== 'free' ? i : -1))
    .filter((i) => i >= 0);
  for (let i = 1; i < ends.length; i++) {
    const fromIndex = ends[i - 1]!,
      toIndex = ends[i]!;
    const newNodes: Omit<Node, 'id'>[] = [];
    for (const index of [fromIndex, toIndex])
      if (!nodes[index]) {
        nodes[index] = `n:${draft.nextId + newNodes.length}`;
        newNodes.push(newRoadNode(vertices[index]!.pos));
      }
    const centerline = vertices.slice(fromIndex, toIndex + 1).map((v) => v.pos);
    if (nodes[fromIndex] === nodes[toIndex] || polylineLength(centerline) < 1)
      throw new Error('Road endpoints must be distinct and at least one meter apart');
    const widthM = options.roadClass === 'residential' || options.roadClass === 'service' ? 3 : 3.5;
    const road: Omit<Road, 'id'> = {
      from: nodes[fromIndex]!,
      to: nodes[toIndex]!,
      centerline,
      lateralOffsetM: options.twoWay
        ? ((city.drivingSide === 'right' ? 1 : -1) * widthM * options.lanes) / 2
        : 0,
      lanes: Array.from({ length: options.lanes }, () => ({
        widthM,
        allowed: ['car', 'van', 'truck', 'bus'],
      })),
      roadClass: options.roadClass,
      speedLimitMps: options.speedKph / 3.6,
      name: null,
      streetGroupId: `street:${draft.nextId + newNodes.length}`,
      provenance: { source: 'authored' },
    };
    append({ kind: 'addRoad', road, newNodes });
    if (options.twoWay)
      append({
        kind: 'addRoad',
        road: { ...road, from: road.to, to: road.from, centerline: [...centerline].reverse() },
        newNodes: [],
      });
  }
  return { kind: 'batch', label: 'Draw street', commands };
}

export function nearestPointOnLine(point: Vec2, line: readonly Vec2[]) {
  let best = { pos: line[0]!, atM: 0, distance: Infinity };
  let length = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const segment = distance(a, b);
    if (!segment) continue;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / segment ** 2),
    );
    const pos = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const away = distance(point, pos);
    if (away < best.distance) best = { pos, atM: length + t * segment, distance: away };
    length += segment;
  }
  return best;
}

export function newRoadNode(pos: Vec2, layer = 0): Omit<Node, 'id'> {
  return {
    pos,
    layer,
    control: 'uncontrolled',
    minorRoads: [],
    turnRules: [],
    signal: null,
    provenance: { source: 'authored' },
  };
}

function opposite(city: City, road: Road) {
  return road.streetGroupId === null
    ? undefined
    : Object.values(city.roads).find(
        (other) =>
          other.id !== road.id &&
          other.streetGroupId === road.streetGroupId &&
          other.from === road.to &&
          other.to === road.from,
      );
}

function replaceReferences(node: Node, before: string, after: string): Node {
  const replace = (id: string) => (id === before ? after : id);
  return {
    ...node,
    minorRoads: node.minorRoads.map(replace),
    turnRules: node.turnRules.map((rule) => ({
      ...rule,
      from: replace(rule.from),
      to: replace(rule.to),
    })),
    signal: node.signal && {
      ...node.signal,
      phases: node.signal.phases.map((phase) => ({
        ...phase,
        groups: phase.groups.map((group) => ({ from: replace(group.from), to: replace(group.to) })),
      })),
    },
  };
}

// Connector distances belong to trimmed, offset lanes, not the canonical centerline.
// Keep their world positions, projecting to the edited lane (or the nearest split half).
export function relocateConnectors(
  city: City,
  patch: CommandPatch,
  replacements: Record<string, string[]> = {},
): CommandPatch {
  const before = compile(city);
  const draft = applyPatch(city, patch);
  const after = compile({
    ...draft,
    places: Object.fromEntries(
      Object.entries(draft.places).map(([id, place]) => [id, { ...place, connectors: [] }]),
    ),
  });
  if (!before.ok || !after.ok) return patch; // The editor reports structural errors at commit.
  for (const place of Object.values(draft.places)) {
    let changed = false;
    const connectors = place.connectors.map((connector) => {
      const old = before.compiled.connectors[before.compiled.index.connector.get(connector.id)!];
      if (!old) return connector;
      const lane = before.compiled.lanes[old.lane]!;
      const point = pointAtDistance(lane.polyline, lane.cumulative, old.positionM);
      const candidates = replacements[connector.roadId] ?? [connector.roadId];
      const positions = candidates
        .map((id) => {
          const target =
            after.compiled.lanes[after.compiled.index.lane.get(`${id}#${connector.lane}`)!]!;
          return { roadId: id, ...nearestPointOnLine(point, target.polyline) };
        })
        .sort((a, b) => a.distance - b.distance);
      const target = positions[0]!;
      if (target.roadId === connector.roadId && Math.abs(target.atM - connector.positionM) < 1e-8)
        return connector;
      changed = true;
      if (target.distance > 0.01)
        (patch.warnings ??= []).push({
          severity: 'warning',
          code: 'connector_repositioned',
          refs: [place.id, connector.id, target.roadId],
          message: `Moved connector ${connector.id} onto the edited lane on ${target.roadId}`,
        });
      return { ...connector, roadId: target.roadId, positionM: target.atM };
    });
    if (changed) (patch.set.places ??= {})[place.id] = { ...place, connectors };
  }
  return patch;
}

function splitRoad(city: City, road: Road, atM: number): CommandPatch {
  const length = polylineLength(road.centerline);
  if (!Number.isFinite(atM) || atM <= 0 || atM >= length)
    throw new Error('Split point must be inside the road');
  const counter = { nextId: city.nextId };
  const nodeId = allocateId(counter, 'n');
  const pos = pointAtDistance(road.centerline, cumulativeLengths(road.centerline), atM);
  const node = { ...newRoadNode(pos, city.nodes[road.from]!.layer), id: nodeId };
  const patch: CommandPatch = { set: { nodes: { [nodeId]: node }, roads: {} }, remove: {} };
  const replacements: Record<string, string[]> = {};
  const group = road.streetGroupId === null ? null : `${road.streetGroupId}@${nodeId}`;

  function split(
    direction: Road,
    position: number,
    firstGroup: string | null,
    secondGroup: string | null,
  ) {
    const lengths = cumulativeLengths(direction.centerline);
    const id = allocateId(counter, 'r');
    patch.set.roads![direction.id] = withCrossings(
      {
        ...direction,
        to: nodeId,
        centerline: [...direction.centerline.filter((_, i) => lengths[i]! < position), pos],
        streetGroupId: firstGroup,
      },
      direction.crossings?.start,
    );
    patch.set.roads![id] = withCrossings(
      {
        ...direction,
        id,
        from: nodeId,
        centerline: [pos, ...direction.centerline.filter((_, i) => lengths[i]! > position)],
        streetGroupId: secondGroup,
      },
      undefined,
      direction.crossings?.end,
    );
    const end = patch.set.nodes![direction.to] ?? city.nodes[direction.to]!;
    patch.set.nodes![end.id] = replaceReferences(end, direction.id, id);
    replacements[direction.id] = [direction.id, id];
  }
  split(road, atM, road.streetGroupId, group);
  const reverse = opposite(city, road);
  if (reverse) {
    const onReverse = nearestPointOnLine(pos, reverse.centerline);
    if (onReverse.distance > 1e-6) throw new Error('Split the separate carriageways individually');
    split(reverse, onReverse.atM, group, road.streetGroupId);
  }
  patch.nextId = counter.nextId;
  return relocateConnectors(city, patch, replacements);
}

function mergeRoads(city: City, a: Road, b: Road): CommandPatch {
  const [first, second] = a.to === b.from ? [a, b] : [b, a];
  if (first.id === second.id || first.to !== second.from || first.from === second.to)
    throw new Error('Roads must form a continuous path');
  const node = city.nodes[first.to]!;
  const reverseFirst = opposite(city, first);
  const reverseSecond = opposite(city, second);
  const expected = [first, second, reverseFirst, reverseSecond].filter((r) => r !== undefined);
  const incident = Object.values(city.roads).filter((r) => r.from === node.id || r.to === node.id);
  if (incident.length !== expected.length || Boolean(reverseFirst) !== Boolean(reverseSecond))
    throw new Error('Merge requires a degree-two junction');
  if (
    node.control !== 'uncontrolled' ||
    node.turnRules.length ||
    node.minorRoads.length ||
    node.signal
  )
    throw new Error('Remove junction controls and turn rules before merging');
  const patch: CommandPatch = {
    set: { roads: {}, nodes: {} },
    remove: { roads: [], nodes: [node.id] },
  };
  const replacements: Record<string, string[]> = {};
  function merge(start: Road, end: Road, group: string | null) {
    const attributes = (r: Road) => [
      r.lanes,
      r.lateralOffsetM,
      r.roadClass,
      r.speedLimitMps,
      r.name,
      r.provenance,
    ];
    if (JSON.stringify(attributes(start)) !== JSON.stringify(attributes(end)))
      throw new Error('Merged roads must have equal attributes');
    const line = [...start.centerline, ...end.centerline.slice(1)];
    const seam = start.centerline.length - 1;
    if (nearestPointOnLine(line[seam]!, [line[seam - 1]!, line[seam + 1]!]).distance < 1e-8)
      line.splice(seam, 1);
    patch.set.roads![start.id] = withCrossings(
      { ...start, to: end.to, centerline: line, streetGroupId: group },
      start.crossings?.start,
      end.crossings?.end,
    );
    patch.remove.roads!.push(end.id);
    const far = patch.set.nodes![end.to] ?? city.nodes[end.to]!;
    patch.set.nodes![far.id] = replaceReferences(far, end.id, start.id);
    replacements[start.id] = replacements[end.id] = [start.id];
  }
  merge(first, second, first.streetGroupId);
  if (reverseFirst && reverseSecond) merge(reverseSecond, reverseFirst, first.streetGroupId);
  return relocateConnectors(city, patch, replacements);
}

export function editTopology(city: City, command: TopologyCommand): CommandPatch {
  if (command.kind === 'addRoad') {
    const counter = { nextId: city.nextId };
    const nodes = Object.fromEntries(
      command.newNodes.map((node) => {
        const id = allocateId(counter, 'n');
        return [id, { ...node, id }];
      }),
    );
    const id = allocateId(counter, 'r');
    return relocateConnectors(city, {
      set: { nodes, roads: { [id]: { ...command.road, id } } },
      remove: {},
      nextId: counter.nextId,
    });
  }
  if (command.kind === 'moveNode') {
    const node = requireEntity(city.nodes, command.nodeId);
    const roads = Object.fromEntries(
      Object.values(city.roads)
        .filter((r) => r.from === node.id || r.to === node.id)
        .map((r) => [
          r.id,
          {
            ...r,
            centerline: r.centerline.map((p, i) =>
              (i === 0 && r.from === node.id) || (i === r.centerline.length - 1 && r.to === node.id)
                ? command.pos
                : p,
            ),
          },
        ]),
    );
    return relocateConnectors(city, {
      set: { nodes: { [node.id]: { ...node, pos: command.pos } }, roads },
      remove: {},
    });
  }
  const road = requireEntity(city.roads, command.roadId);
  if (command.kind === 'splitRoad') return splitRoad(city, road, command.atM);
  if (command.kind === 'mergeRoads')
    return mergeRoads(city, road, requireEntity(city.roads, command.otherRoadId));
  const patch: CommandPatch = { set: {}, remove: { roads: [road.id], nodes: [] }, warnings: [] };
  const uses = ({ from, to }: { from: string; to: string }) => from === road.id || to === road.id;
  for (const node of Object.values(city.nodes)) {
    const turnRules = node.turnRules.filter((rule) => !uses(rule));
    const minorRoads = node.minorRoads.filter((id) => id !== road.id);
    const signalChanged = node.signal?.phases.some((p) => p.groups.some(uses));
    if (
      turnRules.length !== node.turnRules.length ||
      minorRoads.length !== node.minorRoads.length ||
      signalChanged
    ) {
      (patch.set.nodes ??= {})[node.id] = {
        ...node,
        turnRules,
        minorRoads,
        signal: node.signal && {
          ...node.signal,
          phases: node.signal.phases.map((phase) => ({
            ...phase,
            groups: phase.groups.filter((g) => !uses(g)),
          })),
        },
      };
      patch.warnings!.push({
        severity: 'warning',
        code: 'junction_references_removed',
        refs: [node.id, road.id],
        message: `Removed junction references to ${road.id} at ${node.id}`,
      });
    }
  }
  for (const id of [road.from, road.to]) {
    if (Object.values(city.roads).some((r) => r.id !== road.id && (r.from === id || r.to === id)))
      continue;
    patch.remove.nodes!.push(id);
    delete patch.set.nodes?.[id];
    patch.warnings!.push({
      severity: 'warning',
      code: 'orphan_node_removed',
      refs: [id, road.id],
      message: `Removed unused node ${id}`,
    });
  }
  for (const place of Object.values(city.places)) {
    const connectors = place.connectors.filter((c) => c.roadId !== road.id);
    if (connectors.length === place.connectors.length) continue;
    (patch.set.places ??= {})[place.id] = { ...place, connectors };
    for (const connector of place.connectors.filter((c) => c.roadId === road.id))
      patch.warnings!.push({
        severity: 'warning',
        code: 'connector_removed',
        refs: [place.id, connector.id, road.id],
        message: `Removed connector ${connector.id} with road ${road.id}`,
      });
  }
  return relocateConnectors(city, patch);
}
