import { cumulativeLengths, headingAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City, Place, RoadClass } from '../schema';
import { populateConflicts } from './conflicts';
import { validateCity, warnAboutConnectivity, warnAboutProvenance } from './diagnostics';
import { continuationLayout } from './continuity';
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
      startOffsetM: 0,
      endOffsetM: 0,
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

  const laneHeadings = lanes.map((lane) => ({
    start: headingAtDistance(lane.polyline, lane.cumulative, 0),
    end: headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM),
  }));
  const provisional: CMovement[] = [];
  for (const node of nodes)
    generateMovements(
      node,
      sourceNodes[node.idx]!,
      incoming[node.idx]!,
      outgoing[node.idx]!,
      headings,
      lanes,
      city.drivingSide,
      provisional,
    );
  const continuity = continuationLayout(
    nodes,
    roads,
    lanes,
    provisional,
    sourceRoads,
    headings,
    city.drivingSide,
    sourceNodes,
  );
  for (const road of roads) {
    const trim = trims[road.idx]!;
    const total = trim.start + trim.end;
    const scale = total === 0 ? 1 : Math.min(1, Math.max(0, road.lengthM - 5) / total);
    trim.start *= scale;
    trim.end *= scale;
  }
  for (const node of nodes) {
    if (continuity.pairs.has(node.idx)) {
      node.setbacks = incident[node.idx]!.map(() => 0);
      node.radiusM = 0;
      for (const road of incident[node.idx]!)
        trims[road.idx]![road.from === node.idx ? 'start' : 'end'] = 0;
    }
    node.movements = [];
  }
  for (const road of roads) {
    const transition = continuity.ends[road.idx]!;
    if (!transition.start && !transition.end) continue;
    road.startOffsetM = transition.start?.offsetM ?? 0;
    road.endOffsetM = transition.end?.offsetM ?? 0;
    const rebuilt: CLane[] = [];
    const copy = { ...road, lanes: [] as number[], surface: [] as Vec2[] };
    const before =
      !transition.start && trims[road.idx]!.start === 0
        ? incoming[road.from]!.find((r) => r.from !== road.to)
        : undefined;
    const after =
      !transition.end && trims[road.idx]!.end === 0
        ? outgoing[road.to]!.find((r) => r.to !== road.from)
        : undefined;
    for (let i = diagnostics.length - 1; i >= 0; i--)
      if (diagnostics[i]!.code === 'road_too_short' && diagnostics[i]!.refs.includes(road.id))
        diagnostics.splice(i, 1);
    layoutRoad(
      sourceRoads[road.idx]!,
      copy,
      trims[road.idx]!.start,
      trims[road.idx]!.end,
      rebuilt,
      diagnostics,
      {
        before: before ? sourceRoads[before.idx]!.centerline.at(-2) : undefined,
        after: after ? sourceRoads[after.idx]!.centerline[1] : undefined,
      },
      transition,
    );
    for (const atEnd of [false, true]) {
      if (atEnd ? transition.end : transition.start) continue;
      const oldCut = atEnd ? road.surface.length / 2 : 0;
      const newCut = atEnd ? copy.surface.length / 2 : 0;
      for (const side of [-1, 0]) {
        copy.surface[(newCut + side + copy.surface.length) % copy.surface.length] =
          road.surface[(oldCut + side + road.surface.length) % road.surface.length]!;
      }
    }
    road.surface = copy.surface;
    for (const [i, lane] of rebuilt.entries()) {
      const original = lanes[road.lanes[i]!]!;
      if (!transition.start) lane.polyline[0] = original.polyline[0]!;
      if (!transition.end) lane.polyline[lane.polyline.length - 1] = original.polyline.at(-1)!;
      lane.cumulative = cumulativeLengths(lane.polyline);
      lane.lengthM = lane.cumulative.at(-1)!;
      original.polyline = lane.polyline;
      original.cumulative = lane.cumulative;
      original.lengthM = lane.lengthM;
      original.taperStartM = lane.taperStartM;
      original.taperEndM = lane.taperEndM;
    }
  }
  for (const lane of lanes) {
    lane.in = [];
    lane.out = [];
  }
  for (const node of nodes) node.outline = junctionOutline(node, incident[node.idx]!, lanes);
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
      continuity.pairs.get(node.idx),
      continuity.pairs.has(node.idx) ? undefined : laneHeadings,
    );
    containMovements(node, movements, lanes);
    populateConflicts(node, movements, lanes);
  }

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
  for (const lane of lanes) {
    if (!lane.taperEndM || lane.out.length) continue;
    const node = nodes[roads[lane.road]!.to]!;
    diagnostics.push({
      severity: 'info',
      code: 'lane_requires_merge',
      refs: [lane.id, node.id],
      message: `Lane ${lane.id} ends at ${node.id}; merge upstream within its ${lane.taperEndM} m taper`,
    });
  }
  warnAboutProvenance([...sourceNodes, ...sourceRoads, ...sourcePlaces], diagnostics);
  warnAboutConnectivity(compiled, diagnostics);
  return { ok: true, compiled, diagnostics };
}
