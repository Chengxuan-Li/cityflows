import { nearestOnPolyline, prepareRing } from '../../geo/polyline';
import Flatbush from 'flatbush';
import type { Vec2 } from '../../geo/vec2';
import { compile } from '../../network';
import { safeStripRuns } from '../../network/strips';
import { allocateId, type City, type ParkingLayout } from '../../schema';
import type { OsmData, OsmTags } from './parse';
import { polygonSources } from './buildings';

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
export function addStrips(city: City, data: OsmData, positions: Map<number, Vec2>): void {
  const result = compile(city);
  if (!result.ok) return;
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
      for (const run of safeStripRuns(
        city,
        result.compiled,
        road.id,
        side,
        tag.layout,
        exclusions,
      )) {
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
