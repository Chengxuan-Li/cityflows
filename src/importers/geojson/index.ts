import { z } from 'zod';
import { distance } from '../../geo/polyline';
import { lonLatToLocal } from '../../geo/projection';
import type { Vec2 } from '../../geo/vec2';
import { compile, type Diagnostic } from '../../network';
import {
  allocateId,
  citySchema,
  placeSchema,
  roadSchema,
  type City,
  type Node,
  type Road,
} from '../../schema';

const coordinateFrame = z.enum(['lonlat', 'local']);
const position = z.tuple([z.number(), z.number(), z.number().optional()]);
const ring = z
  .array(position)
  .min(4)
  .refine((positions) => {
    const first = positions[0];
    const last = positions.at(-1);
    return first && last && first[0] === last[0] && first[1] === last[1] && first[2] === last[2];
  }, 'Polygon ring must be closed');
const featureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.discriminatedUnion('type', [
    z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }),
    z.object({ type: z.literal('Point'), coordinates: position }),
    z.object({ type: z.literal('Polygon'), coordinates: z.tuple([ring]) }),
  ]),
  properties: z.record(z.string(), z.unknown()).nullable(),
});
const collectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(featureSchema),
  'cityflows:coordinates': coordinateFrame.optional(),
});
const roadProperties = z
  .object({
    'cityflows:id': roadSchema.shape.id.optional(),
    lanes: z.int().min(1).max(64).optional(),
    oneway: z.boolean().default(true),
    speed: roadSchema.shape.speedLimitMps.default(30 / 3.6),
    class: roadSchema.shape.roadClass.default('residential'),
    name: roadSchema.shape.name.default(null),
  })
  .refine(({ oneway, lanes }) => oneway || lanes !== 1, {
    path: ['lanes'],
    message: 'A two-way road needs at least two lanes',
  });
const placeProperties = z.object({
  'cityflows:id': placeSchema.shape.id.optional(),
  kind: placeSchema.shape.kind,
  population: placeSchema.shape.population.default(0),
  jobs: placeSchema.shape.jobs.default(0),
  name: placeSchema.shape.name.optional(),
});

export interface GeoJsonImportOptions {
  coordinates?: z.infer<typeof coordinateFrame>;
  snapToleranceM?: number;
}

export type GeoJsonImportResult =
  | { ok: true; city: City; diagnostics: Diagnostic[]; idMap: Record<string, string> }
  | { ok: false; city: null; diagnostics: Diagnostic[]; idMap: Record<string, string> };

export function importGeoJson(
  city: City,
  geojson: unknown,
  options: GeoJsonImportOptions = {},
): GeoJsonImportResult {
  const diagnostics: Diagnostic[] = [];
  const rejected = (): GeoJsonImportResult => ({ ok: false, city: null, diagnostics, idMap: {} });
  const fail = (code: string, message: string, refs: string[] = []) => {
    diagnostics.push({ severity: 'error', code, message, refs });
    return rejected();
  };
  function invalid(code: string, error: z.ZodError, prefix: string[] = []) {
    const issue = error.issues[0]!;
    const path = [...prefix, ...issue.path.map(String)].join('.');
    return fail(code, path ? `${path}: ${issue.message}` : issue.message, prefix);
  }
  const parsed = collectionSchema.safeParse(geojson);
  if (!parsed.success) return invalid('geojson_invalid_collection', parsed.error);

  const { features } = parsed.data;
  const coordinates = options.coordinates ?? parsed.data['cityflows:coordinates'] ?? 'lonlat';
  const tolerance = options.snapToleranceM ?? 1;
  if (!Number.isFinite(tolerance) || tolerance < 0)
    return fail('geojson_invalid_options', 'Snap tolerance must be a finite, nonnegative distance');
  const geo = coordinates === 'lonlat' ? city.geo : null;
  if (coordinates === 'lonlat' && !geo)
    return fail(
      'geojson_missing_geo_reference',
      'Longitude and latitude require a city geographic reference',
    );

  const reserved = new Set<string>();
  for (const { properties } of features) {
    const id = properties?.['cityflows:id'];
    if (typeof id !== 'string') continue;
    const suffix = Number(id.slice(2));
    if (!Number.isSafeInteger(suffix) || suffix >= Number.MAX_SAFE_INTEGER)
      return fail('geojson_invalid_feature', `Feature ID ${id} has an invalid numeric suffix`, [
        id,
      ]);
    if (reserved.has(id)) return fail('geojson_duplicate_id', `Duplicate feature ID ${id}`, [id]);
    reserved.add(id);
  }
  const next: City = {
    ...city,
    version: city.version + (features.length ? 1 : 0),
    nodes: { ...city.nodes },
    roads: { ...city.roads },
    places: { ...city.places },
  };
  const idMap: Record<string, string> = {};
  const provenance = { source: 'authored' as const };
  const nodes = Object.keys(next.nodes)
    .sort()
    .map((id) => next.nodes[id]!);
  let nextAfterStableIds = next.nextId;

  function claimId(prefix: 'n' | 'r' | 'p', requested?: string): string {
    const entities = prefix === 'n' ? next.nodes : prefix === 'r' ? next.roads : next.places;
    if (requested !== undefined && !Object.hasOwn(entities, requested)) {
      nextAfterStableIds = Math.max(nextAfterStableIds, Number(requested.slice(2)) + 1);
      idMap[requested] = requested;
      return requested;
    }
    let id = allocateId(next, prefix);
    while (Number.isSafeInteger(next.nextId) && (Object.hasOwn(entities, id) || reserved.has(id)))
      id = allocateId(next, prefix);
    if (requested !== undefined) {
      idMap[requested] = id;
      diagnostics.push({
        severity: 'warning',
        code: 'geojson_id_remapped',
        message: `Feature ID ${requested} already exists and was remapped to ${id}`,
        refs: [requested, id],
      });
    }
    return id;
  }

  function snap(pos: Vec2): Node {
    let closest: Node | undefined;
    let nearest = tolerance;
    for (const node of nodes) {
      const meters = distance(pos, node.pos);
      if (meters <= tolerance && (!closest || meters < nearest)) {
        closest = node;
        nearest = meters;
      }
    }
    if (closest) return closest;
    const id = claimId('n');
    const node: Node = {
      id,
      pos,
      layer: 0,
      control: 'uncontrolled',
      minorRoads: [],
      turnRules: [],
      signal: null,
      provenance,
    };
    next.nodes[id] = node;
    nodes.push(node);
    return node;
  }

  for (const [index, { geometry, properties }] of features.entries()) {
    const refs = ['features', String(index)];
    const positions =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'Point'
          ? [geometry.coordinates]
          : geometry.coordinates[0].slice(0, -1);
    if (geo && positions.some(([lon, lat]) => lon < -180 || lon > 180 || Math.abs(lat) >= 90))
      return fail(
        'geojson_invalid_coordinate',
        'Expected longitude within ±180° and latitude inside ±90°',
        refs,
      );
    const points = positions.map(([x, y]) =>
      geo ? lonLatToLocal(geo, { lon: x, lat: y }) : { x, y },
    );

    if (geometry.type === 'LineString') {
      const attributes = roadProperties.safeParse(properties ?? {});
      if (!attributes.success)
        return invalid('geojson_invalid_feature', attributes.error, [...refs, 'properties']);
      const { oneway, lanes = oneway ? 1 : 2, speed, class: roadClass, name } = attributes.data;
      const from = snap(points[0]!);
      const to = snap(points.at(-1)!);
      points[0] = from.pos;
      points[points.length - 1] = to.pos;

      const id = claimId('r', attributes.data['cityflows:id']);
      const widthM = roadClass === 'residential' || roadClass === 'service' ? 3 : 3.5;
      const side = city.drivingSide === 'right' ? 1 : -1;
      const reverseId = oneway ? null : claimId('r');
      const streetGroupId = reverseId === null ? null : `geojson:${reverseId}`;
      function addRoad(roadId: string, start: Node, end: Node, centerline: Vec2[], count: number) {
        const road: Road = {
          id: roadId,
          from: start.id,
          to: end.id,
          centerline,
          lanes: Array.from({ length: count }, () => ({
            widthM,
            allowed: ['car', 'truck', 'bus'],
          })),
          lateralOffsetM: oneway ? 0 : (side * count * widthM) / 2,
          streetGroupId,
          name,
          roadClass,
          speedLimitMps: speed,
          provenance,
        };
        next.roads[roadId] = road;
      }
      addRoad(id, from, to, points, oneway ? lanes : Math.ceil(lanes / 2));
      if (reverseId !== null)
        addRoad(reverseId, to, from, [...points].reverse(), Math.floor(lanes / 2));
    } else {
      const attributes = placeProperties.safeParse(properties ?? {});
      if (!attributes.success)
        return invalid('geojson_invalid_feature', attributes.error, [...refs, 'properties']);
      const { kind, name = kind, population, jobs } = attributes.data;
      const id = claimId('p', attributes.data['cityflows:id']);
      next.places[id] = {
        id,
        kind,
        name,
        population,
        jobs,
        shape:
          geometry.type === 'Point'
            ? { kind: 'point', pos: points[0]! }
            : { kind: 'polygon', ring: points },
        attraction: 1,
        capacity: null,
        connectors: [],
        profile: null,
        events: [],
        provenance,
      };
    }
  }

  next.nextId = Math.max(next.nextId, nextAfterStableIds);
  const validated = citySchema.safeParse(next);
  if (!validated.success) return invalid('geojson_invalid_city', validated.error);
  const compiled = compile(next);
  diagnostics.push(...compiled.diagnostics);
  return compiled.ok ? { ok: true, city: next, diagnostics, idMap } : rejected();
}
