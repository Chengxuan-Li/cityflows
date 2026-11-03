import type { Vec2 } from '../../geo/vec2';
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

function addPlace(
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
  const gateways = new Map<string, Place>();
  for (const { road, wayId, cutStart, cutEnd } of roads) {
    if (!cutStart && !cutEnd) continue;
    const lanes = compiled.roads[compiled.index.road.get(road.id)!]!.lanes;
    const lane = compiled.lanes[lanes[city.drivingSide === 'right' ? lanes.length - 1 : 0]!]!;
    const inset = Math.min(5, lane.lengthM / 2);
    for (const end of ['start', 'end'] as const) {
      if (!(end === 'start' ? cutStart : cutEnd)) continue;
      const nodeId = end === 'start' ? road.from : road.to;
      const demand = gatewayDemand[road.roadClass];
      let place = gateways.get(nodeId);
      if (!place) {
        place = addPlace(
          city,
          'gateway',
          'Gateway',
          { kind: 'point', pos: city.nodes[nodeId]!.pos },
          {
            source: 'osm',
            osmIds: [],
            inferred: ['population', 'jobs', 'attraction', 'throughputPerMin'],
          },
          demand,
        );
        gateways.set(nodeId, place);
      }
      if (!place.provenance.osmIds!.includes(wayId)) place.provenance.osmIds!.push(wayId);
      place.population = place.jobs = Math.max(place.population, demand);
      place.connectors.push({
        id: allocateId(city, 'c'),
        roadId: road.id,
        lane: lane.lane,
        positionM: end === 'start' ? inset : lane.lengthM - inset,
        direction: end === 'start' ? 'out' : 'in',
        throughputPerMin: 30,
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

function polygonCenter(ring: Vec2[]): Vec2 | undefined {
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

export function addOsmPlaces(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
): void {
  const segments = compiled.lanes.flatMap((lane) =>
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
  function add(id: number, tag: OsmTags, kind: Place['kind'], shape: Place['shape'], point: Vec2) {
    if (!contains(bounds, point)) return;
    const place = addPlace(city, kind, tag.name ?? kind, shape, {
      source: 'osm',
      osmIds: [id],
      inferred: ['population', 'jobs', 'attraction', 'throughputPerMin'],
    });
    const index = compiled.laneSpatial;
    let best = snap(index.neighbors(point.x, point.y, 1)[0]!, point);
    // The closest bounding box may enclose a distant diagonal segment.
    const d = best.distance;
    for (const candidate of index.search(point.x - d, point.y - d, point.x + d, point.y + d)) {
      const next = snap(candidate, point);
      if (next.distance < best.distance) best = next;
    }
    place.connectors.push({
      id: allocateId(city, 'c'),
      roadId: compiled.roads[best.lane.road]!.id,
      lane: best.lane.lane,
      positionM: best.positionM,
      direction: 'both',
      throughputPerMin: 30,
    });
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
