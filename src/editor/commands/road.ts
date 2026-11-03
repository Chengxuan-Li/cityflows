import { roadWidth } from '../../network/lanes';
import { allocateId, type City, type Command, type Road, type RoadId } from '../../schema';
import { requireEntity, type CommandPatch } from './types';

type RoadCommand = Extract<
  Command,
  { kind: 'setRoadLanes' | 'setRoadAttributes' | 'reverseRoad' | 'setStreetDirection' }
>;

function defaultOffset(city: City, road: Road): number {
  return ((city.drivingSide === 'right' ? 1 : -1) * roadWidth(road)) / 2;
}

function oppositeGeometry(road: Road): Road {
  return { ...road, from: road.to, to: road.from, centerline: [...road.centerline].reverse() };
}

function removeJunctionReferences(city: City, road: Road, patch: CommandPatch): void {
  const usesRoad = ({ from, to }: { from: RoadId; to: RoadId }) =>
    from === road.id || to === road.id;

  for (const nodeId of [road.from, road.to]) {
    const node = city.nodes[nodeId]!;
    const turnRules = node.turnRules.filter((rule) => !usesRoad(rule));
    const minorRoads = node.minorRoads.filter((id) => id !== road.id);
    let signal = node.signal;
    if (signal?.phases.some((phase) => phase.groups.some(usesRoad))) {
      signal = {
        ...signal,
        phases: signal.phases.map((phase) => ({
          ...phase,
          groups: phase.groups.filter((group) => !usesRoad(group)),
        })),
      };
    }
    if (
      turnRules.length === node.turnRules.length &&
      minorRoads.length === node.minorRoads.length &&
      signal === node.signal
    )
      continue;

    (patch.set.nodes ??= {})[nodeId] = { ...node, turnRules, minorRoads, signal };
    (patch.warnings ??= []).push({
      severity: 'warning',
      code: 'junction_references_removed',
      refs: [nodeId, road.id],
      message: `Removed junction references to ${road.id} at ${nodeId}`,
    });
  }
}

function setRoadLanes(city: City, road: Road, lanes: Road['lanes']): CommandPatch {
  const next = { ...road, lanes };
  if (road.streetGroupId !== null && road.lateralOffsetM === defaultOffset(city, road)) {
    next.lateralOffsetM = defaultOffset(city, next);
  }
  const patch: CommandPatch = { set: { roads: { [road.id]: next } }, remove: {} };
  if (lanes.length === 0 || lanes.length >= road.lanes.length) return patch;

  const end = city.nodes[road.to]!;
  const start = city.nodes[road.from]!;
  for (const node of [end, start]) {
    const turnRules = node.turnRules.filter(
      ({ from, fromLane, to, toLane }) =>
        !(from === road.id && fromLane !== undefined && fromLane >= lanes.length) &&
        !(to === road.id && toLane !== undefined && toLane >= lanes.length),
    );
    if (turnRules.length !== node.turnRules.length) {
      (patch.set.nodes ??= {})[node.id] = { ...node, turnRules };
    }
  }

  const curbLane = city.drivingSide === 'right' ? lanes.length - 1 : 0;
  for (const place of Object.values(city.places)) {
    const connectors = place.connectors.map((connector) => {
      if (connector.roadId !== road.id || connector.lane < lanes.length) return connector;
      (patch.warnings ??= []).push({
        severity: 'warning',
        code: 'connector_lane_clamped',
        refs: [connector.id, place.id, road.id],
        message: `Moved connector ${connector.id} to lane ${curbLane} on ${road.id}`,
      });
      return { ...connector, lane: curbLane };
    });
    if (connectors.some((connector, index) => connector !== place.connectors[index])) {
      (patch.set.places ??= {})[place.id] = { ...place, connectors };
    }
  }
  return patch;
}

function setStreetDirection(
  city: City,
  { streetGroupId, direction }: Extract<RoadCommand, { kind: 'setStreetDirection' }>,
): CommandPatch {
  const roads = Object.values(city.roads).filter((road) => road.streetGroupId === streetGroupId);
  const patch: CommandPatch = { set: {}, remove: {} };
  if (roads.length < 1 || roads.length > 2) {
    throw new Error(`Expected one or two roads in street group ${streetGroupId}`);
  }

  if (direction === 'both') {
    if (roads.length === 2) return patch;
    const road = roads[0]!;
    const counter = { nextId: city.nextId };
    const id = allocateId(counter, 'r');
    const lateralOffsetM = defaultOffset(city, road);
    patch.nextId = counter.nextId;
    patch.set.roads = {
      [road.id]: { ...road, lateralOffsetM },
      [id]: { ...oppositeGeometry(road), id, lateralOffsetM, provenance: { source: 'authored' } },
    };
    return patch;
  }

  const kept = requireEntity(city.roads, direction);
  if (kept.streetGroupId !== streetGroupId) {
    throw new Error(`Road ${direction} is not in street group ${streetGroupId}`);
  }
  if (kept.lateralOffsetM !== 0) patch.set.roads = { [kept.id]: { ...kept, lateralOffsetM: 0 } };
  const removed = roads.find((road) => road.id !== kept.id);
  if (!removed) return patch;

  patch.remove.roads = [removed.id];
  removeJunctionReferences(city, removed, patch);
  for (const place of Object.values(city.places)) {
    const connectors = place.connectors.filter((connector) => {
      if (connector.roadId !== removed.id) return true;
      (patch.warnings ??= []).push({
        severity: 'warning',
        code: 'connector_removed',
        refs: [connector.id, place.id, removed.id],
        message: `Removed connector ${connector.id} with road ${removed.id}`,
      });
      return false;
    });
    if (connectors.length !== place.connectors.length) {
      (patch.set.places ??= {})[place.id] = { ...place, connectors };
    }
  }
  return patch;
}

export function editRoad(city: City, command: RoadCommand): CommandPatch {
  if (command.kind === 'setStreetDirection') return setStreetDirection(city, command);

  const road = requireEntity(city.roads, command.roadId);
  switch (command.kind) {
    case 'setRoadLanes':
      return setRoadLanes(city, road, command.lanes);
    case 'setRoadAttributes': {
      const {
        name = road.name,
        roadClass = road.roadClass,
        speedLimitMps = road.speedLimitMps,
      } = command;
      return {
        set: { roads: { [road.id]: { ...road, name, roadClass, speedLimitMps } } },
        remove: {},
      };
    }
    case 'reverseRoad': {
      const next = { ...oppositeGeometry(road), lateralOffsetM: -road.lateralOffsetM || 0 };
      const patch: CommandPatch = { set: { roads: { [road.id]: next } }, remove: {} };
      const paired =
        road.streetGroupId === null
          ? undefined
          : Object.values(city.roads).find(
              (other) => other.id !== road.id && other.streetGroupId === road.streetGroupId,
            );
      if (paired) {
        // A street group represents opposite directions. Reversing one makes them parallel.
        next.streetGroupId = null;
        patch.set.roads![paired.id] = { ...paired, streetGroupId: null };
      }
      removeJunctionReferences(city, road, patch);
      return patch;
    }
  }
}
