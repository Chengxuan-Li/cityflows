import type { AirportPatch, City, Patch } from '../schema';
import type { Airport } from '../schema/airport';

const collections = ['nodes', 'roads', 'places', 'parking', 'junctionGroups'] as const;
/** TASK-305: the airport's records an edit sets and removes one by one. */
const airportRecords = ['nodes', 'edges', 'runways', 'holdingPositions', 'stands'] as const;

function applyRecords<T>(
  records: Record<string, T>,
  set: Record<string, T> | undefined,
  remove: string[] | undefined,
): Record<string, T> {
  if (!set && !remove?.length) return records;
  const next = { ...records };
  for (const id of remove ?? []) delete next[id];
  return Object.assign(next, set);
}

function applyAirport(airport: Airport | undefined, patch: AirportPatch | undefined) {
  if (!patch) return airport;
  if (!airport) throw new Error('This city has no airport');
  const next: Airport = { ...airport };
  for (const key of airportRecords)
    Object.assign(next, {
      [key]: applyRecords<unknown>(airport[key], patch.set[key], patch.remove[key]),
    });
  if (patch.roadCrossings) next.roadCrossings = patch.roadCrossings;
  if (patch.runwayOperations === null) delete next.runwayOperations;
  else if (patch.runwayOperations) next.runwayOperations = patch.runwayOperations;
  return next;
}

export function applyPatch(city: City, patch: Patch): City {
  const theme =
    patch.markingTheme === undefined ? city.markingTheme : (patch.markingTheme ?? undefined);
  const next = {
    ...city,
    markingTheme: theme,
    ...patch.metadata,
    nodes: applyRecords(city.nodes, patch.set.nodes, patch.remove.nodes),
    roads: applyRecords(city.roads, patch.set.roads, patch.remove.roads),
    places: applyRecords(city.places, patch.set.places, patch.remove.places),
    ...(city.parking || patch.set.parking || patch.remove.parking
      ? { parking: applyRecords(city.parking ?? {}, patch.set.parking, patch.remove.parking) }
      : {}),
    ...(city.junctionGroups || patch.set.junctionGroups || patch.remove.junctionGroups
      ? {
          junctionGroups: applyRecords(
            city.junctionGroups ?? {},
            patch.set.junctionGroups,
            patch.remove.junctionGroups,
          ),
        }
      : {}),
    ...(patch.airport ? { airport: applyAirport(city.airport, patch.airport) } : {}),
    nextId: patch.nextId ?? city.nextId,
  };
  if (theme === undefined) delete next.markingTheme;
  return next;
}

export function invertPatch(city: City, patch: Patch): Patch {
  const inverse: Patch = { set: {}, remove: {} };
  if (patch.markingTheme !== undefined) inverse.markingTheme = city.markingTheme ?? null;
  if (patch.metadata)
    inverse.metadata = { name: city.name, drivingSide: city.drivingSide, geo: city.geo };
  for (const key of collections) {
    const ids = new Set([...Object.keys(patch.set[key] ?? {}), ...(patch.remove[key] ?? [])]);
    for (const id of ids) {
      const original = city[key]?.[id];
      if (original) Object.assign((inverse.set[key] ??= {}), { [id]: original });
      else (inverse.remove[key] ??= []).push(id);
    }
  }
  if (patch.airport) {
    const airport = city.airport!;
    const back: AirportPatch = { set: {}, remove: {} };
    for (const key of airportRecords) {
      const ids = new Set([
        ...Object.keys(patch.airport.set[key] ?? {}),
        ...(patch.airport.remove[key] ?? []),
      ]);
      for (const id of ids) {
        const original = airport[key][id];
        if (original) Object.assign((back.set[key] ??= {}), { [id]: original });
        else (back.remove[key] ??= []).push(id);
      }
    }
    if (patch.airport.roadCrossings) back.roadCrossings = airport.roadCrossings;
    if (patch.airport.runwayOperations !== undefined)
      back.runwayOperations = airport.runwayOperations ?? null;
    inverse.airport = back;
  }
  if (patch.nextId !== undefined) inverse.nextId = city.nextId;
  return inverse;
}

export function diffAirport(before: Airport | undefined, after: Airport | undefined) {
  if (before === after) return undefined;
  if (!before || !after) throw new Error('An edit cannot add or remove an airport');
  const patch: AirportPatch = { set: {}, remove: {} };
  for (const key of airportRecords) {
    if (before[key] === after[key]) continue;
    for (const id of Object.keys(before[key])) {
      if (!after[key][id]) (patch.remove[key] ??= []).push(id);
    }
    for (const [id, entity] of Object.entries(after[key])) {
      if (entity !== before[key][id]) Object.assign((patch.set[key] ??= {}), { [id]: entity });
    }
  }
  if (before.roadCrossings !== after.roadCrossings) patch.roadCrossings = after.roadCrossings;
  if (before.runwayOperations !== after.runwayOperations)
    patch.runwayOperations = after.runwayOperations ?? null;
  return patch;
}

export function diffCity(before: City, after: City): Patch {
  const patch: Patch = { set: {}, remove: {} };
  if (
    before.name !== after.name ||
    before.drivingSide !== after.drivingSide ||
    before.geo !== after.geo
  ) {
    patch.metadata = { name: after.name, drivingSide: after.drivingSide, geo: after.geo };
  }
  for (const key of collections) {
    if (before[key] === after[key]) continue;
    for (const id of Object.keys(before[key] ?? {})) {
      if (!after[key]?.[id]) (patch.remove[key] ??= []).push(id);
    }
    for (const [id, entity] of Object.entries(after[key] ?? {})) {
      if (entity !== before[key]?.[id]) Object.assign((patch.set[key] ??= {}), { [id]: entity });
    }
  }
  const airport = diffAirport(before.airport, after.airport);
  if (airport) patch.airport = airport;
  if (after.markingTheme !== before.markingTheme) patch.markingTheme = after.markingTheme ?? null;
  if (after.nextId !== before.nextId) patch.nextId = after.nextId;
  return patch;
}
