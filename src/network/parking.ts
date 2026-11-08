import { pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { allocateId, type City, type Place } from '../schema';
import type { CompiledCity, CParking, Diagnostic } from './types';

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
    // TASK-103 and TASK-104 supply the manoeuvres for the other parking kinds.
    if (source.kind !== 'garage') continue;
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
