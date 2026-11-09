import {
  nearestOnPolyline,
  offsetPolyline,
  pointInPolygon,
  polylineCrossings,
  prepareRing,
} from '../../geo/polyline';
import Flatbush from 'flatbush';
import type { Vec2 } from '../../geo/vec2';
import { compile, type CompiledCity, type Diagnostic } from '../../network';
import { curbLane, safeStripRuns, stripPitch } from '../../network/strips';
import { allocateId, type City, type ParkingLayout } from '../../schema';
import type { OsmData, OsmTags } from './parse';
import { clip, polygonSources } from './buildings';
import type { Bounds } from './clip';
import { addLots } from './lots';
import { polygonCenter } from './places';

const streetSide = (tag: OsmTags) =>
  tag.amenity === 'parking' &&
  ['street_side', 'lane', 'layby', 'on_kerb', 'half_on_kerb'].includes(tag.parking ?? '');

function areaRoads(city: City, compiled: CompiledCity) {
  const curbs = compiled.roads.flatMap((r) => {
    const road = city.roads[r.id]!;
    return (['left', 'right'] as const).flatMap((side) => {
      const lane = curbLane(city, compiled, road.id, side);
      if (!lane) return [];
      const line = offsetPolyline(lane.polyline, ((side === 'left' ? -1 : 1) * lane.widthM) / 2);
      return [{ road, lane, side, line }];
    });
  });
  const index = new Flatbush(Math.max(1, curbs.length));
  for (const { line } of curbs) {
    const { box } = prepareRing(line);
    index.add(box.minX, box.minY, box.maxX, box.maxY);
  }
  if (!curbs.length) index.add(0, 0, 0, 0);
  index.finish();
  return (ring: Vec2[]) => {
    const center = polygonCenter(ring)!;
    const box = prepareRing(ring).box;
    return index
      .search(box.minX - 15, box.minY - 15, box.maxX + 15, box.maxY + 15)
      .flatMap((i) => {
        const curb = curbs[i];
        if (!curb) return [];
        const { road, lane, side, line } = curb;
        const hit = nearestOnPolyline(lane.polyline, center),
          sign = side === 'left' ? -1 : 1;
        const normal = { x: -hit.direction.y, y: hit.direction.x };
        const offset = (p: Vec2) => (p.x - hit.point.x) * normal.x + (p.y - hit.point.y) * normal.y;
        if (sign * offset(center) < lane.widthM / 2) return [];
        const boundary = [...ring, ring[0]!];
        const away =
          line.some((p) => pointInPolygon(p, boundary)) || polylineCrossings(line, boundary).length
            ? 0
            : Math.min(
                ...ring.map((p) => nearestOnPolyline(line, p).away),
                ...line.map((p) => nearestOnPolyline(boundary, p).away),
              );
        if (away > 15) return [];
        const stations = ring.map((p) => nearestOnPolyline(road.centerline, p).along);
        const fromM = Math.min(...stations),
          toM = Math.max(...stations);
        const offsets = ring.map(offset),
          depth = Math.max(...offsets) - Math.min(...offsets);
        if (toM - fromM < 2.5 || toM - fromM < depth * 0.9) return [];
        return [{ road, side, fromM, toM, depth, away }];
      })
      .sort((a, b) => a.away - b.away || a.road.id.localeCompare(b.road.id))[0];
  };
}

function addMappedAreas(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
) {
  const sources = polygonSources(data, streetSide);
  const matchRoad = areaRoads(city, compiled);
  const fallback: typeof sources = [];
  for (const source of sources) {
    let imported = false;
    for (const { role, ids } of source.rings) {
      if (role !== 'outer') continue;
      const points = ids.slice(0, -1).map((id) => positions.get(id));
      if (!points.every((p): p is Vec2 => !!p)) continue;
      const ring = clip(points, bounds);
      if (ring.length < 3 || !polygonCenter(ring)) continue;
      imported = true;
      const match = matchRoad(ring);
      if (!match) {
        fallback.push({
          ...source,
          rings: [{ role, ids }, ...source.rings.filter((r) => r.role === 'inner')],
        });
        continue;
      }
      const { road, side, fromM, toM, depth } = match;
      const orientation = source.tag.orientation ?? source.tag['parking:orientation'];
      const layout: ParkingLayout =
        orientation === 'parallel'
          ? 'parallel'
          : orientation === 'diagonal'
            ? 'angled'
            : orientation === 'perpendicular'
              ? 'perpendicular'
              : depth <= 3
                ? 'parallel'
                : depth <= 5.5
                  ? 'angled'
                  : 'perpendicular';
      const tagged = /^\d+$/.test(source.tag.capacity ?? '')
        ? Number(source.tag.capacity)
        : undefined;
      const id = allocateId(city, 'pk');
      const access =
        source.tag.access === 'private'
          ? 'private'
          : source.tag.access === 'customers'
            ? 'customers'
            : 'public';
      const center = polygonCenter(ring)!;
      const owner =
        access === 'public'
          ? undefined
          : Object.values(city.places)
              .filter(
                (p) =>
                  p.kind !== 'parking' &&
                  p.kind !== 'gateway' &&
                  (access !== 'customers' || p.kind !== 'residential'),
              )
              .map((place) => {
                const pos =
                  place.shape.kind === 'point' ? place.shape.pos : polygonCenter(place.shape.ring)!;
                return {
                  place,
                  distance: Math.hypot(pos.x - center.x, pos.y - center.y),
                  contains:
                    place.shape.kind === 'polygon' &&
                    pointInPolygon(center, [...place.shape.ring, place.shape.ring[0]!]),
                  named:
                    !!source.tag.name && place.name.toLowerCase() === source.tag.name.toLowerCase(),
                };
              })
              .filter((p) => p.distance <= 200)
              .sort(
                (a, b) =>
                  Number(b.named) - Number(a.named) ||
                  Number(b.contains) - Number(a.contains) ||
                  a.distance - b.distance ||
                  a.place.id.localeCompare(b.place.id),
              )[0]?.place;
      (city.parking ??= {})[id] = {
        id,
        kind: 'roadside',
        name: source.tag.name ?? road.name,
        capacity: tagged ?? Math.floor((toM - fromM + 1e-8) / stripPitch(layout)),
        access,
        placeId: owner?.id ?? null,
        connectors: [],
        shape: null,
        strip: { roadId: road.id, side, fromM, toM, layout, ring },
        provenance: {
          source: 'osm',
          osmIds: [source.id],
          inferred: [
            ...(owner ? ['placeId'] : []),
            ...(tagged === undefined ? ['capacity'] : []),
            ...(['parallel', 'diagonal', 'perpendicular'].includes(orientation ?? '')
              ? []
              : ['layout']),
          ],
        },
      };
    }
    if (!imported)
      diagnostics.push({
        severity: 'warning',
        code: 'parking_area_skipped',
        refs: [String(source.id)],
        message: `Street-side area ${source.id} has no complete nondegenerate ring inside the import bounds`,
      });
  }
  if (fallback.length) {
    addLots(city, data, positions, bounds, diagnostics, fallback, false, compiled);
    for (const p of Object.values(city.parking ?? {}))
      if (p.kind === 'lot' && fallback.some((s) => p.provenance.osmIds?.includes(s.id)))
        p.provenance.inferred!.push('streetSideLot');
  }
}

function parkingSide(tags: OsmTags, side: 'left' | 'right') {
  const raw = tags[`parking:${side}`] ?? tags['parking:both'];
  const old = tags[`parking:lane:${side}`] ?? tags['parking:lane:both'];
  const orientation =
    tags[`parking:${side}:orientation`] ?? tags['parking:both:orientation'] ?? old;
  const layout: ParkingLayout =
    orientation === 'diagonal'
      ? 'angled'
      : orientation === 'perpendicular'
        ? 'perpendicular'
        : 'parallel';
  const disabled = ['no', 'no_parking', 'no_stopping', 'separate'];
  const mapped = raw !== undefined || old !== undefined;
  const enabled =
    raw !== undefined
      ? !disabled.includes(raw) &&
        ['lane', 'street_side', 'on_kerb', 'half_on_kerb', 'shoulder'].includes(raw)
      : old !== undefined && ['parallel', 'diagonal', 'perpendicular'].includes(old);
  const access =
    tags[`parking:${side}:access`] ??
    tags['parking:both:access'] ??
    tags[`parking:${side}:restriction`] ??
    tags['parking:both:restriction'];
  return {
    mapped,
    enabled,
    layout,
    access: access === 'private' ? ('private' as const) : ('public' as const),
  };
}

/** Materialize inferences only during import, after every place/lot entry and crossing exists. */
export function addStrips(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  diagnostics: Diagnostic[],
): void {
  // Preserve legacy ID allocations while removing obsolete places before deriving safe runs.
  const areaIds = new Set([
    ...polygonSources(data, streetSide).map((s) => s.id),
    ...data.way.filter((w) => streetSide(w.tag)).map((w) => w.id),
  ]);
  for (const p of Object.values(city.places))
    if (p.kind === 'parking' && p.provenance.osmIds?.some((id) => areaIds.has(id)))
      delete city.places[p.id];
  const result = compile(city);
  if (!result.ok) return;
  addMappedAreas(city, data, positions, bounds, result.compiled, diagnostics);
  const ways = new Map(data.way.map((way) => [way.id, way]));
  const buildings = polygonSources(data, (t) => !!t.building && t.building !== 'no').flatMap(
    (source) =>
      source.rings
        .filter((r) => r.role === 'outer')
        .flatMap(({ ids }) => {
          const ring = ids.slice(0, -1).map((id) => positions.get(id));
          return ring.length >= 3 && ring.every((p): p is Vec2 => !!p) ? [prepareRing(ring)] : [];
        }),
  );
  const buildingIndex = new Flatbush(Math.max(1, buildings.length));
  for (const { box } of buildings) buildingIndex.add(box.minX, box.minY, box.maxX, box.maxY);
  if (!buildings.length) buildingIndex.add(0, 0, 0, 0);
  buildingIndex.finish();
  for (const road of Object.values(city.roads).sort((a, b) => a.id.localeCompare(b.id))) {
    const way = road.provenance.osmIds?.map((id) => ways.get(id)).find(Boolean);
    if (!way) continue;
    const line = way.nd.map((id) => positions.get(id)).filter((p): p is Vec2 => !!p);
    if (line.length < 2) continue;
    const backward =
      nearestOnPolyline(line, road.centerline[0]!).along >
      nearestOnPolyline(line, road.centerline.at(-1)!).along;
    const inferred =
      ['residential', 'unclassified'].includes(way.tag.highway ?? '') &&
      !['yes', '1', 'true'].includes(way.tag.bridge ?? '') &&
      (!way.tag.bridge || way.tag.bridge === 'no') &&
      (!way.tag.tunnel || way.tag.tunnel === 'no') &&
      way.tag.covered !== 'yes' &&
      !way.tag.highway?.endsWith('_link');
    for (const side of ['left', 'right'] as const) {
      const originalSide = backward ? (side === 'left' ? 'right' : 'left') : side;
      const tag = parkingSide(way.tag, originalSide);
      const paired =
        road.streetGroupId !== null &&
        Object.values(city.roads).some(
          (other) =>
            other.id !== road.id &&
            other.streetGroupId === road.streetGroupId &&
            other.from === road.to &&
            other.to === road.from,
        );
      const inferSide = paired || side === 'right';
      if (tag.mapped ? !tag.enabled : !(inferred && inferSide)) continue;
      const padding =
        Math.abs(road.lateralOffsetM) + road.lanes.reduce((n, l) => n + l.widthM, 0) + 6;
      const xs = road.centerline.map((p) => p.x),
        ys = road.centerline.map((p) => p.y);
      const exclusions = buildingIndex
        .search(
          Math.min(...xs) - padding,
          Math.min(...ys) - padding,
          Math.max(...xs) + padding,
          Math.max(...ys) + padding,
        )
        .flatMap((i) => (buildings[i] ? [buildings[i]!.ring] : []));
      const runs = safeStripRuns(city, result.compiled, road.id, side, tag.layout, exclusions);
      const covered = Object.values(city.parking ?? {})
        .flatMap((p) =>
          p.strip?.ring && p.strip.roadId === road.id && p.strip.side === side
            ? [[p.strip.fromM, p.strip.toM] as const]
            : [],
        )
        .sort((a, b) => a[0] - b[0]);
      for (const [from, to] of covered) {
        for (let i = runs.length - 1; i >= 0; i--) {
          const run = runs[i]!;
          if (to <= run.fromM || from >= run.toM) continue;
          const fragments = [
            [run.fromM, from],
            [to, run.toM],
          ].flatMap(([a, b]) => {
            const fromM = Math.max(run.fromM, a!),
              toM = Math.min(run.toM, b!);
            const capacity = Math.floor((toM - fromM + 1e-8) / stripPitch(tag.layout));
            return capacity > 0 ? [{ fromM, toM, capacity }] : [];
          });
          runs.splice(i, 1, ...fragments);
          diagnostics.push({
            severity: 'warning',
            code: tag.mapped ? 'parking_strip_covered' : 'parking_inferred_strip_covered',
            refs: [road.id],
            message: `Mapped area replaces ${Math.max(from, run.fromM).toFixed(1)}–${Math.min(to, run.toM).toFixed(1)} m of ${side} roadside parking`,
          });
        }
      }
      for (const run of runs) {
        const id = allocateId(city, 'pk');
        (city.parking ??= {})[id] = {
          id,
          kind: 'roadside',
          name: road.name,
          capacity: run.capacity,
          access: tag.access,
          placeId: null,
          connectors: [],
          shape: null,
          ...(exclusions.length ? { exclusions } : {}),
          strip: { roadId: road.id, side, fromM: run.fromM, toM: run.toM, layout: tag.layout },
          provenance: { source: 'osm', osmIds: [way.id], inferred: tag.mapped ? [] : ['strip'] },
        };
      }
    }
  }
}
