import type { Vec2 } from '../../geo/vec2';
import {
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineCrossings,
} from '../../geo/polyline';
import { parkingEgress } from '../../network/parking-egress';
import { compileVisibleParking } from '../../network/parking';
import { lonLatToLocal } from '../../geo/projection';
import type { CompiledCity } from '../../network';
import { allocateId, type City, type Place, type RoadClass } from '../../schema';
import { contains, type Bounds } from './clip';
import type { OsmData, OsmTags } from './parse';
import type { OsmRoad } from './roads';

const gatewayDemand: Record<RoadClass, number> = {
  motorway: 400,
  trunk: 300,
  primary: 200,
  secondary: 120,
  tertiary: 80,
  residential: 40,
  service: 20,
  ramp: 80,
};

// Place access uses actual movement paths, not a road-level approximation that can require
// an impossible lane change on a short section. Keep disconnected roads, but do not seed
// unreachable demand on them. Boundary lanes need only reach (or leave) the main component.
export function networkAccess(compiled: CompiledCity, laneChanges = true) {
  const out = compiled.lanes.map((): number[] => []);
  const incoming = compiled.lanes.map((): number[] => []);
  for (const m of compiled.movements) {
    if (m.neverGreen) continue;
    out[m.fromLane]!.push(m.toLane);
    incoming[m.toLane]!.push(m.fromLane);
  }
  for (const road of laneChanges ? compiled.roads : []) {
    const lanes = road.lanes.map((i) => compiled.lanes[i]!);
    if (lanes.some((l) => l.lengthM < (lanes.length - 1) * 30 + 10)) continue;
    for (const lane of lanes)
      for (const other of lanes) {
        if (lane.idx === other.idx) continue;
        out[lane.idx]!.push(other.idx);
        incoming[other.idx]!.push(lane.idx);
      }
  }
  const seen = new Set<number>(),
    order: number[] = [];
  for (const lane of compiled.lanes) {
    if (seen.has(lane.idx)) continue;
    const stack: [number, boolean][] = [[lane.idx, false]];
    while (stack.length) {
      const [id, finish] = stack.pop()!;
      if (finish) {
        order.push(id);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push([id, true]);
      for (const next of out[id]!) if (!seen.has(next)) stack.push([next, false]);
    }
  }
  seen.clear();
  let core: number[] = [];
  for (const id of order.reverse()) {
    if (seen.has(id)) continue;
    const group = [id];
    seen.add(id);
    for (const lane of group)
      for (const next of incoming[lane]!) {
        if (seen.has(next)) continue;
        seen.add(next);
        group.push(next);
      }
    if (group.length > core.length) core = group;
  }
  // A simple clipped corridor has no cycle and still has valid directional portals.
  if (new Set(core.map((i) => compiled.lanes[i]!.road)).size <= 1)
    core = compiled.lanes.map((lane) => lane.idx);
  const reach = (edges: number[][]) => {
    const result = new Set(core),
      queue = [...core];
    for (const lane of queue)
      for (const next of edges[lane]!) {
        if (result.has(next)) continue;
        result.add(next);
        queue.push(next);
      }
    return result;
  };
  return { core: new Set(core), fromCore: reach(out), toCore: reach(incoming) };
}

export function addPlace(
  city: City,
  kind: Place['kind'],
  name: string,
  shape: Place['shape'],
  provenance: Place['provenance'],
  demand = 0,
): Place {
  const id = allocateId(city, 'p');
  const place: Place = {
    id,
    kind,
    name,
    shape,
    population: demand,
    jobs: demand,
    attraction: 1,
    capacity: null,
    connectors: [],
    profile: null,
    events: [],
    provenance,
  };
  city.places[id] = place;
  return place;
}

export function addGateways(city: City, roads: OsmRoad[], compiled: CompiledCity): void {
  const access = networkAccess(compiled);
  const [west, south, east, north] = city.geo!.bbox;
  const nw = lonLatToLocal(city.geo!, { lon: west, lat: north });
  const se = lonLatToLocal(city.geo!, { lon: east, lat: south });
  const ends = roads.flatMap((source) => {
    const { road } = source;
    return (['start', 'end'] as const).flatMap((end) => {
      if (!(end === 'start' ? source.cutStart : source.cutEnd)) return [];
      const lanes = compiled.roads[compiled.index.road.get(road.id)!]!.lanes.map(
        (i) => compiled.lanes[i]!,
      );
      let candidates = lanes.filter((l) =>
        (end === 'start' ? access.toCore : access.fromCore).has(l.idx),
      );
      if (
        !candidates.length &&
        ['motorway', 'trunk', 'primary', 'secondary'].includes(road.roadClass)
      )
        candidates = lanes;
      if (!candidates.length) return [];
      const lane = city.drivingSide === 'right' ? candidates.at(-1)! : candidates[0]!;
      const node = city.nodes[end === 'start' ? road.from : road.to]!;
      const distances = [
        Math.abs(node.pos.x - nw.x),
        Math.abs(node.pos.x - se.x),
        Math.abs(node.pos.y - nw.y),
        Math.abs(node.pos.y - se.y),
      ];
      const edge = distances.indexOf(Math.min(...distances));
      return [{ source, end, lane, node, edge }];
    });
  });
  type End = (typeof ends)[number];
  const groups: End[][] = [];
  for (const end of ends) {
    const existing = groups.find((group) => group[0]!.node.id === end.node.id);
    if (existing) existing.push(end);
    else groups.push([end]);
  }
  const gap = (a: End[], b: End[]) =>
    Math.hypot(a[0]!.node.pos.x - b[0]!.node.pos.x, a[0]!.node.pos.y - b[0]!.node.pos.y);
  const has = (group: End[], direction: End['end']) => group.some((e) => e.end === direction);
  const complementary = (a: End[], b: End[]) =>
    (!has(a, 'start') && has(b, 'start')) || (!has(a, 'end') && has(b, 'end'));
  // First pair named carriageways; then pair nearby one-way streets serving the same edge.
  for (const named of [true, false]) {
    for (const group of groups) {
      if (!group.length || (has(group, 'start') && has(group, 'end'))) continue;
      const first = group[0]!;
      const candidates = groups
        .filter(
          (other) =>
            other !== group &&
            other.length &&
            complementary(group, other) &&
            first.edge === other[0]!.edge &&
            gap(group, other) <= (named ? 150 : 300) &&
            (!named ||
              (first.source.road.name !== null &&
                other[0]!.source.road.name === first.source.road.name &&
                other[0]!.source.road.roadClass === first.source.road.roadClass)),
        )
        .sort((a, b) => gap(group, a) - gap(group, b));
      if (candidates[0]) group.push(...candidates[0].splice(0));
    }
  }
  // A clipped link belongs to its nearby parent gateway, and contributes no extra demand.
  for (const group of groups) {
    if (!group.length || !group.every((e) => e.source.road.roadClass === 'ramp')) continue;
    const parent = groups
      .filter(
        (other) =>
          other !== group &&
          other.some((e) =>
            ['motorway', 'trunk', 'primary', 'secondary'].includes(e.source.road.roadClass),
          ) &&
          other[0]!.edge === group[0]!.edge &&
          gap(group, other) < 300,
      )
      .sort((a, b) => gap(group, a) - gap(group, b))[0];
    if (parent) parent.push(...group.splice(0));
  }
  for (const group of groups) {
    if (!group.length) continue;
    const place = addPlace(
      city,
      'gateway',
      'Gateway',
      { kind: 'point', pos: group[0]!.node.pos },
      {
        source: 'osm',
        osmIds: [...new Set(group.map((e) => e.source.wayId))],
        inferred: ['population', 'jobs', 'attraction', 'throughputPerMin', 'gatewayPairing'],
      },
    );
    const main = group.filter((e) => e.source.road.roadClass !== 'ramp');
    const demandEnds = main.length ? main : group;
    place.population = Math.max(
      0,
      ...demandEnds
        .filter((e) => e.end === 'start')
        .map((e) => gatewayDemand[e.source.road.roadClass] * e.source.road.lanes.length),
    );
    place.jobs = Math.max(
      0,
      ...demandEnds
        .filter((e) => e.end === 'end')
        .map((e) => gatewayDemand[e.source.road.roadClass] * e.source.road.lanes.length),
    );
    for (const { source, lane, end } of group) {
      const inset = Math.min(5, lane.lengthM / 2);
      place.connectors.push({
        id: allocateId(city, 'c'),
        roadId: source.road.id,
        lane: lane.lane,
        positionM: end === 'start' ? inset : lane.lengthM - inset,
        direction: end === 'start' ? 'out' : 'in',
        throughputPerMin: 30 * source.road.lanes.length,
      });
    }
  }
}

function placeKind(tag: OsmTags): Place['kind'] | undefined {
  if (tag.amenity === 'parking') return 'parking';
  if (tag.amenity === 'school') return 'school';
  if (tag.railway === 'station') return 'station';
  if (tag.aeroway === 'aerodrome') return 'airport';
  if (tag.shop === 'mall') return 'retail';
  return undefined;
}

export function polygonCenter(ring: Vec2[]): Vec2 | undefined {
  const origin = ring[0]!;
  let area = 0,
    x = 0,
    y = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    const a = ring[i]!,
      b = ring[i + 1]!;
    const ax = a.x - origin.x,
      ay = a.y - origin.y;
    const bx = b.x - origin.x,
      by = b.y - origin.y;
    const cross = ax * by - ay * bx;
    area += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  if (area !== 0) return { x: origin.x + x / (3 * area), y: origin.y + y / (3 * area) };
}

// Preserve the original layout and ID allocation while generating fixed roadside strips.
export function layoutConnector(city: City, compiled: CompiledCity, parking = false) {
  const { core } = networkAccess(compiled, false);
  const segments = compiled.lanes
    .filter((lane) => {
      if ((!parking && !core.has(lane.idx)) || !lane.allowed.includes('car')) return false;
      const road = city.roads[compiled.roads[lane.road]!.id]!;
      const access = road.access?.car ?? road.access?.all ?? 'yes';
      return !parking || (access !== 'no' && access !== 'delivery');
    })
    .flatMap((lane) =>
      lane.polyline.slice(1).map((b, i) => ({ lane, a: lane.polyline[i]!, b, i })),
    );
  function snap(index: number, point: Vec2) {
    const { lane, a, b, i } = segments[index]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    return {
      lane,
      positionM: lane.cumulative[i]! + t * (lane.cumulative[i + 1]! - lane.cumulative[i]!),
      distance: Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy),
    };
  }
  return (point: Vec2): Place['connectors'][number] => {
    let best = snap(0, point);
    for (let i = 1; i < segments.length; i++) {
      const candidate = snap(i, point);
      if (candidate.distance < best.distance) best = candidate;
    }
    const inset = Math.min(10, best.lane.lengthM / 2);
    return {
      id: allocateId(city, 'c'),
      roadId: compiled.roads[best.lane.road]!.id,
      lane: best.lane.lane,
      positionM: Math.max(inset, Math.min(best.lane.lengthM - inset, best.positionM)),
      direction: 'both',
      throughputPerMin: 30,
    };
  };
}

// Mapped facilities get a short inferred driveway, never an invented street connection.
export const PARKING_SNAP_LIMIT_M = 30;

export function placeConnector(
  city: City,
  compiled: CompiledCity,
  parking = false,
  departureOnly = false,
) {
  const access = parkingEgress(compiled, 30);
  const bays = compiled.lanes.map((): number[] => []);
  for (const space of compiled.parkingSpaces ?? [])
    if (compiled.parking[space.parking]!.kind === 'roadside')
      bays[space.lane]!.push(space.positionM);
  const candidates = compiled.lanes.flatMap((lane) => {
    // Lead (TASK-124 review): a new portal is a driveway on the curb lane of an at-grade
    // street, never in a tunnel, on a bridge, on a motorway, trunk or ramp, or on an inner lane.
    const road = compiled.roads[lane.road]!,
      source = city.roads[road.id]!;
    if (
      (source.layer ?? 0) !== 0 ||
      ['motorway', 'trunk', 'ramp'].includes(source.roadClass) ||
      lane.lane !== (city.drivingSide === 'left' ? 0 : road.lanes.length - 1)
    )
      return [];
    const inset = Math.min(10, lane.lengthM / 2);
    const last = Math.min(lane.lengthM - inset, access.latestDeparture(lane.idx));
    if (last < inset) return [];
    const first = departureOnly ? inset : Math.max(inset, access.earliestArrival(lane.idx));
    if (first > last) return [];
    let ranges: [number, number][] = [[first, last]];
    // New portals fit between existing bays; the strips and their slots do not move.
    for (const positionM of bays[lane.idx]!) {
      const lo = positionM - 3.000001,
        hi = positionM + 3.000001;
      ranges = ranges.flatMap(([a, b]) =>
        hi <= a || lo >= b
          ? [[a, b] as [number, number]]
          : [
              ...(lo >= a ? [[a, lo] as [number, number]] : []),
              ...(hi <= b ? [[hi, b] as [number, number]] : []),
            ],
      );
    }
    return ranges.map(([first, last]) => ({
      lane,
      first,
      line: [
        pointAtDistance(lane.polyline, lane.cumulative, first),
        ...lane.polyline.filter(
          (_, i) => lane.cumulative[i]! > first && lane.cumulative[i]! < last,
        ),
        pointAtDistance(lane.polyline, lane.cumulative, last),
      ],
    }));
  });
  return (
    point: Vec2,
    footprints: Vec2[][] = [],
    mappedEntrance = false,
    existingId?: string,
  ): Place['connectors'][number] | undefined => {
    // Keep allocation stable even when a mapped facility has no entry within the limit.
    const id = existingId ?? allocateId(city, 'c');
    const rings = footprints.map((ring) => [...ring, ring[0]!]);
    const extent = rings.length ? rings.flat() : [point];
    const minX = Math.min(...extent.map((p) => p.x)) - PARKING_SNAP_LIMIT_M;
    const maxX = Math.max(...extent.map((p) => p.x)) + PARKING_SNAP_LIMIT_M;
    const minY = Math.min(...extent.map((p) => p.y)) - PARKING_SNAP_LIMIT_M;
    const maxY = Math.max(...extent.map((p) => p.y)) + PARKING_SNAP_LIMIT_M;
    const distanceToFootprint = (p: Vec2) =>
      rings.length
        ? Math.min(
            ...rings.map((ring) => (pointInPolygon(p, ring) ? 0 : nearestOnPolyline(ring, p).away)),
          )
        : Math.hypot(p.x - point.x, p.y - point.y);
    let best:
      { lane: (typeof compiled.lanes)[number]; positionM: number; rank: number } | undefined;
    for (const { lane, first, line } of candidates) {
      if (
        parking &&
        (line.every((p) => p.x < minX) ||
          line.every((p) => p.x > maxX) ||
          line.every((p) => p.y < minY) ||
          line.every((p) => p.y > maxY))
      )
        continue;
      let hit = nearestOnPolyline(line, point);
      if (line[0]!.x === line.at(-1)!.x && line[0]!.y === line.at(-1)!.y && line.length === 2)
        hit = {
          ...hit,
          point: line[0]!,
          away: Math.hypot(line[0]!.x - point.x, line[0]!.y - point.y),
        };
      let distance = distanceToFootprint(hit.point);
      if (rings.length && !mappedEntrance) {
        const options = rings.flatMap((ring) => [
          ...ring.map((p) => nearestOnPolyline(line, p)),
          ...line.map((p) => ({ ...nearestOnPolyline(line, p), away: distanceToFootprint(p) })),
          ...polylineCrossings(line, ring).map((c) => ({
            ...nearestOnPolyline(line, c.point),
            away: 0,
          })),
        ]);
        for (const option of options) {
          const away = distanceToFootprint(option.point);
          if (
            away < distance ||
            (away === distance &&
              Math.hypot(option.point.x - point.x, option.point.y - point.y) <
                Math.hypot(hit.point.x - point.x, hit.point.y - point.y))
          ) {
            hit = option;
            distance = away;
          }
        }
      }
      if (parking && distance > PARKING_SNAP_LIMIT_M) continue;
      const rank = rings.length && !mappedEntrance ? distance : hit.away;
      if (!best || rank < best.rank) best = { lane, positionM: first + hit.along, rank };
    }
    return (
      best && {
        id,
        roadId: compiled.roads[best.lane.road]!.id,
        lane: best.lane.lane,
        positionM: best.positionM,
        direction: departureOnly ? 'out' : 'both',
        throughputPerMin: 30,
      }
    );
  };
}

/** Final import pass: keep the mapped vehicle/parking layout, repair only trapped portals. */
export function connectCarExits(
  city: City,
  compiled: CompiledCity,
  garageFootprints?: Map<string, Vec2[][]>,
  refreshLots = false,
): boolean {
  const exits = parkingEgress(compiled, 30);
  // Reuse the finished car graph and the parking compiler, without compiling the walk graph
  // or vehicle geometry again. Lots appended by mapped-strip fallback add no vehicle roads.
  const layout: CompiledCity = {
    ...compiled,
    lanes: compiled.lanes.map((lane) => ({ ...lane, connectors: [] })),
    connectors: [],
    parking: [],
    parkingSpaces: [],
    strips: [],
    index: { ...compiled.index, connector: new Map(), parking: new Map() },
  };
  compileVisibleParking(city, layout, (shape) =>
    shape.kind === 'point' ? shape.pos : (polygonCenter(shape.ring) ?? null),
  );
  const ordinary: ReturnType<typeof placeConnector>[] = [];
  const parking: ReturnType<typeof placeConnector>[] = [];
  let changed = false;
  const repair = (
    entry: Place['connectors'][number],
    entries: Place['connectors'],
    footprints: Vec2[][],
    mapped: boolean,
    anchor?: Vec2,
  ) => {
    if (entry.direction === 'in') return false;
    const road = compiled.roads[compiled.index.road.get(entry.roadId)!]!;
    const lane = compiled.lanes[road.lanes[entry.lane]!]!;
    if (entry.positionM <= exits.latestDeparture(lane.idx) + 1e-9) return false;
    const reachableArrival =
      entry.direction !== 'out' && entry.positionM + 1e-9 >= exits.earliestArrival(lane.idx);
    const departureOnly = reachableArrival || entry.direction === 'out';
    const point = anchor ?? pointAtDistance(lane.polyline, lane.cumulative, entry.positionM);
    const factories = mapped ? parking : ordinary;
    const snap = (factories[Number(departureOnly)] ??= placeConnector(
      city,
      layout,
      mapped,
      departureOnly,
    ));
    const candidate = snap(point, footprints, false, entry.id);
    if (!candidate) return false;
    if (reachableArrival) {
      entry.direction = 'in';
      entries.push({
        ...candidate,
        id: allocateId(city, 'c'),
        direction: 'out',
        throughputPerMin: entry.throughputPerMin,
      });
    } else {
      Object.assign(entry, candidate, {
        direction: entry.direction,
        throughputPerMin: entry.throughputPerMin,
      });
    }
    changed = true;
    return true;
  };
  for (const place of Object.values(city.places)) {
    if (refreshLots) break;
    if (place.kind === 'gateway') continue;
    const anchor =
      place.shape.kind === 'point' ? place.shape.pos : polygonCenter(place.shape.ring)!;
    for (const entry of [...place.connectors]) repair(entry, place.connectors, [], false, anchor);
  }
  for (const source of Object.values(city.parking ?? {})) {
    if (source.kind === 'roadside' || source.provenance.inferred?.includes('implicitGarage'))
      continue;
    const facilityIndex = layout.index.parking.get(source.id);
    const facility = facilityIndex === undefined ? undefined : layout.parking[facilityIndex];
    const footprints =
      garageFootprints?.get(source.id) ??
      (source.shape?.kind === 'polygon' ? [source.shape.ring] : []);
    const entries = source.connectors.length
      ? source.connectors
      : [...new Set([...(facility?.connectorsIn ?? []), ...(facility?.connectorsOut ?? [])])].map(
          (i) => {
            const c = layout.connectors[i]!,
              lane = layout.lanes[c.lane]!;
            return {
              id: c.id,
              roadId: compiled.roads[lane.road]!.id,
              lane: lane.lane,
              positionM: c.positionM,
              direction: c.direction,
              throughputPerMin: c.throughputPerMin,
            };
          },
        );
    let moved = false;
    const anchor = source.shape?.kind === 'point' ? source.shape.pos : undefined;
    for (const entry of [...entries])
      moved = repair(entry, entries, footprints, true, anchor) || moved;
    if (moved || (refreshLots && source.kind === 'lot')) {
      if (
        !source.connectors.length &&
        !source.provenance.inferred?.includes('materializedAisleEntries')
      )
        (source.provenance.inferred ??= []).push('materializedAisleEntries');
      source.connectors = entries.map((entry) =>
        /^c:\d+$/.test(entry.id) ? entry : { ...entry, id: allocateId(city, 'c') },
      );
    }
  }
  return changed;
}

export function addOsmPlaces(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
): void {
  const connector = layoutConnector(city, compiled);
  function add(id: number, tag: OsmTags, kind: Place['kind'], shape: Place['shape'], point: Vec2) {
    if (!contains(bounds, point)) return;
    const place = addPlace(city, kind, tag.name ?? kind, shape, {
      source: 'osm',
      osmIds: [id],
      inferred: ['population', 'jobs', 'attraction', 'throughputPerMin'],
    });
    place.connectors.push(connector(point));
  }

  for (const { id, tag } of data.node) {
    const kind = placeKind(tag);
    if (!kind || kind === 'parking') continue;
    const pos = positions.get(id)!;
    add(id, tag, kind, { kind: 'point', pos }, pos);
  }
  for (const { id, nd, tag } of data.way) {
    const kind = placeKind(tag);
    if (!kind) continue;
    const points = nd.map((ref) => positions.get(ref)).filter((pos) => pos !== undefined);
    if (points.length === 0 || points.length !== nd.length) continue;
    const ring = nd[0] === nd.at(-1) ? points.slice(0, -1) : [];
    const center = ring.length >= 3 ? polygonCenter(ring) : undefined;
    if (center) add(id, tag, kind, { kind: 'polygon', ring }, center);
    else if (kind !== 'parking') add(id, tag, kind, { kind: 'point', pos: points[0]! }, points[0]!);
  }
}
