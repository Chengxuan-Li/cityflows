import { areaD } from 'clipper2-ts';
import {
  nearestOnPolyline,
  pointInPolygon,
  polylineCrossings,
  prepareRing,
  ringsOverlap,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { compile, type CompiledCity, type Diagnostic } from '../../network';
import {
  allocateId,
  vehicleClasses,
  type City,
  type Node,
  type ParkingFacility,
} from '../../schema';
import { clip, polygonSources } from './buildings';
import { clipPart, type Bounds } from './clip';
import type { OsmData, OsmTags } from './parse';
import { createRoads, roadSpecs } from './roads';
import { junctions, splitWay } from './split';
import { joinLotAisles } from './lot-junctions';
import { connectCarExits } from './places';

export const surfaceLot = (tag: OsmTags) =>
  tag.amenity === 'parking' &&
  (tag.parking === 'surface' || (!tag.parking && (!tag.building || tag.building === 'no')));

/** Append after the public-road and place import so their IDs and inferred attributes stay stable. */
export function addLots(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  diagnostics: Diagnostic[],
  sources = polygonSources(data, surfaceLot),
  includeAisles = true,
  compiled?: CompiledCity,
) {
  const close = (ring: Vec2[]) => [...ring, ring[0]!];
  const shapes = sources.flatMap((source) => {
    const rings = source.rings.flatMap(({ role, ids }) => {
      const points = ids.slice(0, -1).map((id) => positions.get(id));
      if (!points.every((p): p is Vec2 => !!p)) return [];
      const ring = clip(points, bounds);
      return ring.length >= 3 && Math.abs(areaD(ring)) >= 4 ? [{ role, ring }] : [];
    });
    return rings
      .filter((r) => r.role === 'outer')
      .map(({ ring }) => ({
        ...source,
        ring,
        holes: rings
          .filter((r) => r.role === 'inner' && pointInPolygon(r.ring[0]!, close(ring)))
          .map((r) => r.ring),
      }));
  });
  if (!shapes.length) return;
  const buildings = polygonSources(data, (tag) => !!tag.building && tag.building !== 'no').flatMap(
    (source) =>
      source.rings
        .filter((r) => r.role === 'outer')
        .flatMap(({ ids }) => {
          const ring = ids.slice(0, -1).map((id) => positions.get(id));
          return ring.every((p): p is Vec2 => !!p) ? [ring] : [];
        }),
  );
  const lots = shapes.map(({ id: osmId, tag, ring, holes }) => {
    const id = allocateId(city, 'pk');
    const capacity = /^\d+$/.test(tag.capacity ?? '') ? Number(tag.capacity) : undefined;
    const boundary = close(ring),
      prepared = prepareRing(boundary);
    const touches = (other: Vec2[]) => {
      const otherBoundary = close(other),
        candidate = prepareRing(otherBoundary);
      const a = prepared.box,
        b = candidate.box;
      if (a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY) return false;
      return (
        ringsOverlap(prepared, candidate, 0) ||
        polylineCrossings(boundary, otherBoundary).length > 0
      );
    };
    const matches = Object.values(city.places).filter(
      (place) =>
        (tag.name && place.name.toLocaleLowerCase() === tag.name.toLocaleLowerCase()) ||
        (place.shape.kind === 'polygon' && touches(place.shape.ring)),
    );
    const parkingPlace = matches.find(
      (place) => place.kind === 'parking' && place.provenance.osmIds?.includes(osmId),
    );
    const lot: ParkingFacility = {
      id,
      kind: 'lot',
      name: tag.name ?? null,
      capacity: capacity ?? 0,
      access:
        tag.access === 'customers'
          ? 'customers'
          : tag.access === undefined || ['yes', 'permissive', 'designated'].includes(tag.access)
            ? 'public'
            : 'private',
      placeId: parkingPlace?.id ?? (matches.length === 1 ? matches[0]!.id : null),
      shape: { kind: 'polygon', ring },
      connectors: [],
      aisles: [],
      entries: [],
      exclusions: [...holes, ...buildings.filter(touches)],
      provenance: {
        source: 'osm',
        osmIds: [osmId],
        inferred: capacity === undefined ? ['capacity'] : [],
      },
    };
    (city.parking ??= {})[id] = lot;
    return lot;
  });
  const touchesLot = (line: Vec2[], lot: ParkingFacility) =>
    lot.shape?.kind === 'polygon' &&
    (line.some((p) =>
      pointInPolygon(p, lot.shape!.kind === 'polygon' ? close(lot.shape!.ring) : []),
    ) ||
      polylineCrossings(line, close(lot.shape.ring)).length > 0);
  const ways = data.way.filter(
    (way) =>
      includeAisles &&
      way.tag.highway === 'service' &&
      way.tag.service === 'parking_aisle' &&
      way.nd.every((id) => positions.has(id)) &&
      lots.some((lot) =>
        touchesLot(
          way.nd.map((id) => positions.get(id)!),
          lot,
        ),
      ),
  );
  const publicRoads = Object.values(city.roads);
  const publicNodes = new Set(Object.keys(city.nodes));
  const nodes = new Map<number, Node>();
  for (const node of Object.values(city.nodes))
    for (const osmId of node.provenance.osmIds ?? []) nodes.set(osmId, node);
  const splits = junctions(ways, [...nodes.keys()]);
  const getNode = (osmId: number, pos: Vec2) => {
    let node = nodes.get(osmId);
    if (node) return node;
    const id = allocateId(city, 'n');
    node = {
      id,
      pos,
      layer: 0,
      control: 'uncontrolled',
      minorRoads: [],
      turnRules: [],
      signal: null,
      provenance: { source: 'osm', osmIds: [osmId], inferred: [] },
    };
    nodes.set(osmId, node);
    city.nodes[id] = node;
    return node;
  };
  for (const way of ways) {
    let segment = 0;
    for (const ids of splitWay(
      way.nd.filter((id, i) => id !== way.nd[i - 1]),
      splits,
    )) {
      const points = ids.map((osmId) => ({
        key: String(osmId),
        osmId,
        pos: positions.get(osmId)!,
      }));
      for (const part of clipPart(points, bounds, `aisle/${way.id}/${segment}`, new Set())) {
        const owners = lots.filter((lot) =>
          touchesLot(
            part.points.map((p) => p.pos),
            lot,
          ),
        );
        if (!owners.length) continue;
        const first = part.points[0]!,
          last = part.points.at(-1)!;
        const from = getNode(first.osmId ?? -city.nextId, first.pos);
        const to = getNode(last.osmId ?? -city.nextId, last.pos);
        if (from.id === to.id) continue;
        // Consolidation may have moved a shared public node; the aisle follows that endpoint.
        part.points[0] = { ...first, pos: from.pos };
        part.points[part.points.length - 1] = { ...last, pos: to.pos };
        const specs = roadSpecs(way, 'service', diagnostics).map((spec) => {
          const access = { ...spec.access };
          if (!access.all || access.all === 'yes') access.all = 'destination';
          for (const kind of vehicleClasses)
            if (access[kind] === 'yes') access[kind] = 'destination';
          return {
            ...spec,
            access,
            speedLimitMps: 10 / 3.6,
            provenance: {
              ...spec.provenance,
              inferred: [
                ...spec.provenance.inferred.filter((k) => k !== 'speedLimitMps'),
                'lotAccess',
              ],
            },
          };
        });
        const roads = createRoads(city, way, 'service', specs, part, segment++, from.id, to.id);
        for (const lot of owners) lot.aisles!.push(...roads.map((r) => r.road.id));
      }
    }
  }
  const aisleIds = new Set(lots.flatMap((lot) => lot.aisles!));
  // A new mouth can consume a short road's existing connector. Keep that mapped access
  // disconnected and diagnose it rather than moving an unrelated place or its demand.
  const attached = compiled && !includeAisles ? { ok: true as const, compiled } : compile(city);
  if (!attached.ok) {
    const blocked = new Set(
      attached.diagnostics
        .filter((d) => d.code === 'connector_invalid')
        .flatMap((d) => d.refs)
        .filter((id) => city.roads[id])
        .flatMap((id) => {
          const road = city.roads[id]!;
          return [road.from, road.to].filter(
            (node) =>
              publicNodes.has(node) &&
              [...aisleIds].some(
                (id) => city.roads[id]!.from === node || city.roads[id]!.to === node,
              ),
          );
        }),
    );
    for (const old of blocked) {
      const id = allocateId(city, 'n');
      city.nodes[id] = {
        ...structuredClone(city.nodes[old]!),
        id,
        control: 'uncontrolled',
        minorRoads: [],
        turnRules: [],
        signal: null,
        provenance: { source: 'osm', inferred: ['unreachableLotEntry'] },
      };
      for (const aisle of aisleIds) {
        const road = city.roads[aisle]!;
        if (road.from === old) road.from = id;
        if (road.to === old) road.to = id;
      }
      diagnostics.push({
        severity: 'warning',
        code: 'parking_entry_unreachable',
        refs: [old, id],
        message: `Mapped lot entry at ${old} cannot fit without consuming an existing place connector; entry left unreachable`,
      });
    }
  }
  // Entry reachability propagates through the mapped aisle network, including one-way direction.
  const withAisles = attached.ok ? attached : compile(city);
  if (!withAisles.ok) return;
  for (const lot of lots) {
    const aisleNodes = new Set(
      lot.aisles!.flatMap((id) => [city.roads[id]!.from, city.roads[id]!.to]),
    );
    lot.entries = [...aisleNodes]
      .filter((id) =>
        publicRoads.some(
          (road) =>
            (road.from === id || road.to === id) &&
            !['no', 'private', 'delivery'].includes(road.access?.all ?? 'yes'),
        ),
      )
      .sort();
    const reachable = new Set(lot.entries);
    const traversed = new Set<string>();
    for (let changed = true; changed;) {
      changed = false;
      for (const id of aisleIds) {
        const road = city.roads[id]!;
        if (
          reachable.has(road.from) &&
          !['no', 'delivery'].includes(road.access?.car ?? road.access?.all ?? 'yes')
        ) {
          traversed.add(id);
          if (!reachable.has(road.to)) {
            reachable.add(road.to);
            changed = true;
          }
        }
      }
    }
    if (!lot.aisles!.some((id) => traversed.has(id))) {
      const ring = lot.shape!.kind === 'polygon' ? close(lot.shape!.ring) : [];
      const candidates = withAisles.compiled.lanes
        .flatMap((lane) => {
          const road = city.roads[withAisles.compiled.roads[lane.road]!.id]!;
          if (
            aisleIds.has(road.id) ||
            !lane.allowed.includes('car') ||
            ['no', 'delivery'].includes(road.access?.car ?? road.access?.all ?? 'yes')
          )
            return [];
          let best = ring
            .map((p) => nearestOnPolyline(lane.polyline, p))
            .sort((a, b) => a.away - b.away)[0];
          for (const p of lane.polyline) {
            const hit = nearestOnPolyline(ring, p);
            if (best && hit.away < best.away)
              best = { ...nearestOnPolyline(lane.polyline, p), away: hit.away };
            if (pointInPolygon(p, ring)) best = { ...nearestOnPolyline(lane.polyline, p), away: 0 };
          }
          const crossing = polylineCrossings(lane.polyline, ring)[0];
          if (crossing) best = { ...nearestOnPolyline(lane.polyline, crossing.point), away: 0 };
          if (!best || best.away > 30) return [];
          return [{ lane, road, hit: best }];
        })
        .sort((a, b) => a.hit.away - b.hit.away || a.lane.idx - b.lane.idx);
      const nearest = candidates[0];
      if (nearest) {
        lot.connectors.push({
          id: allocateId(city, 'c'),
          roadId: nearest.road.id,
          lane: nearest.lane.lane,
          positionM: Math.max(0, Math.min(nearest.lane.lengthM, nearest.hit.along)),
          direction: 'both',
          throughputPerMin: 30,
        });
        lot.provenance.inferred!.push('driveway');
      } else
        diagnostics.push({
          severity: 'warning',
          code: 'parking_unreachable',
          refs: [lot.id],
          message: `Lot ${lot.name ?? lot.id} has no reachable aisle or permitted road within 30 m`,
        });
    }
  }
  return withAisles.compiled;
}

/** Apply source-proven joins last, so parking access cannot renumber unrelated walk/rail data. */
export function restoreLotJunctions(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  diagnostics: Diagnostic[],
  compiled: CompiledCity,
): void {
  const lots = Object.values(city.parking ?? {}).filter((lot) => lot.kind === 'lot');
  const aisleIds = new Set(lots.flatMap((lot) => lot.aisles ?? []));
  const holes = new Map(
    polygonSources(data, surfaceLot).map((source) => [
      source.id,
      source.rings.flatMap(({ role, ids }) => {
        if (role !== 'inner') return [];
        const points = ids.slice(0, -1).map((id) => positions.get(id));
        if (!points.every((p): p is Vec2 => p !== undefined)) return [];
        const ring = clip(points, bounds);
        return ring.length >= 3 ? [ring] : [];
      }),
    ]),
  );
  const result = joinLotAisles(
    city,
    data,
    Object.values(city.roads).filter((r) => !aisleIds.has(r.id)),
    lots.flatMap((lot) =>
      (lot.aisles ?? []).map((id) => ({
        id,
        holes: holes.get(lot.provenance.osmIds?.[0] ?? -1) ?? [],
      })),
    ),
    diagnostics,
    compiled,
  );
  if (!result) return;
  const joined = new Set(result.nodes);
  const affected: ParkingFacility[] = [];
  const previous = new Map<string, ParkingFacility['connectors']>();
  for (const lot of lots) {
    const roads = (lot.aisles ?? [])
      .map((id) => city.roads[id]!)
      .filter((road) => joined.has(road.from) || joined.has(road.to));
    if (!roads.length) continue;
    affected.push(lot);
    previous.set(lot.id, lot.connectors);
    lot.entries = [
      ...new Set([
        ...(lot.entries ?? []),
        ...roads.flatMap((r) => [r.from, r.to].filter((id) => joined.has(id))),
      ]),
    ].sort();
    lot.connectors = [];
    lot.provenance.inferred = lot.provenance.inferred?.filter((value) => value !== 'driveway');
  }
  connectCarExits(city, result.compiled, undefined, new Set(affected.map((lot) => lot.id)));
  for (const lot of affected) {
    const retained = previous.get(lot.id)!;
    const used = new Set<string>();
    for (const connector of lot.connectors) {
      const old = retained.find(
        (c) =>
          !used.has(c.id) &&
          c.roadId === connector.roadId &&
          c.lane === connector.lane &&
          Math.abs(c.positionM - connector.positionM) < 1e-6,
      );
      if (!old) continue;
      connector.id = old.id;
      connector.direction = old.direction === connector.direction ? old.direction : 'both';
      connector.throughputPerMin = old.throughputPerMin;
      used.add(old.id);
    }
    lot.connectors.push(...retained.filter((c) => !used.has(c.id)));
  }
}
