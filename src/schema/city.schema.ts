import { z } from 'zod';
import { vehicleClasses, type City, type Node, type VehicleClass } from './city';

const nodeId = z.string().regex(/^n:\d+$/);
const roadId = z.string().regex(/^r:\d+$/);
const placeId = z.string().regex(/^p:\d+$/);
const connectorId = z.string().regex(/^c:\d+$/);
const parkingId = z.string().regex(/^pk:\d+$/);
const walkNodeId = z.string().regex(/^wn:\d+$/);
const walkLinkId = z.string().regex(/^wl:\d+$/);
const count = z.int().nonnegative();
const nonnegative = z.number().nonnegative();
const vec2 = z.object({ x: z.number(), y: z.number() });
const provenance = z.object({
  source: z.enum(['osm', 'authored', 'generated']),
  osmIds: z.array(z.int()).optional(),
  inferred: z.array(z.string()).optional(),
});

export const signalProgramSchema = z.object({
  turnOnRed: z.boolean().optional(),
  offsetS: z.number(),
  amberS: nonnegative,
  allRedS: nonnegative,
  phases: z
    .array(
      z.object({
        durationS: z.number().positive(),
        groups: z.array(z.object({ from: roadId, to: roadId })),
      }),
    )
    .min(1),
});

const junctionControls = z.object({
  control: z.enum(['uncontrolled', 'yield', 'stop', 'signal']),
  minorRoads: z.array(roadId),
  turnRules: z.array(
    z.object({
      from: roadId,
      to: roadId,
      fromLane: count.optional(),
      toLane: count.optional(),
      allowed: z.boolean(),
      provenance,
    }),
  ),
  signal: signalProgramSchema.nullable(),
});

const requiresSignal = (node: z.infer<typeof junctionControls>) =>
  node.control !== 'signal' || node.signal !== null;
const signalRequired = {
  path: ['signal'],
  message: 'Signal-controlled nodes require a signal program',
};

const junctionSchema = z
  .object({
    id: nodeId,
    pos: vec2,
    layer: z.int(),
    ...junctionControls.shape,
    provenance,
  })
  .refine(requiresSignal, signalRequired);

export const laneSchema = z.object({
  widthM: z.number().positive(),
  allowed: z.array(z.enum(vehicleClasses)),
});

export const roadSchema = z.object({
  id: roadId,
  from: nodeId,
  to: nodeId,
  layer: z.int().optional(),
  centerline: z.array(vec2).min(2),
  lateralOffsetM: z.number(),
  lanes: z.array(laneSchema).min(1),
  roadClass: z.enum([
    'motorway',
    'trunk',
    'primary',
    'secondary',
    'tertiary',
    'residential',
    'service',
    'ramp',
  ]),
  speedLimitMps: z.number().positive(),
  access: z
    .partialRecord(
      z.enum(['all', ...vehicleClasses]),
      z.enum(['yes', 'no', 'destination', 'delivery', 'private']),
    )
    .optional(),
  name: z.string().nullable(),
  streetGroupId: z.string().nullable(),
  corridorId: z.string().nullable().optional(),
  crossings: z.object({ start: z.boolean().optional(), end: z.boolean().optional() }).optional(),
  sidewalk: z
    .object({
      left: z.enum(['yes', 'no', 'separate']).optional(),
      right: z.enum(['yes', 'no', 'separate']).optional(),
    })
    .optional(),
  provenance,
});

export const connectorSchema = z.object({
  id: connectorId,
  roadId,
  lane: count,
  positionM: nonnegative,
  direction: z.enum(['in', 'out', 'both']),
  throughputPerMin: z.number().positive(),
});

export const placeSchema = z.object({
  id: placeId,
  kind: z.enum([
    'residential',
    'work',
    'retail',
    'school',
    'station',
    'airport',
    'parking',
    'gateway',
    'other',
  ]),
  name: z.string(),
  shape: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('point'), pos: vec2 }),
    z.object({ kind: z.literal('polygon'), ring: z.array(vec2).min(3) }),
  ]),
  population: count,
  jobs: count,
  attraction: nonnegative,
  capacity: count.nullable(),
  connectors: z.array(connectorSchema),
  profile: z
    .object({
      arrivals: z.array(nonnegative).length(24),
      departures: z.array(nonnegative).length(24),
    })
    .nullable(),
  events: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      startS: nonnegative,
      durationS: z.number().positive(),
      arrivals: count,
      departures: count,
    }),
  ),
  provenance,
});

const restoreSchema = junctionControls.refine(requiresSignal, signalRequired);

const roundaboutSchema = z.object({
  radiusM: z.number().positive(),
  ringRoads: z.array(roadId).min(3),
  restore: restoreSchema,
});
export const nodeSchema = junctionSchema.safeExtend({
  roundabout: roundaboutSchema.optional(),
});

const legacyNodeSchema = junctionSchema
  .safeExtend({
    roundabout: roundaboutSchema
      .omit({ restore: true })
      .extend({
        before: z.object({ nodes: z.record(nodeId, restoreSchema) }),
      })
      .optional(),
  })
  .transform((node, context): Node => {
    const { roundabout, ...junction } = node;
    if (!roundabout) return junction;
    const restore = roundabout.before.nodes[node.id];
    if (!restore) {
      context.addIssue({
        code: 'custom',
        path: ['roundabout', 'before', 'nodes', node.id],
        message: 'Missing original roundabout center',
      });
      return z.NEVER;
    }
    return {
      ...junction,
      roundabout: { radiusM: roundabout.radiusM, ringRoads: roundabout.ringRoads, restore },
    };
  });

// History patches have their own version and can contain nodes from either city schema.
export const projectNodeSchema = z.union([nodeSchema, legacyNodeSchema]);

const geo = z.object({
  origin: z.object({ lon: z.number().min(-180).max(180), lat: z.number().gt(-90).lt(90) }),
  scale: z.number().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  source: z.object({
    kind: z.enum(['osm', 'file']),
    snapshotDate: z.string().nullable(),
    attribution: z.string(),
    importerVersion: z.string(),
    inferredCount: count,
  }),
});

const contextRing = z
  .array(vec2)
  .min(4)
  .refine(
    (ring) => ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y,
    'Context rings must be closed',
  );
const contextFeature = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('area'),
    class: z.enum(['building', 'water', 'green', 'landuse', 'parking']),
    rings: z.array(contextRing).min(1),
    sub: z.string().optional(),
    heightM: z.number().positive().optional(),
    levels: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal('line'),
    class: z.enum(['rail', 'tram', 'waterway', 'tree_row']),
    line: z.array(vec2).min(2),
    widthM: z.number().positive().optional(),
    layer: z.int().optional(),
    spacingM: z.number().min(2).optional(),
  }),
  z.object({
    kind: z.literal('point'),
    class: z.literal('tree'),
    pos: vec2,
    heightM: z.number().positive().optional(),
    crownM: z.number().positive().optional(),
    sub: z.string().optional(),
  }),
]);

const parkingFacility = z.object({
  id: parkingId,
  kind: z.enum(['garage', 'roadside', 'lot']),
  name: z.string().nullable(),
  capacity: count,
  access: z.enum(['public', 'private', 'customers']),
  placeId: placeId.nullable(),
  connectors: z.array(connectorSchema),
  shape: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('point'), pos: vec2 }),
      z.object({ kind: z.literal('polygon'), ring: z.array(vec2).min(3) }),
    ])
    .nullable(),
  strip: z
    .object({
      roadId,
      side: z.enum(['left', 'right']),
      fromM: nonnegative,
      toM: nonnegative,
      layout: z.enum(['parallel', 'angled', 'perpendicular']),
    })
    .refine((strip) => strip.toM > strip.fromM, 'A parking strip must have positive length')
    .optional(),
  aisles: z.array(roadId).optional(),
  occupancyAtStart: z.number().min(0).max(1).optional(),
  provenance,
});

const walkNetwork = z.object({
  nodes: z.record(
    walkNodeId,
    z.object({
      id: walkNodeId,
      pos: vec2,
      layer: z.int(),
      entrance: z.object({ placeId: placeId.nullable() }).optional(),
      provenance,
    }),
  ),
  links: z.record(
    walkLinkId,
    z.object({
      id: walkLinkId,
      from: walkNodeId,
      to: walkNodeId,
      line: z.array(vec2).min(2),
      kind: z.enum(['footway', 'pedestrian', 'path', 'steps', 'living_street', 'crossing']),
      layer: z.int().optional(),
      widthM: z.number().positive().nullable(),
      provenance,
    }),
  ),
});

const cityFields = {
  version: count,
  name: z.string(),
  drivingSide: z.enum(['right', 'left']),
  geo: geo.nullable(),
  nodes: z.record(nodeId, nodeSchema),
  roads: z.record(roadId, roadSchema),
  places: z.record(placeId, placeSchema),
  context: z.object({ features: z.array(contextFeature) }).optional(),
  parking: z.record(parkingId, parkingFacility).optional(),
  walk: walkNetwork.optional(),
  terrain: z
    .object({
      source: z.string().min(1),
      originM: vec2,
      cellM: z.number().positive(),
      cols: z.int().min(2),
      rows: z.int().min(2),
      baseM: z.number(),
      heights: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    })
    .refine((grid) => {
      const bytes =
        (grid.heights.length * 3) / 4 -
        (grid.heights.endsWith('==') ? 2 : grid.heights.endsWith('=') ? 1 : 0);
      return bytes === grid.cols * grid.rows * 2;
    }, 'Terrain byte length must match its dimensions')
    .optional(),
  nextId: count,
};

function matchEntityIds(
  city: Pick<City, 'nodes' | 'roads' | 'places' | 'parking' | 'walk'>,
  context: z.RefinementCtx,
) {
  const records: [string[], Record<string, { id: string }>][] = [
    [['nodes'], city.nodes],
    [['roads'], city.roads],
    [['places'], city.places],
    [['parking'], city.parking ?? {}],
    [['walk', 'nodes'], city.walk?.nodes ?? {}],
    [['walk', 'links'], city.walk?.links ?? {}],
  ];
  for (const [path, record] of records) {
    for (const [id, entity] of Object.entries(record)) {
      if (id !== entity.id)
        context.addIssue({
          code: 'custom',
          path: [...path, id, 'id'],
          message: 'Record key must match entity id',
        });
    }
  }
  for (const link of Object.values(city.walk?.links ?? {})) {
    for (const end of ['from', 'to'] as const) {
      const node = city.walk!.nodes[link[end]];
      if (!node)
        context.addIssue({
          code: 'custom',
          path: ['walk', 'links', link.id, end],
          message: 'Walk endpoint does not exist',
        });
      else {
        const point = end === 'from' ? link.line[0]! : link.line.at(-1)!;
        if (Math.hypot(point.x - node.pos.x, point.y - node.pos.y) > 0.001)
          context.addIssue({
            code: 'custom',
            path: ['walk', 'links', link.id, 'line'],
            message: 'Walk line must meet its endpoints',
          });
      }
    }
  }
}

export const citySchema = z
  .object({ schemaVersion: z.literal(3), ...cityFields })
  .superRefine(matchEntityIds) satisfies z.ZodType<City>;
export const previousCitySchema = z
  .object({ schemaVersion: z.literal(2), ...cityFields })
  .superRefine(matchEntityIds);
const versionOneCitySchema = z
  .object({ schemaVersion: z.literal(1), ...cityFields, nodes: z.record(nodeId, legacyNodeSchema) })
  .superRefine(matchEntityIds)
  .transform((city) => ({ ...city, schemaVersion: 2 as const }));

export const legacyCitySchema = z
  .union([versionOneCitySchema, previousCitySchema])
  .transform((city): City => ({
    ...city,
    schemaVersion: 3,
    roads: Object.fromEntries(
      Object.entries(city.roads).map(([id, road]) => [
        id,
        {
          ...road,
          lanes: road.lanes.map((lane) => ({
            ...lane,
            allowed: lane.allowed.flatMap<VehicleClass>((value) =>
              value === 'car' && !lane.allowed.includes('van') ? ['car', 'van'] : [value],
            ),
          })),
        },
      ]),
    ),
  }));
