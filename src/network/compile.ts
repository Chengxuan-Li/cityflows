import { cumulativeLengths, headingAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City, Place, RoadClass } from '../schema';
import { populateConflicts } from './conflicts';
import { validateCity, warnAboutConnectivity, warnAboutProvenance } from './diagnostics';
import { layoutRoad } from './lanes';
import { junctionSetbacks, junctionOutline, containMovements } from './junctions';
import { generateMovements } from './movements';
import { compileSignal } from './signals';
import { buildLaneSpatial } from './spatial';
import type {
  CConnector,
  CLane,
  CMovement,
  CNode,
  CompiledCity,
  CompileResult,
  CPlace,
  CRoad,
  Diagnostic,
} from './types';

function sortedValues<T>(record: Record<string, T>): T[] {
  return Object.keys(record)
    .sort()
    .map((id) => record[id]!);
}

function indices(entities: { id: string; idx: number }[]): Map<string, number> {
  return new Map(entities.map((entity) => [entity.id, entity.idx]));
}

const classRank: Record<RoadClass, number> = {
  motorway: 8,
  trunk: 7,
  primary: 6,
  secondary: 5,
  tertiary: 4,
  residential: 3,
  service: 2,
  ramp: 1,
};

function centroid(shape: Place['shape']): Vec2 | null {
  if (shape.kind === 'point') return { ...shape.pos };
  const ring = shape.ring;
  const origin = ring[0]!;
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const ax = a.x - origin.x;
    const ay = a.y - origin.y;
    const bx = b.x - origin.x;
    const by = b.y - origin.y;
    const cross = ax * by - ay * bx;
    area += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  if (area === 0) return null;
  return { x: origin.x + x / (3 * area), y: origin.y + y / (3 * area) };
}

export function compile(city: City): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const sourceNodes = sortedValues(city.nodes);
  const sourceRoads = sortedValues(city.roads);
  const sourcePlaces = sortedValues(city.places);
  validateCity(city, sourceNodes, sourceRoads, sourcePlaces, diagnostics);
  if (diagnostics.length) return { ok: false, diagnostics };

  const nodes: CNode[] = sourceNodes.map(({ id, pos, control }, idx) => ({
    idx,
    id,
    pos: { ...pos },
    radiusM: 0,
    setbacks: [],
    outline: [],
    control,
    movements: [],
    signal: null,
  }));
  const nodeIndex = indices(nodes);
  const incoming = nodes.map((): CRoad[] => []);
  const outgoing = nodes.map((): CRoad[] => []);
  const headings: { start: number; end: number }[] = [];
  const roads: CRoad[] = sourceRoads.map((road, idx) => {
    const from = nodeIndex.get(road.from)!;
    const to = nodeIndex.get(road.to)!;
    const cumulative = cumulativeLengths(road.centerline);
    const lengthM = cumulative.at(-1)!;
    headings.push({
      start: headingAtDistance(road.centerline, cumulative, 0),
      end: headingAtDistance(road.centerline, cumulative, lengthM),
    });
    const compiled: CRoad = {
      idx,
      id: road.id,
      from,
      to,
      lanes: [],
      surface: [],
      lengthM,
      roadClass: road.roadClass,
      classRank: classRank[road.roadClass],
      speedLimitMps: road.speedLimitMps,
      streetGroupId: road.streetGroupId,
    };
    incoming[to]!.push(compiled);
    outgoing[from]!.push(compiled);
    return compiled;
  });
  const roadIndex = indices(roads);
  const incident = nodes.map((node) =>
    [...incoming[node.idx]!, ...outgoing[node.idx]!].sort((a, b) => a.idx - b.idx),
  );
  const trims = roads.map(() => ({ start: 0, end: 0 }));
  for (const node of nodes) {
    node.setbacks = junctionSetbacks(
      node,
      incident[node.idx]!.map((r) => sourceRoads[r.idx]!),
    );
    node.radiusM = Math.max(0, ...node.setbacks);
    incident[node.idx]!.forEach((road, i) => {
      trims[road.idx]![road.from === node.idx ? 'start' : 'end'] = node.setbacks[i]!;
    });
  }
  const lanes: CLane[] = [];
  // A ramp ranks one below the road it joins: the roads leaving its end node, or, when it only
  // leads into another ramp, the roads entering its start node. Other ramps do not count.
  const joinedRank = (neighbors: CRoad[]) =>
    Math.max(0, ...neighbors.map((next) => (next.roadClass === 'ramp' ? 0 : next.classRank)));
  for (const road of roads) {
    if (road.roadClass === 'ramp') {
      road.classRank = Math.max(
        1,
        (joinedRank(outgoing[road.to]!) || joinedRank(incoming[road.from]!)) - 1,
      );
    }
    const before =
      trims[road.idx]!.start === 0
        ? incoming[road.from]!.find((r) => r.from !== road.to)
        : undefined;
    const after =
      trims[road.idx]!.end === 0 ? outgoing[road.to]!.find((r) => r.to !== road.from) : undefined;
    layoutRoad(
      sourceRoads[road.idx]!,
      road,
      trims[road.idx]!.start,
      trims[road.idx]!.end,
      lanes,
      diagnostics,
      {
        before: before ? sourceRoads[before.idx]!.centerline.at(-2) : undefined,
        after: after ? sourceRoads[after.idx]!.centerline[1] : undefined,
      },
    );
  }

  for (const node of nodes) node.outline = junctionOutline(node, incident[node.idx]!, lanes);

  const places: CPlace[] = [];
  const connectors: CConnector[] = [];
  for (const source of sourcePlaces) {
    const center = centroid(source.shape);
    if (!center) {
      diagnostics.push({
        severity: 'error',
        code: 'place_invalid',
        refs: [source.id],
        message: `Place ${source.id} has a polygon with no area`,
      });
      continue;
    }
    const place: CPlace = {
      idx: places.length,
      id: source.id,
      kind: source.kind,
      centroid: center,
      connectorsIn: [],
      connectorsOut: [],
      capacity: source.capacity,
      events: source.events.map((event) => ({ ...event })),
    };
    places.push(place);
    if (!source.connectors.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'place_no_connector',
        refs: [place.id],
        message: `Place ${place.id} has no connectors`,
      });
    }
    for (const {
      id,
      roadId,
      lane: laneNumber,
      positionM,
      direction,
      throughputPerMin,
    } of source.connectors) {
      const road = roads[roadIndex.get(roadId)!]!;
      const lane = lanes[road.lanes[laneNumber]!]!;
      if (positionM > lane.lengthM) {
        diagnostics.push({
          severity: 'error',
          code: 'connector_invalid',
          refs: [id, place.id, roadId, lane.id],
          message: `Connector ${id} at ${place.id} is beyond the trimmed end of lane ${lane.id}`,
        });
        continue;
      }
      const idx = connectors.length;
      connectors.push({
        idx,
        id,
        place: place.idx,
        lane: lane.idx,
        positionM,
        direction,
        throughputPerMin,
      });
      lane.connectors.push(idx);
      if (direction !== 'out') place.connectorsIn.push(idx);
      if (direction !== 'in') place.connectorsOut.push(idx);
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, diagnostics };
  for (const lane of lanes) {
    lane.connectors.sort((a, b) => connectors[a]!.positionM - connectors[b]!.positionM);
  }

  const movements: CMovement[] = [];
  for (const node of nodes) {
    generateMovements(
      node,
      sourceNodes[node.idx]!,
      incoming[node.idx]!,
      outgoing[node.idx]!,
      headings,
      lanes,
      city.drivingSide,
      movements,
    );
    containMovements(node, movements, lanes);
    populateConflicts(node, movements);
  }

  const compiled: CompiledCity = {
    version: city.version,
    drivingSide: city.drivingSide,
    nodes,
    roads,
    lanes,
    movements,
    places,
    connectors,
    index: {
      node: nodeIndex,
      road: roadIndex,
      lane: indices(lanes),
      movement: indices(movements),
      place: indices(places),
      connector: indices(connectors),
    },
    laneSpatial: buildLaneSpatial(lanes),
  };
  for (const node of nodes) {
    if (node.control === 'signal') {
      node.signal = compileSignal(node, sourceNodes[node.idx]!.signal!, compiled, diagnostics);
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { ok: false, diagnostics };
  warnAboutProvenance([...sourceNodes, ...sourceRoads, ...sourcePlaces], diagnostics);
  warnAboutConnectivity(compiled, diagnostics);
  return { ok: true, compiled, diagnostics };
}
