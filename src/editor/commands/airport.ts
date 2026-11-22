import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  polylineLength,
  segmentsIntersect,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import {
  airsideRules,
  cityAirsideObstacles,
  derivedAirsideCodes,
  standReachM,
  taxiReachM,
} from '../../network/airside-codes';
import { allocateId, type City, type Command, type Provenance } from '../../schema';
import type { AircraftCode } from '../../schema/aircraft';
import type { Airport, AirsideEdge, HoldingPosition, Stand } from '../../schema/airport';
import { diffAirport } from '../patch';
import type { CommandPatch } from './types';
import { requireEntity } from './types';

// TASK-305: airside edits. Each handler edits a copy of the airport and returns the difference.
// Where an edit changes geometry, the codes TASK-295's import rules gave by rule (`maxCode` in
// `provenance.inferred`) are derived again for what the change can reach; a code the user set
// stays. New and moved stands join the taxi network as the import joins a stand node.

type AirportCommand = Extract<
  Command,
  {
    kind:
      | 'addStand'
      | 'moveStand'
      | 'setStand'
      | 'deleteStand'
      | 'addTaxiway'
      | 'splitTaxiway'
      | 'setTaxiway'
      | 'deleteTaxiway'
      | 'addHold'
      | 'moveHold'
      | 'setHold'
      | 'deleteHold'
      | 'setRunwayOperations';
  }
>;

const authored: Provenance = { source: 'authored' };
const taxiKinds = new Set(['taxiway', 'taxilane']);
const without = (list: string[] | undefined, item: string) => list?.filter((x) => x !== item);
const withInferred = (provenance: Provenance, item: string, on: boolean): Provenance => {
  const rest = without(provenance.inferred, item) ?? [];
  const inferred = on ? [...rest, item] : rest;
  const next: Provenance = { ...provenance, inferred };
  if (!inferred.length) delete next.inferred;
  return next;
};
const codeWidth = (code: AircraftCode | null) => airsideRules.taxiwayWidthM[code ?? 'A'];

/** Whether two polylines come within `limit` of each other. */
function linesWithin(a: readonly Vec2[], b: readonly Vec2[], limit: number) {
  if (a.some((p) => nearestOnPolyline(b, p).away <= limit)) return true;
  if (b.some((p) => nearestOnPolyline(a, p).away <= limit)) return true;
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++)
      if (segmentsIntersect(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
  return false;
}

export function editAirport(city: City, command: AirportCommand): CommandPatch {
  const airport = city.airport;
  if (!airport) throw new Error('This city has no airport');
  const next: Airport = {
    ...airport,
    nodes: { ...airport.nodes },
    edges: { ...airport.edges },
    runways: { ...airport.runways },
    holdingPositions: { ...airport.holdingPositions },
    stands: { ...airport.stands },
  };
  const ids = { nextId: city.nextId };
  /** Stands and taxi edges whose inferred codes the edit can change, and the changed lines. */
  const changedStands = new Set<string>();
  const changedLines: Vec2[][] = [];
  const changedEdges = new Set<string>();

  const incident = (node: string) =>
    Object.values(next.edges).filter((e) => e.from === node || e.to === node);

  /** Splits a taxi or runway edge `atM` along it; the node there (an end within 1 m). */
  function split(edgeId: string, atM: number): string {
    const edge = requireEntity(next.edges, edgeId);
    if (edge.kind === 'lead_in') throw new Error('A stand lead-in cannot be split');
    const lengths = cumulativeLengths(edge.line);
    const length = lengths.at(-1)!;
    if (atM < 1) return edge.from;
    if (atM > length - 1) return edge.to;
    const point = pointAtDistance(edge.line, lengths, atM);
    let i = 1;
    while (lengths[i]! < atM) i++;
    const node = allocateId(ids, 'an');
    next.nodes[node] = { id: node, pos: point, layer: edge.layer, provenance: authored };
    const second = allocateId(ids, 'ae');
    const head = edge.line.slice(0, distance(point, edge.line[i - 1]!) < 1e-7 ? i - 1 : i);
    const tail = edge.line.slice(distance(point, edge.line[i]!) < 1e-7 ? i + 1 : i);
    next.edges[edgeId] = { ...edge, to: node, line: [...head, point] };
    next.edges[second] = { ...edge, id: second, from: node, line: [point, ...tail] };
    if (edge.runway) {
      const runway = next.runways[edge.runway]!;
      const at = runway.edges.indexOf(edgeId);
      next.runways[runway.id] = {
        ...runway,
        edges: [...runway.edges.slice(0, at + 1), second, ...runway.edges.slice(at + 1)],
      };
    }
    for (const hold of Object.values(next.holdingPositions))
      if (hold.toward === edgeId && hold.node === edge.to)
        next.holdingPositions[hold.id] = { ...hold, toward: second };
    if (next.roadCrossings.some((c) => c.edge === edgeId))
      next.roadCrossings = next.roadCrossings.map((c) =>
        c.edge === edgeId &&
        nearestOnPolyline(next.edges[second]!.line, c.pos).away <
          nearestOnPolyline(next.edges[edgeId]!.line, c.pos).away
          ? { ...c, edge: second }
          : c,
      );
    return node;
  }

  /** Removes an edge, the end nodes it leaves without edges and the holds on them; holds that
   * looked toward it look again, and road crossings on it go. */
  function removeEdge(edgeId: string) {
    const edge = requireEntity(next.edges, edgeId);
    delete next.edges[edgeId];
    const ends = new Set(
      Object.values(next.runways).flatMap((r) => r.ends.flatMap((e) => [e.node, e.threshold.node])),
    );
    for (const node of new Set([edge.from, edge.to]))
      if (!ends.has(node) && !incident(node).length) {
        delete next.nodes[node];
        for (const hold of Object.values(next.holdingPositions))
          if (hold.node === node) delete next.holdingPositions[hold.id];
      }
    for (const hold of Object.values(next.holdingPositions))
      if (hold.toward === edgeId)
        next.holdingPositions[hold.id] = { ...hold, ...holdFields(hold.node, hold.runway) };
    if (next.roadCrossings.some((c) => c.edge === edgeId))
      next.roadCrossings = next.roadCrossings.filter((c) => c.edge !== edgeId);
  }

  /** The runway the taxi graph reaches first from `start` within 1 km of travel (or `runway`
   * at any distance), the first edge on the way and the travel. */
  function reachRunway(start: string, runway?: string) {
    const runwayAt = new Map<string, string>();
    for (const r of Object.values(next.runways))
      if (!runway || r.id === runway)
        for (const id of r.edges)
          for (const node of [next.edges[id]!.from, next.edges[id]!.to]) runwayAt.set(node, r.id);
    const limit = runway ? Infinity : airsideRules.holdSearchM;
    const found = new Map([[start, 0]]);
    const via = new Map<string, string>();
    const queue = [start];
    while (queue.length) {
      queue.sort((a, b) => found.get(b)! - found.get(a)! || (a < b ? 1 : -1));
      const at = queue.pop()!;
      if (at !== start && runwayAt.has(at))
        return { runway: runwayAt.get(at)!, edge: via.get(at)!, travel: found.get(at)! };
      for (const edge of incident(at)) {
        if (edge.kind === 'lead_in') continue;
        const other = edge.from === at ? edge.to : edge.from;
        const d = found.get(at)! + polylineLength(edge.line);
        if (d > limit || d >= (found.get(other) ?? Infinity)) continue;
        found.set(other, d);
        via.set(other, via.get(at) ?? edge.id);
        queue.push(other);
      }
    }
    return undefined;
  }

  /** A hold's protected runway (undefined: the first the graph reaches within 1 km, as an
   * imported runway hold; null: none, an intermediate hold), its side and `toward` edge. */
  function holdFields(
    node: string,
    runway: string | null | undefined,
  ): Pick<HoldingPosition, 'kind' | 'runway' | 'side' | 'toward'> {
    if (runway === null) return { kind: 'intermediate', runway: null, side: null, toward: null };
    if (runway !== undefined) requireEntity(next.runways, runway);
    const on = Object.values(next.runways).find(
      (r) =>
        (runway === undefined || r.id === runway) &&
        r.edges.some((id) => next.edges[id]!.from === node || next.edges[id]!.to === node),
    );
    const reached = on ? undefined : reachRunway(node, runway);
    const protectedId = on?.id ?? reached?.runway ?? runway;
    if (!protectedId) return { kind: 'intermediate', runway: null, side: null, toward: null };
    const r = next.runways[protectedId]!;
    const a = next.nodes[r.ends[0].node]!.pos,
      b = next.nodes[r.ends[1].node]!.pos,
      p = next.nodes[node]!.pos;
    return {
      kind: 'runway',
      runway: protectedId,
      side: (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0 ? 'right' : 'left',
      toward: reached?.edge ?? null,
    };
  }

  /** A stand's lead-in from the nearest taxiway or taxilane point within 150 m whose straight
   * line to `pos` crosses no building but one the stand is in; its heading is that line's. */
  function leadIn(standId: string, pos: Vec2, code: AircraftCode | null, codeInferred: boolean) {
    const obstacles = cityAirsideObstacles(city, next);
    const skip = obstacles.containing([pos]);
    let best: { edge: AirsideEdge; along: number; away: number; point: Vec2 } | undefined;
    for (const id of Object.keys(next.edges).sort()) {
      const edge = next.edges[id]!;
      if (!taxiKinds.has(edge.kind) || edge.layer !== 0) continue;
      const near = nearestOnPolyline(edge.line, pos);
      if (near.away > airsideRules.standJoinM || (best && near.away >= best.away)) continue;
      if (obstacles.crossesBuilding(near.point, pos, skip)) continue;
      best = { edge, ...near };
    }
    if (!best)
      throw new Error(
        `A stand needs a taxiway or taxilane within ${airsideRules.standJoinM} m that it can reach without crossing a building`,
      );
    const root = split(best.edge.id, best.along);
    const rootPos = next.nodes[root]!.pos;
    if (distance(rootPos, pos) < 5) throw new Error('A stand must stand clear of the taxiway');
    const stop = allocateId(ids, 'an');
    next.nodes[stop] = { id: stop, pos, layer: 0, provenance: authored };
    const edge = allocateId(ids, 'ae');
    next.edges[edge] = {
      id: edge,
      from: root,
      to: stop,
      line: [rootPos, pos],
      kind: 'lead_in',
      layer: 0,
      widthM: codeWidth(code),
      maxCode: code,
      stand: standId,
      provenance: {
        source: 'authored',
        inferred: ['widthM', ...(codeInferred ? ['maxCode'] : [])],
      },
    };
    return { leadIn: [edge], heading: Math.atan2(pos.y - rootPos.y, pos.x - rootPos.x) };
  }

  function removeLeadIn(stand: Stand) {
    for (const id of stand.leadIn) removeEdge(id);
  }

  /** Marks the derived stands near `points` for a new derivation. */
  function standsNear(...points: Vec2[]) {
    for (const stand of Object.values(next.stands))
      if (points.some((p) => distance(p, stand.pos) <= standReachM)) changedStands.add(stand.id);
  }

  function setStandCode(stand: Stand, code: AircraftCode | null, provenance: Provenance) {
    next.stands[stand.id] = { ...stand, maxCode: code, provenance };
    for (const id of stand.leadIn) {
      const edge = next.edges[id]!;
      const widthM = edge.provenance.inferred?.includes('widthM') ? codeWidth(code) : edge.widthM;
      if (edge.maxCode !== code || edge.widthM !== widthM)
        next.edges[id] = { ...edge, maxCode: code, widthM };
    }
  }

  switch (command.kind) {
    case 'addStand': {
      const id = allocateId(ids, 'st');
      const inferred = command.maxCode === undefined || command.maxCode === 'rule';
      const code = inferred ? null : (command.maxCode as AircraftCode | null);
      const { leadIn: edges, heading } = leadIn(id, command.pos, code, inferred);
      next.stands[id] = {
        id,
        ...(command.ref ? { ref: command.ref } : {}),
        kind: command.standKind,
        pos: command.pos,
        heading,
        leadIn: edges,
        gate: null,
        maxCode: code,
        osmIds: [],
        provenance: inferred ? { source: 'authored', inferred: ['maxCode'] } : authored,
      };
      changedStands.add(id);
      standsNear(command.pos);
      break;
    }
    case 'moveStand': {
      const stand = requireEntity(next.stands, command.standId);
      removeLeadIn(stand);
      const inferred = stand.provenance.inferred?.includes('maxCode') ?? false;
      const placed = leadIn(stand.id, command.pos, stand.maxCode, inferred);
      next.stands[stand.id] = { ...stand, pos: command.pos, ...placed };
      changedStands.add(stand.id);
      standsNear(stand.pos, command.pos);
      break;
    }
    case 'setStand': {
      const stand = requireEntity(next.stands, command.standId);
      const edited: Stand = { ...stand };
      if (command.standKind) {
        edited.kind = command.standKind;
        edited.provenance = withInferred(edited.provenance, 'kind', false);
      }
      if (command.ref !== undefined) {
        if (command.ref) edited.ref = command.ref;
        else delete edited.ref;
      }
      if (command.maxCode !== undefined) {
        const rule = command.maxCode === 'rule';
        edited.provenance = withInferred(edited.provenance, 'maxCode', rule);
        if (rule) changedStands.add(stand.id);
        else edited.maxCode = command.maxCode as AircraftCode | null;
      }
      setStandCode(edited, edited.maxCode, edited.provenance);
      break;
    }
    case 'deleteStand': {
      const stand = requireEntity(next.stands, command.standId);
      removeLeadIn(stand);
      delete next.stands[stand.id];
      standsNear(stand.pos);
      break;
    }
    case 'addTaxiway': {
      if (command.vertices.length < 2) throw new Error('A taxiway needs two points');
      // Points on an edge split it, the farthest along first so the others keep their place.
      const nodes: (string | undefined)[] = command.vertices.map((v) =>
        'node' in v ? requireEntity(next.nodes, v.node).id : undefined,
      );
      const onEdges = command.vertices
        .map((v, i) => ({ v, i }))
        .filter((x): x is { v: { edge: string; atM: number }; i: number } => 'edge' in x.v)
        .sort((a, b) => (a.v.edge < b.v.edge ? -1 : a.v.edge > b.v.edge ? 1 : b.v.atM - a.v.atM));
      for (const { v, i } of onEdges) {
        const edge = requireEntity(next.edges, v.edge);
        if (!taxiKinds.has(edge.kind) && edge.kind !== 'runway')
          throw new Error('A taxiway joins taxiways, taxilanes and runways only');
        nodes[i] = split(v.edge, v.atM);
      }
      const points = command.vertices.map((v, i) =>
        nodes[i] ? next.nodes[nodes[i]]!.pos : (v as { pos: Vec2 }).pos,
      );
      for (const i of [0, points.length - 1])
        if (!nodes[i]) {
          const id = allocateId(ids, 'an');
          next.nodes[id] = { id, pos: points[i]!, layer: 0, provenance: authored };
          nodes[i] = id;
        }
      const widthMapped = command.widthM !== undefined;
      const codeInferred = command.maxCode === undefined || command.maxCode === 'rule';
      const code = codeInferred ? null : (command.maxCode as AircraftCode | null);
      let start = 0;
      for (let i = 1; i < points.length; i++) {
        if (!nodes[i]) continue;
        const line = points.slice(start, i + 1);
        if (polylineLength(line) < 1) throw new Error('A taxiway section must be at least 1 m');
        const id = allocateId(ids, 'ae');
        next.edges[id] = {
          id,
          from: nodes[start]!,
          to: nodes[i]!,
          line,
          kind: command.edgeKind,
          layer: 0,
          widthM: command.widthM ?? codeWidth(code),
          maxCode: code,
          ...(command.ref ? { ref: command.ref } : {}),
          provenance: {
            source: 'authored',
            ...(widthMapped && !codeInferred
              ? {}
              : {
                  inferred: [
                    ...(widthMapped ? [] : ['widthM']),
                    ...(codeInferred ? ['maxCode'] : []),
                  ],
                }),
          },
        };
        changedEdges.add(id);
        changedLines.push(line);
        start = i;
      }
      break;
    }
    case 'splitTaxiway': {
      const edge = requireEntity(next.edges, command.edgeId);
      if (!taxiKinds.has(edge.kind)) throw new Error('Only taxiways and taxilanes split here');
      const length = polylineLength(edge.line);
      if (command.atM < 1 || command.atM > length - 1)
        throw new Error('Split a taxiway at least 1 m from its ends');
      split(edge.id, command.atM);
      break;
    }
    case 'setTaxiway': {
      const edge = requireEntity(next.edges, command.edgeId);
      if (!taxiKinds.has(edge.kind)) throw new Error('Only taxiways and taxilanes are edited here');
      const edited: AirsideEdge = { ...edge };
      if (command.edgeKind && command.edgeKind !== edge.kind) {
        edited.kind = command.edgeKind;
        changedLines.push(edge.line);
      }
      if (command.ref !== undefined) {
        if (command.ref) edited.ref = command.ref;
        else delete edited.ref;
      }
      if (command.widthM !== undefined) {
        edited.provenance = withInferred(edited.provenance, 'widthM', command.widthM === null);
        edited.widthM = command.widthM ?? codeWidth(edited.maxCode);
        changedEdges.add(edge.id);
      }
      if (command.maxCode === 'rule') {
        edited.provenance = withInferred(edited.provenance, 'maxCode', true);
        changedEdges.add(edge.id);
      } else if (command.maxCode !== undefined) {
        edited.provenance = withInferred(edited.provenance, 'maxCode', false);
        edited.maxCode = command.maxCode;
        if (edited.provenance.inferred?.includes('widthM'))
          edited.widthM = codeWidth(command.maxCode);
      }
      next.edges[edge.id] = edited;
      break;
    }
    case 'deleteTaxiway': {
      const edge = requireEntity(next.edges, command.edgeId);
      if (!taxiKinds.has(edge.kind))
        throw new Error('Only taxiways and taxilanes are deleted here');
      removeEdge(edge.id);
      changedLines.push(edge.line);
      break;
    }
    case 'addHold':
    case 'moveHold': {
      const edge = requireEntity(next.edges, command.edgeId);
      if (!taxiKinds.has(edge.kind)) throw new Error('A holding position stands on a taxiway');
      const hold =
        command.kind === 'moveHold' ? requireEntity(next.holdingPositions, command.holdId) : null;
      const node = split(edge.id, command.atM);
      if (Object.values(next.holdingPositions).some((h) => h.node === node && h.id !== hold?.id))
        throw new Error('A holding position is already there');
      if (hold) {
        next.holdingPositions[hold.id] = {
          ...hold,
          node,
          ...holdFields(node, hold.runway),
          provenance: withInferred(hold.provenance, 'node', false),
        };
        break;
      }
      const id = allocateId(ids, 'hp');
      next.holdingPositions[id] = {
        id,
        node,
        ...(command.kind === 'addHold' && command.ref ? { ref: command.ref } : {}),
        ...holdFields(node, command.kind === 'addHold' ? command.runway : undefined),
        provenance: authored,
      };
      break;
    }
    case 'setHold': {
      const hold = requireEntity(next.holdingPositions, command.holdId);
      const edited: HoldingPosition = {
        ...hold,
        ...(command.runway !== undefined && {
          ...holdFields(hold.node, command.runway),
          provenance: withInferred(hold.provenance, 'kind', false),
        }),
      };
      if (command.ref !== undefined) {
        if (command.ref) edited.ref = command.ref;
        else delete edited.ref;
      }
      next.holdingPositions[hold.id] = edited;
      break;
    }
    case 'deleteHold':
      delete next.holdingPositions[requireEntity(next.holdingPositions, command.holdId).id];
      break;
    case 'setRunwayOperations':
      if (command.operations) next.runwayOperations = command.operations;
      else delete next.runwayOperations;
      break;
  }

  // Codes by rule again where the edit reaches.
  for (const line of changedLines)
    for (const edge of Object.values(next.edges))
      if (taxiKinds.has(edge.kind) && linesWithin(edge.line, line, taxiReachM))
        changedEdges.add(edge.id);
  if (changedStands.size || changedEdges.size) {
    const codes = derivedAirsideCodes(city, next, changedStands, changedEdges);
    for (const [id, code] of codes.stands) {
      const stand = next.stands[id]!;
      if (code !== stand.maxCode) setStandCode(stand, code, stand.provenance);
    }
    for (const [id, code] of codes.edges) {
      const edge = next.edges[id]!;
      const widthM = edge.provenance.inferred?.includes('widthM') ? codeWidth(code) : edge.widthM;
      if (code !== edge.maxCode || widthM !== edge.widthM)
        next.edges[id] = { ...edge, maxCode: code, widthM };
    }
  }
  return {
    set: {},
    remove: {},
    airport: diffAirport(airport, next),
    ...(ids.nextId !== city.nextId ? { nextId: ids.nextId } : {}),
  };
}
