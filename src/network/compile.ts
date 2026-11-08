import { cumulativeLengths, headingAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City, Place, RoadClass } from '../schema';
import { vehicleClasses } from '../schema';
import { populateConflicts } from './conflicts';
import { validateCity, warnAboutConnectivity, warnAboutProvenance } from './diagnostics';
import { continuationLayout, convergingFlows, convergingShifts } from './continuity';
import { continuingRoad, corridorReferences, corridorSurfaces, EASED_NOTE_M } from './corridor';
import { layoutRoad, type ContinuationEnd } from './lanes';
import {
  farThrough,
  junctionCuts,
  junctionPolygon,
  MAX_SHIFT_M,
  throughAlignments,
  throughPath,
} from './junctions';
import { generateMovements } from './movements';
import { compileSignal, compileSignalWalk } from './signals';
import { buildLaneSpatial } from './spatial';
import { compileWalk, emptyWalkGraph } from './walk';
import { populateStops } from './stops';
import { compileParking, compileVisibleParking } from './parking';
import { generateStalls } from './stalls';
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
      access: vehicleClasses.map((kind) => road.access?.[kind] ?? road.access?.all ?? 'yes'),
      zone: new Int32Array(vehicleClasses.length).fill(-1),
      idx,
      id: road.id,
      from,
      to,
      lanes: [],
      surface: [],
      corridorSurface: [],
      reference: [],
      stations: new Float64Array(0),
      startOffsetM: 0,
      endOffsetM: 0,
      startShift: new Float64Array(0),
      endShift: new Float64Array(0),
      lengthM,
      roadClass: road.roadClass,
      classRank: classRank[road.roadClass],
      speedLimitMps: road.speedLimitMps,
      streetGroupId: road.streetGroupId,
      corridorId: road.corridorId ?? road.streetGroupId,
    };
    incoming[to]!.push(compiled);
    outgoing[from]!.push(compiled);
    return compiled;
  });
  const roadIndex = indices(roads);
  const incident = nodes.map((node) =>
    [...incoming[node.idx]!, ...outgoing[node.idx]!].sort((a, b) => a.idx - b.idx),
  );
  // A lot grants local access only to its own endpoints, never to neighbouring private streets.
  const lotByRoad = new Map<string, string>();
  for (const lot of sortedValues(city.parking ?? {}))
    if (lot.kind === 'lot')
      for (const id of lot.aisles ?? []) if (!lotByRoad.has(id)) lotByRoad.set(id, lot.id);
  for (let kind = 0; kind < vehicleClasses.length; kind++) {
    let zone = 0;
    const restricted = (road: CRoad) =>
      road.access[kind] === 'destination' || road.access[kind] === 'private';
    for (const road of roads) {
      if (!restricted(road) || road.zone[kind] !== -1) continue;
      const pending = [road];
      road.zone[kind] = zone;
      for (let i = 0; i < pending.length; i++) {
        const current = pending[i]!;
        for (const node of [current.from, current.to])
          for (const next of incident[node]!) {
            if (!restricted(next) || next.zone[kind] !== -1) continue;
            if (lotByRoad.get(current.id) !== lotByRoad.get(next.id)) continue;
            next.zone[kind] = zone;
            pending.push(next);
          }
      }
      zone++;
    }
  }
  // A ramp ranks one below the road it joins: the roads leaving its end node, or, when it only
  // leads into another ramp, the roads entering its start node. Other ramps do not count.
  const joinedRank = (neighbors: CRoad[]) =>
    Math.max(0, ...neighbors.map((next) => (next.roadClass === 'ramp' ? 0 : next.classRank)));
  for (const road of roads)
    if (road.roadClass === 'ramp')
      road.classRank = Math.max(
        1,
        (joinedRank(outgoing[road.to]!) || joinedRank(incoming[road.from]!)) - 1,
      );
  const references = corridorReferences(sourceRoads, diagnostics);
  // TASK-083: through roads keep their line across junctions; the cuts follow the new lines.
  // TASK-089: converging carriageways, found on the lines as drawn, cross their node as strips:
  // each direction's two carriageways join as a through pair (`convergingFlows`).
  const drawn = [...references];
  const unshifted = nodes.map(
    (node) => junctionCuts(node, incident[node.idx]!, sourceRoads, drawn).setbacks,
  );
  const converging = convergingShifts(
    nodes,
    incident,
    sourceRoads,
    drawn,
    nodes.map(() => []),
    unshifted,
    city.drivingSide,
    sourceNodes,
  ).groups;
  const flows = convergingFlows(converging, sourceRoads);
  // B43: a through road may keep its line farther from the node where the side roads' cuts move
  // with it by at most 2 m (T38.4's storage allowance).
  const far = farThrough(nodes, incident, sourceRoads, references, 2);
  const through = throughAlignments(
    nodes,
    incident,
    sourceRoads,
    references,
    (node) => (far.has(node.idx) ? Infinity : MAX_SHIFT_M),
    flows,
  );
  // Their lane blocks set side by side; the cuts and lanes follow the shifts.
  convergingShifts(
    nodes,
    incident,
    sourceRoads,
    references,
    through,
    unshifted,
    city.drivingSide,
    sourceNodes,
    converging,
  ).shifts.forEach(({ start, end }, idx) => {
    roads[idx]!.startShift = start;
    roads[idx]!.endShift = end;
  });
  const approaches = nodes.map(() => ({ approaches: [] as number[][], hidden: [] as number[] }));
  const trims = roads.map(() => ({ start: 0, end: 0 }));
  for (const node of nodes) {
    const cuts = junctionCuts(node, incident[node.idx]!, sourceRoads, references);
    node.setbacks = cuts.setbacks;
    approaches[node.idx] = cuts;
    node.radiusM = Math.max(0, ...node.setbacks);
    incident[node.idx]!.forEach((road, i) => {
      trims[road.idx]![road.from === node.idx ? 'start' : 'end'] = node.setbacks[i]!;
    });
  }
  const jointDeviations = roads.map(() => 0);
  const lanes: CLane[] = [];
  for (const road of roads) {
    const before =
      trims[road.idx]!.start === 0
        ? continuingRoad(references, road, incoming[road.from]!, false)
        : undefined;
    const after =
      trims[road.idx]!.end === 0
        ? continuingRoad(references, road, outgoing[road.to]!, true)
        : undefined;
    jointDeviations[road.idx] = layoutRoad(
      sourceRoads[road.idx]!,
      road,
      references[road.idx]!,
      trims[road.idx]!.start,
      trims[road.idx]!.end,
      lanes,
      diagnostics,
      {
        before: before ? references[before.idx]!.points.at(-2) : undefined,
        after: after ? references[after.idx]!.points[1] : undefined,
      },
    ).jointDeviationM;
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
  // TASK-082: at a continuation node where no end shifts, tapers or splits (a street continuing
  // into the next with the same lanes), the lanes run along their own corridors and meet at the
  // node's mitre, as at a through node, instead of easing onto a straight ray along the node's
  // heading, which pulls them off a curving road.
  const shifts = (end: ContinuationEnd | undefined) =>
    !!end && (end.offsetM !== 0 || !!end.splitM || end.tapers.length > 0);
  const plain = nodes.map(() => true);
  for (const road of roads) {
    const { start, end } = continuity.ends[road.idx]!;
    if (shifts(start)) plain[road.from] = false;
    if (shifts(end)) plain[road.to] = false;
  }
  for (const road of roads) {
    const ends = continuity.ends[road.idx]!;
    const moving = (end: ContinuationEnd | undefined, node: number) =>
      end && (!plain[node] || end.holdM + end.taperM === 0) ? end : undefined;
    if (!ends.start && !ends.end) continue;
    const transition = { start: moving(ends.start, road.from), end: moving(ends.end, road.to) };
    road.startOffsetM = transition.start?.offsetM ?? 0;
    road.endOffsetM = transition.end?.offsetM ?? 0;
    const rebuilt: CLane[] = [];
    const copy = { ...road, lanes: [] as number[], surface: [] as Vec2[] };
    const before =
      !transition.start && trims[road.idx]!.start === 0
        ? continuingRoad(references, road, incoming[road.from]!, false)
        : undefined;
    const after =
      !transition.end && trims[road.idx]!.end === 0
        ? continuingRoad(references, road, outgoing[road.to]!, true)
        : undefined;
    for (let i = diagnostics.length - 1; i >= 0; i--)
      if (diagnostics[i]!.code === 'road_too_short' && diagnostics[i]!.refs.includes(road.id))
        diagnostics.splice(i, 1);
    jointDeviations[road.idx] = layoutRoad(
      sourceRoads[road.idx]!,
      copy,
      references[road.idx]!,
      trims[road.idx]!.start,
      trims[road.idx]!.end,
      rebuilt,
      diagnostics,
      {
        before: before ? references[before.idx]!.points.at(-2) : undefined,
        after: after ? references[after.idx]!.points[1] : undefined,
      },
      transition,
    ).jointDeviationM;
    for (const atEnd of [false, true]) {
      if (atEnd ? ends.end : ends.start) continue;
      const oldCut = atEnd ? road.surface.length / 2 : 0;
      const newCut = atEnd ? copy.surface.length / 2 : 0;
      for (const side of [-1, 0]) {
        copy.surface[(newCut + side + copy.surface.length) % copy.surface.length] =
          road.surface[(oldCut + side + road.surface.length) % road.surface.length]!;
      }
    }
    road.surface = copy.surface;
    road.reference = copy.reference;
    road.stations = copy.stations;
    for (const [i, lane] of rebuilt.entries()) {
      const original = lanes[road.lanes[i]!]!;
      if (!ends.start) lane.polyline[0] = original.polyline[0]!;
      if (!ends.end) lane.polyline[lane.polyline.length - 1] = original.polyline.at(-1)!;
      lane.cumulative = cumulativeLengths(lane.polyline);
      lane.lengthM = lane.cumulative.at(-1)!;
      original.polyline = lane.polyline;
      original.normals = lane.normals;
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
  const movements: CMovement[] = [];
  for (const node of nodes) {
    const pairs = new Set(through[node.idx]!.map((p) => `${p.from}>${p.to}`));
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
      pairs.size
        ? (a, b) =>
            pairs.has(`${a.road}>${b.road}`)
              ? throughPath(roads[a.road]!, roads[b.road]!, a, b)
              : undefined
        : undefined,
    );
    node.outline = junctionPolygon(
      node,
      incident[node.idx]!,
      approaches[node.idx]!.approaches,
      approaches[node.idx]!.hidden,
      through[node.idx]!,
      lanes,
      movements,
    );
    populateConflicts(node, movements, lanes);
  }
  corridorSurfaces(roads);
  for (const road of roads)
    if (jointDeviations[road.idx]! > EASED_NOTE_M)
      diagnostics.push({
        severity: 'info',
        code: 'reference_eased',
        refs: [road.id],
        message: `${road.id} is eased up to ${jointDeviations[road.idx]!.toFixed(2)} m off its centerline where it joins the next road, so their lanes meet without a kink`,
      });

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
    walk: emptyWalkGraph(),
    version: city.version,
    drivingSide: city.drivingSide,
    nodes,
    roads,
    lanes,
    movements,
    places,
    connectors,
    parking: [],
    index: {
      node: nodeIndex,
      road: roadIndex,
      lane: indices(lanes),
      movement: indices(movements),
      place: indices(places),
      connector: indices(connectors),
      parking: new Map(),
    },
    laneSpatial: buildLaneSpatial(lanes),
  };
  compileParking(city, compiled, diagnostics, centroid);
  for (const lane of lanes)
    lane.connectors.sort((a, b) => connectors[a]!.positionM - connectors[b]!.positionM || a - b);
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
  // Before the stops: a stop keeps clear of crossings, and lot aisles add none (`crossingDefault`).
  if (Object.values(city.parking ?? {}).some((lot) => lot.kind === 'lot'))
    compiled.lots = generateStalls(city, compiled);
  populateStops(compiled, city);
  compileVisibleParking(city, compiled, centroid);
  for (const lane of lanes)
    lane.connectors.sort((a, b) => connectors[a]!.positionM - connectors[b]!.positionM || a - b);
  warnAboutConnectivity(compiled, diagnostics);
  compiled.walk = compileWalk(city, compiled);
  compileSignalWalk(compiled, city);
  return { ok: true, compiled, diagnostics };
}
