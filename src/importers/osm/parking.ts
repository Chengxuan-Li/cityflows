import { pointInPolygon, segmentsIntersect } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity } from '../../network';
import { allocateId, type City, type ParkingFacility } from '../../schema';
import { clip, polygonSources } from './buildings';
import { contains, type Bounds } from './clip';
import type { OsmData, OsmTags } from './parse';
import { placeConnector, polygonCenter } from './places';

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

function touches(a: Vec2[], b: Vec2[]): boolean {
  return (
    a.some((p) => pointInPolygon(p, closed(b))) ||
    b.some((p) => pointInPolygon(p, closed(a))) ||
    a.some((p, i) =>
      b.some((q, j) => segmentsIntersect(p, a[(i + 1) % a.length]!, q, b[(j + 1) % b.length]!)),
    )
  );
}

export function addOsmGarages(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
): void {
  const hasEntry = compiled.lanes.some((lane) => {
    const road = city.roads[compiled.roads[lane.road]!.id]!;
    const access = road.access?.car ?? road.access?.all ?? 'yes';
    return lane.allowed.includes('car') && access !== 'no' && access !== 'delivery';
  });
  const connector = hasEntry ? placeConnector(city, compiled, true) : undefined;
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
    footprints = shape.kind === 'polygon' ? [shape.ring] : [],
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
      );
  }
  for (const node of data.node) {
    if (garage(node.tag))
      add(node.id, node.tag, { kind: 'point', pos: positions.get(node.id)! }, 25);
  }
}
