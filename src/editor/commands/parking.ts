import { allocateId, type City, type Command, type ParkingFacility } from '../../schema';
import { polylineLength } from '../../geo/polyline';
import { compile } from '../../network';
import { addImplicitGarages } from '../../network/parking';
import { safeStripRuns, stripPitch } from '../../network/strips';
import { requireEntity, type CommandPatch } from './types';
import { applyPatch } from '../patch';

/** Keep canonical strips attached to their road through ordinary topology edits. */
export function mapStrips(
  city: City,
  patch: CommandPatch,
  roadId: string,
  update: (
    strip: NonNullable<ParkingFacility['strip']>,
    facility: ParkingFacility,
  ) => NonNullable<ParkingFacility['strip']>[],
): void {
  const counter = { nextId: patch.nextId ?? city.nextId };
  for (const original of Object.values(city.parking ?? {})) {
    if (original.strip?.roadId !== roadId) continue;
    const strips = update(original.strip, original).filter(
      (strip) => strip.toM - strip.fromM >= stripPitch(strip.layout),
    );
    if (!strips.length) {
      (patch.remove.parking ??= []).push(original.id);
      continue;
    }
    for (const [index, strip] of strips.entries()) {
      const id = index === 0 ? original.id : allocateId(counter, 'pk');
      const pitch = stripPitch(strip.layout);
      (patch.set.parking ??= {})[id] = {
        ...original,
        id,
        strip,
        capacity: Math.floor((strip.toM - strip.fromM) / pitch),
      };
    }
  }
  if (counter.nextId !== (patch.nextId ?? city.nextId)) patch.nextId = counter.nextId;
}

/** A moved endpoint keeps a strip's relative run, then reapplies driveway and junction gaps. */
export function resizeStrips(city: City, patch: CommandPatch): void {
  const roads = Object.values(patch.set.roads ?? {}).filter((road) =>
    Object.values(city.parking ?? {}).some((facility) => facility.strip?.roadId === road.id),
  );
  if (!roads.length) return;
  const candidate = applyPatch(city, patch);
  // Old strip stations may exceed a shortened road; compile only the geometry used to resize them.
  const affected = new Set(roads.map((road) => road.id));
  const geometry = {
    ...candidate,
    parking: Object.fromEntries(
      Object.entries(candidate.parking ?? {}).filter(
        ([, facility]) => !facility.strip || !affected.has(facility.strip.roadId),
      ),
    ),
  };
  const result = compile(geometry);
  if (!result.ok) return; // The editor reports invalid topology when committing the patch.
  const buildings =
    candidate.context?.features.flatMap((feature) =>
      feature.kind === 'area' && feature.class === 'building' ? [feature.rings[0]!] : [],
    ) ?? [];
  for (const road of roads) {
    const scale = polylineLength(road.centerline) / polylineLength(city.roads[road.id]!.centerline);
    mapStrips(city, patch, road.id, (strip, facility) =>
      safeStripRuns(candidate, result.compiled, road.id, strip.side, strip.layout, [
        ...(facility.exclusions ?? []),
        ...buildings,
      ]).map((run) => ({
        ...strip,
        fromM: Math.max(strip.fromM * scale, run.fromM),
        toM: Math.min(strip.toM * scale, run.toM),
      })),
    );
  }
}

export function editRoadParking(
  city: City,
  command: Extract<Command, { kind: 'setRoadParking' }>,
): CommandPatch {
  const road = requireEntity(city.roads, command.roadId);
  const existing = Object.values(city.parking ?? {})
    .filter(({ strip }) => strip?.roadId === command.roadId && strip.side === command.side)
    .sort((a, b) => a.strip!.fromM - b.strip!.fromM || a.id.localeCompare(b.id));
  const patch: CommandPatch = { set: {}, remove: { parking: existing.map(({ id }) => id) } };
  if (!command.layout) return patch;
  const draft = {
    ...city,
    parking: Object.fromEntries(
      Object.entries(city.parking ?? {}).filter(([id]) => !patch.remove.parking!.includes(id)),
    ),
  };
  const result = compile(draft);
  if (!result.ok) throw new Error('Cannot add parking to an invalid road network');
  const counter = { nextId: city.nextId };
  const layout = command.layout;
  const margin =
    Math.abs(road.lateralOffsetM) + road.lanes.reduce((sum, lane) => sum + lane.widthM, 0) / 2 + 5;
  const xs = road.centerline.map((p) => p.x),
    ys = road.centerline.map((p) => p.y);
  const nearby = (ring: typeof road.centerline) =>
    Math.min(...ring.map((p) => p.x)) < Math.max(...xs) + margin &&
    Math.max(...ring.map((p) => p.x)) > Math.min(...xs) - margin &&
    Math.min(...ring.map((p) => p.y)) < Math.max(...ys) + margin &&
    Math.max(...ring.map((p) => p.y)) > Math.min(...ys) - margin;
  const rings = [
    ...existing.flatMap((facility) => facility.exclusions ?? []),
    ...(city.context?.features.flatMap((feature) =>
      feature.kind === 'area' && feature.class === 'building' ? [feature.rings[0]!] : [],
    ) ?? []),
  ].filter(nearby);
  const exclusions = [...new Map(rings.map((ring) => [JSON.stringify(ring), ring])).values()];
  const runs = safeStripRuns(
    draft,
    result.compiled,
    command.roadId,
    command.side,
    layout,
    exclusions,
  );
  patch.set.parking = Object.fromEntries(
    runs.map((run, index) => {
      const original = existing[index];
      const id = original?.id ?? allocateId(counter, 'pk');
      const facility: ParkingFacility = {
        id,
        kind: 'roadside',
        name: original?.name ?? null,
        access: command.access ?? original?.access ?? 'public',
        placeId: original?.placeId ?? null,
        capacity: run.capacity,
        connectors: [],
        shape: null,
        strip: {
          roadId: command.roadId,
          side: command.side,
          fromM: run.fromM,
          toM: run.toM,
          layout,
        },
        provenance: { source: 'authored' },
        ...(exclusions.length ? { exclusions } : {}),
      };
      return [id, facility];
    }),
  );
  if (counter.nextId !== city.nextId) patch.nextId = counter.nextId;
  if (!runs.length)
    patch.warnings = [
      {
        severity: 'warning',
        code: 'parking_unreachable',
        refs: [command.roadId],
        message: 'No safe parking space is available on this side of the street',
      },
    ];
  return patch;
}

export function editParking(
  city: City,
  command: Extract<Command, { kind: 'setParkingAttributes' }>,
): CommandPatch {
  const materialized = { ...city, parking: { ...city.parking } };
  addImplicitGarages(materialized);
  const facility = materialized.parking[command.parkingId] ?? command.source;
  const original = requireEntity(facility ? { [facility.id]: facility } : {}, command.parkingId);
  return {
    set: {
      parking: {
        ...Object.fromEntries(
          Object.entries(materialized.parking).filter(([id]) => !city.parking?.[id]),
        ),
        [original.id]: {
          ...original,
          ...(command.capacity !== undefined && { capacity: command.capacity }),
          ...(command.access !== undefined && { access: command.access }),
          // A set value is no longer inferred; a set capacity is a hard limit (src/sim/parking.ts).
          provenance: {
            ...original.provenance,
            inferred: original.provenance.inferred?.filter(
              (key) =>
                !(key === 'capacity' && command.capacity !== undefined) &&
                !(key === 'access' && command.access !== undefined),
            ),
          },
        },
      },
    },
    remove: {},
    nextId: Math.max(materialized.nextId, Number(original.id.slice(3)) + 1),
  };
}
