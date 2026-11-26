import { nearestOnPolyline, pointInPolygon, segmentsIntersect } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { compile, type CompiledCity, type Diagnostic } from '../../network';
import { allocateId, type City, type Connector, type ParkingFacility } from '../../schema';
import { clip, polygonSources } from './buildings';
import { contains, type Bounds } from './clip';
import { drivableClass } from './filter';
import type { OsmData, OsmTags } from './parse';
import {
  connectCarExits,
  layoutConnector,
  parkingEntranceConnector,
  polygonCenter,
} from './places';

function garage(tag: OsmTags): boolean {
  return (
    ['parking', 'garage', 'garages'].includes(tag.building ?? '') ||
    (tag.amenity === 'parking' && ['underground', 'multi-storey'].includes(tag.parking ?? ''))
  );
}

const area = (ring: Vec2[]) =>
  Math.abs(
    ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      return sum + a.x * b.y - b.x * a.y;
    }, 0),
  ) / 2;
const closed = (ring: Vec2[]) => [...ring, ring[0]!];

const FACILITY_ENTRANCE_LIMIT_M = 8;
const garageTypes = ['underground', 'multi-storey', 'rooftop'];

export interface ParkingFootprint {
  rings: Vec2[][];
  holes: Vec2[][];
  parking?: string;
}

export interface ParkingEntrance {
  id: number;
  point: Vec2;
  layer?: number;
  direction: Connector['direction'];
  roads: Set<number>;
}

export type ParkingEntrances = Map<ParkingFacility, ParkingEntrance[]>;

function entranceDiagnostic(diagnostics: Diagnostic[], id: number, reason: string) {
  diagnostics.push({
    severity: 'info',
    code: 'osm_parking_entrance_unlinked',
    refs: [`node/${id}`],
    message: `Parking entrance ${id}: ${reason}`,
  });
}

const motorAccess = (tag: OsmTags) =>
  tag.motorcar ?? tag.motor_vehicle ?? tag.vehicle ?? tag.access;

function deniesCars(access: string | undefined) {
  return ['no', 'delivery', 'emergency', 'agricultural', 'forestry'].includes(access ?? '');
}

export function matchParkingEntrances(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  footprints: ReadonlyMap<string, ParkingFootprint>,
  diagnostics: Diagnostic[],
): ParkingEntrances {
  const links: ParkingEntrances = new Map();
  const nodes = data.node.filter((n) => n.tag.amenity === 'parking_entrance');
  if (!nodes.length) return links;
  const ways = new Map(nodes.map((node) => [node.id, [] as OsmData['way']]));
  for (const way of data.way)
    if (way.tag.highway === 'service' || drivableClass(way))
      for (const id of way.nd) ways.get(id)?.push(way);
  const facilities = [...footprints].map(([id, { rings, holes, parking }]) => ({
    facility: city.parking![id]!,
    edges: rings.map(closed),
    holes: holes.map(closed),
    area: rings.reduce((sum, ring) => sum + area(ring), 0),
    parking,
  }));
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    const { tag } = node;
    const access = motorAccess(tag);
    if (!contains(bounds, point)) {
      entranceDiagnostic(diagnostics, node.id, 'outside the import area');
      continue;
    }
    if (deniesCars(access) || ['staircase', 'emergency'].includes(tag.entrance ?? '')) {
      entranceDiagnostic(diagnostics, node.id, 'the node excludes ordinary cars');
      continue;
    }
    const matches = facilities.flatMap((candidate) => {
      const { facility, edges, holes, parking } = candidate;
      if (
        (tag.parking === 'surface' && facility.kind !== 'lot') ||
        (garageTypes.includes(tag.parking ?? '') &&
          (facility.kind !== 'garage' ||
            (garageTypes.includes(parking ?? '') && parking !== tag.parking)))
      )
        return [];
      const shape = facility.shape!;
      const insideHoles = holes.filter((ring) => pointInPolygon(point, ring));
      const distance =
        shape.kind === 'point'
          ? Math.hypot(shape.pos.x - point.x, shape.pos.y - point.y)
          : !insideHoles.length && edges.some((ring) => pointInPolygon(point, ring))
            ? 0
            : Math.min(
                ...(insideHoles.length ? insideHoles : edges).map(
                  (ring) => nearestOnPolyline(ring, point).away,
                ),
              );
      return distance <= FACILITY_ENTRANCE_LIMIT_M
        ? [{ ...candidate, distance, exactType: !!tag.parking && tag.parking === parking }]
        : [];
    });
    matches.sort(
      (a, b) =>
        a.distance - b.distance ||
        Number(b.exactType) - Number(a.exactType) ||
        a.area - b.area ||
        a.facility.id.localeCompare(b.facility.id),
    );
    const match = matches[0];
    if (!match) {
      entranceDiagnostic(diagnostics, node.id, 'no compatible facility within 8 m');
      continue;
    }
    const { facility, edges, holes } = match;
    // The canonical connector has no access restriction of its own.
    if (
      (['private', 'permit', 'residents'].includes(access ?? '') &&
        facility.access !== 'private') ||
      (access === 'customers' && facility.access === 'public')
    ) {
      entranceDiagnostic(diagnostics, node.id, 'the node has stricter access than the facility');
      continue;
    }
    const attached = ways.get(node.id)!;
    const roads = attached.filter((road) => !deniesCars(motorAccess(road.tag)));
    if (attached.length && !roads.length) {
      entranceDiagnostic(diagnostics, node.id, 'the mapped approach excludes ordinary cars');
      continue;
    }
    const directions = new Set<'in' | 'out'>();
    for (const road of roads) {
      if (road.tag.highway !== 'service') continue;
      const oneWay =
        road.tag['oneway:motorcar'] ?? road.tag['oneway:motor_vehicle'] ?? road.tag.oneway;
      const first = road.nd[0] === node.id,
        last = road.nd.at(-1) === node.id;
      if (first === last) continue;
      if (['-1', 'yes', '1', 'true'].includes(oneWay ?? '')) {
        const adjacent = positions.get(road.nd[first ? 1 : road.nd.length - 2]!);
        const inward =
          !!adjacent &&
          edges.some((ring) => pointInPolygon(adjacent, ring)) &&
          !holes.some((ring) => pointInPolygon(adjacent, ring));
        const leavesNode = oneWay === '-1' ? last : first;
        directions.add(leavesNode === inward ? 'in' : 'out');
      } else {
        directions.add('in');
        directions.add('out');
      }
    }
    const direction =
      tag.entrance === 'exit' || (tag.exit === 'yes' && (!tag.entrance || tag.entrance === 'no'))
        ? 'out'
        : tag.exit === 'no' || ['entry', 'entrance', 'entry_only'].includes(tag.entrance ?? '')
          ? 'in'
          : directions.size === 1
            ? [...directions][0]!
            : 'both';
    const entrance: ParkingEntrance = {
      id: node.id,
      point,
      layer: tag.layer === undefined ? undefined : Number(tag.layer),
      direction,
      roads: new Set(roads.map((road) => road.id)),
    };
    const previous = links.get(facility);
    if (previous) previous.push(entrance);
    else links.set(facility, [entrance]);
  }
  return links;
}

export function addParkingEntranceConnectors(
  city: City,
  geometry: CompiledCity,
  links: ParkingEntrances,
  diagnostics: Diagnostic[],
) {
  if (!links.size) return;
  const snap = parkingEntranceConnector(city, geometry);
  for (const [facility, entrances] of links) {
    const mapped = entrances.flatMap((entrance) => {
      if (city.parking?.[facility.id] !== facility) {
        entranceDiagnostic(diagnostics, entrance.id, 'the lot has no usable entry and exit');
        return [];
      }
      const connector = snap(entrance);
      if (!connector) {
        entranceDiagnostic(diagnostics, entrance.id, 'no reachable car lane near the node');
        return [];
      }
      return [{ entrance, connector }];
    });
    if (!mapped.length) continue;
    // Source-proven aisle mouths still serve the aisle network. An inferred driveway or
    // garage centroid only supplied access until a node could locate the portal.
    const keep = facility.kind === 'lot' && !facility.provenance.inferred?.includes('driveway');
    if (keep && !facility.connectors.length && facility.entries?.length)
      connectCarExits(city, geometry, undefined, new Set([facility.id]));
    const previous = keep ? [] : facility.connectors;
    const missing = (['in', 'out'] as const).find((direction) =>
      mapped.every(
        ({ connector }) => connector.direction !== 'both' && connector.direction !== direction,
      ),
    );
    const complement = missing
      ? previous.flatMap((entry) =>
          entry.direction === missing || entry.direction === 'both'
            ? [{ ...entry, direction: missing }]
            : [],
        )
      : [];
    const reusable = previous.filter((entry) => !complement.some((saved) => saved.id === entry.id));
    if (!keep) facility.connectors = [];
    if (!complement.length)
      facility.provenance.inferred = facility.provenance.inferred?.filter(
        (key) => key !== 'connectedLane' && key !== 'driveway',
      );
    for (const [index, { entrance, connector }] of mapped.entries()) {
      const existing = facility.connectors.find(
        (entry) =>
          entry.roadId === connector.roadId &&
          entry.lane === connector.lane &&
          Math.abs(entry.positionM - connector.positionM) < 1e-6 &&
          (entry.direction === 'both' || entry.direction === connector.direction),
      );
      const id = existing?.id ?? reusable[index]?.id ?? allocateId(city, 'c');
      if (!existing) facility.connectors.push({ ...connector, id });
      diagnostics.push({
        severity: 'info',
        code: 'osm_parking_entrance_linked',
        refs: [`node/${entrance.id}`, facility.id, id],
        message: `Parking entrance ${entrance.id} serves ${facility.name ?? facility.id}`,
      });
    }
    facility.connectors.push(...complement);
  }
}

function touches(a: Vec2[], b: Vec2[]): boolean {
  return (
    a.some((p) => pointInPolygon(p, closed(b))) ||
    b.some((p) => pointInPolygon(p, closed(a))) ||
    a.some((p, i) =>
      b.some((q, j) => segmentsIntersect(p, a[(i + 1) % a.length]!, q, b[(j + 1) % b.length]!)),
    )
  );
}

/** TASK-267: the final compile. A parking facility it rejects (`parking_invalid`) is dropped and
 * reported by id and OSM id, and the city compiled again, so that one facility the importer could
 * not place never fails the import. Other errors still fail it. */
export function compileDroppingParking(city: City, diagnostics: Diagnostic[]) {
  const result = compile(city);
  if (result.ok) return result;
  const rejected = new Map<string, string[]>();
  for (const d of result.diagnostics)
    if (d.severity === 'error' && d.code === 'parking_invalid' && city.parking?.[d.refs[0]!])
      rejected.set(d.refs[0]!, [...(rejected.get(d.refs[0]!) ?? []), d.message]);
  if (!rejected.size) return result;
  for (const [id, reasons] of rejected) {
    const facility = city.parking![id]!;
    const osm = facility.provenance.osmIds ?? [];
    diagnostics.push({
      severity: 'warning',
      code: 'parking_dropped',
      refs: [id],
      message: `Dropped ${facility.kind} ${id}${osm.length ? ` (OSM ${osm.join(', ')})` : ''}: ${reasons.join('; ')}`,
    });
    delete city.parking![id];
  }
  return compile(city);
}

export function addOsmGarages(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
) {
  const footprintsByFacility = new Map<string, ParkingFootprint>();
  const hasEntry = compiled.lanes.some((lane) => {
    const road = city.roads[compiled.roads[lane.road]!.id]!;
    const access = road.access?.car ?? road.access?.all ?? 'yes';
    return lane.allowed.includes('car') && access !== 'no' && access !== 'delivery';
  });
  const connector = hasEntry ? layoutConnector(city, compiled, true) : undefined;
  const shapes = polygonSources(data, () => true).flatMap(({ id, rings }) =>
    rings
      .filter((r) => r.role === 'outer')
      .flatMap(({ ids }) => {
        const ring = ids.slice(0, -1).map((id) => positions.get(id));
        return ring.every((p): p is Vec2 => p !== undefined) ? [{ id, ring }] : [];
      }),
  );
  const owners = Object.values(city.places)
    .filter((p) => p.kind !== 'gateway' && p.kind !== 'parking')
    .flatMap((place) => {
      const footprints = shapes.filter((shape) => place.provenance.osmIds?.includes(shape.id));
      const rings = footprints.length
        ? footprints.map((p) => p.ring)
        : place.shape.kind === 'polygon'
          ? [place.shape.ring]
          : [];
      return rings.map((ring) => ({ place, ring, area: area(ring) }));
    })
    .sort((a, b) => a.area - b.area || a.place.id.localeCompare(b.place.id));
  const entrances = data.node.filter((node) => node.tag.entrance === 'garage');

  function add(
    id: number,
    tag: OsmTags,
    shape: NonNullable<ParkingFacility['shape']>,
    floorArea: number,
    footprints: Vec2[][] = [],
    holes: Vec2[][] = [],
  ) {
    const point = shape.kind === 'point' ? shape.pos : polygonCenter(shape.ring);
    if (!point || !contains(bounds, point)) return;
    const inferred: string[] = [];
    const taggedCapacity = tag.capacity?.trim();
    let capacity = taggedCapacity && /^\d+$/.test(taggedCapacity) ? Number(taggedCapacity) : NaN;
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      const levelTag = tag['parking:levels'] === undefined ? 'building:levels' : 'parking:levels';
      const levels = Number(tag[levelTag]);
      const count = Number.isFinite(levels) && levels > 0 ? Math.min(20, levels) : 1;
      if (count !== levels) inferred.push(levelTag);
      capacity = Math.max(1, Math.min(10000, Math.round((floorArea * count) / 25)));
      inferred.push('capacity');
    }
    const access =
      tag.access === 'customers'
        ? 'customers'
        : ['yes', 'permissive', 'designated'].includes(tag.access ?? '')
          ? 'public'
          : tag.access === undefined && tag.amenity === 'parking'
            ? 'public'
            : 'private';
    const owner = owners.find(({ ring }) =>
      footprints.length
        ? footprints.some((footprint) => touches(footprint, ring))
        : pointInPolygon(point, closed(ring)),
    )?.place;
    const parkingPlace = Object.values(city.places).find(
      (p) => p.kind === 'parking' && p.provenance.osmIds?.includes(id),
    );
    const entryPoints = footprints.length
      ? entrances
          .filter((node) =>
            footprints.some((ring) => pointInPolygon(positions.get(node.id)!, closed(ring))),
          )
          .map((n) => positions.get(n.id)!)
      : [];
    if (!entryPoints.length) {
      entryPoints.push(point);
      inferred.push('connectedLane');
    }
    const facilityId = allocateId(city, 'pk');
    const facility: ParkingFacility = {
      id: facilityId,
      kind: 'garage',
      name: tag.name ?? null,
      capacity,
      access,
      placeId: (parkingPlace ?? owner)?.id ?? null,
      connectors: connector ? entryPoints.map(connector) : [],
      shape,
      provenance: { source: 'osm', osmIds: [id], inferred },
    };
    (city.parking ??= {})[facilityId] = facility;
    footprintsByFacility.set(facilityId, { rings: footprints, holes, parking: tag.parking });
  }

  for (const source of polygonSources(data, garage)) {
    const rings = source.rings.flatMap(({ role, ids }) => {
      const projected = ids.slice(0, -1).map((id) => positions.get(id));
      if (!projected.every((p): p is Vec2 => p !== undefined)) return [];
      const ring = clip(projected, bounds);
      return ring.length >= 3 && area(ring) > 1 ? [{ role, ring }] : [];
    });
    const outers = rings
      .filter((r) => r.role === 'outer')
      .sort((a, b) => area(b.ring) - area(a.ring));
    const holes = rings.filter(
      (r) =>
        r.role === 'inner' &&
        outers.some((outer) => pointInPolygon(r.ring[0]!, closed(outer.ring))),
    );
    const floorArea =
      outers.reduce((sum, outer) => sum + area(outer.ring), 0) -
      holes.reduce((sum, hole) => sum + area(hole.ring), 0);
    if (outers.length && floorArea > 1)
      add(
        source.id,
        source.tag,
        { kind: 'polygon', ring: outers[0]!.ring },
        floorArea,
        outers.map((r) => r.ring),
        holes.map((r) => r.ring),
      );
  }
  for (const node of data.node) {
    if (garage(node.tag))
      add(node.id, node.tag, { kind: 'point', pos: positions.get(node.id)! }, 25);
  }
  return footprintsByFacility;
}
