import type { City, Patch } from '../schema';

const collections = ['nodes', 'roads', 'places', 'parking', 'junctionGroups'] as const;

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
  if (patch.nextId !== undefined) inverse.nextId = city.nextId;
  return inverse;
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
  if (after.markingTheme !== before.markingTheme) patch.markingTheme = after.markingTheme ?? null;
  if (after.nextId !== before.nextId) patch.nextId = after.nextId;
  return patch;
}
