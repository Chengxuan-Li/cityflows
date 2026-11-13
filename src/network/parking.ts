import { nearestOnPolyline, pointAtDistance, polylineLength } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import {
  allocateId,
  vehicleClasses,
  type City,
  type Place,
  type VehicleClass,
  type TripRequest,
} from '../schema';
import type { CompiledCity, CParking, Diagnostic } from './types';
import { compileStrip } from './strips';
import { parkingEgress } from './parking-egress';
import { STALL_LINK_M } from './lot-paths';

/** Source aisle permissions also apply to the fitted off-street leg at a mapped mouth. */
export function parkingConnectorPermitted(
  compiled: CompiledCity,
  connector: number,
  vehicleClass: VehicleClass,
  purpose: TripRequest['purpose'] | undefined,
  direction: 'in' | 'out',
): boolean {
  const c = compiled.connectors[connector];
  const records =
    c &&
    compiled.parking[c.parking ?? -1]?.source.mappedPortals?.filter((p) => p.connectorId === c.id);
  if (!records?.length) return true;
  const kind = vehicleClasses.indexOf(vehicleClass);
  return records.some((p) => {
    if (p.direction !== direction) return false;
    const road = compiled.roads[compiled.index.road.get(p.aisleRoadId)!];
    if (!road || !road.lanes.some((i) => compiled.lanes[i]!.allowed.includes(vehicleClass)))
      return false;
    return (
      road.access[kind] !== 'no' && (road.access[kind] !== 'delivery' || purpose === 'delivery')
    );
  });
}

/** Used by import and the editor; compile uses a copy for legacy files and pure fixtures. */
export function addImplicitGarages(city: City, carShare = 1): void {
  const facilities = Object.values(city.parking ?? {});
  for (const place of Object.values(city.places).sort((a, b) => a.id.localeCompare(b.id))) {
    if (place.kind === 'gateway' || !(place.population || place.jobs)) continue;
    const own = facilities.filter((f) => f.placeId === place.id);
    const total = Math.max(1, Math.ceil(place.population * carShare), place.jobs);
    // A block place aggregates several buildings: one mapped garage does not describe the
    // unmapped parking of all the other buildings. Preserve mapped slots and infer the rest.
    if (
      own.length &&
      (!place.provenance.inferred?.includes('blockAggregation') ||
        (place.provenance.osmIds?.length ?? 0) < 2 ||
        own.some((f) => f.provenance.inferred?.includes('implicitGarage')))
    )
      continue;
    const capacity = total - own.reduce((sum, f) => sum + f.capacity, 0);
    if (capacity <= 0) continue;
    const id = allocateId(city, 'pk');
    (city.parking ??= {})[id] = {
      id,
      kind: 'garage',
      name: place.name,
      placeId: place.id,
      access: 'private',
      capacity,
      connectors: place.connectors,
      shape: place.shape,
      provenance: { source: 'generated', inferred: ['implicitGarage', 'capacity', 'access'] },
    };
  }
}

/** Appended after garages and generated geometry, retaining every existing connector index. */
export function compileVisibleParking(
  city: City,
  compiled: CompiledCity,
  centroid: (shape: Place['shape']) => Vec2 | null,
): void {
  for (const source of Object.values(city.parking ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
    if (source.kind === 'garage') continue;
    const lot = compiled.lots?.find((l) => l.id === source.id);
    const strip = source.strip;
    const road = strip && compiled.roads[compiled.index.road.get(strip.roadId)!];
    const firstLane = road && compiled.lanes[road.lanes[0]!]!;
    const center = source.shape
      ? centroid(source.shape)
      : strip?.ring
        ? centroid({ kind: 'polygon', ring: strip.ring })
        : firstLane && strip
          ? pointAtDistance(firstLane.polyline, firstLane.cumulative, (strip.fromM + strip.toM) / 2)
          : null;
    if (!center) continue;
    const place = source.placeId === null ? -1 : (compiled.index.place.get(source.placeId) ?? -1);
    const facility: CParking = {
      idx: compiled.parking.length,
      id: source.id,
      kind: source.kind,
      name: source.name,
      capacity: source.kind === 'lot' ? (lot?.stallCount ?? 0) : source.capacity,
      access: source.access,
      place,
      centroid: center,
      connectorsIn: [],
      connectorsOut: [],
      occupancyAtStart: source.occupancyAtStart ?? null,
      residents: place === -1 ? 0 : city.places[source.placeId!]!.population,
      source,
      spaces: [],
    };
    compiled.parking.push(facility);
    compiled.index.parking.set(facility.id, facility.idx);
    const connector = (lane: number, positionM: number, id: string) => {
      const idx = compiled.connectors.length;
      compiled.connectors.push({
        idx,
        id,
        lane,
        positionM,
        place,
        parking: facility.idx,
        direction: 'both',
        throughputPerMin: 30,
      });
      compiled.index.connector.set(id, idx);
      compiled.lanes[lane]!.connectors.push(idx);
      facility.connectorsIn.push(idx);
      facility.connectorsOut.push(idx);
      return idx;
    };
    if (source.kind === 'roadside' && strip) {
      compileStrip(city, compiled, facility);
      for (const [localIdx, idx] of facility.spaces!.entries()) {
        const space = compiled.parkingSpaces![idx]!;
        space.connector = connector(space.lane, space.positionM, `c:${source.id}:${localIdx}`);
      }
    } else if (source.kind === 'lot' && lot) {
      const entries = source.connectors
        .map((entry) => {
          const r = compiled.roads[compiled.index.road.get(entry.roadId)!];
          const l = r && compiled.lanes[r.lanes[entry.lane]!];
          if (!l) return -1;
          const idx = connector(l.idx, entry.positionM, entry.id);
          compiled.connectors[idx]!.direction = entry.direction;
          compiled.connectors[idx]!.throughputPerMin = entry.throughputPerMin;
          if (entry.direction === 'out')
            facility.connectorsIn = facility.connectorsIn.filter((i) => i !== idx);
          if (entry.direction === 'in')
            facility.connectorsOut = facility.connectorsOut.filter((i) => i !== idx);
          return idx;
        })
        .filter((i) => i !== -1);
      const lanes = (source.aisles ?? []).flatMap((id) => {
        const r = compiled.roads[compiled.index.road.get(id)!];
        return (
          r?.lanes
            .map((i) => compiled.lanes[i]!)
            .filter(
              (l) =>
                l.allowed.includes('car') &&
                !['no', 'delivery'].includes(
                  city.roads[id]!.access?.car ?? city.roads[id]!.access?.all ?? 'yes',
                ),
            ) ?? []
        );
      });
      // Mapped aisles stay in the vehicle network, but parking search ends at their entry.
      // A hand-drawn standalone aisle uses its first stall access as its local portal.
      if (!entries.length)
        for (const lane of lanes) {
          const r = city.roads[compiled.roads[lane.road]!.id]!;
          const start = source.entries?.includes(r.from) || !source.entries?.length;
          const end = source.entries?.includes(r.to);
          if (!start && !end) continue;
          if (source.provenance.source === 'osm' && !source.entries?.length) continue;
          entries.push(
            connector(
              lane.idx,
              !source.entries?.length && lot.stalls.length
                ? Math.min(
                    ...lot.stalls.map(
                      (s) => nearestOnPolyline(lane.polyline, s.access ?? s.position).along,
                    ),
                  )
                : start
                  ? 0
                  : lane.lengthM,
              `c:${source.id}:entry:${lane.id}`,
            ),
          );
        }
      const entry = compiled.connectors[entries[0]!];
      if (!entry) continue;
      for (const [lotStall, stall] of lot.stalls.entries()) {
        const candidate = !source.provenance.inferred?.includes('driveway')
          ? lanes
              .map((lane) => ({ lane, hit: nearestOnPolyline(lane.polyline, stall.position) }))
              .sort((a, b) => a.hit.away - b.hit.away || a.lane.idx - b.lane.idx)[0]
          : undefined;
        const lane = candidate?.lane.idx ?? entry.lane,
          positionM = candidate?.hit.along ?? entry.positionM;
        const idx = (compiled.parkingSpaces ??= []).length;
        const c = entry.idx;
        compiled.parkingSpaces.push({
          lotStall,
          idx,
          parking: facility.idx,
          lane,
          positionM,
          position: stall.position,
          heading: stall.heading,
          widthM: stall.widthM,
          lengthM: stall.lengthM,
          connector: c,
          layout: stall.layout ?? 'perpendicular',
          manoeuvre: true,
        });
        facility.spaces!.push(idx);
      }
      facility.capacity = facility.spaces!.length;
    }
  }
}

export function compileParking(
  city: City,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
  centroid: (shape: Place['shape']) => Vec2 | null,
): void {
  const inferred = { ...city, parking: { ...city.parking } };
  addImplicitGarages(inferred);
  for (const source of Object.values(inferred.parking ?? {}).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const place = source.placeId === null ? -1 : compiled.index.place.get(source.placeId);
    const error = (message: string) =>
      diagnostics.push({ severity: 'error', code: 'parking_invalid', refs: [source.id], message });
    if (place === undefined) {
      error(`Parking ${source.id} names unknown place ${source.placeId}`);
      continue;
    }
    if (!Number.isInteger(source.capacity) || source.capacity < 0) {
      error(`Parking ${source.id} needs a nonnegative slot count`);
      continue;
    }
    const mappedKeys = new Set<string>();
    for (const portal of source.mappedPortals ?? []) {
      const key = `${portal.connectorId}:${portal.direction}`;
      const entry = source.connectors.find((c) => c.id === portal.connectorId);
      const road = city.roads[portal.aisleRoadId];
      const street = entry && city.roads[entry.roadId];
      const node = city.nodes[portal.nodeId];
      const lane =
        entry && compiled.lanes[compiled.index.lane.get(`${entry.roadId}#${entry.lane}`)!];
      if (
        source.kind !== 'lot' ||
        mappedKeys.has(key) ||
        !entry ||
        !road ||
        !source.aisles?.includes(road.id) ||
        !node ||
        !street ||
        !lane ||
        (street.layer ?? 0) !== (road.layer ?? 0) ||
        nearestOnPolyline(street.centerline, node.pos).away > 1 ||
        Math.abs(nearestOnPolyline(lane.polyline, node.pos).along - entry.positionM) > 1 ||
        (portal.direction === 'in' ? road.from : road.to) !== portal.nodeId ||
        (entry.direction !== 'both' && entry.direction !== portal.direction)
      )
        error(
          `Mapped parking portal ${portal.connectorId} needs its own connector and a matching directed aisle mouth`,
        );
      mappedKeys.add(key);
    }
    if (source.kind !== 'garage') {
      if (source.kind === 'roadside') {
        const strip = source.strip,
          road = strip && city.roads[strip.roadId];
        if (
          !strip ||
          !road ||
          strip.fromM < 0 ||
          strip.toM <= strip.fromM ||
          strip.toM > polylineLength(road.centerline) + 1e-6
        )
          error(`Parking ${source.id} needs an existing road and a positive strip run within it`);
      }
      for (const entry of source.connectors) {
        const road = compiled.roads[compiled.index.road.get(entry.roadId)!];
        const lane = road && compiled.lanes[road.lanes[entry.lane]!];
        if (
          !lane ||
          entry.positionM < 0 ||
          entry.positionM > lane.lengthM ||
          entry.throughputPerMin <= 0
        )
          error(`Parking entry ${entry.id} has an invalid road, lane, position or throughput`);
      }
      continue;
    }
    const implicit = source.provenance.inferred?.includes('implicitGarage');
    const entries =
      implicit && place !== -1 ? city.places[source.placeId!]!.connectors : source.connectors;
    const shape = source.shape;
    const first = entries[0];
    const lane =
      first &&
      compiled.lanes[
        compiled.roads[compiled.index.road.get(first.roadId)!]?.lanes[first.lane] ?? -1
      ];
    const center = shape
      ? centroid(shape)
      : place !== -1
        ? compiled.places[place]!.centroid
        : lane
          ? pointAtDistance(lane.polyline, lane.cumulative, first!.positionM)
          : null;
    if (!center) {
      error(`Parking ${source.id} needs a nondegenerate shape, owner place or entry position`);
      continue;
    }
    const facility: CParking = {
      idx: compiled.parking.length,
      id: source.id,
      kind: source.kind,
      name: source.name,
      // An inferred capacity follows its place's current residents and jobs, less the place's
      // other garages, so the nameplate holds the initial stock after the place is edited
      // (owner, 2026-11-08).
      capacity:
        implicit && source.provenance.inferred!.includes('capacity') && place !== -1
          ? Math.max(
              source.capacity,
              Math.max(
                city.places[source.placeId!]!.population,
                city.places[source.placeId!]!.jobs,
              ) -
                Object.values(inferred.parking)
                  .filter((f) => f.placeId === source.placeId && f.id !== source.id)
                  .reduce((sum, f) => sum + f.capacity, 0),
            )
          : source.capacity,
      access: source.access,
      place,
      centroid: center,
      connectorsIn: [],
      connectorsOut: [],
      occupancyAtStart: source.occupancyAtStart ?? null,
      residents: place === -1 ? 0 : city.places[source.placeId!]!.population,
      source,
    };
    compiled.parking.push(facility);
    compiled.index.parking.set(facility.id, facility.idx);
    for (const entry of entries) {
      const road = compiled.roads[compiled.index.road.get(entry.roadId)!];
      const lane = road && compiled.lanes[road.lanes[entry.lane]!];
      if (
        !lane ||
        entry.positionM < 0 ||
        entry.positionM > lane.lengthM ||
        entry.throughputPerMin <= 0
      ) {
        error(`Parking entry ${entry.id} has an invalid road, lane, position or throughput`);
        continue;
      }
      const existing = compiled.index.connector.get(entry.id);
      const idx = existing ?? compiled.connectors.length;
      if (existing === undefined) {
        compiled.connectors.push({ ...entry, idx, lane: lane.idx, place, parking: facility.idx });
        compiled.index.connector.set(entry.id, idx);
        lane.connectors.push(idx);
      } else if (!implicit || compiled.connectors[idx]!.parking !== undefined) {
        error(`Parking entry ${entry.id} duplicates another connector`);
        continue;
      } else compiled.connectors[idx]!.parking = facility.idx;
      if (entry.direction !== 'out') facility.connectorsIn.push(idx);
      if (entry.direction !== 'in') facility.connectorsOut.push(idx);
    }
  }
}

/**
 * TASK-152: a lot bay whose access point lies in the band of a vehicle-graph lane that carries
 * one of its own exits (a mapped aisle road, or a street a generated row adjoins) leaves into
 * that lane at its own station, by the kerbside departure rule, and then drives the lane as a
 * lane vehicle. Without this its drive-out ran inside the exit lane band, with no pose clear of
 * it, as a motion lane traffic cannot see. The lane must lead
 * by legal movements to the public network; on a two-way aisle whose near lane does not, the bay
 * leaves into the opposite lane of the same physical aisle (TASK-149's clear bay manoeuvre).
 * A one-way lane is never reversed. Departure connectors are appended, so every existing
 * connector keeps its index, and belong to no entry list: lot admission is unchanged.
 */
export function compileBayDepartures(compiled: CompiledCity): void {
  // A car departure's legal reach, by the access-zone rules routing uses, at the default
  // lane-change distance (as the compile diagnostics use it).
  const { latestDeparture } = parkingEgress(compiled, 30);
  const added: { space: number; lane: number; positionM: number; id: string }[] = [];
  for (const f of compiled.parking) {
    const lot = f.kind === 'lot' ? compiled.lots?.find((l) => l.id === f.id) : undefined;
    const graph = lot?.circulation;
    if (!lot || !graph) continue;
    const candidates = [
      ...new Set([
        ...lot.aisles.flatMap(
          (id) => compiled.roads[compiled.index.road.get(id) ?? -1]?.lanes ?? [],
        ),
        ...[...f.connectorsIn, ...f.connectorsOut].map((c) => compiled.connectors[c]!.lane),
      ]),
    ].filter((lane) => compiled.lanes[lane]!.allowed.includes('car'));
    for (const idx of f.spaces ?? []) {
      const space = compiled.parkingSpaces![idx]!,
        stall = lot.stalls[space.lotStall!]!;
      if (graph.unreachable.includes(space.lotStall!)) continue;
      const access = stall.access ?? stall.position;
      const hits = candidates
        .map((lane) => ({ lane, hit: nearestOnPolyline(compiled.lanes[lane]!.polyline, access) }))
        .sort((a, b) => a.hit.away - b.hit.away || a.lane - b.lane);
      // Only where one of the bay's own exits lies on that lane: its drive-out would run
      // inside the exit lane's band, with no pose clear of it (TASK-150's census).
      const node = graph.stallNodes[space.lotStall!]!;
      const exitLanes = new Set(
        graph.entries
          .filter(
            (e) =>
              e.direction !== 'in' &&
              f.connectorsOut.includes(e.connector) &&
              Number.isFinite(e.distances[node]),
          )
          .map((e) => compiled.connectors[e.connector]!.lane),
      );
      const near = hits.find(({ lane }) => exitLanes.has(lane));
      if (!near || near.hit.away > compiled.lanes[near.lane]!.widthM / 2) continue;
      const group = compiled.roads[compiled.lanes[near.lane]!.road]!.streetGroupId;
      const choice = hits.find(
        ({ lane, hit }) =>
          (lane === near.lane ||
            (group !== null &&
              compiled.roads[compiled.lanes[lane]!.road]!.streetGroupId === group &&
              hit.away <= STALL_LINK_M)) &&
          latestDeparture(lane) + 1e-9 >= hit.along,
      );
      if (choice)
        added.push({
          space: idx,
          lane: choice.lane,
          positionM: choice.hit.along,
          id: `c:${f.id}:depart:${space.lotStall}`,
        });
    }
  }
  for (const { space, lane, positionM, id } of added) {
    const idx = compiled.connectors.length,
      facility = compiled.parking[compiled.parkingSpaces![space]!.parking]!;
    compiled.connectors.push({
      idx,
      id,
      lane,
      positionM,
      place: facility.place,
      parking: facility.idx,
      direction: 'out',
      throughputPerMin: 30,
    });
    compiled.index.connector.set(id, idx);
    compiled.lanes[lane]!.connectors.push(idx);
    compiled.parkingSpaces![space]!.departure = idx;
  }
}
