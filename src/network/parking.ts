import { nearestOnPolyline, pointAtDistance, polylineLength } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { allocateId, type City, type Place } from '../schema';
import type { CompiledCity, CParking, Diagnostic } from './types';
import { compileStrip } from './strips';

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
      const driveway = source.provenance.inferred?.includes('driveway');
      const entries = source.connectors
        .map((entry) => {
          const r = compiled.roads[compiled.index.road.get(entry.roadId)!];
          const l = r && compiled.lanes[r.lanes[entry.lane]!];
          return l ? connector(l.idx, entry.positionM, entry.id) : -1;
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
      if (
        (driveway && !entries.length) ||
        (!driveway && !source.entries?.length && !source.connectors.length)
      ) {
        // Hand-drawn standalone aisles remain usable, while an imported isolated lot needs
        // its materialized inferred driveway rather than spawning onto an isolated aisle.
        if (source.provenance.source === 'osm') continue;
      }
      for (const stall of lot.stalls) {
        const candidate = lanes
          .map((lane) => ({ lane, hit: nearestOnPolyline(lane.polyline, stall.position) }))
          .sort((a, b) => a.hit.away - b.hit.away || a.lane.idx - b.lane.idx)[0];
        const entry = driveway ? compiled.connectors[entries[0]!] : undefined;
        if (!entry && !candidate) continue;
        const lane = entry?.lane ?? candidate!.lane.idx;
        const positionM = entry?.positionM ?? candidate!.hit.along;
        const idx = (compiled.parkingSpaces ??= []).length;
        const c =
          entry?.idx ?? connector(lane, positionM, `c:${source.id}:${facility.spaces!.length}`);
        compiled.parkingSpaces.push({
          idx,
          parking: facility.idx,
          lane,
          positionM,
          position: stall.position,
          heading: stall.heading,
          widthM: stall.widthM,
          lengthM: stall.lengthM,
          layout: 'perpendicular',
          connector: c,
          manoeuvre: !driveway,
        });
        facility.spaces!.push(idx);
      }
      facility.capacity = facility.spaces!.length;
      if (!driveway)
        for (const lane of lanes)
          if (!facility.connectorsIn.some((i) => compiled.connectors[i]!.lane === lane.idx))
            connector(lane.idx, lane.lengthM / 2, `c:${source.id}:aisle:${lane.id}`);
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
